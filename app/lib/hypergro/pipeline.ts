import { GoogleGenAI, createPartFromText, createPartFromUri, FileState } from "@google/genai";
import { z } from "zod";
import { requireDeckJob, updateDeckJob, writeDeckAsset, writeDeckJsonAsset } from "@/app/lib/hypergro/jobs";
import { TEMPLATE_BRIEFS, TEMPLATE_LABELS, TEMPLATE_SEQUENCE } from "@/app/lib/hypergro/templates";
import { renderDeckToGoogleSlides, isSlidesRenderConfigured } from "@/app/lib/hypergro/slides";
import { DeckDocument, DeckInput, DeckMetric, DeckRuntimeStatus, DeckSlide, DeckTemplateId } from "@/app/lib/hypergro/types";

const DEFAULT_DECK_MODEL = "gemini-2.5-pro";
const DEFAULT_DECK_FALLBACK_MODELS = ["gemini-3.1-pro-preview", "gemini-2.5-flash"] as const;
const DEFAULT_DECK_IMAGE_MODEL = "imagen-4.0-generate-001";
const GEMINI_DECK_HTTP_TIMEOUT_MS = Number(process.env.GEMINI_DECK_HTTP_TIMEOUT_MS ?? process.env.GENAI_HTTP_TIMEOUT_MS ?? 120000);
const FILE_WAIT_TIMEOUT_MS = 60_000;
const FILE_WAIT_INTERVAL_MS = 2_000;

const deckSlideSchema = z.object({
  kicker: z.string().trim().min(2).max(60),
  title: z.string().trim().min(6).max(120),
  headline: z.string().trim().min(12).max(180),
  summary: z.string().trim().min(12).max(320),
  bullets: z.array(z.string().trim().min(4).max(120)).max(5).default([]),
  metrics: z
    .array(
      z.object({
        label: z.string().trim().min(2).max(60),
        value: z.string().trim().min(1).max(32),
        insight: z.string().trim().min(4).max(120)
      })
    )
    .max(4)
    .default([]),
  columns: z
    .array(
      z.object({
        title: z.string().trim().min(2).max(80),
        body: z.string().trim().min(8).max(180),
        bullets: z.array(z.string().trim().min(4).max(100)).max(3).default([])
      })
    )
    .max(4)
    .default([]),
  timeline: z
    .array(
      z.object({
        phase: z.string().trim().min(1).max(20),
        title: z.string().trim().min(2).max(80),
        actions: z.array(z.string().trim().min(4).max(100)).max(3).default([])
      })
    )
    .max(4)
    .default([]),
  callout: z.string().trim().min(6).max(180),
  cta: z.string().trim().min(6).max(180),
  speakerNote: z.string().trim().min(8).max(320)
});

const deckSchema = z.object({
  title: z.string().trim().min(8).max(120),
  subtitle: z.string().trim().min(12).max(180),
  audience: z.string().trim().min(3).max(120),
  objective: z.string().trim().min(8).max(180),
  thesis: z.string().trim().min(12).max(320),
  visualDirection: z.string().trim().min(12).max(320),
  heroPrompt: z.string().trim().min(12).max(400),
  slides: z.array(deckSlideSchema).length(TEMPLATE_SEQUENCE.length)
});

function getGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || null;
}

