import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { SoraStudioRenderPostProcess, SoraStudioResolvedInputRow } from "./types";

const LOCAL_FFMPEG_CANDIDATE = path.join(
  process.cwd(),
  "node_modules",
  "ffmpeg-static",
  process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"
);
const LOCAL_FFPROBE_CANDIDATE = path.join(
  process.cwd(),
  "node_modules",
  "ffprobe-static",
  "bin",
  process.platform,
  process.arch,
  process.platform === "win32" ? "ffprobe.exe" : "ffprobe"
);

const FFMPEG_BIN =
  process.env.SORA_STUDIO_FFMPEG_BIN?.trim() ||
  process.env.FFMPEG_BIN?.trim() ||
  (existsSync(LOCAL_FFMPEG_CANDIDATE) ? LOCAL_FFMPEG_CANDIDATE : "ffmpeg");
const FFPROBE_BIN =
  process.env.SORA_STUDIO_FFPROBE_BIN?.trim() ||
  process.env.FFPROBE_BIN?.trim() ||
  (existsSync(LOCAL_FFPROBE_CANDIDATE) ? LOCAL_FFPROBE_CANDIDATE : "ffprobe");

const BRANDING_ENABLED = process.env.SORA_STUDIO_BRANDING?.trim().toLowerCase() !== "false";
const WARN_MISSING_LOGO = process.env.SORA_STUDIO_BRANDING_WARN_MISSING_LOGO?.trim().toLowerCase() === "true";
const CAPTIONS_ENABLED = process.env.SORA_STUDIO_CAPTIONS?.trim().toLowerCase() !== "false";
const FORCE_CAPTIONS = process.env.SORA_STUDIO_CAPTIONS_FORCE?.trim().toLowerCase() === "true";
const DEFAULT_CAPTION_EXCLUDED_PROFILES = new Set([
  "privy",
  "privy_plus",
  "privy_business",
  "privy_plus_business",
  "solitaire",
  "solitaire_business"
]);

interface ProductBrandingProfile {
  key: string;
  label: string;
  patterns: RegExp[];
}

type FunnelStageKey = "awareness" | "consideration" | "conversion" | "retention" | "generic";

interface EndSlateVariantProfile {
  key: string;
  label: string;
  profileKeys?: string[];
  patterns: RegExp[];
}

interface FunnelStageProfile {
  key: FunnelStageKey;
  label: string;
  patterns: RegExp[];
}

interface MediaProbe {
  width: number;
  height: number;
  durationSeconds: number;
  hasAudio: boolean;
}

