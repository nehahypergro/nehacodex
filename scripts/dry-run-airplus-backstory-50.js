#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { GoogleGenAI } = require("@google/genai");
const { z } = require("zod");

const DEFAULT_TEXT_MODEL = "gemini-3.1-pro-preview";
const DEFAULT_LOGIC_FALLBACK_MODELS = ["gemini-2.5-pro", "gemini-3-flash-preview"];
const GENAI_MAX_ATTEMPTS = Number(process.env.GENAI_MAX_ATTEMPTS || 5);
const GENAI_RETRY_BASE_MS = Number(process.env.GENAI_RETRY_BASE_MS || 2000);
const GENAI_HTTP_TIMEOUT_MS = Number(process.env.GENAI_HTTP_TIMEOUT_MS || 180000);
const ITERATIONS = Number(process.env.BACKSTORY_DRY_RUN_ITERATIONS || 50);
const SETTING_SIMILARITY_THRESHOLD = 0.62;
const BACKSTORY_RECENT_WINDOW = 10;
const WARDROBE_CLEAN_FALLBACK = "Well-ironed, wrinkle-free, clean attire aligned to persona and setting.";
const DEVICE_PATTERN =
  /\b(phone|smartphone|mobile|cellphone|laptop|tablet|ipad|monitor|screen|display|tv|television|smartwatch|watch|ui|interface|credit\s*card|debit\s*card|payment\s*card|card\s*mockup|physical\s*card)\b/i;
const TERMINAL_CODE_PATTERN = /\b(?:t[1-9]|terminal\s*[1-9]?)\b/i;
const AIRPORT_CURBSIDE_PATTERN = /\b(airport|terminal|departure|arrivals?|curbside|drop[-\s]?off)\b/i;
const SWEAT_SPOT_PATTERN =
  /\b(sweat|sweaty|perspiration|perspiring|damp(?:\s*patch(?:es)?)?|sweat[-\s]?spots?|underarm\s*marks?)\b/i;
const WRINKLED_CLOTHES_PATTERN = /\b(wrinkle[sd]?|wrinkled|crease[sd]?|creased|crumpled|rumpled)\b/i;
const AIR_PLUS_DISALLOWED_SETTING_PATTERN =
  /\b(railway|train station|station concourse|intercity station|bus terminal|metro rail|metro transfer|platform|rail transfer)\b/i;
const GENERIC_HOME_PATTERN = /\b(living room|home office|bedroom|sofa|apartment living area|drawing room)\b/i;
const INDOOR_BIAS_SETTING_PATTERN =
  /\b(apartment|home office|living room|study|bookshelf|shelf|framed world map|world map|minimalist corner|interior corner)\b/i;
const SETTING_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "showing",
  "visible",
  "where",
  "that",
  "this",
  "there"
]);

const PERSONA_FIRST_NAMES = [
  "Aarav", "Aditya", "Akash", "Arjun", "Kabir", "Karan", "Neel", "Rohan", "Samar", "Varun",
  "Aditi", "Ananya", "Ira", "Kavya", "Mira", "Naina", "Rhea", "Sana", "Tara", "Veda"
];
const PERSONA_LAST_NAMES = [
  "Sharma", "Mehta", "Kapoor", "Nair", "Rao", "Iyer", "Bose", "Khanna", "Malhotra", "Singh"
];
const AIR_PLUS_CITY_POOL = ["Delhi NCR", "Mumbai", "Bengaluru", "Hyderabad", "Chandigarh", "Pune", "Ahmedabad"];
const AIR_PLUS_PROFESSION_POOL = [
  "management consultant",
  "startup founder",
  "regional sales leader",
  "corporate lawyer",
  "design director",
  "venture capital principal",
  "hotel operations lead",
  "business journalist",
  "strategy manager",
  "brand partnerships lead"
];

