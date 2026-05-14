import { existsSync } from "node:fs";
import path from "node:path";
import { ProductKey } from "./types";

export interface SuperTextSpec {
  product: ProductKey;
  rtbKey: string;
  label: string;
  line1: string;
  line2: string;
}

interface SuperTextDefinition extends SuperTextSpec {
  patterns: RegExp[];
}

const REPO_SUPER1_FONT_PATH = path.join(process.cwd(), "app", "assets", "fonts", "SourceSans3-Black.ttf");
const DESKTOP_SUPER1_FONT_PATH = path.join(
  "/Users/neha/Desktop/Brand collaterals 3/FONTS/Source_Sans_3,Source_Serif_4/Source_Sans_3/static/SourceSans3-Black.ttf"
);

export const SUPER1_FONT_FILE =
  (existsSync(REPO_SUPER1_FONT_PATH) ? REPO_SUPER1_FONT_PATH : undefined) ??
  (existsSync(DESKTOP_SUPER1_FONT_PATH) ? DESKTOP_SUPER1_FONT_PATH : undefined);

const AIR_PLUS_SUPER1_DEFINITIONS: SuperTextDefinition[] = [
  {
    product: "kotak_air_plus",
    rtbKey: "complimentary_flight",
    label: "Air Plus / Complimentary flight",
    line1: "FREE",
    line2: "FLIGHT",
    patterns: [
      /\b(?:free|complimentary)\s+flight\b/i,
      /\bfly\s+free\b/i,
      /\bunlock\b[^.!?]{0,40}\b(?:free|complimentary)\s+flight\b/i
    ]
  },
  {
    product: "kotak_air_plus",
    rtbKey: "forex_markup",
    label: "Air Plus / Low 2% forex markup",
    line1: "LOW 2%",
    line2: "FOREX",
    patterns: [
      /\b(?:2\s*%|two\s*percent)\b[^.!?]{0,30}\b(?:forex|fx)\b/i,
      /\b(?:forex|fx)\b[^.!?]{0,30}\b(?:2\s*%|two\s*percent)\b/i
    ]
  },
  {
    product: "kotak_air_plus",
    rtbKey: "travel_rewards",
    label: "Air Plus / 5% travel rewards",
    line1: "5%",
    line2: "TRAVEL REWARDS",
    patterns: [
      /\b(?:5\s*%|five\s*percent)\b[^.!?]{0,40}\btravel\b/i,
      /\btravel\b[^.!?]{0,40}\b(?:5\s*%|five\s*percent)\b/i,
      /\bunbox\b/i
    ]
  },
  {
    product: "kotak_air_plus",
    rtbKey: "travel_value",
    label: "Air Plus / Travel value 80K+",
    line1: "₹80K+",
    line2: "TRAVEL VALUE",
    patterns: [
      /\b(?:80k|80,?000|eighty\s*thousand)\b[^.!?]{0,40}\btravel\b/i,
      /\btravel\b[^.!?]{0,40}\b(?:80k|80,?000|eighty\s*thousand)\b/i,
      /\btravel\s+(?:privileges|value|benefits|perks)\b/i
    ]
  },
  {
    product: "kotak_air_plus",
    rtbKey: "zero_joining_fee",
    label: "Air Plus / Zero joining fee",
    line1: "ZERO",
    line2: "JOINING FEE",
    patterns: [
      /\bzero\s+joining\s+fee\b/i,
      /\bnil\s+joining\s+fee\b/i,
      /\bjoining\s+fee\s+waived\b/i
    ]
  },
  {
    product: "kotak_air_plus",
    rtbKey: "domestic_lounges",
    label: "Air Plus / 4 free lounges",
    line1: "4 FREE",
    line2: "LOUNGES",
    patterns: [
      /\b(?:4|four)\b[^.!?]{0,24}\bdomestic\b[^.!?]{0,24}\blounge/i,
      /\bdomestic\b[^.!?]{0,24}\b(?:4|four)\b[^.!?]{0,24}\blounge/i
    ]
  },
  {
    product: "kotak_air_plus",
    rtbKey: "international_lounges",
    label: "Air Plus / 2 intl lounges",
    line1: "2 INTL",
    line2: "LOUNGES",
    patterns: [
      /\b(?:2|two)\b[^.!?]{0,24}\binternational\b[^.!?]{0,24}\blounge/i,
      /\binternational\b[^.!?]{0,24}\b(?:2|two)\b[^.!?]{0,24}\blounge/i,
      /\bpriority\s*pass\b/i
    ]
  },
  {
    product: "kotak_air_plus",
    rtbKey: "welcome_miles",
    label: "Air Plus / Welcome miles",
    line1: "2500",
    line2: "WELCOME MILES",
    patterns: [
      /\b(?:2500|2,500|two\s+thousand\s+five\s+hundred)\b[^.!?]{0,24}\bwelcome\b/i,
      /\bwelcome\b[^.!?]{0,24}\b(?:2500|2,500|two\s+thousand\s+five\s+hundred)\b/i
    ]
  },
  {
    product: "kotak_air_plus",
    rtbKey: "renewal_miles",
    label: "Air Plus / Renewal miles",
    line1: "2500",
    line2: "RENEWAL MILES",
    patterns: [
      /\b(?:2500|2,500|two\s+thousand\s+five\s+hundred)\b[^.!?]{0,24}\brenewal\b/i,
      /\brenewal\b[^.!?]{0,24}\b(?:2500|2,500|two\s+thousand\s+five\s+hundred)\b/i
    ]
  },
  {
    product: "kotak_air_plus",
    rtbKey: "fuel_waiver",
    label: "Air Plus / Fuel waiver",
    line1: "1% FUEL",
    line2: "WAIVER",
    patterns: [
      /\b(?:1\s*%|one\s*percent)\b[^.!?]{0,30}\bfuel\b[^.!?]{0,30}\b(?:waiver|surcharge)\b/i,
      /\bfuel\b[^.!?]{0,30}\b(?:1\s*%|one\s*percent)\b[^.!?]{0,30}\b(?:waiver|surcharge)\b/i
    ]
  },
  {
    product: "kotak_air_plus",
    rtbKey: "miles_transfer",
    label: "Air Plus / Miles transfer",
    line1: "MILES",
    line2: "TRANSFER",
    patterns: [/\btransfer\b[^.!?]{0,24}\bmiles?\b/i, /\bmiles?\b[^.!?]{0,24}\bpartners?\b/i]
  },
  {
    product: "kotak_air_plus",
    rtbKey: "mile_value",
    label: "Air Plus / 1 mile equals 1 rupee",
    line1: "1 MILE",
    line2: "= ₹1",
    patterns: [
      /\b(?:1\s+air\s+mile|one\s+air\s+mile|1\s+mile)\b[^.!?]{0,24}(?:=|equals?)\b[^.!?]{0,16}(?:₹\s*1|rs\.?\s*1|1\s+rupee)\b/i,
      /\bunbox\b[^.!?]{0,40}\b(?:₹\s*1|rs\.?\s*1|1\s+rupee)\b/i
    ]
  }
];

