import type { Metadata } from "next";
import { SlideStudioClient } from "@/components/slide-studio/SlideStudioClient";

export const metadata: Metadata = {
  title: "Slide Studio",
  description: "Local-first AI slide generation with editable outlines, slide regeneration, and JSON export"
};

export default function SlideStudioPage() {
  return <SlideStudioClient />;
}
