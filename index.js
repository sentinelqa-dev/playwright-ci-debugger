"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const UPLOADER_VERSION = "0.1.29";
const VENDORED_UPLOADER_TARBALL = path.join(
  __dirname,
  "vendor",
  `sentinelqa-uploader-${UPLOADER_VERSION}.tgz`
);

const stripAnsi = (value) => value.replace(/\u001b\[[0-9;]*m/g, "");

const readInput = (name, fallback = "") => {
  const normalized = `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
  const candidates = [
    normalized,
    normalized.replace(/-/g, "_")
  ];
  for (const key of candidates) {
    const value = process.env[key];
    if (value && value.trim().length > 0) return value.trim();
  }
  return fallback;
};

const isTruthy = (value) =>
  ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());

const splitArtifactDirs = (value) =>
  value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const existsFile = (value) => {
  try {
    return fs.statSync(value).isFile();
  } catch {
    return false;
  }
};

const existsDir = (value) => {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
};

const signalSummary = (signal) => {
  switch (signal) {
    case "timeout":
      return "timeout while waiting for UI or network conditions";
    case "assertion_mismatch":
      return "assertion mismatch between expected and rendered UI state";
    case "locator_not_found":
      return "missing or changed locator";
    case "actionability":
      return "target element was not actionable";
    case "network":
      return "network or API failure";
    case "runtime":
      return "frontend runtime error";
    default:
      return "failure signal could not be classified cleanly";
  }
};

const toMessage = (result) => {
  const direct =
    result?.error?.message ||
    result?.error?.stack ||
    result?.error?.value ||
    null;
  if (direct) return stripAnsi(String(direct));
  const first = (result?.errors || []).find(Boolean);
  return first ? stripAnsi(String(first.message || first.stack || first.value || "")) : "";
};

const classifySignal = (message) => {
  const lower = message.toLowerCase();
  if (/expected substring|expected string|received string|tohavetext|tocontaintext/.test(lower)) {
    return "assertion_mismatch";
  }
  if (/timeout|timed out|waiting for/.test(lower)) return "timeout";
  if (/resolved to 0 elements|locator.*not found|never appeared|strict mode violation/.test(lower)) {
    return "locator_not_found";
  }
  if (/not visible|not enabled|not stable|intercepts pointer events|not actionable/.test(lower)) {
    return "actionability";
  }
  if (/status\s*[45]\d{2}|net::|failed to fetch|network|request failed/.test(lower)) {
    return "network";
  }
  if (/typeerror|referenceerror|syntaxerror|unhandled/.test(lower)) return "runtime";
  return "unknown";
};

const flattenFailedCases = (node, titlePath = []) => {
  const currentTitlePath = node?.title ? [...titlePath, node.title] : titlePath;
  const failedCases = [];

  for (const test of node?.tests || []) {
    const title = [...currentTitlePath, test?.title || "Unnamed test"].join(" > ");
    for (const result of test?.results || []) {
      if (!["failed", "timedOut", "interrupted"].includes(result?.status || "")) continue;
      const message = toMessage(result);
      failedCases.push({ title, message, signal: classifySignal(message) });
    }
  }

  for (const child of node?.specs || []) {
    failedCases.push(...flattenFailedCases(child, currentTitlePath));
  }
  for (const child of node?.suites || []) {
    failedCases.push(...flattenFailedCases(child, currentTitlePath));
  }

  return failedCases;
};

const buildQuickDiagnosis = (playwrightJsonPath) => {
  if (!fs.existsSync(playwrightJsonPath)) return null;
  try {
    const raw = fs.readFileSync(playwrightJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    const failures = flattenFailedCases(parsed);
    if (!failures.length) return null;
    if (failures.length === 1) {
      return {
        lines: [`Test "${failures[0].title.split(" > ").pop()}" likely failed due to ${signalSummary(failures[0].signal)}.`]
      };
    }

    const counts = new Map();
    for (const failure of failures) {
      counts.set(failure.signal, (counts.get(failure.signal) || 0) + 1);
    }
    const topSignal = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";
    return {
      lines: [
        `${failures.length} tests failed.`,
        `Most common signal: ${signalSummary(topSignal)}.`
      ]
    };
  } catch {
    return null;
  }
};

const appendSummary = (lines) => {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  fs.appendFileSync(summaryPath, `${lines.join("\n")}\n`);
};

const setOutput = (name, value) => {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `${name}=${String(value ?? "")}\n`);
};

const ensureDirForUpload = (dirPath, label) => {
  if (existsDir(dirPath)) {
    return { path: dirPath, degraded: false, reason: null };
  }
  const fallbackPath = fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-empty-"));
  return {
    path: fallbackPath,
    degraded: true,
    reason: `${label} not found at ${dirPath}. Uploading without that artifact directory.`
  };
};

const githubContext = () => ({
  repository: process.env.GITHUB_REPOSITORY || null,
  workflow: process.env.GITHUB_WORKFLOW || null,
  job: process.env.GITHUB_JOB || null,
  runId: process.env.GITHUB_RUN_ID || null,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  sha: process.env.GITHUB_SHA || null,
  refName: process.env.GITHUB_REF_NAME || null,
  actor: process.env.GITHUB_ACTOR || null
});

const runUploader = async ({
  playwrightJsonPath,
  playwrightReportDir,
  testResultsDir,
  artifactDirs,
  project
}) => {
  const args = [
    "exec",
    "--yes",
    "--package",
    VENDORED_UPLOADER_TARBALL,
    "--",
    "sentinelqa",
    "upload",
    "--playwright-json-path",
    playwrightJsonPath,
    "--playwright-report-dir",
    playwrightReportDir,
    "--test-results-dir",
    testResultsDir
  ];
  for (const dir of artifactDirs) {
    args.push("--artifact-dir", dir);
  }

  const env = {
    ...process.env,
    SENTINEL_SUPPRESS_SUMMARY_JSON: "1",
    SENTINEL_EMIT_RESULT_JSON: "1"
  };
  if (project) env.SENTINEL_REPORTER_PROJECT = project;

  return new Promise((resolve, reject) => {
    if (!existsFile(VENDORED_UPLOADER_TARBALL)) {
      reject(
        new Error(
          `Vendored uploader package not found at ${VENDORED_UPLOADER_TARBALL}.`
        )
      );
      return;
    }
    const child = spawn("npx", args, { stdio: ["ignore", "pipe", "pipe"], env });
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let parsed = null;
    const prefix = "SENTINEL_UPLOAD_RESULT_JSON=";

    const flush = (buffer, stream) => {
      const lines = buffer.split(/\r?\n/);
      const remainder = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith(prefix)) {
          try {
            parsed = JSON.parse(line.slice(prefix.length));
          } catch {}
          continue;
        }
        stream.write(`${line}\n`);
      }
      return remainder;
    };

    child.stdout.on("data", (chunk) => {
      stdoutBuffer = flush(stdoutBuffer + chunk.toString("utf8"), process.stdout);
    });
    child.stderr.on("data", (chunk) => {
      stderrBuffer = flush(stderrBuffer + chunk.toString("utf8"), process.stderr);
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Uploader terminated by signal ${signal}`));
        return;
      }
      if (stdoutBuffer.trim()) process.stdout.write(stdoutBuffer);
      if (stderrBuffer.trim()) process.stderr.write(stderrBuffer);
      resolve({ exitCode: code ?? 1, result: parsed });
    });
  });
};

