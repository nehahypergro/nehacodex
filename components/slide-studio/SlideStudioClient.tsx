"use client";

import { FormEvent, useEffect, useState } from "react";
import { OutlineEditor } from "@/components/slide-studio/OutlineEditor";
import { PreviewRenderableSlide, SlidePreview } from "@/components/slide-studio/SlidePreview";
import { SlideEditor } from "@/components/slide-studio/SlideEditor";
import { resolveLayoutProps } from "@/app/lib/slide-studio/services/layout-engine";
import { OutlineSlide, ProjectBundle, ProjectRecord, RuntimeCapabilities, SlideRecord } from "@/app/lib/slide-studio/types";

interface ProjectsResponse {
  projects: ProjectRecord[];
  runtime: RuntimeCapabilities;
}

interface BundleResponse {
  bundle: ProjectBundle;
  runtime?: RuntimeCapabilities;
}

interface CreateFormState {
  title: string;
  prompt: string;
  audience: string;
  tone: string;
  targetSlideCount: number;
}

const DEFAULT_FORM: CreateFormState = {
  title: "",
  prompt: "",
  audience: "",
  tone: "",
  targetSlideCount: 8
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init
  });
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(json.error ?? `Request failed with status ${response.status}`);
  }
  return json;
}

function reindexOutline(slides: OutlineSlide[]): OutlineSlide[] {
  return slides.map((slide, index) => ({
    ...slide,
    slideIndex: index + 1
  }));
}

function buildPreviewSlide(bundle: ProjectBundle | null, outlineDraft: OutlineSlide[], selectedSlideIndex: number | null): PreviewRenderableSlide | null {
  if (!bundle || selectedSlideIndex == null) {
    return null;
  }

  const actualSlide = bundle.slides.find((slide) => slide.slideIndex === selectedSlideIndex);
  if (actualSlide) {
    return {
      slideIndex: actualSlide.slideIndex,
      slideType: actualSlide.slideType,
      title: actualSlide.title,
      objective: actualSlide.objective,
      bullets: actualSlide.bullets,
      layoutProps: actualSlide.layoutProps,
      visualInstructions: actualSlide.visualInstructions,
      citations: actualSlide.citations
    };
  }

  const outlineSlide = outlineDraft.find((slide) => slide.slideIndex === selectedSlideIndex);
  if (!outlineSlide) {
    return null;
  }

  return {
    slideIndex: outlineSlide.slideIndex,
    slideType: outlineSlide.recommendedSlideType,
    title: outlineSlide.slideTitle,
    objective: outlineSlide.slideObjective,
    bullets: outlineSlide.keyBullets,
    layoutProps: resolveLayoutProps(outlineSlide.recommendedSlideType, outlineSlide.keyBullets.length),
    citations: []
  };
}

