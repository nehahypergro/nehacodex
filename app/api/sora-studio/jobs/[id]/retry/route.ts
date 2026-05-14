import { NextResponse } from "next/server";
import { getSoraStudioJob, toClientSoraStudioJob } from "@/app/lib/sora-studio/store";
import { retrySoraStudioJob } from "@/app/lib/sora-studio/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(_: Request, context: Params): Promise<NextResponse> {
  const { id } = await context.params;
  const existing = await getSoraStudioJob(id);

  if (!existing) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  void retrySoraStudioJob(id).catch((error) => {
    console.error(`[sora-studio] retry job ${id} failed`, error);
  });

  const refreshed = await getSoraStudioJob(id);
  return NextResponse.json({ job: refreshed ? toClientSoraStudioJob(refreshed) : null }, { status: 202 });
}
