"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type {
  SoraStudioBriefAttachment,
  SoraStudioClientJob,
  SoraStudioRenderModelKey,
  SoraStudioStarRating
} from "@/app/lib/sora-studio/types";

type InputMode = "single" | "bulk";

const MODEL_ORDER: Array<{ key: SoraStudioRenderModelKey; label: string }> = [
  { key: "seedance2", label: "Model 2" }
];

const DURATION_OPTIONS = ["8", "9", "10", "11", "12", "13", "14", "15"];
const RATIO_OPTIONS = ["9:16", "16:9", "1:1"];
const LANGUAGE_OPTIONS = [
  "English",
  "Hindi",
  "Hinglish",
  "Marathi",
  "Tamil",
  "Telugu",
  "Kannada",
  "Malayalam",
  "Bengali",
  "Gujarati",
  "Punjabi"
];

const STATUS_STYLES: Record<SoraStudioClientJob["status"], string> = {
  queued: "bg-slate-200 text-slate-700",
  running: "bg-amber-200 text-amber-900",
  completed: "bg-emerald-200 text-emerald-900",
  failed: "bg-rose-200 text-rose-900"
};

const RENDER_STATUS_STYLES: Record<"pending" | "running" | "completed" | "failed", string> = {
  pending: "bg-slate-200 text-slate-700",
  running: "bg-amber-200 text-amber-900",
  completed: "bg-emerald-200 text-emerald-900",
  failed: "bg-rose-200 text-rose-900"
};

interface JobsResponse {
  jobs: SoraStudioClientJob[];
}

interface JobResponse {
  job: SoraStudioClientJob | null;
}

interface FeedbackSaveResponse extends JobResponse {
  trackerEntryId?: string;
  trackerError?: string;
}

interface CreateJobResponse {
  job: SoraStudioClientJob;
}

interface ImportResponse {
  fileName: string;
  totalRows: number;
  created: number;
  failed: number;
}

interface UploadAttachmentsResponse {
  attachments: SoraStudioBriefAttachment[];
}

interface FeedbackTrackerResponse {
  totalCount: number;
  returnedCount: number;
  limit: number;
  entries: unknown[];
}

interface FormState {
  product: string;
  brief: string;
  businessObjective: string;
  creativeObjectiveFunnel: string;
  videoDuration: string;
  ratioDimensions: string;
  language: string;
  notificationEmail: string;
  strictParityMode: boolean;
  autoRender: boolean;
}

interface VariantFeedbackDraft {
  rating?: SoraStudioStarRating;
  comment: string;
}

interface FeedbackDraft {
  overallComment: string;
  variants: Partial<Record<SoraStudioRenderModelKey, VariantFeedbackDraft>>;
}

const INITIAL_FORM: FormState = {
  product: "Kotak Mahindra Bank",
  brief: "",
  businessObjective: "",
  creativeObjectiveFunnel: "",
  videoDuration: "8",
  ratioDimensions: "9:16",
  language: "English",
  notificationEmail: "",
  strictParityMode: true,
  autoRender: true
};

function emptyFeedbackDraft(): FeedbackDraft {
  return {
    overallComment: "",
    variants: {
      seedance2: { comment: "" }
    }
  };
}

function feedbackDraftFromJob(job: SoraStudioClientJob | null): FeedbackDraft {
  const base = emptyFeedbackDraft();
  if (!job?.feedback) {
    return base;
  }

  base.overallComment = job.feedback.overallComment ?? "";
  for (const { key } of MODEL_ORDER) {
    const source = job.feedback.variants?.[key];
    if (!source) {
      continue;
    }
    base.variants[key] = {
      rating: source.rating,
      comment: source.comment ?? ""
    };
  }
  return base;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(json.error ?? `Request failed with status ${response.status}`);
  }
  return json;
}

