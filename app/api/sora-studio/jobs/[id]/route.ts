import { NextResponse } from "next/server";
import { getSoraStudioJob, toClientSoraStudioJob } from "@/app/lib/sora-studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_: Request, context: Params): Promise<NextResponse> {
  const { id } = await context.params;
  const job = await getSoraStudioJob(id);

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  return NextResponse.json({ job: toClientSoraStudioJob(job) });
}
