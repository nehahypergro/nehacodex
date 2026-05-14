import { NextResponse } from "next/server";
import { pollGmailBriefInbox } from "@/app/lib/gmail";
import { runPipeline } from "@/app/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  try {
    const result = await pollGmailBriefInbox();

    for (const job of result.jobs) {
      void runPipeline(job.id).catch((error) => {
        console.error(`[pipeline] gmail job ${job.id} failed`, error);
      });
    }

    return NextResponse.json(
      {
        mailbox: result.mailbox,
        jobIds: result.jobs.map((job) => job.id),
        processedMessageIds: result.processedMessageIds,
        skipped: result.skipped,
        errors: result.errors
      },
      { status: 202 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to poll Gmail inbox."
      },
      { status: 500 }
    );
  }
}
