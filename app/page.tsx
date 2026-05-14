"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { APP_NAME, PRODUCT_SPECS, PRODUCT_TOGGLES } from "@/app/lib/spec";
import { ClientRun, ProductKey } from "@/app/lib/types";

const STATUS_STYLES: Record<ClientRun["status"], string> = {
  queued: "bg-slate-200 text-slate-700",
  running: "bg-amber-200 text-amber-900",
  completed: "bg-emerald-200 text-emerald-900",
  failed: "bg-rose-200 text-rose-900",
  partial_failed: "bg-orange-200 text-orange-900"
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const json = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(json.error ?? `Request failed with status ${response.status}`);
  }

  return json;
}

function formatTime(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function withQuery(url: string, query: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

function getAssetVersion(run: ClientRun | null): string {
  if (!run?.updatedAt) {
    return "0";
  }
  const timestamp = Date.parse(run.updatedAt);
  return Number.isFinite(timestamp) ? String(timestamp) : run.updatedAt;
}

export default function HomePage() {
  const [product, setProduct] = useState<ProductKey>("kotak_air_plus");
  const [brief, setBrief] = useState("");
  const [runs, setRuns] = useState<ClientRun[]>([]);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [currentRun, setCurrentRun] = useState<ClientRun | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSpec = useMemo(() => PRODUCT_SPECS[product], [product]);
  const assetVersion = useMemo(() => getAssetVersion(currentRun), [currentRun]);

  const loadRuns = useCallback(async () => {
    try {
      const json = await fetchJson<{ runs: ClientRun[] }>("/api/runs", { cache: "no-store" });
      setRuns(json.runs);
      if (!currentRunId && json.runs[0]) {
        setCurrentRunId(json.runs[0].id);
        setCurrentRun(json.runs[0]);
      }
    } catch (loadError) {
      console.error("Failed to load runs", loadError);
    }
  }, [currentRunId]);

  const loadRun = useCallback(async (runId: string) => {
    setLoading(true);
    try {
      const json = await fetchJson<{ run: ClientRun }>(`/api/runs/${runId}`, { cache: "no-store" });
      setCurrentRun(json.run);
      setCurrentRunId(json.run.id);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load run.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (!currentRunId) {
      return;
    }
    void loadRun(currentRunId);
    const interval = window.setInterval(() => {
      void loadRun(currentRunId);
    }, 3000);
    return () => window.clearInterval(interval);
  }, [currentRunId, loadRun]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadRuns();
    }, 15000);
    return () => window.clearInterval(interval);
  }, [loadRuns]);

  const onGenerate = async (): Promise<void> => {
    setError(null);
    const compactBrief = brief.trim();
    if (compactBrief.length < 12) {
      setError("Please enter a brief with at least 12 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const json = await fetchJson<{ run: ClientRun }>("/api/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          product,
          brief: compactBrief,
          videoType: "point_to_camera_multi_scene",
          durationSeconds: 8
        })
      });
      setCurrentRun(json.run);
      setCurrentRunId(json.run.id);
      await loadRuns();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to create run.");
    } finally {
      setSubmitting(false);
    }
  };

  const sortedLogs = useMemo(() => {
    if (!currentRun) {
      return [];
    }
    return [...currentRun.logs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [currentRun]);

  const soraVideoSrc = currentRun?.children.sora.finalVideoUrl
    ? withQuery(currentRun.children.sora.finalVideoUrl, `v=${encodeURIComponent(assetVersion)}-sora`)
    : undefined;
  const veoVideoSrc = currentRun?.children.veo31_standard.finalVideoUrl
    ? withQuery(currentRun.children.veo31_standard.finalVideoUrl, `v=${encodeURIComponent(assetVersion)}-veo`)
    : undefined;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 md:px-8">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[420px_1fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-600">Kotak Ad Intelligence</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-950">{APP_NAME}</h1>
          <p className="mt-2 text-sm text-slate-600">One brief in. Two final videos out. Shared planning with side-by-side provider comparison.</p>

          <div className="mt-6 grid grid-cols-2 gap-2">
            {PRODUCT_TOGGLES.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setProduct(option.key)}
                className={`rounded-xl border px-3 py-3 text-left text-sm transition ${
                  product === option.key
                    ? "border-red-500 bg-red-50 text-red-800"
                    : "border-slate-200 bg-white text-slate-700 hover:border-red-200"
                }`}
              >
                <p className="font-semibold">{option.label}</p>
                <p className="mt-1 text-xs opacity-80">8s dual-provider run</p>
              </button>
            ))}
          </div>

          <div className="mt-5">
            <label className="mb-2 block text-sm font-semibold text-slate-800">Brief</label>
            <textarea
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="Example: BOFU Meta reel for practical metro spenders. Push 5% cashback on groceries and food delivery, direct-to-camera, conversion-led."
              className="h-44 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-200"
            />
          </div>

          <button
            type="button"
            disabled={submitting}
            onClick={() => {
              void onGenerate();
            }}
            className="mt-5 w-full rounded-xl bg-bankRed px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Creating dual-provider run..." : "Generate 2 videos"}
          </button>

          {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}

          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Current product hooks</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
              {selectedSpec.hooks.map((hook) => (
                <li key={hook}>{hook}</li>
              ))}
            </ul>
          </div>

          {runs.length > 0 ? (
            <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Recent runs</p>
              <div className="mt-3 space-y-2">
                {runs.slice(0, 5).map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => setCurrentRunId(run.id)}
                    className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                      currentRunId === run.id
                        ? "border-red-500 bg-red-50"
                        : "border-slate-200 bg-slate-50 hover:border-red-200"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-slate-900">{run.brief}</p>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${STATUS_STYLES[run.status]}`}>
                        {run.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{formatTime(run.createdAt)}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Run status</p>
                <h2 className="mt-1 text-xl font-bold text-slate-950">{currentRun ? PRODUCT_TOGGLES.find((item) => item.key === currentRun.product)?.label : "No run selected"}</h2>
              </div>
              {currentRun ? (
                <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${STATUS_STYLES[currentRun.status]}`}>
                  {currentRun.status.replace(/_/g, " ")}
                </span>
              ) : null}
            </div>

            {currentRun ? (
              <>
                <p className="mt-3 text-sm text-slate-700">{currentRun.brief}</p>
                <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Created</p>
                    <p className="mt-1 font-medium text-slate-900">{formatTime(currentRun.createdAt)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Prompt version</p>
                    <p className="mt-1 font-medium text-slate-900">{currentRun.promptVersion}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Runtime</p>
                    <p className="mt-1 font-medium text-slate-900">8s point-to-camera</p>
                  </div>
                </div>
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Shared script</p>
                  <p className="mt-2 text-sm text-slate-900">{currentRun.sharedPlan.script ?? "Generating shared script..."}</p>
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-slate-600">Submit a brief to create a dual-provider run.</p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Logs</p>
                <h3 className="mt-1 text-lg font-bold text-slate-950">Execution stream</h3>
              </div>
              {loading ? <span className="text-xs text-slate-500">Refreshing…</span> : null}
            </div>
            <div className="mt-4 max-h-[340px] space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
              {sortedLogs.length > 0 ? (
                sortedLogs.map((entry, index) => (
                  <div key={`${entry.timestamp}-${entry.scope}-${index}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{entry.scope}</span>
                      <span className="text-[11px] text-slate-400">{formatTime(entry.timestamp)}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-800">{entry.message}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">No logs yet.</p>
              )}
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            {currentRun ? (
              ([currentRun.children.sora, currentRun.children.veo31_standard] as const).map((child) => {
                const videoSrc = child.provider === "sora" ? soraVideoSrc : veoVideoSrc;
                return (
                  <div key={child.provider} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Provider output</p>
                        <h3 className="mt-1 text-lg font-bold text-slate-950">{child.label}</h3>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${
                          child.status === "completed"
                            ? STATUS_STYLES.completed
                            : child.status === "failed"
                              ? STATUS_STYLES.failed
                              : child.status === "running"
                                ? STATUS_STYLES.running
                                : STATUS_STYLES.queued
                        }`}
                      >
                        {child.status}
                      </span>
                    </div>

                    <p className="mt-3 text-sm text-slate-600">{child.message ?? "Waiting to start."}</p>

                    {videoSrc ? (
                      <video
                        key={videoSrc}
                        src={videoSrc}
                        controls
                        playsInline
                        className="mt-4 aspect-[9/16] w-full rounded-xl border border-slate-200 bg-black object-cover"
                      />
                    ) : (
                      <div className="mt-4 flex aspect-[9/16] w-full items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
                        Final video not ready yet.
                      </div>
                    )}

                    {child.assessment ? (
                      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Gemini assessment</p>
                          <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                            {child.assessment.score.toFixed(1)}/10
                          </span>
                        </div>
                        <div className="mt-3 space-y-3 text-sm">
                          <div>
                            <p className="font-semibold text-slate-900">What will work</p>
                            <p className="mt-1 text-slate-700">{child.assessment.whatWillWork}</p>
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900">Why it will work</p>
                            <p className="mt-1 text-slate-700">{child.assessment.whyItWillWork}</p>
                          </div>
                          {child.assessment.concerns.length > 0 ? (
                            <div>
                              <p className="font-semibold text-slate-900">Concerns</p>
                              <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">
                                {child.assessment.concerns.map((concern) => (
                                  <li key={concern}>{concern}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm xl:col-span-2">
                Final Sora text-to-video and Veo image-to-video outputs will appear here.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
