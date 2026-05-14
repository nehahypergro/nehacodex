import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DECK_STEP_LABELS } from "@/app/lib/hypergro/templates";
import { DeckClientJob, DeckInput, DeckJobRecord, DeckJobStep, DeckStepId, DeckStepStatus } from "@/app/lib/hypergro/types";

const GENERATED_ROOT = path.join(process.cwd(), "generated-decks");
const JOB_STATE_FILE = "job.json";

function buildDefaultSteps(): DeckJobStep[] {
  return (Object.keys(DECK_STEP_LABELS) as DeckStepId[]).map((id) => ({
    id,
    label: DECK_STEP_LABELS[id],
    status: "pending"
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStepStatus(value: unknown): value is DeckStepStatus {
  return value === "pending" || value === "running" || value === "completed" || value === "failed" || value === "skipped";
}

function isJobRecord(value: unknown): value is DeckJobRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.status === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    isRecord(value.input) &&
    Array.isArray(value.steps) &&
    value.steps.every(
      (step) =>
        isRecord(step) &&
        typeof step.id === "string" &&
        typeof step.label === "string" &&
        isStepStatus(step.status) &&
        (typeof step.message === "undefined" || typeof step.message === "string")
    ) &&
    isRecord(value.assets) &&
    isRecord(value.slides) &&
    Array.isArray(value.warnings)
  );
}

async function ensureGeneratedRoot(): Promise<void> {
  await fs.mkdir(GENERATED_ROOT, { recursive: true });
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function getJobStatePath(jobId: string): string {
  return path.join(getDeckJobDir(jobId), JOB_STATE_FILE);
}

export function getDeckGeneratedRoot(): string {
  return GENERATED_ROOT;
}

export function getDeckJobDir(jobId: string): string {
  return path.join(GENERATED_ROOT, jobId);
}

export async function writeDeckAsset(jobId: string, fileName: string, content: Buffer | string): Promise<void> {
  await fs.mkdir(getDeckJobDir(jobId), { recursive: true });
  await fs.writeFile(path.join(getDeckJobDir(jobId), fileName), content);
}

export async function writeDeckJsonAsset(jobId: string, fileName: string, value: unknown): Promise<void> {
  await fs.mkdir(getDeckJobDir(jobId), { recursive: true });
  await writeJson(path.join(getDeckJobDir(jobId), fileName), value);
}

export async function createDeckJob(input: DeckInput): Promise<DeckJobRecord> {
  await ensureGeneratedRoot();
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();
  const job: DeckJobRecord = {
    id,
    status: "queued",
    createdAt,
    updatedAt: createdAt,
    input,
    steps: buildDefaultSteps(),
    assets: {
      inputJson: "input.json"
    },
    slides: {
      status: "skipped",
      message: "Slides export has not started."
    },
    warnings: []
  };

  await fs.mkdir(getDeckJobDir(id), { recursive: true });
  await writeDeckJsonAsset(id, "input.json", input);
  await saveDeckJob(job);
  return job;
}

export async function saveDeckJob(job: DeckJobRecord): Promise<void> {
  await fs.mkdir(getDeckJobDir(job.id), { recursive: true });
  await writeJson(getJobStatePath(job.id), job);
}

export async function getDeckJob(jobId: string): Promise<DeckJobRecord | null> {
  try {
    const raw = await fs.readFile(getJobStatePath(jobId), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isJobRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function requireDeckJob(jobId: string): Promise<DeckJobRecord> {
  const job = await getDeckJob(jobId);
  if (!job) {
    throw new Error(`Deck job ${jobId} was not found.`);
  }
  return job;
}

export async function updateDeckJob(
  jobId: string,
  mutate: (job: DeckJobRecord) => void | DeckJobRecord
): Promise<DeckJobRecord> {
  const current = await requireDeckJob(jobId);
  const draft = structuredClone(current);
  const next = mutate(draft) ?? draft;
  next.updatedAt = new Date().toISOString();
  await saveDeckJob(next);
  return next;
}

export async function listDeckJobs(limit = 12): Promise<DeckJobRecord[]> {
  await ensureGeneratedRoot();
  const entries = await fs.readdir(GENERATED_ROOT, { withFileTypes: true });
  const jobs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => getDeckJob(entry.name))
  );

  return jobs
    .filter((job): job is DeckJobRecord => Boolean(job))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit);
}

export function toClientDeckJob(job: DeckJobRecord): DeckClientJob {
  const base = `/api/hypergro-sales-deck/jobs/${job.id}/asset`;
  return {
    ...job,
    assets: {
      inputJsonUrl: `${base}/input.json`,
      deckJsonUrl: job.assets.deckJson ? `${base}/${job.assets.deckJson}` : undefined,
      heroImageUrl: job.assets.heroPng ? `${base}/${job.assets.heroPng}` : undefined,
      slidesJsonUrl: job.assets.slidesJson ? `${base}/${job.assets.slidesJson}` : undefined
    }
  };
}
