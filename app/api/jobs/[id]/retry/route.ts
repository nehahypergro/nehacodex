import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { buildDefaultSteps, getJob, getJobDir, mutateJob, toClientJob } from "@/app/lib/jobs";
import { runPipeline } from "@/app/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

function shouldDeleteForRetry(fileName: string): boolean {
  return (
    /^backstory\.json$/i.test(fileName) ||
    /^(?:keyframe|keyframe-source|shared-keyframe-source|sora-image-keyframe-source)(?:-.*)?\.png$/i.test(fileName) ||
    /^(?:raw|raw-provider|raw-topaz)(?:-attempt-\d+|-[a-z0-9-]+)?\.mp4$/i.test(fileName) ||
    /^final(?:-with-bgm|-rerender.*|-[a-z0-9-]+)?\.mp4$/i.test(fileName) ||
    /^qc(?:-attempt-\d+|-[a-z0-9-]+)?\.json$/i.test(fileName) ||
    /^supers-debug(?:-.*)?\.json$/i.test(fileName) ||
    /^adapt-(?:1x1|16x9)(?:-base)?\.mp4$/i.test(fileName) ||
    /^howto-step-\d{2,3}(?:-base)?\.mp4$/i.test(fileName)
  );
}

async function cleanupRetryArtifacts(jobDir: string): Promise<void> {
  try {
    const entries = await fs.readdir(jobDir);
    await Promise.all(
      entries
        .filter((fileName) => shouldDeleteForRetry(fileName))
        .map((fileName) => fs.unlink(path.join(jobDir, fileName)).catch(() => undefined))
    );
  } catch {
    // If the job directory is partially missing, the rerun can still proceed and recreate outputs.
  }
}

export async function POST(_: Request, context: Params): Promise<NextResponse> {
  const { id } = await context.params;
  const existing = await getJob(id);

  if (!existing) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const jobDir = getJobDir(id);
  await cleanupRetryArtifacts(jobDir);

  const job = await mutateJob(id, (state) => {
    state.runToken = randomUUID();
    state.status = "queued";
    state.error = undefined;
    state.operationName = undefined;
    state.backstory = undefined;
    state.steps = buildDefaultSteps();
    state.assets = {
      inputJson: "input.json",
      backstoryJson: "backstory.json"
    };
  });

  void runPipeline(id).catch((error) => {
    console.error(`[pipeline] retry job ${id} failed`, error);
  });

  return NextResponse.json({ job: toClientJob(job) }, { status: 202 });
}