interface CaptionCue {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

interface CaptionPlan {
  cues: CaptionCue[];
  assPath: string;
  source: "script_voiceover";
  style: "boxed_bottom";
}

interface ResolvedBranding {
  profileKey: string;
  profileLabel: string;
  variantKey?: string;
  variantLabel?: string;
  funnelStage: FunnelStageKey;
  funnelLabel: string;
  logoPath?: string;
  endSlatePath?: string;
  warnings: string[];
}

export interface SoraStudioPostProcessResult {
  bytes: Buffer;
  postProcess: SoraStudioRenderPostProcess;
  warnings: string[];
}

const PRODUCT_BRANDING_PROFILES: ProductBrandingProfile[] = [
  {
    key: "privy_plus_business",
    label: "Privy+ Business",
    patterns: [
      /\bprivy\s*(?:\+|plus)\s+business\b/i,
      /\bprivy\s*(?:\+|plus)(?:\b|\s|$).*\bbulk\s+payments?\b/i
    ]
  },
  {
    key: "privy_business",
    label: "Privy Business",
    patterns: [/\bprivy\s+business\b/i, /\bprivy\s+biz\b/i]
  },
  {
    key: "privy_plus",
    label: "Kotak Privy+",
    patterns: [/\bprivy\s*(?:\+|plus)(?:\b|\s|$)/i]
  },
  {
    key: "privy",
    label: "Kotak Privy",
    patterns: [/\bprivy\b/i]
  },
  {
    key: "solitaire_business",
    label: "Kotak Solitaire Business",
    patterns: [/\bsolitaire\s+business\b/i]
  },
  {
    key: "league_credit_card",
    label: "Kotak League Credit Card",
    patterns: [/\bleague\b/i]
  },
  {
    key: "everyday_plus",
    label: "Kotak Everyday+",
    patterns: [/\bevery\s*day\s*(?:\+|plus)(?:\b|\s|$)/i, /\beveryday\s*(?:\+|plus)(?:\b|\s|$)/i]
  },
  {
    key: "air_plus",
    label: "Kotak Air / Air Plus",
    patterns: [
      /\bair\s*\+(?:\b|\s|$)/i,
      /\bair\s*(?:plus|credit|card)\b/i,
      /\bairplus\b/i,
      /\bcomplimentary\s+flight\b/i,
      /\bunbox\b/i,
      /\btravel\s+(?:card|privileges?|bookings?|spend|film)\b/i
    ]
  },
  {
    key: "cashback",
    label: "Kotak Cashback",
    patterns: [/\bcash\s*back\b/i, /\bcashback\b/i, /\b5\s*%\s*cashback\b/i]
  },
  {
    key: "solitaire",
    label: "Kotak Solitaire",
    patterns: [/\bsolitaire\b/i]
  },
  {
    key: "credit_card",
    label: "Kotak Credit Card",
    patterns: [/\bcredit\s+cards?\b/i, /\bcard\s+acquisition\b/i]
  },
  {
    key: "home_loan",
    label: "Kotak Home Loans",
    patterns: [/\bhome\s+loans?\b/i, /\bhousing\s+loans?\b/i, /\bemi\b/i]
  },
  {
    key: "personal_loan",
    label: "Kotak Personal Loan",
    patterns: [/\bpersonal\s+loans?\b/i]
  },
  {
    key: "savings_account",
    label: "Kotak Savings Account",
    patterns: [/\bsavings?\s+accounts?\b/i]
  },
  {
    key: "business_account",
    label: "Kotak Business Account",
    patterns: [/\bbusiness\s+accounts?\b/i]
  },
  {
    key: "current_account",
    label: "Kotak Current Account",
    patterns: [/\bcurrent\s+accounts?\b/i]
  },
  {
    key: "business_loan",
    label: "Kotak Business Loan",
    patterns: [
      /\bbusiness\s+loans?\b/i,
      /\bpre[-\s]?approved\s+business\s+loans?\b/i,
      /\bbusiness\s+banking\s+assets?\b.*\b(?:etb|ntb|business\s+loans?)\b/i
    ]
  },
  {
    key: "working_capital",
    label: "Kotak Working Capital",
    patterns: [
      /\bworking\s+capital\b/i,
      /\bsolar\s+funding\b/i,
      /\bhealthcare\s+financ(?:e|ing)\b/i,
      /\bmachinery\s+financ(?:e|ing)\b/i,
      /\bbill\s+discount(?:ing)?\b/i,
      /\bler\s+prime\s+plus\b/i
    ]
  },
  {
    key: "tax_payment",
    label: "Kotak Tax Payments",
    patterns: [
      /\btax\s+payments?\b/i,
      /\bkotax\b/i,
      /\badvance\s+tax\b/i,
      /\bself[-\s]?assessment\s+tax\b/i,
      /\btds\b/i,
      /\btcs\b/i,
      /\bgst\b/i,
      /\bchallans?\b/i
    ]
  },
  {
    key: "trade_services",
    label: "Kotak Trade Services",
    patterns: [/\btrade\s+services?\b/i, /\btrade\s+globally\b/i, /\btrade\s+(?:and\s+)?forex\b/i]
  },
  {
    key: "cash_management",
    label: "Kotak Cash Management",
    patterns: [/\bcash\s+management\b/i, /\bcms\b/i, /\bbulk\s+payments?\b/i]
  },
  {
    key: "pos",
    label: "Kotak POS",
    patterns: [/\bpos\b/i, /\bpoint\s+of\s+sale\b/i]
  },
  {
    key: "locker",
    label: "Kotak Locker",
    patterns: [/\blockers?\b/i]
  },
  {
    key: "insurance",
    label: "Kotak Insurance",
    patterns: [/\binsurance\b/i, /\bsenior\s+citizens?\b/i]
  },
  {
    key: "mobile_banking",
    label: "Kotak Mobile Banking",
    patterns: [/\bmobile\s+banking\b/i, /\bmobile\s+app\b/i]
  }
];

const FUNNEL_STAGE_PROFILES: FunnelStageProfile[] = [
  {
    key: "conversion",
    label: "Conversion",
    patterns: [
      /\b(?:bofu|bottom[-\s]?funnel|bottom\s+funnel)\b/i,
      /\b(?:conversion|conversions|convert|performance|retargeting|remarketing)\b/i,
      /\b(?:lead\s*gen|lead\s*generation|leads?|acquisition|sales|apply|open\s+(?:an?\s+)?account)\b/i,
      /\b(?:clicks?|cta|know\s+more|learn\s+more|sign\s*up|book\s+now)\b/i,
      /\b(?:persuasion|high[-\s]?conversion|conversion[-\s]?focused|conversion[-\s]?led)\b/i
    ]
  },
  {
    key: "consideration",
    label: "Consideration",
    patterns: [
      /\b(?:mofu|mid[-\s]?funnel|middle\s+funnel)\b/i,
      /\b(?:consideration|consider|evaluate|evaluation|why\s+choose|comparison|compare)\b/i,
      /\b(?:explainer|product\s+walkthrough|product\s+film|feature[-\s]?led|benefit[-\s]?led)\b/i,
      /\b(?:educate|education|understand|showcase|pitch|introduce\s+features?)\b/i
    ]
  },
  {
    key: "awareness",
    label: "Awareness",
    patterns: [
      /\b(?:tofu|top[-\s]?funnel|top\s+funnel)\b/i,
      /\b(?:awareness|brand|recall|reach|impressions?|views?|discovery)\b/i,
      /\b(?:introduce|launch|announcement|new\s+product|high[-\s]?recall)\b/i
    ]
  },
  {
    key: "retention",
    label: "Retention",
    patterns: [/\b(?:retention|loyalty|usage|activation|cross[-\s]?sell|upsell|existing\s+customers?)\b/i]
  }
];

const END_SLATE_VARIANT_PROFILES: EndSlateVariantProfile[] = [
  {
    key: "gst_lending",
    label: "GST Lending",
    profileKeys: ["tax_payment"],
    patterns: [/\bgst\b.*\b(?:loan|lending|pre[-\s]?approved)\b/i, /\b(?:loan|lending|pre[-\s]?approved)\b.*\bgst\b/i]
  },
  {
    key: "gst_bulk_payment",
    label: "GST Bulk Payment",
    profileKeys: ["tax_payment"],
    patterns: [/\bgst\b.*\bbulk\s+payments?\b/i, /\bbulk\s+payments?\b.*\bgst\b/i, /\bmultiple\s+gst\s+challans?\b/i]
  },
  {
    key: "card_offer",
    label: "Debit Card Offer",
    profileKeys: ["tax_payment"],
    patterns: [/\b(?:cashback|select)\b.*\bdebit\s+cards?\b/i, /\b(?:offer\s+card|card\s+offer)\b/i]
  },
  {
    key: "multiple_modes",
    label: "Multiple Modes",
    profileKeys: ["tax_payment"],
    patterns: [/\bmultiple\s+modes?\b/i, /\bmultiple\s+payment\s+modes?\b/i]
  },
  {
    key: "advance_tax",
    label: "Advance Tax",
    profileKeys: ["tax_payment"],
    patterns: [/\badvance\s+tax\b/i]
  },
  {
    key: "tds_tcs",
    label: "TDS/TCS",
    profileKeys: ["tax_payment"],
    patterns: [/\btds\b/i, /\btcs\b/i]
  },
  {
    key: "direct_tax",
    label: "Direct Tax",
    profileKeys: ["tax_payment"],
    patterns: [/\bdirect\s+tax(?:es)?\b/i, /\bdeadline\b/i]
  },
  {
    key: "gst",
    label: "GST",
    profileKeys: ["tax_payment"],
    patterns: [/\bgst\b/i]
  },
  {
    key: "ntb",
    label: "NTB",
    profileKeys: ["business_loan"],
    patterns: [/\bntb\b/i, /\bnew\s+to\s+bank\b/i]
  },
  {
    key: "etb",
    label: "ETB",
    profileKeys: ["business_loan"],
    patterns: [/\betb\b/i, /\bexisting\s+to\s+bank\b/i, /\bexisting\s+customers?\b/i]
  },
  {
    key: "solar_funding",
    label: "Solar Funding",
    profileKeys: ["working_capital"],
    patterns: [/\bsolar\s+funding\b/i, /\bsolar\b/i]
  },
  {
    key: "healthcare_financing",
    label: "Healthcare Financing",
    profileKeys: ["working_capital"],
    patterns: [/\bhealthcare\s+financ(?:e|ing)\b/i, /\bhealth\s*care\s+financ(?:e|ing)\b/i]
  },
  {
    key: "machinery_financing",
    label: "Machinery Financing",
    profileKeys: ["working_capital"],
    patterns: [/\bmachinery\s+financ(?:e|ing)\b/i, /\bmachinery\b/i]
  },
  {
    key: "bill_discounting",
    label: "Bill Discounting",
    profileKeys: ["working_capital"],
    patterns: [/\bbill\s+discount(?:ing)?\b/i]
  },
  {
    key: "ler_prime_plus",
    label: "LER Prime Plus",
    profileKeys: ["working_capital"],
    patterns: [/\bler\s+prime\s+plus\b/i, /\bler\b/i]
  },
  {
    key: "free_funding",
    label: "Free Funding",
    profileKeys: ["working_capital"],
    patterns: [/\bfree\s+fund(?:ing)?\b/i]
  },
  {
    key: "support",
    label: "Support",
    profileKeys: ["working_capital"],
    patterns: [/\bsupport\b/i]
  },
  {
    key: "locker",
    label: "Locker Rent",
    profileKeys: ["privy", "privy_plus"],
    patterns: [/\blocker\s+rent\b/i, /\blockers?\b/i, /\b40\s*%\s*off\b/i]
  },
  {
    key: "health_insurance",
    label: "Health Insurance",
    profileKeys: ["privy", "privy_plus"],
    patterns: [/\bhealth\s+insurance\b/i, /\b1\s*cr(?:ore)?\s+health\b/i]
  },
  {
    key: "home_loan",
    label: "Home Loan",
    profileKeys: ["privy", "privy_plus", "solitaire"],
    patterns: [/\bhome\s+loans?\b/i, /\bpre[-\s]?qualified\s+home\b/i, /\bpre[-\s]?approved\s+loan\b/i]
  },
  {
    key: "air_plus",
    label: "Air+",
    profileKeys: ["privy", "privy_plus", "air_plus"],
    patterns: [/\bair\s*(?:\+|plus)(?:\b|\s|$)/i, /\bair\s*\+?\s*cc\b/i]
  },
  {
    key: "fd_sip",
    label: "FD + SIP",
    profileKeys: ["privy", "privy_plus"],
    patterns: [/\bfd\s*\+\s*sip\b/i, /\bfd\b.*\bsip\b/i, /\bsip\b.*\bfd\b/i, /\binvestment\s+fd\b/i]
  },
  {
    key: "programme_led",
    label: "Programme Led",
    profileKeys: ["privy", "privy_plus"],
    patterns: [/\bprogramme\s+led\b/i, /\bprogram\s+led\b/i, /\bhausla\b/i]
  },
  {
    key: "trade_forex",
    label: "Trade and Forex",
    profileKeys: ["privy_business"],
    patterns: [/\btrade\s+(?:and\s+)?forex\b/i, /\btrade\s+globally\b/i, /\bforex\s+solutions?\b/i]
  },
  {
    key: "tax_payment",
    label: "Tax Payments",
    profileKeys: ["privy_business"],
    patterns: [/\btax\s+payments?\b/i, /\btax\b/i]
  },
  {
    key: "bulk_payments",
    label: "Bulk Payments",
    profileKeys: ["privy_plus_business", "cash_management"],
    patterns: [/\bbulk\s+payments?\b/i]
  },
  {
    key: "import_export",
    label: "Import/Export",
    profileKeys: ["solitaire_business"],
    patterns: [/\bimport\s*(?:\/|&|and)\s*export\b/i, /\bimport\b.*\bexport\b/i, /\bexport\s+transactions?\b/i]
  },
  {
    key: "forex",
    label: "Forex",
    profileKeys: ["solitaire_business"],
    patterns: [/\bforex\b/i]
  },
  {
    key: "ad_hoc_working_capital",
    label: "Ad Hoc Working Capital",
    profileKeys: ["solitaire_business"],
    patterns: [/\bad\s*hoc\s+working\s+capital\b/i]
  },
  {
    key: "working_capital",
    label: "Working Capital",
    profileKeys: ["solitaire_business"],
    patterns: [/\bworking\s+capital\b/i]
  },
  {
    key: "credit_card",
    label: "Credit Card",
    profileKeys: ["solitaire", "solitaire_business"],
    patterns: [/\bcredit\s+cards?\b/i, /\bcc\b/i, /\bsolitaire\s+cc\b/i]
  },
  {
    key: "investments",
    label: "Investments",
    profileKeys: ["solitaire"],
    patterns: [/\binvestments?\b/i]
  },
  {
    key: "pre_approved",
    label: "Pre-approved",
    profileKeys: ["personal_loan"],
    patterns: [/\bpre[-\s]?approved\b/i]
  },
  {
    key: "one_crore",
    label: "One Crore",
    profileKeys: ["personal_loan"],
    patterns: [/\b1\s*crore\b/i, /\bone\s+crore\b/i, /\bup\s+to\s+1\b/i]
  },
  {
    key: "maximum_savings",
    label: "Maximum Savings",
    profileKeys: ["everyday_plus"],
    patterns: [/\bmaximi[sz]e\b/i, /\bmaximum\b/i, /\bmonthly\s+savings?\b/i]
  },
  {
    key: "cashback",
    label: "Cashback",
    profileKeys: ["everyday_plus", "cashback"],
    patterns: [/\b5\s*%\s*cashback\b/i, /\bcashback\b/i]
  },
  {
    key: "offers",
    label: "Offers",
    profileKeys: ["everyday_plus"],
    patterns: [/\boffers?\b/i, /\benjoy(?:ing)?\b/i]
  }
];

const FUNNEL_STAGE_LOOKUP_ORDER: Record<FunnelStageKey, FunnelStageKey[]> = {
  awareness: ["awareness", "generic"],
  consideration: ["consideration", "awareness", "generic"],
  conversion: ["conversion", "consideration", "awareness", "generic"],
  retention: ["retention", "conversion", "consideration", "awareness", "generic"],
  generic: ["generic"]
};

function compact(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeEnvToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
}

function resolvePathCandidate(value: string | undefined): string | undefined {
  const trimmed = compact(value);
  if (!trimmed) {
    return undefined;
  }
  const candidate = path.isAbsolute(trimmed) ? trimmed : path.join(process.cwd(), trimmed);
  return existsSync(candidate) ? candidate : undefined;
}

function firstExisting(candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    const resolved = resolvePathCandidate(candidate);
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}

function csvEnvSet(name: string): Set<string> | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return undefined;
  }
  return new Set(
    raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function extensionCandidates(stem: string): string[] {
  return [".png", ".jpg", ".jpeg", ".webp"].map((extension) => `${stem}${extension}`);
}

function resolveBrandingProfile(input: SoraStudioResolvedInputRow): ProductBrandingProfile {
  const haystack = buildBrandingHaystack(input);

  return PRODUCT_BRANDING_PROFILES.find((profile) => profile.patterns.some((pattern) => pattern.test(haystack))) ?? {
    key: "generic",
    label: "Kotak Mahindra Bank",
    patterns: []
  };
}

function buildBrandingHaystack(input: SoraStudioResolvedInputRow): string {
  return [
    input.product,
    input.brief,
    input.businessObjective,
    input.creativeObjectiveFunnel
  ]
    .map(compact)
    .join(" ");
}

function resolveEndSlateVariant(
  profileKey: string,
  input: SoraStudioResolvedInputRow
): EndSlateVariantProfile | undefined {
  const haystack = buildBrandingHaystack(input);
  return END_SLATE_VARIANT_PROFILES.find((variant) => {
    if (variant.profileKeys && !variant.profileKeys.includes(profileKey)) {
      return false;
    }
    return variant.patterns.some((pattern) => pattern.test(haystack));
  });
}

function resolveFunnelStage(input: SoraStudioResolvedInputRow): FunnelStageProfile {
  const explicitFunnel = compact(input.creativeObjectiveFunnel);
  const broadContext = buildBrandingHaystack(input);
  const conversion = FUNNEL_STAGE_PROFILES.find((profile) => profile.key === "conversion");
  const consideration = FUNNEL_STAGE_PROFILES.find((profile) => profile.key === "consideration");
  const awareness = FUNNEL_STAGE_PROFILES.find((profile) => profile.key === "awareness");
  const retention = FUNNEL_STAGE_PROFILES.find((profile) => profile.key === "retention");

  const ordered = [conversion, consideration, awareness, retention].filter((profile): profile is FunnelStageProfile => Boolean(profile));
  const direct = ordered.find((profile) => profile.patterns.some((pattern) => pattern.test(explicitFunnel)));
  if (direct) {
    return direct;
  }

  return ordered.find((profile) => profile.patterns.some((pattern) => pattern.test(broadContext))) ?? {
    key: "generic",
    label: "Generic",
    patterns: []
  };
}

function endSlatePathCandidates(params: {
  profileKey: string;
  funnelStage: FunnelStageKey;
  renderAspectRatio: SoraStudioResolvedInputRow["renderAspectRatio"];
  variantKey?: string;
}): string[] {
  const { profileKey, funnelStage, renderAspectRatio, variantKey } = params;
  const ratioToken = renderAspectRatio.replace(":", "x");
  const candidates: string[] = [];

  if (variantKey) {
    candidates.push(
      path.join("assets", "end-slates", profileKey, funnelStage, `${variantKey}-${ratioToken}.mp4`),
      path.join("assets", "end-slates", profileKey, funnelStage, `${variantKey}_${ratioToken}.mp4`),
      path.join("assets", "end-slates", profileKey, funnelStage, `${variantKey}.mp4`),
      path.join("assets", "end-slates", profileKey, variantKey, funnelStage, `${ratioToken}.mp4`),
      path.join("assets", "end-slates", profileKey, variantKey, funnelStage, "default.mp4"),
      path.join("assets", "end-slates", `${profileKey}-${variantKey}-${funnelStage}-${ratioToken}.mp4`),
      path.join("assets", "end-slates", `${profileKey}_${variantKey}_${funnelStage}_${ratioToken}.mp4`),
      path.join("assets", "end-slates", `${profileKey}-${variantKey}-${funnelStage}.mp4`),
      path.join("assets", "end-slates", `${profileKey}_${variantKey}_${funnelStage}.mp4`),
      path.join("assets", "end-slates", `${profileKey}-${variantKey}-${ratioToken}.mp4`),
      path.join("assets", "end-slates", `${profileKey}_${variantKey}_${ratioToken}.mp4`),
      path.join("assets", "end-slates", `${profileKey}-${variantKey}.mp4`),
      path.join("assets", "end-slates", `${profileKey}_${variantKey}.mp4`)
    );
  }

  candidates.push(
    path.join("assets", "end-slates", profileKey, funnelStage, `${ratioToken}.mp4`),
    path.join("assets", "end-slates", profileKey, funnelStage, `default-${ratioToken}.mp4`),
    path.join("assets", "end-slates", profileKey, funnelStage, "default.mp4"),
    path.join("assets", "end-slates", `${profileKey}-${funnelStage}-${ratioToken}.mp4`),
    path.join("assets", "end-slates", `${profileKey}_${funnelStage}_${ratioToken}.mp4`),
    path.join("assets", "end-slates", `${profileKey}-${funnelStage}.mp4`),
    path.join("assets", "end-slates", `${profileKey}_${funnelStage}.mp4`),
    path.join("assets", "end-slates", `${profileKey}-${ratioToken}.mp4`),
    path.join("assets", "end-slates", `${profileKey}_${ratioToken}.mp4`),
    path.join("assets", "end-slates", `${profileKey}.mp4`)
  );

  if (funnelStage !== "generic") {
    candidates.push(
      path.join("assets", "end-slates", "generic", funnelStage, `${ratioToken}.mp4`),
      path.join("assets", "end-slates", `generic-${funnelStage}-${ratioToken}.mp4`),
      path.join("assets", "end-slates", `generic_${funnelStage}_${ratioToken}.mp4`),
      path.join("assets", "end-slates", `generic-${funnelStage}.mp4`),
      path.join("assets", "end-slates", `generic_${funnelStage}.mp4`)
    );
  }

  return candidates;
}

function resolveEndSlatePath(
  profileKey: string,
  funnelStage: FunnelStageKey,
  renderAspectRatio: SoraStudioResolvedInputRow["renderAspectRatio"],
  variantKey?: string
): string | undefined {
  const envKey = normalizeEnvToken(profileKey);
  const funnelEnvKey = normalizeEnvToken(funnelStage);
  const variantEnvKey = variantKey ? normalizeEnvToken(variantKey) : undefined;
  const ratioToken = renderAspectRatio.replace(":", "x");
  const variantEnvCandidates = variantEnvKey
    ? [
        process.env[`SORA_STUDIO_${envKey}_${variantEnvKey}_${funnelEnvKey}_${ratioToken.toUpperCase()}_END_SLATE_PATH`],
        process.env[`SORA_STUDIO_${envKey}_${variantEnvKey}_${funnelEnvKey}_END_SLATE_PATH`],
        process.env[`SORA_STUDIO_${envKey}_${variantEnvKey}_${ratioToken.toUpperCase()}_END_SLATE_PATH`],
        process.env[`SORA_STUDIO_${envKey}_${variantEnvKey}_END_SLATE_PATH`]
      ]
    : [];
  const aspectSpecificEnv =
    process.env[`SORA_STUDIO_${envKey}_${funnelEnvKey}_${ratioToken.toUpperCase()}_END_SLATE_PATH`] ||
    process.env[`SORA_STUDIO_${envKey}_${funnelEnvKey}_END_SLATE_PATH`] ||
    process.env[`SORA_STUDIO_${envKey}_${ratioToken.toUpperCase()}_END_SLATE_PATH`] ||
    process.env[`SORA_STUDIO_${envKey}_END_SLATE_PATH`] ||
    process.env[`SORA_STUDIO_${funnelEnvKey}_${ratioToken.toUpperCase()}_END_SLATE_PATH`] ||
    process.env[`SORA_STUDIO_${funnelEnvKey}_END_SLATE_PATH`];
  const defaultEnv = process.env.SORA_STUDIO_DEFAULT_END_SLATE_PATH;

  const builtInByProfile: Record<string, string[]> = {
    air_plus:
      renderAspectRatio === "16:9"
        ? [path.join("assets", "end-slate-air-plus-16x9.mp4"), path.join("assets", "end-slate-air-plus.mp4")]
        : [path.join("assets", "end-slate-air-plus.mp4")],
    cashback: [path.join("assets", "end-slate-cashback.mp4")],
    generic: [path.join("assets", "end-slate.mp4")]
  };

  const pathCandidates = FUNNEL_STAGE_LOOKUP_ORDER[funnelStage].flatMap((stage) =>
    endSlatePathCandidates({ profileKey, funnelStage: stage, renderAspectRatio, variantKey })
  );

  return firstExisting([
    ...variantEnvCandidates,
    aspectSpecificEnv,
    ...pathCandidates,
    ...(builtInByProfile[profileKey] ?? []),
    defaultEnv,
    ...(builtInByProfile.generic ?? [])
  ]);
}

function resolveLogoPath(profileKey: string): string | undefined {
  const envKey = normalizeEnvToken(profileKey);
  const envLogo = process.env[`SORA_STUDIO_${envKey}_LOGO_PATH`];
  const defaultLogo = process.env.SORA_STUDIO_DEFAULT_LOGO_PATH;

  return firstExisting([
    envLogo,
    ...extensionCandidates(path.join("assets", "product-logos", profileKey)),
    ...extensionCandidates(path.join("assets", "brand-logos", profileKey)),
    ...extensionCandidates(path.join("assets", `logo-${profileKey}`)),
    defaultLogo,
    ...extensionCandidates(path.join("assets", "product-logos", "generic")),
    ...extensionCandidates(path.join("assets", "brand-logos", "generic")),
    ...extensionCandidates(path.join("assets", "logo"))
  ]);
}

function resolveBranding(input: SoraStudioResolvedInputRow): ResolvedBranding {
  const profile = resolveBrandingProfile(input);
  const variant = resolveEndSlateVariant(profile.key, input);
  const funnel = resolveFunnelStage(input);
  const warnings: string[] = [];
  const endSlatePath = resolveEndSlatePath(profile.key, funnel.key, input.renderAspectRatio, variant?.key);
  const logoPath = resolveLogoPath(profile.key);

  if (!endSlatePath) {
    warnings.push(`No ${funnel.label.toLowerCase()} end slate found for ${profile.label}; kept generated video without a slate.`);
  }
  if (!logoPath && WARN_MISSING_LOGO) {
    warnings.push(`No logo found for ${profile.label}; skipped logo overlay.`);
  }

  return {
    profileKey: profile.key,
    profileLabel: profile.label,
    variantKey: variant?.key,
    variantLabel: variant?.label,
    funnelStage: funnel.key,
    funnelLabel: funnel.label,
    logoPath,
    endSlatePath,
    warnings
  };
}

function excludedCaptionProfiles(): Set<string> {
  return csvEnvSet("SORA_STUDIO_CAPTIONS_EXCLUDE_PROFILES") ?? DEFAULT_CAPTION_EXCLUDED_PROFILES;
}

function shouldApplyCaptions(profileKey: string): boolean {
  if (!CAPTIONS_ENABLED) {
    return false;
  }
  if (FORCE_CAPTIONS) {
    return true;
  }
  return !excludedCaptionProfiles().has(profileKey);
}

function normalizeCaptionText(value: string): string {
  return value
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/^[A-Za-z][^:]{0,30}:\s+/, "")
    .trim()
    .replace(/^["']+|["']+$/g, "");
}

function splitCaptionText(value: string): string[] {
  const words = normalizeCaptionText(value).split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];
  const maxWords = 7;
  const maxChars = 44;

  for (const word of words) {
    const next = [...current, word];
    const nextText = next.join(" ");
    if (current.length > 0 && (next.length > maxWords || nextText.length > maxChars)) {
      chunks.push(current.join(" "));
      current = [word];
    } else {
      current = next;
    }
  }

  if (current.length > 0) {
    chunks.push(current.join(" "));
  }

  return chunks;
}

function parseShotRange(line: string): { startSeconds: number; endSeconds: number } | undefined {
  const match = line.match(/\((\d+(?:\.\d+)?)\s*s?\s*[-\u2013]\s*(\d+(?:\.\d+)?)\s*s?\)/i);
  if (!match) {
    return undefined;
  }
  const startSeconds = Number.parseFloat(match[1] ?? "");
  const endSeconds = Number.parseFloat(match[2] ?? "");
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
    return undefined;
  }
  return { startSeconds, endSeconds };
}

