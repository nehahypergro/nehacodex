import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createJob, getJobDir, listJobs, toClientJob } from "@/app/lib/jobs";
import { runPipeline } from "@/app/lib/pipeline";
import {
  DEFAULT_PROMPT_WRITER_VERSION,
  DEFAULT_VIDEO_CONFIG,
  isBumperVideoType,
  normalizeVideoTypeForGeneration,
  PROMPT_WRITER_VERSIONS,
  VIDEO_DURATIONS,
  VIDEO_PROVIDERS,
  VIDEO_TYPES
} from "@/app/lib/types";

const durationSchema = z.number().finite().min(4).max(45);
const howToScreengrabSchema = z.object({
  name: z.string().trim().min(1).max(140),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  dataBase64: z.string().trim().min(16).max(20_000_000)
});

const howToSchema = z.object({
  stepsText: z.string().trim().min(12).max(12_000),
  screengrabs: z.array(howToScreengrabSchema).min(1).max(24)
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  product: z.enum(["kotak_air_plus", "kotak_cashback"]),
  script: z.string().min(12, "Script is too short.").max(12_000),
  promptVersion: z.enum(PROMPT_WRITER_VERSIONS).default(DEFAULT_PROMPT_WRITER_VERSION),
  brief: z.string().trim().max(1200).optional(),
  guidelines: z.string().trim().max(5000).optional(),
  howTo: howToSchema.optional(),
  video: z
    .object({
      type: z.enum(VIDEO_TYPES).default(DEFAULT_VIDEO_CONFIG.type),
      durationSeconds: durationSchema.default(DEFAULT_VIDEO_CONFIG.durationSeconds),
      provider: z.enum(VIDEO_PROVIDERS).default(DEFAULT_VIDEO_CONFIG.provider)
    })
    .default(DEFAULT_VIDEO_CONFIG),
  supers: z
    .object({
      enabled: z.boolean(),
      timingMode: z.enum(["fast", "accurate"]).default("fast"),
      template: z.enum(["bottom_urgency", "super1", "super2"]).default("super1"),
      rules: z
        .array(
          z.object({
            triggerWord: z.string().trim().min(1).max(40),
            text: z.string().trim().min(1).max(90),
            holdSeconds: z.number().min(0.6).max(4).optional()
          })
        )
        .max(12)
        .default([])
    })
    .optional()
}).superRefine((payload, ctx) => {
  if (payload.video?.type === "how_to_video" && !payload.howTo) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["howTo"],
      message: "Step-by-step text and screengrab images are required for How to videos."
    });
  }

  if (payload.video?.type !== "how_to_video" && !VIDEO_DURATIONS.includes(payload.video.durationSeconds as (typeof VIDEO_DURATIONS)[number])) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["video", "durationSeconds"],
      message: `Duration must be one of ${VIDEO_DURATIONS.join(", ")} seconds for this video type.`
    });
  }

  if (payload.video && isBumperVideoType(payload.video.type) && payload.video.durationSeconds !== 8) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["video", "durationSeconds"],
      message: "Bumper ads only support 8 seconds."
    });
  }
});

function extensionForImageMimeType(mimeType: "image/png" | "image/jpeg" | "image/webp"): "png" | "jpg" | "webp" {
  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  return "jpg";
}

function decodeBase64Image(value: string): Buffer {
  const normalized = value.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  return Buffer.from(normalized, "base64");
}

export async function GET(): Promise<NextResponse> {
  const jobs = await listJobs(10);
  return NextResponse.json({ jobs: jobs.map(toClientJob) });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const json = await request.json();
    const payload = createSchema.parse(json);
    const supers = {
      enabled: true,
      timingMode: payload.supers?.timingMode ?? "fast",
      template: payload.supers?.template ?? "super1",
      rules: payload.supers?.rules ?? []
    };
    const requestedVideo = payload.video ?? DEFAULT_VIDEO_CONFIG;
    const normalizedVideoType = normalizeVideoTypeForGeneration(requestedVideo.type);
    const video = {
      ...requestedVideo,
      type: normalizedVideoType,
      durationSeconds: normalizedVideoType === "point_to_camera_multi_scene" ? 8 : requestedVideo.durationSeconds
    };
    const isHowToVideo = video.type === "how_to_video";
    const resolvedHowTo = isHowToVideo
      ? {
          stepsText: payload.howTo?.stepsText.trim() ?? payload.script.trim(),
          screengrabFiles:
            payload.howTo?.screengrabs.map((upload, index) => {
              const ext = extensionForImageMimeType(upload.mimeType);
              return `howto-screengrab-${String(index + 1).padStart(2, "0")}.${ext}`;
            }) ?? []
        }
      : undefined;
    const scriptValue = isHowToVideo ? resolvedHowTo?.stepsText ?? payload.script.trim() : payload.script.trim();

    const job = await createJob({
      ...payload,
      script: scriptValue,
      howTo: resolvedHowTo,
      video,
      supers
    });

    if (isHowToVideo && payload.howTo && resolvedHowTo) {
      const jobDir = getJobDir(job.id);
      await Promise.all(
        payload.howTo.screengrabs.map(async (upload, index) => {
          const fileName = resolvedHowTo.screengrabFiles[index];
          if (!fileName) {
            return;
          }
          const imageBytes = decodeBase64Image(upload.dataBase64);
          await fs.writeFile(path.join(jobDir, fileName), imageBytes);
        })
      );
    }

    void runPipeline(job.id).catch((error) => {
      console.error(`[pipeline] job ${job.id} failed`, error);
    });

    return NextResponse.json({ job: toClientJob(job) }, { status: 202 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: error.issues[0]?.message ?? "Invalid request payload."
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to create job."
      },
      { status: 500 }
    );
  }
}