const CASHBACK_SUPER1_DEFINITIONS: SuperTextDefinition[] = [
  {
    product: "kotak_cashback",
    rtbKey: "grocery_cashback",
    label: "Cashback+ / Grocery cashback",
    line1: "5%",
    line2: "GROCERY",
    patterns: [
      /\b(?:5\s*%|five\s*percent)\b[^.!?]{0,28}\bgrocery\b/i,
      /\bgrocery\b[^.!?]{0,28}\b(?:5\s*%|five\s*percent)\b/i
    ]
  },
  {
    product: "kotak_cashback",
    rtbKey: "food_delivery_cashback",
    label: "Cashback+ / Food delivery cashback",
    line1: "5%",
    line2: "FOOD DELIVERY",
    patterns: [
      /\b(?:5\s*%|five\s*percent)\b[^.!?]{0,28}\bfood\s+delivery\b/i,
      /\bfood\s+delivery\b[^.!?]{0,28}\b(?:5\s*%|five\s*percent)\b/i
    ]
  },
  {
    product: "kotak_cashback",
    rtbKey: "entertainment_cashback",
    label: "Cashback+ / Entertainment cashback",
    line1: "5%",
    line2: "ENTERTAINMENT",
    patterns: [
      /\b(?:5\s*%|five\s*percent)\b[^.!?]{0,28}\b(?:entertainment|ott)\b/i,
      /\b(?:entertainment|ott)\b[^.!?]{0,28}\b(?:5\s*%|five\s*percent)\b/i
    ]
  },
  {
    product: "kotak_cashback",
    rtbKey: "essentials_cashback",
    label: "Cashback+ / Essentials cashback",
    line1: "5%",
    line2: "ESSENTIALS",
    patterns: [
      /\bdaily\s+essentials\b/i,
      /\bessentials\b/i,
      /\bgrocer(?:y|ies)\b[^.!?]{0,28}\bfood\s+delivery\b/i
    ]
  },
  {
    product: "kotak_cashback",
    rtbKey: "fuel_benefits",
    label: "Cashback+ / Fuel benefits",
    line1: "UP TO 4%",
    line2: "FUEL",
    patterns: [
      /\bup\s*to\s*(?:4\s*%|four\s*percent)\b[^.!?]{0,28}\bfuel\b/i,
      /\bfuel\b[^.!?]{0,28}\bup\s*to\s*(?:4\s*%|four\s*percent)\b/i
    ]
  },
  {
    product: "kotak_cashback",
    rtbKey: "zero_joining_fee",
    label: "Cashback+ / Zero joining fee",
    line1: "ZERO",
    line2: "JOINING FEE",
    patterns: [
      /\bzero\s+joining\s+fee\b/i,
      /\bnil\s+joining\s+fee\b/i,
      /\bjoining\s+fee\s+waived\b/i
    ]
  },
  {
    product: "kotak_cashback",
    rtbKey: "other_spends",
    label: "Cashback+ / Other spends",
    line1: "0.5%",
    line2: "OTHER SPENDS",
    patterns: [
      /\b(?:0\.5\s*%|0\.5\s*percent|half\s*percent)\b[^.!?]{0,32}\bother\s+spends?\b/i,
      /\bother\s+spends?\b[^.!?]{0,32}\b(?:0\.5\s*%|0\.5\s*percent|half\s*percent)\b/i
    ]
  },
  {
    product: "kotak_cashback",
    rtbKey: "bogo_movies",
    label: "Cashback+ / BOGO movies",
    line1: "BOGO",
    line2: "MOVIES",
    patterns: [/\bbogo\b/i, /\bbuy\s+one\s+get\s+one\b/i, /\bpvr\b/i, /\binox\b/i]
  },
  {
    product: "kotak_cashback",
    rtbKey: "annual_fee_waived",
    label: "Cashback+ / Annual fee waived",
    line1: "ANNUAL FEE",
    line2: "WAIVED",
    patterns: [
      /\bannual\s+fee\b[^.!?]{0,24}\bwaived?\b/i,
      /\bwaived?\b[^.!?]{0,24}\bannual\s+fee\b/i,
      /\b2\s*lakh\b[^.!?]{0,40}\bannual\s+fee\b/i
    ]
  },
  {
    product: "kotak_cashback",
    rtbKey: "point_value",
    label: "Cashback+ / 1 point equals 1 rupee",
    line1: "1 POINT",
    line2: "= ₹1",
    patterns: [
      /\b1\s+point\b[^.!?]{0,24}(?:=|equals?)\b[^.!?]{0,16}(?:₹\s*1|rs\.?\s*1|1\s+rupee)\b/i,
      /\bstatement\s+cashback\b/i
    ]
  },
  {
    product: "kotak_cashback",
    rtbKey: "upi_cashback",
    label: "Cashback+ / UPI cashback",
    line1: "0.5%",
    line2: "UPI",
    patterns: [
      /\b(?:0\.5\s*%|0\.5\s*percent|half\s*percent)\b[^.!?]{0,24}\bupi\b/i,
      /\bupi\b[^.!?]{0,24}\b(?:0\.5\s*%|0\.5\s*percent|half\s*percent)\b/i
    ]
  },
  {
    product: "kotak_cashback",
    rtbKey: "annual_value",
    label: "Cashback+ / Annual value",
    line1: "₹10,410",
    line2: "ANNUAL VALUE",
    patterns: [
      /\b(?:10,410|10410|ten\s+thousand\s+four\s+hundred\s+ten)\b/i,
      /\bannual\s+value\b/i
    ]
  }
];

