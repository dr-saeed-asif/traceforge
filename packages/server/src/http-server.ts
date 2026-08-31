import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { TraceForgeApi } from "@traceforge/api";

export interface HttpServerOptions {
  readonly host: string;
  readonly port: number;
  readonly maxBodyBytes: number;
}

export function createTraceForgeHttpServer(api: Pick<TraceForgeApi, "handle">, options: HttpServerOptions): Server {
  return createServer(async (incoming, outgoing) => {
    try {
      if (incoming.url === "/healthz") {
        write(outgoing, Response.json({ status: "ok" }, { status: 200, headers: { "cache-control": "no-store" } }));
        return;
      }
      const request = await nodeRequest(incoming, options, options.maxBodyBytes);
      write(outgoing, await api.handle(request));
    } catch (error) {
      const status = error instanceof BodyLimitError ? 413 : 500;
      write(outgoing, Response.json({ error: { code: status === 413 ? "BODY_TOO_LARGE" : "HTTP_ADAPTER_ERROR", message: status === 413 && error instanceof Error ? error.message : "HTTP request processing failed" } }, { status }));
    }
  });
}

export function listen(server: Server, options: Pick<HttpServerOptions, "host" | "port">): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port, options.host);
  });
}

export function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function nodeRequest(incoming: IncomingMessage, options: Pick<HttpServerOptions, "host" | "port">, maxBodyBytes: number): Promise<Request> {
  const origin = `http://${incoming.headers.host ?? `${options.host}:${options.port}`}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  const method = incoming.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : await readBody(incoming, maxBodyBytes);
  return new Request(new URL(incoming.url ?? "/", origin), { method, headers, ...(body ? { body } : {}) });
}

async function readBody(request: IncomingMessage, maxBodyBytes: number): Promise<Uint8Array | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += bytes.byteLength;
    if (size > maxBodyBytes) throw new BodyLimitError(`Request body exceeds ${maxBodyBytes} bytes`);
    chunks.push(bytes);
  }
  return size === 0 ? undefined : Buffer.concat(chunks);
}

function write(outgoing: ServerResponse, response: Response): void {
  response.arrayBuffer().then((body) => {
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    outgoing.end(Buffer.from(body));
  }).catch(() => {
    if (!outgoing.headersSent) outgoing.writeHead(500, { "content-type": "application/json" });
    outgoing.end('{"error":{"code":"RESPONSE_WRITE_FAILED","message":"Response serialization failed"}}');
  });
}

class BodyLimitError extends Error {}
