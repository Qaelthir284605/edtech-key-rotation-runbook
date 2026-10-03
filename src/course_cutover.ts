import { createHash } from "node:crypto";
import { z } from "zod";
import type { RotationGateway } from "./infrai_control_plane.js";

export const cutoverRequestSchema = z.object({
  course_id: z.string().min(1),
  learner_deadline: z.string().datetime({ offset: true }),
  educator_report_id: z.string().min(1),
  old_key_fingerprint: z.string().min(8),
  grace_hours: z.number().int().min(1).max(168),
  project_id: z.string().min(1).optional(),
});

export type CutoverRequest = z.infer<typeof cutoverRequestSchema>;

export type CutoverDecision = {
  course_id: string;
  learner_deadline: string;
  educator_report_id: string;
  temporary_key_id: string;
  rotated_key_id: string;
  temporary_key: string;
  rotated_key: string;
  grace_hours: number;
  old_key_observations: number;
  action: "keep_overlap" | "ready_for_cutover";
  educator_summary: string;
};

function containsFingerprint(value: unknown, fingerprint: string): number {
  if (typeof value === "string") return value.includes(fingerprint) ? 1 : 0;
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + containsFingerprint(item, fingerprint), 0);
  }
  if (value && typeof value === "object") {
    return Object.values(value).reduce(
      (sum, item) => sum + containsFingerprint(item, fingerprint),
      0,
    );
  }
  return 0;
}

function operationId(request: CutoverRequest): string {
  return createHash("sha256")
    .update(`${request.course_id}:${request.educator_report_id}:${request.old_key_fingerprint}`)
    .digest("hex")
    .slice(0, 24);
}

export async function assessCourseCutover(
  request: CutoverRequest,
  infrai: RotationGateway,
): Promise<CutoverDecision> {
  const id = operationId(request);
  const created = await infrai.createTemporaryKey({
    ...(request.project_id ? { project_id: request.project_id } : {}),
    name: `course-cutover-${request.course_id}`,
    scopes: ["logs:read"],
    idempotency_key: `${id}-create`,
  });
  const rotated = await infrai.rotateTemporaryKey(created.id, {
    grace_hours: request.grace_hours,
    idempotency_key: `${id}-rotate`,
  });
  const logs = await infrai.searchLogs();
  const observations = containsFingerprint(logs, request.old_key_fingerprint);
  const action = observations === 0 ? "ready_for_cutover" : "keep_overlap";

  return {
    course_id: request.course_id,
    learner_deadline: request.learner_deadline,
    educator_report_id: request.educator_report_id,
    temporary_key_id: created.id,
    rotated_key_id: rotated.id ?? created.id,
    temporary_key: created.key,
    rotated_key: rotated.key,
    grace_hours: request.grace_hours,
    old_key_observations: observations,
    action,
    educator_summary:
      action === "ready_for_cutover"
        ? "No deployment log carries the old fingerprint; schedule the final cutover."
        : `${observations} deployment log entries still carry the old fingerprint; retain the overlap.`,
  };
}
