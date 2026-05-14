import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { PRODUCT_SPECS, ProductSupportingFact } from "@/app/lib/spec";
import {
  DEFAULT_VIDEO_CONFIG,
  isBumperVideoType,
  normalizeVideoTypeForGeneration,
  ProductKey,
  VIDEO_TYPES,
  VideoDurationSeconds,
  VideoType
} from "@/app/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_GEMINI_SCRIPT_MODEL = "gemini-2.5-flash";
const DEFAULT_GEMINI_SCRIPT_FALLBACK_MODELS = ["gemini-2.5-pro"] as const;
const SCRIPT_WORD_ENFORCEMENT_ATTEMPTS = 4;
const GEMINI_SCRIPT_MAX_ATTEMPTS = Number(process.env.GEMINI_SCRIPT_MAX_ATTEMPTS ?? process.env.GENAI_MAX_ATTEMPTS ?? 5);
const GEMINI_SCRIPT_RETRY_BASE_MS = Number(process.env.GEMINI_SCRIPT_RETRY_BASE_MS ?? process.env.GENAI_RETRY_BASE_MS ?? 1200);
const GEMINI_SCRIPT_HTTP_TIMEOUT_MS = Number(process.env.GEMINI_SCRIPT_HTTP_TIMEOUT_MS ?? process.env.GENAI_HTTP_TIMEOUT_MS ?? 120000);
const EIGHT_SECOND_MIN_CHARACTERS = 90;
const EIGHT_SECOND_MAX_CHARACTERS = 115;

const CREATIVE_OBJECTIVES = ["conversion", "consideration", "education", "awareness", "brand", "internal", "unknown"] as const;
const CREATIVE_GENRES = ["performance_ad", "brand_spot", "educational", "product_explainer", "internal_update", "generic"] as const;

type CreativeObjective = (typeof CREATIVE_OBJECTIVES)[number];
type FunnelStage = "bofu" | "mofu" | "tofu" | "internal";
type CreativeChannel = "meta" | "google" | "social" | "shorts" | "internal" | "generic";
type CreativePlacement = "reels" | "stories" | "feed" | "shorts" | "youtube" | "display" | "internal" | "generic";
type CreativeGenre = (typeof CREATIVE_GENRES)[number];
type CreativeRtbPolicy = "required" | "optional" | "bypass";
type CreativeCtaStrength = "hard" | "medium" | "soft" | "none";
type CreativeScriptStyle =
  | "hook-proof-cta"
  | "problem-solution-proof"
  | "educational-clarity"
  | "brand-memory"
  | "internal-update";

interface CreativeStrategy {
  objective: CreativeObjective;
  funnelStage: FunnelStage;
  channel: CreativeChannel;
  placement: CreativePlacement;
  genre: CreativeGenre;
  audienceCue: string;
  rtbPolicy: CreativeRtbPolicy;
  ctaStrength: CreativeCtaStrength;
  scriptStyle: CreativeScriptStyle;
  decisionSource: "llm" | "deterministic_fallback";
  rationale: string;
  matchedSignals: string[];
}

const requestSchema = z.object({
  product: z.enum(["kotak_air_plus", "kotak_cashback"]),
  guidelines: z.string().trim().max(5000).optional(),
  brief: z.string().trim().min(12, "Campaign brief must be at least 12 characters.").max(1200),
  videoType: z.enum(VIDEO_TYPES).default(DEFAULT_VIDEO_CONFIG.type),
  durationSeconds: z.union([z.literal(8), z.literal(15), z.literal(20)]).default(8)
}).superRefine((payload, ctx) => {
  if (isBumperVideoType(payload.videoType) && payload.durationSeconds !== 8) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["durationSeconds"],
      message: "Bumper ads only support 8 seconds."
    });
  }
});

const responseSchema = z.object({
  script: z.string().min(12).max(260)
});

export interface CampaignScriptGenerationInput {
  product: ProductKey;
  guidelines?: string;
  brief: string;
  videoType: VideoType;
  durationSeconds: VideoDurationSeconds;
}

export interface CampaignScriptGenerationResult {
  script: string;
  wordCount: number;
  characterCount: number;
  durationFitOk: boolean;
  durationFitMode: "character_limit" | "word_limits";
  strategy: CreativeStrategy;
  rtbMode: "brief_targeted" | "default_strongest" | "optional" | "bypass";
  rtbCoverageOk: boolean;
  rtbMissing: string[];
  rtbExtra: string[];
}

function optionalEnumFromModel<T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(
    (value) => (typeof value === "string" ? value.trim() || undefined : value),
    z.enum(values).optional()
  );
}

function optionalStringFromModel(maxLength: number) {
  return z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }
      const trimmed = value.trim();
      if (!trimmed) {
        return undefined;
      }
      return trimmed.slice(0, maxLength);
    },
    z.string().trim().max(maxLength).optional()
  );
}

const strategyDecisionSchema = z.object({
  objective: optionalEnumFromModel(CREATIVE_OBJECTIVES),
  genre: optionalEnumFromModel(CREATIVE_GENRES),
  audienceCue: optionalStringFromModel(80),
  rationale: optionalStringFromModel(240),
  matchedSignals: z.preprocess((value) => {
    if (Array.isArray(value)) {
      return value
        .map((item) => (typeof item === "string" ? item.trim().slice(0, 60) : item))
        .filter(Boolean)
        .slice(0, 8);
    }
    if (typeof value === "string") {
      return value
        .replace(/^\[|\]$/g, "")
        .split(/[|,]/)
        .map((item) => item.trim().slice(0, 60))
        .filter(Boolean);
    }
    return [];
  }, z.array(z.string().trim().min(1).max(60)).max(8)).default([])
});

interface HookRule {
  hook: string;
  keywords: string[];
}

function getSupportingFacts(product: ProductKey): ProductSupportingFact[] {
  return PRODUCT_SPECS[product].supportingFacts ?? [];
}

function resolveBriefRelevantSupportingFacts(product: ProductKey, brief: string): ProductSupportingFact[] {
  const normalizedBrief = normalizeForMatch(brief);
  return getSupportingFacts(product).filter((fact) =>
    fact.keywords.some((keyword) => normalizedBrief.includes(normalizeForMatch(keyword)))
  );
}

function getHookRules(product: ProductKey): HookRule[] {
  if (product === "kotak_air_plus") {
    const hooks = PRODUCT_SPECS[product].hooks;
    return [
      {
        hook: hooks[0] ?? "Earn 5% rewards on travel bookings via Kotak Unbox.",
        keywords: [
          "5% rewards",
          "travel bookings",
          "kotak unbox",
          "unbox",
          "travel reward",
          "travel rewards",
          "five air miles",
          "5 air miles",
          "travel spends",
          "five percent rewards on travel",
          "five percent travel rewards",
          "five percent via unbox"
        ]
      },
      {
        hook: hooks[1] ?? "Limited period: joining fee INR 0.",
        keywords: [
          "joining fee",
          "inr 0",
          "zero joining fee",
          "no joining fee",
          "free joining fee",
          "joining fee waived",
          "limited period",
          "zero joining fee",
          "joining fee zero"
        ]
      },
      {
        hook: hooks[2] ?? "Spend INR 1.5L this quarter to unlock a complimentary flight.",
        keywords: [
          "1.5l",
          "1.5 l",
          "1.5 lakh",
          "150000",
          "complimentary flight",
          "free flight",
          "flight ticket",
          "quarter spend",
          "quarterly spend",
          "spend threshold",
          "one and a half lakh",
          "one and half lakh",
          "one-and-a-half lakh"
        ]
      }
    ];
  }

  const hooks = PRODUCT_SPECS[product].hooks;
  return [
    {
      hook: hooks[0] ?? "5% cashback on daily essentials like groceries and milk.",
      keywords: [
        "daily essentials",
        "essentials",
        "groceries",
        "grocery",
        "milk",
        "daily spend",
        "five percent on essentials",
        "five percent cashback on essentials",
        "five percent cashback on daily essentials"
      ]
    },
    {
      hook: hooks[1] ?? "Limited period: joining fee INR 0.",
      keywords: [
        "joining fee",
        "inr 0",
        "zero joining fee",
        "no joining fee",
        "free joining fee",
        "joining fee waived",
        "limited period",
        "zero joining fee",
        "joining fee zero"
      ]
    },
    {
      hook: hooks[2] ?? "5% cashback on entertainment.",
      keywords: [
        "entertainment",
        "movies",
        "movie",
        "ott",
        "streaming",
        "cinema",
        "five percent on entertainment",
        "five percent cashback on entertainment"
      ]
    },
    {
      hook: hooks[3] ?? "Up to 4% benefit on fuel spends.",
      keywords: [
        "up to 4%",
        "4% fuel",
        "fuel",
        "fuel spends",
        "fuel savings",
        "petrol",
        "diesel",
        "pump",
        "up to four percent",
        "four percent on fuel",
        "up to four percent on fuel"
      ]
    }
  ];
}

function getSelectedProductName(product: ProductKey): string {
  return product === "kotak_air_plus" ? "Kotak Air Plus" : "Kotak Cashback+";
}

function getDefaultStrongestRule(product: ProductKey): HookRule {
  const rules = getHookRules(product);
  if (product === "kotak_air_plus") {
    return rules[0]!;
  }
  return rules[0]!;
}

function getRelevantSupportingFactPromptLines(product: ProductKey, brief: string): string[] {
  const relevantSupportingFacts = resolveBriefRelevantSupportingFacts(product, brief).slice(0, 5);
  if (relevantSupportingFacts.length === 0) {
    return [];
  }
  return [
    "Brief-relevant supporting product facts:",
    ...relevantSupportingFacts.map((fact) => `- ${fact.fact}`),
    "- These are real supporting offerings for this product.",
    "- Use them only if they directly match the campaign brief.",
    "- Do not force the default RTB when one of these supporting offerings is clearly the hero message in the brief."
  ];
}

