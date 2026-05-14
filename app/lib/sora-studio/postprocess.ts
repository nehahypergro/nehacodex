import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { SoraStudioRenderPostProcess, SoraStudioResolvedInputRow } from "./types";

const LOCAL_FFMPEG_CANDIDATE = path.join(
  process.cwd(),
  "node_modules",
  "ffmpeg-static",
  process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"
);
const LOCAL_FFPROBE_CANDIDATE = path.join(
  process.cwd(),
  "node_modules",
  "ffprobe-static",
  "bin",
  process.platform,
  process.arch,
  process.platform === "win32" ? "ffprobe.exe" : "ffprobe"
);

const FFMPEG_BIN =
  process.env.SORA_STUDIO_FFMPEG_BIN?.trim() ||
  process.env.FFMPEG_BIN?.trim() ||
  (existsSync(LOCAL_FFMPEG_CANDIDATE) ? LOCAL_FFMPEG_CANDIDATE : "ffmpeg");
const FFPROBE_BIN =
  process.env.SORA_STUDIO_FFPROBE_BIN?.trim() ||
  process.env.FFPROBE_BIN?.trim() ||
  (existsSync(LOCAL_FFPROBE_CANDIDATE) ? LOCAL_FFPROBE_CANDIDATE : "ffprobe");

const BRANDING_ENABLED = process.env.SORA_STUDIO_BRANDING?.trim().toLowerCase() !== "false";
const WARN_MISSING_LOGO = process.env.SORA_STUDIO_BRANDING_WARN_MISSING_LOGO?.trim().toLowerCase() === "true";

interface ProductBrandingProfile {
  key: string;
  label: string;
  patterns: RegExp[];
}

interface MediaProbe {
  width: number;
  height: number;
  durationSeconds: number;
  hasAudio: boolean;
}

interface ResolvedBranding {
  profileKey: string;
  profileLabel: string;
  logoPath?: string;
  endSlatePath?: string;
  warnings: string[];
}

export interface SoraStudioPostProcessResult {
  bytes: Buffer;
  postProcess: SoraStudioRenderPostProcess;
  warnings: string[];
}

const PRODUCT_BRANDING_PROFILES: ProductBrandingProfile[] = [
  {
    key: "air_plus",
    label: "Kotak Air / Air Plus",
    patterns: [
      /\bair\s*(?:plus|credit|card)\b/i,
      /\bairplus\b/i,
      /\bcomplimentary\s+flight\b/i,
      /\bunbox\b/i,
      /\btravel\s+(?:card|privileges?|bookings?|spend|film)\b/i
    ]
  },
  {
    key: "cashback",
    label: "Kotak Cashback",
    patterns: [/\bcash\s*back\b/i, /\bcashback\b/i, /\b5\s*%\s*cashback\b/i]
  },
  {
    key: "solitaire",
    label: "Kotak Solitaire",
    patterns: [/\bsolitaire\b/i]
  },
  {
    key: "privy_business",
    label: "Privy Business",
    patterns: [/\bprivy\s+business\b/i]
  },
  {
    key: "home_loan",
    label: "Kotak Home Loans",
    patterns: [/\bhome\s+loans?\b/i, /\bhousing\s+loans?\b/i, /\bemi\b/i]
  },
  {
    key: "personal_loan",
    label: "Kotak Personal Loan",
    patterns: [/\bpersonal\s+loans?\b/i]
  },
  {
    key: "business_loan",
    label: "Kotak Business Loan",
    patterns: [/\bbusiness\s+loans?\b/i, /\bpre[-\s]?approved\s+business\s+loans?\b/i]
  },
  {
    key: "working_capital",
    label: "Kotak Working Capital",
    patterns: [/\bworking\s+capital\b/i, /\bsolar\s+funding\b/i, /\bhealthcare\s+finance\b/i]
  },
  {
    key: "tax_payment",
    label: "Kotak Tax Payments",
    patterns: [/\btax\s+payments?\b/i, /\badvance\s+tax\b/i, /\bself[-\s]?assessment\s+tax\b/i]
  },
  {
    key: "pos",
    label: "Kotak POS",
    patterns: [/\bpos\b/i, /\bpoint\s+of\s+sale\b/i]
  }
];

function compact(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeEnvToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
}

function resolvePathCandidate(value: string | undefined): string | undefined {
  const trimmed = compact(value);
  if (!trimmed) {
    return undefined;
  }
  const candidate = path.isAbsolute(trimmed) ? trimmed : path.join(process.cwd(), trimmed);
  return existsSync(candidate) ? candidate : undefined;
}

