import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getJobDir } from "@/app/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATIC_ALLOWED_FILES = new Set([
  "input.json",
  "backstory.json",
  "job.json",
  "keyframe.png",
  "raw.mp4",
  "qc.json",
  "final.mp4",
  "adapt-1x1.mp4",
  "adapt-16x9.mp4"
]);

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8"
};

interface Params {
  params: Promise<{ id: string; name: string }>;
}

function isAllowedAsset(name: string): boolean {
  if (STATIC_ALLOWED_FILES.has(name)) {
    return true;
  }

  if (/^(?:keyframe|keyframe-source|shared-keyframe-source|sora-image-keyframe-source)-[a-z0-9-]+\.png$/i.test(name)) {
    return true;
  }

  if (/^(?:raw|raw-provider|raw-topaz|final)-[a-z0-9-]+\.mp4$/i.test(name)) {
    return true;
  }

  if (/^qc-[a-z0-9-]+\.json$/i.test(name)) {
    return true;
  }

  if (/^howto-step-\d{2,3}\.mp4$/i.test(name)) {
    return true;
  }

  return false;
}

export async function GET(request: Request, context: Params): Promise<NextResponse> {
  const { id, name } = await context.params;

  if (!isAllowedAsset(name)) {
    return NextResponse.json({ error: "Asset not allowed." }, { status: 404 });
  }

  const safeName = path.basename(name);
  const filePath = path.join(getJobDir(id), safeName);

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(safeName).toLowerCase();
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
    const download = new URL(request.url).searchParams.get("download") === "1";

    return new NextResponse(content, {
      headers: {
        "content-type": contentType,
        "cache-control": "no-store",
        ...(download ? { "content-disposition": `attachment; filename=\"${safeName}\"` } : {})
      }
    });
  } catch {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }
}
