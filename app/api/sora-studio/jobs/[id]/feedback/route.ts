import { NextResponse } from "next/server";
import { z } from "zod";
import { appendFeedbackTrackerEntry } from "@/app/lib/sora-studio/feedback-tracker";
import { getSoraStudioJob, mutateSoraStudioJob, toClientSoraStudioJob } from "@/app/lib/sora-studio/store";
import { SoraStudioRenderModelKey } from "@/app/lib/sora-studio/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

const variantFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5).optional().nullable(),
  comment: z.string().trim().max(2000).optional().nullable()
});

const feedbackSchema = z.object({
  overallComment: z.string().trim().max(5000).optional().nullable(),
  variants: z
    .object({
      sora2: variantFeedbackSchema.optional(),
      seedance2: variantFeedbackSchema.optional()
    })
    .optional()
});

function hasVariantContent(value: { rating?: number; comment?: string }): boolean {
  return typeof value.rating === "number" || (typeof value.comment === "string" && value.comment.trim().length > 0);
}

export async function POST(request: Request, context: Params): Promise<NextResponse> {
  const { id } = await context.params;
  const existing = await getSoraStudioJob(id);

  if (!existing) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  try {
    const payload = feedbackSchema.parse(await request.json());
    const now = new Date().toISOString();

    const updated = await mutateSoraStudioJob(id, (job) => {
      const currentOverall = job.feedback?.overallComment;
      const incomingOverall =
        payload.overallComment === undefined
          ? currentOverall
          : payload.overallComment && payload.overallComment.trim().length > 0
            ? payload.overallComment
            : undefined;

      const nextVariants: Partial<Record<SoraStudioRenderModelKey, { rating?: 1 | 2 | 3 | 4 | 5; comment?: string; updatedAt?: string }>> =
        { ...(job.feedback?.variants ?? {}) };

      const variantPayload = payload.variants ?? {};
      for (const key of ["sora2", "seedance2"] as const) {
        const incoming = variantPayload[key];
        if (!incoming) {
          continue;
        }

        const previous = nextVariants[key] ?? {};
        const next = {
          rating:
            incoming.rating === undefined
              ? previous.rating
              : incoming.rating === null
                ? undefined
                : (incoming.rating as 1 | 2 | 3 | 4 | 5),
          comment:
            incoming.comment === undefined
              ? previous.comment
              : incoming.comment && incoming.comment.trim().length > 0
                ? incoming.comment
                : undefined
        };

        if (hasVariantContent(next)) {
          nextVariants[key] = { ...next, updatedAt: now };
        } else {
          delete nextVariants[key];
        }
      }

      const hasAnyVariant = Object.keys(nextVariants).length > 0;
      const hasOverall = typeof incomingOverall === "string" && incomingOverall.trim().length > 0;

      if (!hasAnyVariant && !hasOverall) {
        job.feedback = undefined;
        return;
      }

      job.feedback = {
        overallComment: incomingOverall,
        variants: hasAnyVariant ? nextVariants : undefined,
        updatedAt: now
      };
    });

    const clientJob = toClientSoraStudioJob(updated);
    const origin = new URL(request.url).origin;

    let trackerEntryId: string | undefined;
    let trackerError: string | undefined;
    try {
      const entry = await appendFeedbackTrackerEntry(clientJob, {
        origin,
        trigger: "feedback_saved"
      });
      trackerEntryId = entry.entryId;
    } catch (error) {
      trackerError = error instanceof Error ? error.message : "Failed to append feedback tracker entry.";
      console.error(`[sora-studio] tracker append failed for job ${id}`, error);
    }

    return NextResponse.json({ job: clientJob, trackerEntryId, trackerError });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid feedback payload." }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save feedback." },
      { status: 500 }
    );
  }
}
