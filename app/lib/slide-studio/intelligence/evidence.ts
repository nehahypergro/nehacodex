import "server-only";

import { EvidenceItem, EvidenceKind, EvidenceMap, SourceRecord } from "@/app/lib/slide-studio/types";
import { summarizeText } from "@/app/lib/slide-studio/services/text-utils";

function inferEvidenceKind(source: SourceRecord): EvidenceKind {
  if (source.kind === "upload" && source.extractedText.trim()) {
    return "source_backed";
  }
  if (source.url?.trim()) {
    return "source_backed";
  }
  if (source.kind === "prompt") {
    return "inference";
  }
  return "speculative";
}

function inferConfidence(source: SourceRecord): EvidenceItem["confidence"] {
  const textLength = source.extractedText.trim().length;
  if (inferEvidenceKind(source) === "source_backed" && textLength > 500) {
    return "high";
  }
  if (textLength > 120) {
    return "medium";
  }
  return "low";
}

export function buildEvidenceMap(sources: SourceRecord[]): EvidenceMap {
  const items: EvidenceItem[] = sources.map((source) => ({
    sourceId: source.id,
    title: source.title,
    url: source.url,
    snippet: summarizeText(source.extractedText || source.title, 260),
    confidence: inferConfidence(source),
    evidenceKind: inferEvidenceKind(source)
  }));

  const sourceBackedCount = items.filter((item) => item.evidenceKind === "source_backed").length;
  const overallConfidence: EvidenceMap["overallConfidence"] =
    sourceBackedCount >= 2 ? "high" : sourceBackedCount === 1 || items.length >= 2 ? "medium" : "low";

  const gaps: string[] = [];
  if (sourceBackedCount === 0) {
    gaps.push("No extracted external evidence is available yet, so factual claims should stay soft.");
  }
  if (items.every((item) => !item.url)) {
    gaps.push("Sources do not currently include URL-level provenance for later citation export.");
  }
  if (items.length < 2) {
    gaps.push("Research coverage is thin; use structure and assumptions carefully.");
  }

  return {
    overallConfidence,
    sourceCount: items.length,
    strengthSummary:
      sourceBackedCount > 0
        ? `${sourceBackedCount} source-backed input${sourceBackedCount === 1 ? "" : "s"} plus the user brief are available.`
        : "The deck is primarily relying on the user's brief and local assumptions.",
    gaps,
    items
  };
}
