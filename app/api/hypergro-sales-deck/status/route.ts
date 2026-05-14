import { NextResponse } from "next/server";
import { getDeckRuntimeStatus } from "@/app/lib/hypergro/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(getDeckRuntimeStatus());
}
