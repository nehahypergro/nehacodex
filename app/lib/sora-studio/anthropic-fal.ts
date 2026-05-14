import { fal } from "@fal-ai/client";
import { z } from "zod";
import { SoraStudioResolvedInputRow } from "./types";

const DEFAULT_ANTHROPIC_FAL_MODEL = "anthropic/claude-opus-4.7";
const ANTHROPIC_FAL_MODEL = DEFAULT_ANTHROPIC_FAL_MODEL;
const FAL_TEXT_GENERATION_ENDPOINT = "openrouter/router";
const FAL_VISION_GENERATION_ENDPOINT = "openrouter/router/vision";
const FAL_VIDEO_GENERATION_ENDPOINT = "openrouter/router/video";
const MAX_SCRIPT_IMAGE_ATTACHMENTS = 6;
const MAX_SCRIPT_VIDEO_ATTACHMENTS = 2;

const outputSchema = z.object({
  script: z.string().trim().min(40).max(8000),
  soraPrompt: z.string().trim().min(80).max(16000)
});

interface FalAnyLlmResult {
  data?: {
    output?: string | null;
    reasoning?: string | null;
    partial?: boolean;
    error?: string | null;
  };
  requestId?: string;
}

interface ScriptGenerationRequestPlan {
  endpoint: string;
  input: {
    model: string;
    prompt: string;
    image_urls?: string[];
    video_urls?: string[];
  };
  warnings: string[];
}

export interface SoraStudioAnthropicFalOutput {
  script: string;
  soraPrompt: string;
  model: string;
  warnings: string[];
  compactedBrief: string;
  scriptWriterPrompt: string;
}

interface ScriptWordBudget {
  minWords: number;
  maxWords: number;
}

interface ShotPlan {
  minShots: number;
  maxShots: number;
}

interface CompactedBriefResult {
  compactedBrief: string;
  removedSegments: number;
  originalChars: number;
  compactedChars: number;
}

const DEVANAGARI_WORD_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b[Kk]otak\b/g, "कोटक"],
  [/\b[Hh]ausla\b/g, "हौसला"],
  [/\b[Hh]auslo(?:n)?\b/g, "हौस्लो"]
];

const ACTION_REALISM_RULE_LINES = [
  "Action realism lock: one primary action per scene; avoid multi-step choreography in a single shot.",
  "Object interaction lock: avoid complex finger-level mechanics (tiny taps, swipes, typing closeups, intricate button/knob actions).",
  "Beverage interaction lock: implied sip only (cup/glass near lips), no visible liquid transfer, no pouring close-ups.",
  "Door interaction lock: use already-open doorway pass-through; avoid showing latch/knob open-close mechanics.",
  "Camera blocking lock: for object interaction shots, keep to mid/wide framing with hands and props fully visible.",
  "Edit lock: cut before or after tricky contact moments; do not hold long on unstable physics beats."
];

const SCRIPT_INPUT_BRIEF_MAX_CHARS = Math.max(280, Number(process.env.SORA_SCRIPT_INPUT_BRIEF_MAX_CHARS ?? 1100));
const BRIEF_SEGMENT_SPLIT_REGEX = /\n+|(?<=[.!?])\s+(?=[A-Z0-9\u0900-\u097F])/g;
const BRIEF_EXCLUSION_PATTERNS = [
  /\b(?:t\s*&\s*c|terms?\s*(?:and|&)\s*conditions?|conditions?\s*apply|disclaimer|fine\s*print|legal)\b/i,
  /\b(?:super(?:s)?|on[-\s]?screen\s*text|text\s*overlay|lower[-\s]?third|subtitle(?:s)?|caption(?:s)?)\b/i,
  /\b(?:end[\s-]?(?:slate|screen|card)|closing[\s-]?(?:slate|screen|card)|outro[\s-]?(?:slate|screen|card)|final[\s-]?(?:slate|screen|card)|logo\s*lockup)\b/i,
  /\b(?:ui|user\s*interface|app\s*ui|app\s*screen|screen(?:s)?|display(?:s)?|mockup)\b/i,
  /\b(?:phone|mobile|smartphone|laptop|tablet|desktop|monitor)\b/i
];
const DURATION_MENTION_PATTERNS = [
  /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty)(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine))?\s*(?:second|seconds|sec|secs|minute|minutes|min|mins)\b/gi,
  /\b(?:video\s*)?(?:duration|length|runtime|run\s*time)\s*(?:[:=\-]|\bis\b|\bof\b)?\s*(?:about|around|approx(?:\.|imately)?|roughly|under|within)?\s*\d+\s*(?:to|-|–)?\s*\d*\s*(?:s|sec|secs|second|seconds|min|mins|minute|minutes)\b/gi,
  /\b(?:for|in|within|under|around|about|approx(?:\.|imately)?|roughly)\s+\d+\s*(?:to|-|–)?\s*\d*\s*(?:s|sec|secs|second|seconds|min|mins|minute|minutes)\b/gi,
  /\b\d+\s*(?:to|-|–)\s*\d+\s*(?:s|sec|secs|second|seconds|min|mins|minute|minutes)\b/gi,
  /\b\d+\s*(?:s|sec|secs|second|seconds|min|mins|minute|minutes)\b/gi
];
const DURATION_STANDALONE_LABEL_PATTERN =
  /^\s*(?:video\s*)?(?:duration|length|runtime|run\s*time)\s*(?:[:=\-])?\s*$/i;
