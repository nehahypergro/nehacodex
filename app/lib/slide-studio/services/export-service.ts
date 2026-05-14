import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { getProjectBundle, saveExport } from "@/app/lib/slide-studio/storage/repository";
import { getStudioExportsRoot } from "@/app/lib/slide-studio/storage/paths";
import { ExportRecord } from "@/app/lib/slide-studio/types";
import { slugify } from "@/app/lib/slide-studio/services/text-utils";

export interface ExportService {
  exportProjectAsJson(projectId: string): Promise<ExportRecord>;
}

class LocalExportService implements ExportService {
  async exportProjectAsJson(projectId: string): Promise<ExportRecord> {
    const bundle = getProjectBundle(projectId);
    const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}-${slugify(bundle.project.title || projectId)}.json`;
    const filePath = path.join(getStudioExportsRoot(), fileName);
    const payload = {
      exportedAt: new Date().toISOString(),
      format: "json",
      project: bundle.project,
      reasoning: bundle.reasoning,
      sources: bundle.sources,
      outline: bundle.outline,
      slides: bundle.slides
    };

    await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return saveExport({
      projectId,
      format: "json",
      filePath,
      metadata: {
        type: "deck_export",
        fileName
      }
    });
  }
}

let singleton: ExportService | null = null;

export function getExportService(): ExportService {
  if (!singleton) {
    singleton = new LocalExportService();
  }
  return singleton;
}
