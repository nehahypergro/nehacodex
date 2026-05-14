import { NextResponse } from "next/server";
import {
  feedbackTrackerEntriesToCsv,
  getFeedbackTrackerEntryCount,
  listFeedbackTrackerEntries
} from "@/app/lib/sora-studio/feedback-tracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "json").trim().toLowerCase();
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "500", 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 10000) : 500;
  const entries = await listFeedbackTrackerEntries(limit);
  const totalCount = await getFeedbackTrackerEntryCount();

  if (format === "csv") {
    const csv = feedbackTrackerEntriesToCsv(entries);
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="sora-feedback-tracker-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store"
      }
    });
  }

  return NextResponse.json(
    {
      totalCount,
      returnedCount: entries.length,
      limit,
      entries
    },
    {
      headers: {
        "cache-control": "no-store"
      }
    }
  );
}
