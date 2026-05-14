import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { generateCampaignScript } from "@/app/api/script/route";
import {
  assessFinalVideoCreative,
  generateBackstory,
  generateSharedImageFirstKeyframe,
  runPipeline
} from "@/app/lib/pipeline";
import {
  ActiveRunProvider,
  ClientProviderRun,
  ClientRun,
  DEFAULT_PROMPT_WRITER_VERSION,
  DEFAULT_VIDEO_CONFIG,
  JobStatus,
  ProviderRunRef,
  RunCreateInput,
  RunLogEntry,
  RunRecord,
  RunStatus,
  SharedPlanRecord,
  VideoProvider
} from "@/app/lib/types";
import { createJob, getJob, getJobDir, mutateJob, setJobStatus, updateStep, toClientJob } from "@/app/lib/jobs";

const RUNS_ROOT = path.join(process.cwd(), "generated-runs");
const RUN_STATE_FILE = "run.json";
const JOB_ASSESSMENT_FILE = "assessment.json";

interface RunRepairGlobal {
  __kotakRunAssessmentInflight?: Map<string, Promise<void>>;
  __kotakRunMutationInflight?: Map<string, Promise<unknown>>;
}

type SupportedChildProvider = ActiveRunProvider;

const PROVIDER_LABELS: Record<SupportedChildProvider, string> = {
  sora: "Sora 2 Pro",
  veo31_standard: "Veo 3.1 Standard"
};
const CHILD_PROVIDERS: SupportedChildProvider[] = ["sora", "veo31_standard"];
const COMPLETED_RUN_MESSAGE = "All provider videos completed.";
const PARTIAL_FAILURE_RUN_MESSAGE = "Run completed with one or more provider failures.";

function getProviderLabel(provider: SupportedChildProvider): string {
  return PROVIDER_LABELS[provider];
}

interface RunStoreGlobal {
  __kotakRuns?: Map<string, RunRecord>;
}

const STORE: Map<string, RunRecord> = (globalThis as RunStoreGlobal).__kotakRuns ?? new Map();
if (!(globalThis as RunStoreGlobal).__kotakRuns) {
  (globalThis as RunStoreGlobal).__kotakRuns = STORE;
}

const ASSESSMENT_INFLIGHT: Map<string, Promise<void>> =
  (globalThis as RunRepairGlobal).__kotakRunAssessmentInflight ?? new Map();
if (!(globalThis as RunRepairGlobal).__kotakRunAssessmentInflight) {
  (globalThis as RunRepairGlobal).__kotakRunAssessmentInflight = ASSESSMENT_INFLIGHT;
}

const RUN_MUTATION_INFLIGHT: Map<string, Promise<unknown>> =
  (globalThis as RunRepairGlobal).__kotakRunMutationInflight ?? new Map();
if (!(globalThis as RunRepairGlobal).__kotakRunMutationInflight) {
  (globalThis as RunRepairGlobal).__kotakRunMutationInflight = RUN_MUTATION_INFLIGHT;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringOrUndefined(value: unknown): value is string | undefined {
  return typeof value === "undefined" || typeof value === "string";
}

function isValidRunLogEntry(value: unknown): value is RunLogEntry {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.timestamp === "string" &&
    (value.scope === "shared" || value.scope === "sora" || value.scope === "veo31_standard" || value.scope === "sora_i2v") &&
    typeof value.message === "string"
  );
}

function isValidSharedPlan(value: unknown): value is SharedPlanRecord {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isStringOrUndefined(value.script) &&
    isStringOrUndefined(value.basePrompt) &&
    (typeof value.basePromptSource === "undefined" || value.basePromptSource === "gemini_prompt_writer" || value.basePromptSource === "deterministic_fallback")
  );
}

function isValidProviderRunRef(value: unknown): value is ProviderRunRef {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.provider === "sora" || value.provider === "veo31_standard" || value.provider === "sora_i2v") &&
    isStringOrUndefined(value.jobId)
  );
}

function isValidChildren(value: unknown): value is Record<SupportedChildProvider, ProviderRunRef> {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isValidProviderRunRef(value.sora) &&
    isValidProviderRunRef(value.veo31_standard) &&
    (typeof value.sora_i2v === "undefined" || isValidProviderRunRef(value.sora_i2v))
  );
}

