import { NextResponse } from "next/server";
import { getRun, repairRunOutputs, toClientRun } from "@/app/lib/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  await repairRunOutputs(id);
  const run = await getRun(id);
  if (!run) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }
  return NextResponse.json({ run: await toClientRun(run) });
}
