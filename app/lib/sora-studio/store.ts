import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  SoraStudioClientJob,
  SoraStudioFeedback,
  SoraStudioJobCreateInput,
  SoraStudioJobRecord,
  SoraStudioRenderModelKey,
  SoraStudioRenderModelStatus,
  SoraStudioJobStatus,
  SoraStudioStepStatus
} from "./types";

const GENERATED_ROOT = path.join(process.cwd(), "generated-sora-studio");
const JOB_STATE_FILE = "job.json";
const FAL_SORA_TEXT_MODEL = process.env.FAL_SORA_TEXT_MODEL?.trim() || "fal-ai/sora-2/text-to-video/pro";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isSoraStudioStatus(value: unknown): value is SoraStudioJobStatus {
  return value === "queued" || value === "running" || value === "completed" || value === "failed";
}

function isSoraStudioStepStatus(value: unknown): value is SoraStudioStepStatus {
  return value === "pending" || value === "running" || value === "completed" || value === "failed";
}

function isSoraStudioRenderModelKey(value: unknown): value is SoraStudioRenderModelKey {
  return value === "sora2" || value === "seedance2" || value === "klingv3";
}

function isSoraStudioRenderModelStatus(value: unknown): value is SoraStudioRenderModelStatus {
  return value === "pending" || value === "running" || value === "completed" || value === "failed";
}

function isValidModelOptimizedPrompts(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  for (const [key, item] of Object.entries(value)) {
    if (!isSoraStudioRenderModelKey(key)) {
      return false;
    }
    if (!isRecord(item)) {
      return false;
    }
    if (
      !isString(item.provider) ||
      !isString(item.model) ||
      typeof item.basePromptChars !== "number" ||
      typeof item.optimizedPromptChars !== "number" ||
      typeof item.dialogueLinesLocked !== "number" ||
      !isString(item.prompt) ||
      (typeof item.warnings !== "undefined" &&
        (!Array.isArray(item.warnings) || !item.warnings.every((warning) => isString(warning))))
    ) {
      return false;
    }
  }

  return true;
}

function isValidVariantFeedback(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.rating !== "undefined") {
    if (typeof value.rating !== "number" || !Number.isInteger(value.rating) || value.rating < 1 || value.rating > 5) {
      return false;
    }
  }

  if (typeof value.comment !== "undefined" && !isString(value.comment)) {
    return false;
  }

  if (typeof value.updatedAt !== "undefined" && !isString(value.updatedAt)) {
    return false;
  }

  return true;
}

function isValidFeedback(value: unknown): value is SoraStudioFeedback {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.overallComment !== "undefined" && !isString(value.overallComment)) {
    return false;
  }

  if (typeof value.updatedAt !== "undefined" && !isString(value.updatedAt)) {
    return false;
  }

  if (typeof value.variants !== "undefined") {
    if (!isRecord(value.variants)) {
      return false;
    }

    for (const key of Object.keys(value.variants)) {
      if (!isSoraStudioRenderModelKey(key)) {
        return false;
      }
      if (!isValidVariantFeedback(value.variants[key])) {
        return false;
      }
    }
  }

  return true;
}

function isValidEmailNotifications(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  for (const [key, item] of Object.entries(value)) {
    if (!isSoraStudioRenderModelKey(key) || !isRecord(item)) {
      return false;
    }
    if (
      !isString(item.toEmail) ||
      (typeof item.sentAt !== "undefined" && !isString(item.sentAt)) ||
      (typeof item.assetFile !== "undefined" && !isString(item.assetFile)) ||
      (typeof item.videoUrl !== "undefined" && !isString(item.videoUrl)) ||
      (typeof item.error !== "undefined" && !isString(item.error))
    ) {
      return false;
    }
  }

  return true;
}

