import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getSoraStudioJob, getSoraStudioJobDir } from "@/app/lib/sora-studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_FILES = new Set([
  "input.json",
  "job.json",
  "render-debug.log",
  "render-manifest.json",
  "raw-sora-studio.mp4",
  "final-sora-studio.mp4",
  "sora2.mp4",
  "seedance2.mp4",
  "klingv3.mp4"
]);

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".log": "text/plain; charset=utf-8",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8"
};

interface Params {
  params: Promise<{ id: string; name: string }>;
}

function jobAllowsAssetName(job: Awaited<ReturnType<typeof getSoraStudioJob>>, name: string): boolean {
  if (ALLOWED_FILES.has(name)) {
    return true;
  }
  if (!job) {
    return false;
  }
  const assetNames = Object.values(job.assets).filter((value): value is string => typeof value === "string");
  const renderAssetNames = (job.renders ?? [])
    .map((render) => render.assetFile)
    .filter((value): value is string => typeof value === "string");
  return [...assetNames, ...renderAssetNames].includes(name);
}

function parseRange(rangeHeader: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || size <= 0) {
    return null;
  }

  const [, startValue, endValue] = match;
  let start: number;
  let end: number;

  if (!startValue && !endValue) {
    return null;
  }

  if (!startValue) {
    const suffixLength = Number.parseInt(endValue, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number.parseInt(startValue, 10);
    end = endValue ? Number.parseInt(endValue, 10) : size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) {
    return null;
  }

  return { start, end: Math.min(end, size - 1) };
}

export async function GET(request: Request, context: Params): Promise<NextResponse> {
  const { id, name } = await context.params;
  const safeName = path.basename(name);
  if (safeName !== name) {
    return NextResponse.json({ error: "Asset not allowed." }, { status: 404 });
  }

  const job = await getSoraStudioJob(id);
  if (!jobAllowsAssetName(job, safeName)) {
    return NextResponse.json({ error: "Asset not allowed." }, { status: 404 });
  }

  const filePath = path.join(getSoraStudioJobDir(id), safeName);

  try {
    const extension = path.extname(safeName).toLowerCase();
    const contentType = CONTENT_TYPES[extension] ?? "application/octet-stream";
    const stat = await fs.stat(filePath);
    const download = new URL(request.url).searchParams.get("download") === "1";
    let contentDisposition: string | undefined;

    if (download) {
      contentDisposition = `attachment; filename="${safeName}"`;
    }

    const baseHeaders = {
      "content-type": contentType,
      "cache-control": "no-store",
      "accept-ranges": extension === ".mp4" ? "bytes" : "none",
      ...(contentDisposition ? { "content-disposition": contentDisposition } : {})
    };

    const rangeHeader = request.headers.get("range");
    if (extension === ".mp4" && rangeHeader && !download) {
      const range = parseRange(rangeHeader, stat.size);
      if (!range) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            ...baseHeaders,
            "content-range": `bytes */${stat.size}`
          }
        });
      }

      const length = range.end - range.start + 1;
      const handle = await fs.open(filePath, "r");
      try {
        const content = Buffer.alloc(length);
        await handle.read(content, 0, length, range.start);
        return new NextResponse(content, {
          status: 206,
          headers: {
            ...baseHeaders,
            "content-length": String(length),
            "content-range": `bytes ${range.start}-${range.end}/${stat.size}`
          }
        });
      } finally {
        await handle.close();
      }
    }

    const content = await fs.readFile(filePath);
    return new NextResponse(content, {
      headers: {
        ...baseHeaders,
        "content-length": String(stat.size)
      }
    });
  } catch {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }
}
