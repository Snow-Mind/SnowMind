# SnowMind Ops Simple Checklist

Last updated: 2026-04-01

This guide is intentionally simple and action-focused.

## 1) Confirm KMS is really active

### Fast check (service auth endpoint)

Call:
- `GET /api/v1/health/session-key-encryption?sample_rows=200`

Headers:
- `X-API-Key: <BACKEND_API_KEY>`

Expected:
- `probe.expected_mode = "kms"`
- `probe.actual_mode = "kms"`
- `probe.mode_ok = true`
- `probe.roundtrip_ok = true`
- `session_key_rows.stats.kms_v1` should grow over time

If `probe.actual_mode = "local"` while KMS is configured, stop and fix AWS/KMS credentials before continuing.

### Script check (inside backend runtime env)

Run:
- `python -m app.scripts.check_session_key_encryption_mode --sample-rows 200`

Expected exit code:
- `0` means mode is healthy.
- `1` means mode mismatch, probe failure, or env misconfiguration.

## 2) Switch from local session-key encryption to KMS

1. Set env vars in backend runtime:
- `KMS_KEY_ID`
- `AWS_REGION` (or `AWS_DEFAULT_REGION`)
- AWS credential source (`AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`, or IAM role/web identity)

2. Keep `SESSION_KEY_ENCRYPTION_KEY` set during migration window only.
- This allows decrypting old local blobs while rewrapping to KMS.

3. Deploy backend.

4. Dry-run migration:
- `python -m app.scripts.rewrap_session_keys_to_kms --dry-run`

5. Execute migration:
- `python -m app.scripts.rewrap_session_keys_to_kms --limit 10000`

6. Verify with endpoint/script from section 1.

7. Optional hardening after all rows are KMS envelopes:
- Remove `SESSION_KEY_ENCRYPTION_KEY` from production env.

## 3) Enforce GitHub checks + FirePan secret

### Repo secrets
Add repository secret:
- `FIREPAN_API_KEY`

### Branch protection (for `main` and `dev`)
Require status checks to pass before merge:
- `Lint Frontend`
- `Build Frontend`
- `Test Backend`
- `Test Contracts`
- `FirePan Security Scan`

Notes:
- Workflow [security-firepan.yml](../.github/workflows/security-firepan.yml) now fails if `FIREPAN_API_KEY` is missing.

## 4) Verify Sentry ingestion in deployed environment

1. Ensure backend has `SENTRY_DSN` configured.
2. Call:
- `POST /api/v1/health/sentry-test`
- Header: `X-API-Key: <BACKEND_API_KEY>`
3. Confirm event appears in Sentry Issues within a few minutes.
4. Add alerts in Sentry for:
- Error spike
- P95 latency
- Scheduler health anomaly

## 5) Continue staged Python dependency upgrades

Do upgrades in small waves, not all at once.

### Wave A (low risk)
- Test tooling and small libraries first.
- Run unit tests and integration tests.

### Wave B (framework patch/minor)
- FastAPI/Starlette/Uvicorn/Pydantic family in one controlled PR.
- Run full backend tests and smoke test all API routes.

### Wave C (web3/supabase stack)
- `web3`, `supabase`, related adapters in a dedicated PR.
- Run fork tests + execution smoke tests before rollout.

For every wave:
1. Update lockfile.
2. Run `uv run pytest tests/ -v`.
3. Deploy to staging.
4. Validate scheduler + rebalance + withdrawal paths.
5. Promote to production only after clean logs.