const END_SLATE_SUPER_LINE_PATTERN =
  /\b(?:end[\s-]?(?:slate|screen|card)|closing[\s-]?(?:slate|screen|card)|outro[\s-]?(?:slate|screen|card)|final[\s-]?(?:slate|screen|card)|super(?:s)?|text\s*overlay|on[-\s]?screen\s*text|lower[-\s]?third(?:s)?|logo\s*lockup|title\s*card|headline|tagline|written\s*text|typography|caption(?:s)?|subtitle(?:s)?)\b/i;

const OVERLAY_TEXT_PATTERN =
  /\b(?:super(?:s)?|text\s*overlay|on[-\s]?screen\s*text|lower[-\s]?third(?:s)?|title\s*card|headline|tagline|written\s*text|typography|caption(?:s)?|subtitle(?:s)?|end[\s-]?(?:slate|screen|card)|outro[\s-]?(?:slate|screen|card)|logo(?:\s*lockup)?|watermark)\b/i;

const MONEY_UNIT_ALIASES: Record<string, "crore" | "lakh" | "thousand" | "million"> = {
  cr: "crore",
  crore: "crore",
  crores: "crore",
  l: "lakh",
  lac: "lakh",
  lakh: "lakh",
  lakhs: "lakh",
  k: "thousand",
  thousand: "thousand",
  m: "million",
  million: "million",
  millions: "million"
};

const CONVERSION_OBJECTIVE_PATTERN =
  /\b(?:conversion|conversions|lead|leads|bofu|bottom[\s-]*of[\s-]*funnel|lower[\s-]*funnel|acquisition|signup|signups|apply|applications)\b/i;

const CARD_POS_INTERACTION_PATTERN =
  /\b(?:pos|p\.?\s*o\.?\s*s\.?|po\s*s|point[\s-]*of[\s-]*sale|payment[\s-]*terminal|terminal|edc[\s-]*machine|swipe[\s-]*machine|card[\s-]*(?:machine|reader)|contactless[\s-]*terminal|tap[\s-]*to[\s-]*pay|swipe|insert|dip|tap)\b/i;

const PHYSICAL_CARD_VISUAL_PATTERN =
  /\b(?:credit[\s-]*card|debit[\s-]*card|card)\b/i;

const SHOT_FIELD_PATTERN =
  /^(\s*-\s*)(Visual|Action|Subject|Setting|Camera|Lighting\s*&\s*Color)(\s*:)(.*)$/i;

const DIALOGUE_FIELD_PATTERN = /^(\s*-\s*)(VO\/Dialogue|Dialogue\/VO)(\s*:)(.*)$/i;

const TIMECODE_DIALOGUE_PATTERN = /^\s*\d{1,2}:\d{2}(?:\.\d+)?\s*(?:[-—:])\s*["“”'`]?/i;

const KOTAK_WORD_PATTERN = /\b(?:kotak|कोटक)(?:\s+mahindra(?:\s+bank)?)?\b/gi;

function deriveVoiceProductName(product: string): string {
  const normalized = compactWhitespace(product);
  const stripped = normalized
    .replace(/^(?:kotak|कोटक)(?:\s+mahindra(?:\s+bank)?)?\s*/i, "")
    .replace(/^(?:mahindra\s+bank)\s*/i, "")
    .trim();

  if (stripped.length > 0) {
    return stripped;
  }
  return normalized || "the product";
}

function isConversionOrBofuObjective(row: SoraStudioResolvedInputRow): boolean {
  const objectiveText = `${row.businessObjective || ""} ${row.creativeObjectiveFunnel || ""}`;
  return CONVERSION_OBJECTIVE_PATTERN.test(objectiveText);
}

function extractFeatureCandidates(compactedBrief: string, maxItems = 4): string[] {
  const segments = compactedBrief
    .replace(/\r\n/g, "\n")
    .split(/[\n.;!?]+/g)
    .map((segment) => compactWhitespace(segment))
    .filter((segment) => segment.length >= 8);

  const filtered = segments.filter((segment) => {
    const lower = segment.toLowerCase();
    if (lower.startsWith("reference link")) {
      return false;
    }
    if (DURATION_STANDALONE_LABEL_PATTERN.test(segment)) {
      return false;
    }
    if (PHYSICAL_CARD_VISUAL_PATTERN.test(segment) && CARD_POS_INTERACTION_PATTERN.test(segment)) {
      return false;
    }
    return true;
  });

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const segment of filtered) {
    const key = segment.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(segment);
    if (deduped.length >= maxItems) {
      break;
    }
  }

  return deduped;
}

function rewriteCardPosVisualLine(line: string): string {
  const match = line.match(SHOT_FIELD_PATTERN);
  if (!match) {
    return line;
  }

  const [, prefix, field, separator, rawValue] = match;
  const value = rawValue.trim();
  if (!value) {
    return line;
  }

  const mentionsPhysicalCard = PHYSICAL_CARD_VISUAL_PATTERN.test(value);
  const mentionsCardPosInteraction = CARD_POS_INTERACTION_PATTERN.test(value);
  if (!mentionsPhysicalCard && !mentionsCardPosInteraction) {
    return line;
  }

  if (field.toLowerCase() === "action") {
    return `${prefix}${field}${separator} Keep the action lifestyle-led and natural; no physical card handling or PoS/payment-device interaction.`;
  }

  return `${prefix}${field}${separator} Lifestyle-led product storytelling only; avoid physical card closeups and PoS/payment-device visuals.`;
}

function enforceNoCardPosVisuals(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => rewriteCardPosVisualLine(line))
    .join("\n");
}

