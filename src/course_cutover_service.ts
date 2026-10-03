import { createServer } from "node:http";
import { ZodError } from "zod";
import {
  InfraiClient,
  InfraiError,
  INFRAI_BASE_URL,
} from "./infrai_control_plane.js";
import { assessCourseCutover, cutoverRequestSchema } from "./course_cutover.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

const infrai = new InfraiClient(apiKey, INFRAI_BASE_URL);
const port = Number(process.env.PORT ?? 3000);

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function reply(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body, null, 2));
}

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/course-cutover") {
    reply(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const input = cutoverRequestSchema.parse(await readJson(request));
    reply(response, 200, await assessCourseCutover(input, infrai));
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      reply(response, 400, { error: "Invalid request body" });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      reply(response, status, { error: error.message, details: error.details });
      return;
    }
    reply(response, 500, { error: "Unexpected service error" });
  }
}).listen(port, () => {
  console.log(`Course cutover service listening on http://localhost:${port}`);
});
