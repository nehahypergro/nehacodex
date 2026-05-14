import { fal } from "@fal-ai/client";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { maybeSendSoraStudioRenderEmail } from "./email";
import { applySoraStudioProductBranding } from "./postprocess";
import { buildSafePromptFallbackFromBase, optimizeRenderPromptForModelWithAnthropicFal } from "./prompt-optimizer";
import { getSoraStudioJobDir, mutateSoraStudioJob, requireSoraStudioJob } from "./store";
import {
  SoraStudioBriefAttachment,
  SoraStudioRenderAspectRatio,
  SoraStudioRenderModelKey,
  SoraStudioRenderPostProcess
} from "./types";

const FAL_SORA_TEXT_MODEL = process.env.FAL_SORA_TEXT_MODEL?.trim() || "fal-ai/sora-2/text-to-video/pro";
const FAL_SORA_IMAGE_MODEL = process.env.FAL_SORA_IMAGE_MODEL?.trim() || "fal-ai/sora-2/image-to-video/pro";
const FAL_SORA_RESOLUTION = (process.env.FAL_SORA_RESOLUTION?.trim() || "1080p") as "720p" | "1080p" | "true_1080p";
const FAL_SEEDANCE_TEXT_MODEL = process.env.FAL_SEEDANCE_TEXT_MODEL?.trim() || "bytedance/seedance-2.0/text-to-video";
const FAL_SEEDANCE_IMAGE_MODEL = process.env.FAL_SEEDANCE_IMAGE_MODEL?.trim() || "bytedance/seedance-2.0/image-to-video";
const FAL_SEEDANCE_RESOLUTION = (process.env.FAL_SEEDANCE_RESOLUTION?.trim() || "720p") as "720p" | "1080p";
const FAL_SORA_POLL_INTERVAL_MS = Number(process.env.FAL_SORA_POLL_INTERVAL_MS ?? 6000);
const FAL_SORA_SUBSCRIBE_TIMEOUT_MS = Number(process.env.FAL_SORA_SUBSCRIBE_TIMEOUT_MS ?? 45 * 60 * 1000);
const FAL_SORA_SUBSCRIBE_ATTEMPTS = Math.max(1, Number(process.env.FAL_SORA_SUBSCRIBE_ATTEMPTS ?? 3));
const FAL_SORA_SUBSCRIBE_RETRY_DELAY_MS = Math.max(500, Number(process.env.FAL_SORA_SUBSCRIBE_RETRY_DELAY_MS ?? 2500));
const FAL_SORA_DOWNLOAD_ATTEMPTS = Math.max(1, Number(process.env.FAL_SORA_DOWNLOAD_ATTEMPTS ?? 3));
const FAL_SORA_DOWNLOAD_RETRY_DELAY_MS = Math.max(250, Number(process.env.FAL_SORA_DOWNLOAD_RETRY_DELAY_MS ?? 1500));
const FAL_SORA_DOWNLOAD_TIMEOUT_MS = Math.max(5000, Number(process.env.FAL_SORA_DOWNLOAD_TIMEOUT_MS ?? 45000));
const FAL_SORA_MAX_PROMPT_CHARS = Math.max(700, Number(process.env.FAL_SORA_MAX_PROMPT_CHARS ?? 2400));
const FAL_PROMPT_OPTIMIZER_BASE_MAX_CHARS = Math.max(
  FAL_SORA_MAX_PROMPT_CHARS,
  Number(process.env.SORA_PROMPT_OPTIMIZER_BASE_MAX_CHARS ?? 9000)
);
const PROMPT_OPTIMIZER_MODEL = process.env.SORA_PROMPT_OPTIMIZER_MODEL?.trim() || "anthropic/claude-opus-4.7";
const SEEDANCE_PRONUNCIATION_LOCK =
  process.env.SORA_STUDIO_SEEDANCE_PRONUNCIATION_LOCK?.trim().toLowerCase() !== "false";

const DEBUG_LOG_FILE = "render-debug.log";
const DEBUG_PROMPT_PREVIEW_CHARS = 220;
const DEBUG_ERROR_SNIPPET_CHARS = 700;
const DELIVERABLES_ROOT = path.join(process.cwd(), "generated-sora-studio-deliverables");

interface QueueUpdate {
  status?: string;
  request_id?: string;
}

interface KlingFileResource {
  url?: string;
  file_data?: string;
}

interface FalSubscribeResult {
  requestId?: string;
  data?: unknown;
}

interface DeliveryBundleResult {
  directoryPath: string;
  folderName: string;
  videoFileNames: string[];
  textFileName: string;
}

interface RenderPromptPlan {
  prompt: string;
  source: "raw_sora_prompt" | "compacted_sora_prompt" | "script_fallback_prompt";
  originalChars: number;
  finalChars: number;
}

interface MultiModelRenderConfig {
  key: SoraStudioRenderModelKey;
  label: string;
  textEndpoint: string;
  imageEndpoint?: string;
  audioEnabledText: boolean;
  audioEnabledImage: boolean;
  normalizeDurationSeconds: (requestedSeconds: number) => number;
  buildInput: (params: { prompt: string; aspectRatio: "9:16" | "16:9"; durationSeconds: number }) => Record<string, unknown>;
}

interface AttachmentReferenceSet {
  images: SoraStudioBriefAttachment[];
  videos: SoraStudioBriefAttachment[];
}

interface ModelRenderResult {
  key: SoraStudioRenderModelKey;
  label: string;
  endpoint: string;
  status: "completed" | "failed";
  requestId?: string;
  assetFile?: string;
  bytes?: number;
  videoBytes?: Buffer;
  error?: string;
  inputSummary?: Record<string, unknown>;
  outputSummary?: Record<string, unknown>;
  postProcess?: SoraStudioRenderPostProcess;
}

interface ModelRenderRequestPlan {
  endpoint: string;
  input: Record<string, unknown>;
  audioEnabled: boolean;
  mode: "text-to-video" | "image-to-video";
  warnings: string[];
}

interface RenderDurationPlan {
  requestedDurationSeconds: number;
  strictParityMode: boolean;
  perModelDurationSeconds: Record<string, number>;
  parityAligned: boolean;
  warnings: string[];
}

type ModelOptimizedPromptMetadata = Partial<
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

interface PromptOptimizationPlan {
  promptPlan: RenderPromptPlan;
  promptWithAttachments: string;
  sharedAspectRatio: "9:16" | "16:9";
  durationPlan: RenderDurationPlan;
  modelSpecificPrompts: Partial<Record<SoraStudioRenderModelKey, string>>;
  optimizedPromptMetadata: ModelOptimizedPromptMetadata;
  warnings: string[];
}

const MULTI_MODEL_RENDER_CONFIGS: MultiModelRenderConfig[] = [
  {
    key: "sora2",
    label: "Sora 2",
    textEndpoint: FAL_SORA_TEXT_MODEL,
    imageEndpoint: FAL_SORA_IMAGE_MODEL,
    audioEnabledText: true,
    audioEnabledImage: true,
    normalizeDurationSeconds: (requestedSeconds) => requestedSeconds,
    buildInput: ({ prompt, aspectRatio, durationSeconds }) => ({
      prompt,
      resolution: FAL_SORA_RESOLUTION,
      aspect_ratio: aspectRatio,
      duration: durationSeconds,
      delete_video: false
    })
  },
  {
    key: "seedance2",
    label: "Seedance 2.0",
    textEndpoint: FAL_SEEDANCE_TEXT_MODEL,
    imageEndpoint: FAL_SEEDANCE_IMAGE_MODEL,
    audioEnabledText: true,
    audioEnabledImage: true,
    normalizeDurationSeconds: (requestedSeconds) => Math.max(4, Math.min(15, requestedSeconds)),
    buildInput: ({ prompt, aspectRatio, durationSeconds }) => ({
      prompt,
      resolution: FAL_SEEDANCE_RESOLUTION,
      aspect_ratio: aspectRatio,
      duration: String(durationSeconds),
      generate_audio: true
    })
  }
];
const ACTIVE_RENDER_MODEL_KEYS = new Set(
  (process.env.SORA_STUDIO_RENDER_MODELS?.trim() || "seedance2")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
);
const ACTIVE_MODEL_RENDER_CONFIGS =
  MULTI_MODEL_RENDER_CONFIGS.filter((item) => ACTIVE_RENDER_MODEL_KEYS.has(item.key)).length > 0
    ? MULTI_MODEL_RENDER_CONFIGS.filter((item) => ACTIVE_RENDER_MODEL_KEYS.has(item.key))
    : MULTI_MODEL_RENDER_CONFIGS.filter((item) => item.key === "seedance2");

