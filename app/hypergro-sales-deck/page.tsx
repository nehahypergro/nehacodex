"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { TEMPLATE_LABELS } from "@/app/lib/hypergro/templates";
import { DeckClientJob, DeckRuntimeStatus, DeckStepStatus } from "@/app/lib/hypergro/types";

const STEP_STYLES: Record<DeckStepStatus, string> = {
  pending: "bg-slate-200 text-slate-700",
  running: "bg-amber-200 text-amber-900",
  completed: "bg-emerald-200 text-emerald-900",
  failed: "bg-rose-200 text-rose-900",
  skipped: "bg-stone-200 text-stone-700"
};

const JOB_STYLES: Record<DeckClientJob["status"], string> = {
  queued: "text-slate-600",
  running: "text-amber-700",
  completed: "text-emerald-700",
  failed: "text-rose-700"
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(json.error ?? `Request failed with status ${response.status}`);
  }
  return json;
}

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function slideCardClass(index: number): string {
  if (index === 0 || index === 4 || index === 8) {
    return "border-slate-800 bg-slate-950 text-white";
  }
  return "border-stone-200 bg-white text-slate-900";
}

export default function HypergroSalesDeckPage() {
  const [brief, setBrief] = useState("");
  const [sampleDeckText, setSampleDeckText] = useState("");
  const [styleNotes, setStyleNotes] = useState("");
  const [sampleDeckFile, setSampleDeckFile] = useState<File | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<DeckRuntimeStatus | null>(null);
  const [jobs, setJobs] = useState<DeckClientJob[]>([]);
  const [currentJob, setCurrentJob] = useState<DeckClientJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadJobs(preferredJobId?: string): Promise<void> {
    try {
      const json = await fetchJson<{ jobs: DeckClientJob[] }>("/api/hypergro-sales-deck/jobs", { cache: "no-store" });
      setJobs(json.jobs);
      if (preferredJobId) {
        const preferred = json.jobs.find((job) => job.id === preferredJobId);
        if (preferred) {
          setCurrentJob(preferred);
          return;
        }
      }
      if (!currentJob && json.jobs[0]) {
        setCurrentJob(json.jobs[0]);
      }
    } catch (loadError) {
      console.error("Failed to load jobs", loadError);
    }
  }

  async function loadJob(jobId: string): Promise<void> {
    try {
      const json = await fetchJson<{ job: DeckClientJob }>(`/api/hypergro-sales-deck/jobs/${jobId}`, { cache: "no-store" });
      setCurrentJob(json.job);
      setError(null);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load the selected job.";
      setError(message);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const status = await fetchJson<DeckRuntimeStatus>("/api/hypergro-sales-deck/status", { cache: "no-store" });
        setRuntimeStatus(status);
      } catch (statusError) {
        console.error("Failed to load runtime status", statusError);
      }

      try {
        const json = await fetchJson<{ jobs: DeckClientJob[] }>("/api/hypergro-sales-deck/jobs", { cache: "no-store" });
        setJobs(json.jobs);
        if (json.jobs[0]) {
          setCurrentJob(json.jobs[0]);
        }
      } catch (loadError) {
        console.error("Failed to load jobs", loadError);
      }
    })();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const formData = new FormData();
    formData.set("brief", brief);
    formData.set("sampleDeckText", sampleDeckText);
    formData.set("styleNotes", styleNotes);
    if (sampleDeckFile) {
      formData.set("sampleDeckFile", sampleDeckFile);
    }

    try {
      const json = await fetchJson<{ job: DeckClientJob }>("/api/hypergro-sales-deck/jobs", {
        method: "POST",
        body: formData
      });
      setCurrentJob(json.job);
      await loadJobs(json.job.id);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Deck generation failed.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f3ede2_0%,#fbf7f1_55%,#ffffff_100%)] text-slate-900">
      <section className="mx-auto max-w-7xl px-6 py-10 lg:px-10">
        <div className="overflow-hidden rounded-[2rem] border border-slate-900/10 bg-slate-950 text-white shadow-[0_30px_80px_rgba(15,23,42,0.16)]">
          <div className="grid gap-8 px-8 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:px-10">
            <div className="space-y-6">
              <div className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-slate-200">
                Gemini + Nano Banana Pro + Google Slides
              </div>
              <div className="space-y-4">
                <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white md:text-5xl">
                  Hypergro deck generator with reusable BCG-style slide templates.
                </h1>
                <p className="max-w-2xl text-base leading-7 text-slate-300 md:text-lg">
                  Feed it a strategic brief, a sample deck, or both. The app generates a consulting-style storyline, a
                  Nano Banana Pro visual direction, and a live Google Slides deck with structured executive layouts.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Gemini</div>
                  <div className="mt-2 text-sm text-slate-200">
                    {runtimeStatus?.geminiConfigured ? "Configured" : "Missing API key"}
                  </div>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Slides export</div>
                  <div className="mt-2 text-sm text-slate-200">
                    {runtimeStatus?.slidesConfigured ? "Configured" : "Configured in code, credentials missing"}
                  </div>
                </div>
              </div>
            </div>
            <div className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,#ff7b54_0%,transparent_36%),radial-gradient(circle_at_bottom_right,#1f9e93_0%,transparent_32%),linear-gradient(180deg,#13253c_0%,#0b1627_100%)] p-6">
              <div className="space-y-4">
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">What this outputs</div>
                <ul className="space-y-3 text-sm leading-6 text-slate-100">
                  <li>9-slide Hypergro sales deck structured for senior decision-makers.</li>
                  <li>Reusable template system instead of one-off prompt artboards.</li>
                  <li>Local JSON and visual assets plus a live Google Slides export when credentials are set.</li>
                </ul>
                <div className="rounded-[1.35rem] border border-white/10 bg-black/20 p-4 text-sm text-slate-200">
                  Route: <span className="font-semibold text-white">/hypergro-sales-deck</span>
                  <br />
                  Fixed dev port: <span className="font-semibold text-white">4415</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[0.96fr_1.04fr]">
          <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
            <div className="mb-5">
              <h2 className="text-2xl font-semibold text-slate-900">Generate a deck</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Use a brief, a sample deck upload, or a pasted deck excerpt. The system will combine whichever sources
                you provide.
              </p>
            </div>

            <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">Strategic brief</span>
                <textarea
                  className="min-h-44 w-full rounded-[1.4rem] border border-stone-200 bg-stone-50 px-4 py-4 text-sm leading-6 text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                  placeholder="Example: Hypergro wants a consultative sales deck for enterprise brands, positioning its creator + performance + commerce operating model as a faster path to profitable growth."
                  value={brief}
                  onChange={(event) => setBrief(event.target.value)}
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">Sample deck upload</span>
                <input
                  className="block w-full rounded-[1.4rem] border border-dashed border-stone-300 bg-stone-50 px-4 py-4 text-sm text-slate-700 file:mr-4 file:rounded-full file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                  type="file"
                  accept=".pdf,.txt,.md,.json,.ppt,.pptx"
                  onChange={(event) => setSampleDeckFile(event.target.files?.[0] ?? null)}
                />
                <div className="mt-2 text-xs text-slate-500">
                  {sampleDeckFile ? `${sampleDeckFile.name} • ${(sampleDeckFile.size / 1024 / 1024).toFixed(1)} MB` : "Optional, up to 25MB."}
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">Pasted sample deck excerpt</span>
                <textarea
                  className="min-h-36 w-full rounded-[1.4rem] border border-stone-200 bg-stone-50 px-4 py-4 text-sm leading-6 text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                  placeholder="Paste slide text, an outline, or a narrative spine if you do not want to upload a file."
                  value={sampleDeckText}
                  onChange={(event) => setSampleDeckText(event.target.value)}
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">Style notes</span>
                <textarea
                  className="min-h-28 w-full rounded-[1.4rem] border border-stone-200 bg-stone-50 px-4 py-4 text-sm leading-6 text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                  placeholder="Optional: sector emphasis, audience nuance, deal framing, or tone constraints."
                  value={styleNotes}
                  onChange={(event) => setStyleNotes(event.target.value)}
                />
              </label>

              {error ? (
                <div className="rounded-[1.35rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
              ) : null}

              {!runtimeStatus?.slidesConfigured ? (
                <div className="rounded-[1.35rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Google Slides export will be skipped until service-account credentials are added. The deck JSON and local
                  preview will still generate.
                </div>
              ) : null}

              <button
                type="submit"
                disabled={submitting || !runtimeStatus?.geminiConfigured}
                className="inline-flex w-full items-center justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {submitting ? "Generating Hypergro deck..." : "Generate Hypergro sales deck"}
              </button>
            </form>
          </section>

          <section className="space-y-6">
            <div className="rounded-[2rem] border border-stone-200 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold text-slate-900">Latest output</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Strategy, visual direction, and Slides export status are all tracked per deck.
                  </p>
                </div>
                {currentJob ? (
                  <div className={`text-sm font-semibold ${JOB_STYLES[currentJob.status]}`}>{currentJob.status.toUpperCase()}</div>
                ) : null}
              </div>

              {currentJob ? (
                <div className="mt-5 space-y-5">
                  <div className="flex flex-wrap gap-2">
                    {currentJob.steps.map((step) => (
                      <div key={step.id} className={`rounded-full px-3 py-1 text-xs font-semibold ${STEP_STYLES[step.status]}`}>
                        {step.label}
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50 p-5">
                      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Deck</div>
                      <h3 className="mt-3 text-2xl font-semibold text-slate-900">{currentJob.deck?.title ?? "Processing..."}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {currentJob.deck?.subtitle ?? "Gemini is preparing the boardroom storyline."}
                      </p>
                      {currentJob.deck?.thesis ? (
                        <div className="mt-4 rounded-[1.2rem] bg-white p-4 text-sm leading-6 text-slate-700 shadow-sm">
                          {currentJob.deck.thesis}
                        </div>
                      ) : null}
                      <div className="mt-4 flex flex-wrap gap-3 text-sm">
                        {currentJob.slides.presentationUrl ? (
                          <a
                            className="rounded-full bg-slate-950 px-4 py-2 font-semibold text-white"
                            href={currentJob.slides.presentationUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Open Google Slides
                          </a>
                        ) : null}
                        {currentJob.assets.deckJsonUrl ? (
                          <a
                            className="rounded-full border border-stone-300 px-4 py-2 font-semibold text-slate-700"
                            href={`${currentJob.assets.deckJsonUrl}?download=1`}
                          >
                            Download JSON
                          </a>
                        ) : null}
                      </div>
                    </div>

                    <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50 p-5">
                      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Visual direction</div>
                      <p className="mt-3 text-sm leading-6 text-slate-700">
                        {currentJob.deck?.visualDirection ?? "Waiting for the visual direction pass."}
                      </p>
                      {currentJob.assets.heroImageUrl ? (
                        <Image
                          alt="Generated Hypergro hero visual"
                          className="mt-4 h-48 w-full rounded-[1.2rem] object-cover shadow-sm"
                          height={540}
                          src={currentJob.assets.heroImageUrl}
                          unoptimized
                          width={960}
                        />
                      ) : (
                        <div className="mt-4 rounded-[1.2rem] border border-dashed border-stone-300 bg-white/80 p-5 text-sm text-slate-500">
                          Hero visual preview will appear here when the image pass succeeds.
                        </div>
                      )}
                    </div>
                  </div>

                  {currentJob.warnings.length > 0 ? (
                    <div className="rounded-[1.4rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      {currentJob.warnings.join(" ")}
                    </div>
                  ) : null}

                  {currentJob.deck ? (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {currentJob.deck.slides.map((slide, index) => (
                        <article
                          key={`${slide.templateId}-${index}`}
                          className={`rounded-[1.55rem] border p-4 shadow-sm ${slideCardClass(index)}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] opacity-70">
                              {TEMPLATE_LABELS[slide.templateId]}
                            </div>
                            <div className="text-xs font-semibold opacity-60">0{index + 1}</div>
                          </div>
                          <h3 className="mt-3 text-lg font-semibold">{slide.title}</h3>
                          <p className="mt-2 text-sm leading-6 opacity-80">{slide.headline}</p>
                          <ul className="mt-4 space-y-2 text-sm leading-6 opacity-85">
                            {slide.bullets.slice(0, 3).map((bullet) => (
                              <li key={bullet}>• {bullet}</li>
                            ))}
                          </ul>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-6 rounded-[1.5rem] border border-dashed border-stone-300 bg-stone-50 p-6 text-sm leading-6 text-slate-600">
                  No deck generated yet. Submit a brief or sample deck to create the first Hypergro presentation.
                </div>
              )}
            </div>

            <div className="rounded-[2rem] border border-stone-200 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold text-slate-900">Recent deck jobs</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">Reload and reopen previous Hypergro decks.</p>
                </div>
                <button
                  type="button"
                  className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-slate-700"
                  onClick={() => void loadJobs(currentJob?.id)}
                >
                  Refresh
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {jobs.length === 0 ? (
                  <div className="rounded-[1.4rem] border border-dashed border-stone-300 bg-stone-50 px-4 py-5 text-sm text-slate-500">
                    No jobs yet.
                  </div>
                ) : (
                  jobs.map((job) => (
                    <button
                      key={job.id}
                      type="button"
                      className="flex w-full items-center justify-between rounded-[1.35rem] border border-stone-200 bg-stone-50 px-4 py-4 text-left transition hover:border-slate-300 hover:bg-white"
                      onClick={() => void loadJob(job.id)}
                    >
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{job.deck?.title ?? "Hypergro deck job"}</div>
                        <div className="mt-1 text-xs text-slate-500">{formatDate(job.updatedAt)}</div>
                      </div>
                      <div className={`text-xs font-semibold uppercase ${JOB_STYLES[job.status]}`}>{job.status}</div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
