import { NextResponse } from "next/server";
import { getLinkedInConnectionStatus } from "@/lib/publishers";

export const runtime = "nodejs";

export async function GET() {
  const status = await getLinkedInConnectionStatus();

  return NextResponse.json(status, {
    headers: { "Cache-Control": "no-store" },
  });
}
