#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const EIGHT_SECOND_MIN_CHARACTERS = 90;
const EIGHT_SECOND_MAX_CHARACTERS = 100;
const CONCURRENCY = Number(process.env.SCRIPT_BATCH_CONCURRENCY || 3);

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

function buildCases() {
  return [
    {
      id: "air_travel_rewards_01",
      product: "kotak_air_plus",
      brief: "Focus on five percent travel rewards via Unbox. Premium, affluent metro traveler. Direct response."
    },
    {
      id: "air_travel_rewards_02",
      product: "kotak_air_plus",
      brief: "Frequent business traveler in metros. Focus on travel rewards via Unbox and make it direct-response."
    },
    {
      id: "air_free_flight_01",
      product: "kotak_air_plus",
      brief: "Focus only on the complimentary flight at one and a half lakh quarterly spend. Premium, urgent, affluent metro traveler."
    },
    {
      id: "air_free_flight_02",
      product: "kotak_air_plus",
      brief: "Quarterly spend milestone should be the hero. Focus on complimentary flight only. Affluent metro flyer."
    },
    {
      id: "air_zero_fee_01",
      product: "kotak_air_plus",
      brief: "Focus only on limited-period zero joining fee. Premium traveler. Direct response."
    },
    {
      id: "air_zero_fee_02",
      product: "kotak_air_plus",
      brief: "Zero joining fee should be the one message. Metro traveler. Keep it urgent and direct."
    },
    {
      id: "air_general_01",
      product: "kotak_air_plus",
      brief: "Premium travel card for affluent metro flyers. Direct response. Keep it premium and urgent."
    },
    {
      id: "air_general_02",
      product: "kotak_air_plus",
      brief: "Affluent metro traveler looking for premium travel value. Make it sharp, urgent, and conversion-led."
    },
    {
      id: "air_general_03",
      product: "kotak_air_plus",
      brief: "Travel-focused premium card for urban professionals. Keep one message and make it click-worthy."
    },
    {
      id: "air_general_04",
      product: "kotak_air_plus",
      brief: "Position as premium travel utility for consultants flying often. Direct response, short, urgent."
    },
    {
      id: "air_general_05",
      product: "kotak_air_plus",
      brief: "Affluent city flyer. Make the value obvious fast and push applications."
    },
    {
      id: "air_unbox_01",
      product: "kotak_air_plus",
      brief: "Travel bookings through Unbox are the one message. Premium metro audience. Direct response."
    },
    {
      id: "air_unbox_02",
      product: "kotak_air_plus",
      brief: "Focus on bookings via Unbox and travel rewards. Keep it premium and fast."
    },
    {
      id: "air_metro_01",
      product: "kotak_air_plus",
      brief: "Metro founder who travels often. Keep it premium, travel-led, and scroll-stopping."
    },
    {
      id: "air_metro_02",
      product: "kotak_air_plus",
      brief: "Urban executive taking frequent flights. Make the travel value obvious in one line."
    },
    {
      id: "air_metro_03",
      product: "kotak_air_plus",
      brief: "Frequent airport user in metros. One strong travel message, no clutter."
    },
    {
      id: "air_metro_04",
      product: "kotak_air_plus",
      brief: "Premium city traveler. Make the offer feel immediate and useful."
    },
    {
      id: "air_metro_05",
      product: "kotak_air_plus",
      brief: "Work-trip heavy traveler. Direct response. Keep it premium, modern, and simple."
    },
    {
      id: "air_rewards_03",
      product: "kotak_air_plus",
      brief: "Travel rewards should be the lead benefit. Affluent metro audience. Apply-now intent."
    },
    {
      id: "air_rewards_04",
      product: "kotak_air_plus",
      brief: "Reward frequent travel bookings. Premium urban flyer. Keep the script direct and human."
    },
    {
      id: "air_flight_03",
      product: "kotak_air_plus",
      brief: "Complimentary flight message only. Make the spend threshold feel worth it."
    },
    {
      id: "air_flight_04",
      product: "kotak_air_plus",
      brief: "Hit the quarterly spend and unlock a flight. Affluent metro traveler. Conversion-led."
    },
    {
      id: "air_fee_03",
      product: "kotak_air_plus",
      brief: "Waived joining fee is the only point. Premium traveler. Make it urgent."
    },
    {
      id: "air_fee_04",
      product: "kotak_air_plus",
      brief: "Joining fee zero for limited period. Metro travel audience. Strong direct response."
    },
    {
      id: "air_general_06",
      product: "kotak_air_plus",
      brief: "Premium travel benefit card for affluent flyers. Keep one clear message and CTA."
    },
    {
      id: "cash_essentials_01",
      product: "kotak_cashback",
      brief: "Focus on five percent cashback on daily essentials. Value-driven salaried metro user. Direct response."
    },
    {
      id: "cash_essentials_02",
      product: "kotak_cashback",
      brief: "Groceries and milk are the one message. Practical metro audience. Keep it direct."
    },
    {
      id: "cash_entertainment_01",
      product: "kotak_cashback",
      brief: "Focus on five percent cashback on entertainment. Young salaried metro audience. Direct response."
    },
    {
      id: "cash_entertainment_02",
      product: "kotak_cashback",
      brief: "Movies and entertainment should be the one message. Keep it punchy and direct."
    },
    {
      id: "cash_fuel_01",
      product: "kotak_cashback",
      brief: "Focus on fuel savings only. Practical commuter, metro, urgent. Direct response."
    },
    {
      id: "cash_fuel_02",
      product: "kotak_cashback",
      brief: "Daily commute and fuel costs are the one message. Value-driven metro audience."
    },
    {
      id: "cash_zero_fee_01",
      product: "kotak_cashback",
      brief: "Focus only on limited-period zero joining fee. Practical salaried metro user. Direct response."
    },
    {
      id: "cash_zero_fee_02",
      product: "kotak_cashback",
      brief: "Zero joining fee is the only RTB. Make it practical, urgent, and clear."
    },
    {
      id: "cash_general_01",
      product: "kotak_cashback",
      brief: "Everyday value card for practical metro spenders. Direct response. Keep it useful and urgent."
    },
    {
      id: "cash_general_02",
      product: "kotak_cashback",
      brief: "Practical salaried metro audience. Make day-to-day savings feel obvious fast."
    },
    {
      id: "cash_general_03",
      product: "kotak_cashback",
      brief: "Useful everyday savings for urban spenders. Keep it short, direct, and conversion-led."
    },
    {
      id: "cash_general_04",
      product: "kotak_cashback",
      brief: "Budget-conscious metro spender. One strong utility message, no clutter."
    },
    {
      id: "cash_general_05",
      product: "kotak_cashback",
      brief: "Practical monthly spend card for city users. Make the value obvious and immediate."
    },
    {
      id: "cash_household_01",
      product: "kotak_cashback",
      brief: "Household budget audience. Essentials should feel lighter. Direct response."
    },
    {
      id: "cash_household_02",
      product: "kotak_cashback",
      brief: "Daily essentials and household utility for metro families. One-message script."
    },
    {
      id: "cash_young_01",
      product: "kotak_cashback",
      brief: "Young salaried metro user. Everyday savings should be the lead point."
    },
    {
      id: "cash_young_02",
      product: "kotak_cashback",
      brief: "Early-career salaried audience. Keep it practical, useful, and direct-response."
    },
    {
      id: "cash_commute_01",
      product: "kotak_cashback",
      brief: "Commuter audience in metros. Fuel savings should drive the script."
    },
    {
      id: "cash_commute_02",
      product: "kotak_cashback",
      brief: "Regular city driving and fuel bills. Make the savings obvious quickly."
    },
    {
      id: "cash_movies_01",
      product: "kotak_cashback",
      brief: "Entertainment and weekend outings. Keep it direct and punchy for paid social."
    },
    {
      id: "cash_movies_02",
      product: "kotak_cashback",
      brief: "Movie plans and entertainment spends. Young metro audience. One message only."
    },
    {
      id: "cash_grocery_01",
      product: "kotak_cashback",
      brief: "Groceries, milk, and essentials should be the single benefit. Practical direct response."
    },
    {
      id: "cash_grocery_02",
      product: "kotak_cashback",
      brief: "Daily essentials for salaried users in metros. Make savings feel immediate."
    },
    {
      id: "cash_fee_03",
      product: "kotak_cashback",
      brief: "Limited-period zero joining fee. Keep it useful, clear, and urgent."
    },
    {
      id: "cash_fee_04",
      product: "kotak_cashback",
      brief: "No upfront joining fee should be the hero message. Practical metro user."
    },
    {
      id: "cash_general_06",
      product: "kotak_cashback",
      brief: "Everyday utility for practical spenders. One clear savings message and CTA."
    }
  ];
}