const MIXED_AIR_PLUS_BRIEF_POOL = [
  "Need a premium travel vibe for metro users. air plus. not too airport only pls.",
  "air plus for holidays and scenic vacations. affluent metro travellers. premium getaway mood.",
  "focus on travel rewards via unbox. reels ad. people who already spend on flights/hotels.",
  "business travellers, late 20s to 40s, clean polished look. keep it premium but real.",
  "show vacation energy, but not cheesy beach stock type. upscale Indian traveller feel.",
  "for people who take quick work trips from BLR / BOM / DEL. useful travel card positioning.",
  "Need travel card world. lounge / transfer / premium arrival works.",
  "holiday travel, maybe waterfront resort or hillside stay kind of setting. affluent TG.",
  "performance ad for air plus. travel reward is hero. audience is metro corporate + founders.",
  "more destination-y please. not generic office corridor. still needs travel cues.",
  "for high intent travel spenders. city people. frequent flyers. premium realistic styling.",
  "want scenic and expensive-looking but grounded. no bank branch vibes.",
  "target audience: premium urban couples who travel 4-5 times a year.",
  "travel card, social media film, audience are people already booking hotels and flights online.",
  "Use rich travel lifestyle cues. Could be resort arrival / city hotel / airport transfer.",
  "Need a reel for affluent metro India. premium but everyday believable.",
  "airplus for weekend getaways and mini vacations, not just work trip stuff.",
  "business class energy without literally showing aircraft interiors. premium commute/trip-day okay.",
  "Travel-heavy customer. mix of work + leisure. can be stylish and cinematic.",
  "Please avoid station / train / bus / cheap transit look. premium only.",
  "for founders, consultants, CXOs who move city to city a lot. polished, modern, India.",
  "Need more destination feel. maybe hill retreat / backwater / coastal luxury stay etc.",
  "the card is for travel value. use target audience clues from affluent metro travellers.",
  "hotel arrival / concierge / pickup bay / lounge are all fine. keep variety though.",
  "not looking for generic corporate lobby. if business travel, make it travel-first.",
  "Need holiday travel mood for an air plus card. can skew aspirational.",
  "mix of vacations + short-haul business travel. audience is young rich professionals.",
  "premium airport hotel / sea-facing resort / scenic driveway all acceptable.",
  "Travel rewards ad, but persona should feel like a real Indian person not model stock.",
  "Use a TG that actually uses cards for flights and stays. metro, upper-income.",
  "Need family holiday undertone maybe, but still premium and not kiddish.",
  "can this feel like someone who does boutique stays and frequent airport runs?",
  "urban India, premium travel, card should feel aspirational but not fake luxury.",
  "Need scenic places in the mix. waterfront, hillside, destination hotel vibe.",
  "travel category only. dont make it an office ad even if audience is professionals.",
  "for people who do both conferences and long weekends. subtle luxury.",
  "Want one of those polished hotel-district, pickup, and getaway worlds. vary it.",
  "air plus, premium traveler, mostly metro cities, some destination escapes.",
  "Make it usable for reels. backstory should still be contextual to travel life.",
  "Need a premium holiday + frequent flyer crossover kind of person.",
  "Travel audience, affluent, maybe founder / lawyer / consultant / creative director types.",
  "should work for short-form performance, but backstory can be scenic and editorial.",
  "Need richer leisure settings too. resort arrival, promenade, retreat, etc.",
  "people booking unbox stays and flights. polished indian persona.",
  "for aspirational travel spenders in metros. clean wardrobe, premium movement, believable.",
  "less airport perimeter, more destination and luxury transfer moments if possible.",
  "audience is upper-income urban India who takes curated holidays and work trips.",
  "Need someone who looks like they travel smart, not flashy influencer style.",
  "travel card world, maybe premium coastal or mountain getaway also fair game.",
  "final one: messy brief lol - air plus, rich travel people, holiday/business both, scenic pls no boring lobby"
];

const backstorySchema = z.object({
  persona_name: z.coerce.string().min(1),
  age_range: z.coerce.string().min(1),
  city: z.coerce.string().min(1),
  profession: z.coerce.string().min(1),
  why_they_care: z.coerce.string().min(1),
  speaking_style: z.array(z.coerce.string()).length(3),
  wardrobe_props: z.array(z.coerce.string()).length(2),
  setting: z.coerce.string().min(1),
  compliance_notes: z.array(z.coerce.string()).length(2)
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function hasErrorCode(error, expectedCode) {
  let current = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (!current || typeof current !== "object") {
      return false;
    }
    const code = current.code;
    if (typeof code === "string" && code.toLowerCase() === expectedCode.toLowerCase()) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

function isRetryableGenAiError(error) {
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
    message.includes("headers timeout") ||
    message.includes("fetch failed") ||
    message.includes("socket hang up") ||
    message.includes("timed out") ||
    hasErrorCode(error, "UND_ERR_HEADERS_TIMEOUT") ||
    hasErrorCode(error, "ETIMEDOUT") ||
    hasErrorCode(error, "ECONNRESET")
  );
}

async function withGenAiRetry(operationName, run) {
  let lastError;
  for (let attempt = 1; attempt <= GENAI_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!isRetryableGenAiError(error) || attempt === GENAI_MAX_ATTEMPTS) {
        break;
      }
      const jitter = Math.floor(Math.random() * 500);
      await sleep(GENAI_RETRY_BASE_MS * 2 ** (attempt - 1) + jitter);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${operationName} failed: ${String(lastError)}`);
}

function getLogicModelCandidates() {
  const primary = (process.env.GEMINI_LOGIC_MODEL || DEFAULT_TEXT_MODEL).trim();
  const envFallbacks = (process.env.GEMINI_LOGIC_FALLBACK_MODELS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const configuredFallbacks = envFallbacks.length > 0 ? envFallbacks : [...DEFAULT_LOGIC_FALLBACK_MODELS];
  return Array.from(new Set([primary, ...configuredFallbacks].filter(Boolean)));
}

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: GENAI_HTTP_TIMEOUT_MS }
  });
}

function responseText(response) {
  if (!response || typeof response !== "object") {
    return "";
  }
  const value = response.text;
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "function") {
    const result = value();
    return typeof result === "string" ? result : "";
  }
  return "";
}

async function generateLogicContent(ai, operationName, contents, temperature) {
  const models = getLogicModelCandidates();
  let lastError;
  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    try {
      return {
        model,
        response: await withGenAiRetry(`${operationName}:${model}`, () =>
          ai.models.generateContent({
            model,
            contents,
            config: {
              responseMimeType: "application/json",
              temperature
            }
          })
        )
      };
    } catch (error) {
      lastError = error;
      const hasFallback = index < models.length - 1;
      if (!hasFallback || !isRetryableGenAiError(error)) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${operationName} failed for all logic models.`);
}

function compactPromptContext(value, maxLength) {
  if (!value) {
    return "";
  }
  const compact = String(value).replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function parseJsonObject(raw) {
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

function toStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/\n|[•;|]/g)
      .map((item) => item.replace(/^-+\s*/, "").trim())
      .filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((item) => toStringArray(item)).filter(Boolean);
  }
  return [];
}