function getDeckModels(): string[] {
  const primary = process.env.GEMINI_DECK_MODEL?.trim() || DEFAULT_DECK_MODEL;
  const fallback = (process.env.GEMINI_DECK_FALLBACK_MODELS ?? DEFAULT_DECK_FALLBACK_MODELS.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return [primary, ...fallback.filter((item) => item !== primary)];
}

function getDeckImageModel(): string {
  return process.env.GEMINI_DECK_IMAGE_MODEL?.trim() || DEFAULT_DECK_IMAGE_MODEL;
}

function sanitizeText(value: string | undefined): string {
  return value?.trim() ?? "";
}

function normalizeBrief(input: DeckInput): string {
  if (sanitizeText(input.brief)) {
    return sanitizeText(input.brief);
  }

  if (sanitizeText(input.sampleDeckText)) {
    return `Use the uploaded or pasted sample deck as the primary signal. Additional notes: ${sanitizeText(input.sampleDeckText).slice(0, 1200)}`;
  }

  return "Create a consultative Hypergro growth deck with hypothesis-led sales framing.";
}

function parseJsonObject(text: string): unknown {
  return JSON.parse(text);
}

function responseText(response: { text?: string | undefined }): string {
  return typeof response.text === "string" ? response.text : "";
}

function buildDeckPrompt(input: DeckInput): string {
  const brief = normalizeBrief(input);
  const styleNotes = sanitizeText(input.styleNotes);
  const slideSpecs = TEMPLATE_SEQUENCE.map((templateId, index) => {
    return `${index + 1}. ${TEMPLATE_LABELS[templateId]}: ${TEMPLATE_BRIEFS[templateId]}`;
  }).join("\n");

  return [
    "You are a BCG principal and executive creative strategist building a boardroom-grade Hypergro sales deck.",
    "The deck must feel hypothesis-led, commercial, concise, and senior enough for CMOs, founders, and revenue leaders.",
    "Use the phrase 'Nano Banana Pro' as the visual language anchor: editorial geometry, premium contrast, precise metric cards, restrained motion, no fluff, no clip-art.",
    "If a sample deck is provided, borrow structure, pacing, and visual hierarchy only. Do not copy proprietary phrasing or client-specific claims.",
    "Never invent exact client results or named case studies unless they are explicitly present in the supplied material.",
    "When hard data is absent, use directional language such as 'illustrative upside', 'benchmark ambition', or 'target operating rhythm'.",
    "Keep every slide tight enough to fit an executive-quality Google Slides layout without text overflow.",
    "",
    "Build exactly 9 slides in this fixed order:",
    slideSpecs,
    "",
    `Primary brief:\n${brief}`,
    `Style notes:\n${styleNotes || "None provided. Stay premium, sharp, and boardroom-ready."}`,
    sanitizeText(input.sampleDeckText)
      ? `Pasted sample deck excerpt:\n${sanitizeText(input.sampleDeckText).slice(0, 8000)}`
      : "",
    "",
    "Output strict JSON only.",
    "Top-level keys: title, subtitle, audience, objective, thesis, visualDirection, heroPrompt, slides.",
    "Each slide must include: kicker, title, headline, summary, bullets, metrics, columns, timeline, callout, cta, speakerNote.",
    "Bullets should be short. Metrics should be directional if not verified. Timeline should be used mainly for the roadmap slide but present on every object as an array."
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function waitForUploadedFile(ai: GoogleGenAI, fileName: string): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < FILE_WAIT_TIMEOUT_MS) {
    const file = await ai.files.get({ name: fileName });
    if (file.state === FileState.ACTIVE) {
      return;
    }
    if (file.state === FileState.FAILED) {
      throw new Error(file.error?.message || "Gemini could not process the uploaded sample deck.");
    }
    await new Promise((resolve) => setTimeout(resolve, FILE_WAIT_INTERVAL_MS));
  }

  throw new Error("Timed out while Gemini processed the uploaded sample deck.");
}

async function generateDeckWithFallback(
  ai: GoogleGenAI,
  prompt: string,
  uploadedFile?: { uri: string; mimeType: string }
): Promise<DeckDocument> {
  const contents = uploadedFile
    ? [createPartFromText(prompt), createPartFromUri(uploadedFile.uri, uploadedFile.mimeType)]
    : [createPartFromText(prompt)];
  const models = getDeckModels();
  let lastError: unknown;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          temperature: 0.8,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING" },
              subtitle: { type: "STRING" },
              audience: { type: "STRING" },
              objective: { type: "STRING" },
              thesis: { type: "STRING" },
              visualDirection: { type: "STRING" },
              heroPrompt: { type: "STRING" },
              slides: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    kicker: { type: "STRING" },
                    title: { type: "STRING" },
                    headline: { type: "STRING" },
                    summary: { type: "STRING" },
                    bullets: { type: "ARRAY", items: { type: "STRING" } },
                    metrics: {
                      type: "ARRAY",
                      items: {
                        type: "OBJECT",
                        properties: {
                          label: { type: "STRING" },
                          value: { type: "STRING" },
                          insight: { type: "STRING" }
                        }
                      }
                    },
                    columns: {
                      type: "ARRAY",
                      items: {
                        type: "OBJECT",
                        properties: {
                          title: { type: "STRING" },
                          body: { type: "STRING" },
                          bullets: { type: "ARRAY", items: { type: "STRING" } }
                        }
                      }
                    },
                    timeline: {
                      type: "ARRAY",
                      items: {
                        type: "OBJECT",
                        properties: {
                          phase: { type: "STRING" },
                          title: { type: "STRING" },
                          actions: { type: "ARRAY", items: { type: "STRING" } }
                        }
                      }
                    },
                    callout: { type: "STRING" },
                    cta: { type: "STRING" },
                    speakerNote: { type: "STRING" }
                  }
                }
              }
            },
            required: ["title", "subtitle", "audience", "objective", "thesis", "visualDirection", "heroPrompt", "slides"]
          }
        }
      });

      const text = responseText(response).trim();
      if (!text) {
        throw new Error(`Gemini returned an empty deck response for ${model}.`);
      }

      const parsed = deckSchema.parse(parseJsonObject(text));
      const slides: DeckSlide[] = parsed.slides.map((slide, index) => ({
        ...slide,
        templateId: TEMPLATE_SEQUENCE[index] as DeckTemplateId
      }));
      return {
        ...parsed,
        slides
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Deck generation failed for all configured Gemini models.");
}

