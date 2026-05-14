import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ensureSoraStudioRoot, getSoraStudioGeneratedRoot } from "./store";
import { SoraStudioClientJob, SoraStudioRenderModelKey } from "./types";

const TRACKER_FILE_NAME = "feedback-tracker.jsonl";

export interface SoraStudioFeedbackTrackerEntry {
  entryId: string;
  recordedAt: string;
  trigger: "feedback_saved";
  job: {
    id: string;
    status: SoraStudioClientJob["status"];
    createdAt: string;
    updatedAt: string;
  };
  input: SoraStudioClientJob["input"];
  feedback: SoraStudioClientJob["feedback"];
  stageOutputs: {
    scriptGeneration: {
      provider?: string;
      model?: string;
      status?: string;
      compactedBrief?: string;
      scriptWriterPrompt?: string;
      script: string;
    };
    promptGeneration: {
      provider?: string;
      model?: string;
      status?: string;
      soraPrompt: string;
      modelOptimizedPrompts?: SoraStudioClientJob["modelOptimizedPrompts"];
      renderPromptUsed?: string;
      renderPromptSource?: string;
      renderPromptOriginalChars?: number;
      renderPromptFinalChars?: number;
    };
    videoRender: {
      provider?: string;
      model?: string;
      status?: string;
      message?: string;
      perModel: Array<{
        key: SoraStudioRenderModelKey;
        label: string;
        status: string;
        requestId?: string;
        durationSeconds?: number;
        audioEnabled?: boolean;
        error?: string;
        inputSummary?: Record<string, unknown>;
        outputSummary?: Record<string, unknown>;
        assetFile?: string;
        relativeVideoUrl?: string;
        absoluteVideoUrl?: string;
      }>;
    };
  };
  finalVideoLinks: {
    sora2?: { relative?: string; absolute?: string };
    seedance2?: { relative?: string; absolute?: string };
  };
}

function getTrackerFilePath(): string {
  return path.join(getSoraStudioGeneratedRoot(), TRACKER_FILE_NAME);
}

