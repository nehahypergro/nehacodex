import { NextResponse } from "next/server";
import { z } from "zod";
import { createRun, listRuns, runParentRun, toClientRun } from "@/app/lib/runs";
import { DEFAULT_PROMPT_WRITER_VERSION, PROMPT_WRITER_VERSIONS, VIDEO_DURATIONS, VIDEO_TYPES } from "@/app/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  product: z.enum(["kotak_air_plus", "kotak_cashback"]),
  brief: z.string().trim().min(12).max(2000),
  promptVersion: z.enum(PROMPT_WRITER_VERSIONS).default(DEFAULT_PROMPT_WRITER_VERSION),
  videoType: z.enum(VIDEO_TYPES).default("point_to_camera_multi_scene"),
  durationSeconds: z.union([z.literal(8), z.literal(15), z.literal(20)]).default(8)
}).superRefine((payload, ctx) => {
  if (payload.videoType !== "point_to_camera" && payload.videoType !== "point_to_camera_multi_scene") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["videoType"],
      message: "Parent runs currently support point-to-camera flows only."
    });
  }
  if (payload.durationSeconds !== 8) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["durationSeconds"],
      message: "Parent runs currently support 8-second flows only."
    });
  }
  if (!VIDEO_DURATIONS.includes(payload.durationSeconds)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["durationSeconds"],
      message: "Unsupported duration."
    });
  }
});

export async function GET(): Promise<NextResponse> {
  const runs = await listRuns(10);
  const clientRuns = await Promise.all(runs.map((run) => toClientRun(run)));
  return NextResponse.json({ runs: clientRuns });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = createSchema.parse(await request.json());
    const run = await createRun({
      product: payload.product,
      brief: payload.brief,
      promptVersion: payload.promptVersion,
      videoType: payload.videoType,
      durationSeconds: payload.durationSeconds
    });

    void runParentRun(run.id).catch((error) => {
      console.error(`[runs] parent run ${run.id} failed`, error);
    });

    return NextResponse.json({ run: await toClientRun(run) }, { status: 202 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request payload." }, { status: 400 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to create run."
      },
      { status: 500 }
    );
  }
}
