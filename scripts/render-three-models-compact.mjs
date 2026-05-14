import { fal } from "@fal-ai/client";
import { promises as fs } from "node:fs";
import path from "node:path";

const JOB_ID = process.env.JOB_ID || "1778245596338-bec0688b";
const cwd = process.cwd();
const jobPath = path.join(cwd, "generated-sora-studio", JOB_ID, "job.json");
const job = JSON.parse(await fs.readFile(jobPath, "utf8"));

const MAX_PROMPT_CHARS = Number(process.env.FAL_SORA_MAX_PROMPT_CHARS || 2400);

function trimToMaxChars(value, maxChars) {
  if (value.length <= maxChars) return value;
  const head = value.slice(0, maxChars).trim();
  const byLine = head.lastIndexOf("\n");
  if (byLine > Math.floor(maxChars * 0.6)) return head.slice(0, byLine).trim();
  return head;
}

function compactSoraPromptForRender(prompt) {
  const lines = prompt
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const result = [];
  let currentSection = "";
  let sceneCount = 0;

  for (const line of lines) {
    if (/^[A-I]\)\s+/i.test(line)) {
      currentSection = line.toUpperCase();
      if (
        /^A\)\s+VIDEO OVERVIEW/i.test(line) ||
        /^B\)\s+PROTAGONIST/i.test(line) ||
        /^C\)\s+SCENE BREAKDOWN/i.test(line) ||
        /^I\)\s+ACTION REALISM/i.test(line)
      ) {
        result.push(line);
      }
      continue;
    }

    if (/^SCENE\s+\d+/i.test(line) || /^SHOT\s+\d+/i.test(line)) {
      sceneCount += 1;
      if (sceneCount <= 8) {
        result.push(line);
      }
      continue;
    }

    if (sceneCount > 0 && sceneCount <= 8 && /^-\s*(Subject|Action|Setting|Camera|Lighting & Color|Audio|Dialogue\/VO):/i.test(line)) {
      result.push(line);
      continue;
    }

    if (
      /^-\s*(Indian faces only|No subtitles|Maintain single protagonist continuity|Hindi word|Action realism lock|Object interaction lock|Beverage interaction lock|Door interaction lock|Camera blocking lock|Edit lock|Visual style lock|If the brief is silent on palette)/i.test(
        line
      )
    ) {
      result.push(line);
      continue;
    }

    if (/^A\)\s+VIDEO OVERVIEW/i.test(currentSection) && line.startsWith("-")) {
      result.push(line);
      continue;
    }

    if (/^B\)\s+PROTAGONIST/i.test(currentSection) && line.startsWith("-")) {
      result.push(line);
      continue;
    }
  }

  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const rawPrompt = job.soraPrompt;
const compactPrompt = trimToMaxChars(compactSoraPromptForRender(rawPrompt), MAX_PROMPT_CHARS);
const prompt = compactPrompt.length >= 400 ? compactPrompt : trimToMaxChars(rawPrompt, MAX_PROMPT_CHARS);

const aspectRatio = job.input?.renderAspectRatio === "16:9" ? "16:9" : "9:16";
const reqDuration = Number(job.input?.requestDurationSeconds || 20);

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(cwd, "generated-sora-studio-model-comparison", `${JOB_ID}-compact-${ts}`);
await fs.mkdir(outDir, { recursive: true });

const manifest = {
  createdAt: new Date().toISOString(),
  sourceJobId: JOB_ID,
  promptChars: { raw: rawPrompt.length, compact: compactPrompt.length, used: prompt.length },
  models: []
};

await fs.writeFile(path.join(outDir, "prompt-used.txt"), `${prompt}\n`, "utf8");

function mapDuration(model, requested) {
  if (model === "sora2") return 20;
  if (model === "seedance2") return "15";
  if (model === "klingv3") return "15";
  return requested;
}

const tasks = [
  {
    key: "sora2",
    endpoint: "fal-ai/sora-2/text-to-video/pro",
    input: {
      prompt,
      resolution: "1080p",
      aspect_ratio: aspectRatio,
      duration: mapDuration("sora2", reqDuration),
      delete_video: false
    }
  },
  {
    key: "seedance2",
    endpoint: "bytedance/seedance-2.0/text-to-video",
    input: {
      prompt,
      resolution: "720p",
      aspect_ratio: aspectRatio,
      duration: mapDuration("seedance2", reqDuration),
      generate_audio: false
    }
  },
  {
    key: "klingv3",
    endpoint: "fal-ai/kling-video/v3/pro/text-to-video",
    input: {
      prompt,
      aspect_ratio: aspectRatio,
      duration: mapDuration("klingv3", reqDuration),
      generate_audio: false,
      shot_type: "customize"
    }
  }
];

for (const task of tasks) {
  const rec = { key: task.key, endpoint: task.endpoint, input: task.input, startedAt: new Date().toISOString(), status: "running" };
  manifest.models.push(rec);
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
    rec.status = "completed";

    const video = result?.data?.video;
    if (video?.file_data) {
      const outPath = path.join(outDir, `${task.key}.mp4`);
      const bytes = Buffer.from(video.file_data, "base64");
      await fs.writeFile(outPath, bytes);
      rec.file = `${task.key}.mp4`;
      rec.bytes = bytes.length;
      process.stdout.write(`[${task.key}] completed(file_data) -> ${outPath}\n`);
    } else if (video?.url) {
      const outPath = path.join(outDir, `${task.key}.mp4`);
      const res = await fetch(video.url);
      if (!res.ok) throw new Error(`download ${res.status} ${res.statusText}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(outPath, bytes);
      rec.file = `${task.key}.mp4`;
      rec.bytes = bytes.length;
      process.stdout.write(`[${task.key}] completed(url) -> ${outPath}\n`);
    } else {
      rec.status = "failed";
      rec.error = "No video payload";
      process.stdout.write(`[${task.key}] failed: No video payload\n`);
    }
  } catch (err) {
    rec.status = "failed";
    rec.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    process.stdout.write(`[${task.key}] failed: ${rec.error}\n`);
    process.stdout.write(`[${task.key}] error_json: ${JSON.stringify(err, Object.getOwnPropertyNames(err))}\n`);
  }

  rec.completedAt = new Date().toISOString();
  await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

console.log(`OUT_DIR=${outDir}`);
