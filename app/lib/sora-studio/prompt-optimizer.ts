import { fal } from "@fal-ai/client";
import { z } from "zod";
import { SoraStudioRenderModelKey } from "./types";

const DEFAULT_PROMPT_OPTIMIZER_MODEL = "anthropic/claude-opus-4.7";
const PROMPT_OPTIMIZER_MODEL = process.env.SORA_PROMPT_OPTIMIZER_MODEL?.trim() || DEFAULT_PROMPT_OPTIMIZER_MODEL;
const PROMPT_OPTIMIZER_ENDPOINT = process.env.SORA_PROMPT_OPTIMIZER_ENDPOINT?.trim() || "openrouter/router";

const optimizerOutputSchema = z.object({
  optimizedPrompt: z.string().trim().min(120).max(20000)
});

interface FalAnyLlmResult {
  data?: {
    output?: string | null;
    error?: string | null;
  };
  requestId?: string;
}

export interface ModelPromptOptimizationInput {
  modelKey: Extract<SoraStudioRenderModelKey, "sora2" | "seedance2">;
  basePrompt: string;
  dialogueAnchors?: string[];
  product: string;
  language: string;
  requestedDurationSeconds: number;
  renderDurationSeconds: number;
  renderAspectRatio: "9:16" | "16:9";
}

export interface ModelPromptOptimizationOutput {
  modelKey: Extract<SoraStudioRenderModelKey, "sora2" | "seedance2">;
  optimizedPrompt: string;
  provider: "anthropic-via-fal-openrouter";
  model: string;
  endpoint: string;
  dialogueLinesLocked: number;
  basePromptChars: number;
  optimizedPromptChars: number;
  warnings: string[];
}

function requireFalApiKey(): string {
  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    throw new Error("FAL_KEY is required for model-specific prompt optimization.");
  }
  return key;
}

function normalizePromptLines(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

  throw new Error("Optimizer response did not include a JSON object.");
}

function extractDialogueAnchors(basePrompt: string): string[] {
  const anchors: string[] = [];
  const lines = basePrompt.replace(/\r\n/g, "\n").split("\n");

  for (const line of lines) {
    const match = line.match(/^\s*-\s*(?:Dialogue\/VO|VO\/Dialogue|Dialogue|VO|Voice\s*Over|Voiceover)\s*:\s*(.+)\s*$/i);
    if (!match) {
      continue;
    }
    const value = match[1] ? match[1].trim() : "";
    if (!value) {
      continue;
    }
    anchors.push(value);
  }

  return anchors;
}

function normalizeAnchor(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dedupeDialogueAnchors(values: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeAnchor(value);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
}

const DIALOGUE_ANY_FIELD_PATTERN =
  /^\s*-\s*(?:Dialogue\/VO|VO\/Dialogue|Dialogue|VO|Voice\s*Over|Voiceover)\s*:\s*(.+)\s*$/i;

function buildDialogueLockSection(anchors: string[]): string {
  if (anchors.length === 0) {
    return [
      "C.0) DIALOGUE LOCK (EXACT, DO NOT ALTER)",
      "- No additional spoken lines. Keep spoken audio minimal and natural."
    ].join("\n");
  }

  return ["C.0) DIALOGUE LOCK (EXACT, DO NOT ALTER)", ...anchors.map((line) => `- Dialogue/VO: ${line}`)].join("\n");
}

function insertDialogueLockNearTop(prompt: string, section: string): string {
  const lines = prompt.replace(/\r\n/g, "\n").split("\n");
  const firstSceneIndex = lines.findIndex((line) => /^\s*C\)\s*SCENE BREAKDOWN/i.test(line) || /^\s*SCENE\s+\d+/i.test(line));
  if (firstSceneIndex > 0) {
    const head = lines.slice(0, firstSceneIndex);
    const tail = lines.slice(firstSceneIndex);
    return [...head, "", section, "", ...tail].join("\n").trim();
  }
  return `${section}\n\n${prompt}`.trim();
}

function enforceDialogueLineLock(prompt: string, anchors: string[]): { prompt: string; missing: number; replaced: number } {
  if (anchors.length === 0) {
    const lockSection = buildDialogueLockSection(anchors);
    return { prompt: insertDialogueLockNearTop(prompt, lockSection), missing: 0, replaced: 0 };
  }

  const lines = prompt.replace(/\r\n/g, "\n").split("\n");
  let removedDialogueLines = 0;
  const updated: string[] = [];
  for (const line of lines) {
    if (!line.match(DIALOGUE_ANY_FIELD_PATTERN)) {
      updated.push(line);
      continue;
    }
    // Remove all model-provided dialogue lines to avoid duplicated/misaligned VO lists.
    removedDialogueLines += 1;
  }

  const missing = 0;
  const lockSection = buildDialogueLockSection(anchors);
  const withTopLock = insertDialogueLockNearTop(updated.join("\n").trim(), lockSection);

  return { prompt: withTopLock, missing: Math.max(0, missing), replaced: removedDialogueLines };
}