function requireFalApiKey(): string {
  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    throw new Error("FAL_KEY is required for Sora Studio rendering.");
  }
  return key;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function safeSerialize(value: unknown, maxChars = 1200): string {
  try {
    return truncate(JSON.stringify(value), maxChars);
  } catch {
    return truncate(String(value), maxChars);
  }
}

function extractErrorChain(error: unknown): string {
  const chain: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (current instanceof Error) {
      const maybeCode = (current as Error & { code?: unknown }).code;
      const codeSuffix = typeof maybeCode === "string" ? ` [code=${maybeCode}]` : "";
      chain.push(`${current.name}: ${current.message}${codeSuffix}`);
      current = (current as Error & { cause?: unknown }).cause;
      continue;
    }

    if (isRecord(current)) {
      const name = typeof current.name === "string" ? current.name : "Error";
      const message = typeof current.message === "string" ? current.message : safeSerialize(current, 240);
      const maybeCode = typeof current.code === "string" ? ` [code=${current.code}]` : "";
      chain.push(`${name}: ${message}${maybeCode}`);
      current = current.cause;
      continue;
    }

    chain.push(String(current));
    break;
  }

  return chain.join(" <- ");
}

function toFailureMessage(stage: string, error: unknown, requestId?: string): string {
  const requestSuffix = requestId ? ` (requestId: ${requestId})` : "";
  return `Sora render failed at ${stage}${requestSuffix}: ${extractErrorChain(error)}`;
}

function isRetryableSubscribeError(error: unknown): boolean {
  const chain = extractErrorChain(error).toLowerCase();
  const needles = [
    "fetch failed",
    "gateway timeout",
    "connecttimeouterror",
    "und_err_connect_timeout",
    "econnreset",
    "etimedout",
    "socket hang up",
    "502",
    "503",
    "504"
  ];
  return needles.some((needle) => chain.includes(needle));
}

async function appendRenderDebugLog(jobId: string, event: string, payload: Record<string, unknown> = {}): Promise<void> {
  try {
    const filePath = path.join(getSoraStudioJobDir(jobId), DEBUG_LOG_FILE);
    const line = {
      ts: new Date().toISOString(),
      event,
      ...payload
    };
    await fs.appendFile(filePath, `${JSON.stringify(line)}\n`, "utf8");
  } catch {
    // Best-effort logging only; never fail the job because logging failed.
  }
}

function normalizeStatus(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === "in_queue") {
    return "queued";
  }
  if (normalized === "in_progress") {
    return "running";
  }
  if (normalized === "completed") {
    return "done";
  }
  return normalized || "running";
}

function extractFileResource(value: unknown): KlingFileResource | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const maybeUrl = (value as { url?: unknown }).url;
  const maybeFileData = (value as { file_data?: unknown }).file_data;
  const resource: KlingFileResource = {};

  if (typeof maybeUrl === "string" && maybeUrl.trim()) {
    resource.url = maybeUrl.trim();
  }

  if (typeof maybeFileData === "string" && maybeFileData.trim()) {
    resource.file_data = maybeFileData.trim();
  }

  return resource.url || resource.file_data ? resource : undefined;
}

