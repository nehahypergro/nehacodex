import { NextResponse } from "next/server";
import { getJob, toClientJob } from "@/app/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_: Request, context: Params): Promise<NextResponse> {
  const { id } = await context.params;
  const job = await getJob(id);

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  return NextResponse.json({ job: toClientJob(job) });
}
