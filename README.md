# Playwright CI Debugger

Debug Playwright CI failures with a shareable link — no artifact downloads.

When Playwright fails in GitHub Actions, this action helps you upload the run and open a hosted debugging page with:

- failed tests across jobs
- traces
- screenshots
- videos
- logs
- grouped failures
- quick failure context

Instead of downloading artifacts manually, you get one link you can open or share in Slack, PRs, and GitHub issues.

## Why use this

Debugging Playwright in CI is usually slow because artifacts are scattered across jobs.

This action gives you a hosted debugging link so you can inspect failures from one place.

Best for:
- flaky Playwright failures
- parallel CI jobs
- debugging across traces, screenshots, and logs
- sharing failures with teammates

## What the action does

- validates Playwright artifact paths after your test run
- uploads failed run data to Sentinel
- prints a hosted debugging link in workflow logs
- exposes the run URL as an action output
- writes the report URL into the GitHub job summary

## How it works

This action is a post-processing step for GitHub Actions.

It does not run Playwright for you.

The intended pattern is:

1. your Playwright test step runs first
2. this action runs afterward with `if: always()`
3. the action reads files already produced by Playwright
4. it uploads them to Sentinel
5. it prints the hosted report link, sets outputs, and updates the job summary

The Playwright JSON report is the main source of truth.

## Validation behavior

The action has explicit behavior depending on what files exist:

- JSON report present + `test-results` present
  full upload mode
- JSON report present but HTML report or `test-results` missing
  degraded upload mode
- JSON report missing
  upload is skipped with a precise message

By default, missing JSON fails the action. You can relax that with:

```yaml
with:
  fail-on-missing-json: "false"
```

## Quick start

Add this after your Playwright test step:

```yaml
- name: Upload Playwright debug report
  if: always()
  uses: sentinelqa/playwright-ci-debugger@v1
  with:
    project: my-app
    playwright-report-dir: playwright-report
    test-results-dir: test-results
```

## Recommended workflow

This action works best when your Playwright run writes:

- an HTML report directory
- a JSON report file
- the normal `test-results` directory

Example workflow:

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

## Playwright config

Make sure your Playwright config writes a JSON report file. For example:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: [
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/report.json" }]
  ],
  outputDir: "test-results"
});
```

If you already use `@sentinelqa/playwright-reporter`, these defaults already line up with the hosted Sentinel flow.

## Inputs

- `project`
  Sentinel project name shown in the hosted report.
- `fail-on-missing-json`
  Fail the action if the Playwright JSON report is missing.
  Default: `true`
- `playwright-json-path`
  Path to the Playwright JSON report.
  Default: `playwright-report/report.json`
- `playwright-report-dir`
  Path to the Playwright HTML report directory.
  Default: `playwright-report`
- `test-results-dir`
  Path to the Playwright test results directory.
  Default: `test-results`
- `artifact-dirs`
  Newline or comma separated extra artifact directories to upload.

## Outputs

- `report-url`
  Hosted Sentinel report URL.
- `share-url`
  Hosted public share URL when available.
- `first-failure-url`
  Hosted first-failure URL when available.
- `mode`
  `public` or `workspace`
- `summary`
  Short upload summary

## Public vs workspace mode

No auth is required for the default public flow.

- no `SENTINEL_TOKEN`
  uploads to a public hosted report
- `SENTINEL_TOKEN` set
  uploads into your Sentinel workspace

The action prints the same hosted link style as the Playwright reporter flow and also writes the report URL into the GitHub job summary.

## Versioning

This action uses a vendored, pinned Sentinel uploader package inside the repo instead of downloading `@sentinelqa/uploader@latest` at runtime.

That means:

- action behavior is stable for a given tag
- GitHub runs do not depend on npm registry resolution for the uploader
- uploader upgrades are explicit and reviewed

## GitHub metadata

When the action runs in GitHub Actions, Sentinel receives the normal GitHub CI context through the uploader flow, including:

- repository
- workflow name
- job name
- run ID
- run attempt
- commit SHA
- branch
- actor

That keeps hosted runs tied to the correct GitHub execution context.

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
