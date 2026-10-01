import { ConfigError, getEnv, type Env } from "./env.js";

/** Headers every response from this service carries. */
export function baseHeaders(extra?: ConstructorParameters<typeof Headers>[0]): Headers {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  return headers;
}

export function json(body: unknown, status = 200): Response {
  const headers = baseHeaders({ "Content-Type": "application/json; charset=utf-8" });
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorJson(error: string, status: number): Response {
  return json({ error }, status);
}

/**
 * Load configuration, or return the response to send instead. Only the name of
 * a missing variable is ever logged, never a value.
 */
export function loadEnv(onError: () => Response): Env | Response {
  try {
    return getEnv();
  } catch (error) {
    if (error instanceof ConfigError) console.error(`[auth] ${error.message}`);
    else console.error("[auth] unexpected configuration error");
    return onError();
  }
}

export type BodyErrorCode = "too_large" | "bad_type" | "bad_json";

export class BodyError extends Error {
  readonly code: BodyErrorCode;
  constructor(code: BodyErrorCode) {
    super(`request body ${code}`);
    this.name = "BodyError";
    this.code = code;
  }
}

export const MAX_BODY_BYTES = 2048;

/** Read a small JSON body, refusing anything large or not declared as JSON. */
export async function readJsonBody(request: Request, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!type.startsWith("application/json")) throw new BodyError("bad_type");

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyError("too_large");

  if (!request.body) throw new BodyError("bad_json");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new BodyError("too_large");
    }
    chunks.push(value);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BodyError("bad_json");
  }
}

export function bodyErrorResponse(error: unknown): Response {
  if (error instanceof BodyError) {
    if (error.code === "too_large") return errorJson("too_large", 413);
    if (error.code === "bad_type") return errorJson("unsupported_media_type", 415);
  }
  return errorJson("bad_request", 400);
}

/**
 * Cheap noise filter: the app sends `User-Agent: ValorPredict/<version>`.
 * This is NOT authentication (anyone can set a header). Real protection is that
 * /redeem and /refresh need a valid code or refresh token, plus rate limiting.
 */
export function requireClient(request: Request): Response | null {
  const agent = request.headers.get("user-agent") ?? "";
  return agent.startsWith("ValorPredict/") ? null : errorJson("forbidden", 403);
}