async function maybeUploadSampleFile(
  ai: GoogleGenAI,
  sampleFile: File | null
): Promise<{ uri: string; mimeType: string } | undefined> {
  if (!sampleFile) {
    return undefined;
  }

  const mimeType = sampleFile.type || "application/octet-stream";
  const uploaded = await ai.files.upload({
    file: sampleFile,
    config: {
      mimeType,
      displayName: sampleFile.name
    }
  });

  if (!uploaded.name || !uploaded.uri) {
    throw new Error("Gemini file upload did not return the uploaded sample deck reference.");
  }

  await waitForUploadedFile(ai, uploaded.name);
  return {
    uri: uploaded.uri,
    mimeType: uploaded.mimeType || mimeType
  };
}

function ensureMetricContent(metrics: DeckMetric[], brief: string): DeckMetric[] {
  if (metrics.length > 0) {
    return metrics;
  }

  return [
    { label: "Illustrative upside", value: "2-3x", insight: "more experiments in-market each sprint" },
    { label: "Decision tempo", value: "7 days", insight: "from insight to next creative iteration" },
    { label: "Pilot ambition", value: "90 days", insight: `prove a clear Hypergro wedge around ${brief.slice(0, 36) || "growth execution"}` }
  ];
}

function normalizeDeck(document: DeckDocument, input: DeckInput): DeckDocument {
  return {
    ...document,
    slides: document.slides.map((slide, index) => ({
      ...slide,
      templateId: TEMPLATE_SEQUENCE[index] as DeckTemplateId,
      metrics: ensureMetricContent(slide.metrics, normalizeBrief(input))
    }))
  };
}

async function generateHeroVisual(ai: GoogleGenAI, prompt: string): Promise<Buffer | null> {
  const imageModel = getDeckImageModel();
  try {
    const response = await ai.models.generateImages({
      model: imageModel,
      prompt,
      config: {
        numberOfImages: 1,
        aspectRatio: "16:9",
        outputMimeType: "image/png",
        includeRaiReason: true,
        enhancePrompt: true,
        negativePrompt:
          "no stock photo look, no visible text, no screenshots, no watermarks, no clip art, no cartoon, no clutter, no smartphone mockup"
      }
    });
    const bytes = response.generatedImages?.[0]?.image?.imageBytes;
    return bytes ? Buffer.from(bytes, "base64") : null;
  } catch {
    return null;
  }
}

function slidesStatus(): DeckRuntimeStatus {
  return {
    geminiConfigured: Boolean(getGeminiApiKey()),
    slidesConfigured: isSlidesRenderConfigured()
  };
}

