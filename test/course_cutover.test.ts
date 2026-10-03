import assert from "node:assert/strict";
import test from "node:test";
import { assessCourseCutover } from "../src/course_cutover.js";
import type { RotationGateway } from "../src/infrai_control_plane.js";

test("keeps the overlap while a course deployment reports the old key fingerprint", async () => {
  const calls: string[] = [];
  const gateway: RotationGateway = {
    async createTemporaryKey(input) {
      calls.push(`create:${input.idempotency_key}`);
      return { id: "temp-key-17", key: "one-time-created-value" };
    },
    async rotateTemporaryKey(id, input) {
      calls.push(`rotate:${id}:${input.grace_hours}`);
      return { id, key: "one-time-rotated-value" };
    },
    async searchLogs() {
      calls.push("search");
      return { entries: [{ deployment: "course-api-east", key_fingerprint: "keyfp-4a67c81d" }] };
    },
    async revokeTemporaryKey(id) {
      calls.push(`revoke:${id}`);
    },
  };

  const result = await assessCourseCutover(
    {
      course_id: "algebra-2026-fall",
      learner_deadline: "2026-10-01T17:00:00+08:00",
      educator_report_id: "weekly-progress-40",
      old_key_fingerprint: "keyfp-4a67c81d",
      grace_hours: 24,
    },
    gateway,
  );

  assert.equal(result.action, "keep_overlap");
  assert.equal(result.old_key_observations, 1);
  assert.deepEqual(calls.map((call) => call.split(":")[0]), ["create", "rotate", "search"]);
});
