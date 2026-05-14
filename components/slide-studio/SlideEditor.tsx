"use client";

import { SlideRecord } from "@/app/lib/slide-studio/types";

interface SlideEditorProps {
  slides: SlideRecord[];
  selectedSlideIndex: number | null;
  activeStatus: string | null;
  onSelectSlide: (slideIndex: number) => void;
  onChangeSlide: (slideIndex: number, patch: Partial<SlideRecord>) => void;
  onChangeBullet: (slideIndex: number, bulletIndex: number, value: string) => void;
  onAddBullet: (slideIndex: number) => void;
  onRemoveBullet: (slideIndex: number, bulletIndex: number) => void;
  onSaveSlide: (slideIndex: number) => void;
  onRegenerateSlide: (slideIndex: number) => void;
}

export function SlideEditor({
  slides,
  selectedSlideIndex,
  activeStatus,
  onSelectSlide,
  onChangeSlide,
  onChangeBullet,
  onAddBullet,
  onRemoveBullet,
  onSaveSlide,
  onRegenerateSlide
}: SlideEditorProps) {
  const currentSlide = slides.find((slide) => slide.slideIndex === selectedSlideIndex) ?? slides[0] ?? null;

  return (
    <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-6 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.26em] text-amber-700">Slide editor</div>
          <h2 className="mt-2 text-2xl font-semibold text-slate-900">Edit individual slides and regenerate with deck context</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            The slide list stays anchored to the outline order. Save edits directly to the backend or regenerate one slide
            without replacing the rest of the deck.
          </p>
        </div>
      </div>

      {slides.length === 0 ? (
        <div className="mt-6 rounded-[1.5rem] border border-dashed border-stone-300 bg-stone-50 px-5 py-8 text-sm text-slate-500">
          Approve the outline and generate slides to start editing the deck.
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[240px_1fr]">
          <aside className="space-y-2 rounded-[1.5rem] border border-stone-200 bg-stone-50 p-3">
            {slides.map((slide) => {
              const isSelected = currentSlide?.slideIndex === slide.slideIndex;
              return (
                <button
                  key={slide.id}
                  type="button"
                  onClick={() => onSelectSlide(slide.slideIndex)}
                  className={`w-full rounded-[1.1rem] px-3 py-3 text-left transition ${isSelected ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-stone-100"}`}
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.22em] opacity-70">Slide {slide.slideIndex}</div>
                  <div className="mt-1 text-sm font-semibold leading-5">{slide.title}</div>
                </button>
              );
            })}
          </aside>

          {currentSlide ? (
            <div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onSaveSlide(currentSlide.slideIndex)}
                  className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
                >
                  {activeStatus === `save-slide-${currentSlide.slideIndex}` ? "Saving..." : "Save slide"}
                </button>
                <button
                  type="button"
                  onClick={() => onRegenerateSlide(currentSlide.slideIndex)}
                  className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  {activeStatus === `regen-slide-${currentSlide.slideIndex}` ? "Regenerating..." : "Regenerate slide"}
                </button>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Title</span>
                  <input
                    value={currentSlide.title}
                    onChange={(event) => onChangeSlide(currentSlide.slideIndex, { title: event.target.value })}
                    className="w-full rounded-[1rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-slate-900"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Objective</span>
                  <input
                    value={currentSlide.objective}
                    onChange={(event) => onChangeSlide(currentSlide.slideIndex, { objective: event.target.value })}
                    className="w-full rounded-[1rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-slate-900"
                  />
                </label>
              </div>

              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Bullets</span>
                  <button type="button" onClick={() => onAddBullet(currentSlide.slideIndex)} className="text-sm font-semibold text-slate-700">
                    Add bullet
                  </button>
                </div>
                <div className="space-y-3">
                  {currentSlide.bullets.map((bullet, bulletIndex) => (
                    <div key={`${currentSlide.id}-${bulletIndex}`} className="flex gap-2">
                      <textarea
                        value={bullet}
                        onChange={(event) => onChangeBullet(currentSlide.slideIndex, bulletIndex, event.target.value)}
                        className="min-h-20 flex-1 rounded-[1rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => onRemoveBullet(currentSlide.slideIndex, bulletIndex)}
                        className="self-start rounded-full border border-stone-200 px-3 py-2 text-sm text-slate-500"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <label className="mt-4 block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Speaker notes</span>
                <textarea
                  value={currentSlide.speakerNotes}
                  onChange={(event) => onChangeSlide(currentSlide.slideIndex, { speakerNotes: event.target.value })}
                  className="min-h-28 w-full rounded-[1rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-slate-900"
                />
              </label>

              <label className="mt-4 block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Visual instructions</span>
                <textarea
                  value={currentSlide.visualInstructions}
                  onChange={(event) => onChangeSlide(currentSlide.slideIndex, { visualInstructions: event.target.value })}
                  className="min-h-24 w-full rounded-[1rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-slate-900"
                />
              </label>

              <div className="mt-4 rounded-[1.25rem] border border-stone-200 bg-stone-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Slide evidence</div>
                <div className="mt-3 space-y-2">
                  {currentSlide.citations.map((citation, index) => (
                    <div key={`${citation.sourceTitle}-${index}`} className="rounded-[1rem] border border-stone-200 bg-white px-4 py-3 text-sm leading-6 text-slate-700">
                      <div className="font-semibold text-slate-900">
                        {citation.sourceTitle} · {citation.confidence} · {citation.evidenceKind.replace(/_/g, " ")}
                      </div>
                      <div className="mt-1">{citation.claim}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