function extractBriefOfferAnchor(brief: string): string | null {
  const normalizedBrief = normalizeForMatch(brief);
  if (
    /\btravel privileges\b/i.test(normalizedBrief) &&
    /\b(?:80 000|80000|eighty thousand|over eighty thousand|annual value|annual savings)\b/i.test(normalizedBrief)
  ) {
    return "travel privileges worth over Rs. 80,000";
  }

  const looksLikeOfferAnchor = (candidate: string): boolean => {
    const normalizedCandidate = normalizeForMatch(candidate);
    return /\b(complimentary|free|lounge|guest pass|guest access|access|voucher|joining fee|annual fee|markup|forex|reward|rewards|cashback|flight|benefit|welcome benefit|renewal benefit|priority pass|travel value|travel reward|travel privileges|privileges|annual savings|annual value)\b/i.test(
      normalizedCandidate
    );
  };

  const patterns = [
    /\b(?:hero offer only|hero offer|hero offering|hero point|hero message|new offer|offer is|campaign offer)\s*[:\-]?\s*([^.!?\n]+)/i,
    /\bget\s+([^.!?\n]+?)\s+(?:with|on)\s+kotak air plus\b/i,
    /\b(?:new|limited period|limited-time|summer|anniversary|seasonal)\s+offer\s*[:\-]?\s*([^.!?\n]+)/i,
    /\bbuilt around\s+(?:a\s+)?(?:new|limited period|limited-time|summer|anniversary|seasonal)?\s*offer\s*[:\-]?\s*([^.!?\n]+)/i,
    /\b(?:offer|offering|promo|promotion)\s*[:\-]\s*([^.!?\n]+)/i,
    /\b(?:focus on|highlight|call out|feature|lead with|center on|built around|push|spotlight|emphasize)\s+(?:the\s+)?([^.!?\n]+)/i
  ];

  for (const pattern of patterns) {
    const match = brief.match(pattern);
    const candidate = match?.[1]
      ?.replace(/\b(?:mention that only|talk about that only|keep it sharp|keep it direct|one message only|dont shift to default rewards)\b/gi, "")
      .replace(/\bfor air plus users\b/gi, "")
      .replace(/\bwith kotak air plus\b/gi, "")
      .replace(/\bon kotak air plus\b/gi, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[,:;\-\s]+|[,:;\-\s]+$/g, "");
    if (candidate && looksLikeOfferAnchor(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getBriefOfferPromptLines(brief: string): string[] {
  const offerAnchor = extractBriefOfferAnchor(brief);
  if (!briefExplicitlyMentionsOffer(normalizeForMatch(brief)) && !offerAnchor) {
    return [];
  }
  return [
    "Brief-offer rule:",
    "- If the campaign brief states a specific offer or hero offer, accept that offer as valid working input for this generation.",
    "- Offers can change over time, so do not reject or overwrite a brief-stated offer just because it is not in the current RTB list.",
    "- Treat the brief-stated offer as the hero message whenever one is present.",
    "- Do not replace a brief-stated offer with the default strongest RTB or default travel rewards language.",
    "- If timing is tight, compress the brief-stated offer naturally but preserve its core meaning.",
    "- Only fall back to the default strongest RTB when the brief itself is ambiguous."
    ,
    ...(offerAnchor ? [`- Brief-stated offer to preserve: ${offerAnchor}`] : [])
  ];
}

function doesScriptPreserveBriefOffer(brief: string, script: string): boolean {
  const offerAnchor = extractBriefOfferAnchor(brief);
  if (!offerAnchor) {
    return true;
  }

  const normalizedScript = normalizeForMatch(script);
  const normalizedAnchor = normalizeForMatch(offerAnchor);
  if (normalizedScript.includes(normalizedAnchor)) {
    return true;
  }

  const stopwords = new Set([
    "get",
    "with",
    "on",
    "for",
    "this",
    "that",
    "only",
    "offer",
    "hero",
    "new",
    "the",
    "and",
    "air",
    "plus",
    "kotak",
    "users"
  ]);
  const signalTokens = normalizedAnchor
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !stopwords.has(token));

  let matched = 0;
  for (const token of signalTokens) {
    if (normalizedScript.includes(token)) {
      matched += 1;
    }
  }

  return matched >= Math.min(3, signalTokens.length);
}

function detectCreativeObjective(normalizedBrief: string, addSignal: (signal: string) => void): CreativeObjective {
  if (
    /\b(internal communication|internal comms|employee update|employees|town ?hall|all hands|leadership update|company update|org update|sales kickoff|training module|training update|enablement)\b/i.test(
      normalizedBrief
    )
  ) {
    addSignal("objective:internal");
    return "internal";
  }

  if (
    /\b(conversion|conversions|performance|lead gen|lead generation|applications?|apply|installs?|signups?|purchase|sales|roas|cpa|cpl|direct response|retargeting|remarketing)\b/i.test(
      normalizedBrief
    )
  ) {
    addSignal("objective:conversion");
    return "conversion";
  }

  if (/\b(consideration|consider|comparison|why choose|why switch|evaluate|evaluation|learn more)\b/i.test(normalizedBrief)) {
    addSignal("objective:consideration");
    return "consideration";
  }

  if (/\b(education|educational|educate|explainer|how to|how-to|tutorial|guide|walkthrough|understand|awareness through education)\b/i.test(normalizedBrief)) {
    addSignal("objective:education");
    return "education";
  }

  if (/\b(brand|brand film|brand campaign|spot|anthem|launch film)\b/i.test(normalizedBrief)) {
    addSignal("objective:brand");
    return "brand";
  }

  if (/\b(awareness|reach|recall|launch|buzz|salience)\b/i.test(normalizedBrief)) {
    addSignal("objective:awareness");
    return "awareness";
  }

  return "unknown";
}

function detectCreativeChannel(normalizedBrief: string, addSignal: (signal: string) => void): CreativeChannel {
  if (/\b(internal communication|internal comms|employee|town ?hall|all hands|leadership)\b/i.test(normalizedBrief)) {
    addSignal("channel:internal");
    return "internal";
  }
  if (/\b(meta|facebook|instagram|ig|paid social)\b/i.test(normalizedBrief)) {
    addSignal("channel:meta");
    return "meta";
  }
  if (/\b(google|youtube|gdn|adwords|search campaign|display campaign)\b/i.test(normalizedBrief)) {
    addSignal("channel:google");
    return "google";
  }
  if (/\b(shorts?)\b/i.test(normalizedBrief)) {
    addSignal("channel:shorts");
    return "shorts";
  }
  if (/\b(social media|social)\b/i.test(normalizedBrief)) {
    addSignal("channel:social");
    return "social";
  }
  return "generic";
}

function detectCreativePlacement(normalizedBrief: string, addSignal: (signal: string) => void): CreativePlacement {
  if (/\b(internal communication|internal comms|employee|town ?hall|all hands|leadership)\b/i.test(normalizedBrief)) {
    addSignal("placement:internal");
    return "internal";
  }
  if (/\b(reels?)\b/i.test(normalizedBrief)) {
    addSignal("placement:reels");
    return "reels";
  }
  if (/\b(stories?)\b/i.test(normalizedBrief)) {
    addSignal("placement:stories");
    return "stories";
  }
  if (/\b(feed)\b/i.test(normalizedBrief)) {
    addSignal("placement:feed");
    return "feed";
  }
  if (/\b(youtube shorts|shorts?)\b/i.test(normalizedBrief)) {
    addSignal("placement:shorts");
    return "shorts";
  }
  if (/\b(youtube|pre[- ]?roll|bumper)\b/i.test(normalizedBrief)) {
    addSignal("placement:youtube");
    return "youtube";
  }
  if (/\b(display|banner)\b/i.test(normalizedBrief)) {
    addSignal("placement:display");
    return "display";
  }
  return "generic";
}

function detectCreativeGenre(
  normalizedBrief: string,
  objective: CreativeObjective,
  addSignal: (signal: string) => void
): CreativeGenre {
  if (objective === "internal") {
    addSignal("genre:internal_update");
    return "internal_update";
  }
  if (/\b(brand film|brand campaign|brand spot|spot|anthem|launch film|launch video)\b/i.test(normalizedBrief)) {
    addSignal("genre:brand_spot");
    return "brand_spot";
  }
  if (/\b(education|educational|how to|how-to|tutorial|guide|walkthrough)\b/i.test(normalizedBrief)) {
    addSignal("genre:educational");
    return "educational";
  }
  if (/\b(explainer|product explainer|feature explainer|demo|demonstration|product walkthrough)\b/i.test(normalizedBrief)) {
    addSignal("genre:product_explainer");
    return "product_explainer";
  }
  if (/\b(performance marketing|performance ad|conversion ad|lead gen|retargeting|remarketing|direct response)\b/i.test(normalizedBrief)) {
    addSignal("genre:performance_ad");
    return "performance_ad";
  }
  if (objective === "conversion") {
    return "performance_ad";
  }
  if (objective === "consideration" || objective === "education") {
    return "product_explainer";
  }
  if (objective === "awareness" || objective === "brand") {
    return "brand_spot";
  }
  return "generic";
}

function detectFunnelStage(
  objective: CreativeObjective,
  genre: CreativeGenre,
  addSignal: (signal: string) => void
): FunnelStage {
  if (objective === "internal" || genre === "internal_update") {
    addSignal("funnel:internal");
    return "internal";
  }
  if (objective === "conversion") {
    addSignal("funnel:bofu");
    return "bofu";
  }
  if (objective === "consideration" || objective === "education") {
    addSignal("funnel:mofu");
    return "mofu";
  }
  if (objective === "awareness" || objective === "brand") {
    addSignal("funnel:tofu");
    return "tofu";
  }
  if (genre === "performance_ad") {
    addSignal("funnel:bofu");
    return "bofu";
  }
  if (genre === "educational" || genre === "product_explainer") {
    addSignal("funnel:mofu");
    return "mofu";
  }
  if (genre === "brand_spot") {
    addSignal("funnel:tofu");
    return "tofu";
  }
  addSignal("funnel:mofu_default");
  return "mofu";
}

function briefExplicitlyRequestsRtb(normalizedBrief: string): boolean {
  return /\b(focus on|highlight|call out|mention|include|feature|talk about)\b[\w\s,.-]{0,80}\b(rtb|benefit|offer|feature|cashback|reward|rewards|joining fee|annual fee|flight|fuel|travel|forex|air miles|lounge|priority pass|voucher|welcome benefit|renewal benefit|redemption|transfer|partner|markup|surcharge)\b/i.test(
    normalizedBrief
  );
}

function briefExplicitlyMentionsOffer(normalizedBrief: string): boolean {
  return (
    /\b(hero offer|hero offering|hero point|hero message|offer is|offering is|offer|offering|promo|promotion|limited period|campaign offer)\b/i.test(
      normalizedBrief
    ) ||
    /\b(focus on|highlight|call out|feature|lead with|center on|built around|push|spotlight|emphasize)\b[\w\s,.-]{0,90}\b(complimentary|free|lounge|guest pass|guest access|access|voucher|joining fee|annual fee|markup|forex|reward|rewards|cashback|flight|benefit|welcome benefit|renewal benefit|priority pass|travel privileges|privileges|annual value|annual savings)\b/i.test(
      normalizedBrief
    )
  );
}

function detectOutOfScopeBrief(product: ProductKey, brief: string): string | null {
  const normalizedBrief = normalizeForMatch(brief);
  const explicitDisavowal =
    /\b(not about cards?|nothing to do with banking|nothing to do with credit cards?|not about banking|not related to credit cards?|dont make it about cards?|do not make it about cards?)\b/i.test(
      normalizedBrief
    );
  const unrelatedAsk =
    /\b(birthday|birthday invite|wedding invite|anniversary invite|party invite|cricket match|ipl match|sports hype|poem|lyrics|recipe|horoscope|wedding speech|standup set|stand-up set)\b/i.test(
      normalizedBrief
    );
  const productSignals = [
    getSelectedProductName(product),
    ...getHookRules(product).flatMap((rule) => rule.keywords),
    ...getSupportingFacts(product).flatMap((fact) => fact.keywords),
    "credit card",
    "card",
    "bank",
    product === "kotak_air_plus" ? "travel" : "cashback"
  ].some((signal) => normalizedBrief.includes(normalizeForMatch(signal)));

  if ((explicitDisavowal || unrelatedAsk) && !productSignals) {
    return `Campaign brief is out of scope for ${getSelectedProductName(product)} script generation. It asks for unrelated content instead of a product or campaign brief. Rewrite it around the card, audience, offer, use case, or objective.`;
  }

  if (explicitDisavowal) {
    return `Campaign brief is out of scope for ${getSelectedProductName(product)} script generation because it explicitly rejects card or banking context. Rewrite it around the product, audience, offer, use case, or objective.`;
  }

  return null;
}

function hasInternalIntent(normalizedBrief: string): boolean {
  return /\b(internal communication|internal comms|internal|employee|employees|staff|team|branch teams|relationship managers|rm\b|training|enablement|town ?hall|all hands|leadership|rollout update|sales kickoff|sales onboarding|product training|internal circulation)\b/i.test(
    normalizedBrief
  );
}

function hasReviewAction(normalizedBrief: string): boolean {
  return /\b(action required|please review|review deck|review meeting|review later|attend|complete|register)\b/i.test(normalizedBrief);
}

function detectRtbPolicy(
  product: ProductKey,
  normalizedBrief: string,
  funnelStage: FunnelStage,
  briefTargetedRules: HookRule[],
  addSignal: (signal: string) => void
): CreativeRtbPolicy {
  const briefRelevantSupportingFacts = resolveBriefRelevantSupportingFacts(product, normalizedBrief);
  if (briefTargetedRules.length > 0) {
    addSignal("rtb:brief_targeted");
    return "required";
  }
  if (briefRelevantSupportingFacts.length > 0) {
    addSignal("rtb:supporting_fact_optional");
    return "optional";
  }
  if (briefExplicitlyMentionsOffer(normalizedBrief)) {
    addSignal("rtb:freeform_offer_optional");
    return "optional";
  }
  if (funnelStage === "bofu") {
    addSignal("rtb:required");
    return "required";
  }
  if (funnelStage === "mofu" || funnelStage === "tofu") {
    addSignal("rtb:optional");
    return "optional";
  }
  if (briefExplicitlyRequestsRtb(normalizedBrief)) {
    addSignal("rtb:internal_optional");
    return "optional";
  }
  addSignal("rtb:bypass");
  return "bypass";
}

function detectCtaStrength(
  normalizedBrief: string,
  funnelStage: FunnelStage,
  addSignal: (signal: string) => void
): CreativeCtaStrength {
  if (/\b(no cta|without cta|no call to action)\b/i.test(normalizedBrief)) {
    addSignal("cta:none");
    return "none";
  }
  if (funnelStage === "bofu") {
    addSignal("cta:hard");
    return "hard";
  }
  if (funnelStage === "mofu") {
    addSignal("cta:medium");
    return "medium";
  }
  if (funnelStage === "tofu") {
    addSignal("cta:soft");
    return "soft";
  }
  if (/\b(action required|please review|register|attend|complete)\b/i.test(normalizedBrief)) {
    addSignal("cta:medium");
    return "medium";
  }
  addSignal("cta:none");
  return "none";
}

function detectScriptStyle(
  funnelStage: FunnelStage,
  genre: CreativeGenre,
  addSignal: (signal: string) => void
): CreativeScriptStyle {
  if (funnelStage === "internal" || genre === "internal_update") {
    addSignal("style:internal-update");
    return "internal-update";
  }
  if (funnelStage === "bofu") {
    addSignal("style:hook-proof-cta");
    return "hook-proof-cta";
  }
  if (genre === "educational") {
    addSignal("style:educational-clarity");
    return "educational-clarity";
  }
  if (funnelStage === "mofu") {
    addSignal("style:problem-solution-proof");
    return "problem-solution-proof";
  }
  addSignal("style:brand-memory");
  return "brand-memory";
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/₹/g, "inr")
    .replace(/\binr0\b/g, "inr 0")
    .replace(/rs\.?/g, "inr")
    .replace(/\binr\s*\.\s*/g, "inr ")
    .replace(/[^\w%.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveBriefTargetedRules(product: ProductKey, brief: string): HookRule[] {
  const normalizedBrief = normalizeForMatch(brief);
  const rules = getHookRules(product);
  const hasRelevantSupportingFacts = resolveBriefRelevantSupportingFacts(product, brief).length > 0;
  const hasSingleBenefitIntent = /\b(only|focus|target|single|just|specifically|mention only|talk only|hero point|hero message|hero offer|hero offering|push|spotlight|emphasize)\b/i.test(
    normalizedBrief
  );
  const matched = rules.filter((rule) => rule.keywords.some((keyword) => normalizedBrief.includes(normalizeForMatch(keyword))));
  if (matched.length > 0) {
    if (hasRelevantSupportingFacts && !hasSingleBenefitIntent) {
      return [];
    }
    return matched;
  }
  if (!hasSingleBenefitIntent) {
    return [];
  }

  if (product === "kotak_air_plus") {
    if (/(complimentary flight|free flight|flight ticket|1\.5|one and a half|one-and-a-half|lakh|quarterly spend|quarter spend|spend threshold)/i.test(normalizedBrief) && rules[2]) {
      return [rules[2]];
    }
    if (/(joining fee|join fee|joining|zero joining|no joining|free joining|joining fee zero|inr 0 joining)/i.test(normalizedBrief) && rules[1]) {
      return [rules[1]];
    }
    if (!hasRelevantSupportingFacts && /(travel rewards?|five air miles|5 air miles|unbox|reward|five percent)/i.test(normalizedBrief) && rules[0]) {
      return [rules[0]];
    }
    if (hasRelevantSupportingFacts) {
      return [];
    }
  } else {
    if (/(fuel|petrol|diesel|pump|4%|four percent)/i.test(normalizedBrief) && rules[3]) {
      return [rules[3]];
    }
    if (/(entertainment|movies?|ott|stream|cinema|five percent)/i.test(normalizedBrief) && rules[2]) {
      return [rules[2]];
    }
    if (/(essential|grocery|groceries|milk|daily|five percent)/i.test(normalizedBrief) && rules[0]) {
      return [rules[0]];
    }
    if (/(joining fee|join fee|joining|zero joining|no joining|free joining|joining fee zero|inr 0 joining)/i.test(normalizedBrief) && rules[1]) {
      return [rules[1]];
    }
  }

  const scored = rules
    .map((rule) => {
      const score = rule.keywords.reduce((sum, keyword) => {
        const normalizedKeyword = normalizeForMatch(keyword);
        return sum + (normalizedBrief.includes(normalizedKeyword) ? 1 : 0);
      }, 0);
      return { rule, score };
    })
    .sort((a, b) => b.score - a.score);

  if (hasRelevantSupportingFacts) {
    return [];
  }

  if ((scored[0]?.score ?? 0) > 0) {
    return [scored[0]!.rule];
  }

  return [];
}

function scriptMentionsRule(script: string, rule: HookRule): boolean {
  const normalizedScript = normalizeForMatch(script);
  return rule.keywords.some((keyword) => normalizedScript.includes(normalizeForMatch(keyword)));
}

function evaluateRtbCoverage(
  product: ProductKey,
  briefTargetedRules: HookRule[],
  script: string,
  strategy: CreativeStrategy
): { ok: boolean; mode: "brief_targeted" | "default_strongest" | "optional" | "bypass"; missing: string[]; extra: string[] } {
  const allRules = getHookRules(product);
  const mentioned = allRules.filter((rule) => scriptMentionsRule(script, rule));

  if (briefTargetedRules.length > 0) {
    const targetedSet = new Set(briefTargetedRules.map((rule) => rule.hook));
    const missing = briefTargetedRules.filter((rule) => !mentioned.some((item) => item.hook === rule.hook)).map((rule) => rule.hook);
    const extra = mentioned.filter((rule) => !targetedSet.has(rule.hook)).map((rule) => rule.hook);
    return {
      ok: missing.length === 0 && extra.length === 0,
      mode: "brief_targeted",
      missing,
      extra
    };
  }

  if (strategy.rtbPolicy === "bypass") {
    return {
      ok: true,
      mode: "bypass",
      missing: [],
      extra: []
    };
  }

  if (strategy.rtbPolicy === "optional") {
    return {
      ok: true,
      mode: "optional",
      missing: [],
      extra: []
    };
  }

  const strongestRule = getDefaultStrongestRule(product);
  const missing = mentioned.some((item) => item.hook === strongestRule.hook) ? [] : [strongestRule.hook];
  const extra = mentioned.filter((rule) => rule.hook !== strongestRule.hook).map((rule) => rule.hook);
  return {
    ok: missing.length === 0 && extra.length === 0,
    mode: "default_strongest",
    missing,
    extra
  };
}

function evaluateProductNaming(product: ProductKey, script: string): { ok: boolean; reason?: string } {
  const normalizedScript = normalizeForMatch(script);
  const normalizedProductName = normalizeForMatch(getSelectedProductName(product));
  const hasExactProductName = normalizedScript.includes(normalizedProductName);
  const hasForbiddenAlias = /\b(standard card|fuel card|travel card|cashback card|rewards card|miles card|air card)\b/i.test(
    normalizedScript
  );

  if (hasForbiddenAlias) {
    return { ok: false, reason: "Invented substitute card label detected." };
  }

  if (/\bkotak\b/i.test(normalizedScript) && !hasExactProductName) {
    return { ok: false, reason: `If brand is mentioned, it must use the exact selected product name: ${getSelectedProductName(product)}.` };
  }

  if (/\bcredit card\b|\bcard\b/i.test(normalizedScript) && !hasExactProductName) {
    return { ok: false, reason: "Generic card label used without the exact selected product name." };
  }

  return { ok: true };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 6; depth += 1) {
    if (!current || typeof current !== "object") {
      return false;
    }

    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && code.toLowerCase() === expectedCode.toLowerCase()) {
      return true;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

function isRetryableGeminiError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("resource_exhausted") ||
    message.includes("\"code\":429") ||
    message.includes("code: 429") ||
    message.includes("status\":429") ||
    message.includes("\"code\":503") ||
    message.includes("\"code\":504") ||
    message.includes("\"code\":500") ||
    message.includes("code: 503") ||
    message.includes("code: 504") ||
    message.includes("code: 500") ||
    message.includes("status\":\"unavailable\"") ||
    message.includes("status\":\"deadline_exceeded\"") ||
    message.includes("status\":\"internal\"") ||
    message.includes("high demand") ||
    message.includes("temporarily out of capacity") ||
    message.includes("unavailable") ||
    message.includes("deadline exceeded") ||
    message.includes("deadline_exceeded") ||
    message.includes("deadline expired") ||
    message.includes("internal error encountered") ||
    message.includes("internal") ||
    message.includes("headers timeout") ||
    message.includes("fetch failed") ||
    message.includes("socket hang up") ||
    message.includes("timed out") ||
    hasErrorCode(error, "UND_ERR_HEADERS_TIMEOUT") ||
    hasErrorCode(error, "ETIMEDOUT") ||
    hasErrorCode(error, "ECONNRESET")
  );
}

function isModelUnavailableError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("does not exist") ||
    message.includes("not found") ||
    message.includes("invalid model") ||
    message.includes("unknown model")
  );
}

async function withGeminiRetry<T>(operationName: string, run: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= GEMINI_SCRIPT_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!isRetryableGeminiError(error) || attempt === GEMINI_SCRIPT_MAX_ATTEMPTS) {
        break;
      }

      const jitter = Math.floor(Math.random() * 500);
      const backoffMs = GEMINI_SCRIPT_RETRY_BASE_MS * 2 ** (attempt - 1) + jitter;
      await sleep(backoffMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${operationName} failed after retries: ${String(lastError)}`);
}

function getScriptModelCandidates(): string[] {
  const primary = (process.env.GEMINI_SCRIPT_MODEL ?? DEFAULT_GEMINI_SCRIPT_MODEL).trim();
  const envFallbacks = (process.env.GEMINI_SCRIPT_FALLBACK_MODELS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const configuredFallbacks = envFallbacks.length > 0 ? envFallbacks : [...DEFAULT_GEMINI_SCRIPT_FALLBACK_MODELS];
  return Array.from(new Set([primary, ...configuredFallbacks].filter(Boolean)));
}

async function generateJsonTextForModel(
  ai: GoogleGenAI,
  model: string,
  prompt: string,
  options: {
    operationName: string;
    temperature: number;
    maxOutputTokens: number;
    responseSchema: Record<string, unknown>;
    thinkingBudget?: number;
  }
): Promise<string> {
  const response = await withGeminiRetry(`${options.operationName}:${model}`, () =>
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
        responseMimeType: "application/json",
        responseSchema: options.responseSchema,
        ...(typeof options.thinkingBudget === "number"
          ? {
              thinkingConfig: {
                thinkingBudget: options.thinkingBudget
              }
            }
          : {})
      }
    })
  );

  const text = responseText(response).trim();
  if (!text) {
    throw new Error(`${options.operationName} response was empty for model ${model}.`);
  }
  return text;
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

function requireApiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error("GEMINI_API_KEY is required. Add it to .env.local.");
  }
  return key;
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed);
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return JSON.parse(trimmed.slice(first, last + 1));
  }

  throw new Error("Model response did not contain a JSON object.");
}

function extractScriptFromRawText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  const withoutCodeFence = trimmed
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  if (!withoutCodeFence) {
    return "";
  }

  try {
    const parsed = parseJsonObject(withoutCodeFence);
    if (parsed && typeof parsed === "object" && "script" in parsed) {
      const script = (parsed as { script?: unknown }).script;
      if (typeof script === "string") {
        return script.trim();
      }
    }
  } catch {
    // fall through to text cleanup
  }

  const quotedJsonMatch = withoutCodeFence.match(/"script"\s*:\s*"([^"]+)"/i);
  if (quotedJsonMatch?.[1]) {
    return quotedJsonMatch[1].trim();
  }

  return withoutCodeFence
    .replace(/^\{/, "")
    .replace(/\}$/, "")
    .replace(/^script\s*:\s*/i, "")
    .replace(/\\"/g, "\"")
    .replace(/^"+|"+$/g, "")
    .trim();
}

function extractLabeledValue(raw: string, key: string): string {
  const patterns = [
    new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, "i"),
    new RegExp(`\\b${key}\\b\\s*[:=-]\\s*([^\\n\\r]+)`, "i")
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      return match[1].trim().replace(/^"+|"+$/g, "");
    }
  }

  return "";
}

function extractStrategyFromRawText(raw: string): z.infer<typeof strategyDecisionSchema> {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return strategyDecisionSchema.parse(parseJsonObject(trimmed));
  } catch {
    const objective = extractLabeledValue(trimmed, "objective") || undefined;
    const genre = extractLabeledValue(trimmed, "genre") || undefined;
    const audienceCue = extractLabeledValue(trimmed, "audienceCue") || extractLabeledValue(trimmed, "audience_cue");
    const rationale = extractLabeledValue(trimmed, "rationale") || extractLabeledValue(trimmed, "reason");
    const matchedSignalsRaw =
      extractLabeledValue(trimmed, "matchedSignals") || extractLabeledValue(trimmed, "matched_signals");
    const matchedSignals = matchedSignalsRaw
      ? matchedSignalsRaw
          .replace(/^\[|\]$/g, "")
          .split(/[|,]/)
          .map((value) => value.trim())
          .filter(Boolean)
      : [];

    return strategyDecisionSchema.parse({
      objective,
      genre,
      audienceCue,
      rationale,
      matchedSignals
    });
  }
}

function extractAudioOnlyText(value: string): string {
  const audioMatches = [...value.matchAll(/(?:\*\*)?audio(?:\*\*)?\s*:\s*([^\n]+)/gi)];
  if (audioMatches.length === 0) {
    return value;
  }
  return audioMatches
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean)
    .join(" ")
    .trim();
}

function stripStructuredScriptArtifacts(script: string): string {
  let value = script
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .replace(/\r/g, "")
    .replace(/\\"/g, "\"")
    .trim();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!(value.startsWith("\"") && value.endsWith("\""))) {
      break;
    }
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "string") {
        value = parsed.trim();
        continue;
      }
    } catch {
      // keep current value
    }
    break;
  }

  try {
    const parsed = parseJsonObject(value);
    if (parsed && typeof parsed === "object" && "script" in parsed) {
      const nestedScript = (parsed as { script?: unknown }).script;
      if (typeof nestedScript === "string") {
        value = nestedScript.trim();
      }
    }
  } catch {
    // keep current value
  }

  value = extractAudioOnlyText(value);
  value = value.replace(/"\s*,\s*"scenePlan"[\s\S]*$/i, "").trim();
  value = value.replace(/,\s*scenePlan[\s\S]*$/i, "").trim();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stripped = value
      .replace(/^(?:["'{\s]+)?script(?:["'}\s]+)?\s*:\s*/i, "")
      .replace(/^(?:["'{\s]+)?audio(?:["'}\s]+)?\s*:\s*/i, "")
      .replace(/^\*\*scene\s+\d+.*?\*\*\s*/i, "")
      .replace(/^scene\s+\d+.*?:\s*/i, "")
      .trim();
    if (stripped === value) {
      break;
    }
    value = stripped;
  }

  return value
    .replace(/^[{[\s"]+/, "")
    .replace(/[}\]\s"]+$/g, "")
    .trim();
}

function looksLikeValidSpokenScript(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith("here is")) {
    return false;
  }
  if (normalized.includes("json")) {
    return false;
  }
  return true;
}

function getVideoTypeScriptRules(videoType: VideoType): string[] {
  switch (videoType) {
    case "point_to_camera":
    case "point_to_camera_multi_scene":
      return [
        "- Video style: bumper ad with point-to-camera multiple-scene hard-cut editing.",
        "- Script should include 2 to 3 natural pause points so editors can place hard cuts cleanly while keeping one consistent persona."
      ];
    case "montage":
      return [
        "- Video style: montage. Write punchy lines that map to 3 to 5 visual beats.",
        "- Keep clauses short and modular so cuts can happen on beat changes."
      ];
    case "features_half_half":
      return [
        "- Video style: feature video half-and-half split. Keep wording feature-led and benefit-first.",
        "- Sequence should feel like fast feature callouts with one clear conversion CTA at the end."
      ];
    default:
      return [
        "- Video style: bumper ad with point-to-camera multiple-scene hard-cut editing.",
        "- Script should include 2 to 3 natural pause points so editors can place hard cuts cleanly while keeping one consistent persona."
      ];
  }
}

function buildEightSecondBumperPrompt(
  product: ProductKey,
  guidelines: string | undefined,
  brief: string,
  briefTargetedRules: HookRule[],
  strategy: CreativeStrategy
): string {
  const spec = PRODUCT_SPECS[product];
  const productName = getSelectedProductName(product);
  const strongestRule = getDefaultStrongestRule(product);
  const preferredCta = getPreferredCta(strategy);
  const supportingFactRule = getRelevantSupportingFactPromptLines(product, brief);
  const briefOfferRule = getBriefOfferPromptLines(brief);
  const briefOfferAnchor = extractBriefOfferAnchor(brief);
  const rtbRule =
    briefTargetedRules.length > 0
      ? [
          "RTB selection:",
          `- Campaign brief explicitly mentions these RTB(s): ${briefTargetedRules.map((rule) => rule.hook).join(" | ")}`,
          "- Use ONLY the brief-mentioned RTB(s).",
          "- Do NOT add any other RTB beyond what the brief asks for."
        ]
      : briefOfferAnchor
        ? [
            "RTB selection:",
            `- Campaign brief states this offer as the hero message: ${briefOfferAnchor}`,
            "- Keep this brief-stated offer as the primary message.",
            "- Do NOT substitute the default strongest RTB.",
            "- Do NOT drift back to generic travel rewards unless the brief itself asks for that."
          ]
      : strategy.rtbPolicy === "required"
        ? [
            "RTB selection:",
            "- Campaign brief does not clearly lock one RTB.",
            `- Default to one strongest RTB from this product: ${strongestRule.hook}`,
            "- Do NOT combine multiple RTBs in the same script.",
            "- Do NOT invent new RTBs."
          ]
        : strategy.rtbPolicy === "optional"
          ? [
              "RTB selection:",
              "- RTB use is optional for this brief.",
              `- If you use proof, prefer one real product RTB such as: ${strongestRule.hook}`,
              "- Do NOT combine multiple RTBs in the same script.",
              "- If the brief is more message-led or educational, you may lead with relevance or utility instead."
            ]
          : [
              "RTB selection:",
              "- Do not force product RTBs for this brief unless explicitly requested.",
              "- Prioritize clarity of message over benefit stacking."
            ];

  return [
    "Act as an elite digital-first copywriter and creative strategist. Your task is to write a high-performing 8-second spoken video script from the campaign brief.",
    "",
    "STRICT CONSTRAINTS & RULES:",
    "- Keep one core message only.",
    "- Make it feel engaging, human, and appropriate to the brief, not like a feature checklist.",
    "- The script must clearly reflect the campaign brief and the RTB direction in the brief.",
    "- Use an opening phrase that matches the strategy and objective inferred from the brief.",
    `- If you mention the product name, you MUST use exactly "${productName}".`,
    "- Never invent substitute labels like Standard Card, fuel card, travel card, cashback card, rewards card, or any other alias.",
    "- If the exact product name does not fit naturally, omit the product name entirely.",
    "- If the brief asks for a comparison, do not invent competitor claims or superiority statements unless verified comparison facts are explicitly provided in the brief or guidelines.",
    "",
    "STRATEGY CLASSIFICATION:",
    `- Objective: ${strategy.objective}`,
    `- Funnel stage: ${strategy.funnelStage}`,
    `- Channel: ${strategy.channel}`,
    `- Placement: ${strategy.placement}`,
    `- Genre: ${strategy.genre}`,
    `- RTB policy: ${strategy.rtbPolicy}`,
    `- CTA strength: ${strategy.ctaStrength}`,
    `- Script style: ${strategy.scriptStyle}`,
    ...getStrategyPromptRules(strategy),
    "",
    "SCRIPT RULES:",
    `- Spoken duration target is 8 seconds.`,
    `- Character count must stay between ${EIGHT_SECOND_MIN_CHARACTERS} and ${EIGHT_SECOND_MAX_CHARACTERS}, including spaces and punctuation.`,
    "- Staying within this character range is mandatory.",
    "- Keep the spoken script sharp, natural, and aligned to the classified strategy.",
    preferredCta ? `- Preferred CTA ending: ${preferredCta}` : "- CTA is optional. Do not force one if the brief does not need it.",
    "- Do not use digits, percent symbols, currency symbols, INR numerals, or shorthand like 1.5L in spoken dialogue.",
    "- Write numbers in speech-friendly words.",
    "- Do not show or mention any cards, text, phones, screens, laptops, tablets, monitors, or UI.",
    `Must remain compliant with: ${spec.constraintsToState.join(" | ")}`,
    ...briefOfferRule,
    ...supportingFactRule,
    `Audience: ${spec.audienceSummary}`,
    `Audience cue to weave naturally: ${strategy.audienceCue}`,
    ...rtbRule,
    `Campaign brief:\n${brief.trim()}`,
    `Brand guidelines:\n${guidelines?.trim() || "Not provided. Follow product constraints and compliance strictly."}`,
    "",
    "Output STRICT JSON only with this key: script"
  ]
    .filter(Boolean)
    .join("\n\n");
}

function getTargetWordRange(durationSeconds: VideoDurationSeconds): string {
  const bounds = getTargetWordBounds(durationSeconds);
  return bounds.min === bounds.max ? `${bounds.min}` : `${bounds.min}-${bounds.max}`;
}

function getTargetWordGoal(durationSeconds: VideoDurationSeconds): number {
  if (durationSeconds === 8) {
    return 14;
  }
  if (durationSeconds === 15) {
    return 22;
  }
  return 28;
}

function getTargetWordBounds(durationSeconds: VideoDurationSeconds): { min: number; max: number } {
  if (durationSeconds === 8) {
    return { min: 10, max: 15 };
  }
  if (durationSeconds === 15) {
    return { min: 20, max: 24 };
  }
  return { min: 26, max: 30 };
}

function countWords(value: string): number {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function countCharacters(value: string): number {
  return value.trim().length;
}

function trimTrailingJoiner(value: string): string {
  let result = value.trim();
  const trailingTokens = /\b(with|for|to|on|via|using|and|or|the|a|an|of|your|this|that|these|those|it|where|unlock|complimentary)\s*$/i;
  while (trailingTokens.test(result)) {
    result = result.replace(trailingTokens, "").trim();
  }
  return result;
}

function fitScriptToDurationConstraint(
  script: string,
  product: ProductKey,
  durationSeconds: VideoDurationSeconds,
  bounds: { min: number; max: number },
  strategy: CreativeStrategy
): { script: string; wordCount: number; characterCount: number; ok: boolean } {
  const cta = getPreferredCta(strategy);
  let value = finalizeSpokenScript(script, product, strategy, durationSeconds === 8 ? undefined : bounds.max);
  let wordCount = countWords(value);
  let characterCount = countCharacters(value);

  if (durationSeconds === 8) {
    if (characterCount > EIGHT_SECOND_MAX_CHARACTERS) {
      value = hardCapScriptToCharacters(value, EIGHT_SECOND_MAX_CHARACTERS, cta);
      value = finalizeSpokenScript(value, product, strategy);
      wordCount = countWords(value);
      characterCount = countCharacters(value);
    }
    return {
      script: value,
      wordCount,
      characterCount,
      ok: characterCount >= EIGHT_SECOND_MIN_CHARACTERS && characterCount <= EIGHT_SECOND_MAX_CHARACTERS
    };
  }

  if (wordCount > bounds.max) {
    value = hardCapScriptToWords(value, bounds.max, cta);
    value = finalizeSpokenScript(value, product, strategy, bounds.max);
    wordCount = countWords(value);
    characterCount = countCharacters(value);
  }

  return {
    script: value,
    wordCount,
    characterCount,
    ok: wordCount >= bounds.min && wordCount <= bounds.max
  };
}

function hardCapScriptToWords(script: string, maxWords: number, cta: string | null): string {
  const words = script
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length <= maxWords) {
    return script.replace(/\s+/g, " ").trim();
  }

  const trailingJoiners = new Set(["for", "with", "to", "on", "via", "and", "or", "the", "a", "an", "of"]);

  if (cta && maxWords >= 2) {
    const clipped = words.slice(0, Math.max(0, maxWords - 2));
    while (clipped.length > 0) {
      const tail = clipped[clipped.length - 1]!.toLowerCase().replace(/[^\w%₹.]/g, "");
      if (!tail || trailingJoiners.has(tail)) {
        clipped.pop();
        continue;
      }
      break;
    }
    return `${clipped.join(" ")} ${cta}`.trim();
  }

  return words.slice(0, maxWords).join(" ").trim();
}

function hardCapScriptToCharacters(script: string, maxChars: number, cta: string | null): string {
  const normalized = script.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  if (!cta) {
    return trimTrailingJoiner(normalized.slice(0, maxChars).replace(/\s+\S*$/, "").trim())
      .replace(/[,:;.\-]+$/g, "")
      .trim();
  }

  const bodyBudget = Math.max(0, maxChars - cta.length - 1);
  let body = stripKnownCta(normalized);
  if (body.length > bodyBudget) {
    body = body.slice(0, bodyBudget).replace(/\s+\S*$/, "").trim();
  }
  body = trimTrailingJoiner(body).replace(/[,:;.\-]+$/g, "").trim();
  if (!body) {
    return cta;
  }
  return `${body}. ${cta}`.trim();
}

function normalizeSpokenNumbers(script: string): string {
  return script
    .replace(/\b(?:₹|rs\.?|inr)\s*0\b\s+joining fee/gi, "zero joining fee")
    .replace(/\bjoining fee\s*(?:₹|rs\.?|inr)\s*0\b/gi, "zero joining fee")
    .replace(/\b(?:₹|rs\.?|inr)\s*1(?:[.,]5)?\s*l(?:akh)?\b/gi, "one and a half lakh")
    .replace(/\b1(?:[.,]5)?\s*l(?:akh)?\b/gi, "one and a half lakh")
    .replace(/\b150000\b/gi, "one and a half lakh")
    .replace(/\bup to\s*4\s*%/gi, "up to four percent")
    .replace(/\b4\s*%\b/gi, "four percent")
    .replace(/\b5\s*%\b/gi, "five percent")
    .replace(/\b(?:₹|rs\.?|inr)\s*0\b/gi, "zero")
    .replace(/\binr0\b/gi, "zero")
    .replace(/\b5 percent\b/gi, "five percent")
    .replace(/\b4 percent\b/gi, "four percent")
    .replace(/\b1\.5 lakh\b/gi, "one and a half lakh")
    .replace(/\s+/g, " ")
    .trim();
}

function inferAudienceCue(brief: string, product: ProductKey): string {
  const lines = brief
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const explicitLine =
    lines.find((line) => /^target\s*audience\s*[:\-]/i.test(line)) ??
    lines.find((line) => /^audience\s*[:\-]/i.test(line));
  if (explicitLine) {
    const raw = explicitLine
      .split(/[:\-]/)
      .slice(1)
      .join(" ")
      .split(/[.;|]/)[0]
      ?.trim();
    const compact = raw.replace(/\s+/g, " ").replace(/[|]/g, " ").trim();
    const limited = compact.split(" ").slice(0, 7).join(" ").trim();
    if (limited.length >= 6) {
      return limited;
    }
  }

  const normalized = normalizeForMatch(brief);
  if (/(consultant|corporate|founder|cxo|manager|frequent travel|work trip|business trip|airport)/i.test(normalized)) {
    return product === "kotak_air_plus" ? "work trips" : "busy workdays";
  }
  if (/(young|first job|starter|early career|salaried|paycheck)/i.test(normalized)) {
    return "young salaried life";
  }
  if (/(family|household|kids|parents)/i.test(normalized)) {
    return "household budgets";
  }
  return product === "kotak_air_plus" ? "metro frequent travelers" : "practical metro spenders";
}

function classifyCreativeStrategyDeterministic(
  brief: string,
  product: ProductKey,
  briefTargetedRules: HookRule[]
): CreativeStrategy {
  const matchedSignals: string[] = [];
  const addSignal = (signal: string): void => {
    if (!matchedSignals.includes(signal)) {
      matchedSignals.push(signal);
    }
  };

  const normalizedBrief = normalizeForMatch(brief);
  const objective = detectCreativeObjective(normalizedBrief, addSignal);
  const channel = detectCreativeChannel(normalizedBrief, addSignal);
  const placement = detectCreativePlacement(normalizedBrief, addSignal);
  const genre = detectCreativeGenre(normalizedBrief, objective, addSignal);
  const funnelStage = detectFunnelStage(objective, genre, addSignal);
  const audienceCue = inferAudienceCue(brief, product);
  const rtbPolicy = detectRtbPolicy(product, normalizedBrief, funnelStage, briefTargetedRules, addSignal);
  const ctaStrength = detectCtaStrength(normalizedBrief, funnelStage, addSignal);
  const scriptStyle = detectScriptStyle(funnelStage, genre, addSignal);

  return {
    objective,
    funnelStage,
    channel,
    placement,
    genre,
    audienceCue,
    rtbPolicy,
    ctaStrength,
    scriptStyle,
    decisionSource: "deterministic_fallback",
    rationale: matchedSignals.length > 0 ? `Deterministic strategy from brief signals: ${matchedSignals.join(", ")}` : "Deterministic fallback strategy.",
    matchedSignals
  };
}

function buildStrategyClassificationPrompt(
  product: ProductKey,
  brief: string,
  guidelines: string | undefined,
  briefTargetedRules: HookRule[]
): string {
  const productName = getSelectedProductName(product);
  const relevantSupportingFacts = resolveBriefRelevantSupportingFacts(product, brief);
  const availableRtbHints =
    briefTargetedRules.length > 0
      ? briefTargetedRules.map((rule) => rule.hook).join(" | ")
      : getHookRules(product)
          .map((rule) => rule.hook)
          .join(" | ");

  return [
    "Classify the campaign brief into a typed creative strategy for script generation.",
    "",
    "You must decide the kind of video from the brief itself, not from any prior bias.",
    "Return one JSON object only. No markdown, no bullet list, no prose before or after the object.",
    "Only decide the dominant objective and genre. The route will derive funnel stage, RTB policy, CTA strength, channel, placement, and script style afterward.",
    "",
    "Decision rules:",
    "- Read objective, intent, audience, placement, channel, genre, and tone from the brief.",
    "- If the brief is conversion/performance/applications/direct response led, classify toward BOFU/performance.",
    "- If the brief is consideration/explainer/education/usefulness led, classify toward MOFU/explainer.",
    "- If the brief is awareness/brand/launch/recall led, classify toward TOFU/brand spot.",
    "- If the brief is internal communication/training/enablement/update led, classify toward internal_update.",
    "- If signals conflict, choose the dominant intent the script should optimize for.",
    "- Do not assume Meta or Google automatically means BOFU. Objective matters more than channel.",
    "- RTB policy should be required only when the brief clearly needs product proof or direct response pressure.",
    "- For internal briefs, RTB can be bypass unless the brief explicitly asks to mention a benefit, offer, or feature.",
    "- CTA strength should match the likely script intent: hard for conversion, medium for consideration/education, soft for awareness/brand, none for internal unless action is clearly requested.",
    "",
    "Allowed enum values:",
    `- objective: ${CREATIVE_OBJECTIVES.join(" | ")}`,
    `- genre: ${CREATIVE_GENRES.join(" | ")}`,
    "",
    `Product: ${productName}`,
    `Product proof points available: ${availableRtbHints}`,
    ...(relevantSupportingFacts.length > 0
      ? [
          `Brief-relevant supporting product offerings: ${relevantSupportingFacts.map((fact) => fact.fact).join(" | ")}`,
          "These are valid product offerings mentioned in the brief. They are not mandatory RTBs, but they are real and may be central to the script intent."
        ]
      : []),
    `Audience default: ${PRODUCT_SPECS[product].audienceSummary}`,
    `Campaign brief:\n${brief.trim()}`,
    `Brand guidelines:\n${guidelines?.trim() || "Not provided."}`,
    "",
    "Return strict JSON only with these keys:",
    "objective, genre, audienceCue, rationale, matchedSignals"
  ].join("\n");
}

function normalizeStrategyFromModel(
  brief: string,
  parsed: z.infer<typeof strategyDecisionSchema>,
  deterministic: CreativeStrategy,
  product: ProductKey,
  briefTargetedRules: HookRule[]
): CreativeStrategy {
  const normalizedBrief = normalizeForMatch(brief);
  const matchedSignals = [...parsed.matchedSignals.filter(Boolean).slice(0, 8)];
  const addSignal = (signal: string): void => {
    if (!matchedSignals.includes(signal)) {
      matchedSignals.push(signal);
    }
  };

  const objective = parsed.objective && parsed.objective !== "unknown" ? parsed.objective : deterministic.objective;
  const derivedGenre = detectCreativeGenre(normalizedBrief, objective, addSignal);
  const genre = parsed.genre && parsed.genre !== "generic" ? parsed.genre : derivedGenre || deterministic.genre;
  const channel = detectCreativeChannel(normalizedBrief, addSignal);
  const placement = detectCreativePlacement(normalizedBrief, addSignal);
  const funnelStage = detectFunnelStage(objective, genre, addSignal);
  const rtbPolicy = detectRtbPolicy(product, normalizedBrief, funnelStage, briefTargetedRules, addSignal);
  const ctaStrength = detectCtaStrength(normalizedBrief, funnelStage, addSignal);
  const scriptStyle = detectScriptStyle(funnelStage, genre, addSignal);
  const audienceCue = parsed.audienceCue?.trim() || deterministic.audienceCue || inferAudienceCue(brief, product);
  const rationale =
    parsed.rationale?.trim() ||
    `LLM selected objective ${objective} and genre ${genre}; delivery fields derived from brief context.`;
  const decisionSource =
    parsed.objective || parsed.genre || parsed.audienceCue || parsed.rationale || matchedSignals.length > 0
      ? "llm"
      : "deterministic_fallback";

  return {
    objective,
    funnelStage,
    channel,
    placement,
    genre,
    audienceCue,
    rtbPolicy,
    ctaStrength,
    scriptStyle,
    decisionSource,
    rationale,
    matchedSignals
  };
}

function stabilizeStrategy(
  brief: string,
  product: ProductKey,
  strategy: CreativeStrategy,
  briefTargetedRules: HookRule[]
): CreativeStrategy {
  const normalizedBrief = normalizeForMatch(brief);
  const internalIntent = hasInternalIntent(normalizedBrief);
  const explicitRtb =
    briefTargetedRules.length > 0 ||
    resolveBriefRelevantSupportingFacts(product, normalizedBrief).length > 0 ||
    briefExplicitlyRequestsRtb(normalizedBrief);

  if (internalIntent) {
    return {
      ...strategy,
      objective: "internal",
      funnelStage: "internal",
      channel: "internal",
      placement: "internal",
      genre: "internal_update",
      rtbPolicy: explicitRtb ? "optional" : "bypass",
      ctaStrength: hasReviewAction(normalizedBrief) ? "medium" : "none",
      scriptStyle: "internal-update",
      matchedSignals: Array.from(new Set([...strategy.matchedSignals, "stabilizer:internal"]))
    };
  }

  if (strategy.funnelStage !== "bofu" && strategy.rtbPolicy === "required" && briefTargetedRules.length === 0) {
    strategy = {
      ...strategy,
      rtbPolicy: "optional",
      matchedSignals: Array.from(new Set([...strategy.matchedSignals, "stabilizer:optional_rtb"]))
    };
  }

  if (strategy.funnelStage === "mofu" && strategy.ctaStrength === "hard") {
    strategy = {
      ...strategy,
      ctaStrength: "medium",
      matchedSignals: Array.from(new Set([...strategy.matchedSignals, "stabilizer:mofu_cta"]))
    };
  }

  if (strategy.funnelStage === "tofu" && !["soft", "none"].includes(strategy.ctaStrength)) {
    strategy = {
      ...strategy,
      ctaStrength: "soft",
      matchedSignals: Array.from(new Set([...strategy.matchedSignals, "stabilizer:tofu_cta"]))
    };
  }

  return strategy;
}

async function classifyCreativeStrategy(
  ai: GoogleGenAI,
  brief: string,
  product: ProductKey,
  guidelines: string | undefined,
  briefTargetedRules: HookRule[]
): Promise<CreativeStrategy> {
  const deterministic = classifyCreativeStrategyDeterministic(brief, product, briefTargetedRules);
  const prompt = buildStrategyClassificationPrompt(product, brief, guidelines, briefTargetedRules);

  try {
    const raw = await generateStrategyContentWithFallback(ai, prompt);
    const parsed = extractStrategyFromRawText(raw);
    if (!parsed.objective && !parsed.genre && !parsed.audienceCue && !parsed.rationale && parsed.matchedSignals.length === 0) {
      throw new Error("Strategy classification returned no usable fields.");
    }
    return stabilizeStrategy(
      brief,
      product,
      normalizeStrategyFromModel(brief, parsed, deterministic, product, briefTargetedRules),
      briefTargetedRules
    );
  } catch (error) {
    console.warn(`[script] strategy classification failed; using deterministic fallback: ${errorMessage(error)}`);
    return stabilizeStrategy(brief, product, deterministic, briefTargetedRules);
  }
}

function getPreferredCta(strategy: CreativeStrategy): string | null {
  switch (strategy.ctaStrength) {
    case "hard":
      return "Apply Now.";
    case "medium":
      return strategy.funnelStage === "internal" ? "Please review." : "Learn More.";
    case "soft":
      return "Know More.";
    default:
      return null;
  }
}

function getStrategyPromptRules(strategy: CreativeStrategy): string[] {
  if (strategy.funnelStage === "bofu") {
    return [
      "Strategy rule: treat this as a BOFU conversion-oriented script.",
      "- Lead with the strongest value or proof point immediately.",
      "- Use one clear conversion outcome and one direct CTA."
    ];
  }
  if (strategy.funnelStage === "mofu") {
    return [
      "Strategy rule: treat this as a MOFU consideration/education script.",
      "- Clarify why the product is useful or relevant quickly.",
      "- Proof can be a benefit, utility, or feature, but do not sound like a hard-sell checklist.",
      "- CTA should feel lighter than a pure conversion ad."
    ];
  }
  if (strategy.funnelStage === "tofu") {
    return [
      "Strategy rule: treat this as a TOFU awareness/brand script.",
      "- Prioritize memorability, clarity, and a distinctive message over aggressive conversion copy.",
      "- RTB can support the message but should not dominate unless the brief explicitly asks for it.",
      "- CTA should be soft or absent."
    ];
  }
  return [
    "Strategy rule: treat this as an internal communication script.",
    "- Prioritize clarity, relevance, and what matters to the audience.",
    "- Do not force ad language or retail hard-sell structure.",
    "- Only use product RTBs if the brief explicitly asks for them."
  ];
}

function cleanScriptBody(value: string): string {
  return value
    .replace(/\bget\s+at\b/gi, "Get")
    .replace(/\bget\s+with\b/gi, "Get")
    .replace(/\b(with|for|on|via|using)\s+and\b/gi, "and")
    .replace(/\b(with|for|on|via|using)\s+so\b/gi, "so")
    .replace(/\b(with|for|on|via|using)\s+while\b/gi, "while")
    .replace(/\b(with|for|to|on|via|using|and|or|the|a|an|of)\s*([.!?])/gi, "$2")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/^[,:;.\-\s]+/g, "")
    .replace(/[,:;.\-\s]+$/g, "")
    .trim();
}

function cleanProductSpecificScriptBody(value: string, product: ProductKey): string {
  if (product !== "kotak_cashback") {
    return value;
  }

  return value
    .replace(/\.\s*for\s+(Kotak Cashback\+)\s+now[.!?]*/gi, " with $1.")
    .replace(/\.\s*for\s+(Kotak Cashback\+)[.!?]*/gi, " with $1.")
    .replace(/\bfor\s+(Kotak Cashback\+)\s+now\b/gi, "with $1")
    .replace(/\bfor\s+(Kotak Cashback\+)\b/gi, "with $1")
    .replace(/\bwith\s+(Kotak Cashback\+)\s+now\b/gi, "with $1")
    .replace(/\byour online grocery\b/gi, "online grocery orders")
    .replace(/\bgroceries and milk\b/gi, "online grocery and food delivery")
    .replace(/\bgroceries,\s*milk,\s*and daily spends\b/gi, "online grocery, food delivery, and daily spends")
    .replace(/\bon essentials,\s*with five percent cashback on online grocery and food delivery\b/gi, "with five percent cashback on online grocery and food delivery")
    .replace(/\.\s*with\s+Kotak Cashback\+\s*[.!?]*/gi, " with Kotak Cashback+.")
    .replace(/\s+/g, " ")
    .trim();
}

function hasProductSpecificScriptIssues(script: string, product: ProductKey): boolean {
  if (product !== "kotak_cashback") {
    return false;
  }

  return (
    /\.\s*with\s+Kotak Cashback\+\s*[.!?]*/i.test(script) ||
    /\bfor\s+Kotak Cashback\+\s+now\b/i.test(script) ||
    /\byour online grocery\b/i.test(script) ||
    /\bfive percent cashback on online[.!?]/i.test(script)
  );
}

function stripKnownCta(script: string): string {
  return script
    .replace(/\b(apply(?:\s+now)?|learn\s+more|know\s+more|see\s+how|explore\s+more|please\s+review)\b[.!]*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[,:;.\-]+$/g, "")
    .trim();
}

function ensureSingleCtaEnding(script: string, cta: string | null): string {
  const body = stripKnownCta(script);
  if (!cta) {
    return body.replace(/[,:;.\-]+$/g, "").trim();
  }
  if (!body) {
    return cta;
  }
  return `${body}. ${cta}`.trim();
}

function finalizeSpokenScript(script: string, _product: ProductKey, strategy: CreativeStrategy, maxWords?: number): string {
  const cta = getPreferredCta(strategy);
  let value = stripStructuredScriptArtifacts(script).replace(/\s+/g, " ").trim();
  value = cleanScriptBody(value);
  value = cleanProductSpecificScriptBody(value, _product);
  value = normalizeSpokenNumbers(value);
  value = ensureSingleCtaEnding(value, cta);
  if (maxWords && countWords(value) > maxWords) {
    value = hardCapScriptToWords(value, maxWords, cta);
    value = ensureSingleCtaEnding(value, cta);
  }
  if (maxWords && countWords(value) > maxWords) {
    value = hardCapScriptToWords(value, maxWords, cta);
  }
  return value.replace(/\s+/g, " ").trim();
}

function buildOfferLedFallbackScript(product: ProductKey, brief: string, strategy: CreativeStrategy): string | null {
  const offerAnchor = extractBriefOfferAnchor(brief);
  if (!offerAnchor) {
    return null;
  }

  const productName = getSelectedProductName(product);
  const cta = getPreferredCta(strategy);
  const anchor = offerAnchor.replace(/\s+/g, " ").trim();
  const normalizedAnchor = normalizeForMatch(anchor);
  const leadingVerb = /^(get|unlock|enjoy|earn|pay|save|use|access|start|receive)\b/i.test(anchor);
  const startsWithBenefitNoun = /^(complimentary|free|premium|priority|exclusive|lounge)\b/i.test(anchor);
  const isTravelPrivilegesOffer =
    product === "kotak_air_plus" &&
    /\btravel privileges\b/i.test(normalizedAnchor) &&
    /\b(?:80 000|80000|eighty thousand|over eighty thousand|annual value|annual savings)\b/i.test(normalizedAnchor);

  if (strategy.funnelStage === "bofu") {
    if (isTravelPrivilegesOffer) {
      return `Unlock travel privileges worth over eighty thousand rupees with ${productName}. ${cta ?? "Apply Now."}`.trim();
    }
    if (leadingVerb) {
      return `Limited-time offer: ${anchor} with ${productName}. ${cta ?? "Apply Now."}`.trim();
    }
    if (startsWithBenefitNoun) {
      return `Enjoy ${anchor} with ${productName}. ${cta ?? "Apply Now."}`.trim();
    }
    return `Get ${anchor} with ${productName}. ${cta ?? "Apply Now."}`.trim();
  }

  if (strategy.funnelStage === "mofu") {
    if (isTravelPrivilegesOffer) {
      return `${productName} unlocks travel privileges worth over eighty thousand rupees. ${cta ?? "Learn More."}`.trim();
    }
    if (leadingVerb) {
      return `Planning ahead? ${anchor} with ${productName}. ${cta ?? "Learn More."}`.trim();
    }
    if (startsWithBenefitNoun) {
      return `Enjoy ${anchor} with ${productName}. ${cta ?? "Learn More."}`.trim();
    }
    return `${productName} offers ${anchor}. ${cta ?? "Learn More."}`.trim();
  }

  if (strategy.funnelStage === "tofu") {
    if (isTravelPrivilegesOffer) {
      return `${productName} brings travel privileges worth over eighty thousand rupees. ${cta ?? "Know More."}`.trim();
    }
    if (leadingVerb) {
      return `New travel offer: ${anchor} with ${productName}. ${cta ?? "Know More."}`.trim();
    }
    return `${productName} brings ${anchor}. ${cta ?? "Know More."}`.trim();
  }

  if (leadingVerb) {
    return `New offer: ${anchor} with ${productName}.`.trim();
  }
  return `${productName} can now offer ${anchor}.`.trim();
}

function buildDeterministicFallbackScript(
  product: ProductKey,
  brief: string,
  briefTargetedRules: HookRule[],
  durationSeconds: VideoDurationSeconds,
  strategy: CreativeStrategy
): string {
  const freeformOfferFallback = buildOfferLedFallbackScript(product, brief, strategy);
  if (freeformOfferFallback && briefTargetedRules.length === 0) {
    return freeformOfferFallback;
  }
  const targetedText = briefTargetedRules.map((rule) => normalizeForMatch(rule.hook)).join(" | ");
  const productName = getSelectedProductName(product);
  const isTravel = targetedText.includes("travel");
  const isJoinFee = targetedText.includes("joining fee") || targetedText.includes("inr 0");
  const isFlight = targetedText.includes("1.5l") || targetedText.includes("complimentary flight") || targetedText.includes("quarter");
  const isEssentials = targetedText.includes("essentials") || targetedText.includes("groceries") || targetedText.includes("milk");
  const isEntertainment = targetedText.includes("entertainment");
  const isFuel = targetedText.includes("fuel");

  if (strategy.funnelStage === "internal") {
    if (product === "kotak_air_plus") {
      if (isFlight) {
        return `${productName} unlocks a complimentary flight after one and a half lakh spend in the quarter.`;
      }
      if (isTravel) {
        return `${productName} helps frequent travelers earn five percent rewards via Unbox bookings.`;
      }
      if (isJoinFee) {
        return `${productName} is currently available with zero joining fee for a limited period.`;
      }
      return `${productName} is built to make travel moments feel smoother and more useful for frequent flyers.`;
    }

    if (isFuel) {
      return `${productName} can help everyday commuters save up to four percent on fuel spends.`;
    }
    if (isEntertainment) {
      return `${productName} gives users five percent cashback on entertainment spends.`;
    }
    if (isEssentials) {
      return `${productName} helps daily spending work harder with five percent cashback on essentials.`;
    }
    if (isJoinFee) {
      return `${productName} is currently available with zero joining fee for a limited period.`;
    }
    return `${productName} is built to make everyday spending feel simpler and more useful for practical households.`;
  }

  if (strategy.funnelStage === "tofu") {
    if (product === "kotak_air_plus") {
      if (isFlight) {
        return `${productName} turns planned travel spend into a complimentary flight opportunity. Know More.`;
      }
      if (isTravel) {
        return `${productName} brings more value to every trip with five percent rewards via Unbox bookings. Know More.`;
      }
      if (isJoinFee) {
        return `${productName} starts strong with zero joining fee for a limited period. Know More.`;
      }
      return `${productName} is made for smoother travel days and smarter value every time you move. Know More.`;
    }

    if (isFuel) {
      return `${productName} brings smarter value to every drive with up to four percent savings on fuel. Know More.`;
    }
    if (isEntertainment) {
      return `${productName} makes everyday plans lighter with five percent cashback on entertainment. Know More.`;
    }
    if (isEssentials) {
      return `${productName} brings everyday value with five percent cashback on essentials. Know More.`;
    }
    if (isJoinFee) {
      return `${productName} starts simple with zero joining fee for a limited period. Know More.`;
    }
    return `${productName} is made for everyday value that feels simple, practical, and easy to trust. Know More.`;
  }

  if (strategy.funnelStage === "mofu") {
    if (product === "kotak_air_plus") {
      if (isFlight) {
        return `${productName} rewards one and a half lakh quarterly spend with a complimentary flight. Learn More.`;
      }
      if (isTravel) {
        return `${productName} gives frequent travelers five percent rewards via Unbox bookings, making planned trips work harder. Learn More.`;
      }
      if (isJoinFee) {
        return `${productName} comes with zero joining fee for a limited period, making it easier to get started. Learn More.`;
      }
      return `${productName} helps frequent travelers get more value from planned travel spends. Learn More.`;
    }

    if (isFuel) {
      return `${productName} helps regular commuters save up to four percent on fuel while keeping monthly spends practical. Learn More.`;
    }
    if (isEntertainment) {
      return `${productName} gives five percent cashback on entertainment, helping plans feel lighter on the wallet. Learn More.`;
    }
    if (isEssentials) {
      return `${productName} gives five percent cashback on essentials, helping daily household spending work harder. Learn More.`;
    }
    if (isJoinFee) {
      return `${productName} comes with zero joining fee for a limited period, making it easier to get started. Learn More.`;
    }
    return `${productName} helps daily spending work harder across essentials and routine monthly spends. Learn More.`;
  }

  if (product === "kotak_cashback") {
    if (briefTargetedRules.length > 0) {
      if (targetedText.includes("fuel")) {
        if (durationSeconds === 8) {
          return "Save on every drive with Kotak Cashback+, with up to four percent savings on fuel. Apply Now.";
        }
        if (durationSeconds === 15) {
          return "Fuel bills pinching lately? Get up to four percent savings on fuel, built for practical monthly budgets. Apply Now.";
        }
        return "Fuel prices rising? Get up to four percent savings on fuel, so commutes cost less and your monthly budget breathes easier. Apply Now.";
      }
      if (targetedText.includes("entertainment")) {
        if (durationSeconds === 8) {
          return "Make plans lighter with Kotak Cashback+, with five percent cashback on entertainment. Apply Now.";
        }
        if (durationSeconds === 15) {
          return "Weekend plans expensive? Get five percent cashback on entertainment, so you enjoy more while spending smarter each month. Apply Now.";
        }
        return "Weekend plans expensive? Get five percent cashback on entertainment, so outings feel lighter on your pocket and monthly spending stays controlled. Apply Now.";
      }
      if (targetedText.includes("essentials") || targetedText.includes("groceries") || targetedText.includes("milk")) {
        if (durationSeconds === 8) {
          return "Get five percent cashback on online grocery and food delivery with Kotak Cashback+. Apply Now.";
        }
        if (durationSeconds === 15) {
          return "Daily essentials costing more? Get five percent cashback on online grocery and food delivery, so monthly budgets stay lighter. Apply Now.";
        }
        return "Daily essentials costing more? Get five percent cashback on online grocery and food delivery, so everyday spending stays under control. Apply Now.";
      }
      if (targetedText.includes("joining fee") || targetedText.includes("inr 0")) {
        if (durationSeconds === 8) {
          return "Start smart with Kotak Cashback+ and get zero joining fee for a limited period. Save from day one. Apply Now.";
        }
        if (durationSeconds === 15) {
          return "Why pay joining fees? Get limited-period zero joining fee, so you start saving from day one. Apply Now.";
        }
        return "Why pay joining fees? Get limited-period zero joining fee, so you switch instantly and keep more of every paycheck. Apply Now.";
      }
      return "Make every rupee work harder, built for practical daily value. Apply Now.";
    }
    if (durationSeconds === 8) {
      return "Get five percent cashback on online grocery and food delivery with Kotak Cashback+. Apply Now.";
    }
    if (durationSeconds === 15) {
      return "Get five percent cashback on online grocery and food delivery with Kotak Cashback+. Apply Now.";
    }
    return "Get five percent cashback on online grocery and food delivery with Kotak Cashback+, and make everyday spending work harder. Apply Now.";
  }

  if (briefTargetedRules.length > 0) {
    if (targetedText.includes("1.5l") || targetedText.includes("complimentary flight") || targetedText.includes("quarter")) {
      if (durationSeconds === 8) {
        return "Spend one and a half lakh on Kotak Air Plus and unlock your complimentary flight. Apply Now.";
      }
      if (durationSeconds === 15) {
        return "Hit one and a half lakh this quarter and unlock a complimentary flight, turning planned spends into travel wins. Apply Now.";
      }
      return "Hit one and a half lakh this quarter and unlock a complimentary flight, turning routine spends into a reward bringing your escape closer. Apply Now.";
    }
    if (targetedText.includes("travel")) {
      if (durationSeconds === 8) {
        return "Earn more from travel with Kotak Air Plus, with five percent rewards via Unbox bookings. Apply Now.";
      }
      if (durationSeconds === 15) {
        return "Travel smarter from today: earn five percent rewards via Kotak Unbox, so every booking works harder for you. Apply Now.";
      }
      return "Travel smarter from today: earn five percent rewards via Kotak Unbox, so every booking stretches farther while you unlock better trips sooner. Apply Now.";
    }
    if (targetedText.includes("joining fee") || targetedText.includes("inr 0")) {
      if (durationSeconds === 8) {
        return "Start travel smarter with Kotak Air Plus and get zero joining fee for a limited period. Apply Now.";
      }
      if (durationSeconds === 15) {
        return "Why pay joining fee? Get limited-period zero joining fee, so travel value starts without upfront cost. Apply Now.";
      }
      return "Why pay joining fee? Get limited-period zero joining fee, so travel value starts immediately and your money stays ready for trips. Apply Now.";
    }
    return "Step into seamless travel value designed for high-intent flyers. Apply Now.";
  }
  if (durationSeconds === 8) {
    return "Earn more from travel with Kotak Air Plus, with five percent rewards via Unbox bookings. Apply Now.";
  }
  if (durationSeconds === 15) {
    return "Earn more from travel with Kotak Air Plus and get five percent rewards via Unbox bookings. Apply Now.";
  }
  return "Earn more from travel with Kotak Air Plus and get five percent rewards via Unbox bookings on every trip. Apply Now.";
}

function buildStrictEightSecondFallbackScript(
  product: ProductKey,
  brief: string,
  briefTargetedRules: HookRule[],
  strategy: CreativeStrategy
): string {
  const freeformOfferFallback = buildOfferLedFallbackScript(product, brief, strategy);
  if (freeformOfferFallback && briefTargetedRules.length === 0) {
    return freeformOfferFallback;
  }
  const targetedText = briefTargetedRules.map((rule) => normalizeForMatch(rule.hook)).join(" | ");
  const isTravel = targetedText.includes("travel");
  const isJoinFee = targetedText.includes("joining fee") || targetedText.includes("inr 0");
  const isFlight = targetedText.includes("1.5l") || targetedText.includes("complimentary flight") || targetedText.includes("quarter");
  const isEssentials = targetedText.includes("essentials") || targetedText.includes("groceries") || targetedText.includes("milk");
  const isEntertainment = targetedText.includes("entertainment");
  const isFuel = targetedText.includes("fuel");

  if (product === "kotak_air_plus") {
    if (strategy.funnelStage === "internal") {
      if (isFlight) {
        return "Kotak Air Plus turns one and a half lakh quarterly spend into a complimentary flight opportunity.";
      }
      if (isTravel) {
        return "Kotak Air Plus helps teams remember five percent rewards via Unbox bookings for planned travel.";
      }
      if (isJoinFee) {
        return "Kotak Air Plus comes with zero joining fee for a limited period, making it easier to get started.";
      }
      return "Kotak Air Plus helps teams explain smoother travel value in a simple, premium, easy-to-repeat way.";
    }

    if (strategy.funnelStage === "mofu") {
      if (isFlight) {
        return "Kotak Air Plus turns one and a half lakh quarterly spend into a complimentary flight. Learn More.";
      }
      if (isTravel) {
        return "Kotak Air Plus helps frequent travelers get five percent rewards via Unbox bookings. Learn More.";
      }
      if (isJoinFee) {
        return "Kotak Air Plus comes with zero joining fee for a limited period, making it easier to get started.";
      }
      return "Kotak Air Plus helps frequent travelers get more from planned trips with five percent rewards.";
    }

    if (strategy.funnelStage === "tofu") {
      if (isFlight) {
        return "Kotak Air Plus turns one and a half lakh quarterly spend into a complimentary flight opportunity.";
      }
      if (isTravel) {
        return "Kotak Air Plus brings more value to planned travel with five percent rewards via Unbox bookings.";
      }
      if (isJoinFee) {
        return "Kotak Air Plus comes with zero joining fee for a limited period, making travel planning easier.";
      }
      return "Kotak Air Plus brings premium travel value into focus for frequent flyers across planned trips.";
    }

    if (isFlight) {
      return "Spend one and a half lakh on Kotak Air Plus and unlock your complimentary flight. Apply Now.";
    }
    if (isTravel) {
      return "Earn more from travel with Kotak Air Plus, with five percent rewards via Unbox bookings. Apply Now.";
    }
    if (isJoinFee) {
      return "Start travel smarter with Kotak Air Plus and get zero joining fee for a limited period. Apply Now.";
    }
    return "Earn more from travel with Kotak Air Plus, with five percent rewards via Unbox bookings. Apply Now.";
  }

  if (strategy.funnelStage === "internal") {
    if (isFuel) {
      return "Kotak Cashback+ helps teams explain up to four percent fuel savings in a simple, useful way.";
    }
    if (isEntertainment) {
      return "Kotak Cashback+ helps teams remember five percent cashback on entertainment in a grounded way.";
    }
    if (isEssentials) {
      return "Kotak Cashback+ helps teams explain five percent cashback on essentials in a simple way.";
    }
    if (isJoinFee) {
      return "Kotak Cashback+ comes with zero joining fee for a limited period, making it easier to start.";
    }
    return "Kotak Cashback+ helps teams explain everyday value in a simple, practical, easy-to-repeat way.";
  }

  if (strategy.funnelStage === "mofu") {
    if (isFuel) {
      return "Kotak Cashback+ helps regular commuters save up to four percent on fuel. Learn More.";
    }
    if (isEntertainment) {
      return "Kotak Cashback+ gives five percent cashback on entertainment, making plans feel lighter.";
    }
    if (isEssentials) {
      return "Kotak Cashback+ gives five percent cashback on essentials, making daily spending work harder.";
    }
    if (isJoinFee) {
      return "Kotak Cashback+ comes with zero joining fee for a limited period, making it easier to start.";
    }
    return "Kotak Cashback+ helps daily spending work harder across essentials and routine monthly spends.";
  }

  if (strategy.funnelStage === "tofu") {
    if (isFuel) {
      return "Kotak Cashback+ brings smarter value to every drive with up to four percent savings on fuel.";
    }
    if (isEntertainment) {
      return "Kotak Cashback+ makes everyday plans lighter with five percent cashback on entertainment.";
    }
    if (isEssentials) {
      return "Kotak Cashback+ brings everyday value with five percent cashback on essentials that matter.";
    }
    if (isJoinFee) {
      return "Kotak Cashback+ starts simple with zero joining fee for a limited period and practical value.";
    }
    return "Kotak Cashback+ is made for everyday value that feels simple, practical, and easy to trust.";
  }

  if (isFuel) {
    return "Save on every drive with Kotak Cashback+, with up to four percent savings on fuel. Apply Now.";
  }
  if (isEntertainment) {
    return "Make plans lighter with Kotak Cashback+, with five percent cashback on entertainment. Apply Now.";
  }
  if (isEssentials) {
    return "Get five percent cashback on online grocery and food delivery with Kotak Cashback+. Apply Now.";
  }
  if (isJoinFee) {
    return "Start smart with Kotak Cashback+ and get zero joining fee for a limited period. Save from day one. Apply Now.";
  }
  return "Get five percent cashback on online grocery and food delivery with Kotak Cashback+. Apply Now.";
}

function hasEngagementHook(script: string): boolean {
  const normalized = script.toLowerCase();
  return /\b(why|now|today|smarter|ready|pinching|costing|expensive|step into|travel better|stretch every rupee|stop|instantly|finally|save more)\b/.test(
    normalized
  );
}

function hasProofToken(script: string): boolean {
  const normalized = script.toLowerCase();
  return /\b(5%|4%|inr0|inr 0|joining fee|annual fee|zero joining fee|unbox|complimentary flight|travel voucher|1\.5l|one and a half lakh|fuel|entertainment|essentials|cashback|rewards|five percent|four percent|forex|markup|lounge|priority pass|air miles|welcome benefit|renewal benefit|redemption|transfer|partner|surcharge waiver)\b/.test(
    normalized
  );
}

function hasDirectCta(script: string): boolean {
  return /\bapply now\b/.test(script.toLowerCase());
}

function looksFeatureChecklist(script: string): boolean {
  const commaCount = (script.match(/,/g) ?? []).length;
  return commaCount >= 2 && hasProofToken(script);
}

function enforceEngagingFallbackAllScript(
  product: ProductKey,
  brief: string,
  durationSeconds: VideoDurationSeconds,
  briefTargetedRules: HookRule[],
  script: string,
  strategy: CreativeStrategy
): string {
  if (briefTargetedRules.length > 0) {
    return script;
  }
  if (!looksFeatureChecklist(script)) {
    return script;
  }
  if (hasEngagementHook(script)) {
    return script;
  }
  return buildDeterministicFallbackScript(product, brief, briefTargetedRules, durationSeconds, strategy);
}

function enforceBumperToneScript(
  product: ProductKey,
  brief: string,
  durationSeconds: VideoDurationSeconds,
  briefTargetedRules: HookRule[],
  script: string,
  strategy: CreativeStrategy
): string {
  if (strategy.funnelStage !== "bofu") {
    return script;
  }
  if (durationSeconds === 8) {
    const allowsFreeformBriefOffer = strategy.matchedSignals.includes("rtb:freeform_offer_optional");
    if (allowsFreeformBriefOffer && hasDirectCta(script) && doesScriptPreserveBriefOffer(brief, script)) {
      return script;
    }
    if (hasDirectCta(script) && hasProofToken(script)) {
      return script;
    }
    return buildDeterministicFallbackScript(product, brief, briefTargetedRules, durationSeconds, strategy);
  }
  if (durationSeconds !== 8 && hasEngagementHook(script)) {
    return script;
  }
  return buildDeterministicFallbackScript(product, brief, briefTargetedRules, durationSeconds, strategy);
}

function buildPrompt(
  product: ProductKey,
  durationSeconds: VideoDurationSeconds,
  videoType: VideoType,
  guidelines: string | undefined,
  brief: string,
  briefTargetedRules: HookRule[],
  strategy: CreativeStrategy
): string {
  if (durationSeconds === 8 && isBumperVideoType(videoType)) {
    return buildEightSecondBumperPrompt(product, guidelines, brief, briefTargetedRules, strategy);
  }

  const spec = PRODUCT_SPECS[product];
  const productName = getSelectedProductName(product);
  const strongestRule = getDefaultStrongestRule(product);
  const wordTarget = getTargetWordRange(durationSeconds);
  const wordGoal = getTargetWordGoal(durationSeconds);
  const preferredCta = getPreferredCta(strategy);
  const supportingFactRule = getRelevantSupportingFactPromptLines(product, brief);
  const briefOfferRule = getBriefOfferPromptLines(brief);
  const briefOfferAnchor = extractBriefOfferAnchor(brief);
  const rtbRule =
    briefTargetedRules.length > 0
      ? [
          "RTB selection rule:",
          `- Campaign brief explicitly mentions these RTB(s): ${briefTargetedRules.map((rule) => rule.hook).join(" | ")}`,
          "- Use ONLY the brief-mentioned RTB(s).",
          "- Do NOT add any other RTB beyond what brief asks for."
        ]
      : briefOfferAnchor
        ? [
            "RTB selection rule:",
            `- Campaign brief states this offer as the hero message: ${briefOfferAnchor}`,
            "- Keep this brief-stated offer as the primary message.",
            "- Do NOT substitute the default strongest RTB.",
            "- Do NOT drift back to generic travel rewards unless the brief itself asks for that."
          ]
      : strategy.rtbPolicy === "required"
        ? [
            "RTB selection rule:",
            "- Campaign brief does not clearly lock one RTB.",
            `- Default to one strongest RTB from this product: ${strongestRule.hook}`,
            "- Do NOT combine multiple RTBs in one script.",
            "- Do NOT invent new RTBs."
          ]
        : strategy.rtbPolicy === "optional"
          ? [
              "RTB selection rule:",
              "- RTB use is optional for this brief.",
              `- If you use proof, prefer one real product RTB such as: ${strongestRule.hook}`,
              "- Do NOT combine multiple RTBs in one script unless the brief explicitly asks for it."
            ]
          : [
              "RTB selection rule:",
              "- Do not force product RTBs for this brief unless explicitly requested."
            ];

  return [
    "Write a high-performing spoken video script for the selected product and duration.",
    "",
    `Ad objective: ${strategy.objective}`,
    `CTA guidance: ${preferredCta ?? "CTA optional"}`,
    `Format: ${videoType}`,
    `Duration: ${durationSeconds}s`,
    "",
    "Strategy classification:",
    `- Funnel stage: ${strategy.funnelStage}`,
    `- Channel: ${strategy.channel}`,
    `- Placement: ${strategy.placement}`,
    `- Genre: ${strategy.genre}`,
    `- RTB policy: ${strategy.rtbPolicy}`,
    `- CTA strength: ${strategy.ctaStrength}`,
    `- Script style: ${strategy.scriptStyle}`,
    ...getStrategyPromptRules(strategy),
    "",
    "Performance best practices:",
    "- Make the script appropriate to the objective, funnel stage, channel, placement, and genre from the brief.",
    "- Hook in the first 1-2 seconds.",
    "- Put the main message immediately.",
    "- Keep to one core message only.",
    "- Make the script feel human and scroll-stopping with one relatable mini-context.",
    "- Do not output a flat checklist of features.",
    "- Add one emotional hook phrase to keep it engaging.",
    "- Use fast cuts and caption-friendly lines.",
    "- Use short spoken lines.",
    preferredCta ? `- End with this CTA style: ${preferredCta}` : "- CTA can be omitted if the brief and strategy do not need one.",
    "- If the brief asks for a comparison, do not invent competitor claims or superiority statements unless verified comparison facts are explicitly provided in the brief or guidelines.",
    "- Write all numbers in speech-friendly words, not numerals.",
    "- Examples: say five percent, zero joining fee, one and a half lakh.",
    "- Do not use digits, percent symbols, currency symbols, INR numerals, or shorthand like 1.5L in the spoken script.",
    product === "kotak_cashback"
      ? "- For Kotak Cashback+, use natural phrasing like 'with Kotak Cashback+' or 'on online grocery and food delivery'. Never write broken lines like 'for Kotak Cashback+ now' or 'your online grocery'."
      : "",
    product === "kotak_cashback"
      ? "- Do not default to 'groceries and milk' phrasing unless the brief explicitly asks for that wording."
      : "",
    "",
    `- Spoken duration target is ${durationSeconds} seconds.`,
    `- Word count target is around ${wordGoal} words (acceptable band: ${wordTarget}).`,
    "- Staying within this word band is mandatory so the spoken script fits the selected duration.",
    "- Keep spoken rhythm natural; do not force filler words just to hit count.",
    "- If the brief includes a target audience, mirror that audience context in one short phrase.",
    "- Keep the script punchy and natural for spoken delivery.",
    ...getVideoTypeScriptRules(videoType),
    ...rtbRule,
    "",
    "Do not mention visuals, camera, subtitles, or disclaimers in the spoken script.",
    `If you mention the product name, you MUST use exactly "${productName}".`,
    "Never invent substitute labels like Standard Card, fuel card, travel card, cashback card, rewards card, or any other alias.",
    "If the exact product name does not fit naturally, omit the product name entirely.",
    `Must remain compliant with: ${spec.constraintsToState.join(" | ")}`,
    ...briefOfferRule,
    ...supportingFactRule,
    `Audience: ${spec.audienceSummary}`,
    `Audience cue to weave naturally: ${strategy.audienceCue}`,
    `Campaign brief:\n${brief.trim()}`,
    `Brand guidelines:\n${guidelines?.trim() || "Not provided. Follow product constraints and compliance strictly."}`,
    "",
    "Output STRICT JSON only with this key: script"
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function generateScriptTextForModel(ai: GoogleGenAI, model: string, prompt: string): Promise<string> {
  return generateJsonTextForModel(ai, model, prompt, {
    operationName: "script.generate",
    temperature: 0.9,
    maxOutputTokens: 700,
    thinkingBudget: 0,
    responseSchema: {
      type: "OBJECT",
      properties: {
        script: { type: "STRING" }
      },
      required: ["script"]
    }
  });
}

async function generateScriptContentWithFallback(ai: GoogleGenAI, contents: string): Promise<string> {
  const models = getScriptModelCandidates();
  let lastError: unknown;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index]!;
    try {
      return await generateScriptTextForModel(ai, model, contents);
    } catch (error) {
      lastError = error;
      const hasFallback = index < models.length - 1;
      const shouldFallback = hasFallback && (isRetryableGeminiError(error) || isModelUnavailableError(error));
      if (!shouldFallback) {
        throw error;
      }
      console.warn(`[script] model ${model} unavailable; falling back to ${models[index + 1]}: ${errorMessage(error)}`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Script generation failed for all configured Gemini models.");
}

async function generateStrategyTextForModel(ai: GoogleGenAI, model: string, prompt: string): Promise<string> {
  return generateJsonTextForModel(ai, model, prompt, {
    operationName: "strategy.classify",
    temperature: 0,
    maxOutputTokens: 220,
    thinkingBudget: 0,
    responseSchema: {
      type: "OBJECT",
      properties: {
        objective: { type: "STRING", enum: [...CREATIVE_OBJECTIVES] },
        genre: { type: "STRING", enum: [...CREATIVE_GENRES] },
        audienceCue: { type: "STRING" },
        rationale: { type: "STRING" },
        matchedSignals: {
          type: "ARRAY",
          items: { type: "STRING" }
        }
      },
      required: ["objective", "genre", "audienceCue", "rationale", "matchedSignals"]
    }
  });
}

async function generateStrategyContentWithFallback(ai: GoogleGenAI, contents: string): Promise<string> {
  const models = getScriptModelCandidates();
  let lastError: unknown;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index]!;
    try {
      return await generateStrategyTextForModel(ai, model, contents);
    } catch (error) {
      lastError = error;
      const hasFallback = index < models.length - 1;
      const shouldFallback = hasFallback && (isRetryableGeminiError(error) || isModelUnavailableError(error));
      if (!shouldFallback) {
        throw error;
      }
      console.warn(`[script] strategy model ${model} unavailable; falling back to ${models[index + 1]}: ${errorMessage(error)}`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Strategy classification failed for all configured Gemini models.");
}

export async function generateCampaignScript(payload: CampaignScriptGenerationInput): Promise<CampaignScriptGenerationResult> {
  const resolvedVideoType = normalizeVideoTypeForGeneration(payload.videoType);
  const outOfScopeMessage = detectOutOfScopeBrief(payload.product, payload.brief);
  if (outOfScopeMessage) {
    throw new Error(outOfScopeMessage);
  }
  const apiKey = requireApiKey();
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: GEMINI_SCRIPT_HTTP_TIMEOUT_MS
    }
  });
  const bounds = getTargetWordBounds(payload.durationSeconds);
  const briefTargetedRules = resolveBriefTargetedRules(payload.product, payload.brief);
  const strategy = await classifyCreativeStrategy(ai, payload.brief, payload.product, payload.guidelines, briefTargetedRules);
  const basePrompt = buildPrompt(
    payload.product,
    payload.durationSeconds,
    resolvedVideoType,
    payload.guidelines,
    payload.brief,
    briefTargetedRules,
    strategy
  );

  let prompt = basePrompt;
  let finalScript = "";
  let finalWordCount = 0;
  let finalCharacterCount = 0;
  let finalDurationOk = false;
  let finalNamingOk = false;
  let finalBriefOfferOk = true;
  let finalProductSpecificOk = true;
  let finalCoverage = { ok: false, mode: briefTargetedRules.length > 0 ? "brief_targeted" : strategy.rtbPolicy === "required" ? "default_strongest" : strategy.rtbPolicy, missing: [], extra: [] } as {
    ok: boolean;
    mode: "brief_targeted" | "default_strongest" | "optional" | "bypass";
    missing: string[];
    extra: string[];
  };

  for (let attempt = 1; attempt <= SCRIPT_WORD_ENFORCEMENT_ATTEMPTS; attempt += 1) {
    const response = await generateScriptContentWithFallback(ai, prompt);
    const text = response.trim();
    if (!text) {
      throw new Error("Script response was empty.");
    }

    let script: string;
    try {
      const parsed = responseSchema.parse(parseJsonObject(text));
      script = parsed.script.replace(/\s+/g, " ").trim();
    } catch {
      const fallbackScript = extractScriptFromRawText(text).replace(/\s+/g, " ").trim();
      if (!fallbackScript || !looksLikeValidSpokenScript(fallbackScript)) {
        if (attempt < SCRIPT_WORD_ENFORCEMENT_ATTEMPTS) {
          prompt = [
            basePrompt,
            "RETRY NOTE: Previous output was not strict JSON.",
            "Return strict JSON only in this shape: {\"script\":\"...\"} with no extra text."
          ].join("\n\n");
          continue;
        }
        script = buildDeterministicFallbackScript(payload.product, payload.brief, briefTargetedRules, payload.durationSeconds, strategy);
      } else {
        script = fallbackScript;
      }
    }
    script = finalizeSpokenScript(script, payload.product, strategy, payload.durationSeconds === 8 ? undefined : bounds.max);
    script = enforceBumperToneScript(payload.product, payload.brief, payload.durationSeconds, briefTargetedRules, script, strategy);
    script = finalizeSpokenScript(script, payload.product, strategy, payload.durationSeconds === 8 ? undefined : bounds.max);
    script = enforceEngagingFallbackAllScript(payload.product, payload.brief, payload.durationSeconds, briefTargetedRules, script, strategy);

    const fitted = fitScriptToDurationConstraint(script, payload.product, payload.durationSeconds, bounds, strategy);
    script = fitted.script;

    const wordCount = fitted.wordCount;
    const characterCount = fitted.characterCount;
    const durationOk = fitted.ok;
    const coverage = evaluateRtbCoverage(payload.product, briefTargetedRules, script, strategy);
    const naming = evaluateProductNaming(payload.product, script);
    const briefOfferOk = doesScriptPreserveBriefOffer(payload.brief, script);
    const productSpecificOk = !hasProductSpecificScriptIssues(script, payload.product);
    finalScript = script;
    finalWordCount = wordCount;
    finalCharacterCount = characterCount;
    finalDurationOk = durationOk;
    finalNamingOk = naming.ok;
    finalBriefOfferOk = briefOfferOk;
    finalProductSpecificOk = productSpecificOk;
    finalCoverage = coverage;

    const sizeOk =
      payload.durationSeconds === 8
        ? characterCount >= EIGHT_SECOND_MIN_CHARACTERS && characterCount <= EIGHT_SECOND_MAX_CHARACTERS
        : wordCount >= bounds.min && wordCount <= bounds.max;
    if (sizeOk && coverage.ok && durationOk && naming.ok && briefOfferOk && productSpecificOk) {
      break;
    }

    if (attempt < SCRIPT_WORD_ENFORCEMENT_ATTEMPTS) {
      const coverageIssue =
        coverage.mode === "brief_targeted"
          ? `Coverage issue: missing targeted RTB(s): ${coverage.missing.join(" | ") || "none"}; disallowed extra RTB(s): ${coverage.extra.join(" | ") || "none"}.`
          : coverage.mode === "default_strongest"
            ? `Coverage issue: missing default strongest RTB: ${coverage.missing.join(" | ") || "none"}; disallowed extra RTB(s): ${coverage.extra.join(" | ") || "none"}.`
            : `Coverage mode is ${coverage.mode}; no strict RTB coverage error, focus on strategy fit and size only.`;
      const sizeRetryNote =
        payload.durationSeconds === 8
          ? `RETRY NOTE: Previous output was ${characterCount} characters (target ${EIGHT_SECOND_MIN_CHARACTERS}-${EIGHT_SECOND_MAX_CHARACTERS}).`
          : `RETRY NOTE: Previous output had ${wordCount} words (target ${getTargetWordRange(payload.durationSeconds)}).`;
      const namingRetryNote = naming.ok ? "RETRY NOTE: Product naming was valid." : `RETRY NOTE: ${naming.reason ?? "Product naming must use the exact selected product name or omit it entirely."}`;
      const offerRetryNote = briefOfferOk ? "RETRY NOTE: Brief-stated offer was preserved." : "RETRY NOTE: Previous output drifted away from the brief-stated offer. Keep the brief offer as the hero message.";
      const productSpecificRetryNote = productSpecificOk
        ? "RETRY NOTE: Product-specific phrasing was acceptable."
        : "RETRY NOTE: Previous output had malformed Cashback+ phrasing. Use natural constructions like 'with Kotak Cashback+' and avoid broken fragments.";
      prompt = [
        basePrompt,
        sizeRetryNote,
        `RETRY NOTE: ${coverageIssue}`,
        namingRetryNote,
        offerRetryNote,
        productSpecificRetryNote,
        payload.durationSeconds === 8
          ? "Rewrite the script strictly following character-limit and RTB selection rules."
          : "Rewrite the script strictly following word-count and RTB selection rules.",
        "Return STRICT JSON only with key: script."
      ].join("\n\n");
    }
  }

  let fittedFinal = fitScriptToDurationConstraint(finalScript, payload.product, payload.durationSeconds, bounds, strategy);
  finalScript = fittedFinal.script;
  finalWordCount = fittedFinal.wordCount;
  finalCharacterCount = fittedFinal.characterCount;
  finalDurationOk = fittedFinal.ok;
  finalCoverage = evaluateRtbCoverage(payload.product, briefTargetedRules, finalScript, strategy);
  finalNamingOk = evaluateProductNaming(payload.product, finalScript).ok;
  finalBriefOfferOk = doesScriptPreserveBriefOffer(payload.brief, finalScript);
  finalProductSpecificOk = !hasProductSpecificScriptIssues(finalScript, payload.product);

  const finalSizeOk =
    payload.durationSeconds === 8
      ? finalCharacterCount >= EIGHT_SECOND_MIN_CHARACTERS && finalCharacterCount <= EIGHT_SECOND_MAX_CHARACTERS
      : finalWordCount >= bounds.min && finalWordCount <= bounds.max;

  if (!finalSizeOk || !finalCoverage.ok || !finalDurationOk || !finalNamingOk || !finalBriefOfferOk || !finalProductSpecificOk) {
    finalScript = buildDeterministicFallbackScript(payload.product, payload.brief, briefTargetedRules, payload.durationSeconds, strategy);
    finalScript = enforceBumperToneScript(payload.product, payload.brief, payload.durationSeconds, briefTargetedRules, finalScript, strategy);
    finalScript = enforceEngagingFallbackAllScript(payload.product, payload.brief, payload.durationSeconds, briefTargetedRules, finalScript, strategy);
    fittedFinal = fitScriptToDurationConstraint(finalScript, payload.product, payload.durationSeconds, bounds, strategy);
    finalScript = fittedFinal.script;
    finalWordCount = fittedFinal.wordCount;
    finalCharacterCount = fittedFinal.characterCount;
    finalDurationOk = fittedFinal.ok;
    finalCoverage = evaluateRtbCoverage(payload.product, briefTargetedRules, finalScript, strategy);
    finalNamingOk = evaluateProductNaming(payload.product, finalScript).ok;
    finalBriefOfferOk = doesScriptPreserveBriefOffer(payload.brief, finalScript);
    finalProductSpecificOk = !hasProductSpecificScriptIssues(finalScript, payload.product);
  }

  if (
    payload.durationSeconds === 8 &&
    (!finalCoverage.ok ||
      !finalNamingOk ||
      !finalBriefOfferOk ||
      !finalProductSpecificOk ||
      finalCharacterCount < EIGHT_SECOND_MIN_CHARACTERS ||
      finalCharacterCount > EIGHT_SECOND_MAX_CHARACTERS ||
      !finalDurationOk)
  ) {
    finalScript = buildStrictEightSecondFallbackScript(payload.product, payload.brief, briefTargetedRules, strategy);
    fittedFinal = fitScriptToDurationConstraint(finalScript, payload.product, payload.durationSeconds, bounds, strategy);
    finalScript = fittedFinal.script;
    finalWordCount = fittedFinal.wordCount;
    finalCharacterCount = fittedFinal.characterCount;
    finalDurationOk = fittedFinal.ok;
    finalCoverage = evaluateRtbCoverage(payload.product, briefTargetedRules, finalScript, strategy);
    finalNamingOk = evaluateProductNaming(payload.product, finalScript).ok;
    finalBriefOfferOk = doesScriptPreserveBriefOffer(payload.brief, finalScript);
    finalProductSpecificOk = !hasProductSpecificScriptIssues(finalScript, payload.product);
  }

  if (
    !finalCoverage.ok ||
    !finalNamingOk ||
    !finalBriefOfferOk ||
    !finalProductSpecificOk ||
    (payload.durationSeconds === 8
      ? finalCharacterCount < EIGHT_SECOND_MIN_CHARACTERS || finalCharacterCount > EIGHT_SECOND_MAX_CHARACTERS
      : finalWordCount < bounds.min || finalWordCount > bounds.max) ||
    !finalDurationOk
  ) {
    if (payload.durationSeconds === 8) {
      const emergencyScript = buildStrictEightSecondFallbackScript(payload.product, payload.brief, briefTargetedRules, strategy);
      const emergencyFitted = fitScriptToDurationConstraint(
        emergencyScript,
        payload.product,
        payload.durationSeconds,
        bounds,
        strategy
      );
      const emergencyCoverage = evaluateRtbCoverage(payload.product, briefTargetedRules, emergencyFitted.script, strategy);
      const emergencyNamingOk = evaluateProductNaming(payload.product, emergencyFitted.script).ok;
      const emergencyBriefOfferOk = doesScriptPreserveBriefOffer(payload.brief, emergencyFitted.script);
      const emergencyProductSpecificOk = !hasProductSpecificScriptIssues(emergencyFitted.script, payload.product);
      const emergencySizeOk =
        emergencyFitted.characterCount >= EIGHT_SECOND_MIN_CHARACTERS &&
        emergencyFitted.characterCount <= EIGHT_SECOND_MAX_CHARACTERS;

      if (emergencyNamingOk && emergencyFitted.ok && emergencySizeOk && emergencyBriefOfferOk && emergencyProductSpecificOk) {
        return {
          script: emergencyFitted.script,
          wordCount: emergencyFitted.wordCount,
          characterCount: emergencyFitted.characterCount,
          durationFitOk: emergencyFitted.ok,
          durationFitMode: "character_limit",
          strategy,
          rtbMode: emergencyCoverage.mode,
          rtbCoverageOk: emergencyCoverage.ok,
          rtbMissing: emergencyCoverage.missing,
          rtbExtra: emergencyCoverage.extra
        };
      }
    }
    throw new Error(`Unable to generate a script that fits ${payload.durationSeconds}s spoken delivery. Tighten the brief or try again.`);
  }

  return {
    script: finalScript,
    wordCount: finalWordCount,
    characterCount: finalCharacterCount,
    durationFitOk: finalDurationOk,
    durationFitMode: payload.durationSeconds === 8 ? "character_limit" : "word_limits",
    strategy,
    rtbMode: finalCoverage.mode,
    rtbCoverageOk: finalCoverage.ok,
    rtbMissing: finalCoverage.missing,
    rtbExtra: finalCoverage.extra
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = requestSchema.parse(await request.json());
    const result = await generateCampaignScript(payload);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: error.issues[0]?.message ?? "Invalid request payload."
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate script."
      },
      { status: 500 }
    );
  }
}
