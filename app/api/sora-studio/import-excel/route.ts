import { NextResponse } from "next/server";
import { generateSoraStudioScriptAndPromptWithAnthropicFal } from "@/app/lib/sora-studio/anthropic-fal";
import {
  parseSoraStudioRowsFromFile,
  resolveSoraStudioImportOptions,
  resolveSoraStudioInputRow
} from "@/app/lib/sora-studio/import";
import { runSoraStudioJob } from "@/app/lib/sora-studio/render";
import { createSoraStudioJob, toClientSoraStudioJob } from "@/app/lib/sora-studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ImportResult {
  rowNumber: number;
  status: "created" | "failed";
  error?: string;
  warnings?: string[];
  job?: ReturnType<typeof toClientSoraStudioJob>;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json(
        { error: "Upload an Excel file in the `file` field (.xlsx/.xlsm) or a CSV/TSV exported from Excel." },
        { status: 400 }
      );
    }

    const { autoRender, maxRows, strictParityMode, notificationEmail } = resolveSoraStudioImportOptions(formData);
    const rawRows = await parseSoraStudioRowsFromFile(file);

    if (rawRows.length === 0) {
      return NextResponse.json(
        { error: "No usable rows found. Ensure the sheet has a header row and at least one data row." },
        { status: 400 }
      );
    }

    if (rawRows.length > maxRows) {
      return NextResponse.json(
        {
          error: `File has ${rawRows.length} rows. Max allowed in one import is ${maxRows}.`,
          rowCount: rawRows.length,
          maxRows
        },
        { status: 400 }
      );
    }

    const results: ImportResult[] = [];

    for (const rawRow of rawRows) {
      try {
        const resolved = resolveSoraStudioInputRow({
          ...rawRow,
          notificationEmail: rawRow.notificationEmail || notificationEmail,
          strictParityMode
        });
        const generated = await generateSoraStudioScriptAndPromptWithAnthropicFal(resolved);

        const job = await createSoraStudioJob({
          input: resolved,
          compactedBrief: generated.compactedBrief,
          scriptWriterPrompt: generated.scriptWriterPrompt,
          script: generated.script,
          soraPrompt: generated.soraPrompt,
          scriptModel: generated.model,
          promptModel: generated.model,
          warnings: [...resolved.warnings, ...generated.warnings]
        });

        if (autoRender) {
          void runSoraStudioJob(job.id).catch((error) => {
            console.error(`[sora-studio] job ${job.id} failed`, error);
          });
        }

        results.push({
          rowNumber: resolved.rowNumber,
          status: "created",
          warnings: [...resolved.warnings, ...generated.warnings],
          job: toClientSoraStudioJob(job)
        });
      } catch (error) {
        results.push({
          rowNumber: rawRow.rowNumber,
          status: "failed",
          error: error instanceof Error ? error.message : "Failed to import row."
        });
      }
    }

    const created = results.filter((result) => result.status === "created").length;
    const failed = results.length - created;

    return NextResponse.json(
      {
        fileName: file.name,
        autoRender,
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