function extractCaptionEntries(script: string): Array<{ text: string; range?: { startSeconds: number; endSeconds: number } }> {
  const lines = script.replace(/\r\n/g, "\n").split("\n");
  const entries: Array<{ text: string; range?: { startSeconds: number; endSeconds: number } }> = [];
  let currentRange: { startSeconds: number; endSeconds: number } | undefined;

  for (const line of lines) {
    if (/^\s*SHOT\s+\d+/i.test(line)) {
      currentRange = parseShotRange(line);
      continue;
    }

    const match = line.match(/^\s*-\s*(?:VO\/Dialogue|Dialogue\/VO|Dialogue|VO|Voice\s*Over|Voiceover)\s*:\s*(.+)\s*$/i);
    if (!match?.[1]) {
      continue;
    }

    const text = normalizeCaptionText(match[1]);
    if (text) {
      entries.push({ text, range: currentRange });
    }
  }

  return entries;
}

function distributeCaptionChunks(
  chunks: string[],
  range: { startSeconds: number; endSeconds: number },
  maxDurationSeconds: number
): CaptionCue[] {
  const start = Math.max(0, Math.min(range.startSeconds, maxDurationSeconds));
  const end = Math.max(start + 0.25, Math.min(range.endSeconds, maxDurationSeconds));
  const available = Math.max(0.8, end - start);
  const slice = available / Math.max(1, chunks.length);

  return chunks.map((text, index) => {
    const chunkStart = start + index * slice;
    const chunkEnd = index === chunks.length - 1 ? end : start + (index + 1) * slice;
    return {
      text,
      startSeconds: Math.max(0, chunkStart),
      endSeconds: Math.max(chunkStart + 0.45, chunkEnd)
    };
  });
}