function isValidRunRecord(value: unknown): value is RunRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    (value.product === "kotak_air_plus" || value.product === "kotak_cashback") &&
    typeof value.brief === "string" &&
    (value.promptVersion === "prompt1" || value.promptVersion === "prompt2" || value.promptVersion === "prompt3") &&
    typeof value.videoType === "string" &&
    typeof value.durationSeconds === "number" &&
    (value.status === "queued" || value.status === "running" || value.status === "completed" || value.status === "failed" || value.status === "partial_failed") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    isValidSharedPlan(value.sharedPlan) &&
    isValidChildren(value.children) &&
    Array.isArray(value.logs) &&
    value.logs.every((entry) => isValidRunLogEntry(entry)) &&
    isStringOrUndefined(value.error)
  );
}

function withTimestamp(run: RunRecord): RunRecord {
  return {
    ...run,
    updatedAt: new Date().toISOString()
  };
}

function defaultChildren(): Record<SupportedChildProvider, ProviderRunRef> {
  return {
    sora: { provider: "sora" },
    veo31_standard: { provider: "veo31_standard" }
  };
}

function getRunDir(runId: string): string {
  return path.join(RUNS_ROOT, runId);
}

function getRunStatePath(runId: string): string {
  return path.join(getRunDir(runId), RUN_STATE_FILE);
}

function getJobAssessmentPath(jobId: string): string {
  return path.join(process.cwd(), "generated", jobId, JOB_ASSESSMENT_FILE);
}

async function ensureRunsRoot(): Promise<void> {
  await fs.mkdir(RUNS_ROOT, { recursive: true });
}

async function persistRun(run: RunRecord): Promise<void> {
  const next = withTimestamp(run);
  STORE.set(next.id, next);
  await fs.mkdir(getRunDir(next.id), { recursive: true });
  await fs.writeFile(getRunStatePath(next.id), JSON.stringify(next, null, 2), "utf8");
}

async function readRunFromDisk(runId: string): Promise<RunRecord | undefined> {
  try {
    const raw = await fs.readFile(getRunStatePath(runId), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidRunRecord(parsed)) {
      return undefined;
    }
    const normalized: RunRecord = {
      ...parsed,
      children: {
        ...defaultChildren(),
        ...parsed.children
      }
    };
    STORE.set(runId, normalized);
    return normalized;
  } catch {
    return undefined;
  }
}

export async function getRun(runId: string): Promise<RunRecord | undefined> {
  if (STORE.has(runId)) {
    const cached = STORE.get(runId);
    return cached;
  }
  return readRunFromDisk(runId);
}

export async function listRuns(limit = 10): Promise<RunRecord[]> {
  await ensureRunsRoot();
  const entries = await fs.readdir(RUNS_ROOT, { withFileTypes: true });
  const runIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const runs = (await Promise.all(runIds.map((runId) => readRunFromDisk(runId)))).filter((run): run is RunRecord => Boolean(run));
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

export async function mutateRun(runId: string, mutate: (run: RunRecord) => void): Promise<RunRecord> {
  const previous = RUN_MUTATION_INFLIGHT.get(runId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const existing = await getRun(runId);
    if (!existing) {
      throw new Error(`Run ${runId} not found.`);
    }
    const next: RunRecord = JSON.parse(JSON.stringify(existing));
    mutate(next);
    await persistRun(next);
    return next;
  });

  RUN_MUTATION_INFLIGHT.set(runId, current);
  try {
    return await current;
  } finally {
    if (RUN_MUTATION_INFLIGHT.get(runId) === current) {
      RUN_MUTATION_INFLIGHT.delete(runId);
    }
  }
}

export async function appendRunLog(runId: string, scope: RunLogEntry["scope"], message: string): Promise<RunRecord> {
  return mutateRun(runId, (run) => {
    run.logs.push({
      timestamp: new Date().toISOString(),
      scope,
      message
    });
  });
}

export async function appendRunLogIfMissing(runId: string, scope: RunLogEntry["scope"], message: string): Promise<RunRecord> {
  return mutateRun(runId, (run) => {
    const exists = run.logs.some((entry) => entry.scope === scope && entry.message === message);
    if (exists) {
      return;
    }
    run.logs.push({
      timestamp: new Date().toISOString(),
      scope,
      message
    });
  });
}

export async function setRunStatus(runId: string, status: RunStatus, error?: string): Promise<RunRecord> {
  return mutateRun(runId, (run) => {
    run.status = status;
    run.error = error;
  });
}

