# Playwright CI Debugger

## Debug Playwright CI failures instantly

Stop downloading traces, screenshots, and logs from GitHub Actions.

This action turns your Playwright CI run into a single shareable debugging link with:

- AI root-cause summary of failed tests
- All artifacts in one place (trace, logs, screenshots, video)
- Run-to-run diff to see what changed
- Shareable report for Slack, PRs, and GitHub issues

Add it in 30 seconds. No changes to your Playwright tests.

---

## Why this exists

Debugging Playwright in CI is slow because:

- artifacts are scattered across jobs
- logs don’t tell you what actually failed
- comparing runs is manual and painful

This action gives you a single debugging surface instead of digging through CI.

---

## What you see in CI

After your tests run, you’ll get:

```text
Sentinel Debug Report

Root cause:
Test "checkout flow" timed out because /api/cart returned 500

Full report:
https://sentinelqa.com/run/abc123

Compare with last passing run:
https://sentinelqa.com/run/xyz789
```

---

## Quick start

Add this after your Playwright test step:

```yaml
- name: Upload Playwright debug report
  if: always()
  uses: sentinelqa/playwright-ci-debugger@v1
  with:
    project: my-app
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
        uses: sentinelqa/playwright-ci-debugger@v1
        with:
          project: my-app
          playwright-json-path: test-results/report.json
          playwright-report-dir: playwright-report
          test-results-dir: test-results
```

---

## Playwright config (required)

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

If you already use `@sentinelqa/playwright-reporter`, you're already set up.

---

## What the action does

After your Playwright tests finish, this action:

- reads structured Playwright outputs (JSON + test-results)
- collects traces, logs, screenshots, and videos
- uploads everything to Sentinel
- generates a hosted debugging report
- prints the report link in CI logs
- writes the link to the GitHub job summary
- exposes outputs for reuse in your workflow

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
- `summary` — AI-generated root-cause summary

---

## Public vs workspace mode

- No `SENTINEL_TOKEN` → uploads to a public hosted report
- With `SENTINEL_TOKEN` → uploads to your Sentinel workspace

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

This keeps hosted runs tied to the correct GitHub execution context and enables better run tracking and diffing.

---

## Example using outputs

```yaml
- name: Upload Playwright debug report
  id: sentinel
  if: always()
  uses: sentinelqa/playwright-ci-debugger@v1
  with:
    project: my-app

- name: Print report URL
  if: always()
  run: echo "Sentinel report: ${{ steps.sentinel.outputs.report-url }}"
```