function buildCaptionCues(script: string, durationSeconds: number): CaptionCue[] {
  const entries = extractCaptionEntries(script);
  if (entries.length === 0 || durationSeconds <= 0) {
    return [];
  }

  const ranged: CaptionCue[] = [];
  const unrangedChunks: string[] = [];

  for (const entry of entries) {
    const chunks = splitCaptionText(entry.text);
    if (chunks.length === 0) {
      continue;
    }
    if (entry.range) {
      ranged.push(...distributeCaptionChunks(chunks, entry.range, durationSeconds));
    } else {
      unrangedChunks.push(...chunks);
    }
  }

  if (ranged.length > 0 && unrangedChunks.length === 0) {
    return ranged.filter((cue) => cue.endSeconds > cue.startSeconds);
  }

  const allChunks = [...ranged.map((cue) => cue.text), ...unrangedChunks];
  if (allChunks.length === 0) {
    return [];
  }

  const captionStart = Math.min(0.35, Math.max(0, durationSeconds * 0.05));
  const captionEnd = Math.max(captionStart + 0.8, durationSeconds - Math.min(0.35, durationSeconds * 0.05));
  return distributeCaptionChunks(allChunks, { startSeconds: captionStart, endSeconds: captionEnd }, durationSeconds);
}

function formatAssTime(value: number): string {
  const totalCentiseconds = Math.max(0, Math.round(value * 100));
  const hours = Math.floor(totalCentiseconds / 360000);
  const minutes = Math.floor((totalCentiseconds % 360000) / 6000);
  const seconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function escapeAssText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

function wrapCaptionForAss(value: string): string {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length <= 4 || value.length <= 24) {
    return escapeAssText(value);
  }
  const midpoint = Math.ceil(words.length / 2);
  return `${escapeAssText(words.slice(0, midpoint).join(" "))}\\N${escapeAssText(words.slice(midpoint).join(" "))}`;
}