function formatTime(value: string | undefined): string {
  if (!value) {
    return "-";
  }
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function withVersion(url: string, updatedAt: string): string {
  const version = Number.isFinite(Date.parse(updatedAt)) ? String(Date.parse(updatedAt)) : updatedAt;
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
}

function parseUrlLines(value: string): string[] {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function renderAssetUrl(job: SoraStudioClientJob, key: SoraStudioRenderModelKey): string | undefined {
  if (key === "sora2") {
    return job.assets.sora2Mp4Url ?? job.assets.finalMp4Url;
  }
  if (key === "seedance2") {
    return job.assets.seedance2Mp4Url;
  }
  return undefined;
}

function upsertJobInList(list: SoraStudioClientJob[], nextJob: SoraStudioClientJob): SoraStudioClientJob[] {
  const existingIndex = list.findIndex((item) => item.id === nextJob.id);
  if (existingIndex === -1) {
    return [nextJob, ...list];
  }
  const updated = [...list];
  updated[existingIndex] = nextJob;
  return updated;
}

function StarRating({
  value,
  onChange
}: {
  value?: SoraStudioStarRating;
  onChange: (next: SoraStudioStarRating) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((count) => {
        const starValue = count as SoraStudioStarRating;
        const active = typeof value === "number" && value >= starValue;
        return (
          <button
            key={starValue}
            type="button"
            onClick={() => onChange(starValue)}
            className={`text-2xl leading-none transition ${active ? "text-amber-400" : "text-slate-300 hover:text-amber-300"}`}
            aria-label={`Rate ${starValue} star${starValue > 1 ? "s" : ""}`}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}

export default function SoraStudioPage() {
  const [inputMode, setInputMode] = useState<InputMode>("single");
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [jobs, setJobs] = useState<SoraStudioClientJob[]>([]);
  const [briefAttachmentFiles, setBriefAttachmentFiles] = useState<File[]>([]);
  const [briefImageUrlInput, setBriefImageUrlInput] = useState("");
  const [briefVideoUrlInput, setBriefVideoUrlInput] = useState("");
  const [jobSearchInput, setJobSearchInput] = useState("");
  const [jobSearchQuery, setJobSearchQuery] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<SoraStudioClientJob | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState<FeedbackDraft>(emptyFeedbackDraft());
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [savingVariant, setSavingVariant] = useState<SoraStudioRenderModelKey | null>(null);
  const [savingOverall, setSavingOverall] = useState(false);
  const [importSummary, setImportSummary] = useState<string>("");
  const [feedbackSuccess, setFeedbackSuccess] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [trackerCount, setTrackerCount] = useState(0);

  const selectedJobUpdatedAt = selectedJob?.updatedAt ?? "";

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setJobSearchQuery(jobSearchInput.trim());
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [jobSearchInput]);

  const refreshJobs = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("limit", "200");
    if (jobSearchQuery.length > 0) {
      params.set("q", jobSearchQuery);
    }
    const data = await fetchJson<JobsResponse>(`/api/sora-studio/jobs?${params.toString()}`, { cache: "no-store" });
    setJobs(data.jobs);
    setSelectedJobId((current) => {
      if (current && data.jobs.some((job) => job.id === current)) {
        return current;
      }
      return data.jobs[0]?.id ?? null;
    });
  }, [jobSearchQuery]);

  const refreshSelected = useCallback(async (jobId: string) => {
    const data = await fetchJson<JobResponse>(`/api/sora-studio/jobs/${jobId}`, { cache: "no-store" });
    setSelectedJob(data.job);
  }, []);

  const refreshTrackerCount = useCallback(async () => {
    const data = await fetchJson<FeedbackTrackerResponse>("/api/sora-studio/feedback-tracker?limit=1", {
      cache: "no-store"
    });
    setTrackerCount(data.totalCount ?? 0);
  }, []);

  useEffect(() => {
    void (async () => {
      setLoadingJobs(true);
      try {
        await refreshJobs();
        await refreshTrackerCount();
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load jobs.");
      } finally {
        setLoadingJobs(false);
      }
    })();
  }, [refreshJobs, refreshTrackerCount]);

  useEffect(() => {
    if (!selectedJobId) {
      setSelectedJob(null);
      return;
    }
    void refreshSelected(selectedJobId).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Failed to load selected job.");
    });
  }, [refreshSelected, selectedJobId]);

  useEffect(() => {
    setFeedbackDraft(feedbackDraftFromJob(selectedJob));
  }, [selectedJob]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshJobs().catch(() => undefined);
      void refreshTrackerCount().catch(() => undefined);
      if (selectedJobId) {
        void refreshSelected(selectedJobId).catch(() => undefined);
      }
    }, 4000);
    return () => window.clearInterval(interval);
  }, [refreshJobs, refreshSelected, refreshTrackerCount, selectedJobId]);

  const onCreateJob = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);
      setImportSummary("");
      setFeedbackSuccess("");

      if (form.brief.trim().length < 12) {
        setError("Brief must be at least 12 characters.");
        return;
      }

      setCreating(true);
      try {
        const attachments: SoraStudioBriefAttachment[] = [];

        for (const url of parseUrlLines(briefImageUrlInput)) {
          attachments.push({
            name: `Image URL ${attachments.length + 1}`,
            mediaType: "image",
            source: "url",
            url
          });
        }
        for (const url of parseUrlLines(briefVideoUrlInput)) {
          attachments.push({
            name: `Video URL ${attachments.length + 1}`,
            mediaType: "video",
            source: "url",
            url
          });
        }

        if (briefAttachmentFiles.length > 0) {
          const uploadBody = new FormData();
          for (const file of briefAttachmentFiles.slice(0, 8)) {
            uploadBody.append("files", file);
          }
          const uploaded = await fetchJson<UploadAttachmentsResponse>("/api/sora-studio/attachments/upload", {
            method: "POST",
            body: uploadBody
          });
          attachments.push(...uploaded.attachments);
        }

        const cappedAttachments = attachments.slice(0, 8);
        if (attachments.length > 8) {
          setError("Only first 8 brief attachments were used for this run.");
        }

        const payload = {
          product: form.product.trim(),
          brief: form.brief.trim(),
          businessObjective: form.businessObjective.trim() || undefined,
          creativeObjectiveFunnel: form.creativeObjectiveFunnel.trim() || undefined,
          videoDuration: form.videoDuration.trim() || undefined,
          ratioDimensions: form.ratioDimensions.trim() || undefined,
          language: form.language.trim() || undefined,
          notificationEmail: form.notificationEmail.trim() || undefined,
          strictParityMode: form.strictParityMode,
          briefAttachments: cappedAttachments.length > 0 ? cappedAttachments : undefined,
          autoRender: form.autoRender
        };

        const data = await fetchJson<CreateJobResponse>("/api/sora-studio/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });

        setSelectedJobId(data.job.id);
        setSelectedJob(data.job);
        setJobs((current) => upsertJobInList(current, data.job));
        setBriefAttachmentFiles([]);
        setBriefImageUrlInput("");
        setBriefVideoUrlInput("");
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to create job.");
      } finally {
        setCreating(false);
      }
    },
    [briefAttachmentFiles, briefImageUrlInput, briefVideoUrlInput, form]
  );

  const onImportExcel = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setImportSummary("");
      setFeedbackSuccess("");
      setError(null);

      const target = event.currentTarget;
      const fileInput = target.elements.namedItem("file") as HTMLInputElement | null;
      const file = fileInput?.files?.[0];
      if (!file) {
        setError("Choose an Excel/CSV/TSV file before importing.");
        return;
      }

      setImporting(true);
      try {
        const body = new FormData();
        body.set("file", file);
        body.set("autoRender", String(form.autoRender));
        body.set("strictParityMode", String(form.strictParityMode));
        body.set("notificationEmail", form.notificationEmail.trim());
        body.set("maxRows", "200");

        const data = await fetchJson<ImportResponse>("/api/sora-studio/import-excel", {
          method: "POST",
          body
        });

        setImportSummary(
          `Imported ${data.fileName}: ${data.created}/${data.totalRows} rows created, ${data.failed} failed.`
        );
        await refreshJobs();
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Import failed.");
      } finally {
        setImporting(false);
        target.reset();
      }
    },
    [form.autoRender, form.strictParityMode, refreshJobs]
  );

  const onRetry = useCallback(async () => {
    if (!selectedJobId) {
      return;
    }
    setRetrying(true);
    setError(null);
    setFeedbackSuccess("");
    try {
      const data = await fetchJson<JobResponse>(`/api/sora-studio/jobs/${selectedJobId}/retry`, {
        method: "POST"
      });
      if (data.job) {
        setSelectedJob(data.job);
        setJobs((current) => upsertJobInList(current, data.job as SoraStudioClientJob));
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Retry failed.");
    } finally {
      setRetrying(false);
    }
  }, [selectedJobId]);

  const saveVariantFeedback = useCallback(
    async (key: SoraStudioRenderModelKey) => {
      if (!selectedJob) {
        return;
      }
      setSavingVariant(key);
      setError(null);
      setFeedbackSuccess("");
      try {
        const draft = feedbackDraft.variants[key];
        const normalizedDraft: VariantFeedbackDraft = {
          rating: draft?.rating,
          comment: draft?.comment ?? ""
        };
        const payload = {
          variants: {
            [key]: {
              rating: normalizedDraft.rating ?? null,
              comment: normalizedDraft.comment.trim().length > 0 ? normalizedDraft.comment.trim() : null
            }
          }
        };

        const data = await fetchJson<FeedbackSaveResponse>(`/api/sora-studio/jobs/${selectedJob.id}/feedback`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (data.job) {
          setSelectedJob(data.job);
          setJobs((current) => upsertJobInList(current, data.job as SoraStudioClientJob));
          if (data.trackerError) {
            setFeedbackSuccess(
              `${MODEL_ORDER.find((item) => item.key === key)?.label ?? key} feedback saved, but tracker log failed: ${data.trackerError}`
            );
          } else {
            setFeedbackSuccess(
              `${MODEL_ORDER.find((item) => item.key === key)?.label ?? key} feedback saved${
                data.trackerEntryId ? ` (tracker: ${data.trackerEntryId})` : ""
              }.`
            );
          }
          await refreshTrackerCount();
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to save variant feedback.");
      } finally {
        setSavingVariant(null);
      }
    },
    [feedbackDraft.variants, refreshTrackerCount, selectedJob]
  );

  const saveOverallFeedback = useCallback(async () => {
    if (!selectedJob) {
      return;
    }
    setSavingOverall(true);
    setError(null);
    setFeedbackSuccess("");
    try {
      const payload = {
        overallComment:
          feedbackDraft.overallComment.trim().length > 0 ? feedbackDraft.overallComment.trim() : null
      };

      const data = await fetchJson<FeedbackSaveResponse>(`/api/sora-studio/jobs/${selectedJob.id}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (data.job) {
        setSelectedJob(data.job);
        setJobs((current) => upsertJobInList(current, data.job as SoraStudioClientJob));
        if (data.trackerError) {
          setFeedbackSuccess(`Overall feedback saved, but tracker log failed: ${data.trackerError}`);
        } else {
          setFeedbackSuccess(`Overall feedback saved${data.trackerEntryId ? ` (tracker: ${data.trackerEntryId})` : ""}.`);
        }
        await refreshTrackerCount();
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to save overall feedback.");
    } finally {
      setSavingOverall(false);
    }
  }, [feedbackDraft.overallComment, refreshTrackerCount, selectedJob]);

  const renderCards = useMemo(() => {
    if (!selectedJob) {
      return [];
    }

    return MODEL_ORDER.map(({ key, label }) => {
      const render = selectedJob.renders?.find((item) => item.key === key);
      const rawUrl = render?.assetUrl ?? renderAssetUrl(selectedJob, key);
      const videoUrl = rawUrl ? withVersion(rawUrl, selectedJobUpdatedAt) : undefined;
      const downloadUrl = rawUrl ? `${rawUrl}${rawUrl.includes("?") ? "&" : "?"}download=1` : undefined;

      return {
        key,
        label,
        render,
        videoUrl,
        downloadUrl,
        feedback: feedbackDraft.variants[key]
          ? feedbackDraft.variants[key]
          : {
              comment: ""
            }
      };
    });
  }, [feedbackDraft.variants, selectedJob, selectedJobUpdatedAt]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 md:px-8">
      <div className="mx-auto grid max-w-[1600px] gap-6 xl:grid-cols-[360px_1fr]">
        <section className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-red-700">Creative AI - Video</p>
            <h1 className="mt-2 text-2xl font-bold text-slate-950">Input to Video Output</h1>
            <p className="mt-2 text-sm text-slate-600">Choose single input or bulk Excel upload, then generate Model 2 outputs.</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-700">Input Method</label>
            <select
              value={inputMode}
              onChange={(event) => setInputMode(event.target.value as InputMode)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-red-200 focus:border-red-400 focus:ring"
            >
              <option value="single">Single Input</option>
              <option value="bulk">Bulk XLS Upload</option>
            </select>
          </div>

          {inputMode === "single" ? (
            <form onSubmit={onCreateJob} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Single Input</h2>

              <label className="block text-xs font-semibold text-slate-700">Product</label>
              <select
                value={form.product}
                onChange={(event) => setForm((prev) => ({ ...prev, product: event.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-red-200 focus:border-red-400 focus:ring"
              >
                <option value="Kotak Mahindra Bank">Kotak Mahindra Bank</option>
              </select>

              <label className="block text-xs font-semibold text-slate-700">Brief</label>
              <textarea
                value={form.brief}
                onChange={(event) => setForm((prev) => ({ ...prev, brief: event.target.value }))}
                className="h-32 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-red-200 focus:border-red-400 focus:ring"
              />

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Brief Attachments</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Add image/video files or URLs to guide the script and prompt in this brief stage.
                </p>
                <input
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  onChange={(event) => setBriefAttachmentFiles(Array.from(event.target.files ?? []).slice(0, 8))}
                  className="mt-2 w-full text-sm text-slate-700"
                />
                {briefAttachmentFiles.length > 0 ? (
                  <p className="mt-1 text-[11px] text-slate-600">{briefAttachmentFiles.length} file attachment(s) selected.</p>
                ) : null}
                <label className="mt-3 block text-xs font-semibold text-slate-700">Image URLs (optional, one per line)</label>
                <textarea
                  value={briefImageUrlInput}
                  onChange={(event) => setBriefImageUrlInput(event.target.value)}
                  className="mt-1 h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none ring-red-200 focus:border-red-400 focus:ring"
                  placeholder="https://...image1.jpg"
                />
                <label className="mt-2 block text-xs font-semibold text-slate-700">Video URLs (optional, one per line)</label>
                <textarea
                  value={briefVideoUrlInput}
                  onChange={(event) => setBriefVideoUrlInput(event.target.value)}
                  className="mt-1 h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none ring-red-200 focus:border-red-400 focus:ring"
                  placeholder="https://...video1.mp4"
                />
              </div>

              <label className="block text-xs font-semibold text-slate-700">Business Objective</label>
              <input
                value={form.businessObjective}
                onChange={(event) => setForm((prev) => ({ ...prev, businessObjective: event.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-red-200 focus:border-red-400 focus:ring"
              />

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Duration</label>
                  <select
                    value={form.videoDuration}
                    onChange={(event) => setForm((prev) => ({ ...prev, videoDuration: event.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-red-200 focus:border-red-400 focus:ring"
                  >
                    {DURATION_OPTIONS.map((duration) => (
                      <option key={duration} value={duration}>
                        {duration}s
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Ratio</label>
                  <select
                    value={form.ratioDimensions}
                    onChange={(event) => setForm((prev) => ({ ...prev, ratioDimensions: event.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-red-200 focus:border-red-400 focus:ring"
                  >
                    {RATIO_OPTIONS.map((ratio) => (
                      <option key={ratio} value={ratio}>
                        {ratio}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Language</label>
                  <select
                    value={form.language}
                    onChange={(event) => setForm((prev) => ({ ...prev, language: event.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-red-200 focus:border-red-400 focus:ring"
                  >
                    {LANGUAGE_OPTIONS.map((language) => (
                      <option key={language} value={language}>
                        {language}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Notification Email</label>
                <input
                  type="email"
                  value={form.notificationEmail}
                  onChange={(event) => setForm((prev) => ({ ...prev, notificationEmail: event.target.value }))}
                  placeholder="name@company.com"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-red-200 focus:border-red-400 focus:ring"
                />
                <p className="mt-1 text-xs text-slate-500">Sends each completed model video as soon as it is ready.</p>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.strictParityMode}
                  onChange={(event) => setForm((prev) => ({ ...prev, strictParityMode: event.target.checked }))}
                />
                Strict parity mode
              </label>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.autoRender}
                  onChange={(event) => setForm((prev) => ({ ...prev, autoRender: event.target.checked }))}
                />
                Auto render Model 2
              </label>

              <button
                type="submit"
                disabled={creating}
                className="w-full rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
              >
                {creating ? "Creating..." : "Generate Video"}
              </button>
            </form>
          ) : (
            <form onSubmit={onImportExcel} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Bulk XLS Upload</h2>
              <input name="file" type="file" accept=".xlsx,.xlsm,.csv,.tsv" className="w-full text-sm text-slate-700" />
              <div>
                <label className="block text-xs font-semibold text-slate-700">Default Notification Email</label>
                <input
                  type="email"
                  value={form.notificationEmail}
                  onChange={(event) => setForm((prev) => ({ ...prev, notificationEmail: event.target.value }))}
                  placeholder="Used when the Excel row has no Email column"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-red-200 focus:border-red-400 focus:ring"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.strictParityMode}
                  onChange={(event) => setForm((prev) => ({ ...prev, strictParityMode: event.target.checked }))}
                />
                Strict parity mode
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.autoRender}
                  onChange={(event) => setForm((prev) => ({ ...prev, autoRender: event.target.checked }))}
                />
                Auto render Model 2
              </label>
              <button
                type="submit"
                disabled={importing}
                className="w-full rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
              >
                {importing ? "Importing..." : "Upload and Run"}
              </button>
              {importSummary ? <p className="text-xs text-emerald-700">{importSummary}</p> : null}
            </form>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Feedback Tracker</h2>
            <p className="mt-1 text-xs text-slate-600">
              Logged snapshots: <span className="font-semibold text-slate-900">{trackerCount}</span>
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Each feedback save logs input, stage outputs, final video links, and ratings/comments.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a
                href="/api/sora-studio/feedback-tracker?format=json&limit=10000"
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-center text-xs font-semibold text-slate-800 hover:bg-slate-200"
              >
                Open JSON
              </a>
              <a
                href="/api/sora-studio/feedback-tracker?format=csv&limit=10000"
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-center text-xs font-semibold text-slate-800 hover:bg-slate-200"
              >
                Download CSV
              </a>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Recent Jobs</h2>
              {loadingJobs ? <span className="text-xs text-slate-500">Refreshing...</span> : null}
            </div>
            <div className="mb-3 flex items-center gap-2">
              <input
                value={jobSearchInput}
                onChange={(event) => setJobSearchInput(event.target.value)}
                placeholder="Search by brief text"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-red-200 focus:border-red-400 focus:ring"
              />
              {jobSearchInput.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setJobSearchInput("")}
                  className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-200"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <div className="max-h-[360px] space-y-2 overflow-y-auto">
              {jobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => setSelectedJobId(job.id)}
                  className={`w-full rounded-lg border px-3 py-3 text-left ${
                    selectedJobId === job.id ? "border-red-500 bg-red-50" : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-slate-900">{job.input.product}</p>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${STATUS_STYLES[job.status]}`}>
                      {job.status}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600">{job.input.brief}</p>
                  <p className="mt-1 text-[11px] text-slate-500">{formatTime(job.updatedAt)}</p>
                </button>
              ))}
              {jobs.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {jobSearchQuery.length > 0 ? "No jobs match this brief search." : "No jobs yet."}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="space-y-6">
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}
          {feedbackSuccess ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{feedbackSuccess}</div>
          ) : null}

          {selectedJob ? (
            <>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-slate-950">Output</h2>
                    <p className="text-xs text-slate-500">Job {selectedJob.id} • {formatTime(selectedJob.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${STATUS_STYLES[selectedJob.status]}`}>
                      {selectedJob.status}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        void onRetry();
                      }}
                      disabled={retrying}
                      className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-200 disabled:opacity-60"
                    >
                      {retrying ? "Retrying..." : "Retry"}
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-sm text-slate-700">{selectedJob.input.brief}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Strict parity mode: {selectedJob.input.strictParityMode === false ? "Off" : "On"}
                </p>
                {Array.isArray(selectedJob.input.briefAttachments) && selectedJob.input.briefAttachments.length > 0 ? (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Brief Attachments</p>
                    <ul className="mt-2 space-y-1">
                      {selectedJob.input.briefAttachments.slice(0, 8).map((item, index) => (
                        <li key={`${item.url}-${index}`} className="text-xs text-slate-600">
                          {item.mediaType.toUpperCase()} • {item.name} •{" "}
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold text-red-700 hover:text-red-800"
                          >
                            Open
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {Array.isArray(selectedJob.warnings) && selectedJob.warnings.length > 0 ? (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">Run Warnings</p>
                    <ul className="mt-2 space-y-1">
                      {selectedJob.warnings.map((warning, index) => (
                        <li key={`${warning}-${index}`} className="text-xs text-amber-800">
                          {warning}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-4 xl:grid-cols-3">
                {renderCards.map((card) => (
                  <div key={card.key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-semibold text-slate-900">{card.label}</h3>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${
                          RENDER_STATUS_STYLES[card.render?.status ?? "pending"]
                        }`}
                      >
                        {card.render?.status ?? "pending"}
                      </span>
                    </div>

                    {card.videoUrl ? (
                      <>
                        <video
                          key={card.videoUrl}
                          src={card.videoUrl}
                          controls
                          playsInline
                          className="mt-3 aspect-[9/16] w-full rounded-lg border border-slate-200 bg-black object-cover"
                        />
                        {card.downloadUrl ? (
                          <a
                            href={card.downloadUrl}
                            className="mt-2 inline-flex rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-200"
                          >
                            Download Video
                          </a>
                        ) : null}
                        {card.render?.postProcess ? (
                          <p className="mt-2 text-[11px] text-slate-500">
                            Branding: {card.render.postProcess.profileLabel} / {card.render.postProcess.funnelStage}
                            {card.render.postProcess.applied ? " applied" : " not applied"}
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <div className="mt-3 flex aspect-[9/16] w-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
                        Video not ready yet.
                      </div>
                    )}

                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Star Rating</p>
                      <StarRating
                        value={card.feedback.rating}
                        onChange={(next) =>
                          setFeedbackDraft((prev) => ({
                            ...prev,
                            variants: {
                              ...prev.variants,
                              [card.key]: {
                                ...prev.variants[card.key],
                                rating: next
                              }
                            }
                          }))
                        }
                      />
                    </div>

                    <div className="mt-3">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-700">Feedback</p>
                      <textarea
                        value={card.feedback.comment}
                        onChange={(event) =>
                          setFeedbackDraft((prev) => ({
                            ...prev,
                            variants: {
                              ...prev.variants,
                              [card.key]: {
                                ...prev.variants[card.key],
                                comment: event.target.value
                              }
                            }
                          }))
                        }
                        placeholder="What worked / what did not?"
                        className="h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-red-200 focus:border-red-400 focus:ring"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={savingVariant === card.key}
                      onClick={() => {
                        void saveVariantFeedback(card.key);
                      }}
                      className="mt-3 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-200 disabled:opacity-60"
                    >
                      {savingVariant === card.key ? "Saving..." : "Save Feedback"}
                    </button>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Overall Feedback</h3>
                <textarea
                  value={feedbackDraft.overallComment}
                  onChange={(event) => setFeedbackDraft((prev) => ({ ...prev, overallComment: event.target.value }))}
                  placeholder="Overall notes for this brief and outputs."
                  className="mt-3 h-28 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-red-200 focus:border-red-400 focus:ring"
                />
                <button
                  type="button"
                  disabled={savingOverall}
                  onClick={() => {
                    void saveOverallFeedback();
                  }}
                  className="mt-3 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
                >
                  {savingOverall ? "Saving..." : "Save Overall Feedback"}
                </button>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
              Create a run or select a recent job to see the two video outputs.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