function normalizeDialogueProductNaming(text: string, voiceProductName: string): string {
  if (!voiceProductName.trim()) {
    return text;
  }

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return lines
    .map((line) => {
      const dialogueMatch = line.match(DIALOGUE_FIELD_PATTERN);
      if (dialogueMatch) {
        const [, prefix, field, separator, value] = dialogueMatch;
        const normalized = value.replace(KOTAK_WORD_PATTERN, voiceProductName).replace(/\s{2,}/g, " ").trim();
        return `${prefix}${field}${separator} ${normalized}`;
      }

      if (TIMECODE_DIALOGUE_PATTERN.test(line)) {
        return line.replace(KOTAK_WORD_PATTERN, voiceProductName).replace(/\s{2,}/g, " ").trimEnd();
      }

      return line;
    })
    .join("\n");
}

function extractSignificantWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^A-Za-z0-9\u0900-\u097F\s]/g, " ")
    .split(/\s+/g)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4)
    .filter((word) => !["this", "that", "with", "from", "your", "you", "have", "will", "into", "for", "card"].includes(word));
}

function stripTrailingTerminalPunctuation(value: string): string {
  return value.replace(/["'`”’\s]+$/g, "").replace(/[.!?…।]+$/g, "").trim();
}

function stripDialogueWrapper(value: string): string {
  return stripTrailingTerminalPunctuation(value).replace(/^[\"'`“‘\s]+/g, "").trim();
}

function preserveQuoteWrapping(original: string, content: string): string {
  const trimmedOriginal = original.trim();
  if (!trimmedOriginal) {
    return content;
  }

  const firstChar = trimmedOriginal[0] ?? "";
  const quoteMap: Record<string, string> = {
    "\"": "\"",
    "'": "'",
    "`": "`",
    "“": "”",
    "‘": "’"
  };
  if (!(firstChar in quoteMap)) {
    return content;
  }

  return `${firstChar}${content}${quoteMap[firstChar]}`;
}

function balanceDialogueQuotes(value: string): string {
  let result = value.trim();
  if (!result) {
    return result;
  }

  const straightCount = (result.match(/"/g) ?? []).length;
  if (straightCount % 2 === 1) {
    result = `${result}"`;
  }

  const openCurly = (result.match(/“/g) ?? []).length;
  const closeCurly = (result.match(/”/g) ?? []).length;
  if (openCurly > closeCurly) {
    result = `${result}”`;
  }

  const openSingleCurly = (result.match(/‘/g) ?? []).length;
  const closeSingleCurly = (result.match(/’/g) ?? []).length;
  if (openSingleCurly > closeSingleCurly) {
    result = `${result}’`;
  }

  return result;
}

function scriptMentionsFeature(script: string, feature: string): boolean {
  const featureWords = extractSignificantWords(feature).slice(0, 4);
  if (featureWords.length === 0) {
    return false;
  }
  const lowerScript = script.toLowerCase();
  return featureWords.some((word) => lowerScript.includes(word));
}

function ensureConversionFeatureCoverage(
  script: string,
  options: { conversionMode: boolean; featureCandidates: string[]; voiceProductName: string }
): string {
  if (!options.conversionMode || options.featureCandidates.length === 0) {
    return script;
  }

  const coverageCount = options.featureCandidates.filter((feature) => scriptMentionsFeature(script, feature)).length;
  const minimumCoverage = Math.min(2, options.featureCandidates.length);
  if (coverageCount >= minimumCoverage) {
    return script;
  }

  const lines = script.replace(/\r\n/g, "\n").split("\n");
  const dialogueIndices = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => DIALOGUE_FIELD_PATTERN.test(line))
    .map(({ index }) => index);

  if (dialogueIndices.length === 0) {
    return script;
  }

  const missingFeatures = options.featureCandidates.filter((feature) => !scriptMentionsFeature(script, feature));
  if (missingFeatures.length === 0) {
    return script;
  }

  const featureSummary = missingFeatures.slice(0, 3).join(", ");
  const lastIndex = dialogueIndices[dialogueIndices.length - 1] ?? -1;
  if (lastIndex < 0) {
    return script;
  }

  const current = stripDialogueWrapper((lines[lastIndex] ?? "").replace(DIALOGUE_FIELD_PATTERN, "$4").trim());
  const appended = `${current}. Key reasons to choose ${options.voiceProductName}: ${featureSummary}.`.replace(/\s+/g, " ").trim();
  const wrappedAppended = balanceDialogueQuotes(
    preserveQuoteWrapping((lines[lastIndex] ?? "").replace(DIALOGUE_FIELD_PATTERN, "$4").trim(), appended)
  );
  lines[lastIndex] = lines[lastIndex].replace(DIALOGUE_FIELD_PATTERN, (_all, prefix, field, separator) => {
    return `${prefix}${field}${separator} ${wrappedAppended}`;
  });

  return lines.join("\n");
}

function requireFalApiKey(): string {
  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    throw new Error("FAL_KEY is required for Anthropic via fal.");
  }
  return key;
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

  throw new Error("Anthropic fal response did not include a JSON object.");
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function trimToChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const head = value.slice(0, maxChars).trim();
  const lastSentenceBreak = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (lastSentenceBreak >= Math.floor(maxChars * 0.55)) {
    return head.slice(0, lastSentenceBreak + 1).trim();
  }

  const lastWordBreak = head.lastIndexOf(" ");
  if (lastWordBreak >= Math.floor(maxChars * 0.5)) {
    return head.slice(0, lastWordBreak).trim();
  }

  return head;
}

function parseNumericValue(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) {
    return null;
  }
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function numberToWordsUnder100(n: number): string {
  const ones = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen"
  ];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

  if (n < 20) {
    return ones[n] ?? "";
  }

  const tenPart = Math.floor(n / 10);
  const onePart = n % 10;
  if (onePart === 0) {
    return tens[tenPart] ?? "";
  }
  return `${tens[tenPart] ?? ""} ${ones[onePart] ?? ""}`.trim();
}

function integerToIndianWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return "";
  }
  if (n === 0) {
    return "zero";
  }

  const parts: string[] = [];
  let remaining = Math.floor(n);

  const crore = Math.floor(remaining / 10000000);
  remaining %= 10000000;
  const lakh = Math.floor(remaining / 100000);
  remaining %= 100000;
  const thousand = Math.floor(remaining / 1000);
  remaining %= 1000;
  const hundred = Math.floor(remaining / 100);
  remaining %= 100;

  if (crore > 0) {
    parts.push(`${integerToIndianWords(crore)} crore`);
  }
  if (lakh > 0) {
    parts.push(`${integerToIndianWords(lakh)} lakh`);
  }
  if (thousand > 0) {
    parts.push(`${integerToIndianWords(thousand)} thousand`);
  }
  if (hundred > 0) {
    parts.push(`${integerToIndianWords(hundred)} hundred`);
  }
  if (remaining > 0) {
    parts.push(numberToWordsUnder100(remaining));
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function decimalNumberToWords(n: number): string {
  if (!Number.isFinite(n)) {
    return "";
  }

  const fixed = n.toString();
  const [wholeRaw, fractionRaw] = fixed.split(".");
  const whole = Number.parseInt(wholeRaw ?? "0", 10);
  if (!fractionRaw) {
    return integerToIndianWords(whole);
  }

  const digits = fractionRaw
    .split("")
    .map((digit) => Number.parseInt(digit, 10))
    .filter((digit) => Number.isFinite(digit))
    .map((digit) => numberToWordsUnder100(digit))
    .join(" ")
    .trim();

  if (!digits) {
    return integerToIndianWords(whole);
  }

  return `${integerToIndianWords(whole)} point ${digits}`.trim();
}

function applyMoneyFormattingLocks(text: string): string {
  let value = text;

  const replaceMoneyToken = (
    amountRaw: string,
    unitRaw: string | undefined,
    appendRupees: boolean
  ): string => {
    const parsed = parseNumericValue(amountRaw);
    if (parsed === null) {
      return `${amountRaw}${unitRaw ? ` ${unitRaw}` : ""}`.trim();
    }

    const normalizedUnit = unitRaw ? MONEY_UNIT_ALIASES[unitRaw.toLowerCase()] : undefined;
    const amountWords = decimalNumberToWords(parsed);
    const unitSuffix = normalizedUnit ? ` ${normalizedUnit}` : "";
    const rupeesSuffix = appendRupees ? " rupees" : "";
    return `${amountWords}${unitSuffix}${rupeesSuffix}`.replace(/\s+/g, " ").trim();
  };

  value = value.replace(/₹\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*([A-Za-z]+)?/g, (_, amountRaw: string, unitRaw?: string) =>
    replaceMoneyToken(amountRaw, unitRaw, true)
  );

  value = value.replace(
    /\b(?:rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*([A-Za-z]+)?\b/gi,
    (_, amountRaw: string, unitRaw?: string) => replaceMoneyToken(amountRaw, unitRaw, true)
  );

  value = value.replace(/\b([0-9][0-9,]*(?:\.[0-9]+)?)\s*(cr|crore|crores|l|lac|lakh|lakhs)\b/gi, (_, amountRaw: string, unitRaw: string) =>
    replaceMoneyToken(amountRaw, unitRaw, false)
  );

  return value;
}

function normalizeBriefSegment(segment: string): string {
  const cleaned = segment
    .replace(/^\s*[*•\-–—]+\s*/g, "")
    .replace(/^\s*\d+\s*[\].:)\-]+\s*/g, "")
    .replace(/\s*[:\-]\s*$/g, "");

  const withoutDurationMentions = DURATION_MENTION_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, " "),
    cleaned
  );

  return compactWhitespace(
    withoutDurationMentions
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/(^|[.?!])\s*[,:;]+\s*/g, "$1 ")
      .replace(/^[,.;:!?-]+\s*/g, "")
      .replace(/\s+[,.!?;:]+$/g, "")
  );
}

