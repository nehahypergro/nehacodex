import "server-only";

import { randomUUID } from "node:crypto";
import { getStudioDatabase } from "@/app/lib/slide-studio/storage/database";
import {
  CreateProjectInput,
  CreateSourceInput,
  ExportRecord,
  OutlineRecord,
  OutlineSlide,
  ProjectBundle,
  ProjectReasoningRecord,
  ProjectRecord,
  SaveExportInput,
  SaveOutlineInput,
  SlideRecord,
  SourceRecord,
  UpdateProjectInput,
  UpdateSlideInput
} from "@/app/lib/slide-studio/types";

type ProjectRow = {
  id: string;
  title: string;
  prompt: string;
  audience: string;
  tone: string;
  target_slide_count: number;
  status: ProjectRecord["status"];
  created_at: string;
  updated_at: string;
};

type SourceRow = {
  id: string;
  project_id: string;
  kind: SourceRecord["kind"];
  name: string | null;
  title: string;
  url: string | null;
  mime_type: string | null;
  extracted_text: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type ReasoningRow = {
  project_id: string;
  intent_json: string;
  audience_profile_json: string;
  assumption_log_json: string;
  narrative_plan_json: string;
  deck_strategy_json: string;
  evidence_map_json: string;
  created_at: string;
  updated_at: string;
};

type OutlineRow = {
  id: string;
  project_id: string;
  version: number;
  status: OutlineRecord["status"];
  outline_json: string;
  created_at: string;
  updated_at: string;
};

type SlideRow = {
  id: string;
  project_id: string;
  slide_index: number;
  slide_type: SlideRecord["slideType"];
  slide_json: string;
  created_at: string;
  updated_at: string;
};

type ExportRow = {
  id: string;
  project_id: string;
  format: ExportRecord["format"];
  file_path: string;
  metadata_json: string;
  created_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function mapProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    audience: row.audience,
    tone: row.tone,
    targetSlideCount: row.target_slide_count,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSource(row: SourceRow): SourceRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    name: row.name ?? undefined,
    title: row.title,
    url: row.url ?? undefined,
    mimeType: row.mime_type ?? undefined,
    extractedText: row.extracted_text,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapReasoning(row: ReasoningRow): ProjectReasoningRecord {
  return {
    projectId: row.project_id,
    intent: parseJson(row.intent_json),
    audienceProfile: parseJson(row.audience_profile_json),
    assumptionLog: parseJson(row.assumption_log_json),
    narrativePlan: parseJson(row.narrative_plan_json),
    deckStrategy: parseJson(row.deck_strategy_json),
    evidenceMap: parseJson(row.evidence_map_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapOutline(row: OutlineRow): OutlineRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    status: row.status,
    slides: parseJson<OutlineSlide[]>(row.outline_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSlide(row: SlideRow): SlideRecord {
  const payload = parseJson<Omit<SlideRecord, "id" | "projectId" | "slideIndex" | "slideType" | "createdAt" | "updatedAt">>(
    row.slide_json
  );

  return {
    id: row.id,
    projectId: row.project_id,
    slideIndex: row.slide_index,
    slideType: row.slide_type,
    title: payload.title,
    objective: payload.objective,
    bullets: payload.bullets,
    speakerNotes: payload.speakerNotes,
    visualInstructions: payload.visualInstructions,
    layoutProps: payload.layoutProps,
    citations: payload.citations,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapExport(row: ExportRow): ExportRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    format: row.format,
    filePath: row.file_path,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json),
    createdAt: row.created_at
  };
}

export function createProject(input: CreateProjectInput): ProjectRecord {
  const db = getStudioDatabase();
  const id = randomUUID();
  const timestamp = nowIso();
  db.prepare(
    `
      INSERT INTO projects (id, title, prompt, audience, tone, target_slide_count, status, created_at, updated_at)
      VALUES (:id, :title, :prompt, :audience, :tone, :targetSlideCount, :status, :createdAt, :updatedAt)
    `
  ).run({
    id,
    title: input.title,
    prompt: input.prompt,
    audience: input.audience?.trim() || "",
    tone: input.tone?.trim() || "",
    targetSlideCount: input.targetSlideCount,
    status: "draft",
    createdAt: timestamp,
    updatedAt: timestamp
  });

  return requireProject(id);
}

export function listProjects(limit = 20): ProjectRecord[] {
  const db = getStudioDatabase();
  const rows = db
    .prepare(
      `
        SELECT id, title, prompt, audience, tone, target_slide_count, status, created_at, updated_at
        FROM projects
        ORDER BY updated_at DESC
        LIMIT :limit
      `
    )
    .all({ limit }) as ProjectRow[];
  return rows.map(mapProject);
}

export function getProject(projectId: string): ProjectRecord | null {
  const db = getStudioDatabase();
  const row = db
    .prepare(
      `
        SELECT id, title, prompt, audience, tone, target_slide_count, status, created_at, updated_at
        FROM projects
        WHERE id = :projectId
      `
    )
    .get({ projectId }) as ProjectRow | undefined;

  return row ? mapProject(row) : null;
}

export function requireProject(projectId: string): ProjectRecord {
  const project = getProject(projectId);
  if (!project) {
    throw new Error(`Project ${projectId} was not found.`);
  }
  return project;
}

export function updateProject(projectId: string, input: UpdateProjectInput): ProjectRecord {
  const db = getStudioDatabase();
  const current = requireProject(projectId);
  const next = {
    title: input.title ?? current.title,
    prompt: input.prompt ?? current.prompt,
    audience: input.audience ?? current.audience,
    tone: input.tone ?? current.tone,
    targetSlideCount: input.targetSlideCount ?? current.targetSlideCount,
    status: input.status ?? current.status,
    updatedAt: nowIso()
  };

  db.prepare(
    `
      UPDATE projects
      SET title = :title,
          prompt = :prompt,
          audience = :audience,
          tone = :tone,
          target_slide_count = :targetSlideCount,
          status = :status,
          updated_at = :updatedAt
      WHERE id = :projectId
    `
  ).run({
    projectId,
    ...next
  });

  return requireProject(projectId);
}

export function addSource(input: CreateSourceInput): SourceRecord {
  const db = getStudioDatabase();
  const id = randomUUID();
  const timestamp = nowIso();
  db.prepare(
    `
      INSERT INTO sources (
        id, project_id, kind, name, title, url, mime_type, extracted_text, metadata_json, created_at, updated_at
      ) VALUES (
        :id, :projectId, :kind, :name, :title, :url, :mimeType, :extractedText, :metadataJson, :createdAt, :updatedAt
      )
    `
  ).run({
    id,
    projectId: input.projectId,
    kind: input.kind,
    name: input.name ?? null,
    title: input.title,
    url: input.url ?? null,
    mimeType: input.mimeType ?? null,
    extractedText: input.extractedText,
    metadataJson: stringifyJson(input.metadata ?? {}),
    createdAt: timestamp,
    updatedAt: timestamp
  });

  updateProject(input.projectId, {});
  const row = db.prepare("SELECT * FROM sources WHERE id = :id").get({ id }) as SourceRow | undefined;
  if (!row) {
    throw new Error(`Source ${id} was not found after creation.`);
  }
  return mapSource(row);
}

export function listSources(projectId: string): SourceRecord[] {
  const db = getStudioDatabase();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM sources
        WHERE project_id = :projectId
        ORDER BY created_at ASC
      `
    )
    .all({ projectId }) as SourceRow[];
  return rows.map(mapSource);
}

export function saveProjectReasoning(record: Omit<ProjectReasoningRecord, "createdAt" | "updatedAt">): ProjectReasoningRecord {
  const db = getStudioDatabase();
  const current = getProjectReasoning(record.projectId);
  const timestamp = nowIso();
  db.prepare(
    `
      INSERT INTO project_reasoning (
        project_id, intent_json, audience_profile_json, assumption_log_json, narrative_plan_json, deck_strategy_json,
        evidence_map_json, created_at, updated_at
      ) VALUES (
        :projectId, :intentJson, :audienceProfileJson, :assumptionLogJson, :narrativePlanJson, :deckStrategyJson,
        :evidenceMapJson, :createdAt, :updatedAt
      )
      ON CONFLICT(project_id) DO UPDATE SET
        intent_json = excluded.intent_json,
        audience_profile_json = excluded.audience_profile_json,
        assumption_log_json = excluded.assumption_log_json,
        narrative_plan_json = excluded.narrative_plan_json,
        deck_strategy_json = excluded.deck_strategy_json,
        evidence_map_json = excluded.evidence_map_json,
        updated_at = excluded.updated_at
    `
  ).run({
    projectId: record.projectId,
    intentJson: stringifyJson(record.intent),
    audienceProfileJson: stringifyJson(record.audienceProfile),
    assumptionLogJson: stringifyJson(record.assumptionLog),
    narrativePlanJson: stringifyJson(record.narrativePlan),
    deckStrategyJson: stringifyJson(record.deckStrategy),
    evidenceMapJson: stringifyJson(record.evidenceMap),
    createdAt: current?.createdAt ?? timestamp,
    updatedAt: timestamp
  });

  return requireProjectReasoning(record.projectId);
}

export function getProjectReasoning(projectId: string): ProjectReasoningRecord | null {
  const db = getStudioDatabase();
  const row = db.prepare("SELECT * FROM project_reasoning WHERE project_id = :projectId").get({ projectId }) as
    | ReasoningRow
    | undefined;
  return row ? mapReasoning(row) : null;
}

export function requireProjectReasoning(projectId: string): ProjectReasoningRecord {
  const reasoning = getProjectReasoning(projectId);
  if (!reasoning) {
    throw new Error(`Project reasoning for ${projectId} was not found.`);
  }
  return reasoning;
}

export function saveOutline(input: SaveOutlineInput): OutlineRecord {
  const db = getStudioDatabase();
  const current = getOutline(input.projectId);
  const timestamp = nowIso();
  const id = current?.id ?? randomUUID();
  db.prepare(
    `
      INSERT INTO outlines (id, project_id, version, status, outline_json, created_at, updated_at)
      VALUES (:id, :projectId, :version, :status, :outlineJson, :createdAt, :updatedAt)
      ON CONFLICT(project_id) DO UPDATE SET
        version = excluded.version,
        status = excluded.status,
        outline_json = excluded.outline_json,
        updated_at = excluded.updated_at
    `
  ).run({
    id,
    projectId: input.projectId,
    version: (current?.version ?? 0) + 1,
    status: input.status,
    outlineJson: stringifyJson(input.slides),
    createdAt: current?.createdAt ?? timestamp,
    updatedAt: timestamp
  });

  updateProject(input.projectId, {
    status: input.status === "approved" ? "outline_approved" : "outline_ready"
  });

  return requireOutline(input.projectId);
}

export function getOutline(projectId: string): OutlineRecord | null {
  const db = getStudioDatabase();
  const row = db.prepare("SELECT * FROM outlines WHERE project_id = :projectId").get({ projectId }) as OutlineRow | undefined;
  return row ? mapOutline(row) : null;
}

export function requireOutline(projectId: string): OutlineRecord {
  const outline = getOutline(projectId);
  if (!outline) {
    throw new Error(`Outline for project ${projectId} was not found.`);
  }
  return outline;
}

export function replaceSlides(projectId: string, slides: SlideRecord[]): SlideRecord[] {
  const db = getStudioDatabase();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM slides WHERE project_id = :projectId").run({ projectId });
    const insert = db.prepare(
      `
        INSERT INTO slides (id, project_id, slide_index, slide_type, slide_json, created_at, updated_at)
        VALUES (:id, :projectId, :slideIndex, :slideType, :slideJson, :createdAt, :updatedAt)
      `
    );

    for (const slide of slides) {
      insert.run({
        id: slide.id,
        projectId,
        slideIndex: slide.slideIndex,
        slideType: slide.slideType,
        slideJson: stringifyJson({
          title: slide.title,
          objective: slide.objective,
          bullets: slide.bullets,
          speakerNotes: slide.speakerNotes,
          visualInstructions: slide.visualInstructions,
          layoutProps: slide.layoutProps,
          citations: slide.citations
        }),
        createdAt: slide.createdAt,
        updatedAt: slide.updatedAt
      });
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  updateProject(projectId, { status: "slides_ready" });
  return listSlides(projectId);
}

export function listSlides(projectId: string): SlideRecord[] {
  const db = getStudioDatabase();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM slides
        WHERE project_id = :projectId
        ORDER BY slide_index ASC
      `
    )
    .all({ projectId }) as SlideRow[];
  return rows.map(mapSlide);
}

export function getSlide(projectId: string, slideId: string): SlideRecord | null {
  const db = getStudioDatabase();
  const row = db
    .prepare("SELECT * FROM slides WHERE project_id = :projectId AND id = :slideId")
    .get({ projectId, slideId }) as SlideRow | undefined;
  return row ? mapSlide(row) : null;
}

export function requireSlide(projectId: string, slideId: string): SlideRecord {
  const slide = getSlide(projectId, slideId);
  if (!slide) {
    throw new Error(`Slide ${slideId} was not found for project ${projectId}.`);
  }
  return slide;
}

export function upsertSlide(projectId: string, slide: SlideRecord): SlideRecord {
  const db = getStudioDatabase();
  db.prepare(
    `
      INSERT INTO slides (id, project_id, slide_index, slide_type, slide_json, created_at, updated_at)
      VALUES (:id, :projectId, :slideIndex, :slideType, :slideJson, :createdAt, :updatedAt)
      ON CONFLICT(project_id, slide_index) DO UPDATE SET
        id = excluded.id,
        slide_type = excluded.slide_type,
        slide_json = excluded.slide_json,
        updated_at = excluded.updated_at
    `
  ).run({
    id: slide.id,
    projectId,
    slideIndex: slide.slideIndex,
    slideType: slide.slideType,
    slideJson: stringifyJson({
      title: slide.title,
      objective: slide.objective,
      bullets: slide.bullets,
      speakerNotes: slide.speakerNotes,
      visualInstructions: slide.visualInstructions,
      layoutProps: slide.layoutProps,
      citations: slide.citations
    }),
    createdAt: slide.createdAt,
    updatedAt: slide.updatedAt
  });

  updateProject(projectId, { status: "slides_ready" });
  return requireSlide(projectId, slide.id);
}

export function updateSlide(projectId: string, slideId: string, input: UpdateSlideInput): SlideRecord {
  const current = requireSlide(projectId, slideId);
  const next: SlideRecord = {
    ...current,
    title: input.title ?? current.title,
    objective: input.objective ?? current.objective,
    bullets: input.bullets ?? current.bullets,
    speakerNotes: input.speakerNotes ?? current.speakerNotes,
    visualInstructions: input.visualInstructions ?? current.visualInstructions,
    layoutProps: input.layoutProps ?? current.layoutProps,
    citations: input.citations ?? current.citations,
    updatedAt: nowIso()
  };

  return upsertSlide(projectId, next);
}

export function saveExport(input: SaveExportInput): ExportRecord {
  const db = getStudioDatabase();
  const id = randomUUID();
  const createdAt = nowIso();
  db.prepare(
    `
      INSERT INTO exports (id, project_id, format, file_path, metadata_json, created_at)
      VALUES (:id, :projectId, :format, :filePath, :metadataJson, :createdAt)
    `
  ).run({
    id,
    projectId: input.projectId,
    format: input.format,
    filePath: input.filePath,
    metadataJson: stringifyJson(input.metadata ?? {}),
    createdAt
  });

  const row = db.prepare("SELECT * FROM exports WHERE id = :id").get({ id }) as ExportRow | undefined;
  if (!row) {
    throw new Error(`Export ${id} was not found after creation.`);
  }
  return mapExport(row);
}

export function listExports(projectId: string): ExportRecord[] {
  const db = getStudioDatabase();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM exports
        WHERE project_id = :projectId
        ORDER BY created_at DESC
      `
    )
    .all({ projectId }) as ExportRow[];
  return rows.map(mapExport);
}

export function getExport(exportId: string): ExportRecord | null {
  const db = getStudioDatabase();
  const row = db.prepare("SELECT * FROM exports WHERE id = :exportId").get({ exportId }) as ExportRow | undefined;
  return row ? mapExport(row) : null;
}

export function requireExport(exportId: string): ExportRecord {
  const record = getExport(exportId);
  if (!record) {
    throw new Error(`Export ${exportId} was not found.`);
  }
  return record;
}

export function getProjectBundle(projectId: string): ProjectBundle {
  return {
    project: requireProject(projectId),
    sources: listSources(projectId),
    reasoning: getProjectReasoning(projectId),
    outline: getOutline(projectId),
    slides: listSlides(projectId),
    exports: listExports(projectId)
  };
}
