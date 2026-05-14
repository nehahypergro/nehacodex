import { NextResponse } from "next/server";
import { z } from "zod";
import { generateSoraStudioScriptAndPromptWithAnthropicFal } from "@/app/lib/sora-studio/anthropic-fal";
import { resolveSoraStudioInputRow } from "@/app/lib/sora-studio/import";
import { runSoraStudioJob } from "@/app/lib/sora-studio/render";
import { createSoraStudioJob, listSoraStudioJobs, toClientSoraStudioJob } from "@/app/lib/sora-studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  product: z.string().trim().min(1),
  brief: z.string().trim().min(12),
  businessObjective: z.string().trim().max(2000).optional(),
  creativeObjectiveFunnel: z.string().trim().max(2000).optional(),
  videoDuration: z.string().trim().max(120).optional(),
  ratioDimensions: z.string().trim().max(120).optional(),
  language: z.string().trim().max(120).optional(),
  notificationEmail: z.string().trim().email().max(320).optional().or(z.literal("")),
  rowNumber: z.number().int().positive().optional(),
  briefAttachments: z
    .array(
      z.object({
        id: z.string().trim().max(120).optional(),
        name: z.string().trim().min(1).max(240),
        mediaType: z.enum(["image", "video"]),
        source: z.enum(["upload", "url"]),
        url: z.string().trim().url().max(3000),
        mimeType: z.string().trim().max(120).optional()
      })
    )
    .max(8)
    .optional(),
  strictParityMode: z.boolean().default(true),
  autoRender: z.boolean().default(true)
});

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 20;
  const briefQuery = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
  const jobs = await listSoraStudioJobs(limit, { briefQuery });
  return NextResponse.json({ jobs: jobs.map(toClientSoraStudioJob) });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = createSchema.parse(await request.json());

    const resolved = resolveSoraStudioInputRow({
      rowNumber: payload.rowNumber ?? 1,
      product: payload.product,
      brief: payload.brief,
      businessObjective: payload.businessObjective ?? "",
      creativeObjectiveFunnel: payload.creativeObjectiveFunnel ?? "",
      videoDuration: payload.videoDuration ?? "8",
      ratioDimensions: payload.ratioDimensions ?? "9:16",
      language: payload.language ?? "English",
      notificationEmail: payload.notificationEmail?.trim() || undefined,
      strictParityMode: payload.strictParityMode,
      briefAttachments: payload.briefAttachments ?? []
    });

    const generated = await generateSoraStudioScriptAndPromptWithAnthropicFal(resolved);

    const job = await createSoraStudioJob({
      input: resolved,
      compactedBrief: generated.compactedBrief,
      scriptWriterPrompt: generated.scriptWriterPrompt,
      script: generated.script,
      soraPrompt: generated.soraPrompt,
      scriptModel: generated.model,
      promptModel: generated.model,
      warnings: [...resolved.warnings, ...generated.warnings]
    });

    if (payload.autoRender) {
      void runSoraStudioJob(job.id).catch((error) => {
        console.error(`[sora-studio] job ${job.id} failed`, error);
      });
    }

    return NextResponse.json({ job: toClientSoraStudioJob(job) }, { status: 202 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to create Sora Studio job."
      },
      { status: 500 }
    );
  }
}