function normalizeFixedList(value, expectedLength, fallbackItem) {
  const items = toStringArray(value).slice(0, expectedLength);
  while (items.length < expectedLength) {
    items.push(fallbackItem);
  }
  return items;
}

function normalizeBackstoryShape(raw) {
  if (!raw || typeof raw !== "object") {
    return raw;
  }
  const record = { ...raw };
  record.speaking_style = normalizeFixedList(record.speaking_style, 3, "Direct, clear, urgency-led delivery.");
  record.wardrobe_props = normalizeFixedList(record.wardrobe_props, 2, WARDROBE_CLEAN_FALLBACK);
  record.compliance_notes = normalizeFixedList(record.compliance_notes, 2, "Follow product constraints and avoid exaggerated claims.");
  return record;
}

function normalizeComparableText(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countNormalizedValues(values) {
  const counts = new Map();
  for (const value of values) {
    const normalized = normalizeComparableText(value);
    if (!normalized) {
      continue;
    }
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  return counts;
}

function isRepeatedInRecentWindow(candidate, recentValues, windowSize = BACKSTORY_RECENT_WINDOW) {
  const normalizedCandidate = normalizeComparableText(candidate);
  if (!normalizedCandidate) {
    return false;
  }
  const recentWindow = recentValues.slice(0, Math.max(0, windowSize));
  if (recentWindow.some((value) => normalizeComparableText(value) === normalizedCandidate)) {
    return true;
  }
  const totalMatches = recentValues.reduce(
    (count, value) => (normalizeComparableText(value) === normalizedCandidate ? count + 1 : count),
    0
  );
  return totalMatches >= 2;
}

function pickLeastUsedOption(options, recentValues) {
  if (options.length === 0) {
    return "";
  }
  const counts = countNormalizedValues(recentValues);
  return options
    .map((option) => ({
      option,
      count: counts.get(normalizeComparableText(option)) || 0,
      tieBreak: Math.random()
    }))
    .sort((left, right) => left.count - right.count || left.tieBreak - right.tieBreak)[0].option;
}

function pickDistinctPersonaName(recentNames) {
  const recent = new Set(recentNames.map((value) => normalizeComparableText(value)));
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const first = PERSONA_FIRST_NAMES[Math.floor(Math.random() * PERSONA_FIRST_NAMES.length)] || "Aarav";
    const last = PERSONA_LAST_NAMES[Math.floor(Math.random() * PERSONA_LAST_NAMES.length)] || "Sharma";
    const candidate = `${first} ${last}`;
    if (!recent.has(normalizeComparableText(candidate))) {
      return candidate;
    }
  }
  return `${PERSONA_FIRST_NAMES[0]} ${PERSONA_LAST_NAMES[0]}`;
}

function normalizeSettingText(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSetting(value) {
  return normalizeSettingText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !SETTING_STOPWORDS.has(token));
}

function settingSimilarityScore(left, right) {
  const leftTokens = new Set(tokenizeSetting(left));
  const rightTokens = new Set(tokenizeSetting(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }
  const union = leftTokens.size + rightTokens.size - overlap;
  return union > 0 ? overlap / union : 0;
}

function countMatchingSettings(pattern, values) {
  return values.reduce((count, value) => (pattern.test(value) ? count + 1 : count), 0);
}

function isOverusedSettingMotif(candidate, recentSettings) {
  if (!AIRPORT_CURBSIDE_PATTERN.test(candidate)) {
    return false;
  }
  return countMatchingSettings(AIRPORT_CURBSIDE_PATTERN, recentSettings) >= 1;
}

function isSettingRepeated(candidate, recentSettings) {
  if (!candidate || recentSettings.length === 0) {
    return false;
  }
  const normalizedCandidate = normalizeSettingText(candidate);
  if (!normalizedCandidate) {
    return false;
  }
  return (
    recentSettings.some((setting) => {
      const normalizedRecent = normalizeSettingText(setting);
      return (
        normalizedRecent === normalizedCandidate ||
        settingSimilarityScore(normalizedRecent, normalizedCandidate) >= SETTING_SIMILARITY_THRESHOLD
      );
    }) || isOverusedSettingMotif(candidate, recentSettings)
  );
}

function pickVariedSetting(values, recentSettings) {
  if (values.length === 0) {
    return "";
  }
  const pool = values.filter((value) => !isSettingRepeated(value, recentSettings));
  const options = pool.length > 0 ? pool : values;
  return options[Math.floor(Math.random() * options.length)] || values[0] || "";
}

function stableHash(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function appendUnique(target, values) {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function prioritizeSettings(base, preferred) {
  return Array.from(new Set([...preferred, ...base]));
}

function deriveBackstoryBriefHints(script, brief) {
  const source = `${script} ${brief || ""}`.toLowerCase();
  const audienceCues = [];
  const settingCues = [];
  const preferredIndoorSettings = [];
  const preferredOutdoorSettings = [];

  const hasBusinessTravelCue =
    /\b(business|corporate|client|meeting|conference|consultant|founder|boardroom|work trip|sales leader|executive|frequent flyer)\b/.test(
      source
    );
  const hasLeisureTravelCue =
    /\b(vacation|holiday|getaway|weekend trip|escape|resort|beach|staycation|leisure|couple|family|coastal|waterfront|scenic|mountain|hillside|retreat|seaside|beachfront)\b/.test(
      source
    );
  const explicitAirportMoment = /\b(airport|flight|boarding|departure|terminal|check[-\s]?in|boarding gate|aero[-\s]?bridge)\b/.test(source);
  const allowHomeContext = /\b(home|at home|house|apartment|kitchen|balcony|entryway)\b/.test(source);

  if (/\b(affluent|premium|luxury|upscale|hni|high net worth)\b/.test(source)) {
    audienceCues.push("affluent premium Indian audience");
  }
  if (/\b(metro|metro cities|urban|tier[-\s]?1|top cities)\b/.test(source)) {
    audienceCues.push("metro-city audience");
  }
  if (hasBusinessTravelCue) {
    audienceCues.push("frequent business-travel audience");
  }
  if (hasLeisureTravelCue) {
    audienceCues.push("premium leisure-travel audience");
  }

  if (/\b(hotel|concierge|lobby|check[-\s]?out|check[-\s]?in|valet|foyer|reception)\b/.test(source)) {
    settingCues.push("premium hotel arrival or concierge setting");
    appendUnique(preferredIndoorSettings, [
      "Private lounge check-in foyer with polished luggage and warm premium travel styling",
      "Concierge alcove beside luggage carts in a refined boutique hotel lobby",
      "Premium hotel concierge zone with departure preparation context",
      "Travel-day hotel lobby near checkout with packed luggage context"
    ]);
    appendUnique(preferredOutdoorSettings, [
      "Premium hotel porte-cochere with arriving cabs and polished luggage flow",
      "Luxury hotel valet canopy during a clean departure handoff with carry-on context",
      "Destination hotel forecourt with premium arrival or departure energy"
    ]);
  }
  if (/\b(lounge|club lounge|boarding gate|aero[-\s]?bridge)\b/.test(source)) {
    settingCues.push("premium lounge-adjacent setting");
    appendUnique(preferredIndoorSettings, [
      "Airline lounge reception threshold with a travel-ready pause before boarding",
      "Executive club lounge with boarding-time calm and a neatly placed carry-on nearby",
      "Lounge-adjacent seating corner with natural travel-day downtime"
    ]);
  }
  if (explicitAirportMoment) {
    settingCues.push("airport departure or boarding moment");
    appendUnique(preferredOutdoorSettings, [
      "Airport express drop-off lane with premium check-in energy and rolling suitcase motion",
      "Terminal parking-to-departures skybridge with premium commuter flow and rolling luggage",
      "Terminal approach walkway with rolling luggage and commuter movement"
    ]);
    appendUnique(preferredIndoorSettings, [
      "Terminal check-in queuing area with luggage prep moment",
      "Premium transit gallery with glass, stone, and warm ambient departure lighting",
      "Transit hub interior walkway with realistic departure energy"
    ]);
  }
  if (/\b(cab|taxi|chauffeur|pickup|drop[-\s]?off|transfer|forecourt|curbside|driveway)\b/.test(source)) {
    settingCues.push("premium transfer or pickup setting");
    appendUnique(preferredOutdoorSettings, [
      "Chauffeur pickup bay outside a business hotel with refined carry-on travel context",
      "Private transfer bay outside a luxury stay with subtle concierge activity and luggage flow",
      "Business district pickup point with carry-on luggage context"
    ]);
    appendUnique(preferredIndoorSettings, ["Chauffeur waiting salon inside a hotel arrival hall with muted premium transfer cues"]);
  }
  if (hasLeisureTravelCue) {
    settingCues.push("getaway or leisure-travel setting");
    appendUnique(preferredOutdoorSettings, [
      "Destination-side promenade with warm getaway energy and refined luggage styling",
      "City promenade near a hotel district with polished travel styling",
      "Waterfront promenade outside a luxury stay with scenic getaway energy and refined luggage styling",
      "Coastal resort arrival path with sea-breeze travel styling and premium luggage context",
      "Hillside luxury stay driveway with panoramic getaway movement and polished carry-on cues"
    ]);
    appendUnique(preferredIndoorSettings, [
      "Boutique stay lobby with relaxed getaway mood and premium travel cues",
      "Contemporary hotel lounge with affluent Indian travel lifestyle cues",
      "Sea-facing resort reception lounge with warm daylight and departure-ready luggage",
      "Hillside retreat lounge with panoramic windows and quiet getaway travel calm"
    ]);
  }
  if (hasBusinessTravelCue) {
    appendUnique(preferredOutdoorSettings, ["Corporate district drop-off zone before a business trip with polished carry-on luggage"]);
    appendUnique(preferredIndoorSettings, [
      "Executive hotel lounge before a meeting-day departure with refined business-travel cues",
      "Corporate mobility lounge with business-travel departure cues"
    ]);
  }

  let locationTypeBias;
  const outdoorBiasCount = [
    /\b(valet|porte[-\s]?cochere|curbside|pickup|drop[-\s]?off|transfer|approach|drive|forecourt|promenade|skybridge|coastal|waterfront|beach|hillside|scenic|retreat|boardwalk)\b/.test(source),
    /\b(outdoor|outside|street|roadside)\b/.test(source)
  ].filter(Boolean).length;
  const indoorBiasCount = [
    /\b(lounge|lobby|concierge|foyer|reception|corridor|hall|gallery|check[-\s]?in|check[-\s]?out)\b/.test(source),
    /\b(indoor|inside|interior)\b/.test(source)
  ].filter(Boolean).length;
  if (outdoorBiasCount > indoorBiasCount) {
    locationTypeBias = "outdoor";
  } else if (indoorBiasCount > outdoorBiasCount) {
    locationTypeBias = "indoor";
  }

  return {
    audienceCues,
    settingCues,
    preferredIndoorSettings,
    preferredOutdoorSettings,
    locationTypeBias,
    hasBusinessTravelCue,
    hasLeisureTravelCue,
    explicitAirportMoment,
    allowHomeContext
  };
}

function deriveSceneLocationPolicy(script, brief) {
  const hints = deriveBackstoryBriefHints(script, brief);
  const value = `${script} ${brief || ""}`.toLowerCase();
  const hasBusinessTravelCue = hints.hasBusinessTravelCue;
  const hasLeisureTravelCue = hints.hasLeisureTravelCue;

  if (/\b(travel|trip|flight|airport|boarding|journey|lounge)\b/.test(value)) {
    const explicitAirportMoment = hints.explicitAirportMoment;
    const locationType = explicitAirportMoment ? "outdoor" : hints.locationTypeBias || (stableHash(value) % 2 === 0 ? "outdoor" : "indoor");
    let outdoorSettings = [
      "Coastal resort arrival path with sea-breeze travel styling and premium luggage context",
      "Waterfront promenade outside a luxury stay with scenic getaway energy and refined luggage styling",
      "Hillside luxury stay driveway with panoramic getaway movement and polished carry-on cues",
      "Premium hotel porte-cochere with arriving cabs, polished luggage flow, and quiet travel-day urgency",
      "Luxury hotel valet canopy during a seamless departure handoff with carry-on movement",
      "Airport express drop-off lane with premium check-in energy and rolling suitcase motion",
      "Chauffeur pickup bay outside a business hotel with refined carry-on travel context",
      "Airport hotel arrival court with shuttle drop-off and premium trip-day movement",
      "Private transfer bay outside a luxury stay with subtle concierge activity and luggage flow",
      "Hotel-district arcade walkway with polished travel styling and discreet baggage movement",
      "Terminal parking-to-departures skybridge with premium commuter flow and rolling luggage",
      "Terminal approach walkway with rolling luggage and commuter movement",
      "Business district pickup point with carry-on luggage context",
      "Destination hotel arrival drive with premium travel-day movement",
      "Transit connector lane with cab arrivals and departure-ready baggage",
      "Intercity mobility hub forecourt with natural pre-journey urgency",
      "Airport perimeter pedestrian zone with travel-day flow",
      "City promenade near a hotel district with polished travel styling"
    ];
    let indoorSettings = [
      "Sea-facing resort reception lounge with warm daylight and departure-ready luggage",
      "Hillside retreat lounge with panoramic windows and quiet getaway travel calm",
      "Private lounge check-in foyer with polished luggage, warm brass details, and calm travel energy",
      "Airline lounge reception threshold with a travel-ready pause before boarding",
      "Premium airport hotel corridor near an elevator bank with departure-ready styling",
      "Concierge alcove beside luggage carts in a refined boutique hotel lobby",
      "Executive club lounge with boarding-time calm and a neatly placed carry-on nearby",
      "Chauffeur waiting salon inside a hotel arrival hall with muted premium transfer cues",
      "Premium transit gallery with glass, stone, and warm ambient departure lighting",
      "Boutique hotel library lounge with packed carry-on and early-morning departure mood",
      "Business hotel lobby with checkout-ready luggage and polished metro styling",
      "Travel-day hotel lobby near checkout with packed luggage context",
      "Premium hotel concierge zone with departure preparation context",
      "Lounge-adjacent seating corner with natural travel-day downtime",
      "Terminal check-in queuing area with luggage prep moment",
      "Transit hub interior walkway with realistic departure energy",
      "Corporate mobility lounge with business-travel departure cues"
    ];
    if (!explicitAirportMoment) {
      outdoorSettings.unshift(
        "Boutique hotel forecourt with luggage-ready arrival or departure energy",
        "Urban luxury stay entrance with subtle travel-day movement",
        "Scenic luxury stay terrace with relaxed getaway departure mood and refined luggage styling"
      );
      indoorSettings.unshift(
        "Premium cafe inside a hotel district with travel-ready styling",
        "Contemporary hotel lounge with affluent Indian travel lifestyle cues",
        "Boutique resort lobby with relaxed getaway mood and premium travel cues"
      );
    }
    if (hasBusinessTravelCue) {
      outdoorSettings.unshift("Corporate district drop-off zone before a business trip with polished carry-on luggage");
      indoorSettings.unshift("Executive hotel lounge before a meeting-day departure with refined business-travel cues");
    }
    if (hasLeisureTravelCue) {
      outdoorSettings.unshift("Destination-side promenade with warm getaway energy and refined luggage styling");
      indoorSettings.unshift("Boutique stay lobby with relaxed getaway mood and premium travel cues");
    }
    outdoorSettings = prioritizeSettings(outdoorSettings, hints.preferredOutdoorSettings);
    indoorSettings = prioritizeSettings(indoorSettings, hints.preferredIndoorSettings);
    return {
      locationType,
      settings: locationType === "outdoor" ? outdoorSettings : indoorSettings,
      allowHomeContext: hints.allowHomeContext
    };
  }

  const locationType = hints.locationTypeBias || (stableHash(value || "kotak_air_plus") % 2 === 0 ? "indoor" : "outdoor");
  let indoorSettings = [
    "Sea-facing resort reception lounge with warm daylight and departure-ready luggage",
    "Hillside retreat lounge with panoramic windows and quiet getaway travel calm",
    "Private lounge check-in foyer with polished luggage and warm premium travel styling",
    "Airline lounge reception threshold with subtle boarding-time calm",
    "Premium airport hotel corridor near an elevator bank with departure-ready cues",
    "Concierge alcove beside luggage carts in a refined boutique hotel lobby",
    "Executive club lounge with a neatly placed carry-on and muted travel energy",
    "Chauffeur waiting salon inside a hotel arrival hall with premium transfer cues",
    "Business hotel lobby with checkout-ready luggage and polished metro styling",
    "Premium hotel concierge zone with departure preparation context",
    "Contemporary hotel lounge with affluent travel lifestyle cues",
    "Lounge-adjacent seating corner with premium pre-trip downtime",
    "High-end serviced apartment lobby with travel-day movement"
  ];
  let outdoorSettings = [
    "Coastal resort arrival path with sea-breeze travel styling and premium luggage context",
    "Waterfront promenade outside a luxury stay with scenic getaway energy and refined luggage styling",
    "Hillside luxury stay driveway with panoramic getaway movement and polished carry-on cues",
    "Premium hotel porte-cochere with arriving cabs and polished luggage flow",
    "Luxury hotel valet canopy during a clean departure handoff with carry-on context",
    "Airport express drop-off lane with refined travel-day movement",
    "Chauffeur pickup bay outside a business hotel with discreet premium transfer energy",
    "Airport hotel arrival court with shuttle drop-off and elevated travel styling",
    "Private transfer bay outside a luxury stay with concierge-side movement",
    "Business district curbside pickup with carry-on luggage context",
    "Destination hotel forecourt with premium arrival or departure energy",
    "Urban luxury stay entrance with subtle travel-day movement",
    "City promenade near a hotel district with polished travel styling",
    "Airport approach zone with natural movement in background",
    "Travel-day street-side pickup point with trip context"
  ];

  outdoorSettings = prioritizeSettings(outdoorSettings, hints.preferredOutdoorSettings);
  indoorSettings = prioritizeSettings(indoorSettings, hints.preferredIndoorSettings);
  return {
    locationType,
    settings: locationType === "indoor" ? indoorSettings : outdoorSettings,
    allowHomeContext: hints.allowHomeContext
  };
}

function resolveBackstorySetting(input, script, fallbackSetting, recentSettings, brief) {
  const locationPolicy = deriveSceneLocationPolicy(script, brief);
  const candidate = String(input.setting || "").replace(/\s+/g, " ").trim();
  const scriptValue = `${script} ${brief || ""}`.toLowerCase();
  const unrequestedTerminalSpecificity =
    AIRPORT_CURBSIDE_PATTERN.test(candidate) &&
    TERMINAL_CODE_PATTERN.test(candidate) &&
    !TERMINAL_CODE_PATTERN.test(scriptValue);

  if (!candidate || DEVICE_PATTERN.test(candidate) || unrequestedTerminalSpecificity || AIR_PLUS_DISALLOWED_SETTING_PATTERN.test(candidate)) {
    return fallbackSetting;
  }

  const isGenericHome = GENERIC_HOME_PATTERN.test(candidate);
  const isIndoorBias = INDOOR_BIAS_SETTING_PATTERN.test(candidate);
  const needsOutdoor = locationPolicy.locationType === "outdoor";

  if (isSettingRepeated(candidate, recentSettings)) {
    return fallbackSetting;
  }
  if ((!locationPolicy.allowHomeContext && isGenericHome) || (needsOutdoor && isIndoorBias)) {
    return fallbackSetting;
  }
  return candidate;
}

function scrubBackstory(backstory, script, recentSignals, brief) {
  const safeWardrobe = [];
  for (const item of backstory.wardrobe_props) {
    if (DEVICE_PATTERN.test(item)) {
      continue;
    }
    const normalized = item.replace(/\s+/g, " ").trim();
    const sanitizedCue =
      !normalized || SWEAT_SPOT_PATTERN.test(normalized) || WRINKLED_CLOTHES_PATTERN.test(normalized)
        ? WARDROBE_CLEAN_FALLBACK
        : normalized;
    if (!safeWardrobe.some((existing) => normalizeComparableText(existing) === normalizeComparableText(sanitizedCue))) {
      safeWardrobe.push(sanitizedCue);
    }
  }
  while (safeWardrobe.length < 2) {
    safeWardrobe.push(WARDROBE_CLEAN_FALLBACK);
  }
  const fallbackSetting = pickVariedSetting(deriveSceneLocationPolicy(script, brief).settings, recentSignals.settings);
  const safeSetting = resolveBackstorySetting(backstory, script, fallbackSetting, recentSignals.settings, brief);

  const personaName = String(backstory.persona_name || "").replace(/\s+/g, " ").trim();
  const city = String(backstory.city || "").replace(/\s+/g, " ").trim();
  const profession = String(backstory.profession || "").replace(/\s+/g, " ").trim();

  return {
    ...backstory,
    persona_name:
      !personaName || isRepeatedInRecentWindow(personaName, recentSignals.names)
        ? pickDistinctPersonaName(recentSignals.names)
        : personaName,
    city:
      !city || isRepeatedInRecentWindow(city, recentSignals.cities)
        ? pickLeastUsedOption(AIR_PLUS_CITY_POOL, recentSignals.cities)
        : city,
    profession:
      !profession || isRepeatedInRecentWindow(profession, recentSignals.professions)
        ? pickLeastUsedOption(AIR_PLUS_PROFESSION_POOL, recentSignals.professions)
        : profession,
    wardrobe_props: safeWardrobe.slice(0, 2),
    setting: safeSetting
  };
}

function getBackstoryPrompt(script, brief, recentSignals) {
  const compactBrief = compactPromptContext(brief, 420);
  const briefHints = deriveBackstoryBriefHints(script, brief);
  const preferredAnchors = Array.from(new Set([...briefHints.preferredOutdoorSettings, ...briefHints.preferredIndoorSettings])).slice(0, 8);
  return [
    "You are a Senior Casting Director and a Professional Cinematographer.",
    "Your goal is to create a Real Person character profile that looks like a character from ad films.",
    "The country is always in reference to India.",
    "Input: [Brand Name] and [Basic Concept].",
    "Brand Name: Kotak Mahindra Bank - Kotak Air Plus",
    `Basic Concept: ${script}`,
    "Category Context: Travel and transit-focused credit card category.",
    compactBrief ? `Campaign brief context: ${compactBrief}` : "",
    "Your Task: Create a character profile with the following sections:",
    "1. The Human Profile",
    "- Identity: Name, Age (specific, e.g., 43), and their Daily Grind (what they actually do for a living).",
    "- The Why: Their deep motivation for using the brand.",
    "2. The Non-Generic Visual Directive",
    "- Skin & Texture: Describe skin in detail and avoid perfect skin.",
    "- Wardrobe Texture: Costume relevant to what is in fashion for this character and TG.",
    "- Wardrobe Hygiene: Always clean, well-ironed, wrinkle-free clothing. No sweat spots, damp patches, or perspiration marks.",
    "3. The Cinematic Technical Prompt (Optimized for high-fidelity image generation)",
    "- Composition: specify camera lens and shot type.",
    "- Lighting: avoid studio lights and use lived-in lighting.",
    "- Film Stock/Quality: include raw cinematic photography, natural skin tones, fine grain, and subtle motion blur.",
    "- Tone: authentic and grounded. Absolutely no marketing-perfect imagery.",
    "4. Setting",
    "- The setting of the character must be contextual to the script, brand, and category.",
    "- Use target-audience cues from the campaign brief to shape profession, city, wardrobe, and speaking style whenever they are present.",
    "- If the campaign brief or script references a setting family, travel moment, or environment, prioritize that over generic defaults.",
    briefHints.audienceCues.length > 0 ? `- Brief-derived audience cues: ${briefHints.audienceCues.join(" | ")}` : "",
    briefHints.settingCues.length > 0 ? `- Brief-derived setting cues: ${briefHints.settingCues.join(" | ")}` : "",
    preferredAnchors.length > 0 ? `- Preferred setting anchors from script + brief: ${preferredAnchors.join(" | ")}` : "",
    "Air Plus setting guardrail: do not place the persona in railway stations, train platforms, metro transfers, bus terminals, generic corridors, or generic office/showroom lobbies. Keep the setting anchored in premium travel-day worlds like hotel arrival, airport-adjacent movement, concierge zones, lounge-adjacent travel spaces, polished transfer moments, or scenic getaway travel contexts such as resort arrivals, waterfront promenades, and hillside retreats.",
    "Output format requirement:",
    "Return STRICT JSON only with keys: persona_name, age_range, city, profession, why_they_care, speaking_style, wardrobe_props, setting, compliance_notes",
    "Field mapping:",
    "- persona_name: Identity name.",
    '- age_range: one specific age as a string number (example: "43").',
    "- city: Indian city that naturally fits the persona and concept.",
    "- profession: Daily Grind in one concise line.",
    "- why_they_care: deep motivation for using the brand.",
    "- speaking_style: exactly 3 strings that define voice texture, pitch, and tone.",
    "- wardrobe_props: exactly 2 strings describing wardrobe texture and styling cues. Must be well-ironed, wrinkle-free, and without sweat spot references.",
    "- setting: one specific, cinematic, contextual setting sentence.",
    "- compliance_notes: exactly 2 strings. First: cinematic technical direction (lens, shot, lighting, film quality). Second: authenticity guardrail (non-generic, grounded, non-marketing-perfect).",
    recentSignals.settings.length > 0
      ? `- avoid repeating these recent settings or close variants: ${recentSignals.settings.slice(0, 10).join(" | ")}`
      : "",
    recentSignals.names.length > 0
      ? `- avoid reusing these recent persona names: ${recentSignals.names.slice(0, 10).join(" | ")}`
      : "",
    recentSignals.cities.length > 0
      ? `- avoid overusing these recent cities: ${recentSignals.cities.slice(0, 10).join(" | ")}`
      : "",
    recentSignals.professions.length > 0
      ? `- avoid repeating these recent professions: ${recentSignals.professions.slice(0, 10).join(" | ")}`
      : "",
    "Product Key: kotak_air_plus"
  ]
    .filter(Boolean)
    .join("\n\n");
}

function categorizeSetting(setting) {
  const value = setting.toLowerCase();
  if (/\b(getaway|destination-side|resort|vacation|holiday|coastal|waterfront|scenic|hillside|retreat|beachfront|backwater|sea-facing|panoramic|mountain|open-air reception lounge|promenade)\b/.test(value)) {
    return "leisure_getaway";
  }
  if (/\b(hotel|concierge|lobby|lounge|stay)\b/.test(value) && /\b(forecourt|entrance|arrival|drive|pickup|departure)\b/.test(value)) {
    return "hotel_arrival";
  }
  if (/\b(hotel|concierge|lobby|lounge|stay|cafe inside a hotel district)\b/.test(value)) {
    return "hotel_interior";
  }
  if (/\b(airport|terminal|check-in|departure|arrivals|perimeter|boarding)\b/.test(value)) {
    return "airport_transit";
  }
  if (/\b(curbside|pickup|connector|cab|district|street-side|mobility hub)\b/.test(value)) {
    return "city_transfer";
  }
  return "other_travel";
}

function buildMarkdown(report) {
  const lines = [
    "# Air Plus Backstory Dry Run",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Brief mode: ${report.briefMode}`,
    `- Iterations: ${report.summary.total}`,
    `- Unique exact settings: ${report.summary.uniqueExactSettings}`,
    `- Unique categories: ${report.summary.uniqueCategories}`,
    `- Consecutive exact repeats: ${report.summary.consecutiveExactRepeats}`,
    `- Consecutive near repeats: ${report.summary.consecutiveNearRepeats}`,
    "",
    "## Category Trend",
    ""
  ];

  for (const [category, count] of Object.entries(report.summary.categoryCounts)) {
    lines.push(`- ${category}: ${count}`);
  }

  lines.push("", "## Per Iteration", "", "| # | Brief | Model | Persona | City | Profession | Setting Category | Setting |", "| --- | --- | --- | --- | --- | --- | --- | --- |");

  for (const item of report.results) {
    lines.push(
      `| ${item.iteration} | ${String(item.brief || "").replace(/\|/g, "\\|")} | ${item.modelUsed} | ${item.persona_name.replace(/\|/g, "\\|")} | ${item.city.replace(/\|/g, "\\|")} | ${item.profession.replace(/\|/g, "\\|")} | ${item.settingCategory} | ${item.setting.replace(/\|/g, "\\|")} |`
    );
  }

  return lines.join("\n");
}

async function run() {
  const ai = getClient();
  const recentSignals = { names: [], cities: [], professions: [], settings: [] };
  const script =
    process.env.BACKSTORY_DRY_RUN_SCRIPT ||
    "Earn more from travel with Kotak Air Plus, with five percent rewards via Unbox bookings. Apply Now.";
  const briefMode = (process.env.BACKSTORY_DRY_RUN_BRIEF_MODE || "").trim().toLowerCase();
  const repeatedBrief =
    process.env.BACKSTORY_DRY_RUN_BRIEF ||
    "Need more ppl to apply for air plus. reels. hero point is travel rewards via unbox only.";
  const briefPool = briefMode === "mixed" ? MIXED_AIR_PLUS_BRIEF_POOL : [repeatedBrief];

  const results = [];

  for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
    const brief = briefPool[(iteration - 1) % briefPool.length];
    const prompt = getBackstoryPrompt(script, brief, recentSignals);
    const { model, response } = await generateLogicContent(ai, "backstory.dryrun", prompt, 0.6);
    const text = responseText(response).trim();
    const parsed = backstorySchema.parse(normalizeBackstoryShape(parseJsonObject(text)));
    const scrubbed = scrubBackstory(parsed, script, recentSignals, brief);
    const settingCategory = categorizeSetting(scrubbed.setting);

    results.push({
      iteration,
      modelUsed: model,
      brief,
      persona_name: scrubbed.persona_name,
      city: scrubbed.city,
      profession: scrubbed.profession,
      setting: scrubbed.setting,
      settingCategory
    });

    recentSignals.names.unshift(scrubbed.persona_name);
    recentSignals.cities.unshift(scrubbed.city);
    recentSignals.professions.unshift(scrubbed.profession);
    recentSignals.settings.unshift(scrubbed.setting);
  }

  const uniqueExactSettings = new Set(results.map((item) => normalizeSettingText(item.setting))).size;
  const uniqueCategories = new Set(results.map((item) => item.settingCategory)).size;
  let consecutiveExactRepeats = 0;
  let consecutiveNearRepeats = 0;
  for (let index = 1; index < results.length; index += 1) {
    const prev = results[index - 1].setting;
    const current = results[index].setting;
    if (normalizeSettingText(prev) === normalizeSettingText(current)) {
      consecutiveExactRepeats += 1;
    }
    if (settingSimilarityScore(prev, current) >= SETTING_SIMILARITY_THRESHOLD) {
      consecutiveNearRepeats += 1;
    }
  }

  const categoryCounts = {};
  for (const item of results) {
    categoryCounts[item.settingCategory] = (categoryCounts[item.settingCategory] || 0) + 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    script,
    briefMode: briefMode || "single",
    brief: repeatedBrief,
    summary: {
      total: results.length,
      uniqueExactSettings,
      uniqueCategories,
      consecutiveExactRepeats,
      consecutiveNearRepeats,
      categoryCounts
    },
    results
  };

  const outDir = path.join(process.cwd(), "generated", "backstory-tests");
  await fs.mkdir(outDir, { recursive: true });
  const stamp = Date.now();
  const jsonPath = path.join(outDir, `airplus-backstory-dryrun-${stamp}.json`);
  const mdPath = path.join(outDir, `airplus-backstory-dryrun-${stamp}.md`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(mdPath, buildMarkdown(report), "utf8");

  console.log(`REPORT_JSON=${jsonPath}`);
  console.log(`REPORT_MD=${mdPath}`);
  console.log(`SUMMARY total=${report.summary.total} uniqueExactSettings=${report.summary.uniqueExactSettings} consecutiveExactRepeats=${report.summary.consecutiveExactRepeats} consecutiveNearRepeats=${report.summary.consecutiveNearRepeats}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
