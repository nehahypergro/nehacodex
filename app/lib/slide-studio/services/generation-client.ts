import "server-only";

import { randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { resolveLayoutProps } from "@/app/lib/slide-studio/services/layout-engine";
import { buildSlideCitations } from "@/app/lib/slide-studio/services/citation-service";
import {
  AudienceProfile,
  DeckStrategy,
  EvidenceMap,
  NarrativePlan,
  OutlineSlide,
  PresentationIntent,
  ProjectRecord,
  SlideRecord,
  SourceRecord,
  SupportedSlideType
} from "@/app/lib/slide-studio/types";
import { extractKeywords, sentenceCase, truncateText } from "@/app/lib/slide-studio/services/text-utils";

const DEFAULT_MODEL = "gemini-2.5-flash";
const FALLBACK_MODELS = ["gemini-2.5-pro"] as const;

const outlineResponseSchema = z.object({
  slides: z.array(
    z.object({
      slideTitle: z.string().trim().min(4).max(90),
      slideObjective: z.string().trim().min(8).max(220),
      keyBullets: z.array(z.string().trim().min(3).max(120)).min(2).max(5)
    })
  )
});

const slideResponseSchema = z.object({
  title: z.string().trim().min(4).max(90),
  objective: z.string().trim().min(8).max(220),
  bullets: z.array(z.string().trim().min(3).max(120)).min(2).max(5),
  speakerNotes: z.string().trim().min(12).max(700),
  visualInstructions: z.string().trim().min(12).max(280)
});

export interface OutlineGenerationInput {
  project: ProjectRecord;
  intent: PresentationIntent;
  audienceProfile: AudienceProfile;
  narrativePlan: NarrativePlan;
  deckStrategy: DeckStrategy;
  evidenceMap: EvidenceMap;
  sources: SourceRecord[];
}

export interface SlideGenerationInput extends OutlineGenerationInput {
  outlineSlides: OutlineSlide[];
  currentOutlineSlide: OutlineSlide;
  existingSlides: SlideRecord[];
}

export interface GenerationClient {
  generateOutline(input: OutlineGenerationInput): Promise<OutlineSlide[]>;
  generateSlide(input: SlideGenerationInput): Promise<SlideRecord>;
}

function getApiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || null;
}

