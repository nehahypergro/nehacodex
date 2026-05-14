import { NextResponse } from "next/server";
import { z } from "zod";
import { getJob, toClientJob } from "@/app/lib/jobs";
import { promoteRawAttemptToFinal } from "@/app/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  rawFileName: z.string().trim().min(1),
  qcFileName: z.string().trim().min(1).optional()
});

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Params): Promise<NextResponse> {
  const { id } = await context.params;
  const existing = await getJob(id);

  if (!existing) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  try {
    const payload = payloadSchema.parse(await request.json());
    const updated = await promoteRawAttemptToFinal(id, payload.rawFileName, payload.qcFileName);
    return NextResponse.json({ job: toClientJob(updated) }, { status: 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request payload." }, { status: 400 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to promote raw attempt."
      },
      { status: 500 }
    );
  }
}
