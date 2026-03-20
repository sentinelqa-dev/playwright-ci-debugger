# Playwright CI Debugger

## Debug Playwright CI failures with one hosted link

Stop downloading screenshots, videos, and raw CI artifacts from GitHub Actions.

This action turns your Playwright CI run into a single shareable debugging link with:

- quick failure diagnosis in CI logs
- a short failure preview in CI and the GitHub job summary
- a hosted debugging report with grouped failures, screenshots, videos, and failure context
- a shareable link for Slack, PRs, and GitHub issues
- public mode with no auth, or workspace mode with `SENTINEL_TOKEN`

Add it after your Playwright step and upload the run in one place.

---

## Why this exists

Debugging Playwright in CI is slow because:

- artifacts are scattered across jobs
- logs don’t tell you what actually failed
- opening screenshots, videos, and raw artifacts is repetitive

This action gives you a single debugging surface instead of digging through CI.

---

## What you see in CI

After your tests run, you’ll get:

```text
Quick diagnosis
  3 tests failed.
  Most common signal: assertion mismatch between expected and rendered UI state.

Uploading hosted debugging report to Sentinel...

Sentinel report

⚠️ 3 tests failed

Failure preview:
getByTestId('checkout-status') showed "Pending" instead of "Saved" before timeout.

👉 Open to investigate root cause
  https://app.sentinelqa.com/share/run/abc123

Repository: sentinelqa-dev/my-app
Workflow: Playwright
Job: e2e
Run: 23364310398 (attempt 2)

Link expires in 48h

Upgrade for free to get full AI debugging suggestions
  https://app.sentinelqa.com/register
```

---

## Quick start

Add this after your Playwright test step:

```yaml
- name: Upload Playwright debug report
  if: always()
  uses: sentinelqa-dev/playwright-ci-debugger@v1
  with:
    project: my-app
    playwright-json-path: test-results/report.json
    playwright-report-dir: playwright-report
    test-results-dir: test-results
```

---

## Recommended workflow

```yaml
name: Playwright

on:
  pull_request:
  push:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps

      - name: Run Playwright
        run: npx playwright test

      - name: Upload Playwright debug report
        if: always()
        uses: sentinelqa-dev/playwright-ci-debugger@v1
        with:
          project: my-app
          playwright-json-path: test-results/report.json
          playwright-report-dir: playwright-report
          test-results-dir: test-results
```

---

## Playwright config (required)

This action needs a Playwright JSON report and works best when Playwright also writes `test-results` and the HTML report directory.

Make sure your Playwright config writes a JSON report:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: [
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/report.json" }],
  ],
  outputDir: "test-results",
});
```

If you already use `@sentinelqa/playwright-reporter`, you're usually already set up.

---

## What the action does

After your Playwright tests finish, this action:

- reads structured Playwright outputs (JSON + test-results)
- collects traces, logs, screenshots, and videos
- uploads everything to Sentinel
- generates a hosted debugging report
- writes a GitHub job summary with the hosted report link
- prints the report link in CI logs
- exposes outputs for reuse in your workflow
- supports public mode with no token or workspace mode with `SENTINEL_TOKEN`

---

## Validation behavior

The action adapts based on available artifacts:

- JSON + `test-results` present → full mode
- JSON present, missing other artifacts → degraded mode
- JSON missing → upload skipped (or fail if configured)

Control behavior with:

```yaml
with:
  fail-on-missing-json: "false"
```

---

## Inputs

- `project` — Sentinel project name
- `fail-on-missing-json` — fail if JSON missing (default: `true`)
- `playwright-json-path` — default: `test-results/report.json`
- `playwright-report-dir` — default: `playwright-report`
- `test-results-dir` — default: `test-results`
- `artifact-dirs` — extra directories to upload

---

## Outputs

- `report-url` — hosted Sentinel report
- `share-url` — public share link
- `first-failure-url` — direct link to first failure
- `mode` — `public` or `workspace`
- `summary` — short failure/upload summary

---

## Public vs workspace mode

- No `SENTINEL_TOKEN` → uploads to a public hosted report
- With `SENTINEL_TOKEN` → uploads to your Sentinel workspace

Public mode is the lowest-friction distribution path:

- no auth required
- shareable hosted debugging link
- conversion CTA into Sentinel workspace setup

---

## Versioning

This action uses a vendored, pinned uploader package inside the repo.

- no dependency on npm `latest`
- stable behavior per action tag
- controlled, explicit uploader upgrades

---

## GitHub context

When the action runs in GitHub Actions, Sentinel receives normal CI context including:

- repository
- workflow name
- job name
- run ID
- run attempt
- commit SHA
- branch
- actor

This keeps hosted runs tied to the correct GitHub execution context and makes shared reports easier to understand.

---

## Example using outputs

```yaml
- name: Upload Playwright debug report
  id: sentinel
  if: always()
  uses: sentinelqa-dev/playwright-ci-debugger@v1
  with:
    project: my-app

- name: Print report URL
  if: always()
  run: echo "Sentinel report: ${{ steps.sentinel.outputs.report-url }}"
```
