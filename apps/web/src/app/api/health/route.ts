export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      status: "ok",
      service: "traceforge-web"
    },
    {
      headers: {
        "cache-control": "no-store"
      }
    }
  );
}