const PRODUCT_FALLBACKS: Record<ProductKey, SuperTextSpec> = {
  kotak_air_plus: {
    product: "kotak_air_plus",
    rtbKey: "travel_rewards",
    label: "Air Plus / 5% travel rewards",
    line1: "5%",
    line2: "TRAVEL REWARDS"
  },
  kotak_cashback: {
    product: "kotak_cashback",
    rtbKey: "essentials_cashback",
    label: "Cashback+ / Essentials cashback",
    line1: "5%",
    line2: "ESSENTIALS"
  }
};

const SUPER1_DEFINITIONS: Record<ProductKey, SuperTextDefinition[]> = {
  kotak_air_plus: AIR_PLUS_SUPER1_DEFINITIONS,
  kotak_cashback: CASHBACK_SUPER1_DEFINITIONS
};

export function listSuper1Examples(): SuperTextSpec[] {
  return (Object.values(SUPER1_DEFINITIONS).flat() as SuperTextDefinition[]).map(
    ({ product, rtbKey, label, line1, line2 }) => ({
      product,
      rtbKey,
      label,
      line1,
      line2
    })
  );
}

export function resolveSuper1Text(product: ProductKey, script: string): SuperTextSpec {
  const definitions = SUPER1_DEFINITIONS[product];
  for (const definition of definitions) {
    if (definition.patterns.some((pattern) => pattern.test(script))) {
      const { rtbKey, label, line1, line2 } = definition;
      return { product, rtbKey, label, line1, line2 };
    }
  }
  return PRODUCT_FALLBACKS[product];
}
