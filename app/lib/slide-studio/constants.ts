import { SupportedSlideType } from "@/app/lib/slide-studio/types";

export const SUPPORTED_SLIDE_TYPES = [
  "title",
  "agenda",
  "problem",
  "market/context",
  "comparison",
  "process/how-it-works",
  "metrics/KPI",
  "recommendation",
  "roadmap",
  "closing"
] as const satisfies readonly SupportedSlideType[];
