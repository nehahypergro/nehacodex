import { NextResponse } from "next/server";
import { z } from "zod";
import { generateCampaignScript } from "@/app/api/script/route";
import { runCrossAspectTrial } from "@/app/lib/pipeline";
import { DEFAULT_PROMPT_WRITER_VERSION, PROMPT_WRITER_VERSIONS, VIDEO_TYPES } from "@/app/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  product: z.enum(["kotak_air_plus", "kotak_cashback"]),
  brief: z.string().trim().min(12).max(1200),
  script: z.string().trim().min(12).max(260).optional(),
  guidelines: z.string().trim().max(5000).optional(),
  provider: z.enum(["sora", "veo31_standard"]).default("sora"),
  durationSeconds: z.union([z.literal(8), z.literal(15), z.literal(20)]).default(8),
  videoType: z.enum(VIDEO_TYPES).default("point_to_camera_multi_scene"),
  promptVersion: z.enum(PROMPT_WRITER_VERSIONS).default(DEFAULT_PROMPT_WRITER_VERSION)
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = requestSchema.parse(await request.json());
    const scriptResult = payload.script
      ? { script: payload.script }
      : await generateCampaignScript({
          product: payload.product,
          brief: payload.brief,
          guidelines: payload.guidelines,
          videoType: payload.videoType,
          durationSeconds: payload.durationSeconds
        });

    const result = await runCrossAspectTrial({
      product: payload.product,
      brief: payload.brief,
      guidelines: payload.guidelines,
      provider: payload.provider,
      durationSeconds: payload.durationSeconds,
      videoType: payload.videoType,
      promptVersion: payload.promptVersion,
      script: scriptResult.script
    });

    return NextResponse.json(
      {
        product: result.product,
        provider: result.provider,
        brief: payload.brief,
        script: result.script,
        outputDir: result.outputDir,
        files: {
          master16x9: result.master16x9Path,
          adapt9x16: result.adapt9x16Path,
          adapt1x1: result.adapt1x1Path,
          adapt4x3: result.adapt4x3Path,
          guideFrame: result.guideFramePath,
          masterFrame: result.masterFramePath,
          adapt9x16Frame: result.adapt9x16FramePath,
          adapt1x1Frame: result.adapt1x1FramePath,
          adapt4x3Frame: result.adapt4x3FramePath
        }
      },
      { status: 200 }
    );
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
        error: error instanceof Error ? error.message : "Failed to run cross-aspect trial."
      },
      { status: 500 }
    );
  }
}