function isExcludedBriefSegment(segment: string): boolean {
  return BRIEF_EXCLUSION_PATTERNS.some((pattern) => pattern.test(segment));
}

function compactBriefForScriptInput(brief: string): CompactedBriefResult {
  const originalChars = brief.length;
  const segments = brief
    .replace(/\r\n/g, "\n")
    .split(BRIEF_SEGMENT_SPLIT_REGEX)
    .map((segment) => normalizeBriefSegment(segment))
    .filter((segment) => segment.length > 0 && !DURATION_STANDALONE_LABEL_PATTERN.test(segment));

  const deduped: string[] = [];
  const seen = new Set<string>();
  let removedSegments = 0;

  for (const segment of segments) {
    if (isExcludedBriefSegment(segment)) {
      removedSegments += 1;
      continue;
    }

    const dedupeKey = segment.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    deduped.push(segment);
  }

  const fallbackSegments = segments.filter((segment) => !isExcludedBriefSegment(segment));
  const candidate = deduped.length > 0 ? deduped.join(". ") : fallbackSegments.join(". ");
  const compactedCandidate = compactWhitespace(candidate);
  const compactedBrief = trimToChars(
    compactedCandidate.length > 0 ? compactedCandidate : "No additional brief context provided.",
    SCRIPT_INPUT_BRIEF_MAX_CHARS
  );

  return {
    compactedBrief,
    removedSegments,
    originalChars,
    compactedChars: compactedBrief.length
  };
}