function hasShotByShotStructure(text: string): boolean {
  const matches = text.match(/(?:^|\n)\s*(?:scene|shot)\s+\d+\b/gi);
  return Boolean(matches && matches.length >= 2);
}

function countSceneOrShotBlocks(text: string): number {
  const matches = text.match(/(?:^|\n)\s*(?:scene|shot)\s+\d+\b/gi);
  return matches ? matches.length : 0;
}

const OVERLAY_POSITIVE_PATTERN =
  /\b(?:super(?:s)?|end[\s-]?(?:slate|screen|card)|lower[\s-]?third(?:s)?|on[\s-]?screen\s*text|text\s*overlay|subtitle(?:s)?|caption(?:s)?|logo(?:\s*lockup)?|watermark)\b/i;

function removePositiveOverlayLines(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => {
      if (!OVERLAY_POSITIVE_PATTERN.test(line)) {
        return true;
      }
      return /\b(?:no|without|avoid|never|do not|don't)\b/i.test(line);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function ensureGuardrailSection(prompt: string): string {
  const lower = prompt.toLowerCase();
  const hasPrimaryActionRule =
    lower.includes("one clear primary action per scene") || lower.includes("one primary action per scene");
  if (
    lower.includes("absolute rules") &&
    lower.includes("indian faces only") &&
    lower.includes("no visible text") &&
    hasPrimaryActionRule
  ) {
    return prompt;
  }

  const guardrails = [
    "H) ABSOLUTE RULES",
    "- Indian faces only.",
    "- Keep one clear primary action per scene; avoid complex hand mechanics.",
    "- Keep natural, grounded motion and realistic physics.",
    "- No visible text, supers, captions, subtitles, logos, watermarks, UI, app screens, or end slates.",
    "- No physical card closeups and no card swipe/tap/insert interactions.",
    "- No PoS or payment terminal device visuals."
  ].join("\n");

  const lines = prompt.replace(/\r\n/g, "\n").split("\n");
  const firstSceneIndex = lines.findIndex((line) => /^\s*C\)\s*SCENE BREAKDOWN/i.test(line) || /^\s*SCENE\s+\d+/i.test(line));
  if (firstSceneIndex > 0) {
    const head = lines.slice(0, firstSceneIndex);
    const tail = lines.slice(firstSceneIndex);
    return [...head, "", guardrails, "", ...tail].join("\n").trim();
  }

  return `${guardrails}\n\n${prompt.trim()}`.trim();
}

export function buildSafePromptFallbackFromBase(basePrompt: string): {
  prompt: string;
  dialogueLinesLocked: number;
} {
  const cleaned = normalizePromptLines(removePositiveOverlayLines(basePrompt));
  const anchors = extractDialogueAnchors(cleaned);
  const lockResult = enforceDialogueLineLock(cleaned, anchors);
  const guarded = ensureGuardrailSection(lockResult.prompt);
  return {
    prompt: normalizePromptLines(guarded),
    dialogueLinesLocked: anchors.length
  };
}

function modelSpecificGuidance(modelKey: "sora2" | "seedance2"): string {
  if (modelKey === "sora2") {
    return [
      "Sora 2 optimization targets:",
      "- Keep scene intent cinematic but reduce action density per shot.",
      "- Use explicit continuity locks (same face, wardrobe, location progression).",
      "- Prefer stable or gently motivated camera moves; avoid erratic movement.",
      "- Keep interactions physically simple and observable in frame.",
      "- Use concrete environment cues and avoid abstract visual metaphors that can drift."
    ].join("\n");
  }

  return [
    "Seedance 2 optimization targets:",
    "- Keep instructions compact, explicit, and literal scene-by-scene.",
    "- Prefer one subject + one clear action per scene with concise camera direction.",
    "- Avoid ambiguous pronouns and under-specified object interactions.",
    "- Preserve realism by simplifying contact mechanics and hand actions.",
    "- Use direct framing cues (mid/wide) and clear transitions."
  ].join("\n");
}

function buildStructuredModelFallback(
  modelKey: "sora2" | "seedance2",
  basePrompt: string,
  dialogueAnchors: string[]
): string {
  const optimizerBlock =
    modelKey === "sora2"
      ? [
          "J) SORA 2 EXECUTION LOCKS",
          "- Keep camera motion smooth and low-acceleration.",
          "- Keep one primary action per scene and avoid dense interaction choreography.",
          "- Maintain explicit continuity (same protagonist identity and wardrobe) across all scenes.",
          "- Keep realistic physics and avoid micro hand mechanics."
        ].join("\n")
      : [
          "J) SEEDANCE 2 EXECUTION LOCKS",
          "- Keep subject/action/setting instructions concise and literal per scene.",
          "- Keep one clear visible action per scene.",
          "- Avoid ambiguous references; name the subject explicitly in each scene.",
          "- Maintain stable framing with mid/wide compositions for interaction beats."
        ].join("\n");

  const dialogueBlock =
    dialogueAnchors.length > 0
      ? ["K) DIALOGUE LOCK (EXACT)", ...dialogueAnchors.map((line) => `- Dialogue/VO: ${line}`)].join("\n")
      : "";

  return [basePrompt.trim(), "", optimizerBlock, dialogueBlock].filter(Boolean).join("\n").trim();
}

function buildOptimizerPrompt(input: ModelPromptOptimizationInput, dialogueAnchors: string[]): string {
  const dialogueText =
    dialogueAnchors.length > 0
      ? dialogueAnchors.map((line, index) => `${index + 1}. ${line}`).join("\n")
      : "No explicit Dialogue/VO lines detected. Do not invent any new spoken lines.";

  return [
    "You are a senior prompt optimizer for text-to-video generation.",
    `Target model: ${input.modelKey === "sora2" ? "Sora 2" : "Seedance 2.0"}.`,
    "",
    "Task:",
    "Rewrite the provided base prompt into a model-optimized prompt for the target model to reduce hallucinations and improve physical realism.",
    "",
    "Strict non-negotiables:",
    "1) Keep spoken Dialogue/VO content exactly unchanged.",
    "2) Keep scene order and time structure consistent with the base prompt.",
    "2.1) Preserve all scene/shot blocks from the base prompt; do not delete, merge, or collapse scenes.",
    "3) Keep the same story intent, protagonist identity, and objective.",
    "4) No supers, no end slate, no UI/screen overlays, no visible text instructions.",
    "5) Keep actions low-risk and physically grounded.",
    "6) Keep language and cultural anchoring suitable for urban affluent India.",
    "",
    modelSpecificGuidance(input.modelKey),
    "",
    "Dialogue/VO lines that must remain exact:",
    dialogueText,
    "",
    "Input metadata:",
    `- Product: ${input.product}`,
    `- Language: ${input.language}`,
    `- Script duration target: ${input.requestedDurationSeconds}s`,
    `- Render duration target: ${input.renderDurationSeconds}s`,
    `- Render aspect ratio: ${input.renderAspectRatio}`,
    "",
    "Return STRICT JSON only:",
    '{"optimizedPrompt":"<full optimized prompt>"}',
    "",
    "BASE PROMPT START",
    input.basePrompt,
    "BASE PROMPT END"
  ].join("\n");
}

export async function optimizeRenderPromptForModelWithAnthropicFal(
  input: ModelPromptOptimizationInput
): Promise<ModelPromptOptimizationOutput> {
  fal.config({ credentials: requireFalApiKey() });

  const dialogueAnchors = dedupeDialogueAnchors(
    input.dialogueAnchors && input.dialogueAnchors.length > 0 ? input.dialogueAnchors : extractDialogueAnchors(input.basePrompt)
  );
  const optimizerPrompt = buildOptimizerPrompt(input, dialogueAnchors);
  const response = (await fal.run(PROMPT_OPTIMIZER_ENDPOINT, {
    input: {
      model: PROMPT_OPTIMIZER_MODEL,
      prompt: optimizerPrompt
    }
  })) as FalAnyLlmResult;

  const raw = response.data?.output?.trim();
  if (!raw) {
    throw new Error(`Prompt optimizer returned empty output for ${input.modelKey}.`);
  }

  const parsed = optimizerOutputSchema.parse(parseJsonObject(raw));
  const normalized = normalizePromptLines(removePositiveOverlayLines(parsed.optimizedPrompt));
  const warnings: string[] = [];
  const baseSceneCount = countSceneOrShotBlocks(input.basePrompt);
  const optimizedSceneCount = countSceneOrShotBlocks(normalized);
  const missingSceneCoverage = baseSceneCount >= 2 && optimizedSceneCount < baseSceneCount;
  const promptForLock =
    hasShotByShotStructure(normalized) && !missingSceneCoverage
      ? normalized
      : (() => {
          if (!hasShotByShotStructure(normalized)) {
            warnings.push(`Optimizer output for ${input.modelKey} lacked shot-by-shot structure; used structured fallback.`);
          }
          if (missingSceneCoverage) {
            warnings.push(
              `Optimizer output for ${input.modelKey} dropped scene coverage (${optimizedSceneCount}/${baseSceneCount}); used structured fallback.`
            );
          }
          return buildStructuredModelFallback(input.modelKey, input.basePrompt, dialogueAnchors);
        })();

  const lockResult = enforceDialogueLineLock(promptForLock, dialogueAnchors);
  const optimizedPrompt = normalizePromptLines(ensureGuardrailSection(lockResult.prompt));

  if (lockResult.missing > 0) {
    warnings.push(`Dialogue lock appended ${lockResult.missing} missing line(s) for ${input.modelKey}.`);
  }

  return {
    modelKey: input.modelKey,
    optimizedPrompt,
    provider: "anthropic-via-fal-openrouter",
    model: PROMPT_OPTIMIZER_MODEL,
    endpoint: PROMPT_OPTIMIZER_ENDPOINT,
    dialogueLinesLocked: dialogueAnchors.length,
    basePromptChars: input.basePrompt.length,
    optimizedPromptChars: optimizedPrompt.length,
    warnings
  };
}
