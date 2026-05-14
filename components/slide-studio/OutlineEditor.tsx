"use client";

import { SUPPORTED_SLIDE_TYPES } from "@/app/lib/slide-studio/constants";
import { OutlineSlide } from "@/app/lib/slide-studio/types";

interface OutlineEditorProps {
  slides: OutlineSlide[];
  selectedSlideIndex: number | null;
  activeStatus: string | null;
  onSelectSlide: (slideIndex: number) => void;
  onChangeSlide: (slideIndex: number, patch: Partial<OutlineSlide>) => void;
  onChangeBullet: (slideIndex: number, bulletIndex: number, value: string) => void;
  onAddBullet: (slideIndex: number) => void;
  onRemoveBullet: (slideIndex: number, bulletIndex: number) => void;
  onAddSlide: () => void;
  onRemoveSlide: (slideIndex: number) => void;
  onGenerateOutline: () => void;
  onSaveDraft: () => void;
  onApproveOutline: () => void;
  onGenerateSlides: () => void;
}

export function OutlineEditor({
  slides,
  selectedSlideIndex,
  activeStatus,
  onSelectSlide,
  onChangeSlide,
  onChangeBullet,
  onAddBullet,
  onRemoveBullet,
  onAddSlide,
  onRemoveSlide,
  onGenerateOutline,
  onSaveDraft,
  onApproveOutline,
  onGenerateSlides
}: OutlineEditorProps) {
  return (
    <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-6 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.26em] text-amber-700">Outline</div>
          <h2 className="mt-2 text-2xl font-semibold text-slate-900">Review the deck story before generating slides</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Each slide should have one clear job. Edit titles, objectives, bullets, or types here and then approve the
            outline before generating slide copy.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onGenerateOutline}
            className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
          >
            {activeStatus === "generate-outline" ? "Generating..." : "Generate outline"}
          </button>
          <button type="button" onClick={onSaveDraft} className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-slate-700">
            {activeStatus === "save-outline" ? "Saving..." : "Save draft"}
          </button>
          <button
            type="button"
            onClick={onApproveOutline}
            className="rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800"
          >
            {activeStatus === "approve-outline" ? "Approving..." : "Approve outline"}
          </button>
          <button
            type="button"
            onClick={onGenerateSlides}
            className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900"
          >
            {activeStatus === "generate-slides" ? "Generating slides..." : "Generate slides"}
          </button>
        </div>
      </div>

      {slides.length === 0 ? (
        <div className="mt-6 rounded-[1.5rem] border border-dashed border-stone-300 bg-stone-50 px-5 py-8 text-sm text-slate-500">
          Generate an outline after creating a project and adding source material.
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {slides.map((slide) => {
            const isSelected = slide.slideIndex === selectedSlideIndex;
            return (
              <div
                key={slide.id}
                className={`rounded-[1.5rem] border p-4 transition ${isSelected ? "border-slate-900 bg-slate-50" : "border-stone-200 bg-white"}`}
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <button type="button" onClick={() => onSelectSlide(slide.slideIndex)} className="text-left">
                    <div className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">Slide {slide.slideIndex}</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">{slide.slideTitle || "Untitled slide"}</div>
                  </button>
                  <div className="flex gap-2">
                    <select
                      value={slide.recommendedSlideType}
                      onChange={(event) => onChangeSlide(slide.slideIndex, { recommendedSlideType: event.target.value as OutlineSlide["recommendedSlideType"] })}
                      className="rounded-full border border-stone-300 bg-white px-3 py-2 text-sm text-slate-700"
                    >
                      {SUPPORTED_SLIDE_TYPES.map((slideType) => (
                        <option key={slideType} value={slideType}>
                          {slideType}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => onRemoveSlide(slide.slideIndex)}
                      className="rounded-full border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Title</span>
                    <input
                      value={slide.slideTitle}
                      onChange={(event) => onChangeSlide(slide.slideIndex, { slideTitle: event.target.value })}
                      className="w-full rounded-[1rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-slate-900"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Narrative role</span>
                    <input
                      value={slide.narrativeRole}
                      onChange={(event) => onChangeSlide(slide.slideIndex, { narrativeRole: event.target.value })}
                      className="w-full rounded-[1rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-slate-900"
                    />
                  </label>
                </div>

                <label className="mt-4 block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Objective</span>
                  <textarea
                    value={slide.slideObjective}
                    onChange={(event) => onChangeSlide(slide.slideIndex, { slideObjective: event.target.value })}
                    className="min-h-24 w-full rounded-[1rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-slate-900"
                  />
                </label>

                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Key bullets</span>
                    <button type="button" onClick={() => onAddBullet(slide.slideIndex)} className="text-sm font-semibold text-slate-700">
                      Add bullet
                    </button>
                  </div>
                  <div className="space-y-3">
                    {slide.keyBullets.map((bullet, bulletIndex) => (
                      <div key={`${slide.id}-${bulletIndex}`} className="flex gap-2">
                        <textarea
                          value={bullet}
                          onChange={(event) => onChangeBullet(slide.slideIndex, bulletIndex, event.target.value)}
                          className="min-h-20 flex-1 rounded-[1rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-slate-900"
                        />
                        <button
                          type="button"
                          onClick={() => onRemoveBullet(slide.slideIndex, bulletIndex)}
                          className="self-start rounded-full border border-stone-200 px-3 py-2 text-sm text-slate-500"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-5">
        <button type="button" onClick={onAddSlide} className="rounded-full border border-dashed border-stone-400 px-4 py-2 text-sm font-semibold text-slate-700">
          Add slide
        </button>
      </div>
    </section>
  );
}
