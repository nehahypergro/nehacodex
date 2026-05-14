import "server-only";

import { randomUUID } from "node:crypto";
import { extractPresentationIntent } from "@/app/lib/slide-studio/intelligence/intent";
import { inferAudienceProfile } from "@/app/lib/slide-studio/intelligence/audience";
import { buildEvidenceMap } from "@/app/lib/slide-studio/intelligence/evidence";
import { buildAssumptionLog, buildDeckStrategy, buildNarrativePlan } from "@/app/lib/slide-studio/intelligence/narrative";
import {
  addSource,
  createProject,
  getProjectBundle,
  listProjects,
  listSources,
  replaceSlides,
  requireOutline,
  requireProject,
  requireSlide,
  saveOutline,
  saveProjectReasoning,
  updateProject,
  updateSlide
} from "@/app/lib/slide-studio/storage/repository";
import { getStudioDatabasePath, getStudioStorageRoot } from "@/app/lib/slide-studio/storage/paths";
import { getExportService } from "@/app/lib/slide-studio/services/export-service";
import { getGenerationClient, isGeminiGenerationConfigured } from "@/app/lib/slide-studio/services/generation-client";
import { getResearchService } from "@/app/lib/slide-studio/services/research-service";
import { ingestPromptSource, ingestUploadedFiles } from "@/app/lib/slide-studio/services/source-ingestion";
import {
  CreateProjectInput,
  OutlineSlide,
  ProjectBundle,
  ProjectRecord,
  RuntimeCapabilities,
  SlideRecord,
  UpdateProjectInput,
  UpdateSlideInput
} from "@/app/lib/slide-studio/types";

export async function createProjectWithSources(input: CreateProjectInput, files: File[]): Promise<ProjectBundle> {
  const project = createProject(input);
  ingestPromptSource(project);
  await ingestUploadedFiles(project, files);
  await refreshProjectReasoning(project.id);
  return getProjectBundle(project.id);
}

export async function refreshProjectReasoning(projectId: string): Promise<ProjectBundle> {
  const project = requireProject(projectId);
  const sources = listSources(projectId);
  const intent = extractPresentationIntent(project);
  const audienceProfile = inferAudienceProfile(project, intent);
  const externalSources = await getResearchService().fetchRelevantSources({
    project,
    intent,
    localSourceText: sources.map((source) => source.extractedText).join("\n\n")
  });

  for (const source of externalSources) {
    ingestExternalSource(projectId, source);
  }

  const hydratedSources = listSources(projectId);
  const evidenceMap = buildEvidenceMap(hydratedSources);
  const deckStrategy = buildDeckStrategy({ project, intent });
  const assumptionLog = buildAssumptionLog({
    project,
    intent,
    audienceProfile,
    evidenceGaps: evidenceMap.gaps
  });
  const narrativePlan = buildNarrativePlan({
    intent,
    audienceProfile,
    deckStrategy,
    evidenceGaps: evidenceMap.gaps
  });

  saveProjectReasoning({
    projectId,
    intent,
    audienceProfile,
    assumptionLog,
    narrativePlan,
    deckStrategy,
    evidenceMap
  });

  return getProjectBundle(projectId);
}

function ingestExternalSource(
  projectId: string,
  source: {
    kind: "prompt" | "upload" | "research_stub";
    title: string;
    url?: string;
    mimeType?: string;
    extractedText: string;
    metadata?: Record<string, unknown>;
  }
): void {
  addSource({
    projectId,
    kind: source.kind,
    title: source.title,
    url: source.url,
    mimeType: source.mimeType,
    extractedText: source.extractedText,
    metadata: source.metadata
  });
}

export function listProjectSummaries(): ProjectRecord[] {
  return listProjects();
}

export function getProjectDetails(projectId: string): ProjectBundle {
  return getProjectBundle(projectId);
}

export async function generateOutlineForProject(projectId: string): Promise<ProjectBundle> {
  const bundle = getProjectBundle(projectId);
  const reasoning = bundle.reasoning ?? (await refreshProjectReasoning(projectId)).reasoning;
  if (!reasoning) {
    throw new Error("Project reasoning is missing and could not be rebuilt.");
  }

  const slides = await getGenerationClient().generateOutline({
    project: bundle.project,
    intent: reasoning.intent,
    audienceProfile: reasoning.audienceProfile,
    narrativePlan: reasoning.narrativePlan,
    deckStrategy: reasoning.deckStrategy,
    evidenceMap: reasoning.evidenceMap,
    sources: bundle.sources
  });

  saveOutline({
    projectId,
    status: "draft",
    slides
  });

  return getProjectBundle(projectId);
}

