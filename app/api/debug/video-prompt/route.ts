import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildSoraMotionPromptDebug,
  buildVeoImagePromptDebug,
  buildVeoMotionPromptDebug,
  generateBackstory
} from "@/app/lib/pipeline";
import { DEFAULT_PROMPT_WRITER_VERSION, DEFAULT_VIDEO_CONFIG, PROMPT_WRITER_VERSIONS, ProductKey, VIDEO_TYPES } from "@/app/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  product: z.enum(["kotak_air_plus", "kotak_cashback"]),
  script: z.string().trim().min(8).max(500),
  brief: z.string().trim().min(8).max(2000),
  guidelines: z.string().trim().max(5000).optional(),
  promptVersion: z.enum(PROMPT_WRITER_VERSIONS).default(DEFAULT_PROMPT_WRITER_VERSION),
  videoType: z.enum(VIDEO_TYPES).default(DEFAULT_VIDEO_CONFIG.type),
  provider: z.enum(["sora", "veo31_standard"]).default(DEFAULT_VIDEO_CONFIG.provider),
  durationSeconds: z.number().int().min(4).max(30).default(DEFAULT_VIDEO_CONFIG.durationSeconds),
  aspectRatio: z.enum(["9:16", "1:1", "16:9"]).default("9:16")
});

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const backstory = await generateBackstory(
      payload.script,
      payload.product as ProductKey,
      payload.guidelines,
      payload.brief
    );
    if (payload.provider === "veo31_standard") {
      const imagePromptResult = await buildVeoImagePromptDebug(
        backstory,
        payload.product as ProductKey,
        payload.script,
        payload.aspectRatio,
        payload.videoType,
        payload.guidelines,
        payload.brief
      );
      const promptResult = await buildVeoMotionPromptDebug(
        backstory,
        payload.product as ProductKey,
        payload.script,
        payload.aspectRatio,
        payload.videoType,
        payload.durationSeconds,
        payload.guidelines,
        payload.brief,
        true,
        payload.promptVersion
      );

      return NextResponse.json({
        input: payload,
        step1_backstory: backstory,
        step2_sharedImagePrompt: {
          sourceUsed: imagePromptResult.source,
          sceneDirection: imagePromptResult.sceneDirection,
          prompt: imagePromptResult.prompt
        },
        step3_motionPrompt: {
          sourceUsed: promptResult.source,
          fallbackReason: promptResult.fallbackReason ?? null,
          attempts: promptResult.promptWriterAttempts ?? [],
          prompt: promptResult.prompt
        },
        step4_generationMode: "image_to_video",
        step5_provider: "veo31_standard"
      });
    }

    const promptResult = await buildSoraMotionPromptDebug(
      backstory,
      payload.product as ProductKey,
      payload.script,
      payload.aspectRatio,
      payload.videoType,
      payload.durationSeconds,
      payload.guidelines,
      payload.brief,
      false,
      payload.promptVersion
    );

    return NextResponse.json({
      input: payload,
      step1_backstory: backstory,
      step2_promptWriter: {
        model: process.env.SORA_PROMPT_WRITER_MODEL?.trim() || "gemini-3-pro-preview",
        fallbackModel: process.env.SORA_PROMPT_WRITER_FALLBACK_MODEL?.trim() || "gemini-2.5-pro",
        reasoningEffort: process.env.SORA_PROMPT_WRITER_REASONING_EFFORT?.trim() || "high",
        sourceUsed: promptResult.source,
        fallbackReason: promptResult.fallbackReason ?? null,
        attempts: promptResult.promptWriterAttempts ?? []
      },
      step3_finalSoraPrompt: promptResult.prompt
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate video prompt.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
