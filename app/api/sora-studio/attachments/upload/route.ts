import { randomUUID } from "node:crypto";
import { fal } from "@fal-ai/client";
import { NextResponse } from "next/server";
import type { SoraStudioBriefAttachment, SoraStudioBriefAttachmentType } from "@/app/lib/sora-studio/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES = 8;
const MAX_FILE_BYTES = 80 * 1024 * 1024;

function requireFalApiKey(): string {
  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    throw new Error("FAL_KEY is required for attachment uploads.");
  }
  return key;
}

function detectAttachmentType(file: File): SoraStudioBriefAttachmentType | null {
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("image/")) {
    return "image";
  }
  if (mime.startsWith("video/")) {
    return "video";
  }

  const name = (file.name || "").toLowerCase();
  if (/\.(png|jpg|jpeg|webp|gif|bmp|tiff|heic|heif)$/i.test(name)) {
    return "image";
  }
  if (/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(name)) {
    return "video";
  }
  return null;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);

    if (files.length === 0) {
      return NextResponse.json({ error: "Attach at least one image or video file." }, { status: 400 });
    }

    if (files.length > MAX_FILES) {
      return NextResponse.json({ error: `Maximum ${MAX_FILES} attachments allowed per run.` }, { status: 400 });
    }

    fal.config({ credentials: requireFalApiKey() });

    const falClient = fal as unknown as {
      storage?: {
        upload: (file: Blob) => Promise<string>;
      };
    };

    if (!falClient.storage) {
      throw new Error("fal storage client is unavailable.");
    }

    const attachments: SoraStudioBriefAttachment[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        throw new Error(`${file.name} exceeds ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))}MB limit.`);
      }

      const mediaType = detectAttachmentType(file);
      if (!mediaType) {
        throw new Error(`${file.name} is unsupported. Use image or video files only.`);
      }

      const mime = file.type?.trim() || (mediaType === "image" ? "image/jpeg" : "video/mp4");
      const bytes = Buffer.from(await file.arrayBuffer());
      const url = await falClient.storage.upload(new Blob([bytes], { type: mime }));

      attachments.push({
        id: randomUUID(),
        name: file.name || `${mediaType}-${Date.now()}`,
        mediaType,
        source: "upload",
        url,
        mimeType: mime
      });
    }

    return NextResponse.json({ attachments }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload attachments." },
      { status: 500 }
    );
  }
}
