export type ProductKey = "kotak_air_plus" | "kotak_cashback";

export const VIDEO_TYPES = [
  "point_to_camera",
  "point_to_camera_multi_scene",
  "montage",
  "features_half_half",
  "how_to_video"
] as const;

export type VideoType = (typeof VIDEO_TYPES)[number];

export const VIDEO_PROVIDERS = ["sora", "veo31_standard", "sora_i2v"] as const;

export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];
export type ActiveRunProvider = "sora" | "veo31_standard";

export const PROMPT_WRITER_VERSIONS = ["prompt1", "prompt2", "prompt3"] as const;

export type PromptWriterVersion = (typeof PROMPT_WRITER_VERSIONS)[number];

export const DEFAULT_PROMPT_WRITER_VERSION: PromptWriterVersion = "prompt3";

export const BUMPER_VIDEO_TYPES = ["point_to_camera", "point_to_camera_multi_scene"] as const;

export function isBumperVideoType(videoType: VideoType): boolean {
  return videoType === "point_to_camera" || videoType === "point_to_camera_multi_scene";
}

export function normalizeVideoTypeForGeneration(videoType: VideoType): VideoType {
  if (isBumperVideoType(videoType)) {
    return "point_to_camera_multi_scene";
  }
  return videoType;
}

export const VIDEO_DURATIONS = [8, 15, 20] as const;

export type VideoDurationSeconds = number;

export interface VideoConfig {
  type: VideoType;
  durationSeconds: VideoDurationSeconds;
  provider: VideoProvider;
}

export const DEFAULT_VIDEO_CONFIG: VideoConfig = {
  type: "point_to_camera_multi_scene",
  durationSeconds: 8,
  provider: "sora"
};

export type StepId = "backstory" | "keyframe" | "video" | "finalize";

export type StepStatus = "pending" | "running" | "completed" | "failed";

export type JobStatus = "queued" | "running" | "completed" | "failed";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "partial_failed";

export type SupersTimingMode = "fast" | "accurate";

export type SupersTemplate = "bottom_urgency" | "super1" | "super2";

export interface HowToConfig {
  stepsText: string;
  screengrabFiles: string[];
}

export interface SupersTriggerRule {
  triggerWord: string;
  text: string;
  holdSeconds?: number;
}

export interface SupersConfig {
  enabled: boolean;
  timingMode: SupersTimingMode;
  template: SupersTemplate;
  rules: SupersTriggerRule[];
}

export interface Backstory {
  persona_name: string;
  gender_presentation: string;
  age_range: string;
  city: string;
  profession: string;
  why_they_care: string;
  facial_features: string;
  hairstyle_grooming: string;
  wardrobe_details: string;
  posture_body_language: string;
  expression_style: string;
  speaking_energy: string;
  body_build: string;
  speaking_style: string[];
  wardrobe_props: string[];
  setting: string;
  compliance_notes: string[];
}

export interface JobStep {
  id: StepId;
  label: string;
  status: StepStatus;
  message?: string;
}

export interface JobAssets {
  inputJson: string;
  backstoryJson: string;
  keyframePng?: string;
  rawMp4?: string;
  qcJson?: string;
  finalMp4?: string;
  howToStepMp4s?: string[];
  adaptSquareMp4?: string;
  adaptLandscapeMp4?: string;
}

export interface EmailDeliveryConfig {
  provider: "gmail";
  mailbox: string;
  fromEmail: string;
  fromName?: string;
  originalSubject: string;
  threadId: string;
  gmailMessageId: string;
  internetMessageId?: string;
  replySentAt?: string;
  replyError?: string;
}

export interface JobRecord {
  id: string;
  runToken?: string;
  product: ProductKey;
  script: string;
  soraPrompt?: string;
  promptVersion?: PromptWriterVersion;
  brief?: string;
  guidelines?: string;
  howTo?: HowToConfig;
  supers?: SupersConfig;
  video?: VideoConfig;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  operationName?: string;
  backstory?: Backstory;
  email?: EmailDeliveryConfig;
  steps: JobStep[];
  assets: JobAssets;
}

export interface RunLogEntry {
  timestamp: string;
  scope: "shared" | VideoProvider;
  message: string;
}

export interface SharedPlanRecord {
  script?: string;
  backstory?: Backstory;
  basePrompt?: string;
  basePromptSource?: "gemini_prompt_writer" | "deterministic_fallback";
}

export interface ProviderRunRef {
  provider: VideoProvider;
  jobId?: string;
}

export interface RunRecord {
  id: string;
  product: ProductKey;
  brief: string;
  promptVersion: PromptWriterVersion;
  videoType: VideoType;
  durationSeconds: VideoDurationSeconds;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  sharedPlan: SharedPlanRecord;
  children: Record<ActiveRunProvider, ProviderRunRef> & Partial<Record<Exclude<VideoProvider, ActiveRunProvider>, ProviderRunRef>>;
  logs: RunLogEntry[];
  error?: string;
}

export interface ClientJob extends Omit<JobRecord, "assets"> {
  assets: JobAssets & {
    keyframeUrl?: string;
    rawVideoUrl?: string;
    qcUrl?: string;
    finalVideoUrl?: string;
    howToStepVideoUrls?: string[];
    adaptSquareVideoUrl?: string;
    adaptLandscapeVideoUrl?: string;
    backstoryUrl: string;
    inputUrl: string;
  };
}

export interface ClientProviderRun {
  provider: VideoProvider;
  label: string;
  jobId?: string;
  status: JobStatus | "pending";
  message?: string;
  error?: string;
  rawVideoUrl?: string;
  finalVideoUrl?: string;
  assessment?: {
    score: number;
    whatWillWork: string;
    whyItWillWork: string;
    concerns: string[];
    assessedAt: string;
    model: string;
  };
}

export interface ClientRun {
  id: string;
  product: ProductKey;
  brief: string;
  promptVersion: PromptWriterVersion;
  videoType: VideoType;
  durationSeconds: VideoDurationSeconds;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  sharedPlan: SharedPlanRecord;
  logs: RunLogEntry[];
  error?: string;
  children: Record<ActiveRunProvider, ClientProviderRun> & Partial<Record<Exclude<VideoProvider, ActiveRunProvider>, ClientProviderRun>>;
}

export interface JobCreateInput {
  product: ProductKey;
  script: string;
  soraPrompt?: string;
  promptVersion?: PromptWriterVersion;
  brief?: string;
  guidelines?: string;
  howTo?: HowToConfig;
  supers?: SupersConfig;
  video?: VideoConfig;
  email?: EmailDeliveryConfig;
}

export interface RunCreateInput {
  product: ProductKey;
  brief: string;
  promptVersion?: PromptWriterVersion;
  videoType?: VideoType;
  durationSeconds?: VideoDurationSeconds;
}
