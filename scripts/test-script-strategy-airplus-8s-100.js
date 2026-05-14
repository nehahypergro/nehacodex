#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");

const EIGHT_SECOND_MIN_CHARACTERS = 90;
const EIGHT_SECOND_MAX_CHARACTERS = 100;
const CONCURRENCY = Number(process.env.SCRIPT_BATCH_CONCURRENCY || 2);
const SCRIPT_API_BASE = (process.env.SCRIPT_API_BASE || "http://127.0.0.1:3000").replace(/\/$/, "");
const SCRIPT_USE_ROUTE_IMPORT = /^(1|true|yes)$/i.test(process.env.SCRIPT_USE_ROUTE_IMPORT || "");

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/₹/g, "inr")
    .replace(/rs\.?/g, "inr")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasForbiddenAlias(script) {
  return /\b(standard card|fuel card|travel card|cashback card|rewards card|miles card|air card)\b/i.test(script);
}

function hasInvalidProductMention(script) {
  const mentionsKotak = /\bkotak\b/i.test(script);
  if (!mentionsKotak) {
    return false;
  }
  return !script.toLowerCase().includes("kotak air plus");
}

const RTB_TOPICS = {
  travel: ["five percent", "travel", "unbox", "rewards", "bookings"],
  join_fee: ["zero joining fee", "joining fee", "limited period"],
  flight: ["complimentary flight", "one and a half lakh", "flight", "quarter"]
};

function hasAnyToken(script, tokens) {
  const normalized = normalize(script);
  return tokens.some((token) => normalized.includes(normalize(token)));
}