function getModels(): string[] {
  return [DEFAULT_MODEL, ...FALLBACK_MODELS];
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function responseText(response: { text?: string | undefined }): string {
  return typeof response.text === "string" ? response.text : "";
}

function evidenceSummary(sources: SourceRecord[]): string {
  return sources
    .slice(0, 6)
    .map((source, index) => `${index + 1}. ${source.title}: ${truncateText(source.extractedText || source.title, 280)}`)
    .join("\n");
}

function topicKeywords(input: OutlineGenerationInput): string[] {
  return extractKeywords(
    `${input.project.title} ${input.project.prompt} ${input.sources.map((source) => source.extractedText).join(" ")}`,
    8
  );
}

function softQualifier(input: OutlineGenerationInput): string {
  return input.evidenceMap.overallConfidence === "low" ? "Likely" : "Evidence suggests";
}

function titleForSlideType(
  slideType: SupportedSlideType,
  input: OutlineGenerationInput,
  blueprintTitle: string
): { title: string; objective: string; bullets: string[] } {
  const topic = input.intent.topic;
  const keywords = topicKeywords(input);
  const anchorA = sentenceCase(keywords[0] ?? "Context");
  const anchorB = sentenceCase(keywords[1] ?? "Execution");
  const qualifier = softQualifier(input);

  switch (slideType) {
    case "title":
      return {
        title: topic,
        objective: `Introduce the deck's core thesis for ${input.audienceProfile.audienceLabel.toLowerCase()}.`,
        bullets: [
          `Frame the opportunity or issue around ${anchorA.toLowerCase()}.`,
          `Set up the decision or takeaway the deck should drive.`
        ]
      };
    case "agenda":
      return {
        title: "How the story will unfold",
        objective: "Prepare the audience for the sequence of ideas before the deck gets into detail.",
        bullets: [
          "Start with context and what matters now.",
          "Move through the critical tradeoffs or proof points.",
          "End with the recommendation and next steps."
        ]
      };
    case "problem":
      return {
        title: `${anchorA} is creating friction`,
        objective: blueprintTitle || `Explain the main challenge surrounding ${topic}.`,
        bullets: [
          `${qualifier} the current state creates avoidable drag, delay, or confusion.`,
          `The audience should understand why the issue matters before any solution is discussed.`,
          `The cost of inaction should feel concrete but not overstated.`
        ]
      };
    case "market/context":
      return {
        title: `${anchorA} is changing the backdrop`,
        objective: blueprintTitle || `Give the audience enough context to see why ${topic} matters now.`,
        bullets: [
          `Connect the topic to broader shifts in ${anchorA.toLowerCase()} and ${anchorB.toLowerCase()}.`,
          "Show what has changed, what is uncertain, and what this means for the audience.",
          "Use research-backed phrasing where evidence is available."
        ]
      };
    case "comparison":
      return {
        title: "Why this path stands apart",
        objective: "Compare the recommended path with likely alternatives or the current baseline.",
        bullets: [
          "Clarify the status quo versus the proposed direction.",
          "Highlight the most decision-relevant differences instead of exhaustive feature lists.",
          "Focus on tradeoffs, not hype."
        ]
      };
    case "process/how-it-works":
      return {
        title: `How ${topic} works in practice`,
        objective: "Explain the operating logic so the deck does not rely on empty claims.",
        bullets: [
          `Walk through the mechanism behind ${topic.toLowerCase()}.`,
          "Keep the explanation sequential and easy to preview visually.",
          "Emphasize the moments that create value or reduce risk."
        ]
      };
    case "metrics/KPI":
      return {
        title: "The proof points to watch",
        objective: "Identify the metrics, directional signals, or evidence that make the story credible.",
        bullets: [
          "Lead with the strongest available evidence.",
          "Separate source-backed facts from directional assumptions.",
          "Use metrics as decision support, not decoration."
        ]
      };
    case "recommendation":
      return {
        title: "Recommendation",
        objective: "State the clearest course of action based on the narrative so far.",
        bullets: [
          `Translate the story into a concrete point of view on ${topic.toLowerCase()}.`,
          "Make the ask explicit and easy to remember.",
          "Tie the recommendation back to audience priorities."
        ]
      };
    case "roadmap":
      return {
        title: "Execution roadmap",
        objective: "Show how the recommendation turns into a practical sequence of milestones.",
        bullets: [
          "Break the path into understandable phases.",
          "Show momentum early and dependencies clearly.",
          "Keep the timeline directional if dates are not yet validated."
        ]
      };
    case "closing":
      return {
        title: "What to remember",
        objective: "Land the deck with a clean summary and next-step framing.",
        bullets: [
          "Reinforce the argument in plain language.",
          "End with the one action or takeaway that matters most."
        ]
      };
    default:
      return {
        title: sentenceCase(slideType),
        objective: blueprintTitle,
        bullets: [`Explain why ${topic.toLowerCase()} matters.`, "Keep the slide practical and decision-oriented."]
      };
  }
}

function buildHeuristicOutline(input: OutlineGenerationInput): OutlineSlide[] {
  return input.deckStrategy.sequence.map((blueprint) => {
    const generated = titleForSlideType(blueprint.slideType, input, blueprint.purpose);
    return {
      id: randomUUID(),
      slideIndex: blueprint.slideIndex,
      slideTitle: generated.title,
      slideObjective: generated.objective,
      keyBullets: generated.bullets.slice(0, 5),
      recommendedSlideType: blueprint.slideType,
      narrativeRole: blueprint.narrativeRole
    };
  });
}

function visualInstructionsFor(slideType: SupportedSlideType, title: string): string {
  switch (slideType) {
    case "comparison":
      return `Use a balanced two-column comparison with sharp headers and a single decision takeaway tied to ${title.toLowerCase()}.`;
    case "metrics/KPI":
      return "Render as KPI tiles with one clear headline metric per tile and a compact supporting label.";
    case "roadmap":
      return "Render as a left-to-right timeline with 3-4 milestones and directional momentum.";
    case "process/how-it-works":
      return "Use a sequenced process layout with clear steps, arrows, and restrained labels.";
    case "title":
      return "Use a hero composition with one dominant headline, a short subtitle, and a restrained context line.";
    default:
      return "Use a clean editorial layout with strong hierarchy, generous spacing, and minimal decorative chrome.";
  }
}

function buildHeuristicSlide(input: SlideGenerationInput): SlideRecord {
  const outlineSlide = input.currentOutlineSlide;
  const existingSlide = input.existingSlides.find((slide) => slide.slideIndex === outlineSlide.slideIndex);
  const title = outlineSlide.slideTitle;
  const objective = outlineSlide.slideObjective;
  const bullets = outlineSlide.keyBullets.slice(0, 5);
  const layoutProps = resolveLayoutProps(outlineSlide.recommendedSlideType, bullets.length);
  const previous = input.outlineSlides.find((slide) => slide.slideIndex === outlineSlide.slideIndex - 1);
  const next = input.outlineSlides.find((slide) => slide.slideIndex === outlineSlide.slideIndex + 1);

  return {
    id: existingSlide?.id ?? randomUUID(),
    projectId: input.project.id,
    slideIndex: outlineSlide.slideIndex,
    slideType: outlineSlide.recommendedSlideType,
    title,
    objective,
    bullets,
    speakerNotes: [
      `This slide exists to ${objective.charAt(0).toLowerCase()}${objective.slice(1)}.`,
      previous ? `It follows "${previous.slideTitle}" and should feel like a logical continuation of that point.` : null,
      next ? `It sets up "${next.slideTitle}" by making the audience ready for the next step in the argument.` : null
    ]
      .filter(Boolean)
      .join(" "),
    visualInstructions: visualInstructionsFor(outlineSlide.recommendedSlideType, title),
    layoutProps,
    citations: buildSlideCitations({
      slideTitle: title,
      objective,
      bullets,
      sources: input.sources
    }),
    createdAt: existingSlide?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function buildOutlinePrompt(input: OutlineGenerationInput): string {
  return [
    "You are generating a presentation outline for a local-first slide system.",
    "Think like an analyst and editor, not a copy machine. Do not invent hard facts, metrics, or named case studies.",
    "Use softer wording whenever evidence is weak or incomplete.",
    "",
    `Project title: ${input.project.title}`,
    `Prompt: ${input.project.prompt}`,
    `Audience: ${input.audienceProfile.audienceLabel}`,
    `Tone: ${input.project.tone || input.audienceProfile.recommendedTone}`,
    `Target slide count: ${input.project.targetSlideCount}`,
    `Deck type: ${input.intent.deckType}`,
    `Structured brief: ${input.intent.structuredBrief}`,
    `Narrative story: ${input.narrativePlan.story}`,
    `Primary takeaway: ${input.narrativePlan.takeaway}`,
    `Audience priorities: ${input.audienceProfile.priorities.join(", ")}`,
    `Evidence summary: ${input.evidenceMap.strengthSummary}`,
    `Evidence gaps: ${input.evidenceMap.gaps.join(" | ") || "No major gaps listed."}`,
    "",
    "Sources:",
    evidenceSummary(input.sources) || "No extracted sources were provided beyond the project brief.",
    "",
    "Required slide sequence:",
    ...input.deckStrategy.sequence.map(
      (blueprint) =>
        `${blueprint.slideIndex}. ${blueprint.slideType} | purpose: ${blueprint.purpose} | key question: ${blueprint.keyQuestion}`
    ),
    "",
    "Return JSON with a top-level 'slides' array. Each slide object must include:",
    "- slideTitle",
    "- slideObjective",
    "- keyBullets",
    "",
    "The slides array length must exactly match the required sequence order above.",
    "Each title should be specific and non-generic. Each objective should explain the job of the slide. Keep bullets concise."
  ].join("\n");
}

function buildSlidePrompt(input: SlideGenerationInput): string {
  const current = input.currentOutlineSlide;
  const previous = input.outlineSlides.find((slide) => slide.slideIndex === current.slideIndex - 1);
  const next = input.outlineSlides.find((slide) => slide.slideIndex === current.slideIndex + 1);

  return [
    "You are generating one slide for a local-first slide system.",
    "Preserve deck-level coherence. Do not fabricate numbers, company names, or unverified claims.",
    "When evidence is incomplete, use directional or conditional language instead of false precision.",
    "",
    `Project title: ${input.project.title}`,
    `Topic: ${input.intent.topic}`,
    `Audience: ${input.audienceProfile.audienceLabel}`,
    `Deck type: ${input.intent.deckType}`,
    `Slide type: ${current.recommendedSlideType}`,
    `Current slide title: ${current.slideTitle}`,
    `Current slide objective: ${current.slideObjective}`,
    `Current slide bullets: ${current.keyBullets.join(" | ")}`,
    `Previous slide: ${previous ? `${previous.slideTitle} (${previous.recommendedSlideType})` : "None"}`,
    `Next slide: ${next ? `${next.slideTitle} (${next.recommendedSlideType})` : "None"}`,
    `Deck strategy rationale: ${input.deckStrategy.rationale}`,
    "",
    "Full outline:",
    ...input.outlineSlides.map(
      (slide) => `${slide.slideIndex}. ${slide.slideTitle} | ${slide.recommendedSlideType} | ${slide.slideObjective}`
    ),
    "",
    "Evidence context:",
    evidenceSummary(input.sources) || "No extracted research beyond the user brief.",
    "",
    "Return JSON with: title, objective, bullets, speakerNotes, visualInstructions.",
    "Bullets must stay concise and distinct. Speaker notes should explain how the slide connects to the story."
  ].join("\n");
}

class GeminiGenerationClient implements GenerationClient {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  private async generateWithFallback(prompt: string, schema: unknown): Promise<string> {
    let lastError: unknown;
    for (const model of getModels()) {
      try {
        const response = await this.ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            temperature: 0.7,
            responseMimeType: "application/json",
            responseSchema: schema as never
          }
        });
        const text = responseText(response).trim();
        if (!text) {
          throw new Error(`Model ${model} returned an empty response.`);
        }
        return text;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Generation failed.");
  }

  async generateOutline(input: OutlineGenerationInput): Promise<OutlineSlide[]> {
    const text = await this.generateWithFallback(buildOutlinePrompt(input), {
      type: "OBJECT",
      properties: {
        slides: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              slideTitle: { type: "STRING" },
              slideObjective: { type: "STRING" },
              keyBullets: { type: "ARRAY", items: { type: "STRING" } }
            },
            required: ["slideTitle", "slideObjective", "keyBullets"]
          }
        }
      },
      required: ["slides"]
    });

    const parsed = outlineResponseSchema.parse(parseJson(text));
    return parsed.slides.map((slide, index) => {
      const blueprint = input.deckStrategy.sequence[index];
      return {
        id: randomUUID(),
        slideIndex: index + 1,
        slideTitle: slide.slideTitle,
        slideObjective: slide.slideObjective,
        keyBullets: slide.keyBullets,
        recommendedSlideType: blueprint.slideType,
        narrativeRole: blueprint.narrativeRole
      };
    });
  }

  async generateSlide(input: SlideGenerationInput): Promise<SlideRecord> {
    const text = await this.generateWithFallback(buildSlidePrompt(input), {
      type: "OBJECT",
      properties: {
        title: { type: "STRING" },
        objective: { type: "STRING" },
        bullets: { type: "ARRAY", items: { type: "STRING" } },
        speakerNotes: { type: "STRING" },
        visualInstructions: { type: "STRING" }
      },
      required: ["title", "objective", "bullets", "speakerNotes", "visualInstructions"]
    });

    const parsed = slideResponseSchema.parse(parseJson(text));
    const existingSlide = input.existingSlides.find((slide) => slide.slideIndex === input.currentOutlineSlide.slideIndex);
    return {
      id: existingSlide?.id ?? randomUUID(),
      projectId: input.project.id,
      slideIndex: input.currentOutlineSlide.slideIndex,
      slideType: input.currentOutlineSlide.recommendedSlideType,
      title: parsed.title,
      objective: parsed.objective,
      bullets: parsed.bullets,
      speakerNotes: parsed.speakerNotes,
      visualInstructions: parsed.visualInstructions,
      layoutProps: resolveLayoutProps(input.currentOutlineSlide.recommendedSlideType, parsed.bullets.length),
      citations: buildSlideCitations({
        slideTitle: parsed.title,
        objective: parsed.objective,
        bullets: parsed.bullets,
        sources: input.sources
      }),
      createdAt: existingSlide?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }
}

class HeuristicGenerationClient implements GenerationClient {
  async generateOutline(input: OutlineGenerationInput): Promise<OutlineSlide[]> {
    return buildHeuristicOutline(input);
  }

  async generateSlide(input: SlideGenerationInput): Promise<SlideRecord> {
    return buildHeuristicSlide(input);
  }
}

let singleton: GenerationClient | null = null;

export function getGenerationClient(): GenerationClient {
  if (singleton) {
    return singleton;
  }

  const apiKey = getApiKey();
  singleton = apiKey ? new GeminiGenerationClient(apiKey) : new HeuristicGenerationClient();
  return singleton;
}

export function isGeminiGenerationConfigured(): boolean {
  return Boolean(getApiKey());
}