function buildAssSubtitle(cues: CaptionCue[], frame: { width: number; height: number }): string {
  const portrait = frame.height >= frame.width;
  const fontSize = portrait ? 58 : 46;
  const marginV = portrait ? 170 : 82;
  const outline = portrait ? 2 : 1.5;
  const events = cues
    .map(
      (cue) =>
        `Dialogue: 0,${formatAssTime(cue.startSeconds)},${formatAssTime(cue.endSeconds)},Default,,0,0,0,,${wrapCaptionForAss(
          cue.text
        )}`
    )
    .join("\n");

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${frame.width}`,
    `PlayResY: ${frame.height}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Arial,${fontSize},&H00FFFFFF,&H00FFFFFF,&HAA000000,&H99000000,-1,0,0,0,100,100,0,0,3,${outline},0,2,70,70,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    events
  ].join("\n");
}

async function createCaptionPlan(params: {
  profileKey: string;
  captionText?: string;
  durationSeconds: number;
  frame: { width: number; height: number };
  outputPath: string;
}): Promise<CaptionPlan | undefined> {
  if (!shouldApplyCaptions(params.profileKey)) {
    return undefined;
  }
  const cues = buildCaptionCues(params.captionText ?? "", params.durationSeconds);
  if (cues.length === 0) {
    return undefined;
  }
  const parsed = path.parse(params.outputPath);
  const digest = createHash("sha256")
    .update(`${params.outputPath}:caption:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 8);
  const assPath = path.join(parsed.dir, `${parsed.name}.captions-${digest}.ass`);
  await fs.writeFile(assPath, buildAssSubtitle(cues, params.frame), "utf8");
  return { cues, assPath, source: "script_voiceover", style: "boxed_bottom" };
}

function escapeFilterPath(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function applyCaptionsFilter(inputLabel: string, outputLabel: string, captionPlan?: CaptionPlan): string {
  if (!captionPlan) {
    return `[${inputLabel}]null[${outputLabel}]`;
  }
  return `[${inputLabel}]subtitles=filename='${escapeFilterPath(captionPlan.assPath)}'[${outputLabel}]`;
}

function runProcessResult(command: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function runProcess(command: string, args: string[], errorPrefix: string): Promise<string> {
  const result = await runProcessResult(command, args).catch((error) => {
    throw new Error(`${errorPrefix}: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (result.code === 0) {
    return result.stdout;
  }
  throw new Error(`${errorPrefix}: ${result.stderr.trim() || `exit code ${result.code ?? "unknown"}`}`);
}

function parseDurationFromFfmpeg(value: string): number {
  const match = value.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  if (!match) {
    return 0.1;
  }
  const hours = Number.parseInt(match[1] ?? "0", 10);
  const minutes = Number.parseInt(match[2] ?? "0", 10);
  const seconds = Number.parseFloat(match[3] ?? "0");
  const total = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) && total > 0 ? total : 0.1;
}

