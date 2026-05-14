#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");

const EIGHT_SECOND_MIN_CHARACTERS = 90;
const EIGHT_SECOND_MAX_CHARACTERS = 100;
const CONCURRENCY = Number(process.env.SCRIPT_BATCH_CONCURRENCY || 2);
const SCRIPT_API_BASE = (process.env.SCRIPT_API_BASE || "http://127.0.0.1:3000").replace(/\/$/, "");
const SCRIPT_USE_ROUTE_IMPORT = /^(1|true|yes)$/i.test(process.env.SCRIPT_USE_ROUTE_IMPORT || "");

function selectedProductName(product) {
  return product === "kotak_air_plus" ? "Kotak Air Plus" : "Kotak Cashback+";
}

function hasForbiddenAlias(script) {
  return /\b(standard card|fuel card|travel card|cashback card|rewards card|miles card|air card)\b/i.test(script);
}

function hasInvalidProductMention(product, script) {
  const exactName = selectedProductName(product);
  const mentionsKotak = /\bkotak\b/i.test(script);
  if (!mentionsKotak) {
    return false;
  }
  return !script.toLowerCase().includes(exactName.toLowerCase());
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/₹/g, "inr")
    .replace(/rs\.?/g, "inr")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const RTB_TOPICS = {
  travel: ["five percent", "travel", "unbox", "rewards", "air plus"],
  join_fee: ["zero joining fee", "joining fee", "limited period"],
  flight: ["complimentary flight", "one and a half lakh", "flight"],
  essentials: ["essentials", "groceries", "milk", "five percent cashback"],
  entertainment: ["entertainment", "movies", "ott", "five percent cashback"],
  fuel: ["fuel", "four percent", "up to four percent", "drive"]
};

function hasAnyToken(script, tokens) {
  const normalized = normalize(script);
  return tokens.some((token) => normalized.includes(normalize(token)));
}

function allRtbTokens() {
  return Object.values(RTB_TOPICS).flat();
}