function buildCases() {
  const cases = [];

  function addGroup(prefix, expectBase, briefs) {
    briefs.forEach((item, index) => {
      cases.push({
        id: `${prefix}_${String(index + 1).padStart(2, "0")}`,
        product: "kotak_air_plus",
        videoType: "point_to_camera_multi_scene",
        durationSeconds: 8,
        brief: item.brief,
        expect: {
          ...expectBase,
          ...(item.expect || {})
        }
      });
    });
  }

  addGroup(
    "bofu",
    {
      objective: "conversion",
      funnelStage: "bofu",
      ctaStrength: "hard",
      ctaRule: "must_apply_now",
      rtbMode: "required_or_targeted"
    },
    [
      { brief: "meta performance push. focus only on complimentary flight after one and a half lakh quarterly spend. affluent metro traveller.", expect: { channel: "meta", rtbTopic: "flight", rtbMode: "brief_targeted" } },
      { brief: "Need more ppl to apply for air plus. reels. hero point is travel rewards via unbox only.", expect: { placement: "reels", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "google perf bumper. zero joining fee only pls. premium flyer audience.", expect: { channel: "google", placement: "youtube", rtbTopic: "join_fee", rtbMode: "brief_targeted" } },
      { brief: "retargeting brief for metro flyers, push apps now, make the free flight after one and a half lakh feel worth it", expect: { rtbTopic: "flight", rtbMode: "brief_targeted" } },
      { brief: "conversion ad for ig stories. travel rewards should be the one message. keep it premium not fluffy.", expect: { channel: "meta", placement: "stories", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "need direct response copy. joining fee zero, limited period. city flyers, sharp.", expect: { rtbTopic: "join_fee", rtbMode: "brief_targeted" } },
      { brief: "more apps from affluent metro travel folks. performance marketing on meta. one strongest message only.", expect: { channel: "meta", rtbTopic: "travel", rtbMode: "default_strongest" } },
      { brief: "push applications, frequent biz travellers, youtube bumper, make unbox rewards obvious fast", expect: { channel: "google", placement: "youtube", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "perf ad. free flight should be hero. dont talk abt anything else. high intent traveller", expect: { rtbTopic: "flight", rtbMode: "brief_targeted" } },
      { brief: "Need apps from premium metro travellers. air plus. keep one line, direct, and useful.", expect: { rtbTopic: "travel", rtbMode: "default_strongest" } },
      { brief: "meta convrsion brief, travel spends via unbox reward should land in first sec", expect: { channel: "meta", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "performance on reels for people who travel a lot for work. make the offer obvious, not fancy.", expect: { placement: "reels", rtbTopic: "travel", rtbMode: "default_strongest" } },
      { brief: "pls make this a hard conversion cut. free flight threshold only. upper income metros.", expect: { rtbTopic: "flight", rtbMode: "brief_targeted" } },
      { brief: "paid social direct response. dont over explain. unbox reward should do the heavy lifting.", expect: { channel: "social", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "app installs nah, applications yes. air plus. premium travel user. one message only.", expect: { rtbTopic: "travel", rtbMode: "default_strongest" } },
      { brief: "conversion brief for stories. limited period joining fee zero. make it punchy.", expect: { placement: "stories", rtbTopic: "join_fee", rtbMode: "brief_targeted" } },
      { brief: "need higher applies from people who already travel. use quarterly spend threshold as hero.", expect: { rtbTopic: "flight", rtbMode: "brief_targeted" } },
      { brief: "yt bumper for direct response. frequent travellers. make reward feel instant and tangible.", expect: { channel: "google", placement: "youtube", rtbTopic: "travel", rtbMode: "default_strongest" } },
      { brief: "performance cut. no fluff. no education. joining fee zero and thats enough.", expect: { rtbTopic: "join_fee", rtbMode: "brief_targeted" } },
      { brief: "meta ads. rich travellers. make unbox benefit obvious and make them apply.", expect: { channel: "meta", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "need response ad from warm audience. free flight unlock is the story. keep it crisp.", expect: { rtbTopic: "flight", rtbMode: "brief_targeted" } },
      { brief: "performance marketing for affluent fliers. one strongest claim only please.", expect: { rtbTopic: "travel", rtbMode: "default_strongest" } },
      { brief: "applications objective. premium metros. no soft language. use joining fee zero.", expect: { rtbTopic: "join_fee", rtbMode: "brief_targeted" } },
      { brief: "reels direct response. travel card ppl will get. make unbox reward land immediately.", expect: { placement: "reels", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "free flight after quarterly spend. that should be the only thought in the ad.", expect: { rtbTopic: "flight", rtbMode: "brief_targeted" } }
    ]
  );

  addGroup(
    "mofu",
    {
      funnelStage: "mofu",
      ctaStrength: "medium",
      ctaRule: "must_not_apply_now",
      rtbMode: "optional_or_targeted"
    },
    [
      { brief: "consideration stage film. help frequent travellers understand why air plus is useful for planned travel spend.", expect: { objective: "consideration" } },
      { brief: "educational explainer for social media. explain where travel rewards via unbox really help.", expect: { objective: "education", channel: "social", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "why choose air plus for work trips? make it clearer, not salesy.", expect: { objective: "consideration", genre: "product_explainer" } },
      { brief: "help ppl get the value prop. frequent flyers, premium tone, more explain less sell.", expect: { objective: "consideration" } },
      { brief: "educational video for reels, show how one and a half lakh milestone becomes rewarding", expect: { objective: "education", placement: "reels", rtbTopic: "flight", rtbMode: "brief_targeted" } },
      { brief: "consideration brief for urban flyers. joining fee zero if it fits, otherwise keep it utility-led", expect: { objective: "consideration", rtbTopic: "join_fee", rtbMode: "brief_targeted" } },
      { brief: "explainer: premium travel card for people doing short work trips often", expect: { objective: "education", genre: "product_explainer" } },
      { brief: "can you make this more like helping them understand the travel upside, not hard sell", expect: { objective: "consideration" } },
      { brief: "consideration / explainer for meta feed. where does unbox booking value show up?", expect: { objective: "consideration", channel: "meta", placement: "feed", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "educate affluent metro travelers on why this card is handy for booking trips", expect: { objective: "education", genre: "educational" } },
      { brief: "help users see why quarterly spend unlock matters. more clarity, less urgency.", expect: { objective: "consideration", rtbTopic: "flight", rtbMode: "brief_targeted" } },
      { brief: "product explainer. premium traveller cohort. make the utility easy to get.", expect: { objective: "education", genre: "product_explainer" } },
      { brief: "not a hard sell. more like why this makes sense if someone travels for work often.", expect: { objective: "consideration" } },
      { brief: "education led social cut. maybe use travel reward proof if needed but dont push.", expect: { objective: "education", channel: "social", rtbMode: "optional_or_targeted" } },
      { brief: "help audience understand the difference this card makes to planned travel spending", expect: { objective: "consideration" } },
      { brief: "soft explainer. joining fee zero can come in if natural. no pressure language.", expect: { objective: "education", rtbTopic: "join_fee", rtbMode: "brief_targeted" } },
      { brief: "consideration cut for stories. explain it, dont sell it too much.", expect: { objective: "consideration", placement: "stories", channel: "meta" } },
      { brief: "educational short on how travel rewards via unbox make the card more useful", expect: { objective: "education", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "for people still evaluating. make the air plus value easy to understand quickly.", expect: { objective: "consideration" } },
      { brief: "explain free flight unlock in a simple useful way. not urgent, not loud.", expect: { objective: "education", rtbTopic: "flight", rtbMode: "brief_targeted" } },
      { brief: "consideration stage. premium travellers. answer why choose this, not why apply now.", expect: { objective: "consideration" } },
      { brief: "eductional cut typo and all. user should still get what the travel upside is", expect: { objective: "education" } },
      { brief: "explain how it helps on trip bookings. one proof point max. keep it clear.", expect: { objective: "education", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "middle funnel reel, useful over flashy. joining fee zero maybe, only if it helps", expect: { objective: "consideration", placement: "reels", rtbTopic: "join_fee", rtbMode: "brief_targeted" } },
      { brief: "help people understand if this is worth it for frequent travel plans", expect: { objective: "consideration" } }
    ]
  );

  addGroup(
    "tofu",
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
      { brief: "top funnel recall video. travel energy, upscale, not performancey.", expect: { objective: "awareness", genre: "brand_spot" } },
      { brief: "awareness piece for youtube. premium flyer lifestyle. no hard CTA pls.", expect: { objective: "awareness", channel: "google", placement: "youtube", genre: "brand_spot" } },
      { brief: "brand spot. trip-day mood. sophisticated, urban, warm. no product feature dump.", expect: { objective: "brand", genre: "brand_spot" } },
      { brief: "reels brand recall, polished travel tone, should feel aspirational not salesy", expect: { objective: "brand", channel: "meta", placement: "reels", genre: "brand_spot" } },
      { brief: "launch film for metro flyers. keep it premium and memorable.", expect: { objective: "brand", genre: "brand_spot" } },
      { brief: "upper funnel push. smooth travel value, premium signal, less direct response", expect: { objective: "awareness" } },
      { brief: "awareness video for instagram stories. affluent indian traveller, premium, modern", expect: { objective: "awareness", channel: "meta", placement: "stories", genre: "brand_spot" } },
      { brief: "brand recall piece, maybe mention travel rewards if it feels natural", expect: { objective: "brand", genre: "brand_spot", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "simple travel brand spot, no hard sell, just make it feel elevated", expect: { objective: "brand", genre: "brand_spot" } },
      { brief: "upper funnel reels cut. make it feel polished and premium, not like an ad ad.", expect: { objective: "awareness", channel: "meta", placement: "reels", genre: "brand_spot" } },
      { brief: "brand thing for rich travellers. clean and memorable. less about proof, more vibe.", expect: { objective: "brand", genre: "brand_spot" } },
      { brief: "launch mood film. modern indian metro traveller. soft close, not sales close.", expect: { objective: "brand", genre: "brand_spot" } },
      { brief: "awareness only pls. no apply now stuff. just premium trip-day association.", expect: { objective: "awareness", genre: "brand_spot" } },
      { brief: "brand recall social cut. maybe unbox reward if it slips in naturally.", expect: { objective: "brand", channel: "social", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "make kotak air plus feel aspirational but usable. upper funnel.", expect: { objective: "awareness", genre: "brand_spot" } },
      { brief: "tof video typo but you know. premium travel world. light brand memory play.", expect: { objective: "awareness" } },
      { brief: "top funnel. smooth travel energy. no hard performance language.", expect: { objective: "awareness", genre: "brand_spot" } },
      { brief: "brand spot for stories. premium city-to-airport mood. not a feature list.", expect: { objective: "brand", channel: "meta", placement: "stories", genre: "brand_spot" } },
      { brief: "awareness cut for wealthy metro flyers. make it classy and easy to remember.", expect: { objective: "awareness", genre: "brand_spot" } },
      { brief: "launch social asset. elevated tone. dont sound clicky.", expect: { objective: "brand", channel: "social", genre: "brand_spot" } },
      { brief: "brand recall. subtle mention of complimentary flight is ok if very natural", expect: { objective: "brand", genre: "brand_spot", rtbTopic: "flight", rtbMode: "brief_targeted" } },
      { brief: "travel lifestyle brand piece. no heavy cta, no pressure.", expect: { objective: "brand", genre: "brand_spot" } }
    ]
  );

  addGroup(
    "internal",
    {
      objective: "internal",
      funnelStage: "internal",
      channel: "internal",
      placement: "internal",
      genre: "internal_update",
      ctaRule: "none_or_review",
      rtbMode: "bypass_or_targeted"
    },
    [
      { brief: "internal communication for employees. what is kotak air plus about in simple words?", expect: { ctaStrength: "none" } },
      { brief: "employee enablement note. explain the card in a useful, plain language way.", expect: { ctaStrength: "none" } },
      { brief: "internal rollout update for sales teams. keep it simple, no hard sell.", expect: { ctaStrength: "none" } },
      { brief: "townhall support video, leadership wants clarity on what air plus stands for.", expect: { ctaStrength: "none" } },
      { brief: "internal comms: make travel use case easy for teams to remember", expect: { ctaStrength: "none" } },
      { brief: "enablement piece for relationship managers. mention travel rewards if it fits naturally.", expect: { ctaStrength: "none", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "employee explainer. zero joining fee can be included if useful, not compulsory.", expect: { ctaStrength: "none", rtbTopic: "join_fee", rtbMode: "brief_targeted" } },
      { brief: "internal team update, complimentary flight threshold can be touched on if helpful.", expect: { ctaStrength: "none", rtbTopic: "flight", rtbMode: "brief_targeted" } },
      { brief: "sales kickoff support line, explain air plus fast. action required later via deck review.", expect: { ctaStrength: "medium", ctaRule: "none_or_review" } },
      { brief: "internal communications video for product training. keep it factual and useful.", expect: { ctaStrength: "none" } },
      { brief: "employee training cut. what should branch folks remember about air plus?", expect: { ctaStrength: "none" } },
      { brief: "internal use only. dont make it sound like an ad. just help people understand it.", expect: { ctaStrength: "none" } },
      { brief: "enablement support. maybe use unbox rewards as proof if needed, but keep it grounded.", expect: { ctaStrength: "none", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "product training snippet for employees. plain english. practical memory aid.", expect: { ctaStrength: "none" } },
      { brief: "internal video for RMs. if free flight threshold helps explain it, mention it.", expect: { ctaStrength: "none", rtbTopic: "flight", rtbMode: "brief_targeted" } },
      { brief: "employee note. keep it repeatable and simple for internal sharing.", expect: { ctaStrength: "none" } },
      { brief: "townhall follow-up asset. explain without selling. no consumer-style CTA.", expect: { ctaStrength: "none" } },
      { brief: "internal comms, typo ok, but make it factual. travel rewards if relevant.", expect: { ctaStrength: "none", rtbTopic: "travel", rtbMode: "brief_targeted" } },
      { brief: "sales onboarding. staff should know what makes this useful for travellers.", expect: { ctaStrength: "none" } },
      { brief: "support line for internal presentation. action required later after deck review.", expect: { ctaStrength: "medium", ctaRule: "none_or_review" } },
      { brief: "employee explainer. grounded, repeatable, not fancy.", expect: { ctaStrength: "none" } },
      { brief: "internal training note. joining fee zero can be mentioned if it helps memory.", expect: { ctaStrength: "none", rtbTopic: "join_fee", rtbMode: "brief_targeted" } },
      { brief: "for internal circulation. what is air plus, in a line people can say back.", expect: { ctaStrength: "none" } },
      { brief: "internal enablement short. no ad voice. useful and factual only.", expect: { ctaStrength: "none" } },
      { brief: "employee-facing line for product update. review deck later after this.", expect: { ctaStrength: "medium", ctaRule: "none_or_review" } }
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

function objectiveMatchesBucket(expected, actual) {
  if (!expected) {
    return true;
  }
  if (expected === actual) {
    return true;
  }
  const mofuBucket = new Set(["education", "consideration"]);
  const tofuBucket = new Set(["brand", "awareness"]);
  if (mofuBucket.has(expected) && mofuBucket.has(actual)) {
    return true;
  }
  if (tofuBucket.has(expected) && tofuBucket.has(actual)) {
    return true;
  }
  return false;
}

function genreMatchesBucket(expected, actual) {
  if (!expected) {
    return true;
  }
  if (expected === actual) {
    return true;
  }
  const mofuGenreBucket = new Set(["educational", "product_explainer"]);
  if (mofuGenreBucket.has(expected) && mofuGenreBucket.has(actual)) {
    return true;
  }
  return false;
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
  if (characterCount < EIGHT_SECOND_MIN_CHARACTERS || characterCount > EIGHT_SECOND_MAX_CHARACTERS) {
    reasons.push("eight_second_character_band_failed");
  }
  if (hasForbiddenAlias(script)) {
    reasons.push("forbidden_alias");
  }
  if (hasInvalidProductMention(script)) {
    reasons.push("invalid_product_name");
  }

  for (const key of ["funnelStage", "channel", "placement", "ctaStrength"]) {
    if (expect[key] && strategy[key] !== expect[key]) {
      reasons.push(`strategy_${key}_expected_${expect[key]}_got_${strategy[key] || "missing"}`);
    }
  }

  if (expect.objective && !objectiveMatchesBucket(expect.objective, strategy.objective)) {
    reasons.push(`strategy_objective_expected_${expect.objective}_got_${strategy.objective || "missing"}`);
  }

  if (expect.genre && !genreMatchesBucket(expect.genre, strategy.genre)) {
    reasons.push(`strategy_genre_expected_${expect.genre}_got_${strategy.genre || "missing"}`);
  }

  if (expect.rtbMode === "brief_targeted" && payload.rtbMode !== "brief_targeted") {
    reasons.push(`rtb_mode_expected_brief_targeted_got_${payload.rtbMode || "missing"}`);
  }
  if (expect.rtbMode === "default_strongest" && payload.rtbMode !== "default_strongest") {
    reasons.push(`rtb_mode_expected_default_strongest_got_${payload.rtbMode || "missing"}`);
  }
  if (expect.rtbMode === "required_or_targeted" && !["default_strongest", "brief_targeted"].includes(payload.rtbMode)) {
    reasons.push(`rtb_mode_expected_required_or_targeted_got_${payload.rtbMode || "missing"}`);
  }
  if (expect.rtbMode === "optional_or_targeted" && !["optional", "brief_targeted"].includes(payload.rtbMode)) {
    reasons.push(`rtb_mode_expected_optional_or_targeted_got_${payload.rtbMode || "missing"}`);
  }
  if (expect.rtbMode === "bypass_or_targeted" && !["bypass", "brief_targeted", "optional"].includes(payload.rtbMode)) {
    reasons.push(`rtb_mode_expected_bypass_or_targeted_got_${payload.rtbMode || "missing"}`);
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
    `# Air Plus 8s Strategy Batch`,
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
  const jsonPath = path.join(outDir, `script-strategy-airplus-8s-${stamp}.json`);
  const mdPath = path.join(outDir, `script-strategy-airplus-8s-${stamp}.md`);
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
