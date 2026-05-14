import { DeckStepId, DeckTemplateId } from "@/app/lib/hypergro/types";

export const DECK_STEP_LABELS: Record<DeckStepId, string> = {
  strategy: "Strategy Agent",
  visual: "Nano Banana Pro Visual Agent",
  slides: "Google Slides Renderer"
};

export const TEMPLATE_SEQUENCE: DeckTemplateId[] = [
  "cover",
  "executive_summary",
  "market_opportunity",
  "pain_points",
  "hypergro_edge",
  "service_stack",
  "proof_points",
  "execution_roadmap",
  "closing"
];

export const TEMPLATE_LABELS: Record<DeckTemplateId, string> = {
  cover: "Cover",
  executive_summary: "Executive Summary",
  market_opportunity: "Market Opportunity",
  pain_points: "Client Pain Points",
  hypergro_edge: "Why Hypergro",
  service_stack: "Service Stack",
  proof_points: "Proof Points",
  execution_roadmap: "Execution Roadmap",
  closing: "Closing"
};

export const TEMPLATE_BRIEFS: Record<DeckTemplateId, string> = {
  cover: "Open with a sharp boardroom headline and a premium commercial tone.",
  executive_summary: "Summarize the decision case in plain executive language with three headline metrics.",
  market_opportunity: "Frame the market shift and why the timing is attractive right now.",
  pain_points: "Diagnose the core issues senior growth leaders feel when execution fragments.",
  hypergro_edge: "Explain why Hypergro is structurally differentiated versus agencies or fragmented vendors.",
  service_stack: "Translate Hypergro's offering into clear workstreams with measurable outcomes.",
  proof_points: "Show evidence, benchmarks, or directional outcomes without inventing client facts.",
  execution_roadmap: "Lay out a phased commercial plan with owners, actions, and momentum.",
  closing: "End with a crisp call to action and next-step pilot framing."
};

export const DECK_THEME = {
  navy: "#0E1A2B",
  ink: "#18212F",
  sand: "#F4EFE7",
  paper: "#FBF8F2",
  mist: "#E7EDF5",
  coral: "#FF7B54",
  teal: "#1F9E93",
  gold: "#C3A35B",
  slate: "#5C6677",
  white: "#FFFFFF"
} as const;