function firstExisting(candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    const resolved = resolvePathCandidate(candidate);
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}

function extensionCandidates(stem: string): string[] {
  return [".png", ".jpg", ".jpeg", ".webp"].map((extension) => `${stem}${extension}`);
}

function resolveBrandingProfile(input: SoraStudioResolvedInputRow): ProductBrandingProfile {
  const haystack = [
    input.product,
    input.brief,
    input.businessObjective,
    input.creativeObjectiveFunnel
  ]
    .map(compact)
    .join(" ");

  return PRODUCT_BRANDING_PROFILES.find((profile) => profile.patterns.some((pattern) => pattern.test(haystack))) ?? {
    key: "generic",
    label: "Kotak Mahindra Bank",
    patterns: []
  };
}

function resolveEndSlatePath(profileKey: string, renderAspectRatio: SoraStudioResolvedInputRow["renderAspectRatio"]): string | undefined {
  const envKey = normalizeEnvToken(profileKey);
  const ratioToken = renderAspectRatio.replace(":", "x");
  const aspectSpecificEnv =
    process.env[`SORA_STUDIO_${envKey}_${ratioToken.toUpperCase()}_END_SLATE_PATH`] ||
    process.env[`SORA_STUDIO_${envKey}_END_SLATE_PATH`];
  const defaultEnv = process.env.SORA_STUDIO_DEFAULT_END_SLATE_PATH;

  const builtInByProfile: Record<string, string[]> = {
    air_plus:
      renderAspectRatio === "16:9"
        ? [path.join("assets", "end-slate-air-plus-16x9.mp4"), path.join("assets", "end-slate-air-plus.mp4")]
        : [path.join("assets", "end-slate-air-plus.mp4")],
    cashback: [path.join("assets", "end-slate-cashback.mp4")],
    generic: [path.join("assets", "end-slate.mp4")]
  };

  return firstExisting([
    aspectSpecificEnv,
    path.join("assets", "end-slates", `${profileKey}-${ratioToken}.mp4`),
    path.join("assets", "end-slates", `${profileKey}.mp4`),
    ...(builtInByProfile[profileKey] ?? []),
    defaultEnv,
    ...(builtInByProfile.generic ?? [])
  ]);
}

function resolveLogoPath(profileKey: string): string | undefined {
  const envKey = normalizeEnvToken(profileKey);
  const envLogo = process.env[`SORA_STUDIO_${envKey}_LOGO_PATH`];
  const defaultLogo = process.env.SORA_STUDIO_DEFAULT_LOGO_PATH;

  return firstExisting([
    envLogo,
    ...extensionCandidates(path.join("assets", "product-logos", profileKey)),
    ...extensionCandidates(path.join("assets", "brand-logos", profileKey)),
    ...extensionCandidates(path.join("assets", `logo-${profileKey}`)),
    defaultLogo,
    ...extensionCandidates(path.join("assets", "product-logos", "generic")),
    ...extensionCandidates(path.join("assets", "brand-logos", "generic")),
    ...extensionCandidates(path.join("assets", "logo"))
  ]);
}

function resolveBranding(input: SoraStudioResolvedInputRow): ResolvedBranding {
  const profile = resolveBrandingProfile(input);
  const warnings: string[] = [];
  const endSlatePath = resolveEndSlatePath(profile.key, input.renderAspectRatio);
  const logoPath = resolveLogoPath(profile.key);

  if (!endSlatePath) {
    warnings.push(`No end slate found for ${profile.label}; kept generated video without a slate.`);
  }
  if (!logoPath && WARN_MISSING_LOGO) {
    warnings.push(`No logo found for ${profile.label}; skipped logo overlay.`);
  }

  return {
    profileKey: profile.key,
    profileLabel: profile.label,
    logoPath,
    endSlatePath,
    warnings
  };
}