export function SlideStudioClient() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [runtime, setRuntime] = useState<RuntimeCapabilities | null>(null);
  const [bundle, setBundle] = useState<ProjectBundle | null>(null);
  const [outlineDraft, setOutlineDraft] = useState<OutlineSlide[]>([]);
  const [slidesDraft, setSlidesDraft] = useState<SlideRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedSlideIndex, setSelectedSlideIndex] = useState<number | null>(null);
  const [form, setForm] = useState<CreateFormState>(DEFAULT_FORM);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [activeStatus, setActiveStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetchJson<ProjectsResponse>("/api/slide-studio/projects");
        setProjects(response.projects);
        setRuntime(response.runtime);
        if (response.projects[0]) {
          setSelectedProjectId(response.projects[0].id);
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load projects.");
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setBundle(null);
      setOutlineDraft([]);
      setSlidesDraft([]);
      return;
    }

    void (async () => {
      try {
        const response = await fetchJson<BundleResponse>(`/api/slide-studio/projects/${selectedProjectId}`);
        syncBundle(response.bundle);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load the selected project.");
      }
    })();
  }, [selectedProjectId]);

  function syncBundle(nextBundle: ProjectBundle) {
    setBundle(nextBundle);
    setSelectedProjectId(nextBundle.project.id);
    setOutlineDraft(nextBundle.outline?.slides ?? []);
    setSlidesDraft(nextBundle.slides);
    setProjects((current) => {
      const remaining = current.filter((project) => project.id !== nextBundle.project.id);
      return [nextBundle.project, ...remaining];
    });

    const nextIndex =
      nextBundle.slides[0]?.slideIndex ??
      nextBundle.outline?.slides[0]?.slideIndex ??
      null;
    setSelectedSlideIndex((current) => {
      if (
        current &&
        (nextBundle.slides.some((slide) => slide.slideIndex === current) ||
          nextBundle.outline?.slides.some((slide) => slide.slideIndex === current))
      ) {
        return current;
      }
      return nextIndex;
    });
  }

  async function runAction(status: string, operation: () => Promise<void>) {
    setError(null);
    setActiveStatus(status);
    setIsBusy(true);
    try {
      await operation();
    } finally {
      setActiveStatus(null);
      setIsBusy(false);
    }
  }

  async function refreshProjects(): Promise<void> {
    const response = await fetchJson<ProjectsResponse>("/api/slide-studio/projects");
    setProjects(response.projects);
    setRuntime(response.runtime);
  }

  async function handleCreateProject(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      await runAction("create-project", async () => {
        const body = new FormData();
        body.set("title", form.title);
        body.set("prompt", form.prompt);
        body.set("audience", form.audience);
        body.set("tone", form.tone);
        body.set("targetSlideCount", String(form.targetSlideCount));
        for (const file of uploadFiles) {
          body.append("files", file);
        }

        const response = await fetchJson<BundleResponse>("/api/slide-studio/projects", {
          method: "POST",
          body
        });
        if (response.runtime) {
          setRuntime(response.runtime);
        }
        syncBundle(response.bundle);
        setForm(DEFAULT_FORM);
        setUploadFiles([]);
        await refreshProjects();
      });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Project creation failed.");
    }
  }

  async function handleGenerateOutline() {
    if (!bundle) {
      return;
    }
    try {
      await runAction("generate-outline", async () => {
        const response = await fetchJson<BundleResponse>(`/api/slide-studio/projects/${bundle.project.id}/outline`, {
          method: "POST"
        });
        syncBundle(response.bundle);
      });
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Outline generation failed.");
    }
  }

  async function saveOutline(status: "draft" | "approved", stateLabel: string) {
    if (!bundle) {
      return;
    }
    try {
      await runAction(stateLabel, async () => {
        const response = await fetchJson<BundleResponse>(`/api/slide-studio/projects/${bundle.project.id}/outline`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            status,
            slides: reindexOutline(outlineDraft)
          })
        });
        syncBundle(response.bundle);
      });
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Outline save failed.");
    }
  }

  async function handleGenerateSlides() {
    if (!bundle) {
      return;
    }
    try {
      await runAction("generate-slides", async () => {
        const saved = await fetchJson<BundleResponse>(`/api/slide-studio/projects/${bundle.project.id}/outline`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            status: "approved",
            slides: reindexOutline(outlineDraft)
          })
        });
        syncBundle(saved.bundle);
        const response = await fetchJson<BundleResponse>(`/api/slide-studio/projects/${bundle.project.id}/slides`, {
          method: "POST"
        });
        syncBundle(response.bundle);
      });
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Slide generation failed.");
    }
  }

  async function handleSaveSlide(slideIndex: number) {
    if (!bundle) {
      return;
    }
    const slide = slidesDraft.find((item) => item.slideIndex === slideIndex);
    if (!slide) {
      return;
    }
    try {
      await runAction(`save-slide-${slideIndex}`, async () => {
        const response = await fetchJson<BundleResponse>(`/api/slide-studio/projects/${bundle.project.id}/slides/${slide.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            title: slide.title,
            objective: slide.objective,
            bullets: slide.bullets,
            speakerNotes: slide.speakerNotes,
            visualInstructions: slide.visualInstructions,
            layoutProps: slide.layoutProps,
            citations: slide.citations
          })
        });
        syncBundle(response.bundle);
      });
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Saving the slide failed.");
    }
  }

  async function handleRegenerateSlide(slideIndex: number) {
    if (!bundle) {
      return;
    }
    const slide = slidesDraft.find((item) => item.slideIndex === slideIndex);
    if (!slide) {
      return;
    }
    try {
      await runAction(`regen-slide-${slideIndex}`, async () => {
        const response = await fetchJson<BundleResponse>(
          `/api/slide-studio/projects/${bundle.project.id}/slides/${slide.id}/regenerate`,
          {
            method: "POST"
          }
        );
        syncBundle(response.bundle);
      });
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Slide regeneration failed.");
    }
  }

  async function handleExport() {
    if (!bundle) {
      return;
    }
    try {
      await runAction("export-json", async () => {
        const response = await fetchJson<BundleResponse>(`/api/slide-studio/projects/${bundle.project.id}/exports`, {
          method: "POST"
        });
        syncBundle(response.bundle);
      });
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Export failed.");
    }
  }

  function updateOutlineSlide(slideIndex: number, patch: Partial<OutlineSlide>) {
    setOutlineDraft((current) =>
      current.map((slide) => (slide.slideIndex === slideIndex ? { ...slide, ...patch } : slide))
    );
  }

  function updateOutlineBullet(slideIndex: number, bulletIndex: number, value: string) {
    setOutlineDraft((current) =>
      current.map((slide) =>
        slide.slideIndex === slideIndex
          ? {
              ...slide,
              keyBullets: slide.keyBullets.map((bullet, index) => (index === bulletIndex ? value : bullet))
            }
          : slide
      )
    );
  }

  function addOutlineBullet(slideIndex: number) {
    setOutlineDraft((current) =>
      current.map((slide) =>
        slide.slideIndex === slideIndex && slide.keyBullets.length < 5
          ? { ...slide, keyBullets: [...slide.keyBullets, ""] }
          : slide
      )
    );
  }

  function removeOutlineBullet(slideIndex: number, bulletIndex: number) {
    setOutlineDraft((current) =>
      current.map((slide) => {
        if (slide.slideIndex !== slideIndex) {
          return slide;
        }
        const nextBullets = slide.keyBullets.filter((_, index) => index !== bulletIndex);
        return {
          ...slide,
          keyBullets: nextBullets.length > 0 ? nextBullets : [""]
        };
      })
    );
  }

  function addOutlineSlide() {
    setOutlineDraft((current) => {
      const nextIndex = current.length + 1;
      const next = [
        ...current,
        {
          id: crypto.randomUUID(),
          slideIndex: nextIndex,
          slideTitle: `New slide ${nextIndex}`,
          slideObjective: "Define the purpose of this slide.",
          keyBullets: ["Add the first point."],
          recommendedSlideType: "market/context" as const,
          narrativeRole: "Additional supporting slide"
        }
      ];
      setSelectedSlideIndex(nextIndex);
      return next;
    });
  }

  function removeOutlineSlide(slideIndex: number) {
    setOutlineDraft((current) => reindexOutline(current.filter((slide) => slide.slideIndex !== slideIndex)));
    setSelectedSlideIndex((current) => {
      if (current == null) {
        return current;
      }
      if (current === slideIndex) {
        return slideIndex > 1 ? slideIndex - 1 : 1;
      }
      return current > slideIndex ? current - 1 : current;
    });
  }

  function updateSlideDraft(slideIndex: number, patch: Partial<SlideRecord>) {
    setSlidesDraft((current) => current.map((slide) => (slide.slideIndex === slideIndex ? { ...slide, ...patch } : slide)));
  }

  function updateSlideBullet(slideIndex: number, bulletIndex: number, value: string) {
    setSlidesDraft((current) =>
      current.map((slide) =>
        slide.slideIndex === slideIndex
          ? {
              ...slide,
              bullets: slide.bullets.map((bullet, index) => (index === bulletIndex ? value : bullet)),
              layoutProps: resolveLayoutProps(slide.slideType, slide.bullets.length)
            }
          : slide
      )
    );
  }

  function addSlideBullet(slideIndex: number) {
    setSlidesDraft((current) =>
      current.map((slide) =>
        slide.slideIndex === slideIndex && slide.bullets.length < 5
          ? {
              ...slide,
              bullets: [...slide.bullets, ""],
              layoutProps: resolveLayoutProps(slide.slideType, slide.bullets.length + 1)
            }
          : slide
      )
    );
  }

  function removeSlideBullet(slideIndex: number, bulletIndex: number) {
    setSlidesDraft((current) =>
      current.map((slide) => {
        if (slide.slideIndex !== slideIndex) {
          return slide;
        }
        const nextBullets = slide.bullets.filter((_, index) => index !== bulletIndex);
        return {
          ...slide,
          bullets: nextBullets.length > 0 ? nextBullets : [""],
          layoutProps: resolveLayoutProps(slide.slideType, Math.max(1, nextBullets.length))
        };
      })
    );
  }

  const previewSlide = buildPreviewSlide(bundle ? { ...bundle, slides: slidesDraft } : null, outlineDraft, selectedSlideIndex);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#d8f4ff_0%,transparent_28%),radial-gradient(circle_at_bottom_right,#ffe3c6_0%,transparent_26%),linear-gradient(180deg,#f6f2e9_0%,#fcfaf6_52%,#ffffff_100%)] text-slate-900">
      <div className="mx-auto grid max-w-[1600px] gap-6 px-4 py-6 lg:grid-cols-[320px_1fr_440px] lg:px-6">
        <aside className="space-y-6">
          <section className="rounded-[2rem] border border-slate-900/10 bg-slate-950 p-6 text-white shadow-[0_28px_80px_rgba(15,23,42,0.18)]">
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-200">Local slide studio</div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Research-backed deck generation with editable intelligence.</h1>
            <p className="mt-3 text-sm leading-7 text-slate-300">
              Create a project, ingest prompt and file sources, shape the outline, generate slides, edit individually, preview the deck,
              and export JSON locally.
            </p>
            <div className="mt-5 space-y-3 rounded-[1.4rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
              <div>
                <span className="font-semibold text-white">Generation mode:</span>{" "}
                {runtime?.geminiConfigured ? "Gemini structured generation" : "Local heuristic fallback"}
              </div>
              <div>
                <span className="font-semibold text-white">Database:</span> {runtime?.databasePath ?? "Initializing..."}
              </div>
              <div>
                <span className="font-semibold text-white">Exports:</span> {runtime?.storageRoot ?? "Initializing..."}
              </div>
            </div>
          </section>

          <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
            <div className="text-xs font-semibold uppercase tracking-[0.26em] text-amber-700">New project</div>
            <form className="mt-4 space-y-4" onSubmit={(event) => void handleCreateProject(event)}>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">Title</span>
                <input
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  className="w-full rounded-[1rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-slate-900"
                  placeholder="AI slide generation MVP"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">Prompt</span>
                <textarea
                  value={form.prompt}
                  onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
                  className="min-h-36 w-full rounded-[1rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-slate-900"
                  placeholder="Describe the deck topic, likely goal, and any source context you already know."
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">Audience</span>
                  <input
                    value={form.audience}
                    onChange={(event) => setForm((current) => ({ ...current, audience: event.target.value }))}
                    className="w-full rounded-[1rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-slate-900"
                    placeholder="Optional"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">Tone</span>
                  <input
                    value={form.tone}
                    onChange={(event) => setForm((current) => ({ ...current, tone: event.target.value }))}
                    className="w-full rounded-[1rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-slate-900"
                    placeholder="Optional"
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">Target slide count</span>
                <input
                  type="number"
                  min={5}
                  max={12}
                  value={form.targetSlideCount}
                  onChange={(event) => setForm((current) => ({ ...current, targetSlideCount: Number(event.target.value) }))}
                  className="w-full rounded-[1rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-slate-900"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">Source files</span>
                <input
                  type="file"
                  multiple
                  onChange={(event) => setUploadFiles(Array.from(event.target.files ?? []))}
                  className="block w-full rounded-[1rem] border border-dashed border-stone-300 bg-stone-50 px-4 py-4 text-sm text-slate-700 file:mr-3 file:rounded-full file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                />
                <div className="mt-2 text-xs text-slate-500">
                  {uploadFiles.length > 0 ? uploadFiles.map((file) => file.name).join(", ") : "TXT, MD, CSV, HTML, or JSON give the strongest local extraction today."}
                </div>
              </label>

              <button type="submit" className="w-full rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400" disabled={isBusy}>
                {activeStatus === "create-project" ? "Creating project..." : "Create project"}
              </button>
            </form>
          </section>

          <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-[0.26em] text-amber-700">Projects</div>
              <div className="text-xs text-slate-500">{projects.length}</div>
            </div>
            <div className="mt-4 space-y-2">
              {projects.length === 0 ? (
                <div className="rounded-[1rem] border border-dashed border-stone-300 bg-stone-50 px-4 py-6 text-sm text-slate-500">
                  No projects yet.
                </div>
              ) : (
                projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => setSelectedProjectId(project.id)}
                    className={`w-full rounded-[1.2rem] border px-4 py-4 text-left transition ${project.id === selectedProjectId ? "border-slate-900 bg-slate-900 text-white" : "border-stone-200 bg-stone-50 text-slate-700 hover:bg-white"}`}
                  >
                    <div className="text-xs font-semibold uppercase tracking-[0.24em] opacity-70">{project.status.replace(/_/g, " ")}</div>
                    <div className="mt-1 text-base font-semibold">{project.title}</div>
                    <div className="mt-2 text-sm leading-6 opacity-80">{project.targetSlideCount} slides · {project.audience || "Audience inferred"}</div>
                  </button>
                ))
              )}
            </div>
          </section>
        </aside>

        <section className="space-y-6">
          {error ? (
            <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div>
          ) : null}

          {bundle ? (
            <>
              <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-6 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.26em] text-amber-700">Project</div>
                    <h2 className="mt-2 text-3xl font-semibold text-slate-900">{bundle.project.title}</h2>
                    <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">{bundle.project.prompt}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <div className="rounded-full border border-stone-200 px-3 py-2 text-sm text-slate-700">{bundle.project.targetSlideCount} slides</div>
                    <div className="rounded-full border border-stone-200 px-3 py-2 text-sm text-slate-700">
                      {bundle.project.audience || "Audience inferred"}
                    </div>
                    <button type="button" onClick={() => void handleExport()} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
                      {activeStatus === "export-json" ? "Exporting..." : "Export JSON"}
                    </button>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <div className="rounded-[1.3rem] border border-stone-200 bg-stone-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Sources</div>
                    <div className="mt-2 text-2xl font-semibold text-slate-900">{bundle.sources.length}</div>
                    <div className="mt-1 text-sm text-slate-600">Prompt and uploaded files currently attached</div>
                  </div>
                  <div className="rounded-[1.3rem] border border-stone-200 bg-stone-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Evidence</div>
                    <div className="mt-2 text-2xl font-semibold text-slate-900">{bundle.reasoning?.evidenceMap.overallConfidence ?? "low"}</div>
                    <div className="mt-1 text-sm text-slate-600">{bundle.reasoning?.evidenceMap.strengthSummary ?? "Reasoning will appear after project analysis."}</div>
                  </div>
                  <div className="rounded-[1.3rem] border border-stone-200 bg-stone-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Deck type</div>
                    <div className="mt-2 text-2xl font-semibold text-slate-900">{bundle.reasoning?.intent.deckType.replace(/_/g, " ") ?? "Pending"}</div>
                    <div className="mt-1 text-sm text-slate-600">{bundle.reasoning?.deckStrategy.structureLabel ?? "Deck strategy will be inferred from the brief."}</div>
                  </div>
                </div>

                {bundle.exports.length > 0 ? (
                  <div className="mt-6 rounded-[1.3rem] border border-stone-200 bg-stone-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Exports</div>
                    <div className="mt-3 flex flex-wrap gap-3">
                      {bundle.exports.map((record) => (
                        <a
                          key={record.id}
                          href={`/api/slide-studio/projects/${bundle.project.id}/exports/${record.id}`}
                          className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-slate-700"
                        >
                          {String(record.metadata.fileName ?? record.filePath)}
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>

              <OutlineEditor
                slides={outlineDraft}
                selectedSlideIndex={selectedSlideIndex}
                activeStatus={activeStatus}
                onSelectSlide={setSelectedSlideIndex}
                onChangeSlide={updateOutlineSlide}
                onChangeBullet={updateOutlineBullet}
                onAddBullet={addOutlineBullet}
                onRemoveBullet={removeOutlineBullet}
                onAddSlide={addOutlineSlide}
                onRemoveSlide={removeOutlineSlide}
                onGenerateOutline={() => void handleGenerateOutline()}
                onSaveDraft={() => void saveOutline("draft", "save-outline")}
                onApproveOutline={() => void saveOutline("approved", "approve-outline")}
                onGenerateSlides={() => void handleGenerateSlides()}
              />

              <SlideEditor
                slides={slidesDraft}
                selectedSlideIndex={selectedSlideIndex}
                activeStatus={activeStatus}
                onSelectSlide={setSelectedSlideIndex}
                onChangeSlide={(slideIndex, patch) => updateSlideDraft(slideIndex, patch)}
                onChangeBullet={updateSlideBullet}
                onAddBullet={addSlideBullet}
                onRemoveBullet={removeSlideBullet}
                onSaveSlide={(slideIndex) => void handleSaveSlide(slideIndex)}
                onRegenerateSlide={(slideIndex) => void handleRegenerateSlide(slideIndex)}
              />
            </>
          ) : (
            <section className="rounded-[2rem] border border-dashed border-stone-300 bg-white/70 px-6 py-16 text-center text-sm text-slate-500">
              Create or select a project to start the slide workflow.
            </section>
          )}
        </section>

        <aside className="space-y-6">
          <section className="sticky top-6 space-y-6">
            <SlidePreview slide={previewSlide} />

            {bundle?.reasoning ? (
              <>
                <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
                  <div className="text-xs font-semibold uppercase tracking-[0.26em] text-amber-700">Intent</div>
                  <div className="mt-3 text-lg font-semibold text-slate-900">{bundle.reasoning.intent.primaryGoal}</div>
                  <div className="mt-3 grid gap-3 text-sm text-slate-600">
                    <div>
                      <span className="font-semibold text-slate-900">Purpose:</span> {bundle.reasoning.intent.purpose.replace(/_/g, " ")}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900">Audience:</span> {bundle.reasoning.audienceProfile.audienceLabel}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900">Style:</span> {bundle.reasoning.intent.communicationStyle}
                    </div>
                  </div>
                </section>

                <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
                  <div className="text-xs font-semibold uppercase tracking-[0.26em] text-amber-700">Assumptions</div>
                  <div className="mt-4 space-y-3">
                    {bundle.reasoning.assumptionLog.items.map((item) => (
                      <div key={item.id} className="rounded-[1.2rem] border border-stone-200 bg-stone-50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-semibold text-slate-900">{item.label}</div>
                          <div className="rounded-full border border-stone-300 px-2 py-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                            {item.confidence}
                          </div>
                        </div>
                        <div className="mt-2 text-sm text-slate-700">{item.value}</div>
                        <div className="mt-2 text-xs leading-6 text-slate-500">{item.rationale}</div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
                  <div className="text-xs font-semibold uppercase tracking-[0.26em] text-amber-700">Evidence gaps</div>
                  <div className="mt-4 space-y-3">
                    {bundle.reasoning.evidenceMap.gaps.map((gap, index) => (
                      <div key={`${gap}-${index}`} className="rounded-[1.2rem] border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-slate-700">
                        {gap}
                      </div>
                    ))}
                    {bundle.reasoning.evidenceMap.gaps.length === 0 ? (
                      <div className="rounded-[1.2rem] border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-slate-700">
                        No major evidence gaps were flagged for this project.
                      </div>
                    ) : null}
                  </div>
                </section>
              </>
            ) : null}
          </section>
        </aside>
      </div>
    </main>
  );
}
