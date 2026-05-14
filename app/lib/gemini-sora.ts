import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { ProductKey, VideoType } from "./types";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-pro";
const GEMINI_MODEL = process.env.GEMINI_SORA_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
const GEMINI_HTTP_TIMEOUT_MS = Number(process.env.GEMINI_SORA_HTTP_TIMEOUT_MS ?? process.env.GENAI_HTTP_TIMEOUT_MS ?? 120000);

const geminiOutputSchema = z.object({
  script: z.string().trim().min(12).max(1200),
  soraPrompt: z.string().trim().min(40).max(12000)
});

export interface GeminiSoraGenerationInput {
  product: ProductKey;
  originalProduct: string;
  brief: string;
  businessObjective: string;
  creativeObjectiveFunnel: string;
  durationSeconds: 8 | 15 | 20;
  ratioDimensions: string;
  language: string;
  videoType: VideoType;
}

export interface GeminiSoraGenerationResult {
  script: string;
  soraPrompt: string;
  model: string;
}

function requireGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!key) {
    throw new Error("GEMINI_API_KEY (or GOOGLE_API_KEY) is required for Gemini generation.");
  }
  return key;
}

function responseText(response: unknown): string {
  if (!response || typeof response !== "object") {
    return "";
  }
  const value = (response as { text?: unknown }).text;
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "function") {
    const result = value();
    return typeof result === "string" ? result : "";
  }
  return "";
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed);
  }
  const withoutCodeFence = trimmed.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  if (withoutCodeFence.startsWith("{") && withoutCodeFence.endsWith("}")) {
    return JSON.parse(withoutCodeFence);
  }
  const first = withoutCodeFence.indexOf("{");
  const last = withoutCodeFence.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return JSON.parse(withoutCodeFence.slice(first, last + 1));
  }
  throw new Error("Gemini response did not include a JSON object.");
}

function getProductLabel(product: ProductKey): string {
  return product === "kotak_air_plus" ? "Kotak Air Plus Credit Card" : "Kotak Cashback Credit Card";
}

function enforceIndianFaceAndBankPrompt(prompt: string): string {
  const lines: string[] = [prompt.trim()];
  const lower = prompt.toLowerCase();

  if (!lower.includes("indian face") && !lower.includes("indian faces")) {
    lines.push("Casting lock: use authentic Indian faces only; no non-Indian faces.");
  }
  if (!lower.includes("kotak mahindra bank")) {
    lines.push("Brand lock: this ad is for Kotak Mahindra Bank.");
  }

  return lines.join("\n");
}

export async function generateScriptAndSoraPromptWithGemini(
  input: GeminiSoraGenerationInput
): Promise<GeminiSoraGenerationResult> {
  const apiKey = requireGeminiApiKey();
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: GEMINI_HTTP_TIMEOUT_MS }
  });

  const productLabel = getProductLabel(input.product);
  const originalProduct = input.originalProduct.trim() || productLabel;
  const prompt = [
    "You are a senior Indian performance-ad scriptwriter and Sora prompt director.",
    "Return strict JSON only with keys: script, soraPrompt.",
    "Hard constraints:",
    "1) Always Indian faces only. Never use non-Indian faces.",
    "2) Brand is always Kotak Mahindra Bank.",
    "3) Keep script aligned to Business Objective and Creative Objective/Funnel.",
    "4) The script must be in the requested language.",
    "5) The soraPrompt must be production-ready for text-to-video and include realistic Indian talent and Indian setting cues.",
    "6) No on-screen UI, no card close-up, no phone/laptop/tablet screens, no subtitles/watermarks.",
    "",
    "Generate one conversion-focused script and one matching Sora prompt from this brief row.",
    "",
    `Product (from planning sheet): ${originalProduct}`,
    `Internal profile fallback key: ${productLabel}`,
    "Bank: Kotak Mahindra Bank",
    `Brief: ${input.brief}`,
    `Business Objective: ${input.businessObjective || "Not provided"}`,
    `Creative Objective / Funnel: ${input.creativeObjectiveFunnel || "Not provided"}`,
    `Video Duration: ${input.durationSeconds}s`,
    `Ratio / Dimensions: ${input.ratioDimensions || "9:16"}`,
    `Language: ${input.language || "English"}`,
    `Video Type: ${input.videoType}`,
    "",
    "Output JSON schema:",
    '{"script":"...", "soraPrompt":"..."}'
  ].join("\n");

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      temperature: 0.35,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          script: { type: "STRING" },
          soraPrompt: { type: "STRING" }
        },
        required: ["script", "soraPrompt"]
      }
    }
  });

  const text = responseText(response).trim();
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  const parsed = geminiOutputSchema.parse(parseJsonObject(text));
  const normalizedScript = parsed.script.replace(/\s+/g, " ").trim();
  const normalizedPrompt = enforceIndianFaceAndBankPrompt(parsed.soraPrompt);

  return {
    script: normalizedScript,
    soraPrompt: normalizedPrompt,
    model: GEMINI_MODEL
  };
}