function runProcessResult(command: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function runProcess(command: string, args: string[], errorPrefix: string): Promise<string> {
  const result = await runProcessResult(command, args).catch((error) => {
    throw new Error(`${errorPrefix}: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (result.code === 0) {
    return result.stdout;
  }
  throw new Error(`${errorPrefix}: ${result.stderr.trim() || `exit code ${result.code ?? "unknown"}`}`);
}

function parseDurationFromFfmpeg(value: string): number {
  const match = value.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  if (!match) {
    return 0.1;
  }
  const hours = Number.parseInt(match[1] ?? "0", 10);
  const minutes = Number.parseInt(match[2] ?? "0", 10);
  const seconds = Number.parseFloat(match[3] ?? "0");
  const total = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) && total > 0 ? total : 0.1;
}

function parseProbeFromFfmpeg(stderr: string): MediaProbe {
  const videoMatch = stderr.match(/Stream\s+#\d+:\d+[^:\n]*:\s*Video:[^\n]*?,\s*(\d{2,5})x(\d{2,5})(?:[\s,]|$)/i);
  return {
    width: videoMatch ? Number.parseInt(videoMatch[1] ?? "0", 10) : 0,
    height: videoMatch ? Number.parseInt(videoMatch[2] ?? "0", 10) : 0,
    durationSeconds: parseDurationFromFfmpeg(stderr),
    hasAudio: /Stream\s+#\d+:\d+[^:\n]*:\s*Audio:/i.test(stderr)
  };
}

async function probeMediaWithFfmpeg(filePath: string): Promise<MediaProbe> {
  const result = await runProcessResult(FFMPEG_BIN, ["-hide_banner", "-i", filePath]).catch((error) => {
    throw new Error(`ffmpeg probe failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  return parseProbeFromFfmpeg(result.stderr);
}

async function probeMedia(filePath: string): Promise<MediaProbe> {
  let raw: string;
  try {
    raw = await runProcess(
      FFPROBE_BIN,
      ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath],
      "ffprobe failed"
    );
  } catch {
    return probeMediaWithFfmpeg(filePath);
  }
  const parsed = JSON.parse(raw) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
    format?: { duration?: string };
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const audio = parsed.streams?.some((stream) => stream.codec_type === "audio") ?? false;
  const durationRaw = Number.parseFloat(parsed.format?.duration ?? video?.duration ?? "");
  return {
    width: typeof video?.width === "number" ? video.width : 0,
    height: typeof video?.height === "number" ? video.height : 0,
    durationSeconds: Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 0.1,
    hasAudio: audio
  };
}

function even(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function targetFrame(input: MediaProbe, aspectRatio: SoraStudioResolvedInputRow["renderAspectRatio"]): { width: number; height: number } {
  if (input.width > 0 && input.height > 0) {
    return { width: even(input.width), height: even(input.height) };
  }
  return aspectRatio === "16:9" ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
}

function audioFilter(inputIndex: number, outputLabel: string, probe: MediaProbe): string {
  if (probe.hasAudio) {
    return `[${inputIndex}:a]aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[${outputLabel}]`;
  }
  return `anullsrc=r=48000:cl=stereo,atrim=duration=${probe.durationSeconds.toFixed(3)},asetpts=PTS-STARTPTS[${outputLabel}]`;
}

function buildBaseVideoFilter(inputIndex: number, width: number, height: number, outputLabel: string, format = "yuv420p"): string {
  return `[${inputIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=${format}[${outputLabel}]`;
}

function encodeArgs(outputPath: string): string[] {
  return [
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    outputPath
  ];
}

async function renderLogoOnly(params: {
  inputPath: string;
  outputPath: string;
  logoPath: string;
  frame: { width: number; height: number };
}): Promise<void> {
  const margin = Math.max(24, Math.round(params.frame.width * 0.04));
  const logoWidth = even(Math.max(92, Math.min(260, params.frame.width * (params.frame.width > params.frame.height ? 0.12 : 0.18))));
  const filters = [
    buildBaseVideoFilter(0, params.frame.width, params.frame.height, "base", "rgba"),
    `[1:v]scale=${logoWidth}:-1,format=rgba[logo]`,
    `[base][logo]overlay=x=main_w-overlay_w-${margin}:y=${margin}:format=auto:shortest=1,format=yuv420p[v]`,
    audioFilter(0, "a", await probeMedia(params.inputPath))
  ];

  await runProcess(
    FFMPEG_BIN,
    [
      "-y",
      "-i",
      params.inputPath,
      "-loop",
      "1",
      "-i",
      params.logoPath,
      "-filter_complex",
      filters.join(";"),
      ...encodeArgs(params.outputPath)
    ],
    "ffmpeg logo overlay failed"
  );
}

async function renderSlateAndLogo(params: {
  inputPath: string;
  outputPath: string;
  endSlatePath: string;
  logoPath?: string;
  frame: { width: number; height: number };
  inputProbe: MediaProbe;
  slateProbe: MediaProbe;
}): Promise<void> {
  const margin = Math.max(24, Math.round(params.frame.width * 0.04));
  const logoWidth = even(Math.max(92, Math.min(260, params.frame.width * (params.frame.width > params.frame.height ? 0.12 : 0.18))));
  const filters = [buildBaseVideoFilter(0, params.frame.width, params.frame.height, "base0", params.logoPath ? "rgba" : "yuv420p")];

  if (params.logoPath) {
    filters.push(`[2:v]scale=${logoWidth}:-1,format=rgba[logo]`);
    filters.push(`[base0][logo]overlay=x=main_w-overlay_w-${margin}:y=${margin}:format=auto:shortest=1,format=yuv420p[v0]`);
  } else {
    filters.push("[base0]format=yuv420p[v0]");
  }

  filters.push(buildBaseVideoFilter(1, params.frame.width, params.frame.height, "v1"));
  filters.push(audioFilter(0, "a0", params.inputProbe));
  filters.push(audioFilter(1, "a1", params.slateProbe));
  filters.push("[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]");

  const args = ["-y", "-i", params.inputPath, "-i", params.endSlatePath];
  if (params.logoPath) {
    args.push("-loop", "1", "-i", params.logoPath);
  }
  args.push("-filter_complex", filters.join(";"), ...encodeArgs(params.outputPath));

  await runProcess(FFMPEG_BIN, args, "ffmpeg brand post-processing failed");
}

function buildTempOutputPath(outputPath: string): string {
  const parsed = path.parse(outputPath);
  const digest = createHash("sha256").update(`${outputPath}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 8);
  return path.join(parsed.dir, `${parsed.name}.brand-${digest}${parsed.ext}`);
}

export async function applySoraStudioProductBranding(params: {
  input: SoraStudioResolvedInputRow;
  inputPath: string;
  outputPath: string;
  rawAssetFile: string;
  outputAssetFile: string;
}): Promise<SoraStudioPostProcessResult> {
  const branding = resolveBranding(params.input);
  const warnings = [...branding.warnings];
  const basePostProcess: SoraStudioRenderPostProcess = {
    applied: false,
    profileKey: branding.profileKey,
    profileLabel: branding.profileLabel,
    rawAssetFile: params.rawAssetFile,
    outputAssetFile: params.outputAssetFile,
    logoFile: branding.logoPath ? path.basename(branding.logoPath) : undefined,
    endSlateFile: branding.endSlatePath ? path.basename(branding.endSlatePath) : undefined
  };

  if (!BRANDING_ENABLED || (!branding.logoPath && !branding.endSlatePath)) {
    await fs.copyFile(params.inputPath, params.outputPath);
    const bytes = await fs.readFile(params.outputPath);
    const disabledWarning = BRANDING_ENABLED ? undefined : "Product branding is disabled.";
    const nextWarnings = disabledWarning ? [...warnings, disabledWarning] : warnings;
    return {
      bytes,
      warnings: nextWarnings,
      postProcess: {
        ...basePostProcess,
        warnings: nextWarnings.length > 0 ? nextWarnings : undefined
      }
    };
  }

  const tempOutputPath = buildTempOutputPath(params.outputPath);
  try {
    const inputProbe = await probeMedia(params.inputPath);
    const frame = targetFrame(inputProbe, params.input.renderAspectRatio);

    if (branding.endSlatePath) {
      const slateProbe = await probeMedia(branding.endSlatePath);
      await renderSlateAndLogo({
        inputPath: params.inputPath,
        outputPath: tempOutputPath,
        endSlatePath: branding.endSlatePath,
        logoPath: branding.logoPath,
        frame,
        inputProbe,
        slateProbe
      });
    } else if (branding.logoPath) {
      await renderLogoOnly({
        inputPath: params.inputPath,
        outputPath: tempOutputPath,
        logoPath: branding.logoPath,
        frame
      });
    }

    await fs.rename(tempOutputPath, params.outputPath);
    const bytes = await fs.readFile(params.outputPath);
    return {
      bytes,
      warnings,
      postProcess: {
        ...basePostProcess,
        applied: Boolean(branding.logoPath || branding.endSlatePath),
        warnings: warnings.length > 0 ? warnings : undefined
      }
    };
  } catch (error) {
    await fs.unlink(tempOutputPath).catch(() => undefined);
    await fs.copyFile(params.inputPath, params.outputPath);
    const bytes = await fs.readFile(params.outputPath);
    const fallbackWarning = `Brand post-processing failed; kept unbranded generated video. ${
      error instanceof Error ? error.message : String(error)
    }`;
    const nextWarnings = [...warnings, fallbackWarning];
    return {
      bytes,
      warnings: nextWarnings,
      postProcess: {
        ...basePostProcess,
        warnings: nextWarnings
      }
    };
  }
}