export async function createRun(input: RunCreateInput): Promise<RunRecord> {
  await ensureRunsRoot();
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const run: RunRecord = {
    id,
    product: input.product,
    brief: input.brief,
    promptVersion: input.promptVersion ?? DEFAULT_PROMPT_WRITER_VERSION,
    videoType: input.videoType ?? DEFAULT_VIDEO_CONFIG.type,
    durationSeconds: input.durationSeconds ?? DEFAULT_VIDEO_CONFIG.durationSeconds,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    sharedPlan: {},
    children: defaultChildren(),
    logs: []
  };

  await persistRun(run);
  return run;
}

function resolveChildMessage(status: ClientProviderRun["status"], latestStepMessage?: string, error?: string): string | undefined {
  if (error) {
    return error;
  }
  if (status === "completed") {
    return "Final video ready.";
  }
  if (latestStepMessage) {
    return latestStepMessage;
  }
  if (status === "pending") {
    return "Waiting to start.";
  }
  return undefined;
}

function getLatestJobMessage(job: Awaited<ReturnType<typeof getJob>>): string | undefined {
  if (!job) {
    return undefined;
  }
  const active = job.steps.find((step) => step.status === "running" && step.message);
  if (active?.message) {
    return active.message;
  }
  const failed = [...job.steps].reverse().find((step) => step.status === "failed" && step.message);
  if (failed?.message) {
    return failed.message;
  }
  const completed = [...job.steps].reverse().find((step) => step.message);
  return completed?.message;
}

function deriveRunStatus(storedStatus: RunStatus, childStatuses: Array<JobStatus | "pending">): RunStatus {
  if (childStatuses.length === 0 || childStatuses.every((status) => status === "pending")) {
    return storedStatus;
  }
  const completedCount = childStatuses.filter((status) => status === "completed").length;
  const failedCount = childStatuses.filter((status) => status === "failed").length;
  const runningCount = childStatuses.filter((status) => status === "running").length;
  const queuedCount = childStatuses.filter((status) => status === "queued").length;

  if (runningCount > 0 || queuedCount > 0) {
    return "running";
  }
  if (completedCount === childStatuses.length) {
    return "completed";
  }
  if (failedCount === childStatuses.length) {
    return "failed";
  }
  if (completedCount > 0 && failedCount > 0) {
    return "partial_failed";
  }
  return storedStatus;
}

