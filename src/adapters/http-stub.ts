import { existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { loadAgentDefinition } from "../load.js";
import { isDirectRun, projectRoot } from "../root.js";
import { runAgent } from "../runner.js";

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export async function handleHttp(
  request: { method: string; url: string; bodyText?: string },
  options?: { root?: string }
): Promise<HttpResponse> {
  const root = options?.root ?? projectRoot();
  const method = request.method.toUpperCase();
  let pathname = "/";
  try {
    pathname = new URL(request.url, "http://127.0.0.1").pathname;
  } catch {
    return json(400, { error: "Invalid URL." });
  }

  if (method === "GET" && pathname === "/health") {
    return json(200, { ok: true, service: "passportkit", adapter: "http-stub" });
  }

  const agentMatch = /^\/v1\/agents\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(pathname);
  const runMatch = /^\/v1\/agents\/([a-z0-9]+(?:-[a-z0-9]+)*)\/runs$/.exec(pathname);
  const agentId = agentMatch?.[1] ?? runMatch?.[1];

  if (!agentId) return json(404, { error: "Not found." });
  if (agentMatch && method !== "GET") return json(405, { error: "Method not allowed." });
  if (runMatch && method !== "POST") return json(405, { error: "Method not allowed." });

  if (!existsSync(path.join(root, "agents", agentId, "agent.json"))) {
    return json(404, { error: "Unknown agent." });
  }

  if (method === "GET") {
    try {
      return json(200, loadAgentDefinition(root, agentId));
    } catch (error) {
      return json(500, { error: error instanceof Error ? error.message : "Could not load agent." });
    }
  }

  const bodyText = request.bodyText ?? "";
  if (bodyText.length > 16_384) return json(413, { error: "Request body is too large." });

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as unknown;
  } catch {
    return json(400, { error: "Request body must be JSON." });
  }
  if (!parsed || typeof parsed !== "object" || !("company" in parsed) || typeof parsed.company !== "string") {
    return json(400, { error: "JSON body must include a string company field." });
  }

  try {
    const result = await runAgent({ agentId, input: { company: parsed.company }, root });
    return json(200, result);
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : "Runner failed." });
  }
}

export function startHttpServer(port = 0, root?: string): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      if (Buffer.concat(chunks).length > 16_384) break;
    }
    const bodyText = Buffer.concat(chunks).toString("utf8");
    const result = await handleHttp(
      { method: req.method ?? "GET", url: req.url ?? "/", bodyText },
      root ? { root } : {}
    );
    res.writeHead(result.status, result.headers);
    res.end(`${JSON.stringify(result.body, null, 2)}\n`);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("HTTP stub did not bind a TCP port."));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          })
      });
    });
  });
}

function json(status: number, body: unknown): HttpResponse {
  return { status, headers: JSON_HEADERS, body };
}

if (isDirectRun(import.meta.url)) {
  const port = Number(process.env.PASSPORTKIT_PORT ?? "47821");
  startHttpServer(Number.isInteger(port) && port > 0 ? port : 47821)
    .then((server) => {
      console.log(`PassportKit HTTP stub listening on http://127.0.0.1:${server.port}`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}