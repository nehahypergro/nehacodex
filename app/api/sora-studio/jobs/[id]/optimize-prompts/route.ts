import { NextResponse } from "next/server";
import { getSoraStudioJob, toClientSoraStudioJob } from "@/app/lib/sora-studio/store";
import { runSoraStudioPromptOptimizationDryRun } from "@/app/lib/sora-studio/render";

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

  try {
    await runSoraStudioPromptOptimizationDryRun(id);
    const refreshed = await getSoraStudioJob(id);
    return NextResponse.json({ job: refreshed ? toClientSoraStudioJob(refreshed) : null }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Prompt optimization dry run failed." },
      { status: 500 }
    );
  }
}

