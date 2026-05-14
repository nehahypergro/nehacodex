import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  ClientJob,
  DEFAULT_PROMPT_WRITER_VERSION,
  DEFAULT_VIDEO_CONFIG,
  EmailDeliveryConfig,
  HowToConfig,
  JobCreateInput,
  JobRecord,
  JobStatus,
  JobStep,
  ProductKey,
  PromptWriterVersion,
  VideoConfig,
  VIDEO_TYPES,
  PROMPT_WRITER_VERSIONS,
  SupersConfig,
  StepId,
  StepStatus,
  VIDEO_PROVIDERS
} from "./types";

const GENERATED_ROOT = path.join(process.cwd(), "generated");
const JOB_STATE_FILE = "job.json";
const STALE_RUNNING_RECONCILE_MS = 2 * 60 * 1000;

interface JobStoreGlobal {
  __kotakJobs?: Map<string, JobRecord>;
}

const STORE: Map<string, JobRecord> = (globalThis as JobStoreGlobal).__kotakJobs ?? new Map();
if (!(globalThis as JobStoreGlobal).__kotakJobs) {
  (globalThis as JobStoreGlobal).__kotakJobs = STORE;
}

export const STEP_LABELS: Record<StepId, string> = {
  backstory: "Persona Agent",
  keyframe: "Visual Agent",
  video: "Motion Agent",
  finalize: "Delivery Agent"
};

const VALID_PRODUCT_KEYS: ReadonlySet<ProductKey> = new Set(["kotak_air_plus", "kotak_cashback"]);
const VALID_PROMPT_WRITER_VERSIONS: ReadonlySet<PromptWriterVersion> = new Set(PROMPT_WRITER_VERSIONS);
const VALID_SUPERS_TIMING_MODES: ReadonlySet<SupersConfig["timingMode"]> = new Set(["fast", "accurate"]);
const VALID_SUPERS_TEMPLATES: ReadonlySet<SupersConfig["template"]> = new Set(["bottom_urgency", "super1", "super2"]);
const VALID_VIDEO_TYPES: ReadonlySet<VideoConfig["type"]> = new Set(VIDEO_TYPES);
const VALID_VIDEO_PROVIDERS: ReadonlySet<VideoConfig["provider"]> = new Set(VIDEO_PROVIDERS);
const MIN_VIDEO_DURATION_SECONDS = 4;
const MAX_VIDEO_DURATION_SECONDS = 45;
const VALID_STEP_IDS: ReadonlySet<StepId> = new Set(["backstory", "keyframe", "video", "finalize"]);
const VALID_STEP_STATUSES: ReadonlySet<StepStatus> = new Set(["pending", "running", "completed", "failed"]);
const VALID_JOB_STATUSES: ReadonlySet<JobStatus> = new Set(["queued", "running", "completed", "failed"]);

function getProviderAssetPrefix(provider: VideoConfig["provider"]): string {
  switch (provider) {
    case "sora":
      return "sora-t2v";
    case "veo31_standard":
      return "veo-i2v";
    case "sora_i2v":
      return "sora-image-veo-i2v";
    default:
      return "video";
  }
}

function getPreferredPublishedAssetNames(provider: VideoConfig["provider"] | undefined): { raw: string; final: string } {
  const prefix = getProviderAssetPrefix(provider ?? DEFAULT_VIDEO_CONFIG.provider);
  return {
    raw: `raw-${prefix}.mp4`,
    final: `final-${prefix}.mp4`
  };
}

