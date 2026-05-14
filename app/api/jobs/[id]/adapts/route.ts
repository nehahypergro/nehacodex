import { NextResponse } from "next/server";
import { getJob, toClientJob } from "@/app/lib/jobs";
import { generateAdapts } from "@/app/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(_: Request, context: Params): Promise<NextResponse> {
  const { id } = await context.params;
  const existing = await getJob(id);

  if (!existing) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  if (!existing.assets.finalMp4) {
    return NextResponse.json({ error: "Final MP4 is not ready yet." }, { status: 409 });
  }

  if (existing.video?.type === "how_to_video") {
    return NextResponse.json({ error: "Adapts are not supported for How to videos." }, { status: 409 });
  }

  try {
    const updated = await generateAdapts(id);
    return NextResponse.json({ job: toClientJob(updated) }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate adapts."
      },
      { status: 500 }
    );
  }
}