function isValidJob(value: unknown): value is SoraStudioJobRecord {
  if (!isRecord(value)) {
    return false;
  }

  if (
    !isString(value.id) ||
    !isSoraStudioStatus(value.status) ||
    !isString(value.createdAt) ||
    !isString(value.updatedAt) ||
    !isRecord(value.input) ||
    (typeof value.compactedBrief !== "undefined" && !isString(value.compactedBrief)) ||
    (typeof value.scriptWriterPrompt !== "undefined" && !isString(value.scriptWriterPrompt)) ||
    (typeof value.renderPromptUsed !== "undefined" && !isString(value.renderPromptUsed)) ||
    (typeof value.renderPromptSource !== "undefined" &&
      value.renderPromptSource !== "raw_sora_prompt" &&
      value.renderPromptSource !== "compacted_sora_prompt" &&
      value.renderPromptSource !== "script_fallback_prompt") ||
    (typeof value.renderPromptOriginalChars !== "undefined" && typeof value.renderPromptOriginalChars !== "number") ||
    (typeof value.renderPromptFinalChars !== "undefined" && typeof value.renderPromptFinalChars !== "number") ||
    (typeof value.feedback !== "undefined" && !isValidFeedback(value.feedback)) ||
    !isString(value.script) ||
    !isString(value.soraPrompt) ||
    (typeof value.modelOptimizedPrompts !== "undefined" && !isValidModelOptimizedPrompts(value.modelOptimizedPrompts)) ||
    (typeof value.emailNotifications !== "undefined" && !isValidEmailNotifications(value.emailNotifications)) ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every((item) => isString(item)) ||
    (typeof value.renders !== "undefined" &&
      (!Array.isArray(value.renders) ||
        !value.renders.every((render) => {
          if (!isRecord(render)) {
            return false;
          }
          return (
            isSoraStudioRenderModelKey(render.key) &&
            isString(render.label) &&
            isString(render.endpoint) &&
            isSoraStudioRenderModelStatus(render.status) &&
            (typeof render.requestId === "undefined" || isString(render.requestId)) &&
            (typeof render.startedAt === "undefined" || isString(render.startedAt)) &&
            (typeof render.completedAt === "undefined" || isString(render.completedAt)) &&
            (typeof render.error === "undefined" || isString(render.error)) &&
            (typeof render.durationSeconds === "undefined" || typeof render.durationSeconds === "number") &&
            (typeof render.audioEnabled === "undefined" || typeof render.audioEnabled === "boolean") &&
            (typeof render.inputSummary === "undefined" || isRecord(render.inputSummary)) &&
            (typeof render.outputSummary === "undefined" || isRecord(render.outputSummary)) &&
            (typeof render.assetFile === "undefined" || isString(render.assetFile)) &&
            (typeof render.assetUrl === "undefined" || isString(render.assetUrl))
          );
        }))) ||
    (typeof value.steps !== "undefined" &&
      (!Array.isArray(value.steps) ||
        !value.steps.every((step) => {
          if (!isRecord(step)) {
            return false;
          }
          return (
            isString(step.id) &&
            isString(step.label) &&
            isSoraStudioStepStatus(step.status) &&
            (typeof step.provider === "undefined" || isString(step.provider)) &&
            (typeof step.model === "undefined" || isString(step.model)) &&
            (typeof step.operationName === "undefined" || isString(step.operationName)) &&
            (typeof step.message === "undefined" || isString(step.message)) &&
            (typeof step.startedAt === "undefined" || isString(step.startedAt)) &&
            (typeof step.completedAt === "undefined" || isString(step.completedAt)) &&
            (typeof step.error === "undefined" || isString(step.error))
          );
        }))) ||
    !isRecord(value.assets)
  ) {
    return false;
  }

  const assets = value.assets as Record<string, unknown>;
  return (
    isString(assets.inputJson) &&
    isString(assets.jobJson) &&
    (typeof assets.debugLog === "undefined" || isString(assets.debugLog)) &&
    (typeof assets.rawMp4 === "undefined" || isString(assets.rawMp4)) &&
    (typeof assets.finalMp4 === "undefined" || isString(assets.finalMp4)) &&
    (typeof assets.sora2Mp4 === "undefined" || isString(assets.sora2Mp4)) &&
    (typeof assets.seedance2Mp4 === "undefined" || isString(assets.seedance2Mp4)) &&
    (typeof assets.klingv3Mp4 === "undefined" || isString(assets.klingv3Mp4)) &&
    (typeof assets.renderManifestJson === "undefined" || isString(assets.renderManifestJson)) &&
    (typeof value.error === "undefined" || isString(value.error)) &&
    (typeof value.operationName === "undefined" || isString(value.operationName))
  );
}