const main = async () => {
  if (process.argv.includes("--self-check")) {
    process.exit(0);
  }

  try {
    const project = readInput("project");
    const playwrightJsonPath = readInput("playwright-json-path", "test-results/report.json");
    const playwrightReportDir = readInput("playwright-report-dir", "playwright-report");
    const testResultsDir = readInput("test-results-dir", "test-results");
    const artifactDirs = splitArtifactDirs(readInput("artifact-dirs", ""));
    const failOnMissingJson = isTruthy(readInput("fail-on-missing-json", "true"));
    const gh = githubContext();

    if (!gh.runId || !gh.repository || process.env.GITHUB_ACTIONS !== "true") {
      throw new Error("This action must run inside GitHub Actions with standard GitHub workflow metadata available.");
    }

    if (!existsFile(playwrightJsonPath)) {
      const lines = [
        "Sentinel: Upload skipped.",
        `Reason: Playwright JSON report not found at ${playwrightJsonPath}.`,
        "",
        "Next step:",
        "- Make sure your Playwright workflow writes a JSON report file.",
        "- Example: reporter: [['json', { outputFile: 'test-results/report.json' }], ['html', { outputFolder: 'playwright-report', open: 'never' }]]",
        "- Or set the action input playwright-json-path to the correct location."
      ];
      console.log(lines.join("\n"));
      setOutput("mode", process.env.SENTINEL_TOKEN ? "workspace" : "public");
      setOutput("summary", "Upload skipped because the Playwright JSON report was missing.");
      appendSummary(["## Sentinel report", "", "Upload skipped because the Playwright JSON report was missing."]);
      if (failOnMissingJson) {
        process.exitCode = 1;
      }
      return;
    }

    const reportDir = ensureDirForUpload(playwrightReportDir, "Playwright HTML report directory");
    const resultsDir = ensureDirForUpload(testResultsDir, "Playwright test-results directory");
    const extraDirs = artifactDirs.map((dir) => ensureDirForUpload(dir, `Artifact directory ${dir}`));
    const degradedReasons = [reportDir, resultsDir, ...extraDirs]
      .filter((entry) => entry.degraded && entry.reason)
      .map((entry) => entry.reason);

    const quickDiagnosis = buildQuickDiagnosis(playwrightJsonPath);
    console.log("");
    if (quickDiagnosis?.lines.length) {
      console.log("Quick diagnosis");
      for (const line of quickDiagnosis.lines) {
        console.log(`  ${line}`);
      }
      console.log("");
    }

    if (process.env.SENTINEL_TOKEN) {
      console.log("");
      console.log("✔ Artifacts collected");
    }

    if (degradedReasons.length) {
      console.log("Artifact validation");
      for (const reason of degradedReasons) {
        console.log(`  ${reason}`);
      }
      console.log("");
    }

    console.log("");
    console.log("Uploading hosted debugging report to Sentinel...");
    console.log("");

    const upload = await runUploader({
      playwrightJsonPath,
      playwrightReportDir: reportDir.path,
      testResultsDir: resultsDir.path,
      artifactDirs: extraDirs.map((entry) => entry.path),
      project
    });

    if (upload.exitCode !== 0) {
      process.exitCode = upload.exitCode;
      throw new Error(`Sentinel upload failed with exit code ${upload.exitCode}`);
    }

    const reportUrl = upload.result?.shareRunUrl || upload.result?.internalRunUrl || "";
    const mode = process.env.SENTINEL_TOKEN ? "workspace" : "public";
    const summary = degradedReasons.length
      ? `Uploaded Sentinel report in degraded mode for ${gh.repository} run ${gh.runId}.`
      : `Uploaded Sentinel report for ${gh.repository} run ${gh.runId}.`;
    setOutput("report-url", reportUrl);
    setOutput("share-url", upload.result?.shareRunUrl || "");
    setOutput("first-failure-url", upload.result?.shareFirstFailureUrl || "");
    setOutput("mode", mode);
    setOutput("summary", summary);

    console.log("");
    console.log("Sentinel report");
    console.log(`  ${reportUrl}`);
    if (upload.result?.shareLabel) {
      console.log(`  ${upload.result.shareLabel}`);
    }
    if (!process.env.SENTINEL_TOKEN) {
      console.log("");
      console.log("Upgrade for free to get full AI debugging suggestions");
      console.log("  https://app.sentinelqa.com/register");
    }

    const summaryLines = [
      "## Sentinel report",
      "",
      `[Open hosted debugging report](${reportUrl})`,
      "",
      `Repository: ${gh.repository}`,
      `Workflow: ${gh.workflow || "-"}`,
      `Job: ${gh.job || "-"}`,
      `Run: ${gh.runId}${gh.runAttempt ? ` (attempt ${gh.runAttempt})` : ""}`
    ];
    if (upload.result?.shareLabel) {
      summaryLines.push("", upload.result.shareLabel);
    }
    if (degradedReasons.length) {
      summaryLines.push("", "Degraded upload mode:");
      for (const reason of degradedReasons) {
        summaryLines.push(`- ${reason}`);
      }
    }
    if (!process.env.SENTINEL_TOKEN) {
      summaryLines.push(
        "",
        "Upgrade for free to get full AI debugging suggestions:",
        "https://app.sentinelqa.com/register"
      );
    }
    appendSummary(summaryLines);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = process.exitCode || 1;
  }
};

void main();
