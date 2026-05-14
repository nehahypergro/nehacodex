import "server-only";

import { DeckType, PresentationPurpose } from "@/app/lib/slide-studio/types";

function hasAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

export function classifyDeckType(args: {
  purpose: PresentationPurpose;
  prompt: string;
  audience: string;
}): DeckType {
  const text = `${args.prompt} ${args.audience}`.toLowerCase();

  if (hasAny(text, ["launch", "go to market", "gtm", "campaign rollout"])) {
    return "launch_plan";
  }

  if (hasAny(text, ["case study", "customer story", "success story"])) {
    return "case_study";
  }

  if (hasAny(text, ["proposal", "recommendation memo", "scope of work"])) {
    return "proposal";
  }

  if (hasAny(text, ["roadmap", "planning", "quarter plan", "next steps"])) {
    return "roadmap_deck";
  }

  if (hasAny(text, ["education", "teach", "training", "explainer", "lesson"])) {
    return "educational_explainer";
  }

  if (hasAny(text, ["qbr", "review", "performance", "quarterly business review", "metrics review"])) {
    return "performance_review";
  }

  if (hasAny(text, ["sales", "buyer", "prospect", "deal", "pipeline"])) {
    return "sales_deck";
  }

  if (hasAny(text, ["internal review", "team update", "operating review", "status review"])) {
    return "internal_review_deck";
  }

  switch (args.purpose) {
    case "pitching":
      return "pitch_deck";
    case "reporting":
      return "performance_review";
    case "strategy":
      return "strategy_deck";
    case "internal_review":
      return "internal_review_deck";
    case "marketing":
      return "launch_plan";
    case "sales":
      return "sales_deck";
    case "education":
      return "educational_explainer";
    case "planning":
      return "roadmap_deck";
    default:
      return "strategy_deck";
  }
}
