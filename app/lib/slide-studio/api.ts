import { NextResponse } from "next/server";
import { z } from "zod";
import { SUPPORTED_SLIDE_TYPES } from "@/app/lib/slide-studio/constants";

export const createProjectSchema = z.object({
  title: z.string().trim().min(3).max(120),
  prompt: z.string().trim().min(10).max(12000),
  audience: z.string().trim().max(160).optional(),
  tone: z.string().trim().max(120).optional(),
  targetSlideCount: z.coerce.number().int().min(5).max(12)
});

export const updateProjectSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  prompt: z.string().trim().min(10).max(12000).optional(),
  audience: z.string().trim().max(160).optional(),
  tone: z.string().trim().max(120).optional(),
  targetSlideCount: z.number().int().min(5).max(12).optional()
});

export const outlineSlideSchema = z.object({
  id: z.string().trim().min(1),
  slideIndex: z.number().int().min(1),
  slideTitle: z.string().trim().min(1).max(90),
  slideObjective: z.string().trim().min(1).max(220),
  keyBullets: z.array(z.string().trim().max(120)).min(1).max(5),
  recommendedSlideType: z.enum(SUPPORTED_SLIDE_TYPES),
  narrativeRole: z.string().trim().max(180)
});

export const saveOutlineSchema = z.object({
  status: z.enum(["draft", "approved"]),
  slides: z.array(outlineSlideSchema).min(1).max(20)
});

export const slideUpdateSchema = z.object({
  title: z.string().trim().min(1).max(90).optional(),
  objective: z.string().trim().min(1).max(220).optional(),
  bullets: z.array(z.string().trim().max(120)).min(1).max(5).optional(),
  speakerNotes: z.string().trim().min(1).max(700).optional(),
  visualInstructions: z.string().trim().min(1).max(280).optional(),
  layoutProps: z
    .object({
      variant: z.enum(["hero", "standard", "twoColumn", "kpiTiles", "timeline"]),
      columnCount: z.number().int().min(1).max(6),
      emphasis: z.enum(["context", "proof", "decision", "summary"]),
      bulletStyle: z.enum(["plain", "checklist", "metric", "timeline"])
    })
    .optional(),
  citations: z
    .array(
      z.object({
        sourceId: z.string().trim().optional(),
        sourceTitle: z.string().trim().min(1).max(120),
        url: z.string().trim().url().optional(),
        confidence: z.enum(["high", "medium", "low"]),
        evidenceKind: z.enum(["source_backed", "inference", "speculative"]),
        claim: z.string().trim().min(1).max(220)
      })
    )
    .optional()
});

export function jsonError(error: unknown, status = 500): NextResponse {
  const message = error instanceof Error ? error.message : "Request failed.";
  return NextResponse.json({ error: message }, { status });
}
