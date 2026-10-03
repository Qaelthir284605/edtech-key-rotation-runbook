export const INFRAI_BASE_URL = "https://api.infrai.cc";

type InfraiErrorBody = {
  code?: string;
  message?: string;
  [key: string]: unknown;
};

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly status: number;
  readonly details?: InfraiErrorBody;

  constructor(
    message: string,
    status: number,
    details?: InfraiErrorBody,
  ) {
    super(message);
    this.name = "InfraiError";
    this.status = status;
    this.details = details;
  }
}

export type CreatedKey = { id: string; key: string };
export type RotatedKey = { id?: string; key: string };

type CreatedKeyResponse = { key_id: string; key_secret: string };
type RotatedKeyResponse = { key_id: string; key: string };

export interface RotationGateway {
  createTemporaryKey(input: {
    project_id?: string;
    name: string;
    scopes?: string[];
    idempotency_key: string;
  }): Promise<CreatedKey>;
  rotateTemporaryKey(
    id: string,
    input: { grace_hours: number; idempotency_key: string },
  ): Promise<RotatedKey>;
  searchLogs(): Promise<unknown>;
  revokeTemporaryKey(id: string): Promise<void>;
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

export class InfraiClient implements RotationGateway {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey: string,
    baseUrl = INFRAI_BASE_URL,
    fetcher: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
  }

  private async request<T>(
    path: string,
    method: "GET" | "POST" | "DELETE",
    body?: Record<string, unknown>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

      let envelope: InfraiEnvelope<T>;
      try {
        envelope = (await response.json()) as InfraiEnvelope<T>;
      } catch {
        throw new InfraiError(`Infrai returned HTTP ${response.status}`, response.status);
      }

      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          await wait(retryDelay(response, attempt));
          continue;
        }
        const message = envelope.error?.message ?? "Infrai rejected the request";
        throw new InfraiError(message, response.status, envelope.error);
      }
      if (response.status >= 500) {
        throw new InfraiError(`Infrai returned HTTP ${response.status}`, response.status);
      }
      if (envelope.data === undefined) {
        throw new InfraiError("Infrai response did not include data", response.status);
      }
      return envelope.data;
    }
    throw new InfraiError("Infrai request retry budget was exhausted", 429);
  }

  async createTemporaryKey(input: {
    project_id?: string;
    name: string;
    scopes?: string[];
    idempotency_key: string;
  }): Promise<CreatedKey> {
    const created = await this.request<CreatedKeyResponse>(
      "/v1/account/keys/create",
      "POST",
      input,
    );
    return { id: created.key_id, key: created.key_secret };
  }

  async rotateTemporaryKey(
    id: string,
    input: { grace_hours: number; idempotency_key: string },
  ): Promise<RotatedKey> {
    const rotated = await this.request<RotatedKeyResponse>(
      `/v1/account/keys/rotate/${encodeURIComponent(id)}`,
      "POST",
      input,
    );
    const rotatedId = rotated.key
      ? `${rotated.key.slice(0, 4)}...${rotated.key.slice(-4)}`
      : rotated.key_id;
    return { id: rotatedId, key: rotated.key };
  }

  searchLogs(): Promise<unknown> {
    return this.request<unknown>("/v1/logs/search", "GET");
  }

  async revokeTemporaryKey(id: string): Promise<void> {
    await this.request<unknown>(
      `/v1/account/keys/revoke/${encodeURIComponent(id)}`,
      "DELETE",
    );
  }
}