export function saveOutlineEdits(projectId: string, slides: OutlineSlide[], status: "draft" | "approved"): ProjectBundle {
  saveOutline({
    projectId,
    status,
    slides
  });
  return getProjectBundle(projectId);
}

export async function updateProjectDetails(projectId: string, input: UpdateProjectInput): Promise<ProjectBundle> {
  updateProject(projectId, input);
  await refreshProjectReasoning(projectId);
  return getProjectBundle(projectId);
}

export async function generateSlidesForProject(projectId: string): Promise<ProjectBundle> {
  const bundle = getProjectBundle(projectId);
  const outline = bundle.outline ?? requireOutline(projectId);
  const reasoning = bundle.reasoning ?? (await refreshProjectReasoning(projectId)).reasoning;
  if (!reasoning) {
    throw new Error("Project reasoning is missing and could not be rebuilt.");
  }

  const generatedSlides: SlideRecord[] = [];
  for (const outlineSlide of outline.slides) {
    const slide = await getGenerationClient().generateSlide({
      project: bundle.project,
      intent: reasoning.intent,
      audienceProfile: reasoning.audienceProfile,
      narrativePlan: reasoning.narrativePlan,
      deckStrategy: reasoning.deckStrategy,
      evidenceMap: reasoning.evidenceMap,
      sources: bundle.sources,
      outlineSlides: outline.slides,
      currentOutlineSlide: outlineSlide,
      existingSlides: generatedSlides.length > 0 ? generatedSlides : bundle.slides
    });
    generatedSlides.push(slide);
  }

  replaceSlides(projectId, generatedSlides);
  saveOutline({
    projectId,
    status: "approved",
    slides: outline.slides
  });

  return getProjectBundle(projectId);
}

export function saveSlideEdits(projectId: string, slideId: string, input: UpdateSlideInput): ProjectBundle {
  updateSlide(projectId, slideId, input);
  return getProjectBundle(projectId);
}

export async function regenerateSlideForProject(projectId: string, slideId: string): Promise<ProjectBundle> {
  const bundle = getProjectBundle(projectId);
  const outline = bundle.outline ?? requireOutline(projectId);
  const reasoning = bundle.reasoning ?? (await refreshProjectReasoning(projectId)).reasoning;
  const currentSlide = requireSlide(projectId, slideId);
  if (!reasoning) {
    throw new Error("Project reasoning is missing and could not be rebuilt.");
  }

  const currentOutlineSlide = outline.slides.find((slide) => slide.slideIndex === currentSlide.slideIndex);
  if (!currentOutlineSlide) {
    throw new Error(`Outline entry for slide ${currentSlide.slideIndex} was not found.`);
  }

  const regenerated = await getGenerationClient().generateSlide({
    project: bundle.project,
    intent: reasoning.intent,
    audienceProfile: reasoning.audienceProfile,
    narrativePlan: reasoning.narrativePlan,
    deckStrategy: reasoning.deckStrategy,
    evidenceMap: reasoning.evidenceMap,
    sources: bundle.sources,
    outlineSlides: outline.slides,
    currentOutlineSlide,
    existingSlides: bundle.slides
  });

  updateSlide(projectId, slideId, {
    title: regenerated.title,
    objective: regenerated.objective,
    bullets: regenerated.bullets,
    speakerNotes: regenerated.speakerNotes,
    visualInstructions: regenerated.visualInstructions,
    layoutProps: regenerated.layoutProps,
    citations: regenerated.citations
  });

  return getProjectBundle(projectId);
}

export async function exportProject(projectId: string): Promise<ProjectBundle> {
  await getExportService().exportProjectAsJson(projectId);
  return getProjectBundle(projectId);
}

export function getRuntimeCapabilities(): RuntimeCapabilities {
  return {
    geminiConfigured: isGeminiGenerationConfigured(),
    storageRoot: getStudioStorageRoot(),
    databasePath: getStudioDatabasePath()
  };
}

export function createEmptyOutlineSlide(slideIndex: number): OutlineSlide {
  return {
    id: randomUUID(),
    slideIndex,
    slideTitle: "",
    slideObjective: "",
    keyBullets: ["", ""],
    recommendedSlideType: "title",
    narrativeRole: ""
  };
}
