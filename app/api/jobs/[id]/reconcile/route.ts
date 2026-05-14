import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getJob, getJobDir, mutateJob, toClientJob } from "@/app/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

function getProviderAssetPrefix(provider: string | undefined): string {
  switch (provider) {
    case "sora":
      return "sora-t2v";
    case "veo31_standard":
      return "veo-i2v";
    case "sora_i2v":
      return "sora-image-veo-i2v";
    default:
      return "video";
  }
}

export async function POST(_: Request, context: Params): Promise<NextResponse> {
  const { id } = await context.params;
  const existing = await getJob(id);

  if (!existing) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const jobDir = getJobDir(id);
  const rawExists = existsSync(path.join(jobDir, "raw.mp4"));
  const finalExists = existsSync(path.join(jobDir, "final.mp4"));
  const qcExists = existsSync(path.join(jobDir, "qc.json"));
  const prefix = getProviderAssetPrefix(existing.video?.provider);
  const preferredRaw = `raw-${prefix}.mp4`;
  const preferredFinal = `final-${prefix}.mp4`;

  if (!finalExists) {
    return NextResponse.json({ error: "Final MP4 not found on disk." }, { status: 409 });
  }

  if (rawExists && !existsSync(path.join(jobDir, preferredRaw))) {
    await fs.copyFile(path.join(jobDir, "raw.mp4"), path.join(jobDir, preferredRaw)).catch(() => undefined);
  }

  if (!existsSync(path.join(jobDir, preferredFinal))) {
    await fs.copyFile(path.join(jobDir, "final.mp4"), path.join(jobDir, preferredFinal)).catch(() => undefined);
  }

  const updated = await mutateJob(id, (state) => {
    state.status = "completed";
    state.error = undefined;
    if (rawExists) {
      state.assets.rawMp4 = existsSync(path.join(jobDir, preferredRaw)) ? preferredRaw : "raw.mp4";
    }
    if (qcExists) {
      state.assets.qcJson = "qc.json";
    }
    state.assets.finalMp4 = existsSync(path.join(jobDir, preferredFinal)) ? preferredFinal : "final.mp4";

    const videoStep = state.steps.find((step) => step.id === "video");
    if (videoStep && videoStep.status !== "completed") {
      videoStep.status = "completed";
      videoStep.message = videoStep.message || "Base video ready.";
    }

    const finalizeStep = state.steps.find((step) => step.id === "finalize");
    if (finalizeStep) {
      finalizeStep.status = "completed";
      finalizeStep.message = "Final ready from promoted raw attempt.";
    }
  });

  return NextResponse.json({ job: toClientJob(updated) }, { status: 200 });
}
