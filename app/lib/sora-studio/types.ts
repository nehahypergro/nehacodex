export type SoraStudioJobStatus = "queued" | "running" | "completed" | "failed";
export type SoraStudioStepStatus = "pending" | "running" | "completed" | "failed";
export type SoraStudioStepId = "script_generation" | "prompt_generation" | "video_render";
export type SoraStudioRenderModelKey = "sora2" | "seedance2" | "klingv3";
export type SoraStudioRenderModelStatus = "pending" | "running" | "completed" | "failed";
export type SoraStudioStarRating = 1 | 2 | 3 | 4 | 5;
export type SoraStudioBriefAttachmentType = "image" | "video";
export type SoraStudioBriefAttachmentSource = "upload" | "url";

export type SoraStudioAspectRatio = "9:16" | "1:1" | "16:9";
export type SoraStudioRenderAspectRatio = "9:16" | "16:9";

export interface SoraStudioBriefAttachment {
  id?: string;
  name: string;
  mediaType: SoraStudioBriefAttachmentType;
  source: SoraStudioBriefAttachmentSource;
  url: string;
  mimeType?: string;
}

export interface SoraStudioInputRow {
  rowNumber: number;
  product: string;
  brief: string;
  businessObjective: string;
  creativeObjectiveFunnel: string;
  videoDuration: string;
  ratioDimensions: string;
  language: string;
  notificationEmail?: string;
  strictParityMode?: boolean;
  briefAttachments?: SoraStudioBriefAttachment[];
}

export interface SoraStudioResolvedInputRow extends SoraStudioInputRow {
  requestedDurationSeconds: number;
  requestDurationSeconds: 4 | 8 | 12 | 16 | 20;
  requestedAspectRatio: SoraStudioAspectRatio;
  renderAspectRatio: SoraStudioRenderAspectRatio;
  resolvedLanguage: string;
  strictParityMode: boolean;
  warnings: string[];
}

export interface SoraStudioVariantFeedback {
  rating?: SoraStudioStarRating;
  comment?: string;
  updatedAt?: string;
}

export interface SoraStudioFeedback {
  overallComment?: string;
  updatedAt?: string;
  variants?: Partial<Record<SoraStudioRenderModelKey, SoraStudioVariantFeedback>>;
}

export interface SoraStudioRenderPostProcess {
  applied: boolean;
  profileKey: string;
  profileLabel: string;
  rawAssetFile?: string;
  outputAssetFile?: string;
  logoFile?: string;
  endSlateFile?: string;
  warnings?: string[];
}

export interface SoraStudioJobRecord {
  id: string;
  status: SoraStudioJobStatus;
  createdAt: string;
  updatedAt: string;
  input: SoraStudioResolvedInputRow;
  compactedBrief?: string;
  scriptWriterPrompt?: string;
  renderPromptUsed?: string;
  renderPromptSource?: "raw_sora_prompt" | "compacted_sora_prompt" | "script_fallback_prompt";
  renderPromptOriginalChars?: number;
  renderPromptFinalChars?: number;
  feedback?: SoraStudioFeedback;
  script: string;
  soraPrompt: string;
  modelOptimizedPrompts?: Partial<
    Record<
      SoraStudioRenderModelKey,
      {
        provider: string;
        model: string;
        basePromptChars: number;
        optimizedPromptChars: number;
        dialogueLinesLocked: number;
        prompt: string;
        warnings?: string[];
      }
    >
  >;
  warnings: string[];
  steps: Array<{
    id: SoraStudioStepId;
    label: string;
    status: SoraStudioStepStatus;
    provider?: string;
    model?: string;
    operationName?: string;
    message?: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
  }>;
  error?: string;
  operationName?: string;
  renders?: Array<{
    key: SoraStudioRenderModelKey;
    label: string;
    endpoint: string;
    status: SoraStudioRenderModelStatus;
    requestId?: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
    durationSeconds?: number;
    audioEnabled?: boolean;
    inputSummary?: Record<string, unknown>;
    outputSummary?: Record<string, unknown>;
    assetFile?: string;
    assetUrl?: string;
    postProcess?: SoraStudioRenderPostProcess;
  }>;
  emailNotifications?: Partial<
    Record<
      SoraStudioRenderModelKey,
      {
        toEmail: string;
        sentAt?: string;
        assetFile?: string;
        videoUrl?: string;
        error?: string;
      }
    >
  >;
  assets: {
    inputJson: string;
    jobJson: string;
    debugLog?: string;
    rawMp4?: string;
    finalMp4?: string;
    sora2Mp4?: string;
    seedance2Mp4?: string;
    klingv3Mp4?: string;
    renderManifestJson?: string;
  };
}

export interface SoraStudioClientJob extends Omit<SoraStudioJobRecord, "assets"> {
  assets: SoraStudioJobRecord["assets"] & {
    inputJsonUrl: string;
    jobJsonUrl: string;
    debugLogUrl?: string;
    rawMp4Url?: string;
    finalMp4Url?: string;
    sora2Mp4Url?: string;
    seedance2Mp4Url?: string;
    klingv3Mp4Url?: string;
    renderManifestJsonUrl?: string;
  };
}

export interface SoraStudioJobCreateInput {
  input: SoraStudioResolvedInputRow;
  compactedBrief?: string;
  scriptWriterPrompt?: string;
  script: string;
  soraPrompt: string;
  scriptModel: string;
  promptModel: string;
  warnings?: string[];
}
