import { ProductKey } from "./types";

export const APP_NAME = "Creative AI - Video";

export const PRODUCT_TOGGLES: Array<{ key: ProductKey; label: string }> = [
  { key: "kotak_air_plus", label: "Kotak Air Plus" },
  { key: "kotak_cashback", label: "Kotak Cashback+" }
];

export interface ProductSupportingFact {
  fact: string;
  keywords: string[];
}

interface ProductSpec {
  positioning?: string;
  corePromise?: string;
  socialTone?: string;
  audienceSummary: string;
  imageTreatment?: string;
  voice?: string[];
  psychographics?: string[];
  hooks: string[];
  supportingFacts?: ProductSupportingFact[];
  cta: string;
  constraintsToState: string[];
  avoidClaims: string[];
  imageVibe: string;
  disclaimer: string;
}

export const PRODUCT_SPECS: Record<ProductKey, ProductSpec> = {
  kotak_air_plus: {
    positioning: "The Seamless Gateway",
    corePromise: "Eliminate travel friction through premium utility; an access pass.",
    socialTone: "Short, punchy, visually driven with a how-to framing.",
    audienceSummary:
      "Age 28-55, metro affluent and emerging HNI, high-intent travelers in Delhi NCR, Mumbai, Bengaluru, Hyderabad, Chandigarh, Pune, Ahmedabad.",
    imageTreatment:
      "Image treatment should feel like believable phone-shot premium mobility in metro India: airport approach, transfer pickup, business-hotel arrival, check-in approach, curbside luggage moments, or travel-ready hotel interiors. Avoid glossy resort-campaign worlds, palace-hotel spectacle, heliport fantasy, or fashion-editorial polish.",
    voice: ["Confident (worldly, knowledgeable)", "Efficient (values time)", "Inspiring (evokes wanderlust)"],
    hooks: [
      "Earn 5% rewards on travel bookings via Kotak Unbox.",
      "Limited period: joining fee INR 0.",
      "Spend INR 1.5L this quarter to unlock a complimentary flight."
    ],
    supportingFacts: [
      {
        fact: "Unlimited two Air Miles per one hundred rupees on all other eligible regular spends.",
        keywords: ["other spends", "regular spends", "everyday spends", "two air miles", "2 air miles", "unlimited", "base rate"]
      },
      {
        fact: "Annual travel privileges and savings worth over eighty thousand rupees.",
        keywords: ["eighty thousand", "80000", "80,000", "travel privileges", "annual value", "annual savings", "over eighty thousand"]
      },
      {
        fact: "Welcome benefit: two thousand five hundred Air Miles after card issuance, subject to joining fee payment.",
        keywords: ["welcome benefit", "welcome miles", "joining bonus", "welcome bonus", "2500", "2,500", "issuance"]
      },
      {
        fact: "Renewal benefit: two thousand five hundred Air Miles on annual fee payment.",
        keywords: ["renewal benefit", "renewal miles", "anniversary benefit", "annual fee payment", "2500", "2,500", "renewal"]
      },
      {
        fact: "Four complimentary domestic lounge visits annually, capped at two per calendar quarter.",
        keywords: ["domestic lounge", "lounge access", "airport lounge", "four lounge", "4 lounge", "two per quarter", "calendar quarter"]
      },
      {
        fact: "Two complimentary international lounge visits annually, with Priority Pass app access support.",
        keywords: ["international lounge", "priority pass", "priority pass app", "two lounge", "2 lounge", "overseas lounge"]
      },
      {
        fact: "Low foreign exchange markup of two percent on international transactions.",
        keywords: ["forex", "foreign exchange", "forex markup", "international transactions", "abroad", "overseas", "2%", "two percent"]
      },
      {
        fact: "One percent fuel surcharge waiver on fuel spends between four hundred and seven thousand five hundred rupees, capped annually.",
        keywords: ["fuel surcharge", "surcharge waiver", "fuel waiver", "petrol", "diesel", "fuel spends", "one percent fuel"]
      },
      {
        fact: "One Air Mile equals one rupee for Kotak Unbox flight and hotel redemptions, with up to eighty percent of booking covered by miles.",
        keywords: ["redeem", "redemption", "unbox redemption", "one rupee", "1 rupee", "flight redemption", "hotel redemption", "eighty percent", "80%"]
      },
      {
        fact: "Air Miles can transfer to airline and hotel loyalty partners including Maharaja Club, KrisFlyer, Flying Blue, and Marriott Bonvoy.",
        keywords: ["transfer", "partner transfer", "airline partner", "hotel partner", "loyalty", "krisflyer", "flying blue", "marriott", "maharaja club"]
      },
      {
        fact: "Travel bookings on Kotak Unbox earn five Air Miles per one hundred rupees, capped at fifteen thousand Air Miles per statement cycle.",
        keywords: ["statement cap", "statement cycle", "fifteen thousand", "15000", "15,000", "accelerated cap", "air miles cap"]
      },
      {
        fact: "The complimentary flight milestone is issued as a five thousand rupee travel voucher or equivalent Air Miles after one and a half lakh quarterly spend, valid until December thirty first twenty twenty six.",
        keywords: ["travel voucher", "5000", "5,000", "voucher", "milestone validity", "valid until", "december 31 2026", "dec 31 2026"]
      },
      {
        fact: "Standard annual renewal fee is three thousand rupees plus GST, with no annual fee waiver milestone.",
        keywords: ["annual fee", "renewal fee", "three thousand", "3000", "gst", "fee waiver", "annual fee waiver"]
      },
      {
        fact: "Eligibility: primary cardholder age twenty one to sixty five, add-on cardholder eighteen plus, resident of India, salaried or self-employed with income proof and serviceable city coverage.",
        keywords: ["eligibility", "eligible", "who can apply", "age", "resident", "india", "salaried", "self-employed", "income proof", "serviceable"]
      },
      {
        fact: "A CIBIL score of seven hundred fifty or above significantly improves approval chances for Kotak credit cards.",
        keywords: ["cibil", "credit score", "score", "approval chances", "approval", "seven hundred fifty", "750"]
      },
      {
        fact: "Domestic lounge access is available by presenting the physical Kotak Air Plus Credit Card, a valid boarding pass, and government ID; a two rupee validation charge applies.",
        keywords: ["domestic lounge access", "how to use lounge", "how to access lounge", "boarding pass", "government id", "validation charge", "two rupee", "2 rupee"]
      },
      {
        fact: "International lounge access is available by presenting the physical card or the digital QR code on the Priority Pass app, with international transactions enabled; a one dollar validation charge is auto-reversed.",
        keywords: ["international lounge access", "priority pass app", "priority pass qr", "digital qr", "international transactions enabled", "one dollar", "1 dollar", "auto reversed"]
      },
      {
        fact: "The card runs on a standard thirty day billing cycle, with payment due generally fifteen to twenty days after statement generation, payable via Kotak app, net banking, NEFT or auto-debit.",
        keywords: ["billing cycle", "payment due", "statement", "pay bill", "how to pay", "kotak app", "net banking", "neft", "auto debit"]
      },
      {
        fact: "Paying only the minimum amount due avoids late fees but the remaining balance attracts interest; missing payment entirely can hurt the CIBIL score.",
        keywords: ["minimum amount due", "mad", "late fee", "interest charges", "miss payment", "default", "cibil impact", "remaining balance"]
      }
    ],
    cta: "Apply now",
    constraintsToState: [
      "5% rewards applies to travel bookings made through Kotak Unbox.",
      "Joining fee INR 0 is limited period.",
      "Complimentary flight requires INR 1.5L spend in the quarter."
    ],
    avoidClaims: ["No guaranteed approvals or guarantees.", "No exaggeration like free flights anytime."],
    imageVibe:
      "believable travel-day utility with airport-adjacent movement, transfer pickup, business-trip arrival, hotel-entry mobility, and luggage-ready moments captured like ordinary premium phone footage rather than luxury campaign photography; use airport or departure cues only when the script specifically demands them",
    disclaimer:
      "T&C apply. 5% rewards via Kotak Unbox on travel bookings. Joining fee INR 0 for a limited period. Complimentary flight on INR 1.5L quarterly spend."
  },
  kotak_cashback: {
    positioning: "The Everyday Savings Accelerator",
    corePromise: "Turn routine monthly spends into visible cashback with simple, practical value people can actually feel.",
    socialTone: "Direct, useful, savings-smart, digitally native, everyday-urban rather than aspirational luxury.",
    audienceSummary:
      "Aspirational NCCS A/B Indians across top metro cities, typically age 21-40, primarily salaried with some self-employed users; value-driven, digitally active, savings-oriented, and focused on practical monthly spending control.",
    imageTreatment:
      "Image treatment should feel relatable, modern, and everyday-urban for Indian metro life: home-delivered grocery orders, food delivery moments, streaming downtime, commute or fuel stops, and practical household spending rather than luxury lifestyle signaling. Prefer apartment, entryway, kitchen, living-room, balcony, building lobby, commute, or fuel-stop contexts over retail stores, supermarkets, hardware stores, restaurants, cafes, hotels, or travel worlds.",
    voice: ["Confident and practical", "Savings-smart and clear", "Digitally active, deal-aware urban energy"],
    psychographics: [
      "Grounded and practical, with strong attention to day-to-day needs and financial control.",
      "Stability, affordability, and utility take priority over indulgence.",
      "Cautious decision-maker who values clarity, safety, and functional benefit.",
      "Comfortable with apps, offers, and digital commerce but still expects visible value from every spend."
    ],
    hooks: [
      "5% cashback on daily essentials.",
      "5% cashback on entertainment.",
      "5% cashback on online grocery and food delivery spends.",
      "Up to 4% fuel benefits.",
      "Limited-period first-year-free / zero-joining-fee style onboarding offer."
    ],
    supportingFacts: [
      {
        fact: "The card headline promise is up to 5% cashback on spends.",
        keywords: ["up to 5%", "up to five percent", "max cashback", "headline", "monthly savings"]
      },
      {
        fact: "Accelerated cashback includes 5% on online grocery and food delivery spends.",
        keywords: ["5% grocery", "5% groceries", "food delivery", "daily essentials", "instamart", "blinkit", "zepto", "swiggy", "zomato"]
      },
      {
        fact: "Accelerated cashback includes 5% on online entertainment spends.",
        keywords: ["5% entertainment", "online entertainment", "ott", "streaming", "movies", "subscriptions"]
      },
      {
        fact: "Fuel benefits combine 3% cashback on fuel spends with a 1% fuel surcharge waiver, allowing up to 4% total fuel benefit framing.",
        keywords: ["fuel", "4% fuel", "up to 4%", "3% cashback", "1% surcharge waiver", "petrol", "diesel"]
      },
      {
        fact: "The 1% fuel surcharge waiver applies on transactions between ₹500 and ₹4000, capped at ₹3500 in an anniversary year.",
        keywords: ["fuel surcharge waiver", "500", "4000", "3500", "anniversary year", "fuel cap"]
      },
      {
        fact: "Other eligible spends earn unlimited 0.5% cashback.",
        keywords: ["0.5%", "other spends", "eligible spends", "base cashback", "everyday spends"]
      },
      {
        fact: "For the RuPay variant, UPI on credit card spends earns unlimited 0.5% cashback, subject to the card's excluded MCC categories.",
        keywords: ["rupay", "upi", "upi on cc", "upi cashback", "0.5% upi", "merchant category code", "mcc"]
      },
      {
        fact: "Offline grocery, dining, and entertainment purchases earn only base cashback, not accelerated cashback.",
        keywords: ["offline grocery", "offline dining", "offline entertainment", "base cashback only", "not accelerated"]
      },
      {
        fact: "Accelerated cashback is capped at 750 points per billing cycle.",
        keywords: ["750 points", "billing cycle cap", "accelerated cap", "monthly cap", "cashback cap"]
      },
      {
        fact: "One reward point equals ₹1, and cashback can be redeemed only as cashback against statement outstanding.",
        keywords: ["1 point = 1 rupee", "redemption", "statement outstanding", "cashback redemption", "kotak rewards"]
      },
      {
        fact: "Kotak reward points are redeemed in multiples of 400, and unclaimed cashback expires after one year.",
        keywords: ["multiples of 400", "400 points", "expiry", "one year", "unclaimed cashback"]
      },
      {
        fact: "Cashback does not apply on rent, B2B transactions, utilities, insurance, education and government spends, wallet loads, online skill-based gaming, and EMI.",
        keywords: ["excluded categories", "rent", "utilities", "insurance", "education", "government", "wallet", "gaming", "emi"]
      },
      {
        fact: "Standard joining fee and annual fee are ₹750 plus GST each, while the annual fee is waived on annual retail spends of ₹2 lakh.",
        keywords: ["joining fee", "annual fee", "750", "gst", "2 lakh", "200000", "annual fee waiver"]
      },
      {
        fact: "Current marketing pages also promote a limited-time first-year-free offer, so zero joining fee style messaging should be treated as a promotional claim rather than a permanent fee fact.",
        keywords: ["first year free", "limited time", "zero joining fee", "0 joining fee", "promo", "limited period"]
      },
      {
        fact: "Entertainment-led value also includes a PVR INOX Buy 1 Get 1 movie offer, valid on digital bookings with a maximum discount of ₹250 per card per month, currently shown as valid till 31 March 2026.",
        keywords: ["pvr inox", "bogo", "buy 1 get 1", "movie offer", "250", "march 2026", "entertainment offer"]
      },
      {
        fact: "The published value chart models total annual benefit of ₹10,410 on annual spends of ₹2,16,000, including cashback and annual fee waiver assumptions.",
        keywords: ["value chart", "10410", "10,410", "216000", "2,16,000", "annual benefit"]
      },
      {
        fact: "The primary cardholder can hold up to three add-on cards, add-on cards are free, and add-on holders must be 18 years or older.",
        keywords: ["add-on", "addon", "supplementary", "3 add-on", "free add-on", "18 years"]
      }
    ],
    cta: "Apply now",
    constraintsToState: [
      "5% cashback applies to online grocery, food delivery, and online entertainment spends, not all spends.",
      "Use up to 4% for fuel only when combining 3% fuel cashback with 1% fuel surcharge waiver.",
      "Zero joining fee / first year free must be treated as a limited-period promotional message, not a permanent fee fact.",
      "Accelerated cashback is capped at 750 points per billing cycle."
    ],
    avoidClaims: [
      "No cashback on everything claims.",
      "No permanent zero joining fee claim without calling it limited-period or promotional.",
      "Do not say flat 4% fuel cashback; official structure is 3% cashback plus 1% surcharge waiver.",
      "No guaranteed savings language."
    ],
    imageVibe:
      "practical metro India with app-native spending behavior: delivery arrivals, home restock moments, streaming downtime, fuel stop, salary-life utility, and clear everyday value rather than premium-travel aspiration; avoid in-store shopping aisles, storefronts, coffee shops, restaurant interiors, and hospitality environments unless the brief explicitly requires them",
    disclaimer:
      "T&C apply. 5% cashback on online grocery, food delivery and entertainment, 3% cashback on fuel plus 1% surcharge waiver, 0.5% on other eligible spends. First-year-free / zero-joining-fee messaging is limited-period promotional."
  }
};

export const META_FORMAT = {
  platform: "Meta",
  aspectRatio: "9:16",
  durationSeconds: 8,
  resolution: "1080p",
  output: "mp4"
} as const;