function ensureSteps(job: SoraStudioJobRecord): SoraStudioJobRecord {
  const hasScriptStep = Array.isArray(job.steps) && job.steps.some((step) => step.id === "script_generation");
  const hasPromptStep = Array.isArray(job.steps) && job.steps.some((step) => step.id === "prompt_generation");
  const hasRenderStep = Array.isArray(job.steps) && job.steps.some((step) => step.id === "video_render");
  if (hasScriptStep && hasPromptStep && hasRenderStep) {
    return job;
  }

  return {
    ...job,
    renders:
      Array.isArray(job.renders) && job.renders.length > 0
        ? job.renders
        : [
            {
              key: "seedance2",
              label: "Seedance 2.0",
              endpoint: "bytedance/seedance-2.0/text-to-video",
              status: job.status === "completed" ? "completed" : job.status === "failed" ? "failed" : "pending",
              requestId: job.operationName,
              error: job.error,
              assetFile: job.assets.seedance2Mp4
            }
          ],
    steps: [
      {
        id: "script_generation",
        label: "Script Generation",
        status: "completed",
        provider: "unknown",
        model: "unknown",
        message: "Script generated."
      },
      {
        id: "prompt_generation",
        label: "Prompt Generation",
        status: "completed",
        provider: "unknown",
        model: "unknown",
        message: "Sora prompt generated."
      },
      {
        id: "video_render",
        label: "Multi-Model Render",
        status: job.status === "completed" ? "completed" : job.status === "failed" ? "failed" : "pending",
        provider: "fal-multi-model",
        model: "seedance2",
        operationName: job.operationName,
        error: job.error,
        message:
          job.status === "completed"
            ? "All model renders completed."
            : job.status === "failed"
              ? "Render failed."
              : "Waiting to start model renders."
      }
    ]
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function getSoraStudioGeneratedRoot(): string {
  return GENERATED_ROOT;
}

export function getSoraStudioJobDir(jobId: string): string {
  return path.join(GENERATED_ROOT, jobId);
}

function getSoraStudioJobStatePath(jobId: string): string {
  return path.join(getSoraStudioJobDir(jobId), JOB_STATE_FILE);
}

export async function ensureSoraStudioRoot(): Promise<void> {
  await fs.mkdir(GENERATED_ROOT, { recursive: true });
}

export async function persistSoraStudioJob(job: SoraStudioJobRecord): Promise<SoraStudioJobRecord> {
  const next: SoraStudioJobRecord = {
    ...job,
    updatedAt: new Date().toISOString()
  };
  await fs.mkdir(getSoraStudioJobDir(next.id), { recursive: true });
  await writeJson(getSoraStudioJobStatePath(next.id), next);
  return next;
}

export async function createSoraStudioJob(input: SoraStudioJobCreateInput): Promise<SoraStudioJobRecord> {
  await ensureSoraStudioRoot();
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  const job: SoraStudioJobRecord = {
    id,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    input: input.input,
    compactedBrief: input.compactedBrief,
    scriptWriterPrompt: input.scriptWriterPrompt,
    script: input.script,
    soraPrompt: input.soraPrompt,
    warnings: input.warnings ?? [],
    steps: [
      {
        id: "script_generation",
        label: "Script Generation",
        status: "completed",
        provider: "anthropic-via-fal-openrouter",
        model: input.scriptModel,
        completedAt: now,
        message: "Script generated."
      },
      {
        id: "prompt_generation",
        label: "Prompt Generation",
        status: "completed",
        provider: "anthropic-via-fal-openrouter",
        model: input.promptModel,
        completedAt: now,
        message: "Sora prompt generated."
      },
      {
        id: "video_render",
        label: "Multi-Model Render",
        status: "pending",
        provider: "fal-multi-model",
        model: "seedance2",
        message: "Waiting to start model renders."
      }
    ],
    renders: [
      {
        key: "seedance2",
        label: "Seedance 2.0",
        endpoint: "bytedance/seedance-2.0/text-to-video",
        status: "pending"
      }
    ],
    assets: {
      inputJson: "input.json",
      jobJson: JOB_STATE_FILE,
      debugLog: "render-debug.log",
      renderManifestJson: "render-manifest.json"
    }
  };

  await fs.mkdir(getSoraStudioJobDir(id), { recursive: true });
  await writeJson(path.join(getSoraStudioJobDir(id), "input.json"), {
    input: input.input,
    compactedBrief: input.compactedBrief,
    scriptWriterPrompt: input.scriptWriterPrompt,
    script: input.script,
    soraPrompt: input.soraPrompt,
    scriptModel: input.scriptModel,
    promptModel: input.promptModel,
    warnings: input.warnings ?? [],
    createdAt: now
  });

  return persistSoraStudioJob(job);
}

export async function getSoraStudioJob(jobId: string): Promise<SoraStudioJobRecord | null> {
  try {
    const raw = await fs.readFile(getSoraStudioJobStatePath(jobId), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidJob(parsed)) {
      return null;
    }
    return ensureSteps(parsed);
  } catch {
    return null;
  }
}

export async function requireSoraStudioJob(jobId: string): Promise<SoraStudioJobRecord> {
  const job = await getSoraStudioJob(jobId);
  if (!job) {
    throw new Error(`Sora Studio job ${jobId} not found.`);
  }
  return job;
}

export async function mutateSoraStudioJob(
  jobId: string,
  mutate: (job: SoraStudioJobRecord) => void | SoraStudioJobRecord
): Promise<SoraStudioJobRecord> {
  const current = await requireSoraStudioJob(jobId);
  const draft = structuredClone(current);
  const next = mutate(draft) ?? draft;
  return persistSoraStudioJob(next);
}

export async function listSoraStudioJobs(
  limit = 20,
  options?: {
    briefQuery?: string;
  }
): Promise<SoraStudioJobRecord[]> {
  await ensureSoraStudioRoot();
  const entries = await fs.readdir(GENERATED_ROOT, { withFileTypes: true });
  const jobs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => getSoraStudioJob(entry.name))
  );

  const normalizedBriefQuery = options?.briefQuery?.trim().toLowerCase() ?? "";

  return jobs
    .filter((job): job is SoraStudioJobRecord => Boolean(job))
    .filter((job) => {
      if (!normalizedBriefQuery) {
        return true;
      }
      return job.input.brief.toLowerCase().includes(normalizedBriefQuery);
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, Math.max(1, Math.min(limit, 200)));
}

export function toClientSoraStudioJob(job: SoraStudioJobRecord): SoraStudioClientJob {
  const base = `/api/sora-studio/jobs/${job.id}/asset`;
  const renderAssetUrl = (assetFile?: string): string | undefined => (assetFile ? `${base}/${assetFile}` : undefined);
  const renders = Array.isArray(job.renders)
    ? job.renders.map((render) => ({
        ...render,
        assetUrl: render.assetFile ? renderAssetUrl(render.assetFile) : render.assetUrl
      }))
    : undefined;
  return {
    ...job,
    renders,
    assets: {
      ...job.assets,
      inputJsonUrl: `${base}/${job.assets.inputJson}`,
      jobJsonUrl: `${base}/${job.assets.jobJson}`,
      debugLogUrl: job.assets.debugLog ? `${base}/${job.assets.debugLog}` : undefined,
      rawMp4Url: job.assets.rawMp4 ? `${base}/${job.assets.rawMp4}` : undefined,
      finalMp4Url: job.assets.finalMp4 ? `${base}/${job.assets.finalMp4}` : undefined,
      sora2Mp4Url: job.assets.sora2Mp4 ? `${base}/${job.assets.sora2Mp4}` : undefined,
      seedance2Mp4Url: job.assets.seedance2Mp4 ? `${base}/${job.assets.seedance2Mp4}` : undefined,
      klingv3Mp4Url: job.assets.klingv3Mp4 ? `${base}/${job.assets.klingv3Mp4}` : undefined,
      renderManifestJsonUrl: job.assets.renderManifestJson ? `${base}/${job.assets.renderManifestJson}` : undefined
    }
  };
}
