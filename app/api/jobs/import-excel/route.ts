import { NextResponse } from "next/server";
import { createJob, toClientJob } from "@/app/lib/jobs";
import { runPipeline } from "@/app/lib/pipeline";
import {
  parseSoraImportRowsFromFile,
  resolveImportOptions,
  resolveSoraImportRow,
  SoraResolvedRow
} from "@/app/lib/sora-bulk-import";
import { DEFAULT_PROMPT_WRITER_VERSION } from "@/app/lib/types";
import { generateScriptAndSoraPromptWithGemini } from "@/app/lib/gemini-sora";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ImportedRowResult {
  rowNumber: number;
  status: "created" | "failed";
  error?: string;
  warnings?: string[];
  mapped?: {
    originalProduct: string;
    product: SoraResolvedRow["product"];
    durationSeconds: SoraResolvedRow["durationSeconds"];
    videoType: SoraResolvedRow["videoType"];
    requestedAspectRatio?: SoraResolvedRow["requestedAspectRatio"];
    requestedLanguage?: SoraResolvedRow["requestedLanguage"];
  };
  job?: ReturnType<typeof toClientJob>;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json(
        {
          error: "Upload an Excel file in the `file` field (.xlsx/.xlsm) or a CSV/TSV exported from Excel."
        },
        { status: 400 }
      );
    }

    const { autoStart, maxRows } = resolveImportOptions(formData);
    const parsedRows = await parseSoraImportRowsFromFile(file);

    if (parsedRows.length === 0) {
      return NextResponse.json(
        {
          error: "No usable data rows found. Ensure the sheet has a header row and at least one data row."
        },
        { status: 400 }
      );
    }

    if (parsedRows.length > maxRows) {
      return NextResponse.json(
        {
          error: `File has ${parsedRows.length} rows. Max allowed in one import is ${maxRows}.`,
          rowCount: parsedRows.length,
          maxRows
        },
        { status: 400 }
      );
    }

    const results: ImportedRowResult[] = [];
    for (const rawRow of parsedRows) {
      try {
        const resolved = resolveSoraImportRow(rawRow);
        const geminiResult = await generateScriptAndSoraPromptWithGemini({
          product: resolved.product,
          originalProduct: resolved.originalProduct,
          brief: resolved.brief,
          businessObjective: rawRow.businessObjectiveRaw,
          creativeObjectiveFunnel: rawRow.creativeObjectiveFunnelRaw,
          durationSeconds: resolved.durationSeconds,
          ratioDimensions: rawRow.ratioDimensionsRaw,
          language: rawRow.languageRaw,
          videoType: resolved.videoType
        });

        const job = await createJob({
          product: resolved.product,
          brief: resolved.brief,
          guidelines: resolved.guidelines,
          script: geminiResult.script,
          soraPrompt: geminiResult.soraPrompt,
          promptVersion: DEFAULT_PROMPT_WRITER_VERSION,
          video: {
            type: resolved.videoType,
            durationSeconds: resolved.durationSeconds,
            provider: "sora"
          },
          supers: {
            enabled: true,
            timingMode: "fast",
            template: "super1",
            rules: []
          }
        });

        if (autoStart) {
          void runPipeline(job.id).catch((error) => {
            console.error(`[pipeline] imported job ${job.id} failed`, error);
          });
        }

        results.push({
          rowNumber: resolved.rowNumber,
          status: "created",
          warnings: resolved.warnings,
          mapped: {
            originalProduct: resolved.originalProduct,
            product: resolved.product,
            durationSeconds: resolved.durationSeconds,
            videoType: resolved.videoType,
            requestedAspectRatio: resolved.requestedAspectRatio,
            requestedLanguage: resolved.requestedLanguage
          },
          job: toClientJob(job)
        });
      } catch (error) {
        results.push({
          rowNumber: rawRow.rowNumber,
          status: "failed",
          error: error instanceof Error ? error.message : "Failed to import row."
        });
      }
    }

    const created = results.filter((item) => item.status === "created").length;
    const failed = results.length - created;

    return NextResponse.json(
      {
        fileName: file.name,
        autoStart,
        totalRows: results.length,
        created,
        failed,
        results
      },
      { status: created > 0 ? 202 : 400 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to import Excel file."
      },
      { status: 500 }
    );
  }
}
