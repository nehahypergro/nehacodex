export type PresentationPurpose =
  | "pitching"
  | "reporting"
  | "strategy"
  | "internal_review"
  | "marketing"
  | "sales"
  | "education"
  | "planning";

export type DeckType =
  | "pitch_deck"
  | "strategy_deck"
  | "performance_review"
  | "launch_plan"
  | "case_study"
  | "proposal"
  | "educational_explainer"
  | "sales_deck"
  | "internal_review_deck"
  | "roadmap_deck";

export type CommunicationStyle = "executive" | "persuasive" | "analytical" | "instructional" | "collaborative";

export type ProjectStatus = "draft" | "outline_ready" | "outline_approved" | "slides_ready";
export type OutlineStatus = "draft" | "approved";
export type SourceKind = "prompt" | "upload" | "research_stub";
export type EvidenceKind = "source_backed" | "inference" | "speculative";
export type CitationConfidence = "high" | "medium" | "low";
export type ExportFormat = "json";

export type SupportedSlideType =
  | "title"
  | "agenda"
  | "problem"
  | "market/context"
  | "comparison"
  | "process/how-it-works"
  | "metrics/KPI"
  | "recommendation"
  | "roadmap"
  | "closing";

export type LayoutVariant = "hero" | "standard" | "twoColumn" | "kpiTiles" | "timeline";

export interface ProjectRecord {
  id: string;
  title: string;
  prompt: string;
  audience: string;
  tone: string;
  targetSlideCount: number;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SourceRecord {
  id: string;
  projectId: string;
  kind: SourceKind;
  name?: string;
  title: string;
  url?: string;
  mimeType?: string;
  extractedText: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PresentationIntent {
  topic: string;
  purpose: PresentationPurpose;
  deckType: DeckType;
  primaryGoal: string;
  audienceSignals: string[];
  communicationStyle: CommunicationStyle;
  desiredOutcome: string;
  inferredIndustry?: string;
  structuredBrief: string;
}

export interface AudienceProfile {
  audienceLabel: string;
  inferred: boolean;
  seniority: "executive" | "manager" | "operator" | "mixed";
  priorities: string[];
  concerns: string[];
  preferredDetailLevel: "high_level" | "balanced" | "detailed";
  recommendedTone: string;
}

export interface AssumptionItem {
  id: string;
  label: string;
  value: string;
  confidence: CitationConfidence;
  rationale: string;
}

export interface AssumptionLog {
  summary: string;
  items: AssumptionItem[];
}

export interface EvidenceItem {
  sourceId: string;
  title: string;
  url?: string;
  snippet: string;
  confidence: CitationConfidence;
  evidenceKind: EvidenceKind;
}

export interface EvidenceMap {
  overallConfidence: CitationConfidence;
  sourceCount: number;
  strengthSummary: string;
  gaps: string[];
  items: EvidenceItem[];
}

export interface NarrativeSection {
  id: string;
  label: string;
  objective: string;
  audienceNeed: string;
}

export interface NarrativePlan {
  story: string;
  takeaway: string;
  audienceCareAbout: string[];
  informationGaps: string[];
  sectionPlan: NarrativeSection[];
}

export interface SlideBlueprint {
  slideIndex: number;
  slideType: SupportedSlideType;
  purpose: string;
  keyQuestion: string;
  narrativeRole: string;
}

export interface DeckStrategy {
  deckType: DeckType;
  structureLabel: string;
  rationale: string;
  sequence: SlideBlueprint[];
}

export interface ProjectReasoningRecord {
  projectId: string;
  intent: PresentationIntent;
  audienceProfile: AudienceProfile;
  assumptionLog: AssumptionLog;
  narrativePlan: NarrativePlan;
  deckStrategy: DeckStrategy;
  evidenceMap: EvidenceMap;
  createdAt: string;
  updatedAt: string;
}

export interface OutlineSlide {
  id: string;
  slideIndex: number;
  slideTitle: string;
  slideObjective: string;
  keyBullets: string[];
  recommendedSlideType: SupportedSlideType;
  narrativeRole: string;
}

export interface OutlineRecord {
  id: string;
  projectId: string;
  version: number;
  status: OutlineStatus;
  slides: OutlineSlide[];
  createdAt: string;
  updatedAt: string;
}

export interface CitationPlaceholder {
  sourceId?: string;
  sourceTitle: string;
  url?: string;
  confidence: CitationConfidence;
  evidenceKind: EvidenceKind;
  claim: string;
}

export interface LayoutProps {
  variant: LayoutVariant;
  columnCount: number;
  emphasis: "context" | "proof" | "decision" | "summary";
  bulletStyle: "plain" | "checklist" | "metric" | "timeline";
}

export interface SlideRecord {
  id: string;
  projectId: string;
  slideIndex: number;
  slideType: SupportedSlideType;
  title: string;
  objective: string;
  bullets: string[];
  speakerNotes: string;
  visualInstructions: string;
  layoutProps: LayoutProps;
  citations: CitationPlaceholder[];
  createdAt: string;
  updatedAt: string;
}

export interface ExportRecord {
  id: string;
  projectId: string;
  format: ExportFormat;
  filePath: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ProjectBundle {
  project: ProjectRecord;
  sources: SourceRecord[];
  reasoning: ProjectReasoningRecord | null;
  outline: OutlineRecord | null;
  slides: SlideRecord[];
  exports: ExportRecord[];
}

export interface CreateProjectInput {
  title: string;
  prompt: string;
  audience?: string;
  tone?: string;
  targetSlideCount: number;
}

export interface CreateSourceInput {
  projectId: string;
  kind: SourceKind;
  name?: string;
  title: string;
  url?: string;
  mimeType?: string;
  extractedText: string;
  metadata?: Record<string, unknown>;
}

export interface SaveOutlineInput {
  projectId: string;
  status: OutlineStatus;
  slides: OutlineSlide[];
}

export interface SaveExportInput {
  projectId: string;
  format: ExportFormat;
  filePath: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateProjectInput {
  title?: string;
  prompt?: string;
  audience?: string;
  tone?: string;
  targetSlideCount?: number;
  status?: ProjectStatus;
}

export interface UpdateSlideInput {
  title?: string;
  objective?: string;
  bullets?: string[];
  speakerNotes?: string;
  visualInstructions?: string;
  layoutProps?: LayoutProps;
  citations?: CitationPlaceholder[];
}

export interface RuntimeCapabilities {
  geminiConfigured: boolean;
  storageRoot: string;
  databasePath: string;
}
