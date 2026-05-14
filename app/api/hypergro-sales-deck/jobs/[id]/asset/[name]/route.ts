import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getDeckJobDir } from "@/app/lib/hypergro/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_FILES = new Set(["input.json", "deck.json", "slides.json", "hero.png"]);

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".png": "image/png"
};

interface Params {
  params: Promise<{ id: string; name: string }>;
}

export async function GET(request: Request, context: Params): Promise<NextResponse> {
  const { id, name } = await context.params;

  if (!ALLOWED_FILES.has(name)) {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }

  const safeName = path.basename(name);
  const filePath = path.join(getDeckJobDir(id), safeName);

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(safeName).toLowerCase();
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
    const download = new URL(request.url).searchParams.get("download") === "1";

    return new NextResponse(content, {
      headers: {
        "content-type": contentType,
        "cache-control": "no-store",
        ...(download ? { "content-disposition": `attachment; filename="${safeName}"` } : {})
      }
    });
  } catch {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }
}