function getScriptWordBudget(durationSeconds: number): ScriptWordBudget {
  if (durationSeconds <= 4) {
    return { minWords: 6, maxWords: 12 };
  }
  if (durationSeconds <= 8) {
    return { minWords: 12, maxWords: 22 };
  }
  if (durationSeconds <= 12) {
    return { minWords: 20, maxWords: 34 };
  }
  if (durationSeconds <= 16) {
    return { minWords: 28, maxWords: 46 };
  }
  return { minWords: 36, maxWords: 58 };
}

function getShotPlan(durationSeconds: number): ShotPlan {
  if (durationSeconds <= 8) {
    return { minShots: 3, maxShots: 4 };
  }
  if (durationSeconds <= 12) {
    return { minShots: 4, maxShots: 6 };
  }
  if (durationSeconds <= 16) {
    return { minShots: 5, maxShots: 7 };
  }
  return { minShots: 6, maxShots: 8 };
}

function hasShotByShotStructure(text: string): boolean {
  const matches = text.match(/(?:^|\n)\s*(?:shot|scene)\s+\d+\b/gi);
  return Boolean(matches && matches.length >= 2);
}

function hasSectionedPromptStructure(prompt: string): boolean {
  const requiredSections = ["video overview", "protagonist", "lighting", "style", "cultural anchoring", "absolute rules"];
  const lower = prompt.toLowerCase();
  return requiredSections.every((section) => lower.includes(section));
}

function hasScreenplayStructure(script: string): boolean {
  const hasCharacters = /(?:^|\n)\s*\[?characters\]?\s*:?/i.test(script);
  const hasSetting = /(?:^|\n)\s*\[?setting\]?\s*:?/i.test(script);
  const hasScreenplay = /(?:^|\n)\s*\[?screenplay\]?\s*:?/i.test(script);
  const hasShots = hasShotByShotStructure(script);
  return hasCharacters && hasSetting && hasScreenplay && hasShots;
}

function rewriteRiskyActionLine(line: string): string {
  if (!/^\s*-\s*action:/i.test(line)) {
    return line;
  }

  if (/\b(drink|drinks|drinking|sip|sips|sipping|gulp|gulps|gulping|pour|pours|pouring)\b/i.test(line)) {
    return "- Action: Keeps movement simple and stable; raises cup/glass for an implied sip only, no visible liquid transfer or pouring detail.";
  }

  if (
    /\b(open|opens|opening|close|closes|closing|turn|turns|turning)\b.{0,28}\b(door|doorknob|handle|latch)\b/i.test(line) ||
    /\b(door|doorknob|handle|latch)\b.{0,28}\b(open|opens|opening|close|closes|closing)\b/i.test(line)
  ) {
    return "- Action: Moves through an already-open doorway with a clean pass-through; no knob/latch mechanics shown.";
  }

  if (
    /\b(type|types|typing|tap|taps|tapping|swipe|swipes|swiping|press|presses|pressing|click|clicks|clicking)\b/i.test(line) &&
    /\b(phone|screen|button|keyboard|keypad|app|ui|terminal|device)\b/i.test(line)
  ) {
    return "- Action: Uses one clear deliberate gesture with minimal finger motion; avoid tiny UI-detail interaction.";
  }

  return line;
}

function enforceActionRealismInScript(script: string): string {
  return script
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      if (/^\s*-\s*visual:/i.test(line)) {
        const visualAsAction = line.replace(/^\s*-\s*visual:/i, "- Action:");
        const rewritten = rewriteRiskyActionLine(visualAsAction);
        if (rewritten !== visualAsAction) {
          return rewritten.replace(/^\s*-\s*Action:/i, "- Visual:");
        }
      }
      return line;
    })
    .join("\n");
}

function ensureActionRealismRules(prompt: string): string {
  const lines = prompt
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => rewriteRiskyActionLine(line));
  const withRewrites = lines.join("\n").trim();
  const lower = withRewrites.toLowerCase();

  const missingRuleLines = ACTION_REALISM_RULE_LINES.filter((rule) => !lower.includes(rule.toLowerCase()));
  if (missingRuleLines.length === 0) {
    return withRewrites;
  }

  const sectionHeader = "I) ACTION REALISM & BLOCKING RULES";
  const withSection = lower.includes("action realism")
    ? withRewrites
    : `${withRewrites}\n${sectionHeader}\n${missingRuleLines.map((line) => `- ${line}`).join("\n")}`;

  return withSection.trim();
}

function removeEndSlateAndSuperLines(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !END_SLATE_SUPER_LINE_PATTERN.test(line))
    .join("\n");
}

