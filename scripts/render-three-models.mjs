import { fal } from "@fal-ai/client";
import { promises as fs } from "node:fs";
import path from "node:path";

const JOB_ID = process.env.JOB_ID || "1778245596338-bec0688b";
const cwd = process.cwd();
const jobPath = path.join(cwd, "generated-sora-studio", JOB_ID, "job.json");
const job = JSON.parse(await fs.readFile(jobPath, "utf8"));
const prompt = job.soraPrompt;
const aspectRatio = (job.input?.renderAspectRatio === "16:9" ? "16:9" : "9:16");
const reqDuration = Number(job.input?.requestDurationSeconds || 20);

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(cwd, "generated-sora-studio-model-comparison", `${JOB_ID}-${ts}`);
await fs.mkdir(outDir, { recursive: true });

const manifest = {
  createdAt: new Date().toISOString(),
  sourceJobId: JOB_ID,
  sourceInput: job.input,
  sourceWarnings: job.warnings ?? [],
  models: []
};

await fs.writeFile(path.join(outDir, "prompt.txt"), `${prompt}\n`, "utf8");

function clampDuration(modelKey, requested) {
  if (modelKey === "sora2") {
    const allowed = [4, 8, 12, 16, 20];
    let best = allowed[0];
    let bestDiff = Math.abs(requested - best);
    for (const a of allowed) {
      const d = Math.abs(requested - a);
      if (d < bestDiff) {
        best = a;
        bestDiff = d;
      }
    }
    return { inputDuration: best, note: `Sora2 duration mapped from ${requested}s to ${best}s (allowed: 4/8/12/16/20).` };
  }

  if (modelKey === "seedance2") {
    const clamped = Math.max(4, Math.min(15, requested));
    return { inputDuration: String(clamped), note: `Seedance2 duration mapped from ${requested}s to ${clamped}s (allowed: 4-15).` };
  }

  if (modelKey === "klingv3") {
    const clamped = Math.max(3, Math.min(15, requested));
    return { inputDuration: String(clamped), note: `KlingV3 duration mapped from ${requested}s to ${clamped}s (allowed: 3-15).` };
  }

  return { inputDuration: requested, note: "No mapping." };
}

const tasks = [
  {
    key: "sora2",
    endpoint: "fal-ai/sora-2/text-to-video/pro",
    buildInput: () => {
      const d = clampDuration("sora2", reqDuration);
      return {
        input: {
          prompt,
          resolution: "1080p",
          aspect_ratio: aspectRatio,
          duration: d.inputDuration,
          delete_video: true
        },
        note: d.note
      };
    }
  },
  {
    key: "seedance2",
    endpoint: "bytedance/seedance-2.0/text-to-video",
    buildInput: () => {
      const d = clampDuration("seedance2", reqDuration);
      return {
        input: {
          prompt,
          resolution: "720p",
          aspect_ratio: aspectRatio,
          duration: d.inputDuration,
          generate_audio: false
        },
        note: d.note
      };
    }
  },
  {
    key: "klingv3",
    endpoint: "fal-ai/kling-video/v3/pro/text-to-video",
    buildInput: () => {
      const d = clampDuration("klingv3", reqDuration);
      return {
        input: {
          prompt,
          aspect_ratio: aspectRatio,
          duration: d.inputDuration,
          generate_audio: false,
          shot_type: "customize"
        },
        note: d.note
      };
    }
  }
];

function getVideoUrl(data) {
  if (!data || typeof data !== "object") return undefined;
  if (data.video && typeof data.video === "object" && typeof data.video.url === "string") return data.video.url;
  if (Array.isArray(data.videos)) {
    for (const v of data.videos) {
      if (v && typeof v === "object" && typeof v.url === "string") return v.url;
    }
  }
  if (data.output && typeof data.output === "object" && data.output.video && typeof data.output.video === "object") {
    if (typeof data.output.video.url === "string") return data.output.video.url;
  }
  return undefined;
}

async function download(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Download failed ${res.status}: ${txt.slice(0, 400)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
  return buf.length;
}

for (const task of tasks) {
  const startedAt = new Date().toISOString();
  const rec = {
    key: task.key,
    endpoint: task.endpoint,
    startedAt,
    status: "running"
  };
  manifest.models.push(rec);
  await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  try {
    const { input, note } = task.buildInput();
    rec.durationMapping = note;
    rec.input = input;

    const result = await fal.subscribe(task.endpoint, {
      input,
      mode: "polling",
      pollInterval: 6000,
      logs: true,
      onQueueUpdate(update) {
        const status = (update?.status || "").toString();
        process.stdout.write(`[${task.key}] queue: ${status}\n`);
      }
    });

    const requestId = result?.requestId;
    const data = result?.data;
    const url = getVideoUrl(data);

    rec.requestId = requestId;
    rec.dataPreview = data;
    rec.videoUrl = url;

    if (!url) {
      throw new Error("No video URL in response.");
    }

    const fileName = `${task.key}.mp4`;
    const filePath = path.join(outDir, fileName);
    const bytes = await download(url, filePath);

    rec.fileName = fileName;
    rec.bytes = bytes;
    rec.status = "completed";
    rec.completedAt = new Date().toISOString();
    process.stdout.write(`[${task.key}] completed -> ${filePath} (${bytes} bytes)\n`);
  } catch (err) {
    rec.status = "failed";
    rec.completedAt = new Date().toISOString();
    rec.error = err instanceof Error ? err.message : String(err);
    process.stdout.write(`[${task.key}] failed: ${rec.error}\n`);
  }

  await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`OUT_DIR=${outDir}`);
