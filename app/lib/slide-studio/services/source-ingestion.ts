import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { addSource } from "@/app/lib/slide-studio/storage/repository";
import { getProjectUploadDir, sanitizeFileName } from "@/app/lib/slide-studio/storage/paths";
import { ProjectRecord, SourceRecord } from "@/app/lib/slide-studio/types";
import { normalizeWhitespace } from "@/app/lib/slide-studio/services/text-utils";

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".csv", ".tsv", ".html", ".htm", ".json"]);
const BINARY_PLACEHOLDER_TEXT =
  "This file was uploaded successfully, but the local parser cannot extract readable text from this format yet. For source-backed copy today, use pasted text, TXT, MD, CSV, HTML, or JSON.";

function extensionFor(name: string): string {
  return path.extname(name).toLowerCase();
}

function inferReadableText(fileName: string, mimeType: string): boolean {
  return mimeType.startsWith("text/") || mimeType === "application/json" || TEXT_EXTENSIONS.has(extensionFor(fileName));
}

async function extractTextFromFile(file: File): Promise<{ extractedText: string; parserStatus: string }> {
  const mimeType = file.type || "application/octet-stream";
  const rawBuffer = Buffer.from(await file.arrayBuffer());

  if (!inferReadableText(file.name, mimeType)) {
    return {
      extractedText: BINARY_PLACEHOLDER_TEXT,
      parserStatus: "placeholder"
    };
  }

  const extractedText = normalizeWhitespace(rawBuffer.toString("utf8"));
  return {
    extractedText: extractedText || "The file was readable but did not contain extractable text after normalization.",
    parserStatus: "extracted"
  };
}

export function ingestPromptSource(project: ProjectRecord): SourceRecord {
  return addSource({
    projectId: project.id,
    kind: "prompt",
    title: `${project.title} brief`,
    extractedText: project.prompt,
    metadata: {
      sourceType: "project_prompt"
    }
  });
}

export async function ingestUploadedFiles(project: ProjectRecord, files: File[]): Promise<SourceRecord[]> {
  const uploadDir = getProjectUploadDir(project.id);
  const sources: SourceRecord[] = [];

  for (const file of files) {
    if (!(file instanceof File) || file.size <= 0) {
      continue;
    }

    const safeName = `${Date.now()}-${sanitizeFileName(file.name)}`;
    const destinationPath = path.join(uploadDir, safeName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(destinationPath, buffer);
    const { extractedText, parserStatus } = await extractTextFromFile(file);

    sources.push(
      addSource({
        projectId: project.id,
        kind: "upload",
        name: file.name,
        title: file.name,
        mimeType: file.type || "application/octet-stream",
        extractedText,
        metadata: {
          originalFileName: file.name,
          storagePath: destinationPath,
          sizeBytes: file.size,
          parserStatus
        }
      })
    );
  }

  return sources;
}
