import { createTraceForgeApiClient } from "@/lib/traceforge-api";
import { NextRequest, NextResponse } from "next/server";
import type { VerificationListQuery } from "@traceforge/verification-contracts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  let limit: number | undefined;
  const limitParam = searchParams.get("limit");
  if (limitParam !== null && limitParam !== "") {
    const parsed = parseInt(limitParam, 10);
    if (!Number.isNaN(parsed)) limit = parsed;
  }

  let offset: number | undefined;
  const offsetParam = searchParams.get("offset");
  if (offsetParam !== null && offsetParam !== "") {
    const parsed = parseInt(offsetParam, 10);
    if (!Number.isNaN(parsed)) offset = parsed;
  }

  let startedAfter: string | undefined;
  const startedAfterParam = searchParams.get("startedAfter");
  if (startedAfterParam !== null && startedAfterParam !== "") {
    startedAfter = startedAfterParam;
  }

  let startedBefore: string | undefined;
  const startedBeforeParam = searchParams.get("startedBefore");
  if (startedBeforeParam !== null && startedBeforeParam !== "") {
    startedBefore = startedBeforeParam;
  }

  const cleanQuery: VerificationListQuery = {
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(startedAfter !== undefined ? { startedAfter } : {}),
    ...(startedBefore !== undefined ? { startedBefore } : {})
  };

  try {
    const response = await createTraceForgeApiClient().getSessionDays(cleanQuery);
    return NextResponse.json(response);
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json({ error: "Failed to fetch sessions" }, { status: 500 });
  }
}
