export type DeckJobStatus = "queued" | "running" | "completed" | "failed";

export type DeckStepId = "strategy" | "visual" | "slides";
export type DeckStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type DeckTemplateId =
  | "cover"
  | "executive_summary"
  | "market_opportunity"
  | "pain_points"
  | "hypergro_edge"
  | "service_stack"
  | "proof_points"
  | "execution_roadmap"
  | "closing";

export interface DeckMetric {
  label: string;
  value: string;
  insight: string;
}

export interface DeckColumn {
  title: string;
  body: string;
  bullets: string[];
}

export interface DeckTimelineItem {
  phase: string;
  title: string;
  actions: string[];
}

export interface DeckSlide {
  templateId: DeckTemplateId;
  kicker: string;
  title: string;
  headline: string;
  summary: string;
  bullets: string[];
  metrics: DeckMetric[];
  columns: DeckColumn[];
  timeline: DeckTimelineItem[];
  callout: string;
  cta: string;
  speakerNote: string;
}

export interface DeckDocument {
  title: string;
  subtitle: string;
  audience: string;
  objective: string;
  thesis: string;
  visualDirection: string;
  heroPrompt: string;
  slides: DeckSlide[];
}

export interface DeckSourceFileMeta {
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface DeckInput {
  brief?: string;
  sampleDeckText?: string;
  styleNotes?: string;
  sampleFile?: DeckSourceFileMeta;
}

export interface DeckJobStep {
  id: DeckStepId;
  label: string;
  status: DeckStepStatus;
  message?: string;
}

export interface SlidesRenderInfo {
  status: "created" | "skipped";
  presentationId?: string;
  presentationUrl?: string;
  folderUrl?: string;
  message?: string;
}

export interface DeckJobAssets {
  inputJson: string;
  deckJson?: string;
  heroPng?: string;
  slidesJson?: string;
}

export interface DeckJobRecord {
  id: string;
  status: DeckJobStatus;
  createdAt: string;
  updatedAt: string;
  input: DeckInput;
  steps: DeckJobStep[];
  deck?: DeckDocument;
  assets: DeckJobAssets;
  slides: SlidesRenderInfo;
  warnings: string[];
  error?: string;
}

export interface DeckClientJob extends Omit<DeckJobRecord, "assets"> {
  assets: {
    inputJsonUrl: string;
    deckJsonUrl?: string;
    heroImageUrl?: string;
    slidesJsonUrl?: string;
  };
}

export interface DeckRuntimeStatus {
  geminiConfigured: boolean;
  slidesConfigured: boolean;
}
