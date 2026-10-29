import { NextRequest, NextResponse } from "next/server";
import { loadTraceForgeApiConfig } from "@/lib/traceforge-api/config";
import { parseAnchorLookupResponse } from "@traceforge/verification-contracts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = new URLSearchParams();
  for (const key of ["sessionHash", "manifestHash"]) {
    const value = request.nextUrl.searchParams.get(key);
    if (value !== null) {
      if (!/^0x[0-9a-f]{64}$/i.test(value.trim()))
        return NextResponse.json(
          { error: "Enter a valid 32-byte hexadecimal hash." },
          { status: 400 }
        );
      params.set(key, value.trim().toLowerCase());
    }
  }
  if (!params.size)
    return NextResponse.json({ error: "Enter a sessionHash or manifestHash." }, { status: 400 });
  const index = request.nextUrl.searchParams.get("claimIndex");
  if (index !== null) {
    if (!/^\d+$/.test(index) || !Number.isSafeInteger(Number(index)) || Number(index) < 1)
      return NextResponse.json({ error: "Invalid claim index." }, { status: 400 });
    params.set("claimIndex", index);
  }
  try {
    const config = loadTraceForgeApiConfig();
    const response = await fetch(`${config.baseUrl}/api/v1/verification/anchor-lookup?${params}`, {
      headers: { authorization: `Bearer ${config.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(config.timeoutMs)
    });
    if (!response.ok)
      return NextResponse.json(
        {
          error:
            response.status === 404
              ? "Hash lookup is unavailable. Restart the TraceForge API to apply the latest update."
              : "Hash lookup failed. Check the TraceForge API."
        },
        { status: 502 }
      );
    return NextResponse.json(parseAnchorLookupResponse(await response.json()));
  } catch {
    return NextResponse.json(
      { error: "Hash lookup is unavailable. Check the TraceForge API and try again." },
      { status: 502 }
    );
  }
}
