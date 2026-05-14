import "server-only";

import { CitationPlaceholder, EvidenceKind, SourceRecord } from "@/app/lib/slide-studio/types";
import { overlapScore, summarizeText } from "@/app/lib/slide-studio/services/text-utils";

function inferEvidenceKind(source: SourceRecord, score: number): EvidenceKind {
  if (score >= 0.12 && source.extractedText.trim()) {
    return source.kind === "upload" || Boolean(source.url) ? "source_backed" : "inference";
  }
  if (source.kind === "prompt") {
    return "inference";
  }
  return "speculative";
}

function inferConfidence(score: number): CitationPlaceholder["confidence"] {
  if (score >= 0.18) {
    return "high";
  }
  if (score >= 0.08) {
    return "medium";
  }
  return "low";
}

export function buildSlideCitations(args: {
  slideTitle: string;
  objective: string;
  bullets: string[];
  sources: SourceRecord[];
}): CitationPlaceholder[] {
  const haystack = [args.slideTitle, args.objective, ...args.bullets].join(" ");
  const ranked = args.sources
    .map((source) => ({
      source,
      score: overlapScore(haystack, `${source.title} ${source.extractedText}`)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .filter((entry) => entry.score > 0);

  if (ranked.length === 0) {
    return [
      {
        sourceTitle: "Assumption-driven narrative planning",
        confidence: "low",
        evidenceKind: "speculative",
        claim: "No close source match was found, so this slide should be reviewed as a structured inference."
      }
    ];
  }

  return ranked.map(({ source, score }) => ({
    sourceId: source.id,
    sourceTitle: source.title,
    url: source.url,
    confidence: inferConfidence(score),
    evidenceKind: inferEvidenceKind(source, score),
    claim: summarizeText(source.extractedText || source.title, 180)
  }));
}