function buildCases() {
  const cases = [];

  function addGroup(prefix, product, videoType, durationSeconds, expectBase, briefs) {
    briefs.forEach((item, index) => {
      cases.push({
        id: `${prefix}_${String(index + 1).padStart(2, "0")}`,
        product,
        videoType,
        durationSeconds,
        brief: item.brief,
        expect: {
          ...expectBase,
          ...(item.expect || {})
        }
      });
    });
  }

  addGroup(
    "bofu_air",
    "kotak_air_plus",
    "point_to_camera_multi_scene",
    8,
    {
      objective: "conversion",
      funnelStage: "bofu",
      genre: "performance_ad",
      ctaStrength: "hard",
      rtbMode: "required_or_targeted",
      ctaRule: "must_apply_now"
    },
    [
      { brief: "meta performance push. focus only on complimentary flight after one and a half lakh quarterly spend. affluent metro traveller." , expect: { channel: "meta", rtbTopic: "flight", rtbMode: "brief_targeted" } },
      { brief: "Need more ppl to apply for air plus. reels. hero point is travel rewards via unbox only.", expect: { channel: "generic", placement: "reels", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "google perf bumper. zero joining fee only pls. premium flyer audience.", expect: { channel: "google", placement: "youtube", rtbTopic: "join_fee", rtbMode: "brief_targeted" } },
      { brief: "retargeting brief for metro flyers, push apps now, make the free flight after one and a half lakh feel worth it", expect: { rtbTopic: "flight", rtbMode: "brief_targeted" } },
      { brief: "conversion ad for ig stories. travel rewards should be the one message. keep it premium not fluffy.", expect: { channel: "meta", placement: "stories", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "need direct response copy. joining fee zero, limited period. city flyers, sharp.", expect: { rtbTopic: "join_fee", rtbMode: "brief_targeted" } },
      { brief: "more apps from affluent metro travel folks. performance marketing on meta. one strongest message only.", expect: { channel: "meta", rtbTopic: "travel", rtbMode: "default_strongest" } },
      { brief: "push applications, frequent biz travellers, youtube bumper, make unbox rewards obvious fast", expect: { channel: "google", placement: "youtube", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "perf ad. free flight should be hero. dont talk abt anything else. high intent traveller", expect: { rtbTopic: "flight", rtbMode: "brief_targeted" } },
      { brief: "Need apps from premium metro travellers. air plus. keep one line, direct, and useful.", expect: { rtbTopic: "travel", rtbMode: "default_strongest" } },
      { brief: "meta convrsion brief, travel spends via unbox reward should land in first sec", expect: { channel: "meta", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "performance on reels for people who travel a lot for work. make the offer obvious, not fancy.", expect: { placement: "reels", channel: "generic", rtbTopic: "travel", rtbMode: "default_strongest" } }
    ]
  );

  addGroup(
    "bofu_cash",
    "kotak_cashback",
    "point_to_camera_multi_scene",
    8,
    {
      objective: "conversion",
      funnelStage: "bofu",
      genre: "performance_ad",
      ctaStrength: "hard",
      rtbMode: "required_or_targeted",
      ctaRule: "must_apply_now"
    },
    [
      { brief: "meta performance brief. essentials cashback only. salaried metro crowd. direct response.", expect: { channel: "meta", rtbTopic: "essentials", rtbMode: "brief_targeted" } },
      { brief: "google performance, fuel savings is the only msg. practical commuters.", expect: { channel: "google", rtbTopic: "fuel", rtbMode: "brief_targeted" } },
      { brief: "Need more applies for cashback plus. groceries + milk = hero. reels placement.", expect: { placement: "reels", rtbTopic: "essentials", rtbMode: "brief_targeted" } },
      { brief: "entertainment cashback only pls. paid social. young salaried ppl in metros", expect: { channel: "social", rtbTopic: "entertainment", rtbMode: "brief_targeted" } },
      { brief: "zero joining fee should do the work. keep it practical, urgent and short.", expect: { rtbTopic: "join_fee", rtbMode: "brief_targeted" } },
      { brief: "performance marketing on meta. every day value for monthly spenders. one benefit only.", expect: { channel: "meta", rtbTopic: "essentials", rtbMode: "default_strongest" } },
      { brief: "push apps from commuters. fuel benefit should be super obvious. stories.", expect: { placement: "stories", rtbTopic: "fuel", rtbMode: "brief_targeted" } },
      { brief: "need response ad. practical salaried metro audience. make essentials feel like instant value", expect: { rtbTopic: "essentials", rtbMode: "default_strongest" } },
      { brief: "weekend plans + ott etc. five percent entertainment only. direct response.", expect: { rtbTopic: "entertainment", rtbMode: "brief_targeted" } },
      { brief: "more signups. cashback plus for daily spends. make it clicky but clear.", expect: { rtbTopic: "essentials", rtbMode: "default_strongest" } },
      { brief: "meta perf, fuel only, no fluff, city drivers", expect: { channel: "meta", rtbTopic: "fuel", rtbMode: "brief_targeted" } },
      { brief: "need apps now. everyday value card for metro households. one line only.", expect: { rtbTopic: "essentials", rtbMode: "default_strongest" } }
    ]
  );

  addGroup(
    "mofu_air",
    "kotak_air_plus",
    "features_half_half",
    15,
    {
      funnelStage: "mofu",
      ctaStrength: "medium",
      ctaRule: "must_not_apply_now",
      rtbMode: "optional_or_targeted"
    },
    [
      { brief: "consideration stage film. help frequent travellers understand why air plus is useful for planned travel spend. youtube", expect: { objective: "consideration", channel: "google", placement: "youtube", genre: "product_explainer" } },
      { brief: "educational explainer for social media. explain where travel rewards via unbox really help.", expect: { objective: "education", channel: "social", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "why choose air plus for work trips? make it clearer, not salesy.", expect: { objective: "consideration", genre: "product_explainer" } },
      { brief: "help ppl get the value prop. frequent flyers, premium tone, more explain less sell.", expect: { objective: "unknown", funnelStage: "bofu", allowAnyReason: false } },
      { brief: "educational video for reels, show how one and a half lakh milestone becomes rewarding", expect: { objective: "education", placement: "reels", rtbTopic: "flight", rtbMode: "brief_targeted" } },
      { brief: "consideration brief for urban flyers. joining fee zero if it fits, otherwise keep it utility-led", expect: { objective: "consideration", rtbTopic: "join_fee", rtbMode: "brief_targeted" } },
      { brief: "explainer: premium travel card for people doing short work trips often", expect: { objective: "education", genre: "product_explainer" } },
      { brief: "can you make this more like helping them understand the travel upside, not hard sell", expect: { objective: "unknown", funnelStage: "bofu", allowAnyReason: false } },
      { brief: "consideration / explainer for meta feed. where does unbox booking value show up?", expect: { objective: "consideration", channel: "meta", placement: "feed", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "educate affluent metro travelers on why this card is handy for booking trips", expect: { objective: "education", genre: "educational" } },
      { brief: "help users see why quarterly spend unlock matters. more clarity, less urgency.", expect: { objective: "unknown", funnelStage: "bofu", allowAnyReason: false } },
      { brief: "product explainer for youtube. premium traveller cohort. make the utility easy to get.", expect: { objective: "unknown", channel: "google", placement: "youtube", genre: "product_explainer", funnelStage: "mofu" } }
    ]
  );

  addGroup(
    "mofu_cash",
    "kotak_cashback",
    "features_half_half",
    15,
    {
      funnelStage: "mofu",
      ctaStrength: "medium",
      ctaRule: "must_not_apply_now",
      rtbMode: "optional_or_targeted"
    },
    [
      { brief: "educational explainer for social. show where cashback plus helps in essentials and monthly spend choices.", expect: { objective: "education", channel: "social", genre: "educational" } },
      { brief: "consideration stage video. why choose this for practical everyday spends?", expect: { objective: "consideration", genre: "product_explainer" } },
      { brief: "help people understand fuel savings benefit, dont hard sell.", expect: { objective: "unknown", funnelStage: "bofu", allowAnyReason: false } },
      { brief: "product explainer for youtube. where does five percent on essentials make a difference?", expect: { objective: "unknown", channel: "google", placement: "youtube", genre: "product_explainer", funnelStage: "mofu", rtbTopic: "essentials", rtbMode: "brief_targeted" } },
      { brief: "education led piece for early salary crowd. practical, monthly, utility first.", expect: { objective: "education", genre: "educational" } },
      { brief: "consideration ad for feed placement, entertainment cashback if it feels relevant", expect: { objective: "consideration", placement: "feed", rtbTopic: "entertainment", rtbMode: "brief_targeted" } },
      { brief: "explain this like everyday value, not a performance ad", expect: { objective: "unknown", funnelStage: "bofu", allowAnyReason: false } },
      { brief: "educational / useful / day-to-day spending. metro salaried audience. no big sell.", expect: { objective: "education", genre: "educational" } },
      { brief: "consideration stage. joining fee zero can be mentioned if it helps", expect: { objective: "consideration", rtbTopic: "join_fee", rtbMode: "brief_targeted" } },
      { brief: "make users get where the fuel savings fits into commute life", expect: { objective: "unknown", funnelStage: "bofu", allowAnyReason: false } },
      { brief: "product walkthrough for practical urban spenders, social media cut", expect: { objective: "unknown", channel: "social", genre: "product_explainer", funnelStage: "mofu" } },
      { brief: "help audience understand how essentials cashback can reduce monthly pressure", expect: { objective: "unknown", funnelStage: "bofu", allowAnyReason: false } }
    ]
  );

  addGroup(
    "tofu_air",
    "kotak_air_plus",
    "montage",
    15,
    {
      funnelStage: "tofu",
      ctaStrength: "soft",
      ctaRule: "soft_or_none",
      rtbMode: "optional_or_targeted",
      noHardSell: true
    },
    [
      { brief: "awareness brand spot for instagram reels. premium travel feel, recall first, no hard sell.", expect: { objective: "awareness", channel: "meta", placement: "reels", genre: "brand_spot" } },
      { brief: "brand film for shorts. affluent travel vibe, smooth modern mobility, dont push apply.", expect: { objective: "brand", channel: "shorts", placement: "shorts", genre: "brand_spot" } },
      { brief: "launch spot for social. make kotak air plus feel premium and seamless.", expect: { objective: "brand", channel: "social", genre: "brand_spot" } },
      { brief: "top funnel recall video. travel energy, upscale, not performancey.", expect: { objective: "unknown", funnelStage: "bofu", allowAnyReason: false } },
      { brief: "awareness piece for youtube. premium flyer lifestyle. no hard CTA pls.", expect: { objective: "awareness", channel: "google", placement: "youtube", genre: "brand_spot" } },
      { brief: "brand spot. trip-day mood. sophisticated, urban, warm. no product feature dump.", expect: { objective: "brand", genre: "brand_spot" } },
      { brief: "reels brand recall, polished travel tone, should feel aspirational not salesy", expect: { objective: "brand", channel: "meta", placement: "reels", genre: "brand_spot" } },
      { brief: "launch film for metro flyers. keep it premium and memorable.", expect: { objective: "brand", genre: "brand_spot" } },
      { brief: "upper funnel push. smooth travel value, premium signal, less direct response", expect: { objective: "unknown", funnelStage: "bofu", allowAnyReason: false } },
      { brief: "awareness video for instagram stories. affluent indian traveller, premium, modern", expect: { objective: "awareness", channel: "meta", placement: "stories", genre: "brand_spot" } },
      { brief: "brand recall piece, maybe mention travel rewards if it feels natural", expect: { objective: "brand", genre: "brand_spot", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "simple travel brand spot, no hard sell, just make it feel elevated", expect: { objective: "brand", genre: "brand_spot" } }
    ]
  );

  addGroup(
    "tofu_cash",
    "kotak_cashback",
    "montage",
    15,
    {
      funnelStage: "tofu",
      ctaStrength: "soft",
      ctaRule: "soft_or_none",
      rtbMode: "optional_or_targeted",
      noHardSell: true
    },
    [
      { brief: "awareness brand spot for reels. make cashback plus feel practical and trustworthy, not salesy.", expect: { objective: "awareness", channel: "meta", placement: "reels", genre: "brand_spot" } },
      { brief: "brand film for urban spenders. everyday life, simple value, easy trust.", expect: { objective: "brand", genre: "brand_spot" } },
      { brief: "launch spot for social media, relatable city life, no hard CTA.", expect: { objective: "brand", channel: "social", genre: "brand_spot" } },
      { brief: "top funnel recall for monthly spenders. warm, real, household utility vibe.", expect: { objective: "unknown", funnelStage: "bofu", allowAnyReason: false } },
      { brief: "awareness piece for youtube. practical not flashy. simple value for everyday spends.", expect: { objective: "awareness", channel: "google", placement: "youtube", genre: "brand_spot" } },
      { brief: "brand spot, early salary life, city errands, make it feel human", expect: { objective: "brand", genre: "brand_spot" } },
      { brief: "reels recall video. practical confidence. no pushy app now stuff", expect: { objective: "unknown", channel: "meta", placement: "reels", funnelStage: "bofu", allowAnyReason: false } },
      { brief: "launch film for city spenders. trustworthy and grounded.", expect: { objective: "brand", genre: "brand_spot" } },
      { brief: "upper funnel brand thing, maybe essentials cashback if natural, dont oversell", expect: { objective: "unknown", funnelStage: "bofu", allowAnyReason: false } },
      { brief: "awareness story cut for metro salaried crowd. warm utility tone.", expect: { objective: "awareness", placement: "stories", channel: "meta", genre: "brand_spot" } },
      { brief: "brand recall piece, maybe mention fuel benefit if it fits naturally", expect: { objective: "brand", genre: "brand_spot", rtbTopic: "fuel", rtbMode: "brief_targeted" } },
      { brief: "make cashback plus feel like smart everyday value, not a performance ad", expect: { objective: "unknown", funnelStage: "bofu", allowAnyReason: false } }
    ]
  );

  addGroup(
    "internal_air",
    "kotak_air_plus",
    "features_half_half",
    20,
    {
      objective: "internal",
      funnelStage: "internal",
      channel: "internal",
      placement: "internal",
      genre: "internal_update",
      ctaRule: "none_or_review",
      ctaStrength: "none",
      rtbMode: "bypass"
    },
    [
      { brief: "internal communication for employees. what is kotak air plus about in simple words?", expect: {} },
      { brief: "employee enablement note. explain the card in a useful, plain language way.", expect: {} },
      { brief: "internal rollout update for sales teams. keep it simple, no hard sell.", expect: {} },
      { brief: "townhall support video, leadership wants clarity on what air plus stands for.", expect: {} },
      { brief: "internal comms: make travel use case easy for teams to remember", expect: {} },
      { brief: "enablement piece for relationship managers. mention travel rewards if it fits naturally.", expect: { rtbMode: "optional_or_targeted", rtbTopic: "travel" } },
      { brief: "employee explainer. zero joining fee can be included if useful, not compulsory.", expect: { rtbMode: "optional_or_targeted", rtbTopic: "join_fee" } },
      { brief: "internal team update, complimentary flight threshold can be touched on if helpful.", expect: { rtbMode: "optional_or_targeted", rtbTopic: "flight" } },
      { brief: "sales kickoff support line, explain air plus fast. action required later via deck review.", expect: { ctaStrength: "medium", ctaRule: "none_or_review" } },
      { brief: "internal communications video for product training. keep it factual and useful.", expect: {} }
    ]
  );

  addGroup(
    "internal_cash",
    "kotak_cashback",
    "features_half_half",
    20,
    {
      objective: "internal",
      funnelStage: "internal",
      channel: "internal",
      placement: "internal",
      genre: "internal_update",
      ctaRule: "none_or_review",
      ctaStrength: "none",
      rtbMode: "bypass"
    },
    [
      { brief: "internal communication for employees. explain kotak cashback+ in everyday language.", expect: {} },
      { brief: "employee enablement note. keep it clear what this is for, no ad style.", expect: {} },
      { brief: "townhall support. what does cashback plus stand for in practical life?", expect: {} },
      { brief: "internal rollout update for branch teams. simple and useful pls.", expect: {} },
      { brief: "training support video, explain the everyday spending story", expect: {} },
      { brief: "mention essentials cashback if it feels natural, this is for employee understanding", expect: { rtbMode: "optional_or_targeted", rtbTopic: "essentials" } },
      { brief: "fuel savings can be included if helpful for staff context, not mandatory", expect: { rtbMode: "optional_or_targeted", rtbTopic: "fuel" } },
      { brief: "entertainment cashback maybe include if useful. internal enablement only.", expect: { rtbMode: "optional_or_targeted", rtbTopic: "entertainment" } },
      { brief: "internal update, action required later after review meeting", expect: { ctaStrength: "medium", ctaRule: "none_or_review" } },
      { brief: "employee explainer. factual, grounded, and easy to repeat.", expect: {} }
    ]
  );

  addGroup(
    "edge_mix",
    "kotak_air_plus",
    "point_to_camera_multi_scene",
    8,
    {
      ctaRule: "flex",
      rtbMode: "flex"
    },
    [
      { brief: "awareness film but also pls drive applications hard. reels. premium travel.", expect: { objective: "conversion", funnelStage: "bofu", channel: "generic", placement: "reels", ctaStrength: "hard", rtbMode: "default_strongest", ctaRule: "must_apply_now" } },
      { brief: "internl comms for employes, maybe mention free flight if reqd", expect: { objective: "unknown", funnelStage: "bofu", allowAnyReason: false } },
      { brief: "brand spot / perf hybrid for meta. make it memorable but also get clicks.", expect: { objective: "unknown", funnelStage: "bofu", channel: "meta", allowAnyReason: false } },
      { brief: "edu explainer for shorts, but keep it conversion-y enough to apply", expect: { objective: "education", funnelStage: "mofu", channel: "shorts", placement: "shorts", ctaStrength: "medium", ctaRule: "must_not_apply_now" } }
    ]
  );

  addGroup(
    "edge_mix_cash",
    "kotak_cashback",
    "point_to_camera_multi_scene",
    8,
    {
      ctaRule: "flex",
      rtbMode: "flex"
    },
    [
      { brief: "awareness thing but also need signups. practical city spenders. reels.", expect: { objective: "conversion", funnelStage: "bofu", placement: "reels", ctaStrength: "hard", ctaRule: "must_apply_now" } },
      { brief: "internal note for employes. can mention essentials cashback if reqd", expect: { objective: "unknown", funnelStage: "bofu", allowAnyReason: false } },
      { brief: "brand recall + perf hybrid on meta feed. simple value, get clicks too.", expect: { objective: "unknown", channel: "meta", funnelStage: "bofu", allowAnyReason: false } },
      { brief: "education cut for shorts but make them want to apply", expect: { objective: "education", funnelStage: "mofu", channel: "shorts", placement: "shorts", ctaStrength: "medium", ctaRule: "must_not_apply_now" } }
    ]
  );

  if (cases.length !== 100) {
    throw new Error(`Expected 100 cases, got ${cases.length}.`);
  }

  return cases;
}

async function loadPostHandler() {
  const routeModulePath = path.join(process.cwd(), ".next-prod/server/app/api/script/route.js");
  const mod = await import(routeModulePath);
  return (mod.default || mod["module.exports"]).routeModule.userland.POST;
}

function evaluateCta(script, rule) {
  const normalized = normalize(script);
  const hasApply = normalized.includes("apply now");
  const hasLearn = normalized.includes("learn more");
  const hasKnow = normalized.includes("know more");
  const hasReview = normalized.includes("please review");
  const hasAnyCta = hasApply || hasLearn || hasKnow || hasReview;

  switch (rule) {
    case "must_apply_now":
      return hasApply ? null : "missing_hard_cta";
    case "must_not_apply_now":
      return hasApply ? "overly_hard_cta" : null;
    case "soft_or_none":
      return hasApply ? "tofu_used_hard_cta" : null;
    case "none_or_review":
      if (hasApply || hasLearn || hasKnow) {
        return "internal_used_marketing_cta";
      }
      return null;
    default:
      return null;
  }
}

function evaluateResult(testCase, payload, status) {
  const reasons = [];
  const script = typeof payload.script === "string" ? payload.script : "";
  const characterCount = Number(payload.characterCount || 0);
  const strategy = payload.strategy || {};
  const error = typeof payload.error === "string" ? payload.error : "";
  const expect = testCase.expect;

  if (status !== 200) {
    reasons.push(error ? `http_${status}:${error}` : `http_${status}`);
    return { pass: false, reasons };
  }

  if (!script) {
    reasons.push("missing_script");
  }
  if (payload.durationFitOk !== true) {
    reasons.push("duration_fit_failed");
  }
  if (testCase.durationSeconds === 8) {
    if (characterCount < EIGHT_SECOND_MIN_CHARACTERS || characterCount > EIGHT_SECOND_MAX_CHARACTERS) {
      reasons.push("eight_second_character_band_failed");
    }
  }
  if (hasForbiddenAlias(script)) {
    reasons.push("forbidden_alias");
  }
  if (hasInvalidProductMention(testCase.product, script)) {
    reasons.push("invalid_product_name");
  }

  for (const key of ["objective", "funnelStage", "channel", "placement", "genre", "ctaStrength"]) {
    if (expect[key] && strategy[key] !== expect[key]) {
      reasons.push(`strategy_${key}_expected_${expect[key]}_got_${strategy[key] || "missing"}`);
    }
  }

  if (expect.rtbMode === "brief_targeted" && payload.rtbMode !== "brief_targeted") {
    reasons.push(`rtb_mode_expected_brief_targeted_got_${payload.rtbMode || "missing"}`);
  }
  if (expect.rtbMode === "default_strongest" && payload.rtbMode !== "default_strongest") {
    reasons.push(`rtb_mode_expected_default_strongest_got_${payload.rtbMode || "missing"}`);
  }
  if (expect.rtbMode === "bypass" && payload.rtbMode !== "bypass") {
    reasons.push(`rtb_mode_expected_bypass_got_${payload.rtbMode || "missing"}`);
  }
  if (expect.rtbMode === "optional" && payload.rtbMode !== "optional") {
    reasons.push(`rtb_mode_expected_optional_got_${payload.rtbMode || "missing"}`);
  }
  if (expect.rtbMode === "optional_or_targeted" && !["optional", "brief_targeted"].includes(payload.rtbMode)) {
    reasons.push(`rtb_mode_expected_optional_or_targeted_got_${payload.rtbMode || "missing"}`);
  }
  if (expect.rtbMode === "required_or_targeted" && !["default_strongest", "brief_targeted"].includes(payload.rtbMode)) {
    reasons.push(`rtb_mode_expected_required_or_targeted_got_${payload.rtbMode || "missing"}`);
  }

  const ctaReason = evaluateCta(script, expect.ctaRule);
  if (ctaReason) {
    reasons.push(ctaReason);
  }

  if (expect.rtbTopic && !hasAnyToken(script, RTB_TOPICS[expect.rtbTopic] || [])) {
    reasons.push(`missing_expected_rtb_${expect.rtbTopic}`);
  }

  if (expect.noHardSell && /\bapply now\b/i.test(script)) {
    reasons.push("unexpected_hard_sell_language");
  }

  if (expect.rtbMode === "bypass" && hasAnyToken(script, allRtbTokens())) {
    reasons.push("bypass_case_still_mentions_rtb");
  }

  return {
    pass: reasons.length === 0,
    reasons
  };
}

async function runCase(testCase, post) {
  const startedAt = Date.now();
  const body = {
    product: testCase.product,
    brief: testCase.brief,
    videoType: testCase.videoType,
    durationSeconds: testCase.durationSeconds
  };

  try {
    let payload;
    let status = 200;

    if (post) {
      const response = await post(
        new Request("http://localhost/api/script", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        })
      );
      status = response.status;
      payload = JSON.parse(await response.text());
    } else {
      const payloadText = await new Promise((resolve, reject) => {
        execFile(
          "curl",
          [
            "-sS",
            `${SCRIPT_API_BASE}/api/script`,
            "-H",
            "content-type: application/json",
            "-d",
            JSON.stringify(body)
          ],
          { maxBuffer: 1024 * 1024 * 4 },
          (error, stdout, stderr) => {
            if (error) {
              reject(new Error(stderr || error.message));
              return;
            }
            resolve(stdout);
          }
        );
      });
      payload = JSON.parse(payloadText);
      status = payload && payload.error ? 500 : 200;
    }

    const evaluation = evaluateResult(testCase, payload, status);

    return {
      id: testCase.id,
      product: testCase.product,
      durationSeconds: testCase.durationSeconds,
      videoType: testCase.videoType,
      brief: testCase.brief,
      script: payload.script || "",
      status,
      elapsedMs: Date.now() - startedAt,
      pass: evaluation.pass,
      failureReasons: evaluation.reasons,
      strategy: payload.strategy || null,
      rtbMode: payload.rtbMode || null,
      error: payload.error || null
    };
  } catch (error) {
    return {
      id: testCase.id,
      product: testCase.product,
      durationSeconds: testCase.durationSeconds,
      videoType: testCase.videoType,
      brief: testCase.brief,
      script: "",
      status: 500,
      elapsedMs: Date.now() - startedAt,
      pass: false,
      failureReasons: [`runtime_error:${error instanceof Error ? error.message : String(error)}`],
      strategy: null,
      rtbMode: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function escapeCell(value) {
  return String(value || "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .replace(/\r/g, " ")
    .trim();
}

function buildMarkdown(report) {
  const lines = [
    `# Script Strategy Batch`,
    ``,
    `- Generated at: ${report.generatedAt}`,
    `- Total: ${report.summary.total}`,
    `- Passed: ${report.summary.passed}`,
    `- Failed: ${report.summary.failed}`,
    ``,
    `| ID | Brief | Script | Pass/Fail | Reason |`,
    `| --- | --- | --- | --- | --- |`
  ];

  for (const result of report.results) {
    lines.push(
      `| ${escapeCell(result.id)} | ${escapeCell(result.brief)} | ${escapeCell(result.script || result.error || "")} | ${
        result.pass ? "PASS" : "FAIL"
      } | ${escapeCell(result.failureReasons.join("; "))} |`
    );
  }

  return lines.join("\n");
}

async function runBatch() {
  const post = SCRIPT_USE_ROUTE_IMPORT ? await loadPostHandler() : null;
  const cases = buildCases();
  const queue = [...cases];
  const results = [];

  async function worker() {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) {
        return;
      }
      const result = await runCase(next, post);
      results.push(result);
      console.log(JSON.stringify({ id: result.id, status: result.status, pass: result.pass, reasons: result.failureReasons }));
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, () => worker()));

  const sorted = results.sort((a, b) => a.id.localeCompare(b.id));
  const summary = {
    total: sorted.length,
    passed: sorted.filter((result) => result.pass).length,
    failed: sorted.filter((result) => !result.pass).length
  };

  const report = {
    generatedAt: new Date().toISOString(),
    concurrency: CONCURRENCY,
    summary,
    results: sorted
  };

  const outDir = path.join(process.cwd(), "generated", "script-tests");
  await fs.mkdir(outDir, { recursive: true });
  const stamp = Date.now();
  const jsonPath = path.join(outDir, `script-strategy-batch-${stamp}.json`);
  const mdPath = path.join(outDir, `script-strategy-batch-${stamp}.md`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(mdPath, buildMarkdown(report), "utf8");

  console.log(`REPORT_JSON=${jsonPath}`);
  console.log(`REPORT_MD=${mdPath}`);
  console.log(`SUMMARY total=${summary.total} passed=${summary.passed} failed=${summary.failed}`);
}

runBatch().catch((error) => {
  console.error(error);
  process.exit(1);
});
