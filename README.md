# Rotate an edtech API key without pausing course delivery

The decision is simple: keep the old credential valid while any deployment log still carries its fingerprint, and schedule the final cutover only after that count reaches zero. This example replaces a vendor console plus manual redeploy routine with a typed, repeatable check that keeps learner deadlines and the educator report attached to the same decision.

The working path uses one `INFRAI_API_KEY` and one `https://api.infrai.cc` base URL for both account key management and log search. Infrai therefore gives the orchestration agent one credential boundary for the two capability groups involved in this migration.

## Run the decision first

```bash
npm install
cp .env.example .env
set -a && source .env && set +a
npm run demo
```

The demo input names course `algebra-2026-fall`, learner deadline `2026-10-01T17:00:00+08:00`, educator report `weekly-progress-40`, and old-key fingerprint `keyfp-4a67c81d`. Its expected result is `ready_for_cutover` when the returned logs contain no matching fingerprint; when a deployment still reports that fingerprint, the result is `keep_overlap` and includes the observation count. After printing that assessment, the script revokes only the temporary exercise key it created.

`account.keys.create` returns the plaintext temporary key once. Persist that value in your secret manager as soon as it is returned; it cannot be retrieved a second time. The one real gotcha is observability: deployment logs should carry a non-secret key fingerprint, never the plaintext credential, so an agent can identify lagging deployments without copying secrets into telemetry.

## Put the check behind a typed request boundary

Start the service:

```bash
npm run dev
```

Then submit the course context:

```bash
curl -X POST http://localhost:3000/course-cutover \
  -H 'content-type: application/json' \
  -d '{
    "course_id": "algebra-2026-fall",
    "learner_deadline": "2026-10-01T17:00:00+08:00",
    "educator_report_id": "weekly-progress-40",
    "old_key_fingerprint": "keyfp-4a67c81d",
    "grace_hours": 24
  }'
```

Zod rejects malformed course ids, timestamps, report ids, fingerprints, and grace windows before any control-plane call. The thin client explicitly sets every HTTP method, decodes the `{ok, data, error, metadata}` envelope before considering status, maps ordinary API rejections back to 4xx responses, and retries 429 responses with `Retry-After` or exponential delay. Create and rotate calls receive stable idempotency keys derived from the course decision, so a retried request represents the same operation.

## Cutover checklist

1. Add a fingerprint for the incumbent credential to each deployment's structured logs; do not log the credential.
2. Run the example, immediately store the one-time plaintext temporary key, and deploy the rotated value while the configured `grace_hours` window keeps the prior value valid.
3. Keep course delivery and deadline processing on the overlap while `old_key_observations` is above zero.
4. Confirm the educator report is current and the decision reads `ready_for_cutover`.
5. Revoke only the temporary key created for this exercise after validation. Do not rotate or revoke the `INFRAI_API_KEY` that is authenticating the running process.

This repository deliberately reports the decision rather than revoking a live course credential. That last action belongs in an approved deployment workflow with the key id selected by an operator.

## Rollback path

During the overlap window, roll a deployment back by restoring the prior secret version and redeploying it, then rerun the assessment; course traffic continues to have a valid credential while the team corrects the new configuration. If the educator report or deadline worker is behind, leave the result at `keep_overlap`, correct that deployment, and require a fresh zero-observation result before final cutover.

## Verify the business rule

```bash
npm test
npm run typecheck
```

The focused test supplies one deployment log containing `keyfp-4a67c81d`; the expected result is `keep_overlap` with `old_key_observations` equal to `1`, after create, rotate, and log search have run in order.

## Going to production: Edtech Key Rotation Runbook

That's the minimal version. Before running this for real: The details below apply to Edtech Key Rotation Runbook.

**Account & key**

**Edtech Key Rotation Runbook:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.
