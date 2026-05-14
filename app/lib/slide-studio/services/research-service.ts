import "server-only";

import { PresentationIntent, ProjectRecord, SourceKind } from "@/app/lib/slide-studio/types";

export interface NormalizedResearchSource {
  kind: SourceKind;
  title: string;
  url?: string;
  mimeType?: string;
  extractedText: string;
  metadata?: Record<string, unknown>;
}

export interface ResearchService {
  fetchRelevantSources(input: {
    project: ProjectRecord;
    intent: PresentationIntent;
    localSourceText: string;
  }): Promise<NormalizedResearchSource[]>;
}

class StubResearchService implements ResearchService {
  async fetchRelevantSources(): Promise<NormalizedResearchSource[]> {
    return [];
  }
}

let singleton: ResearchService | null = null;

export function getResearchService(): ResearchService {
  if (!singleton) {
    singleton = new StubResearchService();
  }
  return singleton;
}
