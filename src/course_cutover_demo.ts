import {
  InfraiClient,
  INFRAI_BASE_URL,
} from "./infrai_control_plane.js";
import { assessCourseCutover } from "./course_cutover.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before running the demo");

const client = new InfraiClient(apiKey, INFRAI_BASE_URL);
const result = await assessCourseCutover(
  {
    course_id: "algebra-2026-fall",
    learner_deadline: "2026-10-01T17:00:00+08:00",
    educator_report_id: "weekly-progress-40",
    old_key_fingerprint: "keyfp-4a67c81d",
    grace_hours: 24,
  },
  client,
);

console.log(JSON.stringify(result, null, 2));
await client.revokeTemporaryKey(result.rotated_key_id);
if (result.temporary_key_id !== result.rotated_key_id) {
  await client.revokeTemporaryKey(result.temporary_key_id);
}
console.log(`Revoked exercise keys ${result.temporary_key_id} and ${result.rotated_key_id}`);
