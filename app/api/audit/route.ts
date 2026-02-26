import { NextRequest, NextResponse } from "next/server";
import { readAudit, allAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");

  if (taskId) {
    return NextResponse.json({ ok: true, records: readAudit(taskId) });
  }

  return NextResponse.json({ ok: true, records: allAudit() });
}