async function readJobAssessment(jobId?: string): Promise<ClientProviderRun["assessment"] | undefined> {
  if (!jobId) {
    return undefined;
  }

  try {
    const raw = await fs.readFile(getJobAssessmentPath(jobId), "utf8");
    const parsed = JSON.parse(raw) as ClientProviderRun["assessment"];
    if (
      !parsed ||
      typeof parsed.score !== "number" ||
      typeof parsed.whatWillWork !== "string" ||
      typeof parsed.whyItWillWork !== "string" ||
      !Array.isArray(parsed.concerns) ||
      typeof parsed.assessedAt !== "string" ||
      typeof parsed.model !== "string"
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

async function ensureJobAssessment(
  runId: string,
  run: RunRecord,
  provider: SupportedChildProvider,
  jobId: string
): Promise<void> {
  const existing = await readJobAssessment(jobId);
  if (existing) {
    return;
  }

  const job = await getJob(jobId);
  if (!job || job.status !== "completed" || !job.assets.finalMp4) {
    return;
  }

  const key = `${runId}:${provider}:${jobId}`;
  const inflight = ASSESSMENT_INFLIGHT.get(key);
  if (inflight) {
    await inflight;
    return;
  }

  const task = (async () => {
    const finalPath = path.join(process.cwd(), "generated", jobId, job.assets.finalMp4!);
    const finalVideoBytes = await fs.readFile(finalPath);
    const assessment = await assessFinalVideoCreative({
      videoBytes: finalVideoBytes,
      product: run.product,
      script: run.sharedPlan.script ?? job.script,
      brief: run.brief,
      provider
    });
    await fs.writeFile(getJobAssessmentPath(jobId), JSON.stringify(assessment, null, 2), "utf8");
    await appendRunLogIfMissing(runId, provider, `${getProviderLabel(provider)} scored ${assessment.score.toFixed(1)}/10.`);
  })();

  ASSESSMENT_INFLIGHT.set(key, task);
  try {
    await task;
  } finally {
    ASSESSMENT_INFLIGHT.delete(key);
  }
}

export async function repairRunOutputs(runId: string): Promise<RunRecord | undefined> {
  const run = await getRun(runId);
  if (!run) {
    return undefined;
  }

  const childStatuses: Array<JobStatus | "pending"> = [];
  for (const provider of CHILD_PROVIDERS) {
    const jobId = run.children[provider].jobId;
    if (!jobId) {
      childStatuses.push("pending");
      continue;
    }
    const job = await getJob(jobId);
    childStatuses.push(job?.status ?? "pending");
    if (job?.status === "completed") {
      try {
        await ensureJobAssessment(runId, run, provider, jobId);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await appendRunLogIfMissing(runId, provider, `${getProviderLabel(provider)} assessment failed: ${detail}`);
      }
    }
  }

  const nextStatus = deriveRunStatus(run.status, childStatuses);
  if (nextStatus !== run.status) {
    await setRunStatus(runId, nextStatus, nextStatus === "failed" ? run.error : undefined);
    if (nextStatus === "completed") {
      await appendRunLogIfMissing(runId, "shared", COMPLETED_RUN_MESSAGE);
    } else if (nextStatus === "partial_failed") {
      await appendRunLogIfMissing(runId, "shared", PARTIAL_FAILURE_RUN_MESSAGE);
    }
  }

  return getRun(runId);
}

export async function toClientRun(run: RunRecord): Promise<ClientRun> {
  const childEntries = await Promise.all(
    CHILD_PROVIDERS.map(async (provider) => {
      const ref = run.children[provider];
      const job = ref.jobId ? await getJob(ref.jobId) : undefined;
      const clientJob = job ? toClientJob(job) : undefined;
      const assessment = await readJobAssessment(ref.jobId);
      const status: ClientProviderRun["status"] = job?.status ?? "pending";
      const message = resolveChildMessage(status, getLatestJobMessage(job), job?.error);
      const child: ClientProviderRun = {
        provider,
        label: getProviderLabel(provider),
        jobId: ref.jobId,
        status,
        message,
        error: job?.error,
        rawVideoUrl: clientJob?.assets.rawVideoUrl,
        finalVideoUrl: clientJob?.assets.finalVideoUrl,
        assessment
      };
      return [provider, child] as const;
    })
  );

  const children = Object.fromEntries(childEntries) as Record<SupportedChildProvider, ClientProviderRun>;
  const childStatuses = Object.values(children).map((child) => child.status);
  const derivedStatus = deriveRunStatus(run.status, childStatuses);

  const liveLogs = [...run.logs];
  for (const child of Object.values(children)) {
    if (child.message && (child.status === "running" || child.status === "failed" || child.status === "pending")) {
      liveLogs.push({
        timestamp: run.updatedAt,
        scope: child.provider,
        message: child.message
      });
    }
  }

  liveLogs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const dedupedLogs: RunLogEntry[] = [];
  const seen = new Set<string>();
  for (const entry of liveLogs) {
    const key = `${entry.timestamp}|${entry.scope}|${entry.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    dedupedLogs.push(entry);
  }

  return {
    id: run.id,
    product: run.product,
    brief: run.brief,
    promptVersion: run.promptVersion,
    videoType: run.videoType,
    durationSeconds: run.durationSeconds,
    status: derivedStatus,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    sharedPlan: run.sharedPlan,
    logs: dedupedLogs,
    error: run.error,
    children
  };
}

function summarizeProviderResult(provider: SupportedChildProvider, status: JobStatus | "pending"): string {
  const label = getProviderLabel(provider);
  if (status === "completed") {
    return `${label} final video ready.`;
  }
  if (status === "failed") {
    return `${label} failed.`;
  }
  return `${label} still running.`;
}

export async function runParentRun(runId: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) {
    throw new Error(`Run ${runId} not found.`);
  }

  try {
    await setRunStatus(runId, "running");
    await appendRunLog(runId, "shared", "Brief accepted.");
    await appendRunLog(runId, "shared", "Generating shared script.");

    const scriptResult = await generateCampaignScript({
      product: run.product,
      brief: run.brief,
      videoType: run.videoType,
      durationSeconds: run.durationSeconds
    });

    await mutateRun(runId, (state) => {
      state.sharedPlan.script = scriptResult.script;
    });
    await appendRunLog(runId, "shared", "Shared script generated.");
    await appendRunLog(runId, "shared", "Generating shared backstory.");

    const backstory = await generateBackstory(scriptResult.script, run.product, undefined, run.brief);
    await mutateRun(runId, (state) => {
      state.sharedPlan.backstory = backstory;
    });
    await appendRunLog(runId, "shared", "Shared backstory generated.");
    let sharedKeyframe: Buffer | undefined;
    let sharedKeyframeError: string | undefined;
    await appendRunLog(runId, "shared", "Generating shared keyframe for Veo image-to-video branch.");
    try {
      sharedKeyframe = await generateSharedImageFirstKeyframe(
        path.join(getRunDir(runId), "shared-keyframe"),
        backstory,
        run.product,
        scriptResult.script,
        undefined,
        run.brief,
        run.videoType
      );
      await appendRunLog(runId, "shared", "Shared Veo keyframe generated.");
    } catch (error) {
      sharedKeyframeError = error instanceof Error ? error.message : String(error);
      await appendRunLog(runId, "shared", `Shared Veo keyframe failed: ${sharedKeyframeError}`);
    }

    await appendRunLog(runId, "shared", "Shared planning complete. Launching provider-specific branches.");

    const createdChildren = await Promise.all(
      CHILD_PROVIDERS.map(async (provider) => {
        const job = await createJob({
          product: run.product,
          script: scriptResult.script,
          promptVersion: run.promptVersion,
          brief: run.brief,
          supers: {
            enabled: true,
            timingMode: "accurate",
            template: "super1",
            rules: []
          },
          video: {
            type: run.videoType,
            durationSeconds: run.durationSeconds,
            provider
          }
        });

        await mutateJob(job.id, (state) => {
          state.backstory = backstory;
        });
        const keyframeForProvider = provider === "veo31_standard" ? sharedKeyframe : undefined;
        const keyframeErrorForProvider = provider === "veo31_standard" ? sharedKeyframeError : undefined;
        if (keyframeForProvider) {
          await fs.writeFile(path.join(getJobDir(job.id), "keyframe.png"), keyframeForProvider);
          await mutateJob(job.id, (state) => {
            state.assets.keyframePng = "keyframe.png";
          });
        } else if (keyframeErrorForProvider) {
          await updateStep(job.id, "backstory", "completed", "Shared persona profile ready.");
          await updateStep(job.id, "keyframe", "failed", keyframeErrorForProvider);
          await setJobStatus(job.id, "failed", keyframeErrorForProvider);
        }

        await mutateRun(runId, (state) => {
          state.children[provider].jobId = job.id;
        });
        await appendRunLog(runId, provider, `${getProviderLabel(provider)} child job created.`);

        return { provider, jobId: job.id, setupError: keyframeErrorForProvider };
      })
    );

    const results = await Promise.allSettled(
      createdChildren.map(async ({ provider, jobId, setupError }) => {
        if (setupError) {
          await appendRunLog(runId, provider, `${getProviderLabel(provider)} setup failed: ${setupError}`);
          return;
        }
        await appendRunLog(runId, provider, `${getProviderLabel(provider)} generation started.`);
        await runPipeline(jobId);
        try {
          const refreshedRun = await getRun(runId);
          if (refreshedRun) {
            await ensureJobAssessment(runId, refreshedRun, provider, jobId);
          }
        } catch (assessmentError) {
          const detail = assessmentError instanceof Error ? assessmentError.message : String(assessmentError);
          await appendRunLogIfMissing(runId, provider, `${getProviderLabel(provider)} assessment failed: ${detail}`);
        }
      })
    );

    const refreshedChildren = await Promise.all(
      createdChildren.map(async ({ provider, jobId }) => ({ provider, job: await getJob(jobId) }))
    );
    const childStatuses = refreshedChildren.map(({ job }) => job?.status ?? "pending");
    const completed = childStatuses.filter((status) => status === "completed").length;
    const failed = childStatuses.filter((status) => status === "failed").length;

    for (const { provider, job } of refreshedChildren) {
      await appendRunLog(runId, provider, summarizeProviderResult(provider, job?.status ?? "pending"));
    }

    if (completed === CHILD_PROVIDERS.length) {
      await setRunStatus(runId, "completed");
      await appendRunLog(runId, "shared", COMPLETED_RUN_MESSAGE);
      return;
    }

    if (completed > 0 && failed > 0) {
      await setRunStatus(runId, "partial_failed", "At least one provider succeeded and one or more providers failed.");
      await appendRunLog(runId, "shared", PARTIAL_FAILURE_RUN_MESSAGE);
      return;
    }

    const failureMessages = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason)));

    if (failureMessages.length > 0) {
      await setRunStatus(runId, "failed", failureMessages.join(" | "));
      await appendRunLog(runId, "shared", "Both provider runs failed.");
      return;
    }

    await setRunStatus(runId, deriveRunStatus("running", childStatuses));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setRunStatus(runId, "failed", message);
    await appendRunLog(runId, "shared", `Run failed: ${message}`);
    throw error;
  }
}
