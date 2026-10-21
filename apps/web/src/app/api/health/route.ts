import { loadTraceForgeApiConfig } from "@/lib/traceforge-api/config";

export const dynamic = "force-dynamic";

export async function GET() {
  let backend: Record<string, unknown> | null = null;
  let databaseReady: boolean | null = null;
  let extractor: string | null = null;
  try {
    const config = loadTraceForgeApiConfig();
    const response = await fetch(`${config.baseUrl}/healthz`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (response.ok) {
      backend = (await response.json()) as Record<string, unknown>;
      const checks = (backend.checks ?? {}) as Record<string, unknown>;
      if (typeof checks.extractor === "string") extractor = checks.extractor;
      if (typeof checks.database === "boolean") databaseReady = checks.database;
    }
    // Older API builds expose only { status: "ok" } at /healthz.
    // Verify the authenticated query path so a healthy response also proves DB access.
    if (backend?.status === "ok" && databaseReady === null) {
      const probe = await fetch(`${config.baseUrl}/api/v1/verification/overview`, {
        headers: { authorization: `Bearer ${config.token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      databaseReady = probe.ok;
    }
  } catch {
    // Preserve a successful health response if only the database probe timed out.
  }
  const checks = (backend?.checks ?? {}) as Record<string, unknown>;
  const backendReady = checks.backend === true || backend?.status === "ok";
  const dbReady = typeof checks.database === "boolean" ? checks.database : databaseReady;
  return Response.json(
    {
      checks: {
        frontend: true,
        backend: backendReady,
        llm: typeof checks.llm === "boolean" ? checks.llm : null,
        extraction: typeof checks.extraction === "boolean" ? checks.extraction : null,
        database: dbReady,
        extractor,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