async function loadPostHandler() {
  const routeModulePath = path.join(process.cwd(), ".next-prod/server/app/api/script/route.js");
  const mod = await import(routeModulePath);
  return (mod.default || mod["module.exports"]).routeModule.userland.POST;
}

function evaluateResult(testCase, payload) {
  const reasons = [];
  const script = typeof payload.script === "string" ? payload.script : "";
  const characterCount = Number(payload.characterCount || 0);

  if (!script) {
    reasons.push("missing_script");
  }
  if (payload.durationFitOk !== true) {
    reasons.push("duration_fit_failed");
  }
  if (payload.rtbCoverageOk !== true) {
    reasons.push("rtb_coverage_failed");
  }
  if (characterCount < EIGHT_SECOND_MIN_CHARACTERS || characterCount > EIGHT_SECOND_MAX_CHARACTERS) {
    reasons.push("character_band_failed");
  }
  if (hasForbiddenAlias(script)) {
    reasons.push("forbidden_alias");
  }
  if (hasInvalidProductMention(testCase.product, script)) {
    reasons.push("invalid_product_name");
  }

  return {
    pass: reasons.length === 0,
    reasons
  };
}

async function runCase(post, testCase) {
  const startedAt = Date.now();
  const body = {
    product: testCase.product,
    brief: testCase.brief,
    videoType: "point_to_camera_multi_scene",
    durationSeconds: 8
  };

  try {
    const response = await post(
      new Request("http://localhost/api/script", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      })
    );
    const payload = JSON.parse(await response.text());
    const evaluation = response.status === 200 ? evaluateResult(testCase, payload) : { pass: false, reasons: ["http_error"] };
    return {
      id: testCase.id,
      product: testCase.product,
      brief: testCase.brief,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      ...payload,
      pass: evaluation.pass,
      failureReasons: evaluation.reasons
    };
  } catch (error) {
    return {
      id: testCase.id,
      product: testCase.product,
      brief: testCase.brief,
      status: 500,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      pass: false,
      failureReasons: ["runtime_error"]
    };
  }
}

async function runBatch() {
  const post = await loadPostHandler();
  const cases = buildCases();
  const queue = [...cases];
  const results = [];

  async function worker() {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) {
        return;
      }
      const result = await runCase(post, next);
      results.push(result);
      console.log(JSON.stringify(result));
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, () => worker()));

  const summary = {
    total: results.length,
    passed: results.filter((result) => result.pass).length,
    failed: results.filter((result) => !result.pass).length
  };

  const report = {
    generatedAt: new Date().toISOString(),
    concurrency: CONCURRENCY,
    summary,
    results: results.sort((a, b) => a.id.localeCompare(b.id))
  };

  const outDir = path.join(process.cwd(), "generated", "script-tests");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `script-batch-${Date.now()}.json`);
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`REPORT_PATH=${outPath}`);
  console.log(`SUMMARY total=${summary.total} passed=${summary.passed} failed=${summary.failed}`);
}

runBatch().catch((error) => {
  console.error(error);
  process.exit(1);
});