function extractVideoResource(payload: unknown): KlingFileResource | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const objectPayload = payload as Record<string, unknown>;
  const direct = extractFileResource(objectPayload.video);
  if (direct) {
    return direct;
  }

  if (Array.isArray(objectPayload.videos)) {
    for (const candidate of objectPayload.videos) {
      const resource = extractFileResource(candidate);
      if (resource) {
        return resource;
      }
    }
  }

  const nestedOutput = objectPayload.output;
  if (nestedOutput && typeof nestedOutput === "object") {
    const nested = extractFileResource((nestedOutput as Record<string, unknown>).video);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function getUrlHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "unknown";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function summarizeFalInput(input: Record<string, unknown>): Record<string, unknown> {
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  const { prompt: _omitPrompt, ...rest } = input;

  return {
    ...rest,
    promptChars: prompt.length,
    promptPreview: truncate(prompt.replace(/\s+/g, " ").trim(), DEBUG_PROMPT_PREVIEW_CHARS)
  };
}

function summarizeFalOutput(output: unknown): Record<string, unknown> {
  const summary: Record<string, unknown> = {};

  if (isRecord(output)) {
    summary.topLevelKeys = Object.keys(output).slice(0, 20);
  } else {
    summary.type = typeof output;
    return summary;
  }

  const resource = extractVideoResource(output);
  summary.hasVideoResource = Boolean(resource);
  summary.hasInlineFileData = Boolean(resource?.file_data);
  if (resource?.url) {
    summary.videoUrlHost = getUrlHost(resource.url);
  }

  return summary;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Video download timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadVideoResource(
  videoResource: KlingFileResource,
  options: { jobId: string; requestId?: string }
): Promise<Buffer> {
  if (videoResource.file_data) {
    await appendRenderDebugLog(options.jobId, "render_download_inline_file_data", {
      requestId: options.requestId,
      inlineBytesApprox: Math.floor((videoResource.file_data.length * 3) / 4)
    });
    return Buffer.from(videoResource.file_data, "base64");
  }

  if (!videoResource.url) {
    throw new Error("fal Sora output did not contain a downloadable video URL.");
  }

  const url = videoResource.url;
  const urlHost = getUrlHost(url);
  let lastError: unknown;

  for (let attempt = 1; attempt <= FAL_SORA_DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      await appendRenderDebugLog(options.jobId, "render_download_attempt", {
        requestId: options.requestId,
        attempt,
        maxAttempts: FAL_SORA_DOWNLOAD_ATTEMPTS,
        urlHost,
        timeoutMs: FAL_SORA_DOWNLOAD_TIMEOUT_MS
      });

      const response = await fetchWithTimeout(url, FAL_SORA_DOWNLOAD_TIMEOUT_MS);

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        const snippet = truncate(bodyText.replace(/\s+/g, " ").trim(), DEBUG_ERROR_SNIPPET_CHARS);
        throw new Error(
          `fal Sora video download failed: HTTP ${response.status} ${response.statusText}${
            snippet ? `; body=${snippet}` : ""
          }`
        );
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      await appendRenderDebugLog(options.jobId, "render_download_success", {
        requestId: options.requestId,
        attempt,
        bytes: bytes.length,
        urlHost
      });
      return bytes;
    } catch (error) {
      lastError = error;
      await appendRenderDebugLog(options.jobId, "render_download_attempt_failed", {
        requestId: options.requestId,
        attempt,
        maxAttempts: FAL_SORA_DOWNLOAD_ATTEMPTS,
        urlHost,
        error: extractErrorChain(error)
      });

      if (attempt < FAL_SORA_DOWNLOAD_ATTEMPTS) {
        await sleep(FAL_SORA_DOWNLOAD_RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw new Error(
    `Video download failed after ${FAL_SORA_DOWNLOAD_ATTEMPTS} attempts from ${urlHost}. Last error: ${extractErrorChain(lastError)}`
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function renderAspectRatioForFal(aspectRatio: SoraStudioRenderAspectRatio): "9:16" | "16:9" {
  return aspectRatio === "16:9" ? "16:9" : "9:16";
}

function normalizeAttachmentReferences(attachments: SoraStudioBriefAttachment[] | undefined): AttachmentReferenceSet {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return { images: [], videos: [] };
  }

  const images: SoraStudioBriefAttachment[] = [];
  const videos: SoraStudioBriefAttachment[] = [];
  const seen = new Set<string>();

  for (const item of attachments) {
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    if (item.mediaType === "image") {
      images.push(item);
      continue;
    }
    if (item.mediaType === "video") {
      videos.push(item);
    }
  }

  return {
    images: images.slice(0, 4),
    videos: videos.slice(0, 4)
  };
}

function applyAttachmentGuidanceToPrompt(prompt: string, refs: AttachmentReferenceSet): string {
  const lines = [
    "GLOBAL VISUAL SAFETY:",
    "- Do not render visible written text in any frame.",
    "- No branded marks or interface displays in-frame."
  ];

  if (refs.images.length === 0 && refs.videos.length === 0) {
    return `${prompt.trim()}\n\n${lines.join("\n")}`.trim();
  }

  lines.push(
    "BRIEF ATTACHMENT GUIDANCE:",
    "- Use attached assets as style/composition/pacing references only.",
    "- Do not copy logos, UI, subtitles, end-slates, or legal overlays from references."
  );

  refs.images.forEach((item, index) => {
    lines.push(`- Image Ref ${index + 1}: ${item.name} | ${item.url}`);
  });
  refs.videos.forEach((item, index) => {
    lines.push(`- Video Ref ${index + 1}: ${item.name} | ${item.url}`);
  });

  return `${prompt.trim()}\n\n${lines.join("\n")}`.trim();
}

function buildModelRenderRequest(
  config: MultiModelRenderConfig,
  params: { prompt: string; aspectRatio: "9:16" | "16:9"; durationSeconds: number },
  refs: AttachmentReferenceSet
): ModelRenderRequestPlan {
  const warnings: string[] = [];
  const baseInput = config.buildInput(params);
  const firstImage = refs.images[0];
  const secondImage = refs.images[1];

  if (!firstImage || !config.imageEndpoint) {
    if (!firstImage && refs.videos.length > 0) {
      warnings.push("Video attachments provided without an image attachment; used as textual cues only.");
    }
    return {
      endpoint: config.textEndpoint,
      input: baseInput,
      audioEnabled: config.audioEnabledText,
      mode: "text-to-video",
      warnings
    };
  }

  if (config.key === "sora2") {
    return {
      endpoint: config.imageEndpoint,
      input: {
        ...baseInput,
        image_url: firstImage.url
      },
      audioEnabled: config.audioEnabledImage,
      mode: "image-to-video",
      warnings
    };
  }

  if (config.key === "seedance2") {
    return {
      endpoint: config.imageEndpoint,
      input: {
        ...baseInput,
        image_url: firstImage.url,
        ...(secondImage ? { end_image_url: secondImage.url } : {})
      },
      audioEnabled: config.audioEnabledImage,
      mode: "image-to-video",
      warnings
    };
  }

  return {
    endpoint: config.imageEndpoint,
    input: {
      ...baseInput,
      image_url: firstImage.url
    },
    audioEnabled: config.audioEnabledImage,
    mode: "image-to-video",
    warnings
  };
}

function buildBriefVideoFileName(brief: string, jobId: string, sequence: number): string {
  const stem =
    brief
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/[^\p{L}\p{N}\-_.() ]+/gu, " ")
      .replace(/\s+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 56) || "sora-studio-video";
  const digest = createHash("sha256").update(`${brief}:${jobId}:${sequence}`).digest("hex").slice(0, 10);
  return `${stem}_${digest}.mp4`;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildRenderDurationPlan(params: { requestedDurationSeconds: number; strictParityMode: boolean }): RenderDurationPlan {
  const perModelDurationSeconds: Record<string, number> = {};

  for (const config of ACTIVE_MODEL_RENDER_CONFIGS) {
    perModelDurationSeconds[config.key] = config.normalizeDurationSeconds(params.requestedDurationSeconds);
  }

  const uniqueDurations = Array.from(new Set(Object.values(perModelDurationSeconds)));
  const parityAligned = uniqueDurations.length <= 1;
  const warnings: string[] = [];

  if (!parityAligned) {
    const durationByModel = ACTIVE_MODEL_RENDER_CONFIGS.map(
      (config) => `${config.label}: ${perModelDurationSeconds[config.key]}s`
    ).join(", ");
    const baseMessage = `Requested duration ${params.requestedDurationSeconds}s resolves to model-specific durations (${durationByModel}) because provider duration capabilities differ.`;
    if (params.strictParityMode) {
      warnings.push(`Strict parity mode kept shared script/prompt, but ${baseMessage}`);
    } else {
      warnings.push(baseMessage);
    }
  }

  return {
    requestedDurationSeconds: params.requestedDurationSeconds,
    strictParityMode: params.strictParityMode,
    perModelDurationSeconds,
    parityAligned,
    warnings
  };
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      if (word.length <= 2) {
        return word.toUpperCase();
      }
      return `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`;
    })
    .join(" ");
}

function sanitizeFileSegment(value: string, fallback: string, maxLength = 68): string {
  const normalized = compactText(value)
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/[^\p{L}\p{N}\-_.() ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const candidate = normalized.length > 0 ? normalized : fallback;
  const rawClip = candidate.slice(0, maxLength).trim();
  const wordSafeClip =
    candidate.length > maxLength
      ? (() => {
          const noPartialTail = rawClip.replace(/\s+\S*$/g, "").trim();
          if (noPartialTail.length >= Math.max(18, Math.floor(maxLength * 0.5))) {
            return noPartialTail;
          }
          return rawClip;
        })()
      : rawClip;
  const clipped = wordSafeClip.replace(/[. ]+$/g, "");
  return clipped.length > 0 ? clipped : fallback;
}

function buildBriefSummaryTitle(brief: string): string {
  const cleaned = compactText(brief.replace(/https?:\/\/\S+/gi, " "));
  if (!cleaned) {
    return "Untitled Brief";
  }

  const firstSentence = cleaned.split(/[.!?]/).find((segment) => compactText(segment).length > 0) ?? cleaned;
  const words = compactText(firstSentence).split(" ").filter(Boolean);
  const selected = words.slice(0, Math.min(8, words.length)).join(" ");
  return titleCase(selected || "Untitled Brief");
}

function trimToMaxChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  const head = value.slice(0, maxChars).trim();
  const byLine = head.lastIndexOf("\n");
  if (byLine > Math.floor(maxChars * 0.6)) {
    return head.slice(0, byLine).trim();
  }
  return head;
}

function ensureCriticalPromptGuardrailsAtTop(prompt: string): string {
  const lower = prompt.toLowerCase();
  const missing: string[] = [];

  if (!lower.includes("indian faces only")) {
    missing.push("- Indian faces only.");
  }
  if (!lower.includes("one clear primary action per scene") && !lower.includes("one primary action per scene")) {
    missing.push("- Keep one clear primary action per scene; avoid complex hand mechanics.");
  }
  if (!lower.includes("no visible text")) {
    missing.push("- No visible text, supers, captions, subtitles, logos, watermarks, UI, app screens, or end slates.");
  }
  if (!lower.includes("no physical card closeups")) {
    missing.push("- No physical card closeups and no card swipe/tap/insert interactions.");
  }
  if (!lower.includes("no pos") && !lower.includes("point of sale") && !lower.includes("payment terminal")) {
    missing.push("- No PoS or payment terminal device visuals.");
  }

  if (missing.length === 0) {
    return prompt;
  }

  const section = ["H) ABSOLUTE RULES", ...missing].join("\n");
  return `${section}\n\n${prompt}`.trim();
}

function collectSeedancePronunciationLocks(text: string): string[] {
  const entries: Array<{ patterns: RegExp[]; line: string }> = [
    {
      patterns: [/\bforex\b/i, /\bforeign\s+exchange\b/i],
      line: "- Pronounce forex as FOR-ex, like foreign exchange. Do not say for-rex or four-x."
    },
    {
      patterns: [/\bsolitaire\b/i],
      line: "- Pronounce Solitaire as SOL-ih-tair, smooth Indian English, not solitary."
    },
    {
      patterns: [/\bkotak\b/i, /कोटक/u],
      line: "- Pronounce Kotak as KOH-tuk / कोटक, not ko-tack."
    },
    {
      patterns: [/\bmahindra\b/i],
      line: "- Pronounce Mahindra as muh-HIN-dra."
    },
    {
      patterns: [/\bprivy\b/i],
      line: "- Pronounce Privy as PRI-vee."
    },
    {
      patterns: [/\bzomato\b/i],
      line: "- Pronounce Zomato as zoh-MAA-toh."
    },
    {
      patterns: [/\blakhs?\b/i, /लाख/u],
      line: "- Pronounce lakh as luhkh, not lake."
    },
    {
      patterns: [/\bcrores?\b/i, /करोड़/u],
      line: "- Pronounce crore as kroar."
    },
    {
      patterns: [/\bemi\b/i],
      line: "- Pronounce EMI as E-M-I, three letters."
    },
    {
      patterns: [/\bgst\b/i],
      line: "- Pronounce GST as G-S-T, three letters."
    },
    {
      patterns: [/\bupi\b/i],
      line: "- Pronounce UPI as U-P-I, three letters."
    },
    {
      patterns: [/\bfd\b/i],
      line: "- Pronounce FD as F-D, two letters."
    },
    {
      patterns: [/\bsip\b/i],
      line: "- Pronounce SIP as S-I-P, three letters."
    },
    {
      patterns: [/\bhausla\b/i, /हौसला/u],
      line: "- Pronounce Hausla / हौसला as HOWS-lah."
    },
    {
      patterns: [/\bhauslo\b/i, /\bhauslon\b/i, /हौस्लो/u],
      line: "- Pronounce Hauslo / हौस्लो as HOWS-loh."
    }
  ];

  const locks = entries
    .filter((entry) => entry.patterns.some((pattern) => pattern.test(text)))
    .map((entry) => entry.line);

  if (/[\u0900-\u097F]/u.test(text)) {
    locks.push("- Any Devanagari or Hindi word must be spoken naturally by an Indian speaker; do not spell it out letter-by-letter.");
  }

  return Array.from(new Set(locks));
}

function withSeedancePronunciationLock(params: {
  prompt: string;
  product: string;
  language: string;
  brief: string;
  script: string;
  dialogueAnchors: string[];
}): string {
  if (!SEEDANCE_PRONUNCIATION_LOCK) {
    return params.prompt;
  }

  const context = [params.product, params.language, params.brief, params.script, params.dialogueAnchors.join(" "), params.prompt].join("\n");
  const locks = collectSeedancePronunciationLocks(context);
  if (locks.length === 0) {
    return params.prompt;
  }

  const section = [
    "B.1) SEEDANCE AUDIO PRONUNCIATION LOCK",
    "- Instruction only. Do not speak this section and do not add these words unless they already appear in locked Dialogue/VO.",
    "- Keep the locked Dialogue/VO wording unchanged, but pronounce these terms exactly as guided:",
    ...locks
  ].join("\n");

  return `${section}\n\n${params.prompt}`.trim();
}

function truncateFieldValue(value: string, maxChars: number): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxChars) {
    return compacted;
  }
  const head = compacted.slice(0, maxChars).trim();
  const byWord = head.replace(/\s+\S*$/g, "").trim();
  if (byWord.length >= Math.floor(maxChars * 0.65)) {
    return byWord;
  }
  return head;
}

function extractDialogueAnchorsFromScript(script: string): string[] {
  const lines = script.replace(/\r\n/g, "\n").split("\n");
  const anchors: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const match = line.match(/^\s*-\s*(?:VO\/Dialogue|Dialogue\/VO|Dialogue|VO|Voice\s*Over|Voiceover)\s*:\s*(.+)\s*$/i);
    if (!match || !match[1]) {
      continue;
    }
    const value = match[1].replace(/\s+/g, " ").trim();
    if (!value) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    anchors.push(value);
  }
  return anchors;
}

interface PromptCompactionMode {
  includeSubject: boolean;
  includeAction: boolean;
  includeSetting: boolean;
  includeCamera: boolean;
  includeLighting: boolean;
  includeAudio: boolean;
}

const PROMPT_COMPACTION_MODES: PromptCompactionMode[] = [
  { includeSubject: true, includeAction: true, includeSetting: true, includeCamera: true, includeLighting: true, includeAudio: true },
  { includeSubject: true, includeAction: true, includeSetting: true, includeCamera: true, includeLighting: false, includeAudio: false },
  { includeSubject: true, includeAction: true, includeSetting: false, includeCamera: true, includeLighting: false, includeAudio: false },
  { includeSubject: false, includeAction: true, includeSetting: false, includeCamera: true, includeLighting: false, includeAudio: false },
  { includeSubject: false, includeAction: true, includeSetting: false, includeCamera: false, includeLighting: false, includeAudio: false }
];

function compactSoraPromptForRender(prompt: string, mode: PromptCompactionMode): string {
  const lines = prompt
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const result: string[] = [];
  let currentSection = "";
  let sceneCount = 0;

  for (const line of lines) {
    if (/^[A-I]\)\s+/i.test(line)) {
      currentSection = line.toUpperCase();
      if (
        /^A\)\s+VIDEO OVERVIEW/i.test(line) ||
        /^B\)\s+PROTAGONIST/i.test(line) ||
        /^C\)\s+SCENE BREAKDOWN/i.test(line) ||
        /^I\)\s+ACTION REALISM/i.test(line)
      ) {
        result.push(line);
      }
      continue;
    }

    if (/^SCENE\s+\d+/i.test(line) || /^SHOT\s+\d+/i.test(line)) {
      sceneCount += 1;
      if (sceneCount <= 8) {
        result.push(line);
      }
      continue;
    }

    const sceneField = line.match(/^-?\s*(?:-\s*)?(Subject|Action|Setting|Camera|Lighting\s*&\s*Color|Audio|Dialogue\/VO)\s*:\s*(.*)$/i);
    if (sceneField) {
      const field = sceneField[1].toLowerCase();
      const value = sceneField[2] ? sceneField[2].trim() : "";
      const isDialogueField = field === "dialogue/vo";
      const inTrackedScene = sceneCount > 0 && sceneCount <= 8;
      if (!isDialogueField && !inTrackedScene) {
        continue;
      }
      const include =
        isDialogueField ||
        (field === "subject" && mode.includeSubject) ||
        (field === "action" && mode.includeAction) ||
        (field === "setting" && mode.includeSetting) ||
        (field === "camera" && mode.includeCamera) ||
        (field === "lighting & color" && mode.includeLighting) ||
        (field === "audio" && mode.includeAudio);
      if (!include) {
        continue;
      }
      const maxByField =
        field === "dialogue/vo"
          ? 220
          : field === "action"
            ? 140
            : field === "camera"
              ? 110
              : 96;
      const compactValue = truncateFieldValue(value, maxByField);
      if (!compactValue) {
        continue;
      }
      const fieldLabel =
        field === "lighting & color"
          ? "Lighting & Color"
          : field === "dialogue/vo"
            ? "Dialogue/VO"
            : field.charAt(0).toUpperCase() + field.slice(1);
      result.push(`- ${fieldLabel}: ${compactValue}`);
      continue;
    }

    if (
      /^-\s*(Indian faces only|No subtitles|Maintain single protagonist continuity|Hindi word|Action realism lock|Object interaction lock|Beverage interaction lock|Door interaction lock|Camera blocking lock|Edit lock|Visual style lock|If the brief is silent on palette)/i.test(
        line
      )
    ) {
      result.push(line);
      continue;
    }

    if (/^A\)\s+VIDEO OVERVIEW/i.test(currentSection) && line.startsWith("-")) {
      result.push(`- ${truncateFieldValue(line.replace(/^-+\s*/, ""), 220)}`);
      continue;
    }

    if (/^B\)\s+PROTAGONIST/i.test(currentSection) && line.startsWith("-")) {
      result.push(`- ${truncateFieldValue(line.replace(/^-+\s*/, ""), 210)}`);
      continue;
    }
  }

  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildScriptFallbackRenderPrompt(script: string): string {
  const lines = script
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const filtered = lines.filter(
    (line) =>
      /^\[CHARACTERS\]|\[SETTING\]|\[SCREENPLAY\]/i.test(line) ||
      /^SHOT\s+\d+/i.test(line) ||
      /^-\s*(Visual|Camera|Performance|VO\/Dialogue):/i.test(line)
  );
  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function fitPromptToMaxCharsWithSceneCoverage(prompt: string, maxChars: number): string {
  if (prompt.length <= maxChars) {
    return prompt;
  }

  for (const mode of PROMPT_COMPACTION_MODES) {
    const compacted = compactSoraPromptForRender(prompt, mode);
    if (compacted.length <= maxChars) {
      return compacted;
    }
  }

  const tightest = compactSoraPromptForRender(prompt, PROMPT_COMPACTION_MODES[PROMPT_COMPACTION_MODES.length - 1]);
  if (tightest.length <= maxChars) {
    return tightest;
  }
  return trimToMaxChars(tightest, maxChars);
}

function resolveRenderPrompt(soraPrompt: string, script: string, maxChars: number): RenderPromptPlan {
  const raw = soraPrompt.trim();
  if (raw.length <= maxChars) {
    return {
      prompt: raw,
      source: "raw_sora_prompt",
      originalChars: raw.length,
      finalChars: raw.length
    };
  }

  const compacted = fitPromptToMaxCharsWithSceneCoverage(raw, maxChars);
  if (compacted.length >= 400) {
    return {
      prompt: compacted,
      source: "compacted_sora_prompt",
      originalChars: raw.length,
      finalChars: compacted.length
    };
  }

  const fallbackCandidate = buildScriptFallbackRenderPrompt(script);
  const fallbackBase =
    fallbackCandidate.length >= 120
      ? fallbackCandidate
      : `Create a realistic premium Indian ad video using this screenplay:\n${script}`.trim();
  const fallback = fitPromptToMaxCharsWithSceneCoverage(fallbackBase, maxChars);
  return {
    prompt: fallback,
    source: "script_fallback_prompt",
    originalChars: raw.length,
    finalChars: fallback.length
  };
}

async function buildPromptOptimizationPlan(
  params: {
    job: Awaited<ReturnType<typeof requireSoraStudioJob>>;
    jobId?: string;
  }
): Promise<PromptOptimizationPlan> {
  const { job, jobId } = params;
  const promptPlan = resolveRenderPrompt(job.soraPrompt, job.script, FAL_PROMPT_OPTIMIZER_BASE_MAX_CHARS);
  const attachmentRefs = normalizeAttachmentReferences(job.input.briefAttachments);
  const promptForOptimizer = trimToMaxChars(
    applyAttachmentGuidanceToPrompt(promptPlan.prompt, attachmentRefs),
    FAL_PROMPT_OPTIMIZER_BASE_MAX_CHARS
  );
  const sharedRenderPrompt = fitPromptToMaxCharsWithSceneCoverage(promptForOptimizer, FAL_SORA_MAX_PROMPT_CHARS);
  const dialogueAnchorsFromScript = extractDialogueAnchorsFromScript(job.script);
  const sharedAspectRatio = renderAspectRatioForFal(job.input.renderAspectRatio);
  const durationPlan = buildRenderDurationPlan({
    requestedDurationSeconds: job.input.requestDurationSeconds,
    strictParityMode: job.input.strictParityMode !== false
  });
  const modelSpecificPrompts: Partial<Record<SoraStudioRenderModelKey, string>> = {};
  const optimizedPromptMetadata: ModelOptimizedPromptMetadata = {};
  const warnings: string[] = [];

  for (const config of ACTIVE_MODEL_RENDER_CONFIGS) {
    if (config.key !== "sora2" && config.key !== "seedance2") {
      modelSpecificPrompts[config.key] = sharedRenderPrompt;
      continue;
    }

    const modelDurationSeconds = durationPlan.perModelDurationSeconds[config.key] ?? job.input.requestDurationSeconds;
    try {
      const optimized = await optimizeRenderPromptForModelWithAnthropicFal({
        modelKey: config.key,
        basePrompt: promptForOptimizer,
        dialogueAnchors: dialogueAnchorsFromScript,
        product: job.input.product,
        language: job.input.resolvedLanguage,
        requestedDurationSeconds: job.input.requestedDurationSeconds,
        renderDurationSeconds: modelDurationSeconds,
        renderAspectRatio: sharedAspectRatio
      });

      const guardedPrompt = ensureCriticalPromptGuardrailsAtTop(optimized.optimizedPrompt);
      const pronunciationLockedPrompt =
        config.key === "seedance2"
          ? withSeedancePronunciationLock({
              prompt: guardedPrompt,
              product: job.input.product,
              language: job.input.resolvedLanguage,
              brief: job.input.brief,
              script: job.script,
              dialogueAnchors: dialogueAnchorsFromScript
            })
          : guardedPrompt;
      const finalPrompt = fitPromptToMaxCharsWithSceneCoverage(pronunciationLockedPrompt, FAL_SORA_MAX_PROMPT_CHARS);
      modelSpecificPrompts[config.key] = finalPrompt;
      optimizedPromptMetadata[config.key] = {
        provider: optimized.provider,
        model: optimized.model,
        basePromptChars: optimized.basePromptChars,
        optimizedPromptChars: finalPrompt.length,
        dialogueLinesLocked: optimized.dialogueLinesLocked,
        prompt: finalPrompt,
        warnings: optimized.warnings
      };

      if (jobId) {
        await appendRenderDebugLog(jobId, "render_prompt_optimized", {
          modelKey: config.key,
          optimizerProvider: optimized.provider,
          optimizerModel: optimized.model,
          optimizerEndpoint: optimized.endpoint,
          basePromptChars: optimized.basePromptChars,
          optimizedPromptChars: optimized.optimizedPromptChars,
          finalPromptChars: finalPrompt.length,
          dialogueLinesLocked: optimized.dialogueLinesLocked,
          warnings: optimized.warnings
        });
      }

      if (optimized.warnings.length > 0) {
        for (const warning of optimized.warnings) {
          warnings.push(`${config.label} prompt optimizer: ${warning}`);
        }
      }
    } catch (error) {
      const fallbackWarning = `${config.label} prompt optimizer failed; using shared prompt. Reason: ${extractErrorChain(error)}`;
      const safeFallback = buildSafePromptFallbackFromBase(promptForOptimizer);
      const guardedFallbackPrompt = ensureCriticalPromptGuardrailsAtTop(safeFallback.prompt);
      const pronunciationLockedFallback =
        config.key === "seedance2"
          ? withSeedancePronunciationLock({
              prompt: guardedFallbackPrompt,
              product: job.input.product,
              language: job.input.resolvedLanguage,
              brief: job.input.brief,
              script: job.script,
              dialogueAnchors: dialogueAnchorsFromScript
            })
          : guardedFallbackPrompt;
      const safeFallbackPrompt = fitPromptToMaxCharsWithSceneCoverage(pronunciationLockedFallback, FAL_SORA_MAX_PROMPT_CHARS);
      modelSpecificPrompts[config.key] = safeFallbackPrompt;
      optimizedPromptMetadata[config.key] = {
        provider: "fallback-shared-prompt",
        model: "none",
        basePromptChars: promptForOptimizer.length,
        optimizedPromptChars: safeFallbackPrompt.length,
        dialogueLinesLocked: safeFallback.dialogueLinesLocked,
        prompt: safeFallbackPrompt,
        warnings: [fallbackWarning]
      };
      warnings.push(fallbackWarning);

      if (jobId) {
        await appendRenderDebugLog(jobId, "render_prompt_optimizer_failed", {
          modelKey: config.key,
          warning: fallbackWarning
        });
      }
    }
  }

  return {
    promptPlan,
    promptWithAttachments: sharedRenderPrompt,
    sharedAspectRatio,
    durationPlan,
    modelSpecificPrompts,
    optimizedPromptMetadata,
    warnings
  };
}

function buildRowResponseText(job: Awaited<ReturnType<typeof requireSoraStudioJob>>): string {
  const payload = {
    generatedAt: new Date().toISOString(),
    jobId: job.id,
    status: job.status,
    requestId: job.operationName ?? "",
    input: job.input,
    warnings: job.warnings,
    models: {
      scriptModel: job.steps.find((step) => step.id === "script_generation")?.model ?? "",
      promptModel: job.steps.find((step) => step.id === "prompt_generation")?.model ?? "",
      renderModel: job.steps.find((step) => step.id === "video_render")?.model ?? "",
      renderVariants: job.renders ?? []
    },
    script: job.script,
    soraPrompt: job.soraPrompt,
    modelOptimizedPrompts: job.modelOptimizedPrompts ?? {}
  };

  return `${JSON.stringify(payload, null, 2)}\n`;
}

function resolveDeliverableRecipient(job: Awaited<ReturnType<typeof requireSoraStudioJob>>): string {
  return job.input.notificationEmail?.trim() || process.env.SORA_STUDIO_NOTIFY_EMAIL_TO?.trim() || "unassigned";
}

function buildRecipientFolderName(recipient: string): string {
  if (recipient === "unassigned") {
    return "unassigned";
  }
  return sanitizeFileSegment(recipient.toLowerCase().replace(/@/g, " at "), "unassigned", 96).replace(/\s+/g, "_");
}

async function createDeliverableBundle(
  job: Awaited<ReturnType<typeof requireSoraStudioJob>>,
  outputs: Array<{ key: SoraStudioRenderModelKey; fileName: string; bytes: Buffer }>
): Promise<DeliveryBundleResult> {
  await fs.mkdir(DELIVERABLES_ROOT, { recursive: true });

  const recipientFolderName = buildRecipientFolderName(resolveDeliverableRecipient(job));
  const recipientPath = path.join(DELIVERABLES_ROOT, recipientFolderName);
  await fs.mkdir(recipientPath, { recursive: true });

  const videoFileNames: string[] = [];

  for (const output of outputs) {
    const safeVideoFileName = path.basename(output.fileName);
    await fs.writeFile(path.join(recipientPath, safeVideoFileName), output.bytes);
    videoFileNames.push(safeVideoFileName);
  }

  const textFileName = `${path.parse(videoFileNames[0] ?? job.id).name}-row-response.txt`;

  await fs.writeFile(path.join(recipientPath, textFileName), buildRowResponseText(job), "utf8");

  return {
    directoryPath: recipientPath,
    folderName: recipientFolderName,
    videoFileNames,
    textFileName
  };
}

export async function runSoraStudioJob(jobId: string): Promise<void> {
  const initial = await requireSoraStudioJob(jobId);
  if (initial.status === "running") {
    return;
  }

  await appendRenderDebugLog(jobId, "render_bootstrap", {
    models: ACTIVE_MODEL_RENDER_CONFIGS.map((item) => ({
      key: item.key,
      label: item.label,
      textEndpoint: item.textEndpoint,
      imageEndpoint: item.imageEndpoint,
      audioEnabledText: item.audioEnabledText,
      audioEnabledImage: item.audioEnabledImage
    })),
    promptOptimizer: {
      model: PROMPT_OPTIMIZER_MODEL
    },
    soraResolution: FAL_SORA_RESOLUTION,
    seedanceResolution: FAL_SEEDANCE_RESOLUTION,
    pollIntervalMs: FAL_SORA_POLL_INTERVAL_MS,
    subscribeTimeoutMs: FAL_SORA_SUBSCRIBE_TIMEOUT_MS,
    subscribeAttempts: FAL_SORA_SUBSCRIBE_ATTEMPTS,
    subscribeRetryDelayMs: FAL_SORA_SUBSCRIBE_RETRY_DELAY_MS,
    downloadAttempts: FAL_SORA_DOWNLOAD_ATTEMPTS,
    downloadRetryDelayMs: FAL_SORA_DOWNLOAD_RETRY_DELAY_MS,
    downloadTimeoutMs: FAL_SORA_DOWNLOAD_TIMEOUT_MS
  });

  await mutateSoraStudioJob(jobId, (job) => {
    job.status = "running";
    job.error = undefined;
    job.operationName = undefined;
    job.renders = ACTIVE_MODEL_RENDER_CONFIGS.map((item) => ({
      key: item.key,
      label: item.label,
      endpoint: item.textEndpoint,
      status: "pending",
      audioEnabled: item.audioEnabledText,
      startedAt: undefined,
      completedAt: undefined,
      error: undefined,
      requestId: undefined,
      inputSummary: undefined,
      outputSummary: undefined,
      assetFile: undefined,
      assetUrl: undefined
    }));
    const renderStep = job.steps.find((step) => step.id === "video_render");
    if (renderStep) {
      renderStep.status = "running";
      renderStep.provider = "fal-multi-model";
      renderStep.model = `${ACTIVE_MODEL_RENDER_CONFIGS.map((item) => item.key).join(" + ")} | optimizer:${PROMPT_OPTIMIZER_MODEL}`;
      renderStep.startedAt = new Date().toISOString();
      renderStep.completedAt = undefined;
      renderStep.error = undefined;
      renderStep.message = "Multi-model render started.";
      renderStep.operationName = undefined;
    }
    job.assets.debugLog = job.assets.debugLog ?? DEBUG_LOG_FILE;
    job.assets.renderManifestJson = job.assets.renderManifestJson ?? "render-manifest.json";
    job.modelOptimizedPrompts = undefined;
  });

  let failureStage = "bootstrap";
  let primaryOperationName: string | undefined;
  const modelResults: ModelRenderResult[] = [];

  try {
    const job = await requireSoraStudioJob(jobId);
    const falClient = fal as unknown as {
      config: (config: { credentials: string }) => void;
      subscribe: (
        endpointId: string,
        options: {
          input: Record<string, unknown>;
          mode?: "polling";
          pollInterval?: number;
          onQueueUpdate?: (update: QueueUpdate) => void;
        }
      ) => Promise<FalSubscribeResult>;
    };

    falClient.config({ credentials: requireFalApiKey() });

    const optimizationPlan = await buildPromptOptimizationPlan({ job, jobId });
    const {
      promptPlan,
      promptWithAttachments,
      sharedAspectRatio,
      durationPlan,
      modelSpecificPrompts,
      optimizedPromptMetadata,
      warnings: optimizationWarnings
    } = optimizationPlan;
    const attachmentRefs = normalizeAttachmentReferences(job.input.briefAttachments);
    const jobDir = getSoraStudioJobDir(jobId);

    await mutateSoraStudioJob(jobId, (state) => {
      state.renderPromptSource = promptPlan.source;
      state.renderPromptOriginalChars = promptPlan.originalChars;
      state.renderPromptFinalChars = promptWithAttachments.length;
      state.renderPromptUsed = promptWithAttachments;
    });

    await appendRenderDebugLog(jobId, "render_prompt_resolved", {
      promptPlan: {
        source: promptPlan.source,
        originalChars: promptPlan.originalChars,
        finalChars: promptWithAttachments.length,
        maxChars: FAL_SORA_MAX_PROMPT_CHARS,
        attachmentImages: attachmentRefs.images.length,
        attachmentVideos: attachmentRefs.videos.length
      },
      durationPlan
    });

    if (durationPlan.warnings.length > 0 || optimizationWarnings.length > 0) {
      await mutateSoraStudioJob(jobId, (state) => {
        const nextWarnings = new Set<string>(state.warnings ?? []);
        for (const warning of durationPlan.warnings) {
          nextWarnings.add(warning);
        }
        for (const warning of optimizationWarnings) {
          nextWarnings.add(warning);
        }
        state.warnings = Array.from(nextWarnings);
      });
    }

    await mutateSoraStudioJob(jobId, (state) => {
      state.modelOptimizedPrompts = Object.keys(optimizedPromptMetadata).length > 0 ? optimizedPromptMetadata : undefined;
    });

    for (const config of ACTIVE_MODEL_RENDER_CONFIGS) {
      failureStage = `${config.key}:prepare`;
      const modelDurationSeconds = durationPlan.perModelDurationSeconds[config.key] ?? job.input.requestDurationSeconds;
      const promptForModel = modelSpecificPrompts[config.key] ?? promptWithAttachments;
      const requestPlan = buildModelRenderRequest(
        config,
        {
          prompt: promptForModel,
          aspectRatio: sharedAspectRatio,
          durationSeconds: modelDurationSeconds
        },
        attachmentRefs
      );
      const { input, endpoint: endpointId } = requestPlan;
      let requestWarnings = [...requestPlan.warnings];
      const inputSummary = summarizeFalInput(input);
      const durationFromInput = typeof input.duration === "number" ? input.duration : Number.parseInt(String(input.duration), 10);
      if (requestPlan.mode === "image-to-video") {
        requestWarnings.push(`${config.label} used brief image attachment conditioning.`);
      }
      const uniqueWarnings = Array.from(new Set(requestWarnings.filter(Boolean)));
      if (uniqueWarnings.length > 0) {
        await mutateSoraStudioJob(jobId, (state) => {
          const nextWarnings = new Set<string>(state.warnings ?? []);
          for (const warning of uniqueWarnings) {
            nextWarnings.add(warning);
          }
          state.warnings = Array.from(nextWarnings);
        });
      }
      let requestId: string | undefined;

      await mutateSoraStudioJob(jobId, (state) => {
        const render = state.renders?.find((item) => item.key === config.key);
        if (render) {
          render.status = "running";
          render.startedAt = new Date().toISOString();
          render.completedAt = undefined;
          render.error = undefined;
          render.requestId = undefined;
          render.endpoint = endpointId;
          render.durationSeconds = durationFromInput;
          render.audioEnabled = requestPlan.audioEnabled;
          render.inputSummary = inputSummary;
          render.assetFile = undefined;
          render.assetUrl = undefined;
        }
        const renderStep = state.steps.find((step) => step.id === "video_render");
        if (renderStep) {
          renderStep.status = "running";
          renderStep.message = `Running ${config.label}...`;
        }
      });

      await appendRenderDebugLog(jobId, "render_model_submit", {
        modelKey: config.key,
        endpointId,
        mode: requestPlan.mode,
        warnings: uniqueWarnings,
        falInput: inputSummary
      });

      try {
        let result: FalSubscribeResult | undefined;
        let subscribeError: unknown;
        let lastQueueSignature = "";

        for (let attempt = 1; attempt <= FAL_SORA_SUBSCRIBE_ATTEMPTS; attempt += 1) {
          failureStage = `${config.key}:subscribe_attempt_${attempt}`;
          await appendRenderDebugLog(jobId, "render_model_subscribe_attempt", {
            modelKey: config.key,
            endpointId,
            attempt,
            maxAttempts: FAL_SORA_SUBSCRIBE_ATTEMPTS
          });

          try {
            result = await withTimeout(
              falClient.subscribe(endpointId, {
                input,
                mode: "polling",
                pollInterval: FAL_SORA_POLL_INTERVAL_MS,
                onQueueUpdate(update) {
                  const status = normalizeStatus(typeof update.status === "string" ? update.status : "in_progress");
                  const updateRequestId = typeof update.request_id === "string" ? update.request_id : undefined;
                  requestId = updateRequestId ?? requestId;
                  primaryOperationName = primaryOperationName ?? updateRequestId;

                  const signature = `${status}:${updateRequestId ?? "none"}`;
                  if (signature !== lastQueueSignature) {
                    lastQueueSignature = signature;
                    void appendRenderDebugLog(jobId, "render_model_queue_update", {
                      modelKey: config.key,
                      status,
                      requestId: updateRequestId,
                      attempt
                    });
                  }

                  void mutateSoraStudioJob(jobId, (state) => {
                    if (state.status === "completed" || state.status === "failed") {
                      return;
                    }
                    state.status = "running";
                    if (!state.operationName && updateRequestId) {
                      state.operationName = updateRequestId;
                    }
                    const render = state.renders?.find((item) => item.key === config.key);
                    if (render) {
                      if (render.status === "completed" || render.status === "failed") {
                        return;
                      }
                      render.status = "running";
                      render.requestId = updateRequestId;
                    }
                    const renderStep = state.steps.find((step) => step.id === "video_render");
                    if (renderStep) {
                      if (renderStep.status === "completed" || renderStep.status === "failed") {
                        return;
                      }
                      renderStep.status = "running";
                      renderStep.message = `${config.label}: ${status}`;
                      if (updateRequestId) {
                        renderStep.operationName = updateRequestId;
                      }
                    }
                  }).catch(() => undefined);
                }
              }),
              FAL_SORA_SUBSCRIBE_TIMEOUT_MS,
              `${config.label} operation timed out after ${Math.round(FAL_SORA_SUBSCRIBE_TIMEOUT_MS / 1000)} seconds.`
            );
            break;
          } catch (error) {
            subscribeError = error;
            const retryable = isRetryableSubscribeError(error);
            await appendRenderDebugLog(jobId, "render_model_subscribe_attempt_failed", {
              modelKey: config.key,
              endpointId,
              attempt,
              maxAttempts: FAL_SORA_SUBSCRIBE_ATTEMPTS,
              retryable,
              error: extractErrorChain(error)
            });
            if (!retryable || attempt >= FAL_SORA_SUBSCRIBE_ATTEMPTS) {
              throw error;
            }
            await sleep(FAL_SORA_SUBSCRIBE_RETRY_DELAY_MS * attempt);
          }
        }

        if (!result) {
          throw subscribeError instanceof Error ? subscribeError : new Error(String(subscribeError ?? "Subscribe failed."));
        }

        requestId = typeof result.requestId === "string" ? result.requestId : requestId;
        primaryOperationName = primaryOperationName ?? requestId;

        const outputSummary = summarizeFalOutput(result.data);
        await appendRenderDebugLog(jobId, "render_model_subscribe_success", {
          modelKey: config.key,
          endpointId,
          requestId,
          outputSummary
        });

        failureStage = `${config.key}:extract_output`;
        const videoResource = extractVideoResource(result.data);
        if (!videoResource) {
          throw new Error(`${config.label} output did not contain a generated video. output=${safeSerialize(result.data)}`);
        }

        failureStage = `${config.key}:download_video`;
        const videoBytes = await downloadVideoResource(videoResource, { jobId, requestId });

        failureStage = `${config.key}:persist_assets`;
        const assetFile = buildBriefVideoFileName(job.input.brief, jobId, modelResults.length + 1);
        const rawAssetFile = `${path.parse(assetFile).name}-raw.mp4`;
        const rawAssetPath = path.join(jobDir, rawAssetFile);
        const outputAssetPath = path.join(jobDir, assetFile);
        await fs.writeFile(rawAssetPath, videoBytes);

        failureStage = `${config.key}:post_process_branding`;
        const branded = await applySoraStudioProductBranding({
          input: job.input,
          inputPath: rawAssetPath,
          outputPath: outputAssetPath,
          rawAssetFile,
          outputAssetFile: assetFile,
          captionText: job.script
        });

        if (config.key === "sora2") {
          await fs.writeFile(path.join(jobDir, "raw-sora-studio.mp4"), videoBytes);
          await fs.copyFile(outputAssetPath, path.join(jobDir, "final-sora-studio.mp4"));
        }

        await mutateSoraStudioJob(jobId, (state) => {
          if (branded.warnings.length > 0) {
            const nextWarnings = new Set<string>(state.warnings ?? []);
            for (const warning of branded.warnings) {
              nextWarnings.add(`Branding: ${warning}`);
            }
            state.warnings = Array.from(nextWarnings);
          }
          const render = state.renders?.find((item) => item.key === config.key);
          if (render) {
            render.status = "completed";
            render.requestId = requestId;
            render.completedAt = new Date().toISOString();
            render.error = undefined;
            render.outputSummary = outputSummary;
            render.assetFile = assetFile;
            render.assetUrl = undefined;
            render.postProcess = branded.postProcess;
          }
          state.assets.sora2Mp4 = config.key === "sora2" ? assetFile : state.assets.sora2Mp4;
          state.assets.seedance2Mp4 = config.key === "seedance2" ? assetFile : state.assets.seedance2Mp4;
          state.assets.klingv3Mp4 = config.key === "klingv3" ? assetFile : state.assets.klingv3Mp4;
          if (config.key === "sora2") {
            state.assets.rawMp4 = "raw-sora-studio.mp4";
            state.assets.finalMp4 = "final-sora-studio.mp4";
          }
          const renderStep = state.steps.find((step) => step.id === "video_render");
          if (renderStep) {
            renderStep.status = "running";
            renderStep.message = `${config.label} completed.`;
            renderStep.operationName = requestId;
          }
        });

        await appendRenderDebugLog(jobId, "render_model_asset_write_success", {
          modelKey: config.key,
          requestId,
          endpointId,
          downloadedBytes: videoBytes.length,
          finalBytes: branded.bytes.length,
          file: assetFile,
          rawFile: rawAssetFile,
          postProcess: branded.postProcess
        });

        await maybeSendSoraStudioRenderEmail(jobId, config.key);

        modelResults.push({
          key: config.key,
          label: config.label,
          endpoint: endpointId,
          status: "completed",
          requestId,
          assetFile,
          bytes: branded.bytes.length,
          videoBytes: branded.bytes,
          inputSummary: summarizeFalInput(input),
          outputSummary,
          postProcess: branded.postProcess
        });
      } catch (error) {
        const errorMessage = toFailureMessage(failureStage, error, requestId);
        await appendRenderDebugLog(jobId, "render_model_failed", {
          modelKey: config.key,
          endpointId,
          requestId,
          error: extractErrorChain(error)
        });

        await mutateSoraStudioJob(jobId, (state) => {
          const render = state.renders?.find((item) => item.key === config.key);
          if (render) {
            render.status = "failed";
            render.requestId = requestId;
            render.completedAt = new Date().toISOString();
            render.error = errorMessage;
          }
          const renderStep = state.steps.find((step) => step.id === "video_render");
          if (renderStep) {
            renderStep.status = "running";
            renderStep.message = `${config.label} failed; continuing remaining models.`;
            if (requestId) {
              renderStep.operationName = requestId;
            }
          }
        });

        modelResults.push({
          key: config.key,
          label: config.label,
          endpoint: endpointId,
          status: "failed",
          requestId,
          error: errorMessage,
          inputSummary: summarizeFalInput(input)
        });
      }
    }

    const successful = modelResults.filter(
      (item): item is ModelRenderResult & { assetFile: string; bytes: number; videoBytes: Buffer } =>
        item.status === "completed" &&
        typeof item.assetFile === "string" &&
        typeof item.bytes === "number" &&
        item.videoBytes instanceof Buffer
    );
    const failed = modelResults.filter((item) => item.status === "failed");

    const renderManifest = {
      generatedAt: new Date().toISOString(),
      jobId,
      promptPlan,
      modelOptimizedPrompts: optimizedPromptMetadata,
      aspectRatio: sharedAspectRatio,
      requestedDurationSeconds: durationPlan.requestedDurationSeconds,
      strictParityMode: durationPlan.strictParityMode,
      parityAligned: durationPlan.parityAligned,
      perModelDurationSeconds: durationPlan.perModelDurationSeconds,
      durationWarnings: durationPlan.warnings,
      models: modelResults.map((item) => ({
        key: item.key,
        label: item.label,
        endpoint: item.endpoint,
        status: item.status,
        requestId: item.requestId,
        assetFile: item.assetFile,
        bytes: typeof item.bytes === "number" ? item.bytes : undefined,
        error: item.error,
        inputSummary: item.inputSummary,
        outputSummary: item.outputSummary,
        postProcess: item.postProcess
      }))
    };
    await fs.writeFile(path.join(jobDir, "render-manifest.json"), `${JSON.stringify(renderManifest, null, 2)}\n`, "utf8");
    await appendRenderDebugLog(jobId, "render_manifest_written", {
      file: "render-manifest.json",
      successCount: successful.length,
      failedCount: failed.length
    });

    const refreshedJob = await requireSoraStudioJob(jobId);
    if (successful.length > 0) {
      const delivery = await createDeliverableBundle(
        refreshedJob,
        successful.map((item) => ({ key: item.key, fileName: item.assetFile, bytes: item.videoBytes }))
      );
      await appendRenderDebugLog(jobId, "render_delivery_bundle_written", {
        deliveryRoot: DELIVERABLES_ROOT,
        folderName: delivery.folderName,
        videoFileNames: delivery.videoFileNames,
        textFileName: delivery.textFileName
      });
    }

    await mutateSoraStudioJob(jobId, (state) => {
      state.assets.debugLog = state.assets.debugLog ?? DEBUG_LOG_FILE;
      state.assets.renderManifestJson = "render-manifest.json";
      state.operationName = primaryOperationName;

      const renderStep = state.steps.find((step) => step.id === "video_render");
      if (renderStep) {
        renderStep.operationName = primaryOperationName;
        renderStep.completedAt = new Date().toISOString();
      }

      if (failed.length === 0 && successful.length === ACTIVE_MODEL_RENDER_CONFIGS.length) {
        state.status = "completed";
        state.error = undefined;
        if (renderStep) {
          renderStep.status = "completed";
          renderStep.error = undefined;
          renderStep.message = "All model renders completed.";
        }
      } else {
        const failedLabels = failed.map((item) => item.label).join(", ");
        const finalMessage =
          successful.length > 0
            ? `Some model renders failed: ${failedLabels}. Successful renders are available in job assets.`
            : `All model renders failed: ${failedLabels}.`;
        state.status = "failed";
        state.error = finalMessage;
        if (renderStep) {
          renderStep.status = "failed";
          renderStep.error = finalMessage;
          renderStep.message = successful.length > 0 ? "Partial model render failure." : "All model renders failed.";
        }
      }
    });

    await appendRenderDebugLog(jobId, "render_complete", {
      requestId: primaryOperationName,
      successCount: successful.length,
      failedCount: failed.length
    });
  } catch (error) {
    const finalMessage = toFailureMessage(failureStage, error, primaryOperationName);

    await appendRenderDebugLog(jobId, "render_failed", {
      failureStage,
      requestId: primaryOperationName,
      error: extractErrorChain(error)
    });

    await mutateSoraStudioJob(jobId, (job) => {
      job.status = "failed";
      job.error = finalMessage;
      job.operationName = primaryOperationName;
      job.assets.debugLog = job.assets.debugLog ?? DEBUG_LOG_FILE;
      job.assets.renderManifestJson = job.assets.renderManifestJson ?? "render-manifest.json";
      const renderStep = job.steps.find((step) => step.id === "video_render");
      if (renderStep) {
        renderStep.status = "failed";
        renderStep.operationName = primaryOperationName;
        renderStep.error = finalMessage;
        renderStep.completedAt = new Date().toISOString();
        renderStep.message = `Render failed at ${failureStage}.`;
      }
    });

    throw new Error(finalMessage);
  }
}

export async function runSoraStudioPromptOptimizationDryRun(jobId: string): Promise<void> {
  const job = await requireSoraStudioJob(jobId);
  const plan = await buildPromptOptimizationPlan({ job, jobId });

  await mutateSoraStudioJob(jobId, (state) => {
    state.renderPromptSource = plan.promptPlan.source;
    state.renderPromptOriginalChars = plan.promptPlan.originalChars;
    state.renderPromptFinalChars = plan.promptWithAttachments.length;
    state.renderPromptUsed = plan.promptWithAttachments;
    state.modelOptimizedPrompts = Object.keys(plan.optimizedPromptMetadata).length > 0 ? plan.optimizedPromptMetadata : undefined;
    if (plan.durationPlan.warnings.length > 0 || plan.warnings.length > 0) {
      const nextWarnings = new Set<string>(state.warnings ?? []);
      for (const warning of plan.durationPlan.warnings) {
        nextWarnings.add(warning);
      }
      for (const warning of plan.warnings) {
        nextWarnings.add(warning);
      }
      state.warnings = Array.from(nextWarnings);
    }
    const renderStep = state.steps.find((step) => step.id === "video_render");
    if (renderStep) {
      renderStep.message = "Prompt optimization dry run completed (no video render).";
      renderStep.model = `${ACTIVE_MODEL_RENDER_CONFIGS.map((item) => item.key).join(" + ")} | optimizer:${PROMPT_OPTIMIZER_MODEL}`;
    }
  });

  await appendRenderDebugLog(jobId, "render_prompt_optimization_dry_run_complete", {
    promptSource: plan.promptPlan.source,
    promptChars: plan.promptWithAttachments.length,
    optimizedKeys: Object.keys(plan.optimizedPromptMetadata),
    durationPlan: plan.durationPlan
  });
}

export async function retrySoraStudioJob(jobId: string): Promise<void> {
  const existing = await requireSoraStudioJob(jobId);
  const previousAssetFiles = new Set(
    [
      existing.assets.rawMp4,
      existing.assets.finalMp4,
      existing.assets.sora2Mp4,
      existing.assets.seedance2Mp4,
      existing.assets.klingv3Mp4,
      ...(existing.renders ?? []).flatMap((render) => [render.assetFile, render.postProcess?.rawAssetFile])
    ].filter((value): value is string => typeof value === "string" && value.endsWith(".mp4"))
  );

  await mutateSoraStudioJob(jobId, (job) => {
    job.status = "queued";
    job.error = undefined;
    job.operationName = undefined;
    job.assets.debugLog = job.assets.debugLog ?? DEBUG_LOG_FILE;
    job.assets.rawMp4 = undefined;
    job.assets.finalMp4 = undefined;
    job.assets.sora2Mp4 = undefined;
    job.assets.seedance2Mp4 = undefined;
    job.assets.klingv3Mp4 = undefined;
    job.assets.renderManifestJson = "render-manifest.json";
    job.renderPromptSource = undefined;
    job.renderPromptOriginalChars = undefined;
    job.renderPromptFinalChars = undefined;
    job.renderPromptUsed = undefined;
    job.modelOptimizedPrompts = undefined;
    job.renders = ACTIVE_MODEL_RENDER_CONFIGS.map((item) => ({
      key: item.key,
      label: item.label,
      endpoint: item.textEndpoint,
      status: "pending",
      audioEnabled: item.audioEnabledText
    }));
    const renderStep = job.steps.find((step) => step.id === "video_render");
    if (renderStep) {
      renderStep.status = "pending";
      renderStep.operationName = undefined;
      renderStep.message = "Waiting to start model renders.";
      renderStep.startedAt = undefined;
      renderStep.completedAt = undefined;
      renderStep.error = undefined;
    }
  });

  const jobDir = getSoraStudioJobDir(jobId);
  await Promise.all([
    fs.unlink(path.join(jobDir, "raw-sora-studio.mp4")).catch(() => undefined),
    fs.unlink(path.join(jobDir, "final-sora-studio.mp4")).catch(() => undefined),
    fs.unlink(path.join(jobDir, "sora2.mp4")).catch(() => undefined),
    fs.unlink(path.join(jobDir, "seedance2.mp4")).catch(() => undefined),
    fs.unlink(path.join(jobDir, "klingv3.mp4")).catch(() => undefined),
    ...Array.from(previousAssetFiles).map((fileName) => fs.unlink(path.join(jobDir, path.basename(fileName))).catch(() => undefined)),
    fs.unlink(path.join(jobDir, "render-manifest.json")).catch(() => undefined)
  ]);

  await appendRenderDebugLog(jobId, "render_retry_requested");
  await runSoraStudioJob(jobId);
}
