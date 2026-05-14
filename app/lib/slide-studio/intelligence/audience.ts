import "server-only";

import { AudienceProfile, PresentationIntent, ProjectRecord } from "@/app/lib/slide-studio/types";
import { extractKeywords, sentenceCase } from "@/app/lib/slide-studio/services/text-utils";

function inferSeniority(value: string): AudienceProfile["seniority"] {
  const text = value.toLowerCase();
  if (/(ceo|cfo|cto|board|founder|executive|vp|chief)/.test(text)) {
    return "executive";
  }
  if (/(manager|director|lead|head)/.test(text)) {
    return "manager";
  }
  if (/(team|operator|specialist|analyst|ic|individual contributor)/.test(text)) {
    return "operator";
  }
  return "mixed";
}

function defaultAudienceLabel(intent: PresentationIntent): string {
  switch (intent.purpose) {
    case "pitching":
      return "Investors and senior stakeholders";
    case "reporting":
      return "Leaders reviewing current performance";
    case "strategy":
      return "Decision-makers responsible for direction and tradeoffs";
    case "internal_review":
      return "Internal team stakeholders";
    case "marketing":
      return "Marketing leads and cross-functional launch partners";
    case "sales":
      return "Buyer-side commercial decision-makers";
    case "education":
      return "Learners who need a clear, guided explanation";
    case "planning":
      return "Owners of execution and delivery";
    default:
      return "Mixed business audience";
  }
}

function inferPriorities(intent: PresentationIntent, seniority: AudienceProfile["seniority"]): string[] {
  const common = seniority === "executive" ? ["Decision clarity", "Speed to insight"] : ["Operational clarity", "Useful detail"];
  switch (intent.purpose) {
    case "pitching":
      return [...common, "Opportunity size", "Differentiation", "Confidence in upside"];
    case "reporting":
      return [...common, "Performance drivers", "Risks and blockers", "Recommended actions"];
    case "strategy":
      return [...common, "Strategic options", "Tradeoffs", "Recommended path"];
    case "marketing":
      return [...common, "Audience resonance", "Message sharpness", "Launch readiness"];
    case "sales":
      return [...common, "Buyer pain", "Proof of fit", "Next-step momentum"];
    case "education":
      return [...common, "Clarity", "Progressive learning", "Retention"];
    case "planning":
      return [...common, "Sequencing", "Ownership", "Dependencies"];
    default:
      return [...common, "Clarity", "Credibility", "Actionability"];
  }
}

function inferConcerns(intent: PresentationIntent): string[] {
  switch (intent.purpose) {
    case "pitching":
      return ["Is this a meaningful opportunity?", "What is believable versus speculative?"];
    case "reporting":
      return ["What changed?", "Where do we need intervention?"];
    case "strategy":
      return ["Why this path over alternatives?", "What assumptions are carrying the argument?"];
    case "marketing":
      return ["Will the message land with the target customer?", "Is the market context credible?"];
    case "sales":
      return ["Why switch now?", "What makes this solution credible?"];
    case "education":
      return ["Is the explanation digestible?", "What should the audience remember?"];
    case "planning":
      return ["What happens first?", "What risks can derail execution?"];
    default:
      return ["What matters most?", "What should happen next?"];
  }
}

export function inferAudienceProfile(project: ProjectRecord, intent: PresentationIntent): AudienceProfile {
  const audienceLabel = project.audience.trim() || defaultAudienceLabel(intent);
  const seniority = inferSeniority(audienceLabel);
  const keywords = extractKeywords(`${audienceLabel} ${project.prompt}`, 4).map((item) => sentenceCase(item));
  const priorities = inferPriorities(intent, seniority);
  const concerns = inferConcerns(intent);

  if (keywords.length > 0) {
    priorities.unshift(...keywords.slice(0, 2));
  }

  return {
    audienceLabel,
    inferred: !project.audience.trim(),
    seniority,
    priorities: [...new Set(priorities)].slice(0, 5),
    concerns,
    preferredDetailLevel:
      seniority === "executive" ? "high_level" : intent.purpose === "education" ? "detailed" : "balanced",
    recommendedTone: project.tone.trim() || (seniority === "executive" ? "Concise, confident, decision-oriented" : "Clear, grounded, practical")
  };
}
