"use client";

import { CitationPlaceholder, LayoutProps, SupportedSlideType } from "@/app/lib/slide-studio/types";

export interface PreviewRenderableSlide {
  slideIndex: number;
  slideType: SupportedSlideType;
  title: string;
  objective: string;
  bullets: string[];
  layoutProps: LayoutProps;
  visualInstructions?: string;
  citations?: CitationPlaceholder[];
}

function splitColumns(items: string[]): [string[], string[]] {
  const midpoint = Math.ceil(items.length / 2);
  return [items.slice(0, midpoint), items.slice(midpoint)];
}

function surfaceClass(slideType: SupportedSlideType): string {
  switch (slideType) {
    case "title":
      return "bg-[radial-gradient(circle_at_top_left,#d8fff4_0%,transparent_34%),linear-gradient(180deg,#0f172a_0%,#111827_100%)] text-white";
    case "recommendation":
      return "bg-[linear-gradient(135deg,#1f2937_0%,#0f172a_35%,#153b33_100%)] text-white";
    case "metrics/KPI":
      return "bg-[linear-gradient(180deg,#faf5e9_0%,#fffdf8_100%)] text-slate-900";
    default:
      return "bg-white text-slate-900";
  }
}

function accentClass(slideType: SupportedSlideType): string {
  switch (slideType) {
    case "title":
      return "text-emerald-200";
    case "recommendation":
      return "text-emerald-200";
    case "metrics/KPI":
      return "text-amber-700";
    default:
      return "text-amber-700";
  }
}

export function SlidePreview({ slide }: { slide: PreviewRenderableSlide | null }) {
  if (!slide) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-[2rem] border border-dashed border-stone-300 bg-white/80 px-6 text-center text-sm text-slate-500">
        Select a slide to preview the deck layout.
      </div>
    );
  }

  const [leftColumn, rightColumn] = splitColumns(slide.bullets);

  return (
    <div className={`overflow-hidden rounded-[2rem] border border-slate-900/10 shadow-[0_20px_50px_rgba(15,23,42,0.12)] ${surfaceClass(slide.slideType)}`}>
      <div className="flex items-center justify-between border-b border-current/10 px-6 py-4 text-xs uppercase tracking-[0.24em]">
        <span className={accentClass(slide.slideType)}>{slide.slideType}</span>
        <span>Slide {slide.slideIndex}</span>
      </div>

      <div className="p-6 md:p-8">
        {slide.layoutProps.variant === "hero" ? (
          <div className="grid gap-6 md:grid-cols-[1.2fr_0.8fr]">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.26em] opacity-70">Objective</div>
              <h3 className="mt-3 text-3xl font-semibold leading-tight md:text-4xl">{slide.title}</h3>
              <p className="mt-4 max-w-2xl text-sm leading-7 opacity-80 md:text-base">{slide.objective}</p>
            </div>
            <div className="rounded-[1.5rem] border border-current/10 bg-black/5 p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.24em] opacity-70">Key points</div>
              <ul className="mt-4 space-y-3 text-sm leading-6">
                {slide.bullets.map((bullet, index) => (
                  <li key={`${bullet}-${index}`} className="rounded-2xl border border-current/10 bg-white/5 px-4 py-3">
                    {bullet}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {slide.layoutProps.variant === "standard" ? (
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.26em] opacity-70">Narrative role</div>
            <h3 className="mt-3 text-2xl font-semibold md:text-3xl">{slide.title}</h3>
            <p className="mt-3 max-w-3xl text-sm leading-7 opacity-80 md:text-base">{slide.objective}</p>
            <ul className="mt-8 grid gap-3 md:grid-cols-2">
              {slide.bullets.map((bullet, index) => (
                <li key={`${bullet}-${index}`} className="rounded-[1.35rem] border border-current/10 bg-black/5 px-4 py-4 text-sm leading-6">
                  {bullet}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {slide.layoutProps.variant === "twoColumn" ? (
          <div>
            <h3 className="text-2xl font-semibold md:text-3xl">{slide.title}</h3>
            <p className="mt-3 max-w-3xl text-sm leading-7 opacity-80 md:text-base">{slide.objective}</p>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <div className="rounded-[1.5rem] border border-current/10 bg-black/5 p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] opacity-70">Current / baseline</div>
                <ul className="mt-4 space-y-3 text-sm leading-6">
                  {leftColumn.map((bullet, index) => (
                    <li key={`${bullet}-${index}`}>{bullet}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-[1.5rem] border border-current/10 bg-black/5 p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] opacity-70">Recommended / differentiated</div>
                <ul className="mt-4 space-y-3 text-sm leading-6">
                  {rightColumn.map((bullet, index) => (
                    <li key={`${bullet}-${index}`}>{bullet}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : null}

        {slide.layoutProps.variant === "kpiTiles" ? (
          <div>
            <h3 className="text-2xl font-semibold md:text-3xl">{slide.title}</h3>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 md:text-base">{slide.objective}</p>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {slide.bullets.map((bullet, index) => (
                <div key={`${bullet}-${index}`} className="rounded-[1.45rem] border border-stone-200 bg-white p-5 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">KPI {index + 1}</div>
                  <div className="mt-4 text-base font-semibold text-slate-900">{bullet}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {slide.layoutProps.variant === "timeline" ? (
          <div>
            <h3 className="text-2xl font-semibold md:text-3xl">{slide.title}</h3>
            <p className="mt-3 max-w-3xl text-sm leading-7 opacity-80 md:text-base">{slide.objective}</p>
            <div className="mt-8 grid gap-4 md:grid-cols-4">
              {slide.bullets.map((bullet, index) => (
                <div key={`${bullet}-${index}`} className="relative rounded-[1.35rem] border border-current/10 bg-black/5 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] opacity-70">Phase {index + 1}</div>
                  <div className="mt-3 text-sm leading-6">{bullet}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {slide.citations && slide.citations.length > 0 ? (
          <div className="mt-8 border-t border-current/10 pt-5">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] opacity-70">Evidence posture</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {slide.citations.map((citation, index) => (
                <div key={`${citation.sourceTitle}-${index}`} className="rounded-full border border-current/10 px-3 py-1 text-xs opacity-80">
                  {citation.sourceTitle} · {citation.confidence}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
