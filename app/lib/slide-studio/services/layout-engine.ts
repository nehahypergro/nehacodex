import { LayoutProps, SupportedSlideType } from "@/app/lib/slide-studio/types";

export function resolveLayoutProps(slideType: SupportedSlideType, bulletCount: number): LayoutProps {
  if (slideType === "comparison") {
    return {
      variant: "twoColumn",
      columnCount: 2,
      emphasis: "decision",
      bulletStyle: "plain"
    };
  }

  if (slideType === "metrics/KPI") {
    return {
      variant: "kpiTiles",
      columnCount: 3,
      emphasis: "proof",
      bulletStyle: "metric"
    };
  }

  if (slideType === "roadmap") {
    return {
      variant: "timeline",
      columnCount: 4,
      emphasis: "decision",
      bulletStyle: "timeline"
    };
  }

  if (bulletCount <= 2) {
    return {
      variant: "hero",
      columnCount: 1,
      emphasis: slideType === "title" || slideType === "closing" ? "summary" : "context",
      bulletStyle: "checklist"
    };
  }

  return {
    variant: "standard",
    columnCount: 1,
    emphasis: slideType === "recommendation" ? "decision" : "context",
    bulletStyle: "plain"
  };
}