function removeOverlayMentionsFromShotSections(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cleaned: string[] = [];
  let inShotSection = false;

  for (const line of lines) {
    if (/^\s*(?:\[SCREENPLAY\]|SCENE\s+\d+|SHOT\s+\d+)/i.test(line)) {
      inShotSection = true;
    }

    if (/^\s*[A-Z]\)\s+/i.test(line) && !/^\s*C\)\s*SCENE BREAKDOWN/i.test(line)) {
      inShotSection = false;
    }

    const isShotField =
      /^\s*-\s*(?:Visual|Camera|Performance|VO\/Dialogue|Dialogue\/VO|Subject|Action|Setting|Lighting\s*&\s*Color|Audio):/i.test(
        line
      );

    if ((inShotSection || isShotField) && OVERLAY_TEXT_PATTERN.test(line)) {
      if (/^\s*-\s*(?:VO\/Dialogue|Dialogue\/VO):/i.test(line)) {
        cleaned.push(line.replace(/:\s*.*/, ": Spoken VO only."));
      }
      continue;
    }

    cleaned.push(line);
  }

  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function enforceScriptLocks(
  script: string,
  _options: { voiceProductName: string; conversionMode: boolean; featureCandidates: string[] }
): string {
  const cleanedLines = script
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, "  ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .map((line) => line.replace(/\u00a0/g, " "))
    .map((line, index, lines) => {
      if (line.trim().length > 0) {
        return line;
      }
      const previous = lines[index - 1];
      if (!previous || previous.trim().length === 0) {
        return "__REMOVE_BLANK__";
      }
      return "";
    })
    .filter((line) => line !== "__REMOVE_BLANK__");

  return cleanedLines.join("\n").trim();
}

