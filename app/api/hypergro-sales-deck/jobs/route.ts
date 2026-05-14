import { NextResponse } from "next/server";
import { z } from "zod";
import { createDeckJob, getDeckJob, listDeckJobs, toClientDeckJob } from "@/app/lib/hypergro/jobs";
import { runDeckGeneration } from "@/app/lib/hypergro/pipeline";
import { DeckInput } from "@/app/lib/hypergro/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  brief: z.string().trim().max(6000).optional(),
  sampleDeckText: z.string().trim().max(15000).optional(),
  styleNotes: z.string().trim().max(2400).optional()
});

function readFormString(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

export async function GET(): Promise<NextResponse> {
  const jobs = await listDeckJobs();
  return NextResponse.json({
    jobs: jobs.map(toClientDeckJob)
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const formData = await request.formData();
  const sampleDeckFileEntry = formData.get("sampleDeckFile");
  const sampleDeckFile = sampleDeckFileEntry instanceof File && sampleDeckFileEntry.size > 0 ? sampleDeckFileEntry : null;

  const payload = requestSchema.parse({
    brief: readFormString(formData, "brief"),
    sampleDeckText: readFormString(formData, "sampleDeckText"),
    styleNotes: readFormString(formData, "styleNotes")
  });

  if (!payload.brief && !payload.sampleDeckText && !sampleDeckFile) {
    return NextResponse.json(
      {
        error: "Provide a strategic brief, a sample deck file, or a pasted sample deck excerpt."
      },
      { status: 400 }
    );
  }

  if (sampleDeckFile && sampleDeckFile.size > 25 * 1024 * 1024) {
    return NextResponse.json(
      {
        error: "Sample deck uploads must be 25MB or smaller."
      },
      { status: 400 }
    );
  }

  const input: DeckInput = {
    ...payload,
    sampleFile: sampleDeckFile
      ? {
          name: sampleDeckFile.name,
          mimeType: sampleDeckFile.type || "application/octet-stream",
          sizeBytes: sampleDeckFile.size
        }
      : undefined
  };

  const job = await createDeckJob(input);

  try {
    await runDeckGeneration(job.id, input, sampleDeckFile);
    const complete = await getDeckJob(job.id);
    return NextResponse.json(
      {
        job: complete ? toClientDeckJob(complete) : null
      },
      { status: 201 }
    );
  } catch (error) {
    const failed = await getDeckJob(job.id);
    const message = error instanceof Error ? error.message : "Deck generation failed.";
    return NextResponse.json(
      {
        error: message,
        job: failed ? toClientDeckJob(failed) : null
      },
      { status: 500 }
    );
  }
}