function toAbsoluteUrl(url: string | undefined, origin: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  if (!origin) {
    return undefined;
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  if (url.startsWith("/")) {
    return `${origin}${url}`;
  }
  return `${origin}/${url}`;
}

function renderVideoUrl(job: SoraStudioClientJob, key: SoraStudioRenderModelKey): string | undefined {
  if (key === "sora2") {
    return job.assets.sora2Mp4Url ?? job.assets.finalMp4Url;
  }
  if (key === "seedance2") {
    return job.assets.seedance2Mp4Url;
  }
  return undefined;
}

function stepById(job: SoraStudioClientJob, id: "script_generation" | "prompt_generation" | "video_render") {
  return job.steps.find((step) => step.id === id);
}

export function buildFeedbackTrackerEntry(
  job: SoraStudioClientJob,
  options: { origin?: string; trigger: "feedback_saved" }
): SoraStudioFeedbackTrackerEntry {
  const recordedAt = new Date().toISOString();
  const scriptStep = stepById(job, "script_generation");
  const promptStep = stepById(job, "prompt_generation");
  const renderStep = stepById(job, "video_render");

  const perModel = (job.renders ?? []).map((render) => {
    const relativeVideoUrl = render.assetUrl ?? renderVideoUrl(job, render.key);
    return {
      key: render.key,
      label: render.label,
      status: render.status,
      requestId: render.requestId,
      durationSeconds: render.durationSeconds,
      audioEnabled: render.audioEnabled,
      error: render.error,
      inputSummary: render.inputSummary,
      outputSummary: render.outputSummary,
      assetFile: render.assetFile,
      relativeVideoUrl,
      absoluteVideoUrl: toAbsoluteUrl(relativeVideoUrl, options.origin)
    };
  });

  const sora2Relative = renderVideoUrl(job, "sora2");
  const seedanceRelative = renderVideoUrl(job, "seedance2");

  return {
    entryId: `${Date.now()}-${randomUUID().slice(0, 8)}`,
    recordedAt,
    trigger: options.trigger,
    job: {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    },
    input: job.input,
    feedback: job.feedback,
    stageOutputs: {
      scriptGeneration: {
        provider: scriptStep?.provider,
        model: scriptStep?.model,
        status: scriptStep?.status,
        compactedBrief: job.compactedBrief,
        scriptWriterPrompt: job.scriptWriterPrompt,
        script: job.script
      },
      promptGeneration: {
        provider: promptStep?.provider,
        model: promptStep?.model,
        status: promptStep?.status,
        soraPrompt: job.soraPrompt,
        modelOptimizedPrompts: job.modelOptimizedPrompts,
        renderPromptUsed: job.renderPromptUsed,
        renderPromptSource: job.renderPromptSource,
        renderPromptOriginalChars: job.renderPromptOriginalChars,
        renderPromptFinalChars: job.renderPromptFinalChars
      },
      videoRender: {
        provider: renderStep?.provider,
        model: renderStep?.model,
        status: renderStep?.status,
        message: renderStep?.message,
        perModel
      }
    },
    finalVideoLinks: {
      sora2: sora2Relative ? { relative: sora2Relative, absolute: toAbsoluteUrl(sora2Relative, options.origin) } : undefined,
      seedance2: seedanceRelative
        ? { relative: seedanceRelative, absolute: toAbsoluteUrl(seedanceRelative, options.origin) }
        : undefined
    }
  };
}

export async function appendFeedbackTrackerEntry(
  job: SoraStudioClientJob,
  options: { origin?: string; trigger: "feedback_saved" }
): Promise<SoraStudioFeedbackTrackerEntry> {
  await ensureSoraStudioRoot();
  const entry = buildFeedbackTrackerEntry(job, options);
  await fs.appendFile(getTrackerFilePath(), `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export async function listFeedbackTrackerEntries(limit = 200): Promise<SoraStudioFeedbackTrackerEntry[]> {
  await ensureSoraStudioRoot();
  const filePath = getTrackerFilePath();
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }

  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed: SoraStudioFeedbackTrackerEntry[] = [];
  for (const line of lines) {
    try {
      const item = JSON.parse(line) as SoraStudioFeedbackTrackerEntry;
      parsed.push(item);
    } catch {
      // Skip malformed lines, keep parsing remaining entries.
    }
  }

  const bounded = Math.max(1, Math.min(limit, 10000));
  return parsed.slice(-bounded).reverse();
}

export async function getFeedbackTrackerEntryCount(): Promise<number> {
  await ensureSoraStudioRoot();
  const filePath = getTrackerFilePath();
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return 0;
  }

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function csvEscape(value: unknown): string {
  if (value === null || typeof value === "undefined") {
    return "";
  }
  const stringValue = typeof value === "string" ? value : JSON.stringify(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }
  return stringValue;
}

export function feedbackTrackerEntriesToCsv(entries: SoraStudioFeedbackTrackerEntry[]): string {
  const headers = [
    "recordedAt",
    "entryId",
    "jobId",
    "jobStatus",
    "product",
    "brief",
    "businessObjective",
    "creativeObjectiveFunnel",
    "videoDuration",
    "ratioDimensions",
    "language",
    "sora2Status",
    "seedance2Status",
    "sora2VideoAbsolute",
    "seedance2VideoAbsolute",
    "sora2Rating",
    "seedance2Rating",
    "sora2Comment",
    "seedance2Comment",
    "overallComment",
    "stageOutputsJson"
  ];

  const rows = [headers.join(",")];
  for (const entry of entries) {
    const statusByModel = Object.fromEntries(entry.stageOutputs.videoRender.perModel.map((model) => [model.key, model.status]));
    const variants = entry.feedback?.variants ?? {};
    const row = [
      entry.recordedAt,
      entry.entryId,
      entry.job.id,
      entry.job.status,
      entry.input.product,
      entry.input.brief,
      entry.input.businessObjective,
      entry.input.creativeObjectiveFunnel,
      entry.input.videoDuration,
      entry.input.ratioDimensions,
      entry.input.language,
      statusByModel.sora2,
      statusByModel.seedance2,
      entry.finalVideoLinks.sora2?.absolute,
      entry.finalVideoLinks.seedance2?.absolute,
      variants.sora2?.rating,
      variants.seedance2?.rating,
      variants.sora2?.comment,
      variants.seedance2?.comment,
      entry.feedback?.overallComment,
      entry.stageOutputs
    ].map(csvEscape);

    rows.push(row.join(","));
  }

  return `${rows.join("\n")}\n`;
}