export function getDeckRuntimeStatus(): DeckRuntimeStatus {
  return slidesStatus();
}

export async function runDeckGeneration(jobId: string, input: DeckInput, sampleFile: File | null): Promise<void> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Set GEMINI_API_KEY (or GOOGLE_API_KEY) before generating a deck.");
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: GEMINI_DECK_HTTP_TIMEOUT_MS
    }
  });
  await updateDeckJob(jobId, (job) => {
    job.status = "running";
    const step = job.steps.find((item) => item.id === "strategy");
    if (step) {
      step.status = "running";
      step.message = "Synthesizing the Hypergro storyline and slide content.";
    }
  });

  const uploadedFile = await maybeUploadSampleFile(ai, sampleFile);
  const deckPrompt = buildDeckPrompt(input);
  const rawDeck = await generateDeckWithFallback(ai, deckPrompt, uploadedFile);
  const deck = normalizeDeck(rawDeck, input);

  await writeDeckJsonAsset(jobId, "deck.json", deck);
  await updateDeckJob(jobId, (job) => {
    job.deck = deck;
    job.assets.deckJson = "deck.json";
    const step = job.steps.find((item) => item.id === "strategy");
    if (step) {
      step.status = "completed";
      step.message = "Generated the strategy narrative and slide copy.";
    }
  });

  const heroPrompt = `${deck.heroPrompt}. Executive consulting aesthetic. Nano Banana Pro visual language. Premium editorial composition with geometric overlays.`;
  await updateDeckJob(jobId, (job) => {
    const step = job.steps.find((item) => item.id === "visual");
    if (step) {
      step.status = "running";
      step.message = "Generating Nano Banana Pro visual direction.";
    }
  });

  const heroPng = await generateHeroVisual(ai, heroPrompt);
  if (heroPng) {
    await writeDeckAsset(jobId, "hero.png", heroPng);
    await updateDeckJob(jobId, (job) => {
      job.assets.heroPng = "hero.png";
      const step = job.steps.find((item) => item.id === "visual");
      if (step) {
        step.status = "completed";
        step.message = "Generated a reusable hero visual prompt preview.";
      }
    });
  } else {
    await updateDeckJob(jobId, (job) => {
      job.warnings.push("Visual preview generation was skipped; the deck still rendered with shape-led templates.");
      const step = job.steps.find((item) => item.id === "visual");
      if (step) {
        step.status = "skipped";
        step.message = "Visual preview was unavailable; continuing with deterministic slides.";
      }
    });
  }

  await updateDeckJob(jobId, (job) => {
    const step = job.steps.find((item) => item.id === "slides");
    if (step) {
      step.status = "running";
      step.message = "Rendering reusable templates into Google Slides.";
    }
  });

  if (!isSlidesRenderConfigured()) {
    const slides = {
      status: "skipped" as const,
      message: "Google Slides export is configured in code but credentials are not set in the environment."
    };
    await writeDeckJsonAsset(jobId, "slides.json", slides);
    await updateDeckJob(jobId, (job) => {
      job.status = "completed";
      job.slides = slides;
      job.assets.slidesJson = "slides.json";
      const step = job.steps.find((item) => item.id === "slides");
      if (step) {
        step.status = "skipped";
        step.message = slides.message;
      }
    });
    return;
  }

  try {
    const slides = await renderDeckToGoogleSlides(deck);
    await writeDeckJsonAsset(jobId, "slides.json", slides);
    await updateDeckJob(jobId, (job) => {
      job.status = "completed";
      job.slides = slides;
      job.assets.slidesJson = "slides.json";
      const step = job.steps.find((item) => item.id === "slides");
      if (step) {
        step.status = "completed";
        step.message = "Deck exported into a live Google Slides presentation.";
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to render the deck into Google Slides.";
    await updateDeckJob(jobId, (job) => {
      job.status = "failed";
      job.error = message;
      const step = job.steps.find((item) => item.id === "slides");
      if (step) {
        step.status = "failed";
        step.message = message;
      }
    });
    throw error;
  }
}

export async function getDeckJobForResponse(jobId: string) {
  return requireDeckJob(jobId);
}
