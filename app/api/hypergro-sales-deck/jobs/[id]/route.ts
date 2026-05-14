import { NextResponse } from "next/server";
import { getDeckJob, toClientDeckJob } from "@/app/lib/hypergro/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_: Request, context: Params): Promise<NextResponse> {
  const { id } = await context.params;
  const job = await getDeckJob(id);

  if (!job) {
    return NextResponse.json({ error: "Deck job not found." }, { status: 404 });
  }

  return NextResponse.json({ job: toClientDeckJob(job) });
}
