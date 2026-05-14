import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";

const STORAGE_ROOT = path.join(process.cwd(), "storage");
const UPLOADS_ROOT = path.join(STORAGE_ROOT, "uploads");
const EXPORTS_ROOT = path.join(STORAGE_ROOT, "exports");
const DATABASE_PATH = path.join(STORAGE_ROOT, "slide-studio.sqlite");

function ensureDir(dirPath: string): string {
  mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function ensureStudioStorage(): void {
  ensureDir(STORAGE_ROOT);
  ensureDir(UPLOADS_ROOT);
  ensureDir(EXPORTS_ROOT);
}

export function getStudioStorageRoot(): string {
  ensureStudioStorage();
  return STORAGE_ROOT;
}

export function getStudioUploadsRoot(): string {
  ensureStudioStorage();
  return UPLOADS_ROOT;
}

export function getStudioExportsRoot(): string {
  ensureStudioStorage();
  return EXPORTS_ROOT;
}

export function getStudioDatabasePath(): string {
  ensureStudioStorage();
  return DATABASE_PATH;
}

export function getProjectUploadDir(projectId: string): string {
  return ensureDir(path.join(getStudioUploadsRoot(), projectId));
}

export function sanitizeFileName(fileName: string): string {
  const base = fileName.trim().toLowerCase();
  return base.replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "source";
}
