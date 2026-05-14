import "server-only";

import { classifyDeckType } from "@/app/lib/slide-studio/intelligence/deck-classifier";
import { CommunicationStyle, PresentationIntent, PresentationPurpose, ProjectRecord } from "@/app/lib/slide-studio/types";
import { extractKeywords, normalizeWhitespace, sentenceCase, truncateText } from "@/app/lib/slide-studio/services/text-utils";

const PURPOSE_PATTERNS: Array<{ purpose: PresentationPurpose; patterns: string[] }> = [
  { purpose: "pitching", patterns: ["pitch", "investor", "fundraise", "fundraising", "raise", "venture"] },
  { purpose: "reporting", patterns: ["report", "qbr", "review", "performance", "results", "status update"] },
  { purpose: "strategy", patterns: ["strategy", "strategic", "direction", "plan", "option", "recommendation"] },
  { purpose: "internal_review", patterns: ["internal", "team", "org", "operating review", "staff"] },
  { purpose: "marketing", patterns: ["campaign", "brand", "positioning", "launch", "messaging", "market"] },
  { purpose: "sales", patterns: ["sales", "buyer", "prospect", "deal", "pipeline", "proposal"] },
  { purpose: "education", patterns: ["learn", "teach", "training", "workshop", "course", "explainer"] },
  { purpose: "planning", patterns: ["roadmap", "timeline", "planning", "execution", "implementation"] }
];

const INDUSTRY_PATTERNS: Array<{ label: string; patterns: string[] }> = [
  { label: "Fintech", patterns: ["fintech", "bank", "payments", "insurance", "lending"] },
  { label: "SaaS", patterns: ["saas", "software", "platform", "b2b", "subscription"] },
  { label: "Healthcare", patterns: ["health", "hospital", "medical", "patient", "clinical"] },
  { label: "E-commerce", patterns: ["ecommerce", "retail", "marketplace", "shopping", "consumer"] },
  { label: "Education", patterns: ["education", "school", "student", "learning", "curriculum"] },
  { label: "AI", patterns: ["ai", "artificial intelligence", "machine learning", "llm", "agent"] }
];

function inferPurpose(project: ProjectRecord): PresentationPurpose {
  const text = `${project.title} ${project.prompt} ${project.audience} ${project.tone}`.toLowerCase();
  for (const rule of PURPOSE_PATTERNS) {
    if (rule.patterns.some((pattern) => text.includes(pattern))) {
      return rule.purpose;
    }
  }
  return "strategy";
}

function inferTopic(project: ProjectRecord): string {
  const title = normalizeWhitespace(project.title);
  if (title) {
    return title;
  }

  const keywords = extractKeywords(project.prompt, 4);
  if (keywords.length > 0) {
    return sentenceCase(keywords.join(" "));
  }

  return "Presentation topic";
}

function inferCommunicationStyle(project: ProjectRecord, purpose: PresentationPurpose): CommunicationStyle {
  const text = `${project.prompt} ${project.tone} ${project.audience}`.toLowerCase();
  if (text.includes("board") || text.includes("executive") || text.includes("concise")) {
    return "executive";
  }
  if (text.includes("teach") || text.includes("training") || purpose === "education") {
    return "instructional";
  }
  if (text.includes("sell") || text.includes("pitch") || purpose === "sales" || purpose === "pitching") {
    return "persuasive";
  }
  if (text.includes("analysis") || text.includes("metrics") || purpose === "reporting") {
    return "analytical";
  }
  return "collaborative";
}

function inferDesiredOutcome(purpose: PresentationPurpose): string {
  switch (purpose) {
    case "pitching":
      return "Secure confidence, attention, and next-step commitment.";
    case "reporting":
      return "Clarify what happened, why it matters, and what should change next.";
    case "strategy":
      return "Drive alignment around a recommended path and the logic behind it.";
    case "internal_review":
      return "Align the team on status, blockers, and ownership.";
    case "marketing":
      return "Sharpen positioning and build conviction around the go-to-market story.";
    case "sales":
      return "Move a buyer toward action with a credible, differentiated argument.";
    case "education":
      return "Improve understanding through structured explanation and progression.";
    case "planning":
      return "Turn a vague objective into a sequenced execution plan.";
    default:
      return "Help the audience leave with a clear decision or takeaway.";
  }
}

function inferIndustry(project: ProjectRecord): string | undefined {
  const text = `${project.title} ${project.prompt}`.toLowerCase();
  const match = INDUSTRY_PATTERNS.find((entry) => entry.patterns.some((pattern) => text.includes(pattern)));
  return match?.label;
}

export function extractPresentationIntent(project: ProjectRecord): PresentationIntent {
  const purpose = inferPurpose(project);
  const deckType = classifyDeckType({
    purpose,
    prompt: project.prompt,
    audience: project.audience
  });
  const communicationStyle = inferCommunicationStyle(project, purpose);
  const topic = inferTopic(project);
  const audienceSignals = extractKeywords(`${project.audience} ${project.prompt}`, 6);
  const primaryGoal = truncateText(
    normalizeWhitespace(project.prompt) || `Explain why ${topic} matters and what should happen next.`,
    180
  );
  const desiredOutcome = inferDesiredOutcome(purpose);
  const inferredIndustry = inferIndustry(project);

  return {
    topic,
    purpose,
    deckType,
    primaryGoal,
    audienceSignals,
    communicationStyle,
    desiredOutcome,
    inferredIndustry,
    structuredBrief: [
      `Topic: ${topic}.`,
      `Purpose: ${purpose.replace(/_/g, " ")}.`,
      `Deck type: ${deckType.replace(/_/g, " ")}.`,
      `Audience: ${project.audience || "Inferred audience based on prompt context."}`,
      `Tone: ${project.tone || "Use the audience-appropriate default tone."}`,
      `Goal: ${primaryGoal}`,
      `Desired outcome: ${desiredOutcome}`
    ].join(" ")
  };
}
