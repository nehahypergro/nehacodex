import { fal } from "@fal-ai/client";
import { promises as fs } from "node:fs";
import path from "node:path";

const BASE_DIR = process.env.BASE_DIR || "/Users/neha/.codex/worktrees/e8b2/Codex/generated-sora-studio-model-comparison/1778245596338-bec0688b-compact-2026-05-10T12-09-14-157Z";
const promptPath = path.join(BASE_DIR, "prompt-used.txt");
const prompt = (await fs.readFile(promptPath, "utf8")).trim();

const outDir = path.join(BASE_DIR, "audio-rerender");
await fs.mkdir(outDir, { recursive: true });

const manifest = {
  createdAt: new Date().toISOString(),
  baseDir: BASE_DIR,
  promptChars: prompt.length,
  runs: []
};

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

    rec.requestId = result?.requestId;
    rec.data = result?.data;

    const video = result?.data?.video;
    if (!video?.url) {
      throw new Error("No video URL in result");
    }

    const res = await fetch(video.url);
    if (!res.ok) {
      throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const outFile = `${task.key}-audio.mp4`;
    await fs.writeFile(path.join(outDir, outFile), bytes);

    rec.status = "completed";
    rec.file = outFile;
    rec.bytes = bytes.length;
    rec.completedAt = new Date().toISOString();
    process.stdout.write(`[${task.key}] completed -> ${path.join(outDir, outFile)}\n`);
  } catch (err) {
    rec.status = "failed";
    rec.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    rec.completedAt = new Date().toISOString();
    process.stdout.write(`[${task.key}] failed: ${rec.error}\n`);
  }

  await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

console.log(`OUT_DIR=${outDir}`);
