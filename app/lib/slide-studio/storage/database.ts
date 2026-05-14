import "server-only";

import { DatabaseSync } from "node:sqlite";
import { getStudioDatabasePath, ensureStudioStorage } from "@/app/lib/slide-studio/storage/paths";

declare global {
  var __slideStudioDb__: DatabaseSync | undefined;
}

function initializeDatabase(db: DatabaseSync): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      audience TEXT NOT NULL,
      tone TEXT NOT NULL,
      target_slide_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT,
      title TEXT NOT NULL,
      url TEXT,
      mime_type TEXT,
      extracted_text TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sources_project_id ON sources(project_id);

    CREATE TABLE IF NOT EXISTS project_reasoning (
      project_id TEXT PRIMARY KEY,
      intent_json TEXT NOT NULL,
      audience_profile_json TEXT NOT NULL,
      assumption_log_json TEXT NOT NULL,
      narrative_plan_json TEXT NOT NULL,
      deck_strategy_json TEXT NOT NULL,
      evidence_map_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS outlines (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL UNIQUE,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      outline_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS slides (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      slide_index INTEGER NOT NULL,
      slide_type TEXT NOT NULL,
      slide_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, slide_index),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_slides_project_id ON slides(project_id);

    CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      format TEXT NOT NULL,
      file_path TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_exports_project_id ON exports(project_id);
  `);
}

export function getStudioDatabase(): DatabaseSync {
  if (!globalThis.__slideStudioDb__) {
    ensureStudioStorage();
    const db = new DatabaseSync(getStudioDatabasePath());
    initializeDatabase(db);
    globalThis.__slideStudioDb__ = db;
  }

  return globalThis.__slideStudioDb__;
}