function enforcePromptLocks(
  prompt: string,
  _options: { voiceProductName: string; conversionMode: boolean; featureCandidates: string[] }
): string {
  return prompt
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildScriptWriterPrompt(row: SoraStudioResolvedInputRow, compactedBrief: string): string {
  const budget = getScriptWordBudget(row.requestedDurationSeconds);
  const shotPlan = getShotPlan(row.requestedDurationSeconds);
  const voiceProductName = deriveVoiceProductName(row.product);
  const conversionMode = isConversionOrBofuObjective(row);
  const featureCandidates = extractFeatureCandidates(compactedBrief, 5);
  const attachmentSummary =
    Array.isArray(row.briefAttachments) && row.briefAttachments.length > 0
      ? row.briefAttachments
          .slice(0, 8)
          .map((item, index) => `${index + 1}. ${item.mediaType.toUpperCase()} - ${item.name}`)
          .join(" | ")
      : "None";

  return [
    "You are a senior ad scriptwriter and prompt director for India-focused short video ads.",
    "Return STRICT JSON only with keys: script, soraPrompt.",
    "Priority rules (STRICT, highest to lowest):",
    "A) Duration-fit override: script must fit requested duration naturally. If brief copy is too long, compress/rewrite aggressively.",
    "A.1) Prompt-owned internal brief compaction: before writing, silently clean the brief by removing legal/T&C/disclaimer content, supers/end-slate instructions, UI/screen/device references, duration mentions, and card/PoS operation cues.",
    "B) Objective override: Business Objective overrides any conflicting brief framing.",
    "C) Tone of Voice override: warm, friendly, and reassuring delivery.",
    "C.1) Script timing lock: write script for requested duration exactly, not the render-buffer duration.",
    row.strictParityMode
      ? "D) Strict parity mode is ON: produce one model-neutral script and one model-neutral prompt with no model-specific assumptions."
      : "D) Strict parity mode is OFF: keep outputs model-neutral unless the brief requires explicit specialization.",
    "Hard constraints:",
    "1) Always use Indian faces only.",
    "2) Brand is always Kotak Mahindra Bank.",
    "3) Keep script in the requested language.",
    "4) Keep narrative aligned to business objective first, then brief.",
    "5) soraPrompt must be production-ready for text-to-video.",
    "6) No visible written characters, branded marks, or interface displays in-frame.",
    "6.1) Input brief has been compacted; do not reintroduce removed legal/overlay/UI/device directives.",
    "6.2) Do not show physical card closeups, card swipes/taps/inserts, or PoS/payment-device visuals in any scene.",
    "7) Brand world is affluent urban Indians; premium modern urban India environments.",
    "8) Performance should feel natural with Indian English accent.",
    "9) Palette and look-and-feel must be decided by the brief/script; do not force a universal color style.",
    "10) If palette is not specified, default to colorful vibrant social-media creative aesthetics with natural skin tones.",
    "11) Write all Hindi words in Devanagari script (never Romanized Hindi).",
    "12) Devanagari examples to enforce when these words appear: Kotak -> कोटक, Hausla -> हौसला, Hauslo/Hauslon -> हौस्लो.",
    "12.1) Currency formatting lock in script dialogue/VO: never use symbols or short forms like ₹, Rs, INR, Cr, L, Lac.",
    "12.2) Always spell money in words (example: ₹80,000 -> eighty thousand rupees, 1Cr -> one crore, 5L -> five lakh).",
    "13) script must be written like a screenplay and must explicitly define characters and setting.",
    "14) soraPrompt must be shot-by-shot, timecoded, and production-directable (not one long paragraph).",
    "14.1) In screenplay and scene-breakdown shots, keep dialogue spoken only and avoid any written-display instructions.",
    "14.2) In spoken VO/dialogue, never say Kotak. Use product-name voice only.",
    "14.3) Product-name voice for this request is:",
    `14.3.1) "${voiceProductName}"`,
    "15) Keep a single protagonist continuity unless the brief explicitly needs multiple heroes.",
    "16) Physical realism is mandatory: prefer low-risk, clear, grounded action beats that are easy for text-to-video to execute.",
    "17) For risky actions (drinking, pouring, opening doors, tiny UI taps, typing), rewrite to implied or simplified beats.",
    "18) Keep one primary action per scene and avoid simultaneous object interactions.",
    "19) For interaction shots, use mid/wide framing and keep hands + props fully visible.",
    "20) Cut before/after tricky contact peaks; avoid prolonged closeups of complex mechanics.",
    "21) If brief attachments are provided, use them as visual reference anchors for style/composition/pacing; do not introduce UI/supers/end-slate directives.",
    "22) If attachments are present in this request payload, inspect them directly before writing.",
    "23) Final shot closing lock (prompt-owned; no post-processing expected): the last spoken line must naturally echo the first spoken line's core thought/theme.",
    "23.1) Use mirrored language or a clear thematic callback (city/travel/ambition/family/value) from opening to closing.",
    "23.2) Never use meta phrases like 'opening promise comes full circle', 'opening thought', or similar self-referential wording.",
    "23.3) Last spoken line must be complete, warm, and human-sounding with proper punctuation and balanced quotes.",
    "23.4) Outputs must already satisfy all constraints exactly as written; do not rely on any downstream cleanup, rewriting, or post-processing.",
    conversionMode
      ? "24) Conversion/Leads/BOFU lock: explicitly include concrete RTBs/features in both dialogue and scene action descriptions."
      : "24) If objective is not conversion/leads/BOFU, keep feature mentions proportional to brief relevance.",
    featureCandidates.length > 0 ? `24.1) Candidate RTBs/features from input brief: ${featureCandidates.join(" | ")}` : "24.1) Candidate RTBs/features: none extracted.",
    "",
    "Strict formatting contract for `script`:",
    "Use exactly these top-level sections in this order:",
    "[CHARACTERS]",
    "- Name/Label | age range | appearance | wardrobe | performance vibe",
    "[SETTING]",
    "- Place, time of day, and atmosphere",
    "[SCREENPLAY]",
    "SHOT 1 (time range)",
    "- Visual:",
    "- Camera:",
    "- Performance:",
    "- VO/Dialogue:",
    "SHOT 2 (time range)",
    "- Visual:",
    "- Camera:",
    "- Performance:",
    "- VO/Dialogue:",
    "Continue until final shot. Keep screenplay concise and duration-accurate.",
    "",
    "Strict formatting contract for `soraPrompt`:",
    "Write in this sectioned structure style, inspired by high-end creator briefs:",
    "A) VIDEO OVERVIEW",
    "- One compact paragraph defining duration, format, story intent, and performance mode.",
    "B) PROTAGONIST",
    "- Identity, age band, look, wardrobe, performance energy.",
    "- Continuity lock sentence: same face/identity/wardrobe across all scenes.",
    "C) SCENE BREAKDOWN (timecoded)",
    "SCENE 1 (time range)",
    "- Subject:",
    "- Action:",
    "- Setting:",
    "- Camera:",
    "- Lighting & Color:",
    "- Audio:",
    "- Dialogue/VO:",
    "SCENE 2 (time range)",
    "- Subject:",
    "- Action:",
    "- Setting:",
    "- Camera:",
    "- Lighting & Color:",
    "- Audio:",
    "- Dialogue/VO:",
    "Continue until final scene. Target scene count from guardrail below.",
    "D) LIGHTING & COLOR SYSTEM",
    "- Explicit visual palette and tonal direction.",
    "E) STYLE & CAMERA SYSTEM",
    "- Realism level, movement style, lens/framing behavior, edit rhythm.",
    "F) CULTURAL ANCHORING",
    "- Explicitly Indian social and environmental cues; avoid generic global/western look.",
    "G) DIALOGUE DELIVERY NOTES",
    "- Tone guidance for each line delivery and pacing.",
    "H) ABSOLUTE RULES",
    "- Non-negotiables list.",
    "I) ACTION REALISM & BLOCKING RULES",
    "- Enforce physically grounded, low-risk action design per scene.",
    "Every scene must be concrete, cinematic, and directly renderable.",
    "Do not return soraPrompt as a single prose paragraph.",
    "",
    `Product: ${row.product}`,
    `Brief (raw input): ${compactedBrief}`,
    `Business Objective: ${row.businessObjective || "Not provided"}`,
    `Script Duration Target: ${row.requestedDurationSeconds}s exactly.`,
    `Render Duration Note: rendering may use ${row.requestDurationSeconds}s due to model constraints; do not write script pacing for this buffer.`,
    `Video Duration (raw input): ${row.videoDuration || `${row.requestedDurationSeconds}s`}`,
    `Script Length Guardrail: target ${budget.minWords}-${budget.maxWords} words for natural VO fit.`,
    `Shot Count Guardrail: target ${shotPlan.minShots}-${shotPlan.maxShots} shots.`,
    `Ratio / Dimensions: ${row.ratioDimensions || row.requestedAspectRatio} (render ratio is ${row.renderAspectRatio})`,
    `Language: ${row.resolvedLanguage}`,
    `Strict Parity Mode: ${row.strictParityMode ? "ON" : "OFF"}`,
    `Brief Attachments: ${attachmentSummary}`,
    "",
    "Output JSON schema:",
    '{"script":"...", "soraPrompt":"..."}'
  ].join("\n");
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeBriefAttachmentUrls(row: SoraStudioResolvedInputRow): { imageUrls: string[]; videoUrls: string[] } {
  const imageUrls: string[] = [];
  const videoUrls: string[] = [];
  const seen = new Set<string>();

  for (const item of row.briefAttachments ?? []) {
    const url = compactWhitespace(item.url || "");
    if (!url || seen.has(url) || !isHttpUrl(url)) {
      continue;
    }
    seen.add(url);
    if (item.mediaType === "image") {
      imageUrls.push(url);
      continue;
    }
    if (item.mediaType === "video") {
      videoUrls.push(url);
    }
  }

  return {
    imageUrls: imageUrls.slice(0, MAX_SCRIPT_IMAGE_ATTACHMENTS),
    videoUrls: videoUrls.slice(0, MAX_SCRIPT_VIDEO_ATTACHMENTS)
  };
}

function appendAttachmentUrlContext(
  prompt: string,
  attachments: { imageUrls: string[]; videoUrls: string[] }
): string {
  if (attachments.imageUrls.length === 0 && attachments.videoUrls.length === 0) {
    return prompt;
  }

  const lines: string[] = ["", "ATTACHMENT URL CONTEXT (brief-stage references):"];
  attachments.imageUrls.forEach((url, index) => {
    lines.push(`- IMAGE_REF_${index + 1}: ${url}`);
  });
  attachments.videoUrls.forEach((url, index) => {
    lines.push(`- VIDEO_REF_${index + 1}: ${url}`);
  });
  return `${prompt}${lines.join("\n")}`.trim();
}

function buildScriptGenerationRequestPlans(
  row: SoraStudioResolvedInputRow,
  prompt: string,
  model: string
): ScriptGenerationRequestPlan[] {
  const attachments = normalizeBriefAttachmentUrls(row);
  const promptWithAttachmentUrls = appendAttachmentUrlContext(prompt, attachments);
  const plans: ScriptGenerationRequestPlan[] = [];

  if (attachments.imageUrls.length > 0) {
    const warnings = [
      `Sent ${attachments.imageUrls.length} image attachment(s) to Claude via ${FAL_VISION_GENERATION_ENDPOINT}.`
    ];
    if (attachments.videoUrls.length > 0) {
      warnings.push(
        `Video attachments are not supported in ${FAL_VISION_GENERATION_ENDPOINT}; video URLs were added as context in prompt text.`
      );
    }

    plans.push({
      endpoint: FAL_VISION_GENERATION_ENDPOINT,
      input: {
        model,
        prompt: promptWithAttachmentUrls,
        image_urls: attachments.imageUrls
      },
      warnings
    });
  }

  if (attachments.imageUrls.length === 0 && attachments.videoUrls.length > 0) {
    plans.push({
      endpoint: FAL_VIDEO_GENERATION_ENDPOINT,
      input: {
        model,
        prompt: promptWithAttachmentUrls,
        video_urls: attachments.videoUrls
      },
      warnings: [`Sent ${attachments.videoUrls.length} video attachment(s) via ${FAL_VIDEO_GENERATION_ENDPOINT}.`]
    });
  }

  plans.push({
    endpoint: FAL_TEXT_GENERATION_ENDPOINT,
    input: {
      model,
      prompt: promptWithAttachmentUrls
    },
    warnings:
      attachments.imageUrls.length > 0 || attachments.videoUrls.length > 0
        ? ["Fallback plan: attachments retained as URL context in text prompt."]
        : []
  });

  return plans;
}

export async function generateSoraStudioScriptAndPromptWithAnthropicFal(
  row: SoraStudioResolvedInputRow
): Promise<SoraStudioAnthropicFalOutput> {
  fal.config({ credentials: requireFalApiKey() });

  const promptBriefInput = row.brief;
  const voiceProductName = deriveVoiceProductName(row.product);
  const conversionMode = isConversionOrBofuObjective(row);
  const featureCandidates = extractFeatureCandidates(promptBriefInput, 5);
  const prompt = buildScriptWriterPrompt(row, promptBriefInput);
  const model = ANTHROPIC_FAL_MODEL;
  const requestPlans = buildScriptGenerationRequestPlans(row, prompt, model);
  const warnings: string[] = [];
  const endpointErrors: string[] = [];

  for (const plan of requestPlans) {
    try {
      const response = (await fal.run(plan.endpoint, {
        input: plan.input
      })) as FalAnyLlmResult;

      const text = response.data?.output?.trim();
      if (!text) {
        throw new Error(`${plan.endpoint} returned empty output.`);
      }

      const parsed = outputSchema.parse(parseJsonObject(text));
      if (!hasScreenplayStructure(parsed.script)) {
        throw new Error("Generated script missing screenplay structure (CHARACTERS + SETTING + SHOT format).");
      }
      if (!hasShotByShotStructure(parsed.soraPrompt)) {
        throw new Error("Generated soraPrompt missing shot-by-shot structure.");
      }
      if (!hasSectionedPromptStructure(parsed.soraPrompt)) {
        throw new Error("Generated soraPrompt missing required sectioned structure.");
      }

      warnings.push(...plan.warnings);
      if (endpointErrors.length > 0) {
        warnings.push(...endpointErrors.map((item) => `Fallback note: ${item.slice(0, 280)}`));
      }

      return {
        script: enforceScriptLocks(parsed.script, {
          voiceProductName,
          conversionMode,
          featureCandidates
        }),
        soraPrompt: enforcePromptLocks(parsed.soraPrompt, {
          voiceProductName,
          conversionMode,
          featureCandidates
        }),
        model,
        scriptWriterPrompt: prompt,
        warnings: Array.from(new Set(warnings)),
        compactedBrief: promptBriefInput
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      endpointErrors.push(`${plan.endpoint}: ${message}`);
      continue;
    }
  }

  throw new Error(
    `Anthropic via fal failed for ${model}. ${endpointErrors.length > 0 ? endpointErrors.join(" | ") : "No endpoint succeeded."}`
  );
}

export function getSoraStudioScriptWriterPromptTemplate(row: SoraStudioResolvedInputRow): string {
  return buildScriptWriterPrompt(row, row.brief);
}
