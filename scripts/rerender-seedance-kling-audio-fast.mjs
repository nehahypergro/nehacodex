import { fal } from "@fal-ai/client";
import { promises as fs } from "node:fs";
import path from "node:path";

const BASE_DIR = process.env.BASE_DIR || "/Users/neha/.codex/worktrees/e8b2/Codex/generated-sora-studio-model-comparison/1778245596338-bec0688b-compact-2026-05-10T12-09-14-157Z";
const outDir = path.join(BASE_DIR, "audio-rerender-fast");
await fs.mkdir(outDir, { recursive: true });

const prompt = [
  "15-second 9:16 ultra-realistic Marathi ad video for कोटक Mahindra Bank Business Loan.",
  "One Indian male boutique owner in Pune, same face and wardrobe throughout.",
  "Story: festive season, inventory pressure, then confidence after easy business funding.",
  "Scenes: shop entrance, stocked shelves, billing counter, staff interaction, happy customers, direct-to-camera CTA.",
  "Warm festive lighting, colorful fabrics, cinematic movement, natural Indian faces.",
  "Natural ambient background score and subtle festive audio bed.",
  "No on-screen text, no UI, no phone/laptop screens, no subtitles, no logos.",
  "Marathi voice tone implied through performance mood only."
].join(" ");

const tasks = [
  {
    key: "seedance2",
    endpoint: "bytedance/seedance-2.0/text-to-video",
    input: {
      prompt,
      resolution: "720p",
      aspect_ratio: "9:16",
      duration: "15",
      generate_audio: true
    }
  },
  {
    key: "klingv3",
    endpoint: "fal-ai/kling-video/v3/pro/text-to-video",
    input: {
      prompt,
      aspect_ratio: "9:16",
      duration: "15",
      generate_audio: true,
      shot_type: "customize"
    }
  }
];

const manifest = { createdAt: new Date().toISOString(), prompt, runs: [] };

for (const task of tasks) {
  const rec = { key: task.key, endpoint: task.endpoint, input: task.input, startedAt: new Date().toISOString(), status: "running" };
  manifest.runs.push(rec);
  await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  try {
    const result = await fal.subscribe(task.endpoint, {
      input: task.input,
      mode: "polling",
      pollInterval: 6000,
      logs: true,
      onQueueUpdate(update) {
        process.stdout.write(`[${task.key}] queue: ${String(update?.status || "")}\n`);
      }
    });

    const video = result?.data?.video;
    if (!video?.url) throw new Error("No video URL in response");

    const res = await fetch(video.url);
    if (!res.ok) throw new Error(`download failed ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const outName = `${task.key}-audio-fast.mp4`;
    await fs.writeFile(path.join(outDir, outName), bytes);

    rec.requestId = result?.requestId;
    rec.status = "completed";
    rec.file = outName;
    rec.bytes = bytes.length;
    rec.completedAt = new Date().toISOString();
    process.stdout.write(`[${task.key}] completed -> ${path.join(outDir, outName)}\n`);
  } catch (e) {
    rec.status = "failed";
    rec.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    rec.completedAt = new Date().toISOString();
    process.stdout.write(`[${task.key}] failed: ${rec.error}\n`);
  }

  await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

console.log(`OUT_DIR=${outDir}`);