async function ensurePreferredPublishedAssets(
  jobDir: string,
  provider: VideoConfig["provider"] | undefined
): Promise<{ rawExists: boolean; finalExists: boolean }> {
  const preferredAssets = getPreferredPublishedAssetNames(provider);
  const genericRawPath = path.join(jobDir, "raw.mp4");
  const genericFinalPath = path.join(jobDir, "final.mp4");
  const preferredRawPath = path.join(jobDir, preferredAssets.raw);
  const preferredFinalPath = path.join(jobDir, preferredAssets.final);

  const [genericRawExists, genericFinalExists, preferredRawExists, preferredFinalExists] = await Promise.all([
    fileExists(genericRawPath),
    fileExists(genericFinalPath),
    fileExists(preferredRawPath),
    fileExists(preferredFinalPath)
  ]);

  if (genericRawExists && !preferredRawExists) {
    await fs.copyFile(genericRawPath, preferredRawPath).catch(() => undefined);
  }

  if (genericFinalExists && !preferredFinalExists) {
    await fs.copyFile(genericFinalPath, preferredFinalPath).catch(() => undefined);
  }

  return {
    rawExists: preferredRawExists || genericRawExists,
    finalExists: preferredFinalExists || genericFinalExists
  };
}

export function buildDefaultSteps(): JobStep[] {
  return (Object.keys(STEP_LABELS) as StepId[]).map((stepId) => ({
    id: stepId,
    label: STEP_LABELS[stepId],
    status: "pending"
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringOrUndefined(value: unknown): value is string | undefined {
  return typeof value === "undefined" || typeof value === "string";
}

function isValidStep(value: unknown): value is JobStep {
  if (!isRecord(value)) {
    return false;
  }

  const { id, label, status, message } = value;
  return (
    typeof id === "string" &&
    VALID_STEP_IDS.has(id as StepId) &&
    typeof label === "string" &&
    typeof status === "string" &&
    VALID_STEP_STATUSES.has(status as StepStatus) &&
    isStringOrUndefined(message)
  );
}

function isValidAssets(value: unknown): value is JobRecord["assets"] {
  if (!isRecord(value)) {
    return false;
  }

  const { inputJson, backstoryJson, keyframePng, rawMp4, qcJson, finalMp4, howToStepMp4s, adaptSquareMp4, adaptLandscapeMp4 } =
    value;
  return (
    typeof inputJson === "string" &&
    typeof backstoryJson === "string" &&
    isStringOrUndefined(keyframePng) &&
    isStringOrUndefined(rawMp4) &&
    isStringOrUndefined(qcJson) &&
    isStringOrUndefined(finalMp4) &&
    (typeof howToStepMp4s === "undefined" ||
      (Array.isArray(howToStepMp4s) &&
        howToStepMp4s.every((fileName) => typeof fileName === "string" && fileName.trim().length > 0))) &&
    isStringOrUndefined(adaptSquareMp4) &&
    isStringOrUndefined(adaptLandscapeMp4)
  );
}

function isValidEmailDelivery(value: unknown): value is EmailDeliveryConfig | undefined {
  if (typeof value === "undefined") {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }

  const {
    provider,
    mailbox,
    fromEmail,
    fromName,
    originalSubject,
    threadId,
    gmailMessageId,
    internetMessageId,
    replySentAt,
    replyError
  } = value;

  return (
    provider === "gmail" &&
    typeof mailbox === "string" &&
    mailbox.trim().length > 0 &&
    typeof fromEmail === "string" &&
    fromEmail.trim().length > 0 &&
    isStringOrUndefined(fromName) &&
    typeof originalSubject === "string" &&
    originalSubject.trim().length > 0 &&
    typeof threadId === "string" &&
    threadId.trim().length > 0 &&
    typeof gmailMessageId === "string" &&
    gmailMessageId.trim().length > 0 &&
    isStringOrUndefined(internetMessageId) &&
    isStringOrUndefined(replySentAt) &&
    isStringOrUndefined(replyError)
  );
}

function isValidSupersRule(value: unknown): value is SupersConfig["rules"][number] {
  if (!isRecord(value)) {
    return false;
  }

  const { triggerWord, text, holdSeconds } = value;
  return (
    typeof triggerWord === "string" &&
    triggerWord.trim().length > 0 &&
    typeof text === "string" &&
    text.trim().length > 0 &&
    (typeof holdSeconds === "undefined" || (typeof holdSeconds === "number" && Number.isFinite(holdSeconds)))
  );
}

function isValidSupersConfig(value: unknown): value is SupersConfig | undefined {
  if (typeof value === "undefined") {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }

  const { enabled, timingMode, template, rules } = value;
  return (
    typeof enabled === "boolean" &&
    typeof timingMode === "string" &&
    VALID_SUPERS_TIMING_MODES.has(timingMode as SupersConfig["timingMode"]) &&
    typeof template === "string" &&
    VALID_SUPERS_TEMPLATES.has(template as SupersConfig["template"]) &&
    Array.isArray(rules) &&
    rules.every((rule) => isValidSupersRule(rule))
  );
}

function isValidHowToConfig(value: unknown): value is HowToConfig | undefined {
  if (typeof value === "undefined") {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }

  const { stepsText, screengrabFiles } = value;
  return (
    typeof stepsText === "string" &&
    stepsText.trim().length > 0 &&
    Array.isArray(screengrabFiles) &&
    screengrabFiles.every((fileName) => typeof fileName === "string" && fileName.trim().length > 0)
  );
}

function isValidVideoConfig(value: unknown): value is VideoConfig | undefined {
  if (typeof value === "undefined") {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }

  const { type, durationSeconds, provider } = value;
  return (
    typeof type === "string" &&
    VALID_VIDEO_TYPES.has(type as VideoConfig["type"]) &&
    typeof durationSeconds === "number" &&
    Number.isFinite(durationSeconds) &&
    durationSeconds >= MIN_VIDEO_DURATION_SECONDS &&
    durationSeconds <= MAX_VIDEO_DURATION_SECONDS &&
    (typeof provider === "undefined" || (typeof provider === "string" && VALID_VIDEO_PROVIDERS.has(provider as VideoConfig["provider"])))
  );
}

function isValidJobRecord(value: unknown): value is JobRecord {
  if (!isRecord(value)) {
    return false;
  }

  const {
    id,
    runToken,
    product,
    script,
    soraPrompt,
    promptVersion,
    status,
    createdAt,
    updatedAt,
    steps,
    assets,
    brief,
    guidelines,
    howTo,
    supers,
    video,
    error,
    operationName,
    email
  } =
    value;

  return (
    typeof id === "string" &&
    isStringOrUndefined(runToken) &&
    typeof product === "string" &&
    VALID_PRODUCT_KEYS.has(product as ProductKey) &&
    typeof script === "string" &&
    isStringOrUndefined(soraPrompt) &&
    (typeof promptVersion === "undefined" ||
      (typeof promptVersion === "string" && VALID_PROMPT_WRITER_VERSIONS.has(promptVersion as PromptWriterVersion))) &&
    typeof status === "string" &&
    VALID_JOB_STATUSES.has(status as JobStatus) &&
    typeof createdAt === "string" &&
    typeof updatedAt === "string" &&
    Array.isArray(steps) &&
    steps.every((step) => isValidStep(step)) &&
    isValidAssets(assets) &&
    isStringOrUndefined(brief) &&
    isStringOrUndefined(guidelines) &&
    isValidHowToConfig(howTo) &&
    isValidSupersConfig(supers) &&
    isValidVideoConfig(video) &&
    isValidEmailDelivery(email) &&
    isStringOrUndefined(error) &&
    isStringOrUndefined(operationName)
  );
}

export function getGeneratedRoot(): string {
  return GENERATED_ROOT;
}

export function getJobDir(jobId: string): string {
  return path.join(GENERATED_ROOT, jobId);
}

function getJobStatePath(jobId: string): string {
  return path.join(getJobDir(jobId), JOB_STATE_FILE);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isStaleRunningJob(job: JobRecord): boolean {
  if (job.status !== "running") {
    return false;
  }

  const updatedAtMs = Date.parse(job.updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }

  return Date.now() - updatedAtMs >= STALE_RUNNING_RECONCILE_MS;
}

function updateStepToCompletedIfOpen(
  job: JobRecord,
  stepId: StepId,
  fallbackMessage: string,
  preserveMessagePrefix?: string
): boolean {
  const step = job.steps.find((item) => item.id === stepId);
  if (!step || step.status === "failed" || step.status === "completed") {
    return false;
  }

  step.status = "completed";
  if (!step.message || (preserveMessagePrefix && step.message.startsWith(preserveMessagePrefix))) {
    step.message = fallbackMessage;
  }

  return true;
}

async function reconcileStaleRunningJob(jobId: string, job: JobRecord): Promise<JobRecord> {
  if (!isStaleRunningJob(job)) {
    return job;
  }

  const jobDir = getJobDir(jobId);
  const preferredAssets = getPreferredPublishedAssetNames(job.video?.provider);
  await ensurePreferredPublishedAssets(jobDir, job.video?.provider);
  const [rawExists, finalExists, preferredRawExists, preferredFinalExists] = await Promise.all([
    fileExists(path.join(jobDir, "raw.mp4")),
    fileExists(path.join(jobDir, "final.mp4")),
    fileExists(path.join(jobDir, preferredAssets.raw)),
    fileExists(path.join(jobDir, preferredAssets.final))
  ]);

  if (!rawExists && !finalExists && !preferredRawExists && !preferredFinalExists) {
    return job;
  }

  const next: JobRecord = JSON.parse(JSON.stringify(job));
  let changed = false;

  if ((preferredRawExists || rawExists) && next.assets.rawMp4 !== (preferredRawExists ? preferredAssets.raw : "raw.mp4")) {
    next.assets.rawMp4 = preferredRawExists ? preferredAssets.raw : "raw.mp4";
    changed = true;
  }

  if ((preferredFinalExists || finalExists) && next.assets.finalMp4 !== (preferredFinalExists ? preferredAssets.final : "final.mp4")) {
    next.assets.finalMp4 = preferredFinalExists ? preferredAssets.final : "final.mp4";
    changed = true;
  }

  if (rawExists || preferredRawExists) {
    changed =
      updateStepToCompletedIfOpen(next, "video", "Raw video downloaded.") || changed;
  }

  if (finalExists || preferredFinalExists) {
    changed =
      updateStepToCompletedIfOpen(next, "finalize", "Final MP4 recovered after interrupted run.") || changed;
    const finalizeStep = next.steps.find((step) => step.id === "finalize");
    if (finalizeStep && finalizeStep.message !== "Final MP4 recovered after interrupted run.") {
      finalizeStep.message = "Final MP4 recovered after interrupted run.";
      changed = true;
    }
    if (next.status !== "completed") {
      next.status = "completed";
      next.error = undefined;
      changed = true;
    }
  }

  if (!changed) {
    return job;
  }

  await persistJob(next);
  return next;
}

function withTimestamp(job: JobRecord): JobRecord {
  return {
    ...job,
    updatedAt: new Date().toISOString()
  };
}

export async function ensureGeneratedRoot(): Promise<void> {
  await fs.mkdir(GENERATED_ROOT, { recursive: true });
}

export async function persistJob(job: JobRecord): Promise<void> {
  const nextJob = withTimestamp(job);
  STORE.set(nextJob.id, nextJob);
  await fs.mkdir(getJobDir(nextJob.id), { recursive: true });
  await fs.writeFile(getJobStatePath(nextJob.id), JSON.stringify(nextJob, null, 2), "utf8");
}

export async function createJob(input: JobCreateInput): Promise<JobRecord> {
  await ensureGeneratedRoot();
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const job: JobRecord = {
    id,
    runToken: randomUUID(),
    product: input.product,
    script: input.script,
    soraPrompt: input.soraPrompt,
    promptVersion: input.promptVersion ?? DEFAULT_PROMPT_WRITER_VERSION,
    brief: input.brief,
    guidelines: input.guidelines,
    howTo: input.howTo,
    supers: input.supers,
    video: input.video ?? DEFAULT_VIDEO_CONFIG,
    email: input.email,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    steps: buildDefaultSteps(),
    assets: {
      inputJson: "input.json",
      backstoryJson: "backstory.json"
    }
  };

  const jobDir = getJobDir(id);
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(
    path.join(jobDir, "input.json"),
    JSON.stringify(
      {
        app: "Creative AI - Video",
        createdAt: now,
        ...input
      },
      null,
      2
    ),
    "utf8"
  );

  await persistJob(job);
  return job;
}

async function readJobFromDisk(jobId: string): Promise<JobRecord | undefined> {
  try {
    const content = await fs.readFile(getJobStatePath(jobId), "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (!isValidJobRecord(parsed)) {
      return undefined;
    }
    const reconciled = await reconcileStaleRunningJob(jobId, parsed);
    STORE.set(jobId, reconciled);
    return reconciled;
  } catch {
    return undefined;
  }
}

export async function getJob(jobId: string): Promise<JobRecord | undefined> {
  if (STORE.has(jobId)) {
    const cached = STORE.get(jobId);
    if (!cached) {
      return undefined;
    }
    return reconcileStaleRunningJob(jobId, cached);
  }
  return readJobFromDisk(jobId);
}

export async function mutateJob(
  jobId: string,
  mutate: (job: JobRecord) => void
): Promise<JobRecord> {
  const existing = await getJob(jobId);
  if (!existing) {
    throw new Error(`Job ${jobId} not found.`);
  }

  const next: JobRecord = JSON.parse(JSON.stringify(existing));
  mutate(next);
  await persistJob(next);
  return next;
}

export async function updateStep(
  jobId: string,
  stepId: StepId,
  status: StepStatus,
  message?: string
): Promise<JobRecord> {
  return mutateJob(jobId, (job) => {
    const step = job.steps.find((item) => item.id === stepId);
    if (!step) {
      return;
    }
    step.status = status;
    step.message = message;

    if (status === "failed") {
      job.status = "failed";
    }
  });
}

export async function setJobStatus(
  jobId: string,
  status: JobStatus,
  error?: string
): Promise<JobRecord> {
  return mutateJob(jobId, (job) => {
    job.status = status;
    job.error = error;
  });
}

export async function listJobs(limit = 10): Promise<JobRecord[]> {
  await ensureGeneratedRoot();
  const entries = await fs.readdir(GENERATED_ROOT, { withFileTypes: true });
  const candidateIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  const jobs = (
    await Promise.all(candidateIds.map(async (id) => readJobFromDisk(id)))
  ).filter((item): item is JobRecord => Boolean(item));

  return jobs
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

function toAssetUrl(jobId: string, name: string): string {
  return `/api/jobs/${jobId}/asset/${name}`;
}

export function toClientJob(job: JobRecord): ClientJob {
  const howToStepVideoUrls =
    Array.isArray(job.assets.howToStepMp4s) && job.assets.howToStepMp4s.length > 0
      ? job.assets.howToStepMp4s.map((fileName) => toAssetUrl(job.id, fileName))
      : undefined;

  return {
    ...job,
    video: job.video ?? DEFAULT_VIDEO_CONFIG,
    assets: {
      ...job.assets,
      inputUrl: toAssetUrl(job.id, "input.json"),
      backstoryUrl: toAssetUrl(job.id, "backstory.json"),
      keyframeUrl: job.assets.keyframePng ? toAssetUrl(job.id, job.assets.keyframePng) : undefined,
      rawVideoUrl: job.assets.rawMp4 ? toAssetUrl(job.id, job.assets.rawMp4) : undefined,
      qcUrl: job.assets.qcJson ? toAssetUrl(job.id, job.assets.qcJson) : undefined,
      finalVideoUrl: job.assets.finalMp4 ? toAssetUrl(job.id, job.assets.finalMp4) : undefined,
      howToStepVideoUrls,
      adaptSquareVideoUrl: job.assets.adaptSquareMp4 ? toAssetUrl(job.id, job.assets.adaptSquareMp4) : undefined,
      adaptLandscapeVideoUrl: job.assets.adaptLandscapeMp4 ? toAssetUrl(job.id, job.assets.adaptLandscapeMp4) : undefined
    }
  };
}
