import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { SoraStudioResolvedInputRow } from "./types";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-pro";
const GEMINI_MODEL = process.env.GEMINI_SORA_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
const GEMINI_HTTP_TIMEOUT_MS = Number(process.env.GEMINI_SORA_HTTP_TIMEOUT_MS ?? process.env.GENAI_HTTP_TIMEOUT_MS ?? 120000);

const outputSchema = z.object({
  script: z.string().trim().min(12).max(2000),
  soraPrompt: z.string().trim().min(40).max(12000)
});

export interface SoraStudioGeminiOutput {
  script: string;
  soraPrompt: string;
  model: string;
}

function requireGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!key) {
    throw new Error("GEMINI_API_KEY (or GOOGLE_API_KEY) is required.");
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
    const computed = value();
    return typeof computed === "string" ? computed : "";
  }
  return "";
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed);
  }
  const withoutFence = trimmed.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  if (withoutFence.startsWith("{") && withoutFence.endsWith("}")) {
    return JSON.parse(withoutFence);
  }
  const first = withoutFence.indexOf("{");
  const last = withoutFence.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return JSON.parse(withoutFence.slice(first, last + 1));
  }
  throw new Error("Gemini response did not include a JSON object.");
}

function enforcePromptLocks(prompt: string): string {
  const lines = [prompt.trim()];
  const lower = prompt.toLowerCase();

  if (!lower.includes("indian face") && !lower.includes("indian faces")) {
    lines.push("Casting lock: use authentic Indian faces only; no non-Indian faces.");
  }
  if (!lower.includes("kotak mahindra bank")) {
    lines.push("Brand lock: this ad is for Kotak Mahindra Bank.");
  }
  if (!lower.includes("no subtitles") && !lower.includes("no subtitle")) {
    lines.push("No subtitles, watermarks, logos, on-screen UI, phone/laptop/tablet screens, or card close-ups.");
  }

  return lines.join("\n");
}

export async function generateSoraStudioScriptAndPromptWithGemini(
  row: SoraStudioResolvedInputRow
): Promise<SoraStudioGeminiOutput> {
  const apiKey = requireGeminiApiKey();
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: GEMINI_HTTP_TIMEOUT_MS }
  });

  const prompt = [
    "You are a senior ad scriptwriter and prompt director for India-focused short video ads.",
    "Return STRICT JSON only with keys: script, soraPrompt.",
    "Hard constraints:",
    "1) Always use Indian faces only.",
    "2) Brand is always Kotak Mahindra Bank.",
    "3) Keep script in the requested language.",
    "4) Keep narrative aligned to brief, business objective, and funnel objective.",
    "5) soraPrompt must be production-ready for text-to-video.",
    "6) No subtitles, watermarks, logos, on-screen UI, phone/laptop/tablet screens, or card close-ups.",
    "",
    `Product: ${row.product}`,
    `Brief: ${row.brief}`,
    `Business Objective: ${row.businessObjective || "Not provided"}`,
    `Creative Objective / Funnel: ${row.creativeObjectiveFunnel || "Not provided"}`,
    `Requested Duration: ${row.requestedDurationSeconds}s (render request is ${row.requestDurationSeconds}s)` ,
    `Requested Ratio: ${row.requestedAspectRatio} (render ratio is ${row.renderAspectRatio})`,
    `Language: ${row.resolvedLanguage}`,
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

  const parsed = outputSchema.parse(parseJsonObject(text));

  return {
    script: parsed.script.replace(/\s+/g, " ").trim(),
    soraPrompt: enforcePromptLocks(parsed.soraPrompt),
    model: GEMINI_MODEL
  };
}