function parseProbeFromFfmpeg(stderr: string): MediaProbe {
  const videoMatch = stderr.match(/Stream\s+#\d+:\d+[^:\n]*:\s*Video:[^\n]*?,\s*(\d{2,5})x(\d{2,5})(?:[\s,]|$)/i);
  return {
    width: videoMatch ? Number.parseInt(videoMatch[1] ?? "0", 10) : 0,
    height: videoMatch ? Number.parseInt(videoMatch[2] ?? "0", 10) : 0,
    durationSeconds: parseDurationFromFfmpeg(stderr),
    hasAudio: /Stream\s+#\d+:\d+[^:\n]*:\s*Audio:/i.test(stderr)
  };
}

async function probeMediaWithFfmpeg(filePath: string): Promise<MediaProbe> {
  const result = await runProcessResult(FFMPEG_BIN, ["-hide_banner", "-i", filePath]).catch((error) => {
    throw new Error(`ffmpeg probe failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  return parseProbeFromFfmpeg(result.stderr);
}

async function probeMedia(filePath: string): Promise<MediaProbe> {
  let raw: string;
  try {
    raw = await runProcess(
      FFPROBE_BIN,
      ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath],
      "ffprobe failed"
    );
  } catch {
    return probeMediaWithFfmpeg(filePath);
  }
  const parsed = JSON.parse(raw) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
    format?: { duration?: string };
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const audio = parsed.streams?.some((stream) => stream.codec_type === "audio") ?? false;
  const durationRaw = Number.parseFloat(parsed.format?.duration ?? video?.duration ?? "");
  return {
    width: typeof video?.width === "number" ? video.width : 0,
    height: typeof video?.height === "number" ? video.height : 0,
    durationSeconds: Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 0.1,
    hasAudio: audio
  };
}

function even(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function targetFrame(input: MediaProbe, aspectRatio: SoraStudioResolvedInputRow["renderAspectRatio"]): { width: number; height: number } {
  if (input.width > 0 && input.height > 0) {
    return { width: even(input.width), height: even(input.height) };
  }
  return aspectRatio === "16:9" ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
}

function audioFilter(inputIndex: number, outputLabel: string, probe: MediaProbe): string {
  if (probe.hasAudio) {
    return `[${inputIndex}:a]aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[${outputLabel}]`;
  }
  return `anullsrc=r=48000:cl=stereo,atrim=duration=${probe.durationSeconds.toFixed(3)},asetpts=PTS-STARTPTS[${outputLabel}]`;
}

function buildBaseVideoFilter(inputIndex: number, width: number, height: number, outputLabel: string, format = "yuv420p"): string {
  return `[${inputIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=${format}[${outputLabel}]`;
}

function encodeArgs(outputPath: string): string[] {
  return [
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    outputPath
  ];
}

async function renderBaseVideoPostProcess(params: {
  inputPath: string;
  outputPath: string;
  logoPath?: string;
  captionPlan?: CaptionPlan;
  frame: { width: number; height: number };
}): Promise<void> {
  const margin = Math.max(24, Math.round(params.frame.width * 0.04));
  const logoWidth = even(Math.max(92, Math.min(260, params.frame.width * (params.frame.width > params.frame.height ? 0.12 : 0.18))));
  const filters = [
    buildBaseVideoFilter(0, params.frame.width, params.frame.height, "base", "yuv420p"),
    applyCaptionsFilter("base", "captioned", params.captionPlan)
  ];

  if (params.logoPath) {
    filters.push(`[1:v]scale=${logoWidth}:-1,format=rgba[logo]`);
    filters.push("[captioned]format=rgba[baseLogo]");
    filters.push(`[baseLogo][logo]overlay=x=main_w-overlay_w-${margin}:y=${margin}:format=auto:shortest=1,format=yuv420p[v]`);
  } else {
    filters.push("[captioned]format=yuv420p[v]");
  }

  filters.push(audioFilter(0, "a", await probeMedia(params.inputPath)));

  const args = ["-y", "-i", params.inputPath];
  if (params.logoPath) {
    args.push("-loop", "1", "-i", params.logoPath);
  }
  args.push("-filter_complex", filters.join(";"), ...encodeArgs(params.outputPath));

  await runProcess(FFMPEG_BIN, args, "ffmpeg base video post-processing failed");
}

async function renderSlateAndLogo(params: {
  inputPath: string;
  outputPath: string;
  endSlatePath: string;
  logoPath?: string;
  captionPlan?: CaptionPlan;
  frame: { width: number; height: number };
  inputProbe: MediaProbe;
  slateProbe: MediaProbe;
}): Promise<void> {
  const margin = Math.max(24, Math.round(params.frame.width * 0.04));
  const logoWidth = even(Math.max(92, Math.min(260, params.frame.width * (params.frame.width > params.frame.height ? 0.12 : 0.18))));
  const filters = [
    buildBaseVideoFilter(0, params.frame.width, params.frame.height, "base0", "yuv420p"),
    applyCaptionsFilter("base0", "captioned0", params.captionPlan)
  ];

  if (params.logoPath) {
    filters.push(`[2:v]scale=${logoWidth}:-1,format=rgba[logo]`);
    filters.push("[captioned0]format=rgba[baseLogo]");
    filters.push(`[baseLogo][logo]overlay=x=main_w-overlay_w-${margin}:y=${margin}:format=auto:shortest=1,format=yuv420p[v0]`);
  } else {
    filters.push("[captioned0]format=yuv420p[v0]");
  }

  filters.push(buildBaseVideoFilter(1, params.frame.width, params.frame.height, "v1"));
  filters.push(audioFilter(0, "a0", params.inputProbe));
  filters.push(audioFilter(1, "a1", params.slateProbe));
  filters.push("[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]");

  const args = ["-y", "-i", params.inputPath, "-i", params.endSlatePath];
  if (params.logoPath) {
    args.push("-loop", "1", "-i", params.logoPath);
  }
  args.push("-filter_complex", filters.join(";"), ...encodeArgs(params.outputPath));

  await runProcess(FFMPEG_BIN, args, "ffmpeg brand post-processing failed");
}

function buildTempOutputPath(outputPath: string): string {
  const parsed = path.parse(outputPath);
  const digest = createHash("sha256").update(`${outputPath}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 8);
  return path.join(parsed.dir, `${parsed.name}.brand-${digest}${parsed.ext}`);
}

export async function applySoraStudioProductBranding(params: {
  input: SoraStudioResolvedInputRow;
  inputPath: string;
  outputPath: string;
  rawAssetFile: string;
  outputAssetFile: string;
  captionText?: string;
}): Promise<SoraStudioPostProcessResult> {
  const branding = resolveBranding(params.input);
  const warnings = [...branding.warnings];
  const effectiveLogoPath = BRANDING_ENABLED ? branding.logoPath : undefined;
  const effectiveEndSlatePath = BRANDING_ENABLED ? branding.endSlatePath : undefined;
  const captionsWanted = shouldApplyCaptions(branding.profileKey) && compact(params.captionText).length > 0;
  const disabledWarning = BRANDING_ENABLED ? undefined : "Product branding is disabled.";
  const initialWarnings = disabledWarning ? [...warnings, disabledWarning] : warnings;
  const basePostProcess: SoraStudioRenderPostProcess = {
    applied: false,
    profileKey: branding.profileKey,
    profileLabel: branding.profileLabel,
    variantKey: branding.variantKey,
    variantLabel: branding.variantLabel,
    funnelStage: branding.funnelStage,
    rawAssetFile: params.rawAssetFile,
    outputAssetFile: params.outputAssetFile,
    captionsApplied: false,
    logoFile: effectiveLogoPath ? path.basename(effectiveLogoPath) : undefined,
    endSlateFile: effectiveEndSlatePath ? path.basename(effectiveEndSlatePath) : undefined
  };

  if (!effectiveLogoPath && !effectiveEndSlatePath && !captionsWanted) {
    await fs.copyFile(params.inputPath, params.outputPath);
    const bytes = await fs.readFile(params.outputPath);
    return {
      bytes,
      warnings: initialWarnings,
      postProcess: {
        ...basePostProcess,
        warnings: initialWarnings.length > 0 ? initialWarnings : undefined
      }
    };
  }

  const tempOutputPath = buildTempOutputPath(params.outputPath);
  let captionPlan: CaptionPlan | undefined;
  try {
    const inputProbe = await probeMedia(params.inputPath);
    const frame = targetFrame(inputProbe, params.input.renderAspectRatio);
    captionPlan = await createCaptionPlan({
      profileKey: branding.profileKey,
      captionText: params.captionText,
      durationSeconds: inputProbe.durationSeconds,
      frame,
      outputPath: params.outputPath
    });

    if (!effectiveLogoPath && !effectiveEndSlatePath && !captionPlan) {
      await fs.copyFile(params.inputPath, params.outputPath);
    } else if (effectiveEndSlatePath) {
      const slateProbe = await probeMedia(effectiveEndSlatePath);
      await renderSlateAndLogo({
        inputPath: params.inputPath,
        outputPath: tempOutputPath,
        endSlatePath: effectiveEndSlatePath,
        logoPath: effectiveLogoPath,
        captionPlan,
        frame,
        inputProbe,
        slateProbe
      });
    } else {
      await renderBaseVideoPostProcess({
        inputPath: params.inputPath,
        outputPath: tempOutputPath,
        logoPath: effectiveLogoPath,
        captionPlan,
        frame
      });
    }

    if (existsSync(tempOutputPath)) {
      await fs.rename(tempOutputPath, params.outputPath);
    }
    const bytes = await fs.readFile(params.outputPath);
    const nextWarnings = initialWarnings;
    return {
      bytes,
      warnings: nextWarnings,
      postProcess: {
        ...basePostProcess,
        applied: Boolean(effectiveLogoPath || effectiveEndSlatePath || captionPlan),
        captionsApplied: Boolean(captionPlan),
        captionSource: captionPlan?.source,
        captionStyle: captionPlan?.style,
        warnings: nextWarnings.length > 0 ? nextWarnings : undefined
      }
    };
  } catch (error) {
    await fs.unlink(tempOutputPath).catch(() => undefined);
    await fs.copyFile(params.inputPath, params.outputPath);
    const bytes = await fs.readFile(params.outputPath);
    const fallbackWarning = `Post-processing failed; kept original generated video. ${
      error instanceof Error ? error.message : String(error)
    }`;
    const nextWarnings = [...initialWarnings, fallbackWarning];
    return {
      bytes,
      warnings: nextWarnings,
      postProcess: {
        ...basePostProcess,
        warnings: nextWarnings
      }
    };
  } finally {
    if (captionPlan?.assPath) {
      await fs.unlink(captionPlan.assPath).catch(() => undefined);
    }
  }
}
