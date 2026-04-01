# FirePan Integration Guide (SnowMind)

Last updated: 2026-04-01

This repository is wired for FirePan CI scanning via:
- .firepan.yml
- .github/workflows/security-firepan.yml

## 1) One-time GitHub setup

1. Install FirePan GitHub app
- URL: https://github.com/apps/firepan-ai
- Install on the SnowMind repository.

2. Add repository secret
- Secret name: FIREPAN_API_KEY
- Location: GitHub -> Settings -> Secrets and variables -> Actions.

3. Enable branch protection
- Require status check: FirePan Security Scan
- Apply to branches: main, dev

## 2) CI behavior

Workflow: .github/workflows/security-firepan.yml

- Runs on push and pull_request for main and dev.
- Triggers FirePan scan through the FirePan API (`POST /v1/scans`) and polls completion (`GET /v1/scans/{scan_id}`).
- Fails build on high and critical findings.
- Uploads SARIF to GitHub Security tab when SARIF payload is returned.
- If FIREPAN_API_KEY is missing, workflow fails fast.

## 3) Scan scope and policy

Config: .firepan.yml

- Included paths:
  - contracts/src/
  - contracts/script/
- Excluded paths:
  - contracts/lib/
  - contracts/cache/
  - contracts/broadcast/
  - contracts/test/
- Thresholds:
  - report_threshold: low
  - fail_threshold: high

## 4) Local verification (optional)

Reference docs:
- https://docs.firepan.com/quickstart
- https://docs.firepan.com/guides/cli-reference

Typical local flow:
1. firepan login
2. firepan scan ./contracts --format md -o firepan-local.md

## 5) Audit gate checklist

Before release:
1. FirePan scan passes on target SHA.
2. No open high/critical findings without signed exception.
3. SARIF findings reviewed in GitHub Security tab.
4. External manual audit findings mapped to commits and retested.
