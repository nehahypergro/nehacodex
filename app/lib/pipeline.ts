import { existsSync, promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { fal } from "@fal-ai/client";
import { GoogleGenAI } from "@google/genai";
import type { GenerateVideosConfig } from "@google/genai";
import { z } from "zod";
import { getJob, getJobDir, listJobs, mutateJob, setJobStatus, updateStep } from "./jobs";
import { maybeSendJobReply } from "./gmail";
import { META_FORMAT, PRODUCT_SPECS } from "./spec";
import { resolveSuper1Text, SUPER1_FONT_FILE } from "./supers";
import {
  Backstory,
  DEFAULT_PROMPT_WRITER_VERSION,
  DEFAULT_VIDEO_CONFIG,
  HowToConfig,
  isBumperVideoType,
  JobRecord,
  ProductKey,
  PromptWriterVersion,
  SupersConfig,
  SupersTriggerRule,
  VideoConfig,
  VideoProvider,
  VideoType
} from "./types";

const DEFAULT_TEXT_MODEL = "gemini-3.1-pro-preview";
const DEFAULT_QC_MODEL = "gemini-2.5-pro";
const DEFAULT_IMAGE_MODEL = "imagen-4.0-generate-001";
const DEFAULT_VEO_IMAGE_VIDEO_MODEL = "veo-3.1-generate-preview";
const DEFAULT_VEO_TEXT_VIDEO_MODEL = "veo-3.1-generate-001";
const DEFAULT_SORA_MODEL = "sora-2-pro";
const DEFAULT_SORA_PROMPT_WRITER_MODEL = "gemini-3-pro-preview";
const DEFAULT_SORA_PROMPT_WRITER_FALLBACK_MODEL = "gemini-2.5-pro";
const DEFAULT_FAL_VEO_TEXT_MODEL = "fal-ai/veo3.1";
const DEFAULT_FAL_VEO_IMAGE_MODEL = "fal-ai/veo3.1/image-to-video";
const DEFAULT_FAL_IMAGE_MODEL = "fal-ai/gpt-image-1.5";
const DEFAULT_FAL_SORA_TEXT_MODEL = "fal-ai/sora-2/text-to-video/pro";
const DEFAULT_FAL_TOPAZ_VIDEO_MODEL = "fal-ai/topaz/upscale/video";
const DEFAULT_KLING_TEXT_MODEL = "fal-ai/kling-video/v3/pro/text-to-video";
const DEFAULT_LOGIC_FALLBACK_MODELS = ["gemini-2.5-pro", "gemini-3-flash-preview"] as const;
const DEFAULT_QC_FALLBACK_MODELS = ["gemini-2.5-pro", "gemini-3-flash-preview"] as const;
type SupportedAspectRatio = "9:16" | "1:1" | "16:9";
interface FrameSpec {
  aspectRatio: SupportedAspectRatio;
  width: number;
  height: number;
}
const PRIMARY_FRAME_SPEC: FrameSpec = { aspectRatio: "9:16", width: 1080, height: 1920 };
const SQUARE_FRAME_SPEC: FrameSpec = { aspectRatio: "1:1", width: 1080, height: 1080 };
const LANDSCAPE_FRAME_SPEC: FrameSpec = { aspectRatio: "16:9", width: 1920, height: 1080 };
const FOUR_THREE_FRAME_SPEC = { width: 1440, height: 1080 } as const;
const KEYFRAME_WIDTH = 1080;
const KEYFRAME_HEIGHT = 1920;
const DEVICE_PATTERN =
  /\b(phone|smartphone|mobile|cellphone|laptop|tablet|ipad|monitor|screen|display|tv|television|smartwatch|watch|ui|interface|credit\s*card|debit\s*card|payment\s*card|card\s*mockup|physical\s*card)\b/i;
const TERMINAL_CODE_PATTERN = /\b(?:t[1-9]|terminal\s*[1-9]?)\b/i;
const AIRPORT_CURBSIDE_PATTERN = /\b(airport|terminal|departure|arrivals?|curbside|drop[-\s]?off)\b/i;
const SWEAT_SPOT_PATTERN =
  /\b(sweat|sweaty|perspiration|perspiring|damp(?:\s*patch(?:es)?)?|sweat[-\s]?spots?|underarm\s*marks?)\b/i;
const WRINKLED_CLOTHES_PATTERN = /\b(wrinkle[sd]?|wrinkled|crease[sd]?|creased|crumpled|rumpled)\b/i;
const WARDROBE_CLEAN_FALLBACK = "Well-ironed, wrinkle-free, clean attire aligned to persona and setting.";
const BACKSTORY_FACIAL_FEATURES_FALLBACK =
  "Distinctive Indian facial structure with natural skin texture, defined brows, a believable nose bridge, lived-in lips, a softly structured jawline, and visible cheek character.";
const BACKSTORY_HAIRSTYLE_GROOMING_FALLBACK =
  "Natural, well-kept hairstyle with believable grooming, slight real-world texture, and no overly polished influencer finish.";
const BACKSTORY_WARDROBE_DETAILS_FALLBACK =
  "Premium, well-fitted wardrobe with clear fabric texture, realistic layering, and polished but believable styling.";
const BACKSTORY_POSTURE_BODY_LANGUAGE_FALLBACK =
  "Relaxed upright posture with easy weight shifts, dropped shoulders, natural breathing, and one restrained conversational gesture on emphasis.";
const BACKSTORY_EXPRESSION_STYLE_FALLBACK =
  "Expressive but controlled face with active eyes, subtle brow response, small smile shifts, and emotionally specific micro-reactions that track the spoken line.";
const BACKSTORY_SPEAKING_ENERGY_FALLBACK =
  "Confident, enthusiastic, advertisement-style delivery.";
const BACKSTORY_SPEAKING_STYLE_LOCK = [
  "Confident delivery",
  "Enthusiastic delivery",
  "Advertisement-style delivery"
] as const;
const FIXED_AD_DELIVERY_DESCRIPTOR = "Confident, enthusiastic, advertisement-style";
const BACKSTORY_BODY_BUILD_FALLBACK =
  "Believable adult body build with natural proportions, not exaggerated or hyper-stylized.";
const SETTING_STOPWORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "showing",
  "visible",
  "where",
  "that",
  "this",
  "there"
]);
const SETTING_SIMILARITY_THRESHOLD = 0.62;
const AIR_PLUS_DISALLOWED_SETTING_PATTERN =
  /\b(railway|train station|station concourse|intercity station|bus terminal|metro rail|metro transfer|platform|rail transfer|heliport|helicopter|palace hotel|heritage palace|resort reception|coastal resort|boutique resort|seafacing resort|waterfront promenade outside a luxury stay|hillside luxury stay|luxury stay terrace)\b/i;
const CASHBACK_DISALLOWED_SETTING_PATTERN =
  /\b(airport|terminal|boarding|lounge|hotel|resort|boutique stay|concierge|valet|travel-day|travel day|heritage|palace|coffee shop|cafe|restaurant|dining out|store aisle|supermarket|checkout lane|mall|boutique lobby|hardware store|home improvement store)\b/i;
const GENAI_MAX_ATTEMPTS = Number(process.env.GENAI_MAX_ATTEMPTS ?? 5);
const GENAI_RETRY_BASE_MS = Number(process.env.GENAI_RETRY_BASE_MS ?? 2000);
const GENAI_HTTP_TIMEOUT_MS = Number(process.env.GENAI_HTTP_TIMEOUT_MS ?? 180000);

const POLL_INTERVAL_MS = Number(process.env.VIDEO_POLL_INTERVAL_MS ?? 10000);
const POLL_MAX_ATTEMPTS = Number(process.env.VIDEO_POLL_MAX_ATTEMPTS ?? 60);
const SUPERS_DEFAULT_HOLD_SECONDS = 1.5;
const SUPERS_EXTRA_HOLD_SECONDS = 0.5;
const SUPERS_MIN_HOLD_SECONDS = 0.6;
const SUPERS_MAX_HOLD_SECONDS = 4;
const SUPERS_FONT_SIZE = 64;
const SUPERS_FONT_SCALE = 0.81;
const SUPERS_MAX_TEXT_CHARS = 25;
const MAX_AUTO_SUPERS_RULES = 8;
const SUPERS_ANIM_IN_SECONDS = 0.2;
const SUPERS_ANIM_OUT_SECONDS = 0.16;
const DEFAULT_END_FREEZE_LAST_FRAME_SECONDS = 0.5;
const DEFAULT_MODEL_END_TRIM_SECONDS = 0.24;
const END_FREEZE_LAST_FRAME_SECONDS = Number(
  process.env.END_FREEZE_LAST_FRAME_SECONDS ??
    process.env.HARD_CUT_TO_BLACK_SECONDS ??
    DEFAULT_END_FREEZE_LAST_FRAME_SECONDS
);
const PRE_END_SLATE_HOLD_SECONDS = Number(process.env.PRE_END_SLATE_HOLD_SECONDS ?? 0.5);
const MODEL_END_TRIM_SECONDS = Number(process.env.MODEL_END_TRIM_SECONDS ?? DEFAULT_MODEL_END_TRIM_SECONDS);
const APPEND_END_SLATE = true;
const VEO_CELEBRITY_FILTER_REGENERATE_ATTEMPTS = Number(process.env.VEO_CELEBRITY_FILTER_REGENERATE_ATTEMPTS ?? 3);
const LOCAL_SOURCE_SANS3_FONT_CANDIDATES = [
  path.join(process.cwd(), "node_modules", "@fontsource", "source-sans-3", "files", "source-sans-3-latin-700-normal.woff"),
  path.join(process.cwd(), "node_modules", "@fontsource", "source-sans-3", "files", "source-sans-3-latin-600-normal.woff"),
  path.join(process.cwd(), "node_modules", "@fontsource", "source-sans-3", "files", "source-sans-3-latin-ext-700-normal.woff")
];
const LOCAL_SOURCE_SANS3_ITALIC_FONT_CANDIDATES = [
  path.join(process.cwd(), "node_modules", "@fontsource", "source-sans-3", "files", "source-sans-3-latin-700-italic.woff"),
  path.join(process.cwd(), "node_modules", "@fontsource", "source-sans-3", "files", "source-sans-3-latin-600-italic.woff"),
  path.join(process.cwd(), "node_modules", "@fontsource", "source-sans-3", "files", "source-sans-3-latin-ext-700-italic.woff")
];
const DEFAULT_SUPERS_FONT_FILE = LOCAL_SOURCE_SANS3_FONT_CANDIDATES.find((candidate) => existsSync(candidate));
const DEFAULT_SUPERS_ITALIC_FONT_FILE = LOCAL_SOURCE_SANS3_ITALIC_FONT_CANDIDATES.find((candidate) => existsSync(candidate));
// Brand lock: always prefer bundled Source Sans files for supers styling.
const SUPERS_FONT_FILE = DEFAULT_SUPERS_FONT_FILE || process.env.SUPERS_FONT_FILE?.trim();
const SUPERS_ITALIC_FONT_FILE = DEFAULT_SUPERS_ITALIC_FONT_FILE || SUPERS_FONT_FILE;
const SUPER1_RENDER_FONT_FILE = SUPER1_FONT_FILE || SUPERS_FONT_FILE;
const SUPER1_MAX_TEXT_WIDTH_RATIO = 0.76;
const SUPER1_VERTICAL_CENTER_RATIO = 0.63;
const SUPER1_MIN_FONT_SIZE = 92;
const SUPER1_MAX_FONT_SIZE = 212;
const SUPER1_INITIAL_FONT_RATIO = 0.172;
const SUPER1_LINE_STEP_RATIO = 1.06;
const SUPER1_FADE_IN_SECONDS = 0.16;
const SUPER1_FADE_OUT_SECONDS = 0.12;
const SUPER1_GRADIENT_START_RATIO = 0.24;
const SUPER1_GRADIENT_END_RATIO = 1.0;
const SUPER1_GRADIENT_POWER = 1.75;
const SUPER1_GRADIENT_MAX_ALPHA = 0.68;
const SUPER1_SQUARE_MAX_TEXT_WIDTH_RATIO = 0.74;
const SUPER1_SQUARE_VERTICAL_CENTER_RATIO = 0.72;
const SUPER1_SQUARE_MIN_FONT_SIZE = 72;
const SUPER1_SQUARE_MAX_FONT_SIZE = 172;
const SUPER1_SQUARE_INITIAL_FONT_RATIO = 0.148;
const SUPER1_SQUARE_LINE_STEP_RATIO = 1.04;
const SUPER1_SQUARE_GRADIENT_START_RATIO = 0.42;
const SUPER1_SQUARE_GRADIENT_END_RATIO = 1.0;
const SUPER1_SQUARE_GRADIENT_POWER = 1.6;
const SUPER1_SQUARE_GRADIENT_MAX_ALPHA = 0.58;
const AIR_PLUS_INLINE_CTA_SUPER_FADE_SECONDS = 0.16;
const AIR_PLUS_INLINE_CTA_BLUR_LUMA_RADIUS = 22;
const AIR_PLUS_INLINE_CTA_BLUR_LUMA_POWER = 6;
const AIR_PLUS_INLINE_CTA_DIM_ALPHA = 0.34;
const AIR_PLUS_INLINE_CTA_FALLBACK_TAIL_SECONDS = 1.35;
const AIR_PLUS_INLINE_CTA_MIN_PANEL_SECONDS = 0.85;
const AIR_PLUS_INLINE_CTA_CARD_NATIVE_WIDTH_RATIO = 1013 / 1080;
const AIR_PLUS_INLINE_CTA_CARD_NATIVE_HEIGHT_RATIO = 639 / 1920;
const AIR_PLUS_INLINE_CTA_CARD_Y_RATIO = 400 / 1920;
const AIR_PLUS_INLINE_CTA_CARD_SCALE = 0.7;
const AIR_PLUS_INLINE_CTA_CARD_WIDTH_RATIO = AIR_PLUS_INLINE_CTA_CARD_NATIVE_WIDTH_RATIO * AIR_PLUS_INLINE_CTA_CARD_SCALE;
const AIR_PLUS_INLINE_CTA_CARD_HEIGHT_RATIO = AIR_PLUS_INLINE_CTA_CARD_NATIVE_HEIGHT_RATIO * AIR_PLUS_INLINE_CTA_CARD_SCALE;
const AIR_PLUS_INLINE_CTA_CARD_APPEAR_SECONDS = 0.24;
const AIR_PLUS_INLINE_CTA_CARD_APPEAR_OFFSET_Y = 28;
const AIR_PLUS_INLINE_CTA_BUTTON_SCALE = 0.9;
const AIR_PLUS_INLINE_CTA_BUTTON_OVERLAY_Y = 20;
const AIR_PLUS_INLINE_CTA_BUTTON_APPEAR_DELAY_SECONDS = 0.08;
const AIR_PLUS_INLINE_CTA_BUTTON_APPEAR_SECONDS = 0.2;
const AIR_PLUS_INLINE_CTA_BUTTON_APPEAR_OFFSET_Y = 18;
const AIR_PLUS_INLINE_CTA_SQUARE_CARD_Y_RATIO = 0.17;
const AIR_PLUS_INLINE_CTA_SQUARE_CARD_SCALE = 0.58;
const AIR_PLUS_INLINE_CTA_SQUARE_CARD_WIDTH_RATIO =
  AIR_PLUS_INLINE_CTA_CARD_NATIVE_WIDTH_RATIO * AIR_PLUS_INLINE_CTA_SQUARE_CARD_SCALE;
const AIR_PLUS_INLINE_CTA_SQUARE_CARD_HEIGHT_RATIO =
  AIR_PLUS_INLINE_CTA_CARD_NATIVE_HEIGHT_RATIO * AIR_PLUS_INLINE_CTA_SQUARE_CARD_SCALE;
const AIR_PLUS_INLINE_CTA_SQUARE_CARD_APPEAR_OFFSET_Y = 22;
const AIR_PLUS_INLINE_CTA_SQUARE_BUTTON_SCALE = 0.78;
const AIR_PLUS_INLINE_CTA_SQUARE_BUTTON_OVERLAY_Y = 8;
const AIR_PLUS_INLINE_CTA_SQUARE_BUTTON_APPEAR_OFFSET_Y = 14;
const LOCAL_FFMPEG_CANDIDATE = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const LOCAL_FFPROBE_CANDIDATE = path.join(
  process.cwd(),
  "node_modules",
  "ffprobe-static",
  "bin",
  process.platform,
  process.arch,
  process.platform === "win32" ? "ffprobe.exe" : "ffprobe"
);
const FFMPEG_BIN = process.env.FFMPEG_BIN?.trim() || (existsSync(LOCAL_FFMPEG_CANDIDATE) ? LOCAL_FFMPEG_CANDIDATE : "ffmpeg");
const FFPROBE_BIN = process.env.FFPROBE_BIN?.trim() || (existsSync(LOCAL_FFPROBE_CANDIDATE) ? LOCAL_FFPROBE_CANDIDATE : "ffprobe");
const FINAL_EXPORT_PRESET = process.env.FINAL_EXPORT_PRESET?.trim() || "slow";
const FINAL_EXPORT_CRF = process.env.FINAL_EXPORT_CRF?.trim() || "14";
const FINAL_EXPORT_MAXRATE = process.env.FINAL_EXPORT_MAXRATE?.trim() || "12M";
const FINAL_EXPORT_BUFSIZE = process.env.FINAL_EXPORT_BUFSIZE?.trim() || "24M";
const FINAL_EXPORT_AUDIO_BITRATE = process.env.FINAL_EXPORT_AUDIO_BITRATE?.trim() || "256k";
const OPENAI_API_BASE = (process.env.OPENAI_API_BASE?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
const SORA_MODEL = process.env.SORA_MODEL?.trim() || DEFAULT_SORA_MODEL;
const SORA_PROMPT_WRITER_MODEL = process.env.SORA_PROMPT_WRITER_MODEL?.trim() || DEFAULT_SORA_PROMPT_WRITER_MODEL;
const SORA_PROMPT_WRITER_FALLBACK_MODEL =
  process.env.SORA_PROMPT_WRITER_FALLBACK_MODEL?.trim() || DEFAULT_SORA_PROMPT_WRITER_FALLBACK_MODEL;
const FAL_IMAGE_MODEL = process.env.FAL_IMAGE_MODEL?.trim() || DEFAULT_FAL_IMAGE_MODEL;
const FAL_SORA_TEXT_MODEL = process.env.FAL_SORA_TEXT_MODEL?.trim() || DEFAULT_FAL_SORA_TEXT_MODEL;
const FAL_SORA_RESOLUTION = (process.env.FAL_SORA_RESOLUTION?.trim() || "1080p") as "720p" | "1080p" | "true_1080p";
const FAL_TOPAZ_VIDEO_MODEL = process.env.FAL_TOPAZ_VIDEO_MODEL?.trim() || DEFAULT_FAL_TOPAZ_VIDEO_MODEL;
type TopazUpscaleMode = "off" | "sora_only" | "all";
const rawTopazUpscaleMode = (process.env.TOPAZ_UPSCALE_MODE ?? "sora_only").trim().toLowerCase();
const TOPAZ_UPSCALE_MODE: TopazUpscaleMode =
  rawTopazUpscaleMode === "off" || rawTopazUpscaleMode === "all" || rawTopazUpscaleMode === "sora_only"
    ? rawTopazUpscaleMode
    : "sora_only";
const rawTopazUpscaleFactor = Number(process.env.TOPAZ_UPSCALE_FACTOR ?? 2);
const TOPAZ_UPSCALE_FACTOR =
  Number.isFinite(rawTopazUpscaleFactor) && rawTopazUpscaleFactor >= 1 && rawTopazUpscaleFactor <= 8
    ? rawTopazUpscaleFactor
    : 2;
const TOPAZ_MODEL = process.env.TOPAZ_MODEL?.trim() || "Proteus";
const TOPAZ_RECOVER_DETAIL = Number(process.env.TOPAZ_RECOVER_DETAIL ?? 0.35);
const TOPAZ_COMPRESSION = Number(process.env.TOPAZ_COMPRESSION ?? 0.12);
const TOPAZ_NOISE = Number(process.env.TOPAZ_NOISE ?? 0.1);
const TOPAZ_HALO = Number(process.env.TOPAZ_HALO ?? 0.08);
const TOPAZ_GRAIN = Number(process.env.TOPAZ_GRAIN ?? 0.03);
const TOPAZ_H264_OUTPUT = !/^(0|false|no)$/i.test((process.env.TOPAZ_H264_OUTPUT ?? "true").trim());
type OpenAiReasoningEffort = "low" | "medium" | "high";
const rawSoraPromptWriterReasoningEffort = (process.env.SORA_PROMPT_WRITER_REASONING_EFFORT ?? "high").trim().toLowerCase();
const SORA_PROMPT_WRITER_REASONING_EFFORT: OpenAiReasoningEffort =
  rawSoraPromptWriterReasoningEffort === "low" ||
  rawSoraPromptWriterReasoningEffort === "medium" ||
  rawSoraPromptWriterReasoningEffort === "high"
    ? rawSoraPromptWriterReasoningEffort
    : "high";
const rawSoraPromptWriterThinkingBudget = Number(process.env.SORA_PROMPT_WRITER_THINKING_BUDGET ?? 2048);
const SORA_PROMPT_WRITER_THINKING_BUDGET =
  Number.isFinite(rawSoraPromptWriterThinkingBudget) && rawSoraPromptWriterThinkingBudget >= 0
    ? Math.max(0, Math.min(8192, Math.round(rawSoraPromptWriterThinkingBudget)))
    : 2048;
const rawSoraPromptWriterMaxOutputTokens = Number(process.env.SORA_PROMPT_WRITER_MAX_OUTPUT_TOKENS ?? 1200);
const SORA_PROMPT_WRITER_MAX_OUTPUT_TOKENS =
  Number.isFinite(rawSoraPromptWriterMaxOutputTokens) && rawSoraPromptWriterMaxOutputTokens > 0
    ? Math.max(256, Math.min(4096, Math.round(rawSoraPromptWriterMaxOutputTokens)))
    : 1200;
const ENABLE_SORA_PROMPT_WRITER = !/^(0|false|no)$/i.test((process.env.ENABLE_SORA_PROMPT_WRITER ?? "true").trim());
const MANDATORY_SORA_PERFORMANCE_NATURALISM_RULE =
  "Performance naturalism and expressive motion: prioritize realistic human behavior throughout the shot. The character should feel naturally present and emotionally engaged, not stiff, frozen, or posed. They should display subtle but believable movement such as blinking, breathing, slight posture shifts, micro-expressions, small head movements, natural mouth motion, and restrained conversational gestures. Let facial response and body emphasis track the words beat by beat rather than holding one fixed look. Use one to three meaningful emphasis beats across the line, such as a brief brow lift, small weight shift, tiny nod, restrained hand release, or slight lean on the key benefit, then let the body settle again. Keep the stance softly asymmetrical with weight not perfectly centered, shoulders relaxed, elbows free, and hands not permanently clasped together. The person should seem like they are genuinely talking to someone behind the camera, not reciting lines from a fixed pose. Avoid mannequin-like stillness, flat affect, rigid shoulders, pinned elbows, frozen hands, pasted-on smiles, dead eyes, overly locked posture, centered hand-clasped presenter poses, repetitive nod loops, repeated hand loops, expressionless speaking, or mechanical delivery.";
const MANDATORY_SORA_HOOK_RULE =
  "Hook rule: the video must begin with a strong visual hook in the first second. Do not open on a neutral centered talking head. Start with a visually arresting moment such as an expressive reaction, purposeful gesture, glance, turn, interruption, movement through space, dynamic environmental detail, or another behavior-first opening suited to the input and allowed by hard safety constraints.";
const MANDATORY_SORA_EXPRESSION_RULE =
  "Expression rule: do not describe emotion only as abstract mood. Translate emotion into visible facial and body behavior. Show progression such as curious to interested, skeptical to convinced, neutral to amused, or thoughtful to reassured, and make the eyes, brows, mouth, and posture visibly respond to the meaning of each spoken beat instead of holding one fixed expression.";
const MANDATORY_SORA_STAGING_RULE =
  "Staging rule: avoid static front-facing monologue staging. Characters should be naturally blocked in space and engaged in a real task, interaction, or movement while speaking. Prefer behavior-first staging over standing and reciting lines. The ad should feel lived-in and behavior-first: people are doing, reacting, moving, and expressing while speaking, not simply reciting lines to camera.";
const SORA_PROMPT_WRITER_MAX_CHARS = 2500;
const SORA_PROMPT_WRITER_SCENE_START = "[SCENE START]";
const SORA_PROMPT_WRITER_SCENE_END = "[SCENE END]";
const LEGACY_SORA_PROMPT_WRITER_SECTION_HEADERS = [
  "Character:",
  "Opening Hook:",
  "Performance:",
  "Staging:",
  "Scene:",
  "Dialogue:",
  "Style and Tone:",
  "Negative Constraints:",
  "Safety Constraints:"
] as const;
const PROMPT1_SYSTEM_PROMPT = `You are an expert Sora 2 Pro prompt writer for premium short-form text-to-video ads.

Your job is to convert each brief into one final Sora-ready prompt written as a cinematic scene block.

The output must feel like a real filmed moment, not a list of instructions.

BACKSTORY IS THE PRIMARY SOURCE OF TRUTH
The backstory is the world bible for the video. Unless the brief explicitly overrides it, derive the character, setting, wardrobe, social class cues, posture, demeanor, emotional tone, likely environment, and lived-in visual details from the backstory. The backstory should determine how this person looks, where they are, how they hold themselves, how they make eye contact, how they move, and what kind of world they naturally belong in.

DO NOT COPY SURFACE DETAILS ACROSS OUTPUTS
Do not repeat the same location, pose, framing, or action pattern from previous prompts. Each output should feel native to this specific backstory. Preserve the premium direct-to-camera essence, but let the surface details change intelligently.

CHARACTER DIFFERENTIATION RULE
Each output must produce a visually distinct person, not a variation of the same ad-model archetype. Use the backstory to derive a unique identity through age, face shape, skin tone, hair texture, hairstyle, body frame, grooming, wardrobe silhouette, posture, and social energy. Avoid the default polished premium-ad look repeating across videos. Give each character one dominant visual signature and one distinct movement quality. Preserve style DNA, but vary identity strongly.

GENDER AND STYLING RULE
Honor the backstory gender presentation exactly in pronouns, body references, and social read. Do not use male pronouns or male-coded action phrasing for women, or female pronouns for men. When the backstory supports a male premium traveler, vary wardrobe silhouettes beyond the default navy-blazer formula by using refined knits, premium shirting, soft travel layering, or tailored separates whenever they fit the setting naturally.

VISUAL PRESENCE RULE
The final scene block must explicitly surface at least one facial, skin-tone, or face-shape detail, at least one hair or grooming detail, at least one wardrobe or body-frame detail, and at least one movement-quality detail drawn from the backstory. Do not collapse identity into generic words like polished, premium, attractive, or well-dressed.

CORE ESSENCE TO PRESERVE
Premium, intimate, direct-to-camera ad energy. Behavior-first opening. Natural eye contact. Polished realism. Clean ending. They should feel like a real person the camera has entered on, not someone waiting to perform.


LOW-HALLUCINATION ACTION RULE
When choosing the opening hook or any performance beat, prefer simple, robust, low-failure human actions that text-to-video models can render reliably. Avoid intricate object manipulation, small prop handling, precise finger choreography, screen interaction, or multi-step actions unless explicitly required by the brief.

HOOK RULE
The first second must open on a visually active moment, not a neutral talking head. The character should already be doing something when the scene begins. Make the opening behavior compelling, but keep it model-safe: prefer simple posture, gaze, and movement hooks over complex prop handling. When in doubt, choose the simpler action.


EXPRESSION AND BODY LANGUAGE RULE
Do not use vague filler like warm, responsive, confident, or premium unless you translate it into visible human behavior. Make the face and body react to the actual spoken line. The eyes, brows, mouth, jaw, shoulders, posture, breathing, and conversational gestures. Each speaking character should feel physically active in a subtle way: speaking, shifting, gesturing, touching an object, reacting, or moving through space.

ACTING BEATS RULE
Convert emotional intent into visible acting beats. Always include readable direction for facial expression, eye behavior, posture, hand movement, one small gesture, and overall body rhythm. Do not describe emotion as internal mood only; express it through visible performance choices the model can render on camera.


CAMERA RULE
Single continuous shot unless specified otherwise. Use a stable frame or a very slight naturalistic camera drift or slow push-in only if it makes the shot feel more alive and premium. No cuts, no montage, no scene changes.

FRAMING RULE
Default to a tight medium close-up shot. Frame the character from mid-chest upward only with full face visibility, and do not show the beltline, lower torso, or a full-body frame unless the brief explicitly requires a wider composition.

LIGHTING RULE
Keep lighting clean and white-balanced with accurate skin tones. Avoid yellow hues, amber contamination, or overly warm color casts unless the brief explicitly asks for them. The overall image should feel like a premium iPhone-shot video: realistic, immediate, and naturally exposed rather than stylized or cinematic in an artificial way.

OPTICAL CLARITY RULE
Keep facial focus sharp with crisp eyes and natural skin texture. No dreamy softness, no hazy diffusion, no beauty-filter skin smoothing, and only minimal natural background blur.

DELIVERY RULE
For every spoken line, include delivery direction covering pace, emphasis, pause behavior, and emotional finish. Make the voice sound conversational, varied, and human, never flat, monotone, or announcer-like. Do not reuse the same generic delivery tag for every line if the script beat changes.

ACCENT RULE
Spoken delivery must sound like natural Indian English with a clear Indian accent suited to the persona and city context. Do not use American, British, or neutralized global-ad accents unless explicitly requested.

EXCLUSIONS
Do not include text, subtitles, captions, logos, readable signs, phones, laptops, tablets, monitors, or background music unless explicitly allowed.

OUTPUT RULE
Return only the final scene block. No explanation. Keep the final output under ${SORA_PROMPT_WRITER_MAX_CHARS} characters.



FORMAT
Always write the final output in this style:

[SCENE START] INT./EXT. LOCATION - TIME
[CHARACTER NAME] ([age, social signal, wardrobe cue]) is already mid-action in a believable environment.
Describe what they are doing when the camera catches them.
Describe how they notice the camera and begin speaking.
Add two lines for expression and body language
Describe their body language, facial behavior, posture, and emotional energy in a socially readable way.
Write the spoken line(s) in this format:
CHARACTER (delivery tone) [spoken line]
Add a visible reaction, transition, or behavior beat between lines if needed.
End with a natural finishing behavior that completes the moment cleanly.
Describe the CAMERA RULE
Describe the LIGHTING RULE

[SCENE END]`;
const PROMPT3_BODY_LANGUAGE_RULES = `

BODY LANGUAGE NATURALISM RULE
Do not default to a centered, symmetrical presenter pose. Keep the body slightly asymmetrical and lived-in: weight can favor one leg, one shoulder can sit a touch lower, one arm can rest more openly than the other, and the hands should not stay clasped together for the whole shot. Use restrained, believable hand and posture changes that feel conversational rather than performative.

BODY LANGUAGE / GESTURE RULES
For every main character, convert emotion into visible behavior.

Always include:
- 1 facial cue
- 1 posture cue
- 1 hand or arm gesture
- 1 interaction with the environment or an allowed object
- 1 listening or reaction beat

Use specific micro-actions like:
- slight brow raise
- soft half-smile forming
- natural blinking
- brief glance away and back
- small head tilt
- subtle lean forward
- shoulders relaxing
- gentle weight shift from one foot to the other
- one hand opening while speaking
- fingers resting on the table or on allowed luggage/armrest surfaces
- light nod on the key line
- hand brushing hair back
- brief look down at an allowed object or environment detail, then back up

Avoid:
- frozen expression
- locked shoulders
- hands clasped for the full clip
- constant front-facing delivery
- symmetrical mannequin posing
- no-reaction listening
- exaggerated acting`;
const PROMPT2_SYSTEM_PROMPT = `You are a Senior AI Film Director + Veo3.1 Prompt Architect.

Your job is to transform a structured or unstructured input brief + backstory into a single, production-ready cinematic scene block optimized for text-to-video generation.

You operate as a multi-stage reasoning system, not a surface-level prompt writer.

---

EXECUTION MODEL (CRITICAL)

You must internally operate in 4 stages:

---

1. INTERPRET (Act)

Parse inputs into structured variables:

Backstory (PRIMARY SOURCE OF TRUTH)

Character identity

Context (location, time, social setting)

Emotional intent

Product/message objective

Constraints (if any)

If any of these are missing, infer from backstory (do not hallucinate randomly).

---

2. DERIVE (Reason)

Convert interpretation into filmable decisions:

Character Layer

Face shape

Skin tone

Hair texture/style

Age markers

Body frame

Grooming

Wardrobe silhouette

Social energy

Environment Layer

Real-world setting (lived-in, not staged)

Socio-economic cues

Sensory realism

Behavior Layer

Opening action (low hallucination)

Movement quality (signature)

Eye behavior

Gesture pattern

Dialogue Layer

Conversational realism

Indian English tonality

Natural pacing and pauses

---

3. CONSTRUCT (Act Output)

Translate everything into a single continuous cinematic moment.

The output must feel:

Observed, not staged

Behavior-first, not script-first

Human, not ad-like

---

4. VALIDATE (Debug Layer - MANDATORY INTERNAL CHECK)

Before output, run this checklist:

Identity Check

Is the character visually distinct?

Avoid generic premium ad archetypes

Physicalization Check

Face detail included

Hair/grooming detail included

Wardrobe/body detail included

Movement quality included

Action Safety Check

Opening action is simple and render-safe

No fragile hand-object choreography

Acting Check

Emotions are visible, not abstract

Face and body react to dialogue

Camera Check

Single shot only

No cuts or transitions

Lighting Check

Neutral, realistic, no yellow cast

Output Purity Check

No meta text

No explanation

No instruction leakage

If any check fails, self-correct before output.

---

MEMORY SYSTEM (ANTI-REPETITION ENGINE)

Maintain implicit memory of prior outputs and avoid repeating:

Locations

Poses

Camera framing

Character archetypes

Wardrobe patterns

Each output must feel like a different human in a different world.

---

TOOL USAGE (INTERNAL)

Use the following internal tools:

Character Differentiator

Assign one dominant visual signature

Assign one movement signature

Simplicity Filter

Simplify actions

Remove fragile interactions

Realism Enforcer

Add micro-behaviors

Add natural pauses

Introduce lived-in imperfections

---

HARD RULES

---

BACKSTORY SUPREMACY

Backstory overrides everything unless explicitly contradicted.

---

NO TEMPLATE OUTPUTS

Do not reuse outputs. Only the format is fixed.

---

LOW-HALLUCINATION ACTION RULE

Avoid:

Complex object handling

Multi-step gestures

Screen or device interactions

Prefer:

Walking

Turning

Leaning

Looking

Subtle gestures

---

HOOK RULE

The scene must begin mid-action. No neutral starts.

---

ACTING RULE

Emotion must be visible through:

Eyes

Brows

Mouth tension

Shoulder posture

Breathing rhythm

---

CAMERA RULE

Single continuous shot

Optional subtle push-in or drift

No cinematic gimmicks

---

LIGHTING RULE

Clean, neutral, true-to-skin

No stylization unless specified

---

ACCENT RULE

Natural Indian English

Context-appropriate tonality

---

EXCLUSIONS

Do not include:

Text overlays

Subtitles

Logos

Screens or devices

Background music

(unless explicitly requested)

---

OUTPUT CONTRACT (NON-NEGOTIABLE)

Return ONLY the final scene block:

[SCENE START] INT./EXT. LOCATION - TIME

[CHARACTER NAME] ([age, social signal, wardrobe cue]) is already mid-action...

Describe environment and action.

Describe how they notice the camera.

Add two lines describing expression and body language.

CHARACTER (delivery tone) [dialogue]

Add a visible beat if needed.

CHARACTER (delivery tone) [dialogue]

End with a natural finishing behavior.

CAMERA:
Describe camera behavior.

LIGHTING:
Describe lighting.

[SCENE END]

---

DEBUG MODE (OPTIONAL)

If the user explicitly says "DEBUG", append:

Interpretation Summary

Character Build Breakdown

Risk Flags

Simplifications made

Otherwise, never include debug output.

---

SUCCESS CRITERIA

The output should feel like:

A real person interrupted mid-life

Not an actor performing

Not a scripted ad

Not a template

It must be: Specific, embodied, minimal, filmable, and human.

Return only the final scene block. No explanation. Keep the final output under ${SORA_PROMPT_WRITER_MAX_CHARS} characters.`;
const PROMPT3_SYSTEM_PROMPT = PROMPT1_SYSTEM_PROMPT
  .replace(
    "You are an expert Sora 2 Pro prompt writer for premium short-form text-to-video ads.",
    "You are a Senior AI Film Director and expert Sora 2 Pro prompt writer for premium short-form text-to-video ads."
  )
  .replace(
    "ACTING BEATS RULE\nConvert emotional intent into visible acting beats. Always include readable direction for facial expression, eye behavior, posture, hand movement, one small gesture, and overall body rhythm. Do not describe emotion as internal mood only; express it through visible performance choices the model can render on camera.\n\n\nCAMERA RULE",
    `ACTING BEATS RULE\nConvert emotional intent into visible acting beats. Always include readable direction for facial expression, eye behavior, posture, hand movement, one small gesture, and overall body rhythm. Do not describe emotion as internal mood only; express it through visible performance choices the model can render on camera.${PROMPT3_BODY_LANGUAGE_RULES}\n\n\nCAMERA RULE`
  );

function getPromptWriterSystemPrompt(promptVersion: PromptWriterVersion = DEFAULT_PROMPT_WRITER_VERSION): string {
  if (promptVersion === "prompt1") {
    return PROMPT1_SYSTEM_PROMPT;
  }
  if (promptVersion === "prompt2") {
    return PROMPT2_SYSTEM_PROMPT;
  }
  return PROMPT3_SYSTEM_PROMPT;
}
const SORA_POLL_INTERVAL_MS = Number(process.env.SORA_POLL_INTERVAL_MS ?? POLL_INTERVAL_MS);
const SORA_POLL_MAX_ATTEMPTS = Number(process.env.SORA_POLL_MAX_ATTEMPTS ?? POLL_MAX_ATTEMPTS);
const SORA_MAX_ATTEMPTS = Number(process.env.SORA_MAX_ATTEMPTS ?? GENAI_MAX_ATTEMPTS);
const SORA_RETRY_BASE_MS = Number(process.env.SORA_RETRY_BASE_MS ?? GENAI_RETRY_BASE_MS);
const VEO_POLL_INTERVAL_MS = Number(process.env.VEO_POLL_INTERVAL_MS ?? POLL_INTERVAL_MS);
const VEO_POLL_MAX_ATTEMPTS = Number(process.env.VEO_POLL_MAX_ATTEMPTS ?? Math.max(POLL_MAX_ATTEMPTS, 120));
const FAL_SORA_POLL_INTERVAL_MS = Number(process.env.FAL_SORA_POLL_INTERVAL_MS ?? 2500);
const FAL_SORA_POLL_MAX_ATTEMPTS = Number(process.env.FAL_SORA_POLL_MAX_ATTEMPTS ?? SORA_POLL_MAX_ATTEMPTS);
const FAL_VEO_TEXT_MODEL = process.env.FAL_VEO_TEXT_MODEL?.trim() || DEFAULT_FAL_VEO_TEXT_MODEL;
const FAL_VEO_IMAGE_MODEL = process.env.FAL_VEO_IMAGE_MODEL?.trim() || DEFAULT_FAL_VEO_IMAGE_MODEL;
const rawVeoMaxConcurrency = Number(process.env.VEO_MAX_CONCURRENCY ?? 2);
const VEO_MAX_CONCURRENCY =
  Number.isFinite(rawVeoMaxConcurrency) && rawVeoMaxConcurrency >= 1 ? Math.floor(rawVeoMaxConcurrency) : 2;
const FAL_VEO_POLL_INTERVAL_MS = Number(process.env.FAL_VEO_POLL_INTERVAL_MS ?? 2500);
const FAL_VEO_POLL_MAX_ATTEMPTS = Number(process.env.FAL_VEO_POLL_MAX_ATTEMPTS ?? Math.max(VEO_POLL_MAX_ATTEMPTS, 240));
const SORA_I2V_FAL_VEO_POLL_INTERVAL_MS = Number(process.env.SORA_I2V_FAL_VEO_POLL_INTERVAL_MS ?? FAL_VEO_POLL_INTERVAL_MS);
const SORA_I2V_FAL_VEO_POLL_MAX_ATTEMPTS = Number(process.env.SORA_I2V_FAL_VEO_POLL_MAX_ATTEMPTS ?? 720);
const FAL_IMAGE_POLL_INTERVAL_MS = Number(process.env.FAL_IMAGE_POLL_INTERVAL_MS ?? 2500);
const FAL_IMAGE_POLL_MAX_ATTEMPTS = Number(process.env.FAL_IMAGE_POLL_MAX_ATTEMPTS ?? 120);
const SHORT_BUMPER_SORA_POLL_INTERVAL_MS = Number(process.env.SHORT_BUMPER_SORA_POLL_INTERVAL_MS ?? 5000);
const SHORT_BUMPER_SORA_POLL_MAX_ATTEMPTS = Number(process.env.SHORT_BUMPER_SORA_POLL_MAX_ATTEMPTS ?? 180);
const SHORT_BUMPER_VEO_POLL_INTERVAL_MS = Number(process.env.SHORT_BUMPER_VEO_POLL_INTERVAL_MS ?? VEO_POLL_INTERVAL_MS);
const SHORT_BUMPER_VEO_POLL_MAX_ATTEMPTS = Number(
  process.env.SHORT_BUMPER_VEO_POLL_MAX_ATTEMPTS ?? Math.max(VEO_POLL_MAX_ATTEMPTS, 180)
);
const SHORT_BUMPER_FAL_SORA_POLL_INTERVAL_MS = Number(process.env.SHORT_BUMPER_FAL_SORA_POLL_INTERVAL_MS ?? 2500);
const SHORT_BUMPER_FAL_SORA_POLL_MAX_ATTEMPTS = Number(process.env.SHORT_BUMPER_FAL_SORA_POLL_MAX_ATTEMPTS ?? 360);
const SHORT_BUMPER_FAL_VEO_POLL_INTERVAL_MS = Number(process.env.SHORT_BUMPER_FAL_VEO_POLL_INTERVAL_MS ?? 2500);
const SHORT_BUMPER_FAL_VEO_POLL_MAX_ATTEMPTS = Number(process.env.SHORT_BUMPER_FAL_VEO_POLL_MAX_ATTEMPTS ?? 360);
const KLING_TEXT_MODEL = process.env.KLING_TEXT_MODEL?.trim() || DEFAULT_KLING_TEXT_MODEL;
const KLING_MAX_ATTEMPTS = Number(process.env.KLING_MAX_ATTEMPTS ?? GENAI_MAX_ATTEMPTS);
const KLING_RETRY_BASE_MS = Number(process.env.KLING_RETRY_BASE_MS ?? GENAI_RETRY_BASE_MS);
const KLING_POLL_INTERVAL_MS = Number(process.env.KLING_POLL_INTERVAL_MS ?? 2500);
const KLING_POLL_MAX_ATTEMPTS = Number(process.env.KLING_POLL_MAX_ATTEMPTS ?? POLL_MAX_ATTEMPTS);
const SHORT_BUMPER_KLING_POLL_INTERVAL_MS = Number(process.env.SHORT_BUMPER_KLING_POLL_INTERVAL_MS ?? 2500);
const SHORT_BUMPER_KLING_POLL_MAX_ATTEMPTS = Number(process.env.SHORT_BUMPER_KLING_POLL_MAX_ATTEMPTS ?? 360);
const FAL_SORA_SUBSCRIBE_TIMEOUT_MS = Number(
  process.env.FAL_SORA_SUBSCRIBE_TIMEOUT_MS ?? FAL_SORA_POLL_INTERVAL_MS * FAL_SORA_POLL_MAX_ATTEMPTS + 5000
);
const FAL_VEO_SUBSCRIBE_TIMEOUT_MS = Number(
  process.env.FAL_VEO_SUBSCRIBE_TIMEOUT_MS ?? FAL_VEO_POLL_INTERVAL_MS * FAL_VEO_POLL_MAX_ATTEMPTS + 5000
);
const SORA_I2V_FAL_VEO_SUBSCRIBE_TIMEOUT_MS = Number(
  process.env.SORA_I2V_FAL_VEO_SUBSCRIBE_TIMEOUT_MS ??
    SORA_I2V_FAL_VEO_POLL_INTERVAL_MS * SORA_I2V_FAL_VEO_POLL_MAX_ATTEMPTS + 5000
);
const FAL_IMAGE_SUBSCRIBE_TIMEOUT_MS = Number(
  process.env.FAL_IMAGE_SUBSCRIBE_TIMEOUT_MS ?? FAL_IMAGE_POLL_INTERVAL_MS * FAL_IMAGE_POLL_MAX_ATTEMPTS + 5000
);
const FAL_TOPAZ_POLL_INTERVAL_MS = Number(process.env.FAL_TOPAZ_POLL_INTERVAL_MS ?? 2500);
const FAL_TOPAZ_POLL_MAX_ATTEMPTS = Number(process.env.FAL_TOPAZ_POLL_MAX_ATTEMPTS ?? 240);
const FAL_TOPAZ_SUBSCRIBE_TIMEOUT_MS = Number(
  process.env.FAL_TOPAZ_SUBSCRIBE_TIMEOUT_MS ?? FAL_TOPAZ_POLL_INTERVAL_MS * FAL_TOPAZ_POLL_MAX_ATTEMPTS + 5000
);
const FAL_TOPAZ_DOWNLOAD_TIMEOUT_MS = Number(process.env.FAL_TOPAZ_DOWNLOAD_TIMEOUT_MS ?? 120000);
const KLING_SUBSCRIBE_TIMEOUT_MS = Number(
  process.env.KLING_SUBSCRIBE_TIMEOUT_MS ?? KLING_POLL_INTERVAL_MS * KLING_POLL_MAX_ATTEMPTS + 5000
);
const SHORT_BUMPER_FAL_SORA_SUBSCRIBE_TIMEOUT_MS = Number(
  process.env.SHORT_BUMPER_FAL_SORA_SUBSCRIBE_TIMEOUT_MS ??
    SHORT_BUMPER_FAL_SORA_POLL_INTERVAL_MS * SHORT_BUMPER_FAL_SORA_POLL_MAX_ATTEMPTS + 5000
);
const SHORT_BUMPER_FAL_VEO_SUBSCRIBE_TIMEOUT_MS = Number(
  process.env.SHORT_BUMPER_FAL_VEO_SUBSCRIBE_TIMEOUT_MS ??
    SHORT_BUMPER_FAL_VEO_POLL_INTERVAL_MS * SHORT_BUMPER_FAL_VEO_POLL_MAX_ATTEMPTS + 5000
);
const SHORT_BUMPER_KLING_SUBSCRIBE_TIMEOUT_MS = Number(
  process.env.SHORT_BUMPER_KLING_SUBSCRIBE_TIMEOUT_MS ??
    SHORT_BUMPER_KLING_POLL_INTERVAL_MS * SHORT_BUMPER_KLING_POLL_MAX_ATTEMPTS + 5000
);
const DEFAULT_END_SLATE_PATH = path.join(process.cwd(), "assets", "end-slate.mp4");
const DEFAULT_END_SLATE_AIR_PLUS_PATH = path.join(process.cwd(), "assets", "end-slate-air-plus.mp4");
const DEFAULT_END_SLATE_AIR_PLUS_SQUARE_PATH = path.join(process.cwd(), "assets", "end-slate-air-plus-1x1.mp4");
const DEFAULT_END_SLATE_AIR_PLUS_LANDSCAPE_PATH = path.join(process.cwd(), "assets", "end-slate-air-plus-16x9.mp4");
const DEFAULT_END_SLATE_AIR_PLUS_INLINE_CTA_CARD_PATH = path.join(process.cwd(), "assets", "end-slate-air-plus-cta-card.png");
const DEFAULT_END_SLATE_AIR_PLUS_INLINE_CTA_BUTTON_PATH = path.join(process.cwd(), "assets", "end-slate-air-plus-cta-button.png");
const DEFAULT_END_SLATE_CASHBACK_PATH = path.join(process.cwd(), "assets", "end-slate-cashback.mp4");
const END_SLATE_VIDEO_PATH = process.env.END_SLATE_VIDEO_PATH?.trim();
const END_SLATE_AIR_PLUS_PATH =
  process.env.END_SLATE_AIR_PLUS_PATH?.trim() ||
  (existsSync(DEFAULT_END_SLATE_AIR_PLUS_PATH) ? DEFAULT_END_SLATE_AIR_PLUS_PATH : undefined);
const END_SLATE_AIR_PLUS_SQUARE_PATH =
  process.env.END_SLATE_AIR_PLUS_SQUARE_PATH?.trim() ||
  (existsSync(DEFAULT_END_SLATE_AIR_PLUS_SQUARE_PATH) ? DEFAULT_END_SLATE_AIR_PLUS_SQUARE_PATH : undefined);
const END_SLATE_AIR_PLUS_LANDSCAPE_PATH =
  process.env.END_SLATE_AIR_PLUS_LANDSCAPE_PATH?.trim() ||
  (existsSync(DEFAULT_END_SLATE_AIR_PLUS_LANDSCAPE_PATH) ? DEFAULT_END_SLATE_AIR_PLUS_LANDSCAPE_PATH : undefined);
const END_SLATE_AIR_PLUS_INLINE_CTA_CARD_PATH =
  process.env.END_SLATE_AIR_PLUS_INLINE_CTA_CARD_PATH?.trim() ||
  (existsSync(DEFAULT_END_SLATE_AIR_PLUS_INLINE_CTA_CARD_PATH) ? DEFAULT_END_SLATE_AIR_PLUS_INLINE_CTA_CARD_PATH : undefined);
const END_SLATE_AIR_PLUS_INLINE_CTA_BUTTON_PATH =
  process.env.END_SLATE_AIR_PLUS_INLINE_CTA_BUTTON_PATH?.trim() ||
  (existsSync(DEFAULT_END_SLATE_AIR_PLUS_INLINE_CTA_BUTTON_PATH) ? DEFAULT_END_SLATE_AIR_PLUS_INLINE_CTA_BUTTON_PATH : undefined);
const END_SLATE_CASHBACK_PATH =
  process.env.END_SLATE_CASHBACK_PATH?.trim() ||
  (existsSync(DEFAULT_END_SLATE_CASHBACK_PATH) ? DEFAULT_END_SLATE_CASHBACK_PATH : undefined);
const DEFAULT_LYRIA_MODEL = "models/lyria-realtime-exp";
const DEFAULT_FAL_LYRIA_MODEL = "fal-ai/lyria2";
const rawBackgroundScoreSource = (process.env.BACKGROUND_SCORE_SOURCE ?? "auto").trim().toLowerCase();
const BACKGROUND_SCORE_SOURCE: "lyria" | "file" | "auto" =
  rawBackgroundScoreSource === "file" || rawBackgroundScoreSource === "auto" ? rawBackgroundScoreSource : "lyria";
const LYRIA_MODEL = process.env.LYRIA_MODEL?.trim() || DEFAULT_LYRIA_MODEL;
const FAL_LYRIA_MODEL = process.env.FAL_LYRIA_MODEL?.trim() || DEFAULT_FAL_LYRIA_MODEL;
const DEFAULT_BACKGROUND_SCORE_PATH = path.join(process.cwd(), "assets", "background-score.mp3");
const BACKGROUND_SCORE_PATH = process.env.BACKGROUND_SCORE_PATH?.trim();
const BACKGROUND_SCORE_AIR_PLUS_PATH = process.env.BACKGROUND_SCORE_AIR_PLUS_PATH?.trim();
const BACKGROUND_SCORE_CASHBACK_PATH = process.env.BACKGROUND_SCORE_CASHBACK_PATH?.trim();
const DEFAULT_BACKGROUND_SCORE_VOLUME = 0.1;
const MAX_BACKGROUND_SCORE_VOLUME = 0.22;
const BACKGROUND_SCORE_LOUDNESS_MULTIPLIER = 1.5;
const parsedBackgroundScoreVolume = Number(process.env.BACKGROUND_SCORE_VOLUME ?? DEFAULT_BACKGROUND_SCORE_VOLUME);
const BACKGROUND_SCORE_VOLUME = Number.isFinite(parsedBackgroundScoreVolume)
  ? Math.max(0, Math.min(MAX_BACKGROUND_SCORE_VOLUME, parsedBackgroundScoreVolume))
  : DEFAULT_BACKGROUND_SCORE_VOLUME;
const EFFECTIVE_BACKGROUND_SCORE_VOLUME = Math.max(
  0,
  Math.min(MAX_BACKGROUND_SCORE_VOLUME, BACKGROUND_SCORE_VOLUME * BACKGROUND_SCORE_LOUDNESS_MULTIPLIER)
);
const parsedBackgroundScoreFadeSeconds = Number(process.env.BACKGROUND_SCORE_FADE_SECONDS ?? 0.45);
const BACKGROUND_SCORE_FADE_SECONDS = Number.isFinite(parsedBackgroundScoreFadeSeconds)
  ? Math.max(0, Math.min(1.5, parsedBackgroundScoreFadeSeconds))
  : 0.45;
const parsedBackgroundScoreEndFadeSeconds = Number(
  process.env.BACKGROUND_SCORE_END_FADE_SECONDS ?? BACKGROUND_SCORE_FADE_SECONDS
);
const BACKGROUND_SCORE_END_FADE_SECONDS = Number.isFinite(parsedBackgroundScoreEndFadeSeconds)
  ? Math.max(0, Math.min(2, parsedBackgroundScoreEndFadeSeconds))
  : BACKGROUND_SCORE_FADE_SECONDS;
const LYRIA_CONNECT_TIMEOUT_MS = Number(process.env.LYRIA_CONNECT_TIMEOUT_MS ?? 12000);
const LYRIA_SETUP_TIMEOUT_MS = Number(process.env.LYRIA_SETUP_TIMEOUT_MS ?? 9000);
const LYRIA_CAPTURE_TIMEOUT_MS = Number(process.env.LYRIA_CAPTURE_TIMEOUT_MS ?? 8000);
const LYRIA_IDLE_FINISH_MS = Number(process.env.LYRIA_IDLE_FINISH_MS ?? 650);
const LYRIA_MIN_CHUNKS = Number(process.env.LYRIA_MIN_CHUNKS ?? 6);
const WHISPER_CLI_PATH = process.env.WHISPER_CLI_PATH?.trim() || "whisper";
const WHISPER_MODEL = process.env.WHISPER_MODEL?.trim() || "base";
const WHISPER_MODEL_DIR =
  process.env.WHISPER_MODEL_DIR?.trim() || path.join(process.cwd(), ".cache", "whisper");
const ALLOW_LYRIA_LIVE_FALLBACK = /^(1|true|yes)$/i.test(process.env.ALLOW_LYRIA_LIVE_FALLBACK ?? "");
const SUPERS_BRAND_RED = "0xE7142F";
const SUPERS_BRAND_BLUE = "0x3D57C8";
const SUPERS_AIR_PLUS_GREY = "0x595A5C";
const AIR_PLUS_COMPLIMENTARY_FLIGHT_SUPERS_TEXT = "Free flight at Rs. 1.5L spent this quarter";
const AIR_PLUS_TRAVEL_PRIVILEGES_SUPERS_TEXT = "Travel perks worth 80K";
const AIR_PLUS_TRAVEL_EARN_SUPERS_TEXT = "Earn 5% on travel";
const AIR_PLUS_FOREX_SUPERS_TEXT = "2% forex markup";
const AIR_PLUS_COMPLIMENTARY_FLIGHT_CHIP_LEFT_LINE_1 = "₹5,000* free";
const AIR_PLUS_COMPLIMENTARY_FLIGHT_CHIP_LEFT_LINE_2 = "flight";
const AIR_PLUS_COMPLIMENTARY_FLIGHT_CHIP_RIGHT_LINE_1 = "Zero Joining";
const AIR_PLUS_COMPLIMENTARY_FLIGHT_CHIP_RIGHT_LINE_2 = "Fee";
const AIR_PLUS_FOREX_CHIP_LEFT_LINE_1 = "Low 2% Forex";
const AIR_PLUS_FOREX_CHIP_LEFT_LINE_2 = "Markup";
const AIR_PLUS_FOREX_CHIP_RIGHT_LINE_1 = "Zero Joining";
const AIR_PLUS_FOREX_CHIP_RIGHT_LINE_2 = "Fee";
const AIR_PLUS_TRAVEL_PRIVILEGES_CHIP_LEFT_LINE_1 = "Privileges";
const AIR_PLUS_TRAVEL_PRIVILEGES_CHIP_LEFT_LINE_2 = "worth ₹80K";
const AIR_PLUS_TRAVEL_PRIVILEGES_CHIP_RIGHT_LINE_1 = "Zero Joining";
const AIR_PLUS_TRAVEL_PRIVILEGES_CHIP_RIGHT_LINE_2 = "Fee";
const AIR_PLUS_TRAVEL_EARN_CHIP_LEFT_LINE_1 = "5% Rewards";
const AIR_PLUS_TRAVEL_EARN_CHIP_LEFT_LINE_2 = "on Travel";
const AIR_PLUS_TRAVEL_EARN_CHIP_RIGHT_LINE_1 = "Zero Joining";
const AIR_PLUS_TRAVEL_EARN_CHIP_RIGHT_LINE_2 = "Fee";
const AIR_PLUS_COMPLIMENTARY_FLIGHT_STACK_COUNT = 3;
const AIR_PLUS_COMPLIMENTARY_FLIGHT_TEXT_ALPHA = 0.96;
const AIR_PLUS_COMPLIMENTARY_FLIGHT_BAND_BOTTOM_MARGIN_PX = 240;
const AIR_PLUS_COMPLIMENTARY_FLIGHT_CHIP_FONT_FILE = existsSync(
  "/Users/neha/Desktop/Brand collaterals 3/FONTS/Source_Sans_3,Source_Serif_4/Source_Serif_4/static/SourceSerif4-BoldItalic.ttf"
)
  ? "/Users/neha/Desktop/Brand collaterals 3/FONTS/Source_Sans_3,Source_Serif_4/Source_Serif_4/static/SourceSerif4-BoldItalic.ttf"
  : SUPERS_ITALIC_FONT_FILE || SUPERS_FONT_FILE;
const AIR_PLUS_COMPLIMENTARY_FLIGHT_STACK_FONT_FILE = SUPERS_FONT_FILE || AIR_PLUS_COMPLIMENTARY_FLIGHT_CHIP_FONT_FILE;
const AIR_PLUS_COMPLIMENTARY_FLIGHT_CHIP_IMAGE_PATH = path.join(
  process.cwd(),
  "public",
  "assets",
  "supers",
  "air-plus-complimentary-flight-chip.png"
);
const AIR_PLUS_TRAVEL_EARN_CHIP_IMAGE_PATH = path.join(
  process.cwd(),
  "public",
  "assets",
  "supers",
  "RTB Super _ 5Travel.png"
);
const AIR_PLUS_FOREX_CHIP_IMAGE_PATH = path.join(
  process.cwd(),
  "public",
  "assets",
  "supers",
  "RTB Super _2Forex.png"
);
const AIR_PLUS_SPECIAL_CHIP_BOTTOM_SAFE_MARGIN_PX = 320;
const AIR_PLUS_STANDARD_SUPERS_Y_EXPR = "h*0.710";
const DEFAULT_KOTAK_STANDARD_SUPERS_Y_EXPR = "main_h*0.712";
const ADAPT_GENERATION_MODE = (process.env.ADAPT_GENERATION_MODE ?? "regenerate").trim().toLowerCase();
const ADAPT_COMPOSITION_MODE = (process.env.ADAPT_COMPOSITION_MODE ?? "cover").trim().toLowerCase();
const BACKSTORY_RECENT_WINDOW = 10;
const PERSONA_FIRST_NAMES = [
  "Aarav",
  "Aditya",
  "Akash",
  "Ananya",
  "Asha",
  "Ishita",
  "Kabir",
  "Karthik",
  "Meera",
  "Neha",
  "Nikhil",
  "Priya",
  "Rhea",
  "Rohan",
  "Sana",
  "Shruti",
  "Siddharth",
  "Tanvi",
  "Varun",
  "Vikram"
] as const;
const PERSONA_FIRST_NAMES_WOMEN = [
  "Aditi",
  "Ananya",
  "Asha",
  "Devika",
  "Ishita",
  "Kavya",
  "Meera",
  "Naina",
  "Neha",
  "Priya",
  "Radhika",
  "Rhea",
  "Sana",
  "Shruti",
  "Tanvi",
  "Tara"
] as const;
const PERSONA_FIRST_NAMES_MEN = [
  "Aarav",
  "Aditya",
  "Akash",
  "Arjun",
  "Kabir",
  "Karthik",
  "Nikhil",
  "Rishabh",
  "Rohan",
  "Siddharth",
  "Varun",
  "Vikram"
] as const;
const PERSONA_LAST_NAMES = [
  "Bhatia",
  "Chatterjee",
  "Desai",
  "Deshmukh",
  "Gupta",
  "Iyer",
  "Joshi",
  "Kapoor",
  "Khanna",
  "Malhotra",
  "Menon",
  "Mehta",
  "Nair",
  "Patel",
  "Rao",
  "Reddy",
  "Sen",
  "Sharma",
  "Shenoy",
  "Verma"
] as const;
const AIR_PLUS_CITY_POOL = ["Delhi NCR", "Mumbai", "Bengaluru", "Hyderabad", "Chandigarh", "Pune", "Ahmedabad"] as const;
const CASHBACK_CITY_POOL = ["Mumbai", "Pune", "Bengaluru", "Hyderabad", "Delhi NCR", "Chennai", "Kolkata"] as const;
const AIR_PLUS_PROFESSION_POOL = [
  "Regional Sales Director with frequent intercity client travel",
  "Management Consultant handling weekly airport commutes",
  "Tech Delivery Lead coordinating cross-city teams",
  "Independent Business Owner sourcing from international suppliers",
  "Corporate Strategy Manager balancing meetings across metros",
  "Startup Operations Head traveling for investor and partner meetings",
  "Supply Chain Program Lead managing multi-city rollouts"
] as const;
const CASHBACK_PROFESSION_POOL = [
  "Salaried software support executive managing monthly household budgets",
  "Retail store supervisor balancing commute and daily essentials spending",
  "Customer success associate tracking value across recurring expenses",
  "Operations analyst planning family grocery and fuel spends",
  "Sales coordinator optimizing day-to-day spend categories",
  "Early-career consultant prioritizing practical monthly savings",
  "Working professional managing entertainment, fuel, and essentials budgets"
] as const;
const ADAPT_SQUARE_FILENAME = "adapt-1x1.mp4";
const ADAPT_LANDSCAPE_FILENAME = "adapt-16x9.mp4";
const HOWTO_MIN_DURATION_SECONDS = 6;
const HOWTO_MAX_DURATION_SECONDS = 45;
const HOWTO_FRAME_WIDTH = 1920;
const HOWTO_FRAME_HEIGHT = 1080;
const HOWTO_TTS_HTTP_TIMEOUT_MS = Number(process.env.HOWTO_TTS_HTTP_TIMEOUT_MS ?? 30000);
const HOWTO_TTS_MAX_ATTEMPTS = Math.max(1, Number(process.env.HOWTO_TTS_MAX_ATTEMPTS ?? 2));
const HOWTO_TTS_RETRY_BASE_MS = Math.max(250, Number(process.env.HOWTO_TTS_RETRY_BASE_MS ?? 700));
const VIDEO_QC_ENABLED = false;
const SORA_SCRIPT_FIDELITY_GUARD_ENABLED = process.env.SORA_SCRIPT_FIDELITY_GUARD !== "0";
const SORA_SCRIPT_FIDELITY_MIN_TOKEN_OVERLAP = clampNumber(
  Number(process.env.SORA_SCRIPT_FIDELITY_MIN_TOKEN_OVERLAP ?? 0.58),
  0.2,
  1
);
const VIDEO_QC_MAX_ATTEMPTS = Math.max(1, Number(process.env.VIDEO_QC_MAX_ATTEMPTS ?? 3));
const VIDEO_QC_OPENING_WINDOW_RATIO = Number(process.env.VIDEO_QC_OPENING_WINDOW_RATIO ?? 0.35);
const VIDEO_QC_MIN_RTB_DEADLINE_SECONDS = Number(process.env.VIDEO_QC_MIN_RTB_DEADLINE_SECONDS ?? 2.2);
const VIDEO_QC_MAX_RTB_DEADLINE_SECONDS = Number(process.env.VIDEO_QC_MAX_RTB_DEADLINE_SECONDS ?? 6.8);
const FAL_SORA_PROMPT_MAX_CHARS = 4800;

function resolveVideoConfig(video?: VideoConfig): VideoConfig {
  const rawDuration = video?.durationSeconds ?? DEFAULT_VIDEO_CONFIG.durationSeconds;
  const normalizedDuration = Number.isFinite(rawDuration) ? clampNumber(rawDuration, 4, HOWTO_MAX_DURATION_SECONDS) : DEFAULT_VIDEO_CONFIG.durationSeconds;
  return {
    type: video?.type ?? DEFAULT_VIDEO_CONFIG.type,
    durationSeconds: normalizedDuration,
    provider: video?.provider ?? DEFAULT_VIDEO_CONFIG.provider
  };
}

function resolveSupersConfig(supers?: SupersConfig, video?: VideoConfig): SupersConfig {
  const selectedVideo = resolveVideoConfig(video);
  const forceAccurateTiming = isBumperVideoType(selectedVideo.type);
  const requestedTemplate = supers?.template;
  const resolvedTemplate =
    requestedTemplate === "super2" ? "super2" : requestedTemplate === "super1" ? "super1" : "super1";
  return {
    enabled: supers?.enabled ?? true,
    timingMode: forceAccurateTiming || supers?.timingMode === "accurate" ? "accurate" : "fast",
    template: resolvedTemplate,
    rules: Array.isArray(supers?.rules) ? supers.rules : []
  };
}

interface RecentBackstorySignals {
  names: string[];
  gender_presentations: string[];
  cities: string[];
  professions: string[];
  settings: string[];
  wardrobe_signatures: string[];
}

type GenderPresentation = "man" | "woman";

interface ContextualWardrobeVariant {
  signature: string;
  details: string;
  props: [string, string];
}

const runtimeRecentBackstorySignalsByProduct = new Map<ProductKey, RecentBackstorySignals>();

const backstorySchema = z.object({
  persona_name: z.coerce.string().min(1),
  gender_presentation: z.enum(["man", "woman"]).catch("man"),
  age_range: z.coerce.string().min(1),
  city: z.coerce.string().min(1),
  profession: z.coerce.string().min(1),
  why_they_care: z.coerce.string().min(1),
  facial_features: z.preprocess(
    (value) => (typeof value === "string" ? value : ""),
    z.string().trim().min(1).catch(BACKSTORY_FACIAL_FEATURES_FALLBACK)
  ),
  hairstyle_grooming: z.preprocess(
    (value) => (typeof value === "string" ? value : ""),
    z.string().trim().min(1).catch(BACKSTORY_HAIRSTYLE_GROOMING_FALLBACK)
  ),
  wardrobe_details: z.preprocess(
    (value) => (typeof value === "string" ? value : ""),
    z.string().trim().min(1).catch(BACKSTORY_WARDROBE_DETAILS_FALLBACK)
  ),
  posture_body_language: z.preprocess(
    (value) => (typeof value === "string" ? value : ""),
    z.string().trim().min(1).catch(BACKSTORY_POSTURE_BODY_LANGUAGE_FALLBACK)
  ),
  expression_style: z.preprocess(
    (value) => (typeof value === "string" ? value : ""),
    z.string().trim().min(1).catch(BACKSTORY_EXPRESSION_STYLE_FALLBACK)
  ),
  speaking_energy: z.preprocess(
    (value) => (typeof value === "string" ? value : ""),
    z.string().trim().min(1).catch(BACKSTORY_SPEAKING_ENERGY_FALLBACK)
  ),
  body_build: z.preprocess(
    (value) => (typeof value === "string" ? value : ""),
    z.string().trim().min(1).catch(BACKSTORY_BODY_BUILD_FALLBACK)
  ),
  speaking_style: z.array(z.coerce.string()).length(3),
  wardrobe_props: z.array(z.coerce.string()).length(2),
  setting: z.coerce.string().min(1),
  compliance_notes: z.array(z.coerce.string()).length(2)
});

const generatedImageInspectionSchema = z.object({
  hasForbiddenVisual: z.boolean(),
  visibleText: z.boolean(),
  cardLikeObject: z.boolean(),
  reason: z.string().min(1)
});

const generatedVideoQcSchema = z.object({
  pass: z.boolean(),
  summary: z.string().min(1),
  firstRtbSecond: z.number().nullable(),
  rtbAppearsEarly: z.boolean(),
  scriptMatchPass: z.boolean(),
  lipSyncApplicable: z.boolean(),
  lipSyncPass: z.boolean(),
  endingPass: z.boolean(),
  brandFitPass: z.boolean(),
  continuityPass: z.boolean(),
  reasons: z.array(z.string()).max(8)
});

const finalVideoCreativeAssessmentSchema = z.object({
  score: z.number().min(0).max(10),
  whatWillWork: z.string().min(1),
  whyItWillWork: z.string().min(1),
  concerns: z.array(z.string()).max(6)
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getVideoProviderAssetPrefix(provider: VideoProvider): string {
  switch (provider) {
    case "sora":
      return "sora-t2v";
    case "veo31_standard":
      return "veo-i2v";
    case "sora_i2v":
      return "sora-image-veo-i2v";
  }
}

function getProviderAssetFileNames(provider: VideoProvider): {
  keyframe: string;
  keyframeSource: string;
  rawProvider: string;
  rawTopaz: string;
  raw: string;
  qc: string;
  final: string;
} {
  const prefix = getVideoProviderAssetPrefix(provider);
  return {
    keyframe: `keyframe-${prefix}.png`,
    keyframeSource: `keyframe-source-${prefix}.png`,
    rawProvider: `raw-provider-${prefix}.mp4`,
    rawTopaz: `raw-topaz-${prefix}.mp4`,
    raw: `raw-${prefix}.mp4`,
    qc: `qc-${prefix}.json`,
    final: `final-${prefix}.mp4`
  };
}

function createAsyncLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let activeCount = 0;
  const waiters: Array<() => void> = [];

  return async function runWithLimit<T>(task: () => Promise<T>): Promise<T> {
    if (limit > 0 && activeCount >= limit) {
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    }

    activeCount += 1;
    try {
      return await task();
    } finally {
      activeCount = Math.max(0, activeCount - 1);
      const next = waiters.shift();
      next?.();
    }
  };
}

const withVeoConcurrencyLimit = createAsyncLimiter(VEO_MAX_CONCURRENCY);

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const body = (error as Error & { body?: unknown; requestId?: unknown; status?: unknown }).body;
    const requestId = (error as Error & { body?: unknown; requestId?: unknown; status?: unknown }).requestId;
    const status = (error as Error & { body?: unknown; requestId?: unknown; status?: unknown }).status;
    const parts = [error.message];
    if (typeof status === "number") {
      parts.push(`status=${status}`);
    }
    if (requestId) {
      parts.push(`requestId=${String(requestId)}`);
    }
    if (body !== undefined) {
      try {
        parts.push(`body=${JSON.stringify(body)}`);
      } catch {
        parts.push(`body=${String(body)}`);
      }
    }
    return parts.join(" | ");
  }
  return String(error);
}

function buildProviderStageError(provider: string, stage: string, error: unknown): Error {
  const wrapped = new Error(`${provider} ${stage} failed: ${errorMessage(error)}`);
  if (error !== undefined) {
    (wrapped as Error & { cause?: unknown }).cause = error;
  }
  return wrapped;
}

async function withProviderStage<T>(provider: string, stage: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw buildProviderStageError(provider, stage, error);
  }
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 6; depth += 1) {
    if (!current || typeof current !== "object") {
      return false;
    }

    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && code.toLowerCase() === expectedCode.toLowerCase()) {
      return true;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

function isRetryableGenAiError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("resource_exhausted") ||
    message.includes("\"code\":429") ||
    message.includes("code: 429") ||
    message.includes("status\":429") ||
    message.includes("\"code\":503") ||
    message.includes("\"code\":504") ||
    message.includes("\"code\":500") ||
    message.includes("code: 503") ||
    message.includes("code: 504") ||
    message.includes("code: 500") ||
    message.includes("status\":\"unavailable\"") ||
    message.includes("status\":\"deadline_exceeded\"") ||
    message.includes("status\":\"internal\"") ||
    message.includes("high demand") ||
    message.includes("temporarily out of capacity") ||
    message.includes("unavailable") ||
    message.includes("deadline exceeded") ||
    message.includes("deadline_exceeded") ||
    message.includes("deadline expired") ||
    message.includes("internal error encountered") ||
    message.includes("internal") ||
    message.includes("headers timeout") ||
    message.includes("fetch failed") ||
    message.includes("this operation was aborted") ||
    message.includes("operation was aborted") ||
    message.includes("socket hang up") ||
    message.includes("timed out") ||
    hasErrorCode(error, "UND_ERR_HEADERS_TIMEOUT") ||
    hasErrorCode(error, "ABORT_ERR") ||
    hasErrorCode(error, "ETIMEDOUT") ||
    hasErrorCode(error, "ECONNRESET")
  );
}

function isVeoCelebrityLikenessFilterError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  if (!message.includes("output was filtered by safety policy")) {
    return false;
  }

  return (
    message.includes("celebrity") ||
    message.includes("public figure") ||
    message.includes("lookalike") ||
    message.includes("likeness")
  );
}

async function withGenAiRetry<T>(operationName: string, run: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= GENAI_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!isRetryableGenAiError(error) || attempt === GENAI_MAX_ATTEMPTS) {
        break;
      }

      const jitter = Math.floor(Math.random() * 500);
      const backoffMs = GENAI_RETRY_BASE_MS * 2 ** (attempt - 1) + jitter;
      console.warn(`[pipeline] ${operationName} retry ${attempt}/${GENAI_MAX_ATTEMPTS} after ${backoffMs}ms`, error);
      await sleep(backoffMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${operationName} failed after retries: ${String(lastError)}`);
}

async function withSoraRetry<T>(operationName: string, run: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= SORA_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      const message = errorMessage(error);
      const retryable =
        (!(error instanceof ProviderPollTimeoutError) && isRetryableGenAiError(error)) ||
        /\bHTTP\s*(408|409|429|5\d\d)\b/i.test(message) ||
        (!(error instanceof ProviderPollTimeoutError) && /temporar|overloaded|unavailable|timeout|timed out|high demand/i.test(message));
      if (!retryable || attempt === SORA_MAX_ATTEMPTS) {
        break;
      }

      const jitter = Math.floor(Math.random() * 500);
      const backoffMs = SORA_RETRY_BASE_MS * 2 ** (attempt - 1) + jitter;
      console.warn(`[pipeline] ${operationName} retry ${attempt}/${SORA_MAX_ATTEMPTS} after ${backoffMs}ms`, error);
      await sleep(backoffMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${operationName} failed after retries: ${String(lastError)}`);
}

async function withKlingRetry<T>(operationName: string, run: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= KLING_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      const message = errorMessage(error);
      const retryable =
        (!(error instanceof ProviderPollTimeoutError) && isRetryableGenAiError(error)) ||
        /\bHTTP\s*(408|409|429|5\d\d)\b/i.test(message) ||
        (!(error instanceof ProviderPollTimeoutError) && /temporar|overloaded|unavailable|timeout|timed out|high demand|queue/i.test(message));
      if (!retryable || attempt === KLING_MAX_ATTEMPTS) {
        break;
      }

      const jitter = Math.floor(Math.random() * 500);
      const backoffMs = KLING_RETRY_BASE_MS * 2 ** (attempt - 1) + jitter;
      console.warn(`[pipeline] ${operationName} retry ${attempt}/${KLING_MAX_ATTEMPTS} after ${backoffMs}ms`, error);
      await sleep(backoffMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${operationName} failed after retries: ${String(lastError)}`);
}

class JobRunSupersededError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} run was superseded by a newer retry.`);
    this.name = "JobRunSupersededError";
  }
}

class ProviderPollTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderPollTimeoutError";
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new ProviderPollTimeoutError(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function ensureCurrentJobRun(jobId: string, runToken: string): Promise<void> {
  const current = await getJob(jobId);
  if (!current || current.runToken !== runToken) {
    throw new JobRunSupersededError(jobId);
  }
}

async function mutateJobForRun(jobId: string, runToken: string, mutate: (job: JobRecord) => void): Promise<void> {
  await mutateJob(jobId, (job) => {
    if (job.runToken !== runToken) {
      throw new JobRunSupersededError(jobId);
    }
    mutate(job);
  });
}

async function updateStepForRun(
  jobId: string,
  runToken: string,
  stepId: "backstory" | "keyframe" | "video" | "finalize",
  status: "pending" | "running" | "completed" | "failed",
  message?: string
): Promise<void> {
  await mutateJobForRun(jobId, runToken, (job) => {
    const step = job.steps.find((item) => item.id === stepId);
    if (!step) {
      return;
    }
    step.status = status;
    step.message = message;
    if (status === "failed") {
      job.status = "failed";
    }
  });
}

async function setJobStatusForRun(jobId: string, runToken: string, status: "queued" | "running" | "completed" | "failed", error?: string): Promise<void> {
  await mutateJobForRun(jobId, runToken, (job) => {
    job.status = status;
    job.error = error;
  });
}

function getLogicModelCandidates(): string[] {
  const primary = (process.env.GEMINI_LOGIC_MODEL ?? DEFAULT_TEXT_MODEL).trim();
  const envFallbacks = (process.env.GEMINI_LOGIC_FALLBACK_MODELS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const configuredFallbacks = envFallbacks.length > 0 ? envFallbacks : [...DEFAULT_LOGIC_FALLBACK_MODELS];
  return Array.from(new Set([primary, ...configuredFallbacks].filter(Boolean)));
}

function getQcModelCandidates(): string[] {
  const primary = (process.env.GEMINI_QC_MODEL ?? DEFAULT_QC_MODEL).trim();
  const envFallbacks = (
    process.env.GEMINI_QC_FALLBACK_MODELS ??
    process.env.GEMINI_LOGIC_FALLBACK_MODELS ??
    ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const configuredFallbacks = envFallbacks.length > 0 ? envFallbacks : [...DEFAULT_QC_FALLBACK_MODELS];
  return Array.from(new Set([primary, ...configuredFallbacks].filter(Boolean)));
}

async function generateLogicContent(
  ai: GoogleGenAI,
  operationName: string,
  contents: string,
  temperature: number
): Promise<unknown> {
  const models = getLogicModelCandidates();
  let lastError: unknown;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index]!;
    try {
      return await withGenAiRetry(`${operationName}:${model}`, () =>
        ai.models.generateContent({
          model,
          contents,
          config: {
            responseMimeType: "application/json",
            temperature
          }
        })
      );
    } catch (error) {
      lastError = error;
      const hasFallback = index < models.length - 1;
      if (!hasFallback || !isRetryableGenAiError(error)) {
        throw error;
      }
      console.warn(
        `[pipeline] ${operationName} failed on ${model}; falling back to ${models[index + 1]} due to retryable error: ${errorMessage(
          error
        )}`
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${operationName} failed for all logic models.`);
}

async function generateLogicContentWithImage(
  ai: GoogleGenAI,
  operationName: string,
  prompt: string,
  imageBytesBase64: string,
  mimeType: string,
  temperature: number
): Promise<unknown> {
  const models = getLogicModelCandidates();
  let lastError: unknown;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index]!;
    try {
      return await withGenAiRetry(`${operationName}:${model}`, () =>
        ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType,
                    data: imageBytesBase64
                  }
                }
              ]
            }
          ],
          config: {
            responseMimeType: "application/json",
            temperature
          }
        })
      );
    } catch (error) {
      lastError = error;
      const hasFallback = index < models.length - 1;
      if (!hasFallback || !isRetryableGenAiError(error)) {
        throw error;
      }
      console.warn(
        `[pipeline] ${operationName} failed on ${model}; falling back to ${models[index + 1]} due to retryable error: ${errorMessage(
          error
        )}`
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${operationName} failed for all logic models.`);
}

async function generateQcContentWithVideo(
  ai: GoogleGenAI,
  operationName: string,
  prompt: string,
  videoBytesBase64: string,
  mimeType: string,
  temperature: number
): Promise<unknown> {
  const models = getQcModelCandidates();
  let lastError: unknown;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index]!;
    try {
      return await withGenAiRetry(`${operationName}:${model}`, () =>
        ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType,
                    data: videoBytesBase64
                  }
                }
              ]
            }
          ],
          config: {
            responseMimeType: "application/json",
            temperature
          }
        })
      );
    } catch (error) {
      lastError = error;
      const hasFallback = index < models.length - 1;
      if (!hasFallback || !isRetryableGenAiError(error)) {
        throw error;
      }
      console.warn(
        `[pipeline] ${operationName} failed on ${model}; falling back to ${models[index + 1]} due to retryable error: ${errorMessage(
          error
        )}`
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${operationName} failed for all QC models.`);
}

function requireApiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error("GEMINI_API_KEY is required. Add it to .env.local.");
  }
  return key;
}

function requireOpenAiApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY is required for Sora motion generation. Add it to .env.local.");
  }
  return key;
}

function requireFalApiKey(): string {
  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    throw new Error("FAL_KEY is required for fal image/video generation and fal-based music. Add it to .env.local.");
  }
  return key;
}

function isTextToVideoType(videoType: VideoType): boolean {
  return videoType === "point_to_camera_multi_scene" || videoType === "montage";
}

function isHowToVideoType(videoType: VideoType): boolean {
  return videoType === "how_to_video";
}

function shouldUseProviderImageFirstFlow(videoConfig: VideoConfig): boolean {
  const resolvedVideo = resolveVideoConfig(videoConfig);
  return (
    (resolvedVideo.provider === "veo31_standard" || resolvedVideo.provider === "sora_i2v") &&
    !isHowToVideoType(resolvedVideo.type)
  );
}

function shouldUseDirectTextToVideoFlow(videoConfig: VideoConfig): boolean {
  const resolvedVideo = resolveVideoConfig(videoConfig);
  return isTextToVideoType(resolvedVideo.type) && !shouldUseProviderImageFirstFlow(resolvedVideo);
}

function countPromptWords(value: string): number {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean).length;
}

function estimateHowToDurationSeconds(stepsText: string, screengrabCount: number): number {
  const words = countPromptWords(stepsText);
  const lineCount = stepsText
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean).length;
  const narrativeEstimate = words > 0 ? words / 2.25 : 0;
  const structureEstimate = Math.max(lineCount, screengrabCount, 1) * 2.3;
  const target = Math.max(narrativeEstimate, structureEstimate, HOWTO_MIN_DURATION_SECONDS);
  return Math.round(clampNumber(target, HOWTO_MIN_DURATION_SECONDS, HOWTO_MAX_DURATION_SECONDS));
}

function getVideoProviderLabel(video: VideoConfig): string {
  if (isHowToVideoType(video.type)) {
    return "Motion Agent";
  }

  switch (video.provider) {
    case "veo31_standard":
      return "Veo 3.1 Standard";
    case "sora_i2v":
      return "Sora Image -> Veo I2V";
    case "sora":
    default:
      return "Sora 2 Pro";
  }
}

function getClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: requireApiKey(),
    httpOptions: {
      timeout: GENAI_HTTP_TIMEOUT_MS
    }
  });
}


function responseText(response: unknown): string {
  if (!response || typeof response !== "object") {
    return "";
  }

  const value = (response as { text?: unknown }).text;
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "function") {
    const result = value();
    return typeof result === "string" ? result : "";
  }

  return "";
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed);
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return JSON.parse(trimmed.slice(first, last + 1));
  }

  throw new Error("Model response did not contain a JSON object.");
}

function toBooleanLike(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "yes";
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return false;
}

function toNullableNumberLike(value: unknown): number | null {
  if (value === null || typeof value === "undefined") {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const normalized = value.replace(/[^\d.+-]/g, "").trim();
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toNumberLike(value: unknown): number | undefined {
  const parsed = toNullableNumberLike(value);
  return parsed === null ? undefined : parsed;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\n|[•;|]/g)
      .map((item) => item.replace(/^-+\s*/, "").trim())
      .filter(Boolean);
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .flatMap((item) => toStringArray(item))
      .filter(Boolean);
  }

  return [];
}

function normalizeFixedList(
  value: unknown,
  expectedLength: number,
  fallbackItem: string
): string[] {
  const items = toStringArray(value).slice(0, expectedLength);
  while (items.length < expectedLength) {
    items.push(fallbackItem);
  }
  return items;
}

function normalizeBackstoryShape(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }

  const record = { ...(raw as Record<string, unknown>) };
  const parsedAge = Number.parseInt(String(record.age_range ?? "").trim(), 10);
  record.age_range = Number.isFinite(parsedAge) ? String(clampNumber(parsedAge, 25, 38)) : "32";
  record.gender_presentation =
    typeof record.gender_presentation === "string" && /^(man|woman)$/i.test(record.gender_presentation.trim())
      ? record.gender_presentation.trim().toLowerCase()
      : "man";
  record.facial_features =
    typeof record.facial_features === "string" && record.facial_features.trim()
      ? record.facial_features
      : BACKSTORY_FACIAL_FEATURES_FALLBACK;
  record.hairstyle_grooming =
    typeof record.hairstyle_grooming === "string" && record.hairstyle_grooming.trim()
      ? record.hairstyle_grooming
      : BACKSTORY_HAIRSTYLE_GROOMING_FALLBACK;
  record.wardrobe_details =
    typeof record.wardrobe_details === "string" && record.wardrobe_details.trim()
      ? record.wardrobe_details
      : BACKSTORY_WARDROBE_DETAILS_FALLBACK;
  record.posture_body_language =
    typeof record.posture_body_language === "string" && record.posture_body_language.trim()
      ? record.posture_body_language
      : BACKSTORY_POSTURE_BODY_LANGUAGE_FALLBACK;
  record.expression_style =
    typeof record.expression_style === "string" && record.expression_style.trim()
      ? record.expression_style
      : BACKSTORY_EXPRESSION_STYLE_FALLBACK;
  record.speaking_energy = BACKSTORY_SPEAKING_ENERGY_FALLBACK;
  record.body_build =
    typeof record.body_build === "string" && record.body_build.trim()
      ? record.body_build
      : BACKSTORY_BODY_BUILD_FALLBACK;
  record.speaking_style = [...BACKSTORY_SPEAKING_STYLE_LOCK];
  record.wardrobe_props = normalizeFixedList(record.wardrobe_props, 2, WARDROBE_CLEAN_FALLBACK);
  record.compliance_notes = normalizeFixedList(record.compliance_notes, 2, "Follow product constraints and avoid exaggerated claims.");
  return record;
}

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countNormalizedValues(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = normalizeComparableText(value);
    if (!normalized) {
      continue;
    }
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return counts;
}

function isRepeatedInRecentWindow(candidate: string, recentValues: string[], windowSize = BACKSTORY_RECENT_WINDOW): boolean {
  const normalizedCandidate = normalizeComparableText(candidate);
  if (!normalizedCandidate) {
    return false;
  }

  const recentWindow = recentValues.slice(0, Math.max(0, windowSize));
  const repeatedInWindow = recentWindow.some((value) => normalizeComparableText(value) === normalizedCandidate);
  if (repeatedInWindow) {
    return true;
  }

  const totalMatches = recentValues.reduce(
    (count, value) => (normalizeComparableText(value) === normalizedCandidate ? count + 1 : count),
    0
  );
  return totalMatches >= 2;
}

function pickLeastUsedOption(options: readonly string[], recentValues: string[]): string {
  if (options.length === 0) {
    return "";
  }

  const counts = countNormalizedValues(recentValues);
  const ranked = options
    .map((option) => ({
      option,
      count: counts.get(normalizeComparableText(option)) ?? 0,
      tieBreak: Math.random()
    }))
    .sort((left, right) => left.count - right.count || left.tieBreak - right.tieBreak);
  return ranked[0]?.option ?? options[0] ?? "";
}

function normalizeGenderPresentation(value: string | undefined): GenderPresentation | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "man" || normalized === "woman") {
    return normalized;
  }
  return null;
}

function alignTextGenderPresentation(value: string, gender: GenderPresentation): string {
  if (!value.trim()) {
    return value;
  }

  let next = value;
  if (gender === "woman") {
    next = next
      .replace(/\bHe\b/g, "She")
      .replace(/\bhe\b/g, "she")
      .replace(/\bHis\b/g, "Her")
      .replace(/\bhis\b/g, "her")
      .replace(/\bHim\b/g, "Her")
      .replace(/\bhim\b/g, "her")
      .replace(/\bHimself\b/g, "Herself")
      .replace(/\bhimself\b/g, "herself")
      .replace(/\b(baritone|bass)\b/gi, "mid-register");
  } else {
    next = next
      .replace(/\bShe\b/g, "He")
      .replace(/\bshe\b/g, "he")
      .replace(/\bHer\b/g, "His")
      .replace(/\bher\b/g, "his")
      .replace(/\bHers\b/g, "His")
      .replace(/\bhers\b/g, "his")
      .replace(/\bHerself\b/g, "Himself")
      .replace(/\bherself\b/g, "himself")
      .replace(/\b(alto|soprano)\b/gi, "mid-register");
  }

  return next.replace(/\s+/g, " ").trim();
}

function enforceBackstoryGenderConsistency(input: Backstory): Backstory {
  const gender = normalizeGenderPresentation(input.gender_presentation) ?? inferGenderPresentationFromName(input.persona_name) ?? "man";
  const hasMaleGroomingCue = /\b(beard|bearded|stubble|mustache|moustache|goatee)\b/i;

  const facialFeatures = alignTextGenderPresentation(input.facial_features, gender);
  const hairstyleGroomingAligned = alignTextGenderPresentation(input.hairstyle_grooming, gender);
  const hairstyleGrooming =
    gender === "woman" && hasMaleGroomingCue.test(hairstyleGroomingAligned)
      ? BACKSTORY_HAIRSTYLE_GROOMING_FALLBACK
      : hairstyleGroomingAligned;
  const speakingStyle = input.speaking_style.map((item) => alignTextGenderPresentation(item, gender));

  return {
    ...input,
    why_they_care: alignTextGenderPresentation(input.why_they_care, gender),
    facial_features:
      gender === "woman" && hasMaleGroomingCue.test(facialFeatures)
        ? BACKSTORY_FACIAL_FEATURES_FALLBACK
        : facialFeatures,
    hairstyle_grooming: hairstyleGrooming,
    posture_body_language: alignTextGenderPresentation(input.posture_body_language, gender),
    expression_style: alignTextGenderPresentation(input.expression_style, gender),
    speaking_energy: alignTextGenderPresentation(input.speaking_energy, gender),
    body_build: alignTextGenderPresentation(input.body_build, gender),
    speaking_style: speakingStyle
  };
}

function createEmptyRecentBackstorySignals(): RecentBackstorySignals {
  return {
    names: [],
    gender_presentations: [],
    cities: [],
    professions: [],
    settings: [],
    wardrobe_signatures: []
  };
}

function hasRecentBackstorySignals(value: RecentBackstorySignals | undefined): boolean {
  if (!value) {
    return false;
  }
  return (
    value.names.length > 0 ||
    value.gender_presentations.length > 0 ||
    value.cities.length > 0 ||
    value.professions.length > 0 ||
    value.settings.length > 0 ||
    value.wardrobe_signatures.length > 0
  );
}

function inferWardrobeSignature(details: string): string {
  const normalized = normalizeComparableText(details);
  if (!normalized) {
    return "generic-premium";
  }
  if (/\b(blouse|camisole|cami|trench|wrap|duster|wide leg|wide-leg|high waisted|high-waisted)\b/.test(normalized)) {
    return "soft-tailored-womens-separates";
  }
  if (/\b(cashmere cardigan|cardigan|merino crewneck|crewneck|crew neck)\b/.test(normalized)) {
    return "soft-knit-layering";
  }
  if (/\b(band collar|band-collar|mandarin|camp collar|camp-collar|open collar|open-collar|shirt)\b/.test(normalized)) {
    return "refined-shirting";
  }
  if (/\b(overshirt|travel coat|coat)\b/.test(normalized)) {
    return "soft-structured-layering";
  }
  if (/\b(zip polo|zip-polo|knit polo|polo)\b/.test(normalized) && /\b(blazer|tailoring|jacket)\b/.test(normalized)) {
    return "knit-polo-tailoring";
  }
  if (/\b(blazer|jacket|tailoring)\b/.test(normalized)) {
    return "soft-tailoring";
  }
  if (/\b(knit|merino|cashmere|mock neck|mock-neck)\b/.test(normalized)) {
    return "refined-knit-separates";
  }
  return "generic-premium";
}

function mergeRecentBackstorySignals(...sources: Array<RecentBackstorySignals | undefined>): RecentBackstorySignals {
  const merged = createEmptyRecentBackstorySignals();
  for (const source of sources) {
    if (!source) {
      continue;
    }
    merged.names.push(...source.names);
    merged.gender_presentations.push(...source.gender_presentations);
    merged.cities.push(...source.cities);
    merged.professions.push(...source.professions);
    merged.settings.push(...source.settings);
    merged.wardrobe_signatures.push(...source.wardrobe_signatures);
  }
  return merged;
}

function getRuntimeRecentBackstorySignals(product: ProductKey): RecentBackstorySignals {
  return runtimeRecentBackstorySignalsByProduct.get(product) ?? createEmptyRecentBackstorySignals();
}

function pushRecentSignal(target: string[], value: string, maxCount = 24): void {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return;
  }
  target.unshift(normalized);
  if (target.length > maxCount) {
    target.length = maxCount;
  }
}

function recordRuntimeRecentBackstory(product: ProductKey, backstory: Backstory): void {
  const current = getRuntimeRecentBackstorySignals(product);
  const next = mergeRecentBackstorySignals(createEmptyRecentBackstorySignals(), current);
  pushRecentSignal(next.names, backstory.persona_name);
  pushRecentSignal(next.gender_presentations, backstory.gender_presentation);
  pushRecentSignal(next.cities, backstory.city);
  pushRecentSignal(next.professions, backstory.profession);
  pushRecentSignal(next.settings, backstory.setting);
  pushRecentSignal(next.wardrobe_signatures, inferWardrobeSignature(backstory.wardrobe_details));
  runtimeRecentBackstorySignalsByProduct.set(product, next);
}

function inferGenderPresentationFromName(personaName: string): GenderPresentation | null {
  const firstName = personaName.split(/\s+/)[0]?.trim();
  if (!firstName) {
    return null;
  }
  if (PERSONA_FIRST_NAMES_WOMEN.includes(firstName as (typeof PERSONA_FIRST_NAMES_WOMEN)[number])) {
    return "woman";
  }
  if (PERSONA_FIRST_NAMES_MEN.includes(firstName as (typeof PERSONA_FIRST_NAMES_MEN)[number])) {
    return "man";
  }
  return null;
}

function isPersonaNameAlignedWithGender(personaName: string, gender: GenderPresentation): boolean {
  const firstName = personaName.split(/\s+/)[0]?.trim();
  if (!firstName) {
    return false;
  }
  return gender === "woman"
    ? PERSONA_FIRST_NAMES_WOMEN.includes(firstName as (typeof PERSONA_FIRST_NAMES_WOMEN)[number])
    : PERSONA_FIRST_NAMES_MEN.includes(firstName as (typeof PERSONA_FIRST_NAMES_MEN)[number]);
}

function inferGenderPresentationFromBrief(brief?: string): GenderPresentation | null {
  const normalized = normalizeComparableText(brief ?? "");
  if (!normalized) {
    return null;
  }
  if (/\b(woman|women|female|she|her|hers|foundress|mom|mother|girl)\b/.test(normalized)) {
    return "woman";
  }
  if (/\b(man|men|male|he|him|his|boy|father|husband)\b/.test(normalized)) {
    return "man";
  }
  return null;
}

function pickDistinctPersonaName(recentNames: string[], preferredGender: GenderPresentation = "man"): string {
  const recentWindow = recentNames.slice(0, BACKSTORY_RECENT_WINDOW);
  const recent = new Set(recentWindow.map((value) => normalizeComparableText(value)));
  const firstNamePool = preferredGender === "woman" ? PERSONA_FIRST_NAMES_WOMEN : PERSONA_FIRST_NAMES_MEN;

  const firstNameCounts = new Map<string, number>();
  const lastNameCounts = new Map<string, number>();
  for (const recentName of recentWindow) {
    const [recentFirst, recentLast] = recentName.split(/\s+/, 2);
    if (recentFirst) {
      firstNameCounts.set(recentFirst, (firstNameCounts.get(recentFirst) ?? 0) + 1);
    }
    if (recentLast) {
      lastNameCounts.set(recentLast, (lastNameCounts.get(recentLast) ?? 0) + 1);
    }
  }

  const rankedFirstNames = [...firstNamePool]
    .map((name) => ({ name, count: firstNameCounts.get(name) ?? 0, tieBreak: Math.random() }))
    .sort((left, right) => left.count - right.count || left.tieBreak - right.tieBreak)
    .map((item) => item.name);
  const rankedLastNames = [...PERSONA_LAST_NAMES]
    .map((name) => ({ name, count: lastNameCounts.get(name) ?? 0, tieBreak: Math.random() }))
    .sort((left, right) => left.count - right.count || left.tieBreak - right.tieBreak)
    .map((item) => item.name);

  for (const first of rankedFirstNames) {
    for (const last of rankedLastNames) {
      const candidate = `${first} ${last}`;
      if (!recent.has(normalizeComparableText(candidate))) {
        return candidate;
      }
    }
  }

  return `${rankedFirstNames[0] ?? firstNamePool[0] ?? PERSONA_FIRST_NAMES[0]} ${rankedLastNames[0] ?? PERSONA_LAST_NAMES[0]}`;
}

function getCityPool(product: ProductKey): readonly string[] {
  return product === "kotak_air_plus" ? AIR_PLUS_CITY_POOL : CASHBACK_CITY_POOL;
}

function getProfessionPool(product: ProductKey): readonly string[] {
  return product === "kotak_air_plus" ? AIR_PLUS_PROFESSION_POOL : CASHBACK_PROFESSION_POOL;
}

function normalizeBackstoryIdentity(
  input: Backstory,
  product: ProductKey,
  recentSignals: RecentBackstorySignals,
  brief?: string
): Backstory {
  const personaName = input.persona_name.replace(/\s+/g, " ").trim();
  const genderPresentation =
    normalizeGenderPresentation(input.gender_presentation) ?? inferGenderPresentationFromName(personaName);
  const personaNameGender = inferGenderPresentationFromName(personaName);
  const city = input.city.replace(/\s+/g, " ").trim();
  const profession = input.profession.replace(/\s+/g, " ").trim();
  const recentGenderWindow = recentSignals.gender_presentations.slice(0, BACKSTORY_RECENT_WINDOW);
  const briefGender = inferGenderPresentationFromBrief(brief);
  const preferredGender =
    briefGender ??
    (pickLeastUsedOption(
      ["woman", "man"],
      recentGenderWindow.length > 0 ? recentGenderWindow : recentSignals.gender_presentations
    ) as GenderPresentation);
  const shouldForcePreferredGender =
    !briefGender &&
    recentGenderWindow.length >= 4 &&
    genderPresentation !== null &&
    genderPresentation !== preferredGender;
  const safeGender = shouldForcePreferredGender ? preferredGender : genderPresentation ?? preferredGender;

  const safePersonaName =
    !personaName ||
    isRepeatedInRecentWindow(personaName, recentSignals.names) ||
    !isPersonaNameAlignedWithGender(personaName, safeGender) ||
    (personaNameGender !== null && personaNameGender !== safeGender)
      ? pickDistinctPersonaName(recentSignals.names, safeGender)
      : personaName;

  const safeCity =
    !city || isRepeatedInRecentWindow(city, recentSignals.cities)
      ? pickLeastUsedOption(getCityPool(product), recentSignals.cities)
      : city;

  const safeProfession =
    !profession || isRepeatedInRecentWindow(profession, recentSignals.professions)
      ? pickLeastUsedOption(getProfessionPool(product), recentSignals.professions)
      : profession;

  return {
    ...input,
    persona_name: safePersonaName,
    gender_presentation: safeGender,
    city: safeCity,
    profession: safeProfession
  };
}

function scrubBackstoryDevices(
  input: Backstory,
  script: string,
  product: ProductKey,
  recentSignals: RecentBackstorySignals,
  brief?: string
): Backstory {
  const safeWardrobe: string[] = [];
  for (const item of input.wardrobe_props) {
    if (DEVICE_PATTERN.test(item)) {
      continue;
    }

    const normalized = item.replace(/\s+/g, " ").trim();
    const sanitizedCue =
      !normalized || SWEAT_SPOT_PATTERN.test(normalized) || WRINKLED_CLOTHES_PATTERN.test(normalized)
        ? WARDROBE_CLEAN_FALLBACK
        : normalized;
    if (!safeWardrobe.some((existing) => normalizeComparableText(existing) === normalizeComparableText(sanitizedCue))) {
      safeWardrobe.push(sanitizedCue);
    }
  }

  while (safeWardrobe.length < 2) {
    safeWardrobe.push(WARDROBE_CLEAN_FALLBACK);
  }

  const recentSettings = recentSignals.settings;
  const locationPolicy = deriveSceneLocationPolicy(script, product, brief);
  const fallbackSetting = pickVariedSetting(locationPolicy.settings, recentSettings);
  const safeSetting = resolveBackstorySetting(input, script, product, fallbackSetting, recentSettings, brief);

  const sanitized = {
    ...input,
    wardrobe_props: safeWardrobe.slice(0, 2),
    setting: safeSetting
  };

  const normalizedIdentity = normalizeBackstoryIdentity(sanitized, product, recentSignals, brief);
  const forceWardrobeRewrite =
    normalizeGenderPresentation(sanitized.gender_presentation) !==
    normalizeGenderPresentation(normalizedIdentity.gender_presentation);

  return enforceBackstoryGenderConsistency(
    contextualizeBackstoryWardrobe(normalizedIdentity, product, recentSignals, forceWardrobeRewrite)
  );
}

function getBackstoryPrompt(
  script: string,
  product: ProductKey,
  guidelines?: string,
  brief?: string,
  recentSignals: RecentBackstorySignals = createEmptyRecentBackstorySignals()
): string {
  const brandName = product === "kotak_air_plus" ? "Kotak Mahindra Bank - Kotak Air Plus" : "Kotak Mahindra Bank - Kotak Cashback";
  const categoryContext =
    product === "kotak_air_plus"
      ? "Travel and transit-focused credit card category."
      : "Daily-spend and cashback-focused credit card category.";
  const compactBrief = compactPromptContext(brief, 420);
  const briefHints = deriveBackstoryBriefHints(script, product, brief);
  const preferredAnchors = Array.from(
    new Set([...briefHints.preferredOutdoorSettings, ...briefHints.preferredIndoorSettings])
  ).slice(0, 8);
  const preferredGenderPresentation = pickLeastUsedOption(
    ["woman", "man"],
    recentSignals.gender_presentations.slice(0, BACKSTORY_RECENT_WINDOW)
  ) as GenderPresentation;
  const productSettingGuardrail =
    product === "kotak_air_plus"
      ? "Air Plus setting guardrail: do not place the persona in railway stations, train platforms, metro transfers, bus terminals, generic corridors, heliports, palace hotels, resort-campaign spaces, or fantasy-luxury hospitality worlds. Keep the setting anchored in believable travel-day worlds like airport-adjacent movement, transfer zones, business-hotel arrival, terminal connectors, check-in approach, curbside pickup, luggage-ready hotel entry, or realistic pre-departure mobility moments."
      : "Cashback+ setting guardrail: do not place the persona in airports, hotels, resorts, boutique hospitality spaces, coffee shops, cafes, restaurants, store aisles, malls, supermarket checkouts, or glossy retail worlds unless the brief explicitly demands them. Keep the setting anchored in believable home-delivery, OTT-at-home, entryway, kitchen, dining nook, balcony, commute, or fuel-stop environments.";

  return [
    "You are a Senior Casting Director and a Professional Cinematographer.",
    "Your goal is to create a Real Person character profile that looks like a character from ad films.",
    "The country is always in reference to India.",
    "Treat the backstory as the source of truth for the character's core identity, personality, lifestyle context, and emotional logic.",
    "Input: [Brand Name] and [Basic Concept].",
    `Brand Name: ${brandName}`,
    `Basic Concept: ${script}`,
    `Category Context: ${categoryContext}`,
    compactBrief ? `Campaign brief context: ${compactBrief}` : "",
    "Your Task: Create a character profile with the following sections:",
    "1. The Human Profile",
    "- Identity: Name, gender presentation, Age (specific, e.g., 43), and their Daily Grind (what they actually do for a living).",
    "- The Why: Their deep motivation for using the brand.",
    "2. The Non-Generic Visual Directive",
    "- Skin & Texture: Describe skin in detail and avoid perfect skin.",
    "- Face and structure: describe facial features with specificity, including eyebrow shape, nose structure, lip shape, jawline, cheek structure, and overall facial character.",
    "- Hair and grooming: describe hairstyle, grooming, and small real-world grooming details.",
    "- Body: describe body build, posture, and natural body language.",
    "- Expression: describe how expression shifts while speaking and what emotional texture the face carries.",
    "- Speaking energy: describe the visible energy of speech and how the person physically carries the line.",
    "- Wardrobe Texture: Costume relevant to what is in fashion for this character and TG.",
    "- Wardrobe Hygiene: Always clean, well-ironed, wrinkle-free clothing. No sweat spots, damp patches, or perspiration marks.",
    "- Wardrobe Context: wardrobe must respond to the chosen setting, travel moment, weather, time of day, and social environment. Do not default to the same navy blazer formula unless the setting truly supports it.",
    "- For male premium-travel personas, actively vary beyond the same blazer-and-knit formula when the setting allows it. Use refined shirting, soft knitwear, overshirts, travel coats, premium polos, or tailored separates to create distinct silhouettes.",
    "- In resort or scenic getaway contexts, prefer resort-smart, climate-aware, premium leisure or relaxed-arrival dressing rather than generic corporate tailoring.",
    "- In lounge, airport-adjacent, or business-travel contexts, use elevated travel tailoring, knitwear, smart separates, or refined arrival wear that feels natural in transit rather than boardroom-coded.",
    "- Women and men are both valid casting choices. Do not default to male personas when the brief is neutral.",
    "- Avoid repeating stock-photo faces, overly idealized influencer features, or identical grooming patterns across outputs.",
    "- Include natural human variation and small imperfections where appropriate, such as skin texture, asymmetry, flyaway hair, under-eye detail, or lived-in facial character.",
    "3. The Phone-Camera Technical Prompt",
    "- Composition: specify a believable phone-camera framing rather than a studio portrait.",
    "- Lighting: avoid studio lights and use lived-in available light.",
    "- Image quality: include ordinary phone-camera softness, natural skin tones, mild noise/compression character, and only subtle motion softness when appropriate.",
    "- Tone: authentic and grounded. Absolutely no marketing-perfect imagery, no fashion-editorial polish, and no portrait-mode glamour.",
    "4. Setting",
    "- The setting of the character must be contextual to the script, brand, and category.",
    "- Phone-shot plausibility matters: choose worlds that could plausibly be captured quickly on an iPhone, not hero-location fantasies or luxury campaign environments unless explicitly required.",
    "- Use target-audience cues from the campaign brief to shape profession, city, and wardrobe whenever they are present.",
    "- If the campaign brief or script references a setting family, travel moment, or environment, prioritize that over generic defaults.",
    briefHints.audienceCues.length > 0 ? `- Brief-derived audience cues: ${briefHints.audienceCues.join(" | ")}` : "",
    briefHints.settingCues.length > 0 ? `- Brief-derived setting cues: ${briefHints.settingCues.join(" | ")}` : "",
    preferredAnchors.length > 0 ? `- Preferred setting anchors from script + brief: ${preferredAnchors.join(" | ")}` : "",
    `- Cast this generation as a ${preferredGenderPresentation} unless the brief explicitly requires the other presentation.`,
    productSettingGuardrail,
    "Output format requirement:",
    "Return STRICT JSON only with keys: persona_name, gender_presentation, age_range, city, profession, why_they_care, facial_features, hairstyle_grooming, wardrobe_details, posture_body_language, expression_style, speaking_energy, body_build, speaking_style, wardrobe_props, setting, compliance_notes",
    "Field mapping:",
    "- persona_name: Identity name.",
    '- gender_presentation: exactly one of "man" or "woman".',
    '- age_range: one specific age as a string number between "25" and "38" inclusive.',
    "- city: Indian city that naturally fits the persona and concept.",
    "- profession: Daily Grind in one concise line.",
    "- why_they_care: deep motivation for using the brand.",
    "- facial_features: one descriptive sentence covering facial structure, brows, nose, lips, jaw, cheeks, skin texture, and non-generic human character.",
    "- hairstyle_grooming: one descriptive sentence covering hairstyle, grooming, and believable grooming texture.",
    "- wardrobe_details: one descriptive sentence covering wardrobe silhouette, fabrics, styling, realistic premium detail, and why the outfit fits this exact setting and travel moment.",
    "- posture_body_language: one descriptive sentence covering posture, stance, shoulders, weight shifts, gesture behavior, and physical presence. Make it usable for motion: natural, not mannequin-still, and not generic.",
    "- expression_style: one descriptive sentence covering expression behavior, eye activity, brow response, smile changes, and emotional responsiveness while speaking. Make it specific enough that facial changes can track the script beat by beat instead of holding one fixed expression.",
    `- speaking_energy: always exactly "${BACKSTORY_SPEAKING_ENERGY_FALLBACK}"`,
    "- body_build: one descriptive sentence covering overall body build and proportions in a believable way.",
    `- speaking_style: always exactly these 3 strings: ${BACKSTORY_SPEAKING_STYLE_LOCK.join(" | ")}`,
    "- wardrobe_props: exactly 2 strings describing wardrobe texture and styling cues. Must be well-ironed, wrinkle-free, and without sweat spot references.",
    "- setting: one specific, contextual setting sentence grounded in real iPhone-shoot plausibility rather than glossy ad-world location styling.",
    "- compliance_notes: exactly 2 strings. First: phone-camera technical direction (lens/framing, lighting, image quality). Second: authenticity guardrail (non-generic, grounded, non-marketing-perfect).",
    recentSignals.settings.length > 0
      ? `- avoid repeating these recent settings or close variants: ${recentSignals.settings.slice(0, 10).join(" | ")}`
      : "",
    "- Movement and facial behavior must feel photographically natural, not mannequin-still, robotic, looped, or over-directed.",
    "- Avoid defaulting to vague phrases like confident smile or calm authority unless they are grounded in visible facial and body behavior.",
    recentSignals.names.length > 0
      ? `- avoid reusing these recent persona names: ${recentSignals.names.slice(0, 10).join(" | ")}`
      : "",
    recentSignals.cities.length > 0
      ? `- avoid overusing these recent cities: ${recentSignals.cities.slice(0, 10).join(" | ")}`
      : "",
    recentSignals.professions.length > 0
      ? `- avoid repeating these recent professions: ${recentSignals.professions.slice(0, 10).join(" | ")}`
      : "",
    `Product Key: ${product}`,
    guidelines?.trim() ? `Additional brand guidelines:\n${guidelines.trim()}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

interface ScriptVisualContext {
  primary: string;
  secondary: string;
  activity: string;
}

type LocationType = "indoor" | "outdoor";

interface SceneDirection {
  location_type: LocationType;
  chosen_setting: string;
  activity: string;
  backdrop_layers: string[];
  prop_story: string[];
  ambience: string;
  framing: string;
}

const sceneDirectionSchema = z.object({
  location_type: z.enum(["indoor", "outdoor"]),
  chosen_setting: z.coerce.string().min(1),
  activity: z.coerce.string().min(1),
  backdrop_layers: z.array(z.coerce.string().min(1)).min(3).max(6),
  prop_story: z.array(z.coerce.string().min(1)).min(2).max(6),
  ambience: z.coerce.string().min(1),
  framing: z.coerce.string().min(1)
});

const VISUAL_EXCLUSION_PATTERN =
  /\b(phone|smartphone|mobile|cellphone|laptop|tablet|ipad|monitor|screen|display|tv|television|smartwatch|watch face|ui|interface|credit\s*card|debit\s*card|payment\s*card|card\s*mockup|physical\s*card|caption|subtitle|super|overlay text|logo|watermark|celebrity|public figure|lookalike|likeness)\b/i;
const GENERIC_HOME_PATTERN = /\b(living room|home office|bedroom|sofa|apartment living area|drawing room)\b/i;
const INDOOR_BIAS_SETTING_PATTERN =
  /\b(apartment|home office|living room|study|bookshelf|shelf|framed world map|world map|minimalist corner|interior corner)\b/i;

interface SceneLocationPolicy {
  locationType: LocationType;
  settings: string[];
  avoid: string[];
  reason: string;
  allowHomeContext: boolean;
}

interface BackstoryBriefHints {
  audienceCues: string[];
  settingCues: string[];
  preferredIndoorSettings: string[];
  preferredOutdoorSettings: string[];
  locationTypeBias?: LocationType;
  hasBusinessTravelCue: boolean;
  hasLeisureTravelCue: boolean;
  explicitAirportMoment: boolean;
  allowHomeContext: boolean;
}

function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function appendUnique(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function prioritizeSettings(base: string[], preferred: string[]): string[] {
  return Array.from(new Set([...preferred, ...base]));
}

function deriveBackstoryBriefHints(script: string, product: ProductKey, brief?: string): BackstoryBriefHints {
  const source = `${script} ${brief ?? ""}`.toLowerCase();
  const audienceCues: string[] = [];
  const settingCues: string[] = [];
  const preferredIndoorSettings: string[] = [];
  const preferredOutdoorSettings: string[] = [];

  const hasBusinessTravelCue =
    /\b(business|corporate|client|meeting|conference|consultant|founder|boardroom|work trip|sales leader|executive|frequent flyer)\b/.test(
      source
    );
  const hasLeisureTravelCue =
    /\b(vacation|holiday|getaway|weekend trip|escape|resort|beach|staycation|leisure|couple|family|coastal|waterfront|scenic|mountain|hillside|retreat|seaside|beachfront)\b/.test(
      source
    );
  const explicitAirportMoment = /\b(airport|flight|boarding|departure|terminal|check[-\s]?in|boarding gate|aero[-\s]?bridge)\b/.test(source);
  const allowHomeContext = /\b(home|at home|house|apartment|kitchen|balcony|entryway)\b/.test(source);

  if (/\b(affluent|premium|luxury|upscale|hni|high net worth)\b/.test(source)) {
    audienceCues.push("affluent premium Indian audience");
  }
  if (/\b(metro|metro cities|urban|tier[-\s]?1|top cities)\b/.test(source)) {
    audienceCues.push("metro-city audience");
  }
  if (hasBusinessTravelCue) {
    audienceCues.push("frequent business-travel audience");
  }
  if (hasLeisureTravelCue) {
    audienceCues.push("premium leisure-travel audience");
  }
  if (/\b(young professionals?|millennials?|gen z|startup)\b/.test(source)) {
    audienceCues.push("young urban professional audience");
  }

  if (/\b(hotel|concierge|lobby|check[-\s]?out|check[-\s]?in|valet|foyer|reception)\b/.test(source)) {
    settingCues.push("premium hotel arrival or concierge setting");
    appendUnique(preferredIndoorSettings, [
      "Private lounge check-in foyer with polished luggage and warm premium travel styling",
      "Concierge alcove beside luggage carts in a refined boutique hotel lobby",
      "Premium hotel concierge zone with departure preparation context",
      "Travel-day hotel lobby near checkout with packed luggage context"
    ]);
    appendUnique(preferredOutdoorSettings, [
      "Premium hotel porte-cochere with arriving cabs and polished luggage flow",
      "Luxury hotel valet canopy during a clean departure handoff with carry-on context",
      "Destination hotel forecourt with premium arrival or departure energy"
    ]);
  }
  if (/\b(lounge|club lounge|boarding gate|aero[-\s]?bridge)\b/.test(source)) {
    settingCues.push("premium lounge-adjacent setting");
    appendUnique(preferredIndoorSettings, [
      "Airline lounge reception threshold with a travel-ready pause before boarding",
      "Executive club lounge with boarding-time calm and a neatly placed carry-on nearby",
      "Lounge-adjacent seating corner with natural travel-day downtime"
    ]);
  }
  if (explicitAirportMoment) {
    settingCues.push("airport departure or boarding moment");
    appendUnique(preferredOutdoorSettings, [
      "Airport express drop-off lane with premium check-in energy and rolling suitcase motion",
      "Terminal parking-to-departures skybridge with premium commuter flow and rolling luggage",
      "Terminal approach walkway with rolling luggage and commuter movement"
    ]);
    appendUnique(preferredIndoorSettings, [
      "Terminal check-in queuing area with luggage prep moment",
      "Premium transit gallery with glass, stone, and warm ambient departure lighting",
      "Transit hub interior walkway with realistic departure energy"
    ]);
  }
  if (/\b(cab|taxi|chauffeur|pickup|drop[-\s]?off|transfer|forecourt|curbside|driveway)\b/.test(source)) {
    settingCues.push("premium transfer or pickup setting");
    appendUnique(preferredOutdoorSettings, [
      "Chauffeur pickup bay outside a business hotel with refined carry-on travel context",
      "Private transfer bay outside a luxury stay with subtle concierge activity and luggage flow",
      "Business district pickup point with carry-on luggage context"
    ]);
    appendUnique(preferredIndoorSettings, [
      "Chauffeur waiting salon inside a hotel arrival hall with muted premium transfer cues"
    ]);
  }
  if (hasLeisureTravelCue) {
    settingCues.push("getaway or leisure-travel setting");
    appendUnique(preferredOutdoorSettings, [
      "Destination-side promenade with warm getaway energy and refined luggage styling",
      "City promenade near a hotel district with polished travel styling",
      "Waterfront promenade outside a luxury stay with scenic getaway energy and refined luggage styling",
      "Coastal resort arrival path with sea-breeze travel styling and premium luggage context",
      "Hillside luxury stay driveway with panoramic getaway movement and polished carry-on cues"
    ]);
    appendUnique(preferredIndoorSettings, [
      "Boutique stay lobby with relaxed getaway mood and premium travel cues",
      "Contemporary hotel lounge with affluent Indian travel lifestyle cues",
      "Sea-facing resort reception lounge with warm daylight and departure-ready luggage",
      "Hillside retreat lounge with panoramic windows and quiet getaway travel calm"
    ]);
  }
  if (hasBusinessTravelCue) {
    appendUnique(preferredOutdoorSettings, [
      "Corporate district drop-off zone before a business trip with polished carry-on luggage"
    ]);
    appendUnique(preferredIndoorSettings, [
      "Executive hotel lounge before a meeting-day departure with refined business-travel cues",
      "Corporate mobility lounge with business-travel departure cues"
    ]);
  }

  let locationTypeBias: LocationType | undefined;
  const outdoorBiasCount = [
    /\b(valet|porte[-\s]?cochere|curbside|pickup|drop[-\s]?off|transfer|approach|drive|forecourt|promenade|skybridge|coastal|waterfront|beach|hillside|scenic|retreat|boardwalk)\b/.test(source),
    /\b(outdoor|outside|street|roadside)\b/.test(source)
  ].filter(Boolean).length;
  const indoorBiasCount = [
    /\b(lounge|lobby|concierge|foyer|reception|corridor|hall|gallery|check[-\s]?in|check[-\s]?out)\b/.test(source),
    /\b(indoor|inside|interior)\b/.test(source)
  ].filter(Boolean).length;
  if (outdoorBiasCount > indoorBiasCount) {
    locationTypeBias = "outdoor";
  } else if (indoorBiasCount > outdoorBiasCount) {
    locationTypeBias = "indoor";
  }

  return {
    audienceCues,
    settingCues,
    preferredIndoorSettings,
    preferredOutdoorSettings,
    locationTypeBias,
    hasBusinessTravelCue,
    hasLeisureTravelCue,
    explicitAirportMoment,
    allowHomeContext
  };
}

function normalizeSettingText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSetting(value: string): string[] {
  return normalizeSettingText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !SETTING_STOPWORDS.has(token));
}

function settingSimilarityScore(left: string, right: string): number {
  const leftTokens = new Set(tokenizeSetting(left));
  const rightTokens = new Set(tokenizeSetting(right));

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  const union = leftTokens.size + rightTokens.size - overlap;
  return union > 0 ? overlap / union : 0;
}

function countMatchingSettings(pattern: RegExp, values: string[]): number {
  return values.reduce((count, value) => (pattern.test(value) ? count + 1 : count), 0);
}

function isOverusedSettingMotif(candidate: string, recentSettings: string[]): boolean {
  if (!AIRPORT_CURBSIDE_PATTERN.test(candidate)) {
    return false;
  }
  return countMatchingSettings(AIRPORT_CURBSIDE_PATTERN, recentSettings) >= 1;
}

function isSettingRepeated(candidate: string, recentSettings: string[]): boolean {
  if (!candidate || recentSettings.length === 0) {
    return false;
  }

  const normalizedCandidate = normalizeSettingText(candidate);
  if (!normalizedCandidate) {
    return false;
  }

  return recentSettings.some((setting) => {
    const normalizedRecent = normalizeSettingText(setting);
    if (!normalizedRecent) {
      return false;
    }
    return (
      normalizedRecent === normalizedCandidate ||
      settingSimilarityScore(normalizedRecent, normalizedCandidate) >= SETTING_SIMILARITY_THRESHOLD
    );
  }) || isOverusedSettingMotif(candidate, recentSettings);
}

function pickVariedSetting(values: string[], recentSettings: string[]): string {
  if (values.length === 0) {
    return "";
  }

  const pool = values.filter((value) => !isSettingRepeated(value, recentSettings));
  const options = pool.length > 0 ? pool : values;
  return options[Math.floor(Math.random() * options.length)] ?? values[0] ?? "";
}

async function getRecentBackstorySignalsForProduct(
  product: ProductKey,
  maxCount = 20
): Promise<RecentBackstorySignals> {
  const jobs = await listJobs(120);
  const backstories = jobs
    .filter((job) => job.product === product && job.backstory)
    .map((job) => job.backstory as Backstory)
    .slice(0, Math.max(maxCount, 40));

  const signals: RecentBackstorySignals = createEmptyRecentBackstorySignals();

  for (const item of backstories) {
    const name = item.persona_name?.trim();
    const genderPresentation =
      normalizeGenderPresentation((item as Partial<Backstory>).gender_presentation) ??
      inferGenderPresentationFromName(item.persona_name ?? "");
    const city = item.city?.trim();
    const profession = item.profession?.trim();
    const setting = item.setting?.trim();
    const wardrobeSignature = inferWardrobeSignature(item.wardrobe_details ?? "");

    if (name) {
      signals.names.push(name);
    }
    if (genderPresentation) {
      signals.gender_presentations.push(genderPresentation);
    }
    if (city) {
      signals.cities.push(city);
    }
    if (profession) {
      signals.professions.push(profession);
    }
    if (setting) {
      signals.settings.push(setting);
    }
    if (wardrobeSignature) {
      signals.wardrobe_signatures.push(wardrobeSignature);
    }
  }

  return {
    names: signals.names.slice(0, maxCount),
    gender_presentations: signals.gender_presentations.slice(0, maxCount),
    cities: signals.cities.slice(0, maxCount),
    professions: signals.professions.slice(0, maxCount),
    settings: Array.from(new Set(signals.settings)).slice(0, maxCount),
    wardrobe_signatures: signals.wardrobe_signatures.slice(0, maxCount)
  };
}

function resolveBackstorySetting(
  input: Backstory,
  script: string,
  product: ProductKey,
  fallbackSetting: string,
  recentSettings: string[],
  brief?: string
): string {
  const locationPolicy = deriveSceneLocationPolicy(script, product, brief);
  const candidate = input.setting.replace(/\s+/g, " ").trim();
  const scriptValue = `${script} ${brief ?? ""}`.toLowerCase();
  const unrequestedTerminalSpecificity =
    AIRPORT_CURBSIDE_PATTERN.test(candidate) &&
    TERMINAL_CODE_PATTERN.test(candidate) &&
    !TERMINAL_CODE_PATTERN.test(scriptValue);
  const disallowedAirPlusSetting =
    product === "kotak_air_plus" && AIR_PLUS_DISALLOWED_SETTING_PATTERN.test(candidate);
  const disallowedCashbackSetting =
    product === "kotak_cashback" && CASHBACK_DISALLOWED_SETTING_PATTERN.test(candidate);

  if (
    !candidate ||
    DEVICE_PATTERN.test(candidate) ||
    unrequestedTerminalSpecificity ||
    disallowedAirPlusSetting ||
    disallowedCashbackSetting
  ) {
    return fallbackSetting;
  }

  const isGenericHome = GENERIC_HOME_PATTERN.test(candidate);
  const isIndoorBias = INDOOR_BIAS_SETTING_PATTERN.test(candidate);
  const needsOutdoor = locationPolicy.locationType === "outdoor";

  if (isSettingRepeated(candidate, recentSettings)) {
    return fallbackSetting;
  }

  if ((!locationPolicy.allowHomeContext && isGenericHome) || (needsOutdoor && isIndoorBias)) {
    return fallbackSetting;
  }

  return candidate;
}

function isGenericAirPlusWardrobe(details: string): boolean {
  const normalized = normalizeComparableText(details);
  return (
    /\b(blazer|jacket)\b/.test(normalized) &&
    /\b(white|crew neck|crewneck|tee|t shirt|cotton)\b/.test(normalized) &&
    /\b(navy|linen|unstructured|wrinkle free|well ironed|premium)\b/.test(normalized)
  );
}

function isOverfitAirPlusWardrobe(
  details: string,
  setting: string,
  genderPresentation: GenderPresentation
): boolean {
  if (genderPresentation !== "man") {
    return false;
  }
  const normalizedDetails = normalizeComparableText(details);
  const normalizedSetting = normalizeComparableText(setting);
  if (!/\b(lounge|airport|terminal|departure|transfer|transit|tarmac|club|hotel|concierge|arrival|valet|lobby|porte|portico|coastal|waterfront|resort|retreat|promenade)\b/.test(normalizedSetting)) {
    return false;
  }
  return (
    /\b(blazer|jacket)\b/.test(normalizedDetails) &&
    /\b(crew neck|crewneck|tee|t shirt|t-shirt|zip polo|zip-polo|polo|mock neck|mock-neck|merino)\b/.test(normalizedDetails) &&
    /\b(navy|charcoal|white|ivory)\b/.test(normalizedDetails)
  );
}

function buildContextualWardrobeVariants(
  setting: string,
  genderPresentation: GenderPresentation
): ContextualWardrobeVariant[] {
  const normalizedSetting = normalizeComparableText(setting);
  if (/\b(coastal|waterfront|resort|retreat|promenade|hillside|seafacing|sea facing|getaway)\b/.test(normalizedSetting)) {
    return genderPresentation === "woman"
      ? [
          {
            signature: "resort-fluid-separates",
            details:
              "Resort-smart premium separates built around a fluid silk-cotton blouse, tailored wide-leg trousers, and a lightweight draped layer, creating a climate-aware arrival look that feels affluent and natural to a luxury getaway setting.",
            props: [
              "Resort-smart premium separates with fluid movement, breathable texture, and clean finishing suited to a luxury getaway arrival.",
              "Understated luxury accessory story that feels elegant and non-fussy in a scenic travel setting."
            ]
          },
          {
            signature: "resort-knit-set",
            details:
              "A refined knit top with softly tailored linen separates and a polished lightweight layer, giving the arrival moment an elevated vacation silhouette without feeling over-styled or office-coded.",
            props: [
              "Breathable resort dressing with premium texture and climate-aware layering that reads affluent but relaxed.",
              "Quiet luxury styling cues that feel native to a premium leisure arrival rather than generic ad-world wardrobe."
            ]
          },
          {
            signature: "resort-shirting",
            details:
              "A softly structured open-collar shirt with tailored resort trousers and a graceful premium wrap layer, creating a polished getaway look with believable movement and understated luxury.",
            props: [
              "Polished leisure-travel separates with fluid drape, clean lines, and a premium finish suited to a scenic arrival moment.",
              "Elegant accessory restraint that keeps the look premium, intimate, and lived-in."
            ]
          }
        ]
      : [
          {
            signature: "resort-open-collar",
            details:
              "An open-collar cotton-silk shirt with tailored drawstring trousers and a refined lightweight layer, creating a climate-aware getaway silhouette that feels premium and lived-in without falling back to corporate tailoring.",
            props: [
              "Resort-smart premium separates with breathable fabric, clean finishing, and climate-aware styling.",
              "Understated luxury travel cues that feel natural to a scenic arrival rather than boardroom-coded."
            ]
          },
          {
            signature: "resort-knit-polo",
            details:
              "A fine-gauge knit polo with relaxed pleated linen trousers and a softly textured overshirt, styled as affluent resort-smart separates that read polished without defaulting to the usual blazer formula.",
            props: [
              "Premium getaway dressing with soft texture, clean structure, and relaxed confidence suited to a luxury resort arrival.",
              "Minimal accessory story that supports the travel moment without turning into stiff ad-model styling."
            ]
          },
          {
            signature: "resort-soft-tailoring",
            details:
              "Soft travel tailoring built around an airy band-collar shirt and clean tapered trousers, giving the arrival moment polish while staying climate-aware, premium, and free of generic corporate cues.",
            props: [
              "Lightweight premium separates with breathable structure and clean travel-ready finishing.",
              "Affluent leisure-travel styling that feels intentional, elegant, and native to the resort environment."
            ]
          }
        ];
  }
  if (/\b(lounge|airport|terminal|departure|transfer|transit|tarmac|club)\b/.test(normalizedSetting)) {
    return genderPresentation === "woman"
      ? [
          {
            signature: "lounge-silk-trench",
            details:
              "Elevated travel tailoring featuring a fluid silk-crepe trench over a crisp knit or blouse with tailored wide-leg trousers, polished enough for lounge access while still feeling natural in transit.",
            props: [
              "Climate-aware lounge dressing with refined layering, fluid movement, and a quietly expensive finish.",
              "Polished transit-ready styling that feels powerful, premium, and free of generic corporate stiffness."
            ]
          },
          {
            signature: "lounge-soft-knit",
            details:
              "A fine-gauge cashmere knit with sharply tailored trousers and a soft structured outer layer, creating an executive lounge look that feels premium, relaxed, and believable in motion.",
            props: [
              "Premium transit separates with clean lines, soft texture, and movement-friendly polish.",
              "Understated luxury cues that feel native to a premium lounge without over-accessorized styling."
            ]
          },
          {
            signature: "lounge-fluid-blouse",
            details:
              "A fluid ivory blouse with tailored high-waisted trousers and a refined lightweight coat or wrap, giving the transit moment a polished, affluent silhouette with calm authority.",
            props: [
              "Elevated lounge styling with believable drape, clean finishing, and premium travel realism.",
              "Quiet luxury layering that supports motion and eye contact instead of stiff fashion posing."
            ]
          }
        ]
      : [
          {
            signature: "lounge-knit-overshirt",
            details:
              "A fine-gauge knit polo with tailored wool travel trousers and a softly structured overshirt, polished enough for lounge access without reading as a default navy-blazer business look.",
            props: [
              "Elevated transit separates with premium knit texture, clean structure, and lounge-appropriate polish.",
              "Travel-ready styling that feels affluent, comfortable in motion, and distinctly non-generic."
            ]
          },
          {
            signature: "lounge-soft-cardigan",
            details:
              "A merino crewneck layered under a soft cashmere cardigan with tapered wool trousers, creating a refined transit silhouette that feels relaxed, premium, and intentionally removed from standard corporate suiting.",
            props: [
              "Soft luxury layering with believable fabric texture and a calm lounge-ready silhouette.",
              "Premium travel styling that favors ease, warmth, and confidence over rigid office polish."
            ]
          },
          {
            signature: "lounge-refined-shirting",
            details:
              "A crisp band-collar shirt with tailored drawstring wool trousers and a lightweight travel coat, blending polish with movement-friendly comfort in a way that suits a premium airport lounge.",
            props: [
              "Refined shirting-led transit styling with clean lines, premium fabric, and calm authority.",
              "Understated executive travel cues that feel intentional without repeating the same blazer archetype."
            ]
          },
          {
            signature: "lounge-soft-tailoring",
            details:
              "Soft-shouldered travel tailoring paired with a dark olive knit top and clean tapered trousers, giving the lounge moment premium structure while avoiding the usual navy-blazer-and-tee formula.",
            props: [
              "Relaxed premium tailoring with visible texture, clean fit, and movement-friendly proportions.",
              "Lounge-appropriate styling that feels expensive and composed without hard corporate coding."
            ]
          }
        ];
  }
  if (/\b(hotel|concierge|arrival|valet|lobby|porte|portico)\b/.test(normalizedSetting)) {
    return genderPresentation === "woman"
      ? [
          {
            signature: "arrival-tailored-wrap",
            details:
              "Refined arrival dressing with a silk-blend top, tailored trousers, and a graceful lightweight duster or wrap layer, giving the hotel moment breathable polish and understated luxury.",
            props: [
              "Arrival-ready premium separates with fluid movement, clean tailoring, and believable fabric texture.",
              "Quiet luxury styling that feels natural at a high-end concierge or check-in moment."
            ]
          },
          {
            signature: "arrival-knit-separates",
            details:
              "A refined knit top with sharply cut premium separates and a softly structured outer layer, balancing composure and ease in a way that suits a high-end hotel arrival.",
            props: [
              "Breathable premium dressing with clean lines, polished fit, and natural movement in an arrival setting.",
              "Elegant, understated styling that reads affluent without becoming fashion-editorial."
            ]
          }
        ]
      : [
          {
            signature: "arrival-knit-trousers",
            details:
              "A textured knit polo with softly structured travel trousers and an elegant lightweight layer, creating a premium arrival silhouette that feels composed without defaulting to office-coded dressing.",
            props: [
              "Arrival-ready premium separates with soft structure, breathable texture, and clean travel realism.",
              "Understated luxury styling that fits a hotel or concierge moment without repeating the same blazer template."
            ]
          },
          {
            signature: "arrival-refined-shirting",
            details:
              "A refined band-collar shirt with tailored trousers and a soft premium outer layer, giving the check-in moment an affluent, movement-friendly look that feels polished and human.",
            props: [
              "Shirting-led arrival styling with premium fabric, clean lines, and a believable high-end travel read.",
              "Quiet luxury cues that feel natural in a hotel arrival scene rather than corporate or staged."
            ]
          },
          {
            signature: "arrival-soft-tailoring",
            details:
              "Soft travel tailoring built around an open-neck knit and clean tapered trousers, delivering understated luxury and arrival-ready structure without falling back to a repetitive navy-blazer formula.",
            props: [
              "Premium arrival dressing with texture, ease, and polished structure suited to a concierge or portico setting.",
              "Refined travel styling that feels affluent, breathable, and distinct from the default ad-model wardrobe."
            ]
          }
        ];
  }
  return [
    {
      signature: "generic-premium",
      details:
        "Premium, well-fitted wardrobe with realistic fabric texture and polished styling that feels natural to the setting instead of defaulting to generic ad-world corporate dressing.",
      props: [
        "Well-ironed, wrinkle-free, clean attire aligned to persona and setting.",
        "Premium styling cues that feel grounded in the chosen environment rather than a default ad-model wardrobe."
      ]
    }
  ];
}

function pickContextualWardrobeVariant(
  setting: string,
  genderPresentation: GenderPresentation,
  recentWardrobeSignatures: string[]
): ContextualWardrobeVariant {
  const variants = buildContextualWardrobeVariants(setting, genderPresentation);
  const counts = countNormalizedValues(recentWardrobeSignatures.slice(0, BACKSTORY_RECENT_WINDOW));
  const ranked = variants
    .map((variant) => ({
      variant,
      count: counts.get(normalizeComparableText(variant.signature)) ?? 0,
      tieBreak: Math.random()
    }))
    .sort((left, right) => left.count - right.count || left.tieBreak - right.tieBreak);
  return ranked[0]?.variant ?? variants[0]!;
}

function contextualizeBackstoryWardrobe(
  input: Backstory,
  product: ProductKey,
  recentSignals: RecentBackstorySignals,
  forceRewrite = false
): Backstory {
  if (product !== "kotak_air_plus") {
    return input;
  }

  const genderPresentation = normalizeGenderPresentation(input.gender_presentation) ?? "man";
  if (
    !forceRewrite &&
    !isGenericAirPlusWardrobe(input.wardrobe_details) &&
    !isOverfitAirPlusWardrobe(input.wardrobe_details, input.setting, genderPresentation)
  ) {
    return input;
  }

  const selectedVariant = pickContextualWardrobeVariant(
    input.setting,
    genderPresentation,
    recentSignals.wardrobe_signatures
  );

  return {
    ...input,
    wardrobe_details: selectedVariant.details,
    wardrobe_props: selectedVariant.props
  };
}

function deriveSceneLocationPolicy(script: string, product: ProductKey, brief?: string): SceneLocationPolicy {
  const hints = deriveBackstoryBriefHints(script, product, brief);
  const value = `${script} ${brief ?? ""}`.toLowerCase();
  const allowHomeContext = hints.allowHomeContext;
  const hasBusinessTravelCue = hints.hasBusinessTravelCue;
  const hasLeisureTravelCue = hints.hasLeisureTravelCue;

  if (/\b(fuel|petrol|diesel|refuel|gas station|pump)\b/.test(value)) {
    return {
      locationType: "outdoor",
      settings: [
        "Petrol station forecourt beside a parked car",
        "Roadside fuel stop lane with realistic urban traffic cues",
        "Car exterior near a fuel pump zone during daylight"
      ],
      avoid: ["generic living room", "home office", "blank studio wall"],
      reason: "Fuel scripts are highest fidelity in outdoor vehicle/fuel environments.",
      allowHomeContext
    };
  }

  if (/\b(travel|trip|flight|airport|boarding|journey|lounge)\b/.test(value)) {
    const explicitAirportMoment = hints.explicitAirportMoment;
    const locationType: LocationType =
      explicitAirportMoment ? "outdoor" : hints.locationTypeBias ?? (stableHash(value) % 2 === 0 ? "outdoor" : "indoor");
    let outdoorSettings = [
      "Airport express drop-off lane with realistic traveler flow and rolling cabin-bag movement",
      "Chauffeur pickup bay outside a business hotel with carry-on travel context",
      "Airport hotel arrival court with shuttle drop-off and trip-day movement",
      "Business-hotel entry lane with luggage-ready arrival energy",
      "Hotel-district sidewalk near a transfer pickup point with baggage movement",
      "Terminal parking-to-departures skybridge with premium commuter flow and rolling luggage",
      "Terminal approach walkway with rolling luggage and commuter movement",
      "Business district pickup point with carry-on luggage context",
      "Destination hotel arrival drive with believable travel-day movement",
      "Transit connector lane with cab arrivals and departure-ready baggage",
      "Intercity mobility hub forecourt with natural pre-journey urgency",
      "Airport perimeter pedestrian zone with travel-day flow"
    ];
    let indoorSettings = [
      "Private lounge check-in foyer with luggage and calm travel energy",
      "Airline lounge reception threshold with a travel-ready pause before boarding",
      "Airport hotel corridor near an elevator bank with departure-ready styling",
      "Business hotel arrival hall with luggage carts and muted transfer cues",
      "Transit gallery with glass, stone, and ordinary departure lighting",
      "Business hotel lobby with checkout-ready luggage and metro styling",
      "Travel-day hotel lobby near checkout with packed luggage context",
      "Hotel concierge zone with departure preparation context",
      "Lounge-adjacent seating corner with natural travel-day downtime",
      "Terminal check-in queuing area with luggage prep moment",
      "Transit hub interior walkway with realistic departure energy",
      "Corporate mobility lounge with business-travel departure cues"
    ];
    if (!explicitAirportMoment) {
      outdoorSettings.unshift(
        "Boutique business-hotel forecourt with luggage-ready arrival or departure energy",
        "Urban hotel entrance with subtle travel-day movement",
        "City-side stay entrance with relaxed getaway departure mood and luggage styling"
      );
      indoorSettings.unshift(
        "Contemporary hotel lounge with believable Indian travel lifestyle cues",
        "Boutique business-hotel lounge with relaxed pre-departure mood",
        "Airport hotel seating corner with carry-on and transfer-waiting cues"
      );
    }
    if (hasBusinessTravelCue) {
      outdoorSettings.unshift("Corporate district drop-off zone before a business trip with polished carry-on luggage");
      indoorSettings.unshift("Executive hotel lounge before a meeting-day departure with refined business-travel cues");
    }
    if (hasLeisureTravelCue) {
      outdoorSettings.unshift("Destination-side promenade with warm getaway energy and refined luggage styling");
      indoorSettings.unshift("Boutique stay lobby with relaxed getaway mood and premium travel cues");
    }
    outdoorSettings = prioritizeSettings(outdoorSettings, hints.preferredOutdoorSettings);
    indoorSettings = prioritizeSettings(indoorSettings, hints.preferredIndoorSettings);
    return {
      locationType,
      settings: locationType === "outdoor" ? outdoorSettings : indoorSettings,
      avoid: ["generic living room", "home office", "plain corridor"],
      reason: explicitAirportMoment
        ? "Travel scripts with explicit departure cues should anchor in transit/departure spaces, while still allowing premium business-travel or trip-day lifestyle variation."
        : "Travel scripts should vary across credible transit-adjacent, business-trip, and casual-travel lifestyle moments.",
      allowHomeContext
    };
  }

  if (/\b(shopping|retail|mall|store|purchase|grocery|supermarket|checkout|essentials)\b/.test(value)) {
    if (product === "kotak_cashback") {
      return {
        locationType: "indoor",
        settings: [
          "Apartment kitchen island with just-delivered grocery bags and soft natural daylight",
          "Urban home entryway with a fresh delivery drop and practical everyday-life styling",
          "Dining nook at home with unopened quick-commerce bags and app-native convenience cues"
        ],
        avoid: ["retail aisle", "supermarket", "store checkout", "mall corridor", "blank backdrop"],
        reason: "Cashback+ daily-spend scripts should feel rooted in online ordering and home delivery, not in-store shopping.",
        allowHomeContext: true
      };
    }
    return {
      locationType: "indoor",
      settings: [
        "Retail aisle with category-relevant products softly defocused",
        "Neighborhood store checkout zone with practical basket props",
        "Supermarket essentials section with realistic shopping context"
      ],
      avoid: ["generic living room", "home office", "blank backdrop"],
      reason: "Spend-category scripts perform better with in-category shopping environments.",
      allowHomeContext
    };
  }

  if (/\b(entertainment|movie|cinema|dining|restaurant|food|weekend|ott)\b/.test(value)) {
    if (product === "kotak_cashback") {
      return {
        locationType: "indoor",
        settings: [
          "Living room sofa setup with OTT-night cues and warm evening ambient light",
          "Home dining table with a fresh delivery bag and polished everyday-night styling",
          "Apartment lounge corner with takeaway arrival context and relaxed after-work energy"
        ],
        avoid: ["restaurant interior", "cafe corner", "cinema lobby", "blank studio wall"],
        reason: "Cashback+ entertainment and food-delivery scripts should anchor in at-home streaming and delivery moments, not dine-out or cinema spaces.",
        allowHomeContext: true
      };
    }
    return {
      locationType: "indoor",
      settings: [
        "Cinema lobby-adjacent waiting zone with ambient crowd blur",
        "Casual dining setup with service-ready table context",
        "Lifestyle cafe corner with realistic social-spend cues"
      ],
      avoid: ["generic living room", "home office", "blank studio wall"],
      reason: "Entertainment scripts should show social-spend environments, not generic homes.",
      allowHomeContext
    };
  }

  if (product === "kotak_air_plus") {
    const locationType: LocationType = hints.locationTypeBias ?? (stableHash(value || product) % 2 === 0 ? "indoor" : "outdoor");
    let indoorSettings = [
      "Private lounge check-in foyer with luggage and warm travel styling",
      "Airline lounge reception threshold with subtle boarding-time calm",
      "Airport hotel corridor near an elevator bank with departure-ready cues",
      "Concierge alcove beside luggage carts in a business hotel lobby",
      "Executive club lounge with a neatly placed carry-on and muted travel energy",
      "Chauffeur waiting area inside a hotel arrival hall with transfer cues",
      "Business hotel lobby with checkout-ready luggage and metro styling",
      "Hotel concierge zone with departure preparation context",
      "Contemporary hotel lounge with believable travel lifestyle cues",
      "Lounge-adjacent seating corner with premium pre-trip downtime",
      "High-end serviced apartment lobby with travel-day movement"
    ];
    let outdoorSettings = [
      "Business-hotel porte-cochere with arriving cabs and luggage flow",
      "Hotel valet canopy during a clean departure handoff with carry-on context",
      "Airport express drop-off lane with refined travel-day movement",
      "Chauffeur pickup bay outside a business hotel with transfer energy",
      "Airport hotel arrival court with shuttle drop-off and travel styling",
      "Private transfer bay outside a hotel with concierge-side movement",
      "Business district curbside pickup with carry-on luggage context",
      "Destination hotel forecourt with arrival or departure energy",
      "Urban hotel entrance with subtle travel-day movement",
      "Airport approach zone with natural movement in background",
      "Travel-day street-side pickup point with trip context"
    ];
    outdoorSettings = prioritizeSettings(outdoorSettings, hints.preferredOutdoorSettings);
    indoorSettings = prioritizeSettings(indoorSettings, hints.preferredIndoorSettings);
    return {
      locationType,
      settings: locationType === "indoor" ? indoorSettings : outdoorSettings,
      avoid: ["generic living room", "home office", "plain apartment corner"],
      reason:
        "Kotak Air Plus is travel-led; backdrop should reflect a premium travel lifestyle and can vary across transit, business-trip, and casual travel moments.",
      allowHomeContext
    };
  }

  const defaultIndoor = [
    "Neighborhood market frontage with practical spend cues",
    "Storefront walkway with everyday shopping context",
    "Public lifestyle corridor with category-relevant props"
  ];
  const defaultOutdoor = [
    "Urban neighborhood street with daily-routine spend context",
    "Transit-adjacent sidewalk with practical lifestyle cues",
    "Open-air market edge with real-world depth layers"
  ];
  const locationType: LocationType = stableHash(value || product) % 2 === 0 ? "indoor" : "outdoor";

  return {
    locationType,
    settings: locationType === "indoor" ? defaultIndoor : defaultOutdoor,
    avoid: ["generic living room", "home office", "blank studio wall"],
    reason: "No strong explicit location cues in script, so vary context while staying category-authentic.",
    allowHomeContext
  };
}

function cleanSceneString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || VISUAL_EXCLUSION_PATTERN.test(normalized)) {
    return fallback;
  }

  return normalized;
}

function cleanSceneList(value: unknown, minLength: number, fallbackItem: string): string[] {
  const cleaned = toStringArray(value)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => Boolean(item) && !VISUAL_EXCLUSION_PATTERN.test(item));

  while (cleaned.length < minLength) {
    cleaned.push(fallbackItem);
  }

  return cleaned;
}

function buildBackstoryAnchoredBackgroundCue(backstory: Backstory): string {
  return cleanSceneString(backstory.setting, "Believable background from the backstory setting");
}

function buildConcreteSceneActivity(
  backstory: Backstory,
  context: ScriptVisualContext,
  locationType: LocationType
): string {
  const normalizedSetting = normalizeComparableText(backstory.setting);
  const normalizedContext = normalizeComparableText(`${context.primary} ${context.secondary} ${context.activity}`);

  if (/\btravel|flight|airport|terminal|luggage|departure|boarding|hotel\b/.test(normalizedContext)) {
    if (locationType === "outdoor") {
      return "pausing beside a rolling cabin bag after stepping out of a car";
    }
    return /\blobby|hotel|suite|arrival\b/.test(normalizedSetting)
      ? "walking with a cabin bag and pausing mid-step near the lobby entrance"
      : "resting one hand on a cabin bag handle before heading out";
  }

  if (/\bfuel|petrol|diesel|car|forecourt\b/.test(normalizedContext)) {
    return "standing beside a parked car with keys in hand";
  }

  if (/\bgrocery|grocer|delivery|essentials|kitchen\b/.test(normalizedContext)) {
    return "setting a delivery bag on the counter and turning to camera";
  }

  if (/\bott|entertainment|movie|streaming|sofa\b/.test(normalizedContext)) {
    return "settling into a seat and turning toward camera mid-motion";
  }

  return "pausing mid-step and turning naturally toward camera";
}

function sanitizeImagePromptDetail(value: string, maxChars = 180): string {
  const cleaned = value
    .replace(/\bWell-ironed, wrinkle-free, clean attire aligned to persona and setting\.?/gi, "")
    .replace(/\bpolished and pristine transit aesthetic\.?/gi, "")
    .replace(/\belegant\b/gi, "")
    .replace(/\baffluent\b/gi, "")
    .replace(/\beditorial\b/gi, "")
    .replace(/\bhotel-district\b/gi, "city-side")
    .replace(/\bmeticulously\b/gi, "")
    .replace(/\bperfectly\b/gi, "")
    .replace(/\bwrinkle-free\b/gi, "")
    .replace(/\bwell-ironed\b/gi, "")
    .replace(/\bpristine\b/gi, "clean")
    .replace(/\bcrisp,\s*/gi, "")
    .replace(/\bpremium\s+/gi, "")
    .replace(/\bpristine\b/gi, "clean")
    .replace(/\s+/g, " ")
    .replace(/\.\./g, ".")
    .trim();
  return trimPromptIncompleteEnding(compactPromptSectionText(cleaned, maxChars)).replace(/\.\.$/, ".");
}

function buildBackstoryImperfectionLine(backstory: Backstory): string {
  const face = normalizeComparableText(backstory.facial_features);
  const hair = normalizeComparableText(backstory.hairstyle_grooming);
  const cues: string[] = [];

  if (/\b(pores?|texture)\b/.test(face)) {
    cues.push("visible skin texture");
  }
  if (/\b(freckles?|sun[- ]?spots?|spots?)\b/.test(face)) {
    cues.push("faint spots or freckles");
  }
  if (/\b(asymmetr)\b/.test(face)) {
    cues.push("slight facial asymmetry");
  }
  if (/\b(under[- ]?eye|fine lines?|lines?)\b/.test(face)) {
    cues.push("subtle under-eye texture");
  }
  if (/\b(flyaways?|loose|lived[- ]?in|uneven|wavy|textured)\b/.test(hair)) {
    cues.push("small flyaways and an everyday hair finish");
  }

  if (cues.length === 0) {
    cues.push("visible skin texture", "small hair flyaways");
  }

  return `Keep natural imperfections from the backstory visible: ${Array.from(new Set(cues)).join(", ")}. Do not airbrush, retouch, or over-style them.`;
}

function buildPhoneCameraImperfectionLine(product: ProductKey): string {
  const productSpecificCue =
    product === "kotak_air_plus"
      ? "Let the travel setting feel observed in passing, not luxury-campaign staged."
      : "Let the everyday spending setting feel ordinary, useful, and lived-in rather than aspirational.";

  return [
    "Make this feel like a real iPhone capture, not portrait-mode advertising.",
    "Allow slight framing imbalance, a tiny handheld tilt, mild exposure inconsistency, everyday phone-camera softness, subtle digital noise or compression character, and a tiny amount of natural focus imperfection.",
    "Do not clean up the face or eyes into beauty-ad polish. Eyes should look natural and alive, but not pin-sharp, glassy, or hyper-detailed.",
    "Do not create creamy cinematic bokeh, razor-sharp subject isolation, perfect symmetry, premium campaign polish, or retouched skin/face cleanup.",
    productSpecificCue
  ].join(" ");
}

function defaultSceneDirection(
  context: ScriptVisualContext,
  backstory: Backstory,
  locationPolicy: SceneLocationPolicy,
  recentSettings: string[] = []
): SceneDirection {
  const fallbackSetting = cleanSceneString(backstory.setting, pickVariedSetting(locationPolicy.settings, recentSettings));
  return {
    location_type: locationPolicy.locationType,
    chosen_setting: fallbackSetting,
    activity: buildConcreteSceneActivity(backstory, context, locationPolicy.locationType),
    backdrop_layers: [
      buildBackstoryAnchoredBackgroundCue(backstory),
      "Subtle depth from the same location with no mixed worlds",
      "Believable lived-in environment from the same place"
    ],
    prop_story: backstory.wardrobe_props,
    ambience: "Believable iPhone-camera realism, lived-in, ordinary available light, and not professionally staged.",
    framing:
      "Portrait 9:16, chest-up framing, natural eye contact, slight off-center placement, slight natural asymmetry, readable background depth, and minimal empty headroom."
  };
}

function sanitizeSceneDirection(
  input: SceneDirection,
  context: ScriptVisualContext,
  backstory: Backstory,
  locationPolicy: SceneLocationPolicy,
  recentSettings: string[] = []
): SceneDirection {
  const fallback = defaultSceneDirection(context, backstory, locationPolicy, recentSettings);
  const requestedType = input.location_type === "outdoor" || input.location_type === "indoor" ? input.location_type : fallback.location_type;
  const forcedType: LocationType = locationPolicy.locationType;
  const resolvedType: LocationType = requestedType === forcedType ? requestedType : forcedType;
  const cleanedSetting = cleanSceneString(input.chosen_setting, fallback.chosen_setting);
  const indoorWhenOutdoor = resolvedType === "outdoor" && GENERIC_HOME_PATTERN.test(cleanedSetting);
  const disallowedHomeGeneric = !locationPolicy.allowHomeContext && GENERIC_HOME_PATTERN.test(cleanedSetting);
  const repeatedSetting = isSettingRepeated(cleanedSetting, recentSettings);
  const divergesFromBackstory =
    !promptContainsAnchor(cleanedSetting, backstory.setting, 4) && !promptContainsAnchor(backstory.setting, cleanedSetting, 4);
  const chosenSetting =
    indoorWhenOutdoor || disallowedHomeGeneric || repeatedSetting || divergesFromBackstory
      ? fallback.chosen_setting
      : cleanedSetting;
  const cleanedActivity = cleanSceneString(input.activity, fallback.activity);
  const abstractActivity =
    /\bone natural lifestyle action directly tied to the script context\b|\bauthentic and not staged\b|\bsingle activity\b/i.test(
      cleanedActivity
    );

  return {
    location_type: resolvedType,
    chosen_setting: chosenSetting,
    activity: abstractActivity ? fallback.activity : cleanedActivity,
    backdrop_layers: cleanSceneList(input.backdrop_layers, 3, "Additional contextual environmental depth").slice(0, 6),
    prop_story: cleanSceneList(input.prop_story, 2, "Practical non-digital lifestyle prop").slice(0, 6),
    ambience: cleanSceneString(input.ambience, fallback.ambience),
    framing: cleanSceneString(input.framing, fallback.framing)
  };
}

function getSceneDirectionPrompt(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  guidelines: string | undefined,
  brief: string | undefined,
  context: ScriptVisualContext,
  locationPolicy: SceneLocationPolicy,
  recentSettings: string[] = []
): string {
  const spec = PRODUCT_SPECS[product];
  const compactBrief = compactPromptContext(brief, 360);

  return [
    "You are planning one realistic iPhone-shot keyframe for an image-to-video ad.",
    "Return STRICT JSON only with keys:",
    "location_type, chosen_setting, activity, backdrop_layers, prop_story, ambience, framing",
    "Backstory setting is the primary source of truth for the location and background.",
    "Choose one single location only. Do not mix multiple worlds in one frame.",
    "chosen_setting must stay inside or immediately adjacent to the backstory setting, not invent a new world.",
    "activity must be one concrete physical action the model can render in a still frame. Keep it simple and filmable.",
    "Avoid generic or abstract actions like 'one natural lifestyle action tied to the script context'.",
    "Prefer ordinary, phone-shot plausibility over cinematic spectacle, luxury fantasy, or ad-world polish.",
    "Do not plan portrait-mode polish, perfect symmetry, or hero-location staging.",
    "Backdrop planning rules:",
    "- Keep all backdrop layers from the same place.",
    "- Do not stack airport + hotel + home + city in one scene.",
    "- Avoid repetitive defaults such as tea/coffee pouring unless explicitly required by script.",
    recentSettings.length > 0
      ? `- Avoid reusing these recent settings or close variants: ${recentSettings.slice(0, 8).join(" | ")}.`
      : "",
    "- Do not default to generic living room/home-office scenes unless script explicitly asks for home context.",
    `- Required location_type for this script: ${locationPolicy.locationType}.`,
    `- Candidate settings to choose from (or close variants): ${locationPolicy.settings.join(" | ")}.`,
    `- Settings to avoid: ${locationPolicy.avoid.join(" | ")}.`,
    `- Location rationale: ${locationPolicy.reason}`,
    "- Do not keep using airport-only backdrops across consecutive jobs; vary to other travel-adjacent settings when possible.",
    product === "kotak_air_plus"
      ? "- For Kotak Air Plus, prefer a varied premium travel lifestyle mix: transit, business-trip, city-transfer, hotel-arrival, or casual getaway settings based on script and brief. Do not default to airport-only unless explicitly required."
      : "",
    "- No screens/devices: phone, laptop, tablet, TV, monitor, watch UI, dashboard screen, kiosk, digital signage.",
    "- No physical payment cards or card-like objects: no credit card, debit card, card mockup, or card close-up.",
    "- No text/supers/subtitles/captions/logos/watermarks anywhere in scene.",
    "- Character must be front-facing to camera with clear direct gaze in framing guidance.",
    "- Framing should feel like an ordinary iPhone shot: slightly off-center is acceptable, background should stay readable, and depth should not collapse into creamy bokeh.",
    "- Character must be fictional and non-celebrity; avoid any public-figure resemblance.",
    `Product: ${product}`,
    spec.positioning ? `Positioning: ${spec.positioning}` : "",
    spec.corePromise ? `Core promise: ${spec.corePromise}` : "",
    spec.socialTone ? `Social tone: ${spec.socialTone}` : "",
    `Audience: ${spec.audienceSummary}`,
    spec.imageTreatment ? `Image treatment guideline: ${spec.imageTreatment}` : "",
    `Product hooks: ${spec.hooks.join(" | ")}`,
    `Image mood: ${spec.imageVibe}`,
    `Persona: ${backstory.persona_name}, ${backstory.age_range}, ${backstory.profession}, ${backstory.city}`,
    `Persona why-care: ${backstory.why_they_care}`,
    `Persona wardrobe cues: ${backstory.wardrobe_props.join(" | ")}`,
    `Persona setting baseline (must drive the final location): ${backstory.setting}`,
    `Script context primary: ${context.primary}`,
    `Script context secondary: ${context.secondary}`,
    `Script activity hint: ${context.activity}`,
    `Script:\n${script}`,
    compactBrief ? `Campaign brief context:\n${compactBrief}` : "",
    guidelines?.trim() ? `Brand guidelines:\n${guidelines.trim()}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function generateSceneDirection(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  guidelines?: string,
  brief?: string,
  recentSettings: string[] = []
): Promise<SceneDirection> {
  const context = deriveScriptVisualContext(script, product);
  const locationPolicy = deriveSceneLocationPolicy(script, product, brief);
  const fallback = defaultSceneDirection(context, backstory, locationPolicy, recentSettings);
  const ai = getClient();

  try {
    const response = await generateLogicContent(
      ai,
      "generateSceneDirection",
      getSceneDirectionPrompt(backstory, product, script, guidelines, brief, context, locationPolicy, recentSettings),
      0.9
    );

    const text = responseText(response).trim();
    if (!text) {
      return fallback;
    }

    const parsed = sceneDirectionSchema.parse(parseJsonObject(text));
    return sanitizeSceneDirection(parsed, context, backstory, locationPolicy, recentSettings);
  } catch (error) {
    console.warn("[pipeline] scene direction fallback", error);
    return fallback;
  }
}

function deriveScriptVisualContext(script: string, product: ProductKey): ScriptVisualContext {
  const value = script.toLowerCase();

  if (/\b(fuel|petrol|diesel|refuel|gas station|pump)\b/.test(value)) {
    return {
      primary: "fuel-related context around a petrol station forecourt or parked car exterior",
      secondary: "road-trip preparation context near a car with travel accessories",
      activity: "one activity such as preparing to refuel, handling keys, or arranging travel essentials near the vehicle"
    };
  }

  if (/\b(travel|trip|flight|airport|boarding|journey|lounge)\b/.test(value)) {
    return {
      primary: "travel context near airport approach, terminal walkway, or luggage zone",
      secondary: "pre-departure context at a home entryway with packed bags",
      activity: "one activity such as adjusting luggage or preparing to leave"
    };
  }

  if (/\b(grocery|groceries|milk|essentials|supermarket|kitchen|daily)\b/.test(value)) {
    if (product === "kotak_cashback") {
      return {
        primary: "home-delivery context in an apartment kitchen, entryway, or dining counter",
        secondary: "practical at-home restock moment with delivered grocery bags or pantry essentials",
        activity: "one activity such as unpacking a delivery bag or setting aside delivered essentials"
      };
    }
    return {
      primary: "daily-essentials context in a grocery aisle, checkout area, or kitchen counter",
      secondary: "home restock context with pantry or countertop essentials",
      activity: "one activity such as organizing grocery items"
    };
  }

  if (/\b(shopping|retail|mall|store|purchase)\b/.test(value)) {
    if (product === "kotak_cashback") {
      return {
        primary: "online-order context at home with delivery arrival or package handoff",
        secondary: "post-delivery apartment moment with bags or boxes near the entryway",
        activity: "one activity such as receiving, unpacking, or sorting a delivered order"
      };
    }
    return {
      primary: "shopping context in a retail aisle or storefront walkway",
      secondary: "post-shopping home-entry context with carry bags",
      activity: "one activity such as organizing shopping bags"
    };
  }

  if (/\b(entertainment|movie|cinema|weekend|dining|restaurant|food)\b/.test(value)) {
    if (product === "kotak_cashback") {
      return {
        primary: "at-home OTT or food-delivery context in a living room or dining nook",
        secondary: "after-work apartment setup with takeaway arrival or streaming-night cues",
        activity: "one activity such as placing a delivery bag down, settling onto a sofa, or queueing up a home viewing moment"
      };
    }
    return {
      primary: "leisure-spend context in a cafe or dining setup",
      secondary: "weekend lifestyle context at home with social props",
      activity: "one activity such as setting a table, arranging takeaway, or prepping a quick snack"
    };
  }

  if (product === "kotak_air_plus") {
    return {
      primary: "premium travel lifestyle context with luggage-ready surroundings or a polished trip-day environment",
      secondary: "on-the-go business or casual travel context before departure or arrival",
      activity: "one activity such as preparing for a trip, arriving at a stay, or moving through a travel-day routine"
    };
  }

  return {
    primary: "everyday spending context in home-or-neighborhood lifestyle surroundings",
    secondary: "practical routine context with household or shopping props",
    activity: "one activity such as organizing daily essentials"
  };
}

function compactPromptContext(value: string | undefined, maxChars = 420): string {
  if (!value) {
    return "";
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function clampPromptToSentenceBoundary(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const slice = normalized.slice(0, Math.max(0, maxChars - 1));
  const punctuationIndex = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("; ")
  );
  if (punctuationIndex >= Math.floor(maxChars * 0.55)) {
    return slice.slice(0, punctuationIndex + 1).trim();
  }

  return `${slice.trim()}...`;
}

function getMultiSceneSubjectDescriptor(backstory: Backstory, product: ProductKey, script: string): string {
  const scriptValue = script.toLowerCase();
  const profession = backstory.profession.replace(/\s+/g, " ").trim();
  const roleHint =
    /\b(corporate|client|boardroom|consult|enterprise)\b/.test(scriptValue)
      ? "sharp corporate professional"
      : /\b(travel|trip|airport|flight|boarding|journey)\b/.test(scriptValue) || product === "kotak_air_plus"
        ? "confident travel-savvy urban professional"
        : /\b(grocery|milk|fuel|movie|cinema|essentials|daily)\b/.test(scriptValue)
          ? "practical metro consumer persona"
          : "aspirational metro professional";
  const wardrobeCue = backstory.wardrobe_props[0]?.replace(/\s+/g, " ").trim();
  const wardrobeSnippet = wardrobeCue ? `, wardrobe cue: ${wardrobeCue}` : "";
  const professionSnippet = profession ? `, profession: ${profession}` : "";
  return `${backstory.persona_name}, ${roleHint}${professionSnippet}${wardrobeSnippet}, continuity anchor: same face, hairstyle, facial hair, skin tone, outfit palette, and accessory story across all scenes`;
}

function deriveMultiSceneBackgroundPlan(product: ProductKey, script: string, brief?: string): string[] {
  const value = `${script} ${brief ?? ""}`.toLowerCase();
  const plan: string[] = [];
  const explicitAirportMoment = /\b(airport|flight|boarding|departure|terminal|check[-\s]?in)\b/.test(value);
  const hasBusinessTravelCue = /\b(business|corporate|client|meeting|conference|consultant|founder|boardroom|work trip)\b/.test(value);
  const hasLeisureTravelCue = /\b(vacation|holiday|getaway|weekend trip|escape|resort|beach|staycation|leisure)\b/.test(value);
  const pushUnique = (item: string): void => {
    if (!plan.includes(item)) {
      plan.push(item);
    }
  };

  if (/\b(travel|airport|flight|boarding|departure|lounge|trip)\b/.test(value) || product === "kotak_air_plus") {
    if (explicitAirportMoment) {
      pushUnique("airport departure walkway with cool blue ambient light and motion blur");
      pushUnique("premium lounge corner with warm amber lighting and polished surfaces");
    }
    if (hasBusinessTravelCue || product === "kotak_air_plus") {
      pushUnique("business hotel lobby with clean marble reflections and refined departure-day styling");
      pushUnique("hotel drop-off zone with concierge energy, premium car arrival, and carry-on luggage cues");
    }
    if (hasLeisureTravelCue || product === "kotak_air_plus") {
      pushUnique("destination hotel arrival court with warm golden-hour travel energy");
      pushUnique("city promenade near a premium stay with relaxed getaway mood");
    }
    pushUnique("curbside airport drop-off lane at golden hour with luggage movement and departure energy");
    pushUnique("check-in queue zone with bright neutral light, luggage flow, and unmistakable departure movement");
  }

  if (/\b(grocery|essentials|milk|supermarket|checkout)\b/.test(value) || product === "kotak_cashback") {
    if (product === "kotak_cashback") {
      pushUnique("apartment kitchen island with soft daylight, delivery bags, and practical everyday utility");
      pushUnique("urban home entryway with a fresh quick-commerce drop and clean natural morning light");
      pushUnique("compact dining nook with delivered essentials and polished at-home routine styling");
    } else {
      pushUnique("grocery aisle with bright white retail lighting and colorful packaging");
      pushUnique("home kitchen counter with soft daylight and practical essentials");
    }
  }

  if (/\b(entertainment|movie|cinema|ott|weekend|dining|restaurant)\b/.test(value)) {
    if (product === "kotak_cashback") {
      pushUnique("living room sofa zone with OTT-night cues and warm evening ambient light");
      pushUnique("apartment dining table with takeaway arrival context and after-work energy");
    } else {
      pushUnique("cinema lobby with warm tungsten glow and blurred crowd movement");
      pushUnique("casual cafe/dining corner with mixed warm-cool lighting contrast");
    }
  }

  if (/\b(fuel|petrol|diesel|refuel|pump)\b/.test(value)) {
    pushUnique("fuel station forecourt at dusk with neon edge highlights");
  }

  if (plan.length < 3) {
    if (product === "kotak_air_plus") {
      pushUnique("contemporary hotel lounge with affluent Indian travel lifestyle cues");
      pushUnique("premium terminal-adjacent connector corridor with luggage flow and cool travel lighting");
      pushUnique("urban luxury stay entrance with subtle travel-day movement and porter-style arrival cues");
    } else {
      pushUnique("urban home entryway with natural morning light and delivery-arrival utility props");
      pushUnique("living room workspace corner with practical metro-life cues and warm daylight");
      pushUnique("apartment kitchen-dining transition space with app-native everyday convenience context");
    }
  }

  return plan.slice(0, 4);
}

function getMultiSceneShotCount(durationSeconds: number): number {
  if (durationSeconds <= 8.5) {
    return 2;
  }
  if (durationSeconds <= 12.5) {
    return 4;
  }
  return 5;
}

function getScriptSentenceBeats(script: string): string[] {
  const normalized = script.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const protectedText = normalized
    .replace(/\bRs\.\s*(?=\d)/g, "Rs__DOT__ ")
    .replace(/\bRs\.\s*(?=[a-z])/gi, "Rs__DOT__ ");

  return protectedText
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.replace(/Rs__DOT__\s*/g, "Rs. ").trim())
    .filter(Boolean);
}

function splitScriptIntoBeats(script: string, shotCount: number): string[] {
  const sentences = getScriptSentenceBeats(script);
  if (sentences.length === 0) {
    return Array.from({ length: Math.max(1, Math.min(shotCount, 1)) }, (_, index) => `Beat ${index + 1}`);
  }

  if (sentences.length >= shotCount) {
    const beats: string[] = [];
    for (let index = 0; index < shotCount; index += 1) {
      if (index < shotCount - 1) {
        beats.push(sentences[index]!);
      } else {
        beats.push(sentences.slice(index).join(" "));
      }
    }
    return beats;
  }

  return sentences;
}

function getEffectiveMultiSceneShotCount(script: string, durationSeconds: number): number {
  const baseShotCount = getMultiSceneShotCount(durationSeconds);
  const beats = splitScriptIntoBeats(script, baseShotCount);
  return Math.max(1, Math.min(baseShotCount, beats.length));
}

function getMultiSceneShotDirections(
  script: string,
  durationSeconds: number,
  backgrounds: string[],
  subject: string
): string[] {
  const shotCount = Math.max(1, Math.min(getEffectiveMultiSceneShotCount(script, durationSeconds), backgrounds.length || 1));
  const selectedBackgrounds = backgrounds.slice(0, shotCount);
  while (selectedBackgrounds.length < shotCount) {
    selectedBackgrounds.push(selectedBackgrounds[selectedBackgrounds.length - 1] ?? "lifestyle urban backdrop with cinematic depth");
  }
  const beats = splitScriptIntoBeats(script, shotCount);
  const isEightSecondBumper = durationSeconds <= 8.5;

  return Array.from({ length: shotCount }, (_, index) => {
    const beat = beats[index] ?? beats[beats.length - 1] ?? "core value proposition";
    const location = selectedBackgrounds[index]!;
    if (shotCount === 1) {
      return `SHOT 1: Dialogue beat "${beat}". Medium close-up, direct eye contact, premium cinematic realism, and one consistent subject identity. Subject: ${subject}. Location: ${location}. Camera can use a restrained elegant push-in, but keep mouth readability clean. End on the same locked shot with no nod or extra action.`;
    }
    if (index === 0) {
      return isEightSecondBumper
        ? `SHOT ${index + 1}: Dialogue beat "${beat}". Medium close-up, direct eye contact, cinematic editorial realism, and stable framing with no profile turn. Subject: ${subject}. Location: ${location}. Camera can use a gentle push-in or elegant natural movement if mouth sync stays clean and framing stays stable.`
        : `SHOT ${index + 1}: Dialogue beat "${beat}". Medium close-up, direct eye contact, warm cinematic opening. Subject: ${subject}. Location: ${location}. Camera movement: gentle forward drift.`;
    }
    if (index === shotCount - 1) {
      return isEightSecondBumper
        ? `SHOT ${index + 1}: Dialogue beat "${beat}". Tight close-up with direct eye contact, same face, same wardrobe palette, and same emotional thread as the opening shot. Location: ${location}. Camera fully locked for a decisive BOFU close. Keep the final shot fully static with no nod, no turn, and no extra gesture.`
        : `SHOT ${index + 1}: Dialogue beat "${beat}". Tight close-up with direct eye contact, subtle confident smile and slight nod. Location: ${location}. Camera mostly locked for decisive BOFU close.`;
    }
    return isEightSecondBumper
      ? `SHOT ${index + 1}: Dialogue beat "${beat}". Relaxed medium shot with direct eye contact, same subject continuity, and stable framing. Location: ${location}. Allow natural movement or a restrained cinematic tracking feel only if the speaking performance stays readable and clean.`
      : `SHOT ${index + 1}: Dialogue beat "${beat}". Relaxed medium shot while subject moves naturally and stays conversational to camera. Location: ${location}. Camera movement: smooth steadicam/backward walk with stable framing.`;
  });
}

function getImagenPrompt(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  sceneDirection: SceneDirection,
  aspectRatio: SupportedAspectRatio = PRIMARY_FRAME_SPEC.aspectRatio,
  videoType: VideoType = DEFAULT_VIDEO_CONFIG.type,
  guidelines?: string,
  brief?: string
): string {
  void guidelines;
  void brief;
  const framingLine =
    aspectRatio === "9:16"
      ? "Vertical 9:16 iPhone-camera frame."
      : aspectRatio === "1:1"
        ? "Square 1:1 iPhone-camera frame."
        : "Horizontal 16:9 iPhone-camera frame.";
  const compositionLine =
    aspectRatio === "9:16"
      ? "Tight chest-up framing with full face visibility and slight natural asymmetry."
      : aspectRatio === "1:1"
        ? "Head-and-shoulders framing with direct eye contact and natural side room."
        : "Upper-torso framing with direct eye contact and natural side room.";
  const primarySetting = cleanSceneString(backstory.setting, sceneDirection.chosen_setting);
  const concreteAction = cleanSceneString(
    sceneDirection.activity,
    buildConcreteSceneActivity(backstory, deriveScriptVisualContext(script, product), sceneDirection.location_type)
  );
  const wardrobeCue = backstory.wardrobe_props.slice(0, 2).map((item) => sanitizeImagePromptDetail(item, 100)).filter(Boolean).join("; ");
  const backgroundCue = buildBackstoryAnchoredBackgroundCue(backstory);
  const postureCue = sanitizeImagePromptDetail(backstory.posture_body_language, 150);
  const expressionCue = sanitizeImagePromptDetail(backstory.expression_style, 140);
  const bodyBuildCue = sanitizeImagePromptDetail(backstory.body_build, 90);
  const imperfectionLine = buildBackstoryImperfectionLine(backstory);
  const phoneImperfectionLine = buildPhoneCameraImperfectionLine(product);
  const productWorldLine =
    product === "kotak_air_plus"
      ? "Keep the world grounded in believable travel-day or mobility context from the backstory, not a glossy campaign version of travel."
      : "Keep the world grounded in believable everyday spend context from the backstory, not a polished retail campaign scene.";

  return [
    framingLine,
    "Shot on iPhone with available light, casual handheld realism, and no professional studio finish.",
    "Natural exposure, natural color, and realistic smartphone detail. Keep it slightly soft like everyday iPhone footage, not oversharpened, not ultra crisp, and not studio-clean.",
    "Avoid portrait-mode subject isolation. Keep some readable background detail and let the environment stay visible behind the subject.",
    "Skin should look real, not airbrushed: visible pores, normal tonal variation, mild under-eye texture, and no beauty-campaign smoothing or face cleanup.",
    "Hair should look day-to-day and lightly imperfect, with natural flyaways and no salon-set or heavily styled finish.",
    "Facial detail should feel natural for a phone camera: slightly soft, with normal focus falloff around lashes, brows, and skin texture rather than clinical sharpness.",
    "Do not make it look like a professionally lit campaign shoot, fashion editorial, CGI render, stock-ad image, or studio portrait.",
    `Use one single coherent location from the backstory only: ${primarySetting}. Background stays in that same place: ${backgroundCue}.`,
    `Subject: ${backstory.persona_name}, ${backstory.age_range}, ${backstory.profession}, ${backstory.city}.`,
    `Appearance: ${sanitizeImagePromptDetail(backstory.facial_features, 180)} Hair and grooming: ${sanitizeImagePromptDetail(backstory.hairstyle_grooming, 140)}.`,
    bodyBuildCue ? `Body build: ${bodyBuildCue}.` : "",
    wardrobeCue ? `Wardrobe cues: ${wardrobeCue}.` : "",
    `Concrete physical action: ${concreteAction}.`,
    postureCue ? `Posture and stance: ${postureCue}.` : "",
    expressionCue ? `Expression cue: ${expressionCue}.` : "",
    imperfectionLine,
    phoneImperfectionLine,
    "Subject looks directly at the camera with a natural conversational gaze, not a mannequin pose and not a front-on studio headshot.",
    `${compositionLine} Do not center the face too perfectly; allow a casual off-center framing and ordinary shoulder angle.`,
    "Keep the head, hairline, chin, and shoulder line fully in frame with minimal empty headroom.",
    productWorldLine,
    `Script context: ${script}.`,
    "Essential exclusions only: no readable text, no screens or devices, no cards or card-like objects, no celebrity or public-figure likeness."
  ]
    .filter(Boolean)
    .join(" ");
}

function getImagenExclusionsText(): string {
  return [
    "phone",
    "smartphone",
    "mobile",
    "laptop",
    "tablet",
    "ipad",
    "monitor",
    "screen",
    "display",
    "tv",
    "television",
    "smartwatch",
    "watch face",
    "credit card",
    "debit card",
    "payment card",
    "card mockup",
    "physical card",
    "card close-up",
    "card-shaped object",
    "boarding pass",
    "ticket",
    "receipt",
    "bank statement",
    "printed form",
    "document text",
    "packaging text",
    "user interface",
    "ui",
    "overlay text",
    "subtitle",
    "caption",
    "watermark",
    "readable text",
    "poster text",
    "signboard text",
    "storefront text",
    "menu text",
    "lettering",
    "celebrity",
    "public figure",
    "famous actor",
    "famous person",
    "lookalike",
    "likeness"
  ].join(", ");
}

async function inspectGeneratedKeyframeForForbiddenVisuals(
  ai: GoogleGenAI,
  imageBytes: Buffer
): Promise<z.infer<typeof generatedImageInspectionSchema>> {
  const prompt = [
    "Inspect this generated ad image and return strict JSON only.",
    "Reject the image if ANY visible or pseudo-visible text appears anywhere.",
    "Treat misspelled, blurry, partial, stylized, or gibberish lettering as text.",
    "This includes terminal signs, storefront names, posters, menus, labels, packaging text, gate numbers, wall lettering, watermarks, captions, subtitles, logos, and document text.",
    "Also reject the image if any credit card, debit card, payment card, boarding pass, ticket, receipt, statement, form, or card-shaped object appears.",
    "Return exactly these keys: hasForbiddenVisual, visibleText, cardLikeObject, reason."
  ].join(" ");

  const response = await generateLogicContentWithImage(ai, "inspectGeneratedKeyframe", prompt, imageBytes.toString("base64"), "image/png", 0);
  const text = responseText(response).trim();
  if (!text) {
    throw new Error("Generated image inspection response was empty.");
  }

  const raw = parseJsonObject(text);
  const parsed = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return generatedImageInspectionSchema.parse({
    hasForbiddenVisual: toBooleanLike(parsed.hasForbiddenVisual),
    visibleText: toBooleanLike(parsed.visibleText),
    cardLikeObject: toBooleanLike(parsed.cardLikeObject),
    reason: typeof parsed.reason === "string" && parsed.reason.trim().length > 0 ? parsed.reason.trim() : "No reason provided."
  });
}

function shouldRunVideoQc(videoType: VideoType): boolean {
  return !isHowToVideoType(videoType);
}

function getVideoQcRtbDeadlineSeconds(videoConfig: VideoConfig): number {
  const resolvedVideo = resolveVideoConfig(videoConfig);
  const ratio = Number.isFinite(VIDEO_QC_OPENING_WINDOW_RATIO) ? VIDEO_QC_OPENING_WINDOW_RATIO : 0.35;

  if (resolvedVideo.type === "point_to_camera" || resolvedVideo.type === "point_to_camera_multi_scene") {
    return clampNumber(
      resolvedVideo.durationSeconds * ratio,
      VIDEO_QC_MIN_RTB_DEADLINE_SECONDS,
      Math.min(3.2, VIDEO_QC_MAX_RTB_DEADLINE_SECONDS)
    );
  }

  return clampNumber(
    resolvedVideo.durationSeconds * Math.max(ratio, 0.4),
    Math.max(3, VIDEO_QC_MIN_RTB_DEADLINE_SECONDS),
    VIDEO_QC_MAX_RTB_DEADLINE_SECONDS
  );
}

function getVideoQcReferenceRules(product: ProductKey, script: string, supers?: SupersConfig): SupersTriggerRule[] {
  const manualRules = normalizeSupersRules(Array.isArray(supers?.rules) ? supers.rules : []);
  if (manualRules.length > 0) {
    return manualRules.slice(0, 3);
  }
  return deriveAutomaticSupersRules(product, script).slice(0, 3);
}

async function inspectGeneratedVideoForQc(
  ai: GoogleGenAI,
  params: {
    videoBytes: Buffer;
    product: ProductKey;
    script: string;
    videoConfig: VideoConfig;
    supers?: SupersConfig;
  }
): Promise<z.infer<typeof generatedVideoQcSchema>> {
  const { videoBytes, product, script, videoConfig, supers } = params;
  const resolvedVideo = resolveVideoConfig(videoConfig);
  const deadlineSeconds = getVideoQcRtbDeadlineSeconds(resolvedVideo);
  const referenceRules = getVideoQcReferenceRules(product, script, supers);
  const expectedCueText =
    referenceRules.length > 0
      ? referenceRules.map((rule) => `${rule.text} (triggered by "${rule.triggerWord}")`).join(" | ")
      : "No explicit cue extracted from script; use the first core benefit in the script.";
  const prompt = [
    "Inspect this generated ad video and return strict JSON only.",
    `Product: ${product}.`,
    `Video type: ${resolvedVideo.type}.`,
    `Duration target: ${resolvedVideo.durationSeconds} seconds.`,
    `Expected spoken script: ${script}`,
    `Expected RTB/benefit cues from script for reference only: ${expectedCueText}`,
    `RTB timing note only: first core RTB/value may be estimated around ${deadlineSeconds.toFixed(1)} seconds, but RTB timing must not affect QC pass or fail.`,
    "Critical QC rule: the spoken dialogue must materially match the expected script. Use scriptMatchPass=false if the generated speech is different in substance, swaps in unrelated lines, omits the core offer, or uses a completely different script.",
    "Critical QC rule: only fail lip sync for clear, obvious visible mismatch in a speaking shot.",
    "Use lipSyncPass=false only if either: audio starts while the visible mouth is still closed, or a cut happens mid-line and the visible mouth position is obviously wrong for the continuing audio.",
    "Do not fail lip sync for subtle drift, low-mouth-movement delivery, profile angles, partially obscured mouth, quick cuts, or cases where the mouth is not clearly readable.",
    "Critical QC rule: reject the video if the ending shape is abrupt, the video ends badly, there is a random transition at the end, or there is stray outro behavior after dialogue.",
    "Use endingPass=false for abrupt end, unstable final beat, random end transition, clipped outro hold, or any stray outro behavior after dialogue.",
    product === "kotak_air_plus"
      ? "Critical QC rule for Kotak Air Plus: the world must clearly read as premium travel, trip-day business travel, hotel arrival, terminal-adjacent movement, or affluent mobility context. Use brandFitPass=false for generic office lobby, plain corporate corridor, railway concourse, or random urban curbside scenes that lack unmistakable travel cues such as luggage, terminal architecture, concierge arrival, or departure movement."
      : "Critical QC rule for Kotak Cashback+: the world must clearly read as practical everyday spend context. Use brandFitPass=false for unrelated premium travel or generic corporate settings.",
    "Secondary QC rule: keep the same character identity across scenes.",
    "Wardrobe continuity is advisory only. Minor changes in accessory, strap, or wardrobe detail must not fail the video on their own.",
    "Set continuityPass=false only for major continuity breaks such as a different person, obvious identity swap, or major costume reset.",
    "If there is no visible speaking mouth for the line delivery, set lipSyncApplicable=false and lipSyncPass=true unless there is an obvious mismatch.",
    "Estimate firstRtbSecond as the earliest second where the main value/RTB is clearly communicated through speech or unmistakable scene action. Use null if absent. This is informational only.",
    "Return exactly these keys: pass, summary, firstRtbSecond, rtbAppearsEarly, scriptMatchPass, lipSyncApplicable, lipSyncPass, endingPass, brandFitPass, continuityPass, reasons."
  ].join(" ");

  const response = await generateQcContentWithVideo(
    ai,
    "inspectGeneratedVideoQc",
    prompt,
    videoBytes.toString("base64"),
    "video/mp4",
    0
  );
  const text = responseText(response).trim();
  if (!text) {
    throw new Error("Generated video QC response was empty.");
  }

  const raw = parseJsonObject(text);
  const parsed = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const firstRtbSecond = toNullableNumberLike(parsed.firstRtbSecond);
  const reasons = toStringArray(parsed.reasons).slice(0, 8);
  const rtbAppearsEarly = toBooleanLike(parsed.rtbAppearsEarly);
  const scriptMatchPass = toBooleanLike(parsed.scriptMatchPass);
  const lipSyncApplicable = toBooleanLike(parsed.lipSyncApplicable);
  const lipSyncPass = toBooleanLike(parsed.lipSyncPass);
  const endingPass = toBooleanLike(parsed.endingPass);
  const brandFitPass = toBooleanLike(parsed.brandFitPass);
  const continuityPass = toBooleanLike(parsed.continuityPass);
  const hardFailReasons: string[] = [];

  if (!scriptMatchPass) {
    hardFailReasons.push("Spoken script or offer does not match the expected script.");
  }
  if (lipSyncApplicable && !lipSyncPass) {
    hardFailReasons.push("Lip sync is not believable in one or more speaking scenes.");
  }
  if (!endingPass) {
    hardFailReasons.push("Ending shape, abrupt end, or outro behavior failed QC.");
  }
  if (!brandFitPass) {
    hardFailReasons.push("Brand-fit and setting quality failed QC.");
  }

  const qcPass = hardFailReasons.length === 0;
  const modelSummary = typeof parsed.summary === "string" && parsed.summary.trim().length > 0 ? parsed.summary.trim() : "";
  const summary = qcPass
    ? continuityPass
      ? modelSummary || "Passed critical QC."
      : "Passed critical QC. Minor continuity differences noted but allowed."
    : hardFailReasons.join(" ");

  return generatedVideoQcSchema.parse({
    pass: qcPass,
    summary,
    firstRtbSecond: firstRtbSecond === null ? null : clampNumber(firstRtbSecond, 0, Math.max(1, resolvedVideo.durationSeconds)),
    rtbAppearsEarly,
    scriptMatchPass,
    lipSyncApplicable,
    lipSyncPass,
    endingPass,
    brandFitPass,
    continuityPass,
    reasons
  });
}

export interface FinalVideoCreativeAssessment {
  score: number;
  whatWillWork: string;
  whyItWillWork: string;
  concerns: string[];
  assessedAt: string;
  model: string;
}

export async function assessFinalVideoCreative(params: {
  videoBytes: Buffer;
  product: ProductKey;
  script: string;
  brief?: string;
  provider: VideoProvider;
}): Promise<FinalVideoCreativeAssessment> {
  const { videoBytes, product, script, brief, provider } = params;
  const ai = getClient();
  const model = getQcModelCandidates()[0] ?? DEFAULT_QC_MODEL;
  const providerLabel =
    provider === "veo31_standard"
      ? "Veo 3.1 Standard"
      : provider === "sora_i2v"
        ? "Sora Image -> Veo I2V"
        : "Sora 2 Pro";
  const prompt = [
    "Review this finished short-form ad video and return strict JSON only.",
    `Product: ${product}.`,
    `Provider: ${providerLabel}.`,
    `Expected spoken script: ${script}.`,
    brief ? `Original brief: ${brief}.` : "",
    "Score the final video as a short-form ad creative out of 10.",
    "Judge whether the video is likely to work in a real performance-marketing or social-ad context.",
    "Focus on: hook strength, clarity of message, direct-to-camera communication, realism, body language, script fidelity, and overall watchability.",
    "Do not score based on supers because supers may be disabled.",
    "The score must be a number between 0 and 10, where 10 is production-ready and highly effective.",
    "whatWillWork: one short paragraph describing what in this video is likely to work.",
    "whyItWillWork: one short paragraph explaining why those elements will work on a viewer.",
    "concerns: short bullet-style issues that still weaken the output.",
    "Return exactly these keys: score, whatWillWork, whyItWillWork, concerns."
  ]
    .filter(Boolean)
    .join(" ");

  const response = await generateQcContentWithVideo(
    ai,
    "assessFinalVideoCreative",
    prompt,
    videoBytes.toString("base64"),
    "video/mp4",
    0
  );

  const text = responseText(response).trim();
  if (!text) {
    throw new Error("Final video creative assessment response was empty.");
  }

  const raw = parseJsonObject(text);
  const parsed = finalVideoCreativeAssessmentSchema.parse({
    score: toNumberLike((raw as Record<string, unknown>).score) ?? 0,
    whatWillWork:
      typeof (raw as Record<string, unknown>).whatWillWork === "string"
        ? ((raw as Record<string, unknown>).whatWillWork as string).trim()
        : "",
    whyItWillWork:
      typeof (raw as Record<string, unknown>).whyItWillWork === "string"
        ? ((raw as Record<string, unknown>).whyItWillWork as string).trim()
        : "",
    concerns: toStringArray((raw as Record<string, unknown>).concerns).slice(0, 6)
  });

  return {
    score: clampNumber(parsed.score, 0, 10),
    whatWillWork: parsed.whatWillWork,
    whyItWillWork: parsed.whyItWillWork,
    concerns: parsed.concerns,
    assessedAt: new Date().toISOString(),
    model
  };
}

function getVeoPrompt(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  aspectRatio: SupportedAspectRatio = PRIMARY_FRAME_SPEC.aspectRatio,
  videoType: VideoType = DEFAULT_VIDEO_CONFIG.type,
  durationSeconds = DEFAULT_VIDEO_CONFIG.durationSeconds,
  guidelines?: string,
  brief?: string,
  useReferenceImage = true
): string {
  const spec = PRODUCT_SPECS[product];
  const framingMode = aspectRatio === "9:16" ? "portrait" : aspectRatio === "1:1" ? "square" : "landscape";
  const roundedDuration = Math.max(8, Math.round(durationSeconds));
  const isEightSecondBumper = videoType === "point_to_camera_multi_scene" && roundedDuration <= 8;
  const useSingleShotPointToCamera = videoType === "point_to_camera" || isEightSecondBumper;
  const compactGuidelines = compactPromptContext(guidelines);
  const compactBrief = compactPromptContext(brief, 300);
  const wardrobeCue = backstory.wardrobe_props[0]?.replace(/\s+/g, " ").trim();
  const singleShotSubject = [
    backstory.persona_name,
    backstory.age_range,
    backstory.profession,
    backstory.facial_features,
    backstory.hairstyle_grooming,
    backstory.body_build,
    backstory.expression_style,
    wardrobeCue
  ]
    .filter(Boolean)
    .join(", ");
  const multiSceneSubject = useSingleShotPointToCamera ? "" : getMultiSceneSubjectDescriptor(backstory, product, script);
  const effectiveMultiSceneShotCount = useSingleShotPointToCamera ? 0 : getEffectiveMultiSceneShotCount(script, roundedDuration);
  const multiSceneBackgrounds = useSingleShotPointToCamera
    ? []
    : deriveMultiSceneBackgroundPlan(product, script, brief).slice(0, effectiveMultiSceneShotCount);
  const multiScenePlanLine = multiSceneBackgrounds.map((item, index) => `Scene ${index + 1}: ${item}`).join(" | ");
  const multiSceneShotDirections = useSingleShotPointToCamera
    ? []
    : getMultiSceneShotDirections(script, roundedDuration, multiSceneBackgrounds, multiSceneSubject);
  const multiSceneDirectionNotes =
    videoType === "point_to_camera_multi_scene" && !useSingleShotPointToCamera
      ? [
          "DIRECTION NOTES: Delivery style must be conversational, like a well-traveled friend sharing a recommendation, never announcer-like.",
          "DIRECTION NOTES: Direct eye contact in every shot is critical for BOFU intimacy and urgency.",
          `DIRECTION NOTES: Pacing must fit tightly within ${roundedDuration} seconds; each cut should lift visual energy while voice continuity anchors the story.`,
          "DIRECTION NOTES: Keep light location ambience under each shot (for example breeze, distant street life, travel ambience) while voice remains clean and warm.",
          "DIRECTION NOTES: Continuity trick is mandatory: same wardrobe and same persona across all shots while locations change.",
          isEightSecondBumper
            ? "DIRECTION NOTES: For 8-second bumpers, use at most one cut and only cut on clean sentence boundaries from the spoken script."
            : ""
        ]
      : [];
  const compositionDirective =
    aspectRatio === "9:16"
      ? "Frame as a medium close-up with the subject dominating the frame and minimal dead space."
      : aspectRatio === "1:1"
        ? "Frame as a balanced medium shot: full head and shoulders visible, subject around 55-70% of frame height."
        : "Frame as a medium landscape shot: full head and shoulders visible, subject around 45-60% of frame height.";
  const formatDirective =
    useSingleShotPointToCamera
      ? `Single-shot ${framingMode} video, ${roundedDuration} seconds, aspect ratio ${aspectRatio}, 1080p.`
      : videoType === "point_to_camera_multi_scene"
        ? `${framingMode} multi-scene video, ${roundedDuration} seconds, aspect ratio ${aspectRatio}, 1080p. Build cinematic shot-wise progression with one consistent subject identity.`
        : videoType === "montage"
          ? `${framingMode} montage video, ${roundedDuration} seconds, aspect ratio ${aspectRatio}, 1080p. Use 3-5 short visual beats with energetic continuity.`
          : `${framingMode} feature video, ${roundedDuration} seconds, aspect ratio ${aspectRatio}, 1080p. Keep a half-and-half split composition style with persona plus product-benefit context.`;
  const formatStyleRules =
    useSingleShotPointToCamera
      ? [
          "Keep one continuous scene with no location transition.",
          "Keep background stable with no scene change or cut."
        ]
      : videoType === "point_to_camera_multi_scene"
        ? [
            isEightSecondBumper
              ? "Edit rhythm: use at most one hard cut across the duration to form 1 or 2 clear scene blocks."
              : "Edit rhythm: create 2 or 3 hard cuts across the duration to form 3-4 clear scene blocks.",
            "Maintain the same subject identity, wardrobe continuity, and overall tonal continuity across all scenes.",
            isEightSecondBumper
              ? "Only cut on clean sentence boundaries from the spoken script. Never cut mid-sentence and never split dialogue by word chunks."
              : "",
            isEightSecondBumper
              ? "Background progression may use 1 or 2 distinct locations with clear but believable contrast in light/color/environment:"
              : "Background progression must follow this sequence with clear visual contrast in light/color/environment:",
            multiScenePlanLine,
            "Keep framing in a similar medium shot range across scenes so the edit feels intentional and premium.",
            isEightSecondBumper
              ? "Keep speaking shots controlled and readable. Gentle push-ins or natural movement are allowed only if mouth sync stays clean and framing remains stable."
              : "Allow natural camera drift/walk movement per scene; avoid abrupt handheld shakes.",
            ...multiSceneShotDirections
          ]
        : videoType === "montage"
          ? [
              "High-energy, full-bleed BOFU montage with fast, snappy editorial rhythm.",
              "Use 3 to 5 clear visual beats, with roughly 1-second cuts for kinetic pace.",
              "Intercut dynamic lifestyle moments while keeping one consistent persona and continuity of tone.",
              "Warm, friendly, empowering lighting and color mood; energetic but never chaotic."
            ]
          : [
              "Keep half-and-half visual language throughout with clear bilateral composition.",
              "Prioritize feature-led storytelling while keeping persona presence strong and conversion-focused."
          ];
  const cameraFacingDirective =
    useSingleShotPointToCamera || videoType === "point_to_camera_multi_scene"
      ? useSingleShotPointToCamera
        ? "Character must stay front-facing toward the camera through the full shot."
        : videoType === "point_to_camera_multi_scene"
        ? isEightSecondBumper
          ? "Character must stay front-facing toward the camera in every speaking beat."
          : "Character should face camera in most beats, with optional brief profile angle in one scene for edit variety."
        : "Character must stay primarily front-facing toward the camera through the shot."
      : "Keep the persona visible and front-facing in key moments, while allowing natural profile variation in montage beats.";
  const sideProfileDirective =
    useSingleShotPointToCamera
      ? "Do not use profile view, side gaze, or off-camera delivery."
      : videoType === "point_to_camera_multi_scene"
      ? isEightSecondBumper
        ? "Do not use profile view, side gaze, or off-camera delivery in speaking shots."
        : "Avoid prolonged off-camera gaze; if profile is used, return quickly to direct engagement."
      : "Avoid side profile, over-shoulder, or prolonged off-camera gaze.";
  const activityDirective =
    useSingleShotPointToCamera
      ? "Keep the subject focused on speaking directly to camera with restrained natural body language."
      : "Each beat should have one clear activity; avoid crowded multitasking in the same beat.";
  const locationDirective =
    useSingleShotPointToCamera
      ? "Use one single believable setting that supports the brief, backstory, and product context."
      : videoType === "point_to_camera_multi_scene"
        ? isEightSecondBumper
          ? "Use 1 or 2 distinct background locations only, with at most one hard cut."
          : "Use 3 to 4 distinct background locations with strong visual contrast and hard-cut transitions."
        : "Scene locations can vary by beat, but transitions must feel coherent and grounded in the same lifestyle context.";
  const endingCompositionDirective =
    useSingleShotPointToCamera
      ? "End in the same shot and same composition with no scene change, no cut, and no transition."
      : videoType === "point_to_camera_multi_scene"
        ? "After the final cut, hold the subject in the last environment with stable framing and no outro transition."
        : "End on a stable final composition with no camera reset, no fade-out, and no stylized transition.";
  const productSettingDirective =
    product === "kotak_air_plus"
      ? useSingleShotPointToCamera
        ? "For Kotak Air Plus, use one premium travel-related setting that fits the brief and backstory."
        : "For Kotak Air Plus, vary the setting across premium travel lifestyle contexts like transit moments, business-trip environments, city-transfer moments, hotel arrival, or casual getaway scenes when the script supports it. Do not default to airport-only visuals unless the script explicitly requires airport context. Avoid generic office lobbies, plain corporate corridors, railway concourses, and random city curbside pickups unless they contain unmistakable premium travel cues such as luggage, concierge arrival, terminal-adjacent architecture, or departure movement."
      : "";
  const cinematicDirective =
    product === "kotak_air_plus"
      ? "Cinematic style: premium editorial travel-film realism, rich but believable contrast, shallow depth separation, elegant lens compression, tasteful city/travel bokeh, and polished natural light. Keep it aspirational, affluent, and filmic without becoming glossy or artificial."
      : "Cinematic style: premium editorial realism with natural depth, clean contrast, and polished but believable lighting.";

  return [
    formatDirective,
    `Compose natively for ${aspectRatio}; do not crop from portrait staging.`,
    "Script lock: spoken dialogue must match the provided script verbatim. Do not add filler, opener words, paraphrases, rewritten phrasing, reordered lines, or substitute wording.",
    "Brand-name lock: if the script contains product or brand terms, speak them exactly as written and do not drop, soften, or replace them.",
    "Speech-start rule: the first spoken words must begin from the script itself with no preamble or invented lead-in.",
    "BOFU urgency cinematography: deliver a strong hook in the first second with direct eye contact and immediate action.",
    cameraFacingDirective,
    sideProfileDirective,
    useSingleShotPointToCamera
      ? "Use stable, restrained camera movement with a simple point-to-camera feel."
      : isEightSecondBumper
      ? "Use stable handheld realism with controlled camera movement. Gentle push-ins are allowed if speaking shots remain readable and settled."
      : "Use stable handheld realism with a subtle forward push-in over the shot to increase urgency without feeling aggressive.",
    cinematicDirective,
    compositionDirective,
    "Do not crop the top of the head, forehead, chin, or shoulders at any point.",
    "Maintain clear headroom and side room with stable composition through the full shot.",
    "Use crisp natural light and clear facial detail; keep background softly separated but believable.",
    "Single-shot hard rule: one camera setup, one location, one continuous take. No cuts, no montage, no inserts, no transition, no fade, no dissolve, no whip, no camera reset, and no scene change.",
    "Effects rule: do not use dreamy overlays, speed ramps, motion trails, artificial lens flare, abstract glow, excessive bloom, ghosting, or any stylized editorial treatment.",
    useSingleShotPointToCamera
      ? `Character profile: ${singleShotSubject}.`
      : "Continuity rule: preserve the same face, hairstyle, facial hair, wardrobe palette, accessory story, lens feel, color grade, and time-of-day logic across all scenes.",
    useSingleShotPointToCamera ? `Facial features: ${backstory.facial_features}.` : "",
    useSingleShotPointToCamera ? `Hairstyle and grooming: ${backstory.hairstyle_grooming}.` : "",
    useSingleShotPointToCamera ? `Wardrobe details: ${backstory.wardrobe_details}.` : "",
    useSingleShotPointToCamera ? `Posture and body language: ${backstory.posture_body_language}.` : "",
    useSingleShotPointToCamera ? `Expression style: ${backstory.expression_style}.` : "",
    useSingleShotPointToCamera ? `Speaking energy: ${BACKSTORY_SPEAKING_ENERGY_FALLBACK}` : "",
    useSingleShotPointToCamera ? `Body build: ${backstory.body_build}.` : "",
    useSingleShotPointToCamera ? `Background setting: ${backstory.setting}.` : "",
    `Performance pacing should escalate across ${roundedDuration} seconds with one clear emphasis beat and a decisive close.`,
    useSingleShotPointToCamera ? `Opening behavior: ${buildBehaviorDrivenOpeningHook(backstory)}` : MANDATORY_SORA_HOOK_RULE,
    useSingleShotPointToCamera ? `Performance behavior: ${buildBehaviorDrivenPerformance(backstory, script)}` : MANDATORY_SORA_PERFORMANCE_NATURALISM_RULE,
    useSingleShotPointToCamera ? `Expression progression: ${inferExpressionArc(script)}.` : MANDATORY_SORA_EXPRESSION_RULE,
    useSingleShotPointToCamera
      ? "Staging behavior: block the character naturally within the setting so the shot feels lived-in and behavior-first rather than planted and presentational. Keep the body softly asymmetrical, not front-on and perfectly centered, and avoid locked hand-clasp presenter poses."
      : MANDATORY_SORA_STAGING_RULE,
    useSingleShotPointToCamera ? "" : "Script-order rule: surface the first core benefit or RTB in the opening third of the runtime, not later.",
    useSingleShotPointToCamera ? "" : "Lip-sync rule: every visible speaking beat must keep precise, believable mouth-to-audio sync with no drift, especially in middle scenes.",
    useSingleShotPointToCamera ? "" : "Create an everyday lifestyle moment that feels natural and lived-in.",
    !useSingleShotPointToCamera && videoType === "point_to_camera_multi_scene"
      ? `Subject profile for continuity: ${multiSceneSubject}.`
      : "",
    activityDirective,
    useSingleShotPointToCamera ? "" : "Choose the activity based on persona and setting context without making it look staged.",
    locationDirective,
    useSingleShotPointToCamera ? "" : "Avoid repetitive beverage-prep defaults; do not default to tea/coffee unless the script explicitly asks for it.",
    productSettingDirective,
    ...formatStyleRules,
    ...multiSceneDirectionNotes,
    useSingleShotPointToCamera
      ? "Keep movement restrained but behavior-first, with a clear opening hook, visible emotional progression, and natural physical engagement while speaking."
      : isEightSecondBumper
      ? "Controlled micro-movement only, natural blink, and restrained gestures during spoken beats."
      : "Slight handheld micro-movement, natural blink, one small hand gesture.",
    "Motion validity rule: this must be a genuinely moving live-action shot, not a still portrait, freeze frame, static postcard composition, or near-motionless loop. The person must visibly blink, breathe, shift, and speak through the shot.",
    "Performance realism rule: avoid mannequin-still blocking, frozen shoulders, pinned elbows, dead eyes, pasted-on smiles, robotic nod loops, repeated hand loops, centered hand-clasped presenter poses, or over-controlled gesture patterns. Expression and body response should visibly track the meaning of the spoken line beat by beat.",
    useReferenceImage
      ? "Reference-frame lock: preserve the supplied keyframe's face, wardrobe, setting, lighting, and opening composition. Motion should begin from that exact reference look rather than recomposing the shot."
      : "",
    useReferenceImage
      ? "Maintain identity consistency with the reference image."
      : useSingleShotPointToCamera
        ? "Maintain one consistent character identity throughout the shot."
        : "Maintain one consistent character identity across all scenes without changing face, age, or wardrobe style.",
    "Wardrobe must look clean, well-ironed, and wrinkle-free with no sweat spots or perspiration marks.",
    `Voice delivery must stay ${FIXED_AD_DELIVERY_DESCRIPTOR.toLowerCase()}.`,
    "On-camera speech rule: the character must visibly speak every scripted line on camera. Do not use off-camera narrator delivery, voiceover-only delivery, hidden speaker treatment, or disembodied speech.",
    "Accent rule: spoken delivery must sound like natural Indian English with a clear Indian accent suited to the persona and city context. Do not use American, British, or neutralized global-ad accents.",
    "Audio rule: voice only, clean and dry. Do not add background music, score, jingle, singing, chant, rhythmic music bed, ambient sound bed, crowd bed, transit noise bed, room-tone build, or stylized sound design. If clean voice-only audio cannot be maintained, prefer silence over any non-speech bed.",
    "Photographic realism rule: render a fully photographic live-action person and environment. Do not make the image painterly, watercolor-like, oil-paint-like, smeared, dreamy-soft, hazy, plastic, doll-like, CGI-like, or over-stylized.",
    "Human realism rule: do not render the person as cartoonish, animated, illustrated, painterly, plastic, doll-like, CGI-like, beauty-filtered, over-smoothed, or uncanny. Avoid exaggerated jawlines, inflated hair volume, overly sharp beard edges, waxy skin, hyper-perfect symmetry, glamour-retouched skin, and influencer-style gloss. Keep pores, skin texture, facial asymmetry, and natural human imperfection believable.",
    "Do not include any screens or screen-like devices: no phones, laptops, tablets, TVs, monitors, or UI surfaces.",
    "Do not show any physical payment cards, card mockups, or card close-up shots.",
    "Absolute safety rule: if a frame introduces any card or screen element, reject that composition and keep the scene card-free and screen-free.",
    "Do not add supers, captions, subtitles, or any on-screen text.",
    "Do not introduce new on-screen text.",
    "Do not generate title cards, opening text, lower-thirds, signage text, wall text, labels, or any readable lettering in frame.",
    compactBrief ? `Campaign brief context: ${compactBrief}.` : "",
    compactGuidelines ? `Brand guidelines context: ${compactGuidelines}.` : "",
    spec.imageTreatment ? `Maintain this image treatment in motion: ${spec.imageTreatment}.` : "",
    "Final 0.6 to 0.8 seconds must be a stable hold on the same shot and same pose.",
    "After speech ends, keep direct eye contact and hold a subtle confident smile to camera for the remaining duration.",
    "Do not add a last-second cut, turn, zoom, gesture, expression change, scene change, or extra action after dialogue completion.",
    "Do not introduce any new action after dialogue completion.",
    endingCompositionDirective,
    "Ending constraint: do not use fade-out, dissolve, or stylized transition.",
    "Final beat should hold on the last frame momentarily before ending.",
    "Pace should feel BOFU urgency: energetic but not chaotic.",
    `Product mood: ${spec.imageVibe}.`,
    `Target audience context: ${spec.audienceSummary}.`,
    product === "kotak_air_plus"
      ? useSingleShotPointToCamera
        ? "Air Plus setting rule: the setting must visibly belong to a premium travel or trip-day world, not a generic corporate explainer backdrop."
        : "Air Plus setting rule: every scene must visibly belong to a premium travel or trip-day world, not a generic corporate explainer backdrop."
      : "",
    `Persona voice: ${FIXED_AD_DELIVERY_DESCRIPTOR}.`,
    `Exact spoken script, word for word: ${script}`
  ]
    .filter(Boolean)
    .join(" ");
}

export function getCompactReferenceLockedVeoPrompt(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  aspectRatio: SupportedAspectRatio = PRIMARY_FRAME_SPEC.aspectRatio,
  durationSeconds = DEFAULT_VIDEO_CONFIG.durationSeconds,
  guidelines?: string,
  brief?: string
): string {
  const spec = PRODUCT_SPECS[product];
  const roundedDuration = Math.max(8, Math.round(durationSeconds));
  const compactBrief = compactPromptContext(brief, 180);
  const compactGuidelines = compactPromptContext(guidelines, 140);
  const productWorldRule =
    product === "kotak_air_plus"
      ? "Keep the setting in a premium travel or trip-day world with believable mobility cues."
      : "Keep the setting grounded in practical everyday-spend contexts with no store or restaurant staging.";

  return clampPromptToSentenceBoundary(
    [
      `Single-shot portrait video, ${roundedDuration} seconds, aspect ratio ${aspectRatio}, 1080p.`,
      `Use the supplied keyframe as the exact starting frame and preserve the same face, wardrobe, setting, lighting, and composition throughout.`,
      "Keep the character front-facing to camera in a medium close-up with stable framing and clear headroom.",
      "One continuous take only. No cuts, no transitions, no camera reset, and no scene change.",
      "The person must visibly blink, breathe, shift naturally, and speak on camera through the shot.",
      "Use restrained natural body language with one small emphasis gesture at most. No robotic nodding, no looping gestures, and no locked presenter pose.",
      "Spoken dialogue must match the provided script verbatim. Do not paraphrase, add filler, reorder words, or soften brand/product terms.",
      "The first spoken words must begin directly from the script with no preamble.",
      "Voice must sound like confident, enthusiastic Indian English in a clean voice-only recording. No background music, ambient bed, or extra sound design.",
      "Render a fully photographic live-action person and environment with crisp facial detail, realistic skin texture, and believable motion.",
      "Do not make the result painterly, plastic, doll-like, over-smoothed, or uncanny.",
      "No cards, no phones, no laptops, no screens, no logos, no subtitles, and no readable on-screen text.",
      productWorldRule,
      `Persona context: ${backstory.persona_name}, ${backstory.age_range}, ${compactPromptContext(backstory.profession, 90)}.`,
      `Expression arc: ${inferExpressionArc(script)}.`,
      compactBrief ? `Campaign brief: ${compactBrief}.` : "",
      compactGuidelines ? `Brand guidance: ${compactGuidelines}.` : "",
      `Exact spoken script, word for word: ${script}`
    ]
      .filter(Boolean)
      .join(" "),
    2400
  );
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

function runCommandWithOutput(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || stdout || `${command} failed with exit code ${code}`));
    });
  });
}

async function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  await runCommandWithOutput(command, args, cwd);
}

function isFfmpegMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  return (
    message.includes("spawn ffmpeg ENOENT") ||
    message.includes("spawn ffprobe ENOENT") ||
    message.includes(`spawn ${FFMPEG_BIN} ENOENT`) ||
    message.includes(`spawn ${FFPROBE_BIN} ENOENT`) ||
    lowered.includes("ffmpeg not found") ||
    lowered.includes("ffprobe not found")
  );
}

function isWhisperMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(`spawn ${WHISPER_CLI_PATH} ENOENT`) || message.toLowerCase().includes("whisper not found");
}

function resolveSoraSeconds(targetSeconds: number): { requestSeconds: 4 | 8 | 12; targetSeconds: number } {
  if (targetSeconds <= 4) {
    return { requestSeconds: 4, targetSeconds };
  }
  if (targetSeconds <= 8) {
    return { requestSeconds: 8, targetSeconds };
  }
  return { requestSeconds: 12, targetSeconds };
}

type KlingDurationSeconds = "5" | "10";

function shouldUseKlingForDuration(durationSeconds: number): boolean {
  return durationSeconds >= 15;
}

interface MotionPollPolicy {
  intervalMs: number;
  maxAttempts: number;
  subscribeTimeoutMs?: number;
}

function isShortBumperTextToVideo(videoConfig: VideoConfig): boolean {
  const resolvedVideo = resolveVideoConfig(videoConfig);
  return resolvedVideo.type === "point_to_camera_multi_scene" && resolvedVideo.durationSeconds <= 8.5;
}

function resolveTextToVideoProvider(videoConfig: VideoConfig): VideoProvider {
  const resolvedVideo = resolveVideoConfig(videoConfig);
  return resolvedVideo.provider ?? DEFAULT_VIDEO_CONFIG.provider;
}

function getVeoMotionPollPolicy(videoConfig: VideoConfig): MotionPollPolicy {
  if (isShortBumperTextToVideo(videoConfig)) {
    return {
      intervalMs: SHORT_BUMPER_VEO_POLL_INTERVAL_MS,
      maxAttempts: SHORT_BUMPER_VEO_POLL_MAX_ATTEMPTS
    };
  }
  return {
    intervalMs: VEO_POLL_INTERVAL_MS,
    maxAttempts: VEO_POLL_MAX_ATTEMPTS
  };
}

function getFalVeoMotionPollPolicy(videoConfig: VideoConfig): MotionPollPolicy {
  const resolvedVideo = resolveVideoConfig(videoConfig);
  if (resolvedVideo.provider === "sora_i2v") {
    return {
      intervalMs: SORA_I2V_FAL_VEO_POLL_INTERVAL_MS,
      maxAttempts: SORA_I2V_FAL_VEO_POLL_MAX_ATTEMPTS,
      subscribeTimeoutMs: SORA_I2V_FAL_VEO_SUBSCRIBE_TIMEOUT_MS
    };
  }
  if (isShortBumperTextToVideo(videoConfig)) {
    return {
      intervalMs: SHORT_BUMPER_FAL_VEO_POLL_INTERVAL_MS,
      maxAttempts: SHORT_BUMPER_FAL_VEO_POLL_MAX_ATTEMPTS,
      subscribeTimeoutMs: SHORT_BUMPER_FAL_VEO_SUBSCRIBE_TIMEOUT_MS
    };
  }
  return {
    intervalMs: FAL_VEO_POLL_INTERVAL_MS,
    maxAttempts: FAL_VEO_POLL_MAX_ATTEMPTS,
    subscribeTimeoutMs: FAL_VEO_SUBSCRIBE_TIMEOUT_MS
  };
}

function getSoraMotionPollPolicy(videoConfig: VideoConfig): MotionPollPolicy {
  if (isShortBumperTextToVideo(videoConfig)) {
    return {
      intervalMs: SHORT_BUMPER_SORA_POLL_INTERVAL_MS,
      maxAttempts: SHORT_BUMPER_SORA_POLL_MAX_ATTEMPTS
    };
  }
  return {
    intervalMs: SORA_POLL_INTERVAL_MS,
    maxAttempts: SORA_POLL_MAX_ATTEMPTS
  };
}

function getFalSoraMotionPollPolicy(videoConfig: VideoConfig): MotionPollPolicy {
  if (isShortBumperTextToVideo(videoConfig)) {
    return {
      intervalMs: SHORT_BUMPER_FAL_SORA_POLL_INTERVAL_MS,
      maxAttempts: SHORT_BUMPER_FAL_SORA_POLL_MAX_ATTEMPTS,
      subscribeTimeoutMs: SHORT_BUMPER_FAL_SORA_SUBSCRIBE_TIMEOUT_MS
    };
  }
  return {
    intervalMs: FAL_SORA_POLL_INTERVAL_MS,
    maxAttempts: FAL_SORA_POLL_MAX_ATTEMPTS,
    subscribeTimeoutMs: FAL_SORA_SUBSCRIBE_TIMEOUT_MS
  };
}

function getKlingMotionPollPolicy(videoConfig: VideoConfig): MotionPollPolicy {
  if (isShortBumperTextToVideo(videoConfig)) {
    return {
      intervalMs: SHORT_BUMPER_KLING_POLL_INTERVAL_MS,
      maxAttempts: SHORT_BUMPER_KLING_POLL_MAX_ATTEMPTS,
      subscribeTimeoutMs: SHORT_BUMPER_KLING_SUBSCRIBE_TIMEOUT_MS
    };
  }
  return {
    intervalMs: KLING_POLL_INTERVAL_MS,
    maxAttempts: KLING_POLL_MAX_ATTEMPTS,
    subscribeTimeoutMs: KLING_SUBSCRIBE_TIMEOUT_MS
  };
}

function getMaxVideoGenerationAttempts(videoConfig: VideoConfig, runVideoQc: boolean): number {
  const resolvedVideo = resolveVideoConfig(videoConfig);
  const textToVideoRetryFloor =
    SORA_SCRIPT_FIDELITY_GUARD_ENABLED && resolvedVideo.provider === "sora" && isShortBumperTextToVideo(resolvedVideo) ? 2 : 1;
  const defaultAttempts = Math.max(
    1,
    VEO_CELEBRITY_FILTER_REGENERATE_ATTEMPTS,
    runVideoQc ? VIDEO_QC_MAX_ATTEMPTS : 1,
    textToVideoRetryFloor
  );
  if (isShortBumperTextToVideo(resolvedVideo)) {
    return Math.min(defaultAttempts, 2);
  }
  return defaultAttempts;
}

function shouldUseSoraOnlyTextToVideo(product: ProductKey, videoConfig: VideoConfig): boolean {
  const resolvedVideo = resolveVideoConfig(videoConfig);
  return product === "kotak_air_plus" && isShortBumperTextToVideo(resolvedVideo);
}

function shouldPreferFalSoraFor1080p(videoConfig: VideoConfig): boolean {
  const resolvedVideo = resolveVideoConfig(videoConfig);
  return resolvedVideo.provider === "sora" && Boolean(process.env.FAL_KEY?.trim());
}

function shouldApplyTopazUpscale(videoConfig: VideoConfig): boolean {
  if (!process.env.FAL_KEY?.trim()) {
    return false;
  }
  if (TOPAZ_UPSCALE_MODE === "off") {
    return false;
  }
  const resolvedVideo = resolveVideoConfig(videoConfig);
  if (TOPAZ_UPSCALE_MODE === "all") {
    return !isHowToVideoType(resolvedVideo.type);
  }
  return resolvedVideo.provider === "sora" && !isHowToVideoType(resolvedVideo.type);
}

function clampTopazFloat(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, value));
}

function resolveKlingSeconds(targetSeconds: number): { requestSeconds: KlingDurationSeconds; targetSeconds: number } {
  if (targetSeconds <= 5) {
    return { requestSeconds: "5", targetSeconds };
  }
  return { requestSeconds: "10", targetSeconds };
}

function resolveFrameSpec(aspectRatio: SupportedAspectRatio): FrameSpec {
  if (aspectRatio === "1:1") {
    return SQUARE_FRAME_SPEC;
  }
  if (aspectRatio === "16:9") {
    return LANDSCAPE_FRAME_SPEC;
  }
  return PRIMARY_FRAME_SPEC;
}

type SoraSize = "1024x1792" | "1792x1024";

function resolveSoraSize(aspectRatio: SupportedAspectRatio): SoraSize {
  if (aspectRatio === "16:9") {
    return "1792x1024";
  }
  return "1024x1792";
}

function resolveSoraModel(size: SoraSize): string {
  if (size === "1024x1792" || size === "1792x1024") {
    return SORA_MODEL === "sora-2" ? "sora-2-pro" : SORA_MODEL;
  }
  return SORA_MODEL;
}

function resolveFalSoraAspectRatio(aspectRatio: SupportedAspectRatio): "9:16" | "16:9" {
  return aspectRatio === "16:9" ? "16:9" : "9:16";
}

async function parseOpenAiErrorMessage(response: Response): Promise<string> {
  const raw = await response.text();
  if (!raw) {
    return `HTTP ${response.status}`;
  }
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    const message = parsed.error?.message?.trim();
    return message || raw;
  } catch {
    return raw;
  }
}

function getSoraPromptWriterInput(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  aspectRatio: SupportedAspectRatio,
  videoType: VideoType,
  durationSeconds: number,
  guidelines?: string,
  brief?: string
): string {
  const spec = PRODUCT_SPECS[product];
  const compactBrief = compactPromptContext(brief, 900) || "None provided.";
  const compactGuidelines = compactPromptContext(guidelines, 900) || "None provided.";

  return [
    "Generate the final video prompt using the following inputs.",
    `Product: ${product}`,
    `Product positioning: ${spec.positioning ?? "None provided."}`,
    `Core promise: ${spec.corePromise ?? "None provided."}`,
    `Audience summary: ${spec.audienceSummary}`,
    `Image treatment: ${spec.imageTreatment ?? "None provided."}`,
    `Product mood: ${spec.imageVibe}`,
    `Product hooks: ${spec.hooks.join(" | ")}`,
    spec.constraintsToState.length > 0 ? `Product constraints: ${spec.constraintsToState.join(" | ")}` : "",
    spec.avoidClaims.length > 0 ? `Claims to avoid: ${spec.avoidClaims.join(" | ")}` : "",
    `Video type: ${videoType}`,
    `Aspect ratio: ${aspectRatio}`,
    `Duration seconds: ${Math.max(1, Math.round(durationSeconds))}`,
    "Default framing: tight medium close-up from mid-chest upward only with full face visibility unless the brief explicitly requires a wider composition.",
    `Script: ${script}`,
    `Campaign brief: ${compactBrief}`,
    `Brand guidelines: ${compactGuidelines}`,
    "Backstory of character:",
    `- Name: ${backstory.persona_name}`,
    `- Gender presentation: ${backstory.gender_presentation}`,
    `- Age range: ${backstory.age_range}`,
    `- City: ${backstory.city}`,
    `- Profession: ${backstory.profession}`,
    `- Why they care: ${backstory.why_they_care}`,
    `- Facial features: ${backstory.facial_features}`,
    `- Hairstyle and grooming: ${backstory.hairstyle_grooming}`,
    `- Wardrobe details: ${backstory.wardrobe_details}`,
    `- Posture and body language: ${backstory.posture_body_language}`,
    `- Expression style: ${backstory.expression_style}`,
    `- Speaking energy: ${BACKSTORY_SPEAKING_ENERGY_FALLBACK}`,
    `- Body build: ${backstory.body_build}`,
    `- Speaking style: ${BACKSTORY_SPEAKING_STYLE_LOCK.join(" | ")}`,
    `- Wardrobe and props: ${backstory.wardrobe_props.join(" | ")}`,
    `- Setting: ${backstory.setting}`,
    backstory.compliance_notes.length > 0 ? `- Compliance notes: ${backstory.compliance_notes.join(" | ")}` : "",
    "Hard safety constraints to obey regardless of any other input:",
    "- No readable text, subtitles, captions, logos, labels, signage text, or title cards.",
    "- No screens or screen-like devices: phone, laptop, tablet, monitor, TV, UI surfaces.",
    "- No physical payment cards, card mockups, or card close-ups.",
    "- Voice only. No background music, score, jingle, rhythmic music bed, ambient sound bed, crowd noise bed, transit noise bed, or stylized sound design.",
    "- No cartoonish, animated, illustrated, painterly, plastic, doll-like, CGI-like, beauty-filtered, over-smoothed, waxy, or uncanny human rendering. Avoid exaggerated jawlines, inflated hair volume, hyper-perfect symmetry, glamour-retouched skin, and overly sharp beard edges.",
    "- No mannequin-still or robotic performance. Avoid frozen shoulders, dead eyes, pasted-on smiles, repetitive nodding, repeated hand loops, or any gesture pattern that feels animated instead of lived-in.",
    "- Natural Indian-English accent only.",
    "- Clean stable ending only: no abrupt cutoff, no mid-word ending, no broken action, no unstable outro behavior."
  ]
    .filter(Boolean)
    .join("\n");
}

function extractPromptWriterText(payload: unknown): string {
  const directText = responseText(payload).trim();
  if (directText) {
    return directText;
  }

  if (!payload || typeof payload !== "object") {
    return "";
  }

  const direct = (payload as { output_text?: unknown }).output_text;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  const output = (payload as { output?: Array<{ content?: Array<{ text?: unknown }> }> }).output;
  if (!Array.isArray(output)) {
    return "";
  }

  const parts: string[] = [];
  for (const item of output) {
    if (!item || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (typeof content?.text === "string" && content.text.trim()) {
        parts.push(content.text.trim());
      }
    }
  }

  return parts.join("\n").trim();
}

function normalizeSoraPromptWriterOutput(raw: string): string {
  return raw
    .replace(/^Final Sora Prompt:\s*/i, "")
    .replace(/^Final Video Prompt:\s*/i, "")
    .replace(/^["']+|["']+$/g, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inferExpressionArc(script: string): string {
  const normalizedScript = normalizeComparableText(script);
  if (script.includes("?")) {
    return "from alert curiosity to clear assurance";
  }
  if (/\bapply now\b/.test(normalizedScript)) {
    return "from composed confidence to decisive reassurance";
  }
  if (/\b(learn more|know more|explore more|see how)\b/.test(normalizedScript)) {
    return "from thoughtful interest to warm invitation";
  }
  return "from composed attention to warm confidence";
}

function inferPerformanceBeatProgression(script: string): string {
  const normalizedScript = normalizeComparableText(script);
  if (script.includes("?")) {
    return "start with alert questioning focus, let the answer relax the eyes and mouth into clarity, and close with a small reassured nod";
  }
  if (/\bapply now\b/.test(normalizedScript)) {
    return "open with purposeful attention, sharpen slightly on the core benefit with a brief brow-and-eye lift, then land the close with firmer conviction and a settled half-smile";
  }
  if (/\b(learn more|know more|explore more|see how)\b/.test(normalizedScript)) {
    return "begin observant and engaged, let the benefit warm the face and eyes, and finish with an inviting half-smile";
  }
  return "begin composed and alert, let the key claim create a subtle brow-and-eye response, and resolve into warm confidence on the close";
}

function inferGestureBehavior(script: string): string {
  const normalizedScript = normalizeComparableText(script);
  if (/\b(apply now|join now|book now|sign up|switch now)\b/.test(normalizedScript)) {
    return "Use one restrained emphasis gesture or tiny nod on the main benefit or CTA, then let the hands settle naturally rather than repeating the motion.";
  }
  if (/\b(learn more|know more|explore more|see how)\b/.test(normalizedScript)) {
    return "Use at most one open conversational hand release on the value beat, then return to a relaxed settled posture.";
  }
  return "Use one small conversational emphasis gesture or head movement on the main value beat, then let the body settle rather than looping motions.";
}

function buildBehaviorDrivenOpeningHook(backstory: Backstory): string {
  const normalizedSetting = normalizeComparableText(backstory.setting);
  if (/\b(waterfront|coastal|resort|hillside|promenade|scenic|retreat)\b/.test(normalizedSetting)) {
    return "He begins alive in frame with a brief glance through the travel-day surroundings, then turns into direct eye contact as a soft knowing smile starts to form.";
  }
  if (/\b(airport|terminal|departure|transfer|transit|lounge|tarmac)\b/.test(normalizedSetting)) {
    return "He starts mid-settle in the travel space, easing his shoulders into place and lifting into direct eye contact before the first line lands.";
  }
  if (/\b(hotel|concierge|arrival|porte|portico|valet|lobby)\b/.test(normalizedSetting)) {
    return "He begins with a small jacket or posture settle in the arrival space, then lands into direct eye contact with a quietly confident look.";
  }
  return "He is already alive in frame, finishing a small posture shift and lifting into direct eye contact with a responsive expression before speaking.";
}

function buildBehaviorDrivenPerformance(backstory: Backstory, script: string): string {
  const expressionArc = inferExpressionArc(script);
  const beatProgression = inferPerformanceBeatProgression(script);
  const gestureBehavior = inferGestureBehavior(script);
  return `Keep natural blinking, breathing, micro-expressions, slight posture shifts, and small script-led emphasis visible throughout. Facial behavior should progress ${expressionArc}. Let the performance evolve beat by beat: ${beatProgression}. ${gestureBehavior} Expression style: ${backstory.expression_style} Posture and body language: ${backstory.posture_body_language} Speaking energy: ${BACKSTORY_SPEAKING_ENERGY_FALLBACK} Avoid fixed smiles, robotic nodding, looping gestures, pinned elbows, and locked shoulders. The delivery should feel premium, intimate, and behavior-first rather than staged or over-rehearsed.`;
}

function inferSceneInteriorExterior(setting: string): "INT." | "EXT." {
  const normalizedSetting = normalizeComparableText(setting);
  if (/\b(portico|courtyard|promenade|coastal|waterfront|arrival court|arrival path|driveway|drop-off|pickup|forecourt|terrace|outdoor|open-air|skybridge|walkway|path)\b/.test(normalizedSetting)) {
    return "EXT.";
  }
  return "INT.";
}

function inferSceneLocationLabel(backstory: Backstory): string {
  const normalizedSetting = normalizeComparableText(backstory.setting);
  if (/\b(coastal|waterfront|resort|retreat|promenade)\b/.test(normalizedSetting)) {
    return "LUXURY RESORT ARRIVAL PORTICO";
  }
  if (/\b(airport|terminal|departure|transfer|transit|tarmac)\b/.test(normalizedSetting)) {
    return "PREMIUM TRANSIT CORRIDOR";
  }
  if (/\b(lounge|club|foyer|salon)\b/.test(normalizedSetting)) {
    return "PREMIUM TRAVEL LOUNGE";
  }
  if (/\b(hotel|concierge|arrival|valet|lobby|porte|portico)\b/.test(normalizedSetting)) {
    return "HIGH-END HOTEL ARRIVAL ZONE";
  }
  return "PREMIUM TRAVEL-DAY SETTING";
}

function inferSceneTimeLabel(backstory: Backstory): string {
  const normalizedSetting = normalizeComparableText(`${backstory.setting} ${backstory.why_they_care}`);
  if (/\b(night|late night)\b/.test(normalizedSetting)) {
    return "NIGHT";
  }
  if (/\b(evening|dusk|sunset)\b/.test(normalizedSetting)) {
    return "EVENING";
  }
  if (/\b(morning|sunrise)\b/.test(normalizedSetting)) {
    return "MORNING";
  }
  if (/\b(late afternoon|golden hour|sunlit|sun-drenched|warm late-afternoon)\b/.test(normalizedSetting)) {
    return "LATE AFTERNOON";
  }
  return "DAY";
}

function inferSocialSignal(backstory: Backstory): string {
  const profile = normalizeComparableText(`${backstory.profession} ${backstory.why_they_care}`);
  if (/\b(partner|founder|managing|director|principal|vp|vice president|consultant)\b/.test(profile)) {
    return "affluent, well-traveled";
  }
  if (/\b(architecture|design|creative|hospitality|luxury|boutique)\b/.test(profile)) {
    return "design-world, upscale";
  }
  if (/\b(corporate|sales|tech|finance|consulting)\b/.test(profile)) {
    return "polished metro professional";
  }
  return "premium-minded, urban";
}

function compactPromptCueText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxChars) {
    return normalized.replace(/[,:;.\-–—\s]+$/g, "");
  }

  const sliced = normalized.slice(0, maxChars);
  const safeCut = sliced.lastIndexOf(" ");
  const trimmed = (safeCut > Math.max(24, Math.floor(maxChars * 0.75)) ? sliced.slice(0, safeCut) : sliced).trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  while (words.length > 3 && PROMPT_DANGLING_FRAGMENT_WORDS.has(words[words.length - 1]!.toLowerCase())) {
    words.pop();
  }
  return words.join(" ").replace(/[,:;.\-–—\s]+$/g, "");
}

function deriveWardrobeCue(wardrobeDetails: string): string {
  const garmentKeywords = [
    "trench",
    "coat",
    "wrap",
    "blouse",
    "shirt",
    "overshirt",
    "polo",
    "top",
    "dress",
    "camisole",
    "cami",
    "crewneck",
    "crew-neck",
    "knit",
    "cardigan",
    "tailoring",
    "trousers"
  ];
  const stripped = wardrobeDetails
    .replace(/^(she|he|they)\s+wears?\s+/i, "")
    .replace(/^wearing\s+/i, "")
    .replace(/^dressed in\s+/i, "")
    .replace(
      /^(refined arrival dressing|elevated travel tailoring|soft travel tailoring|elevated travel-ready separates|elevated travel-ready ensemble|elevated travel ensemble|travel-ready ensemble|travel-smart ensemble|resort-smart premium separates)\s+(featuring|with|built around)\s+/i,
      ""
    )
    .replace(
      /^(an?|the)\s+(elevated|travel-smart|travel-ready|refined|pristine|beautifully draped|fluid|softly structured|climate-aware|premium|executive|arrival-ready)\b[^,.]{0,90}?\b(featuring|with)\s+/i,
      ""
    )
    .replace(/^[Aa]n?\s+/i, "")
    .replace(/(?:,|—|-)\s*(paired with|finished with|looking|exuding|giving|creating|while|without|offering|reflecting|projecting|striking|balancing|perfect(?:ly)? suited|ideal for)\b.*$/i, "")
    .replace(/\s+(offering|reflecting|projecting|striking|balancing|perfect(?:ly)? suited|ideal for)\b.*$/i, "")
    .replace(/\bwell-ironed\b/gi, "")
    .replace(/\bwrinkle-free\b/gi, "")
    .replace(/\bperfectly ironed\b/gi, "")
    .replace(/\bperfectly tailored\b/gi, "")
    .replace(/\bcomfortably\b/gi, "")
    .replace(/\bbreathable\b/gi, "")
    .replace(/\bclean\b/gi, "")
    .replace(/\bpremium\b/gi, "")
    .replace(/\bhigh-quality\b/gi, "")
    .replace(/\bpristine\b/gi, "")
    .replace(/\blinen-blend\b/gi, "linen")
    .replace(/\bt-shirt\b/gi, "tee")
    .replace(/\bcrew-neck\b/gi, "crewneck")
    .replace(/\bcrew neck\b/gi, "crewneck")
    .replace(/\bunstructured\b/gi, "")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

  let normalized = stripped
    .replace(/^(she|he|they)\s+/i, "")
    .replace(/^(an?|the)\s+/i, "")
    .replace(/^[,.\s]+/g, "")
    .replace(/[,:;.\-–—\s]+$/g, "");

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const garmentIndex = tokens.findIndex((token) => {
    const normalizedToken = token.toLowerCase().replace(/-/g, "");
    return garmentKeywords.some((keyword) => normalizedToken.includes(keyword.replace(/-/g, "")));
  });
  if (garmentIndex > 3) {
    normalized = tokens.slice(Math.max(0, garmentIndex - 3)).join(" ");
  }

  if (/\b(blazer|jacket)\b/i.test(normalized)) {
    return normalized
      .replace(/\bnavy blue\b/gi, "navy")
      .replace(/\bice-blue\b/gi, "ice-blue")
      .replace(/\bblazer\b/gi, "tailoring")
      .replace(/\bjacket\b/gi, "tailoring")
      .replace(/\blayered over\b/gi, "with")
      .replace(/\blayered with\b/gi, "with")
      .replace(/\bover\s+a\b/gi, "with a")
      .replace(/\bover\b/gi, "with")
      .replace(/\bwith a,\s+/gi, "with a ")
      .replace(/\ba,\s+([a-z-]+)/gi, "a $1")
      .replace(/\b(an?|the),\s+/gi, "$1 ")
      .replace(/\ba wrinkle-free\b/gi, "a")
      .replace(/\ba crisp\b/gi, "a")
      .replace(/\bcrisp,\s*/gi, "")
      .replace(/\bcrisp\b/gi, "")
      .replace(/\s+/g, " ")
      .replace(/[,:;.\-–—\s]+$/g, "")
      .trim();
  }

  return normalized
    .replace(/\b(she|he|they)\b/gi, "")
    .replace(/\b(an?|the),\s+/gi, "$1 ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[,.\s]+/g, "")
    .replace(/[,:;.\-–—\s]+$/g, "")
    .trim();
}

function inferWardrobeCue(backstory: Backstory): string {
  const derivedCue = deriveWardrobeCue(backstory.wardrobe_details);
  if (derivedCue) {
    return compactPromptCueText(derivedCue, 62);
  }
  return compactPromptCueText(backstory.wardrobe_details, 62);
}

function trimPromptDetailTail(
  value: string,
  options: {
    dropPairedWith?: boolean;
    dropWithClause?: boolean;
  } = {}
): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^(she|he|they)\s+has\s+/i, "")
    .replace(/^(her|his|their)\s+face\s+features\s+/i, "")
    .replace(/^(she|he|they)\s+(stands?|standing|maintains?|maintaining|carries|carrying|keeps|keeping)\s+/i, "")
    .replace(
      /(?:,|\s)(offering|creating|projecting|reflecting|balancing|capturing|giving|conveying|showing|revealing|signaling|maintaining|keeping|featuring|projecting|set against|framed by)\b.*$/i,
      ""
    )
    .replace(options.dropPairedWith ? /(?:,|\s)(paired with|paired alongside)\b.*$/i : /$^/, "")
    .replace(options.dropWithClause ? /(?:,|\s)with\b.*$/i : /$^/, "")
    .replace(/(?:,|\s)(complemented by|complemented)\b.*$/i, "")
    .replace(/\s+\bbut\b.*$/i, "")
    .replace(/[,:;.\-–—\s]+$/g, "")
    .trim();
}

function trimPromptDanglingWords(value: string, minWords = 3): string {
  const words = value.split(/\s+/).filter(Boolean);
  while (words.length > minWords && PROMPT_DANGLING_FRAGMENT_WORDS.has(words[words.length - 1]!.toLowerCase())) {
    words.pop();
  }
  return words.join(" ").trim();
}

function trimPromptIncompleteEnding(value: string): string {
  let next = value.trim();
  let previous = "";

  while (next && next !== previous) {
    previous = next;
    next = next
      .replace(
        /\b(?:a|an|the)\s+(?:chic|classic|refined|premium|soft|warm|quiet|natural|clean|grounded|poised|steady|direct|thoughtful|observant|engaging|approachable|lived-in|travel-ready|climate-aware|commanding)\s*$/i,
        ""
      )
      .replace(/\b(?:few|slight|slightly)\s+(?:natural|subtle|soft|warm|quiet|clean|refined)\s*$/i, "")
      .replace(/\bwith\s+(?:a|an|the|few|slight|slightly)\s*$/i, "")
      .replace(/\b(?:one hand|both hands|occasionally|holding|slightly|prominent|thick|tailored|navy|charcoal|ivory|camel|olive)\s*$/i, "")
      .replace(/\bacross the bridge(?: of)?\s*$/i, "")
      .trim();
    next = trimPromptDanglingWords(next);
  }

  return next;
}

function compactPromptDetailPhrase(
  value: string,
  maxChars: number,
  options: {
    dropPairedWith?: boolean;
    dropWithClause?: boolean;
    stripLeadingState?: boolean;
  } = {}
): string {
  let normalized = trimPromptDetailTail(value, {
    dropPairedWith: options.dropPairedWith,
    dropWithClause: options.dropWithClause
  })
    .replace(/\s+/g, " ")
    .trim();

  if (options.stripLeadingState) {
    normalized = normalized
      .replace(
        /^(she|he|they)\s+(has|wears?|is|stands?|standing|maintains?|maintaining|carries|carrying|keeps?|keeping|rests?|resting|leans?|leaning|holds?|holding|moves?|moving|sits?|sitting|uses?|using)\s+/i,
        ""
      )
      .replace(/^(with|using)\s+/i, "")
      .trim();
  }

  normalized = trimPromptIncompleteEnding(normalized);
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxChars) {
    return normalized.replace(/[,:;.\-–—\s]+$/g, "");
  }

  const compact = compactPromptCueText(normalized, maxChars);
  const withoutTrailingWithClause = compact.replace(/\s+\b(with|using|holding|resting|leaning)\b.*$/i, "").trim();
  const repaired = trimPromptIncompleteEnding(withoutTrailingWithClause || compact);
  if (repaired && repaired.split(/\s+/).length >= 4) {
    return repaired.replace(/[,:;.\-–—\s]+$/g, "");
  }

  return trimPromptIncompleteEnding(compactPromptSectionText(normalized, maxChars).replace(/\.$/, "")).replace(
    /[,:;.\-–—\s]+$/g,
    ""
  );
}

function compactPromptClausePhrase(value: string, maxChars: number): string {
  const normalized = trimPromptDetailTail(value).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxChars) {
    return trimPromptDanglingWords(normalized);
  }

  const clauses = normalized.split(/,\s+/).filter(Boolean);
  const selected: string[] = [];
  for (const clause of clauses) {
    const candidate = selected.length > 0 ? `${selected.join(", ")}, ${clause}` : clause;
    if (candidate.length <= maxChars || selected.length === 0) {
      selected.push(clause);
      continue;
    }
    break;
  }

  if (selected.length > 1 && selected[selected.length - 1]!.split(/\s+/).length < 4) {
    selected.pop();
  }
  const clauseJoined = trimPromptDanglingWords(selected.join(", ").trim());
  if (clauseJoined && clauseJoined.length >= Math.min(maxChars, 32)) {
    return clauseJoined.replace(/[,:;.\-–—\s]+$/g, "");
  }
  return compactPromptCueText(normalized, maxChars);
}

function buildFacialDetailLine(backstory: Backstory): string {
  const clauseFirstDetail = trimPromptIncompleteEnding(
    compactPromptClausePhrase(
      trimPromptDetailTail(backstory.facial_features).replace(/\s+/g, " ").trim(),
      124
    )
  );
  const detail =
    clauseFirstDetail && clauseFirstDetail.split(/\s+/).length >= 6
      ? clauseFirstDetail
      : compactPromptDetailPhrase(backstory.facial_features, 112, { stripLeadingState: true });
  return `${backstory.persona_name} has ${detail}.`;
}

function buildHairGroomingDetailLine(backstory: Backstory): string {
  const normalizedHair = backstory.hairstyle_grooming
    .replace(/\s+/g, " ")
    .replace(/(?:,|\s)(paired with|paired alongside|complemented by|complemented|sporting|wearing)\b.*$/i, "")
    .replace(/[,:;.\-–—\s]+$/g, "")
    .trim();
  const clauseFirstDetail = trimPromptIncompleteEnding(
    compactPromptCueText(normalizedHair, 140)
  );
  const detail =
    clauseFirstDetail && clauseFirstDetail.split(/\s+/).length >= 5
      ? clauseFirstDetail
      : compactPromptDetailPhrase(normalizedHair, 132, { stripLeadingState: true });
  return `Hair and grooming: ${detail}.`;
}

function buildWardrobeAndFrameDetailLine(backstory: Backstory): string {
  const wardrobePhrase = compactPromptDetailPhrase(backstory.wardrobe_details, 122, {
    dropPairedWith: true,
    stripLeadingState: true
  });
  return `Wardrobe and build: ${wardrobePhrase}.`;
}

function buildMovementQualityLine(backstory: Backstory): string {
  let posturePhrase = compactPromptDetailPhrase(backstory.posture_body_language, 94, {
    stripLeadingState: true
  })
    .replace(/^(with|using)\s+/i, "")
    .replace(/(?:,|\s)(?:holding|occasionally)\b.*$/i, "")
    .replace(/^(?:stands?|standing|maintains?|maintaining|keeps?|keeping|holds?|holding)\s+(?:with\s+)?/i, "")
    .trim();

  const normalizedPosture = normalizeComparableText(posturePhrase);
  const weightCue =
    /\bone leg|one side|one hip\b/.test(normalizedPosture)
      ? "easy weight shifting through one side"
      : /\bweight|shift|asymmetrical\b/.test(normalizedPosture)
        ? "easy weight shifting through the stance"
        : /\bstride|step|walk|walking\b/.test(normalizedPosture)
          ? "a small step-and-settle rhythm"
          : "soft asymmetry through the stance";
  const postureCue =
    /\blean|forward\b/.test(normalizedPosture)
      ? "a slight lean-in on the key line"
      : /\bturn|pivot\b/.test(normalizedPosture)
        ? "a small turn-and-settle into the line"
        : "shoulders easing down naturally";
  const gestureCue =
    /\bopen hand|open-handed\b/.test(normalizedPosture)
      ? "one restrained open-hand gesture while speaking"
      : /\bfluid hand\b/.test(normalizedPosture)
        ? "one fluid hand release on the benefit beat"
        : /\bprecise hand\b/.test(normalizedPosture)
          ? "one small precise hand gesture on the key phrase"
          : /\bnod\b/.test(normalizedPosture)
            ? "a light nod or small hand cue on emphasis"
            : "hands free for one restrained conversational gesture";
  const settleCue =
    /\bcalm momentum|momentum|brisk\b/.test(normalizedPosture)
      ? "then settling back into calm momentum"
      : "then letting the body settle again";

  const compactMovementPhrase = trimPromptIncompleteEnding(
    compactPromptClausePhrase(`${weightCue}, ${postureCue}, ${gestureCue}, ${settleCue}`, 118)
      .replace(/\b(?:hand|hands|arm|arms|elbow|elbows)\s*$/i, "")
      .trim()
  );
  return `Movement quality: ${compactMovementPhrase}.`;
}

function buildSceneMidAction(backstory: Backstory): string {
  const normalizedSetting = normalizeComparableText(backstory.setting);
  if (/\b(coastal|waterfront|resort|retreat|promenade)\b/.test(normalizedSetting)) {
    return "already mid-settle in the arrival space, finishing a relaxed turn as the breeze moves through the portico";
  }
  if (/\b(airport|terminal|departure|transfer|transit|tarmac|lounge)\b/.test(normalizedSetting)) {
    return "already caught in a poised travel pause, shoulders easing into place during a small stance reset";
  }
  if (/\b(hotel|concierge|arrival|valet|lobby|porte|portico)\b/.test(normalizedSetting)) {
    return "already in a lived-in arrival moment, finishing a small posture settle in the space";
  }
  return "already caught mid-thought, completing a small posture reset in the environment";
}

function buildSceneNoticeCamera(backstory: Backstory): string {
  const normalizedSetting = normalizeComparableText(backstory.setting);
  if (/\b(coastal|waterfront|resort|retreat|promenade)\b/.test(normalizedSetting)) {
    return "They catch the camera with a brief glance back into frame, settle into direct-to-camera engagement, let a soft knowing smile form, and start speaking.";
  }
  if (/\b(airport|terminal|departure|transfer|transit|tarmac|lounge)\b/.test(normalizedSetting)) {
    return "They notice the camera as they settle, lift into steady direct-to-camera eye contact, and let the first line land without breaking the moment.";
  }
  return "They notice the camera, land into direct-to-camera eye contact, and let a small confident expression rise before speaking.";
}

function buildSceneBodyLanguage(backstory: Backstory, script: string): string {
  const beatProgression = inferPerformanceBeatProgression(script);
  const gestureBehavior = inferGestureBehavior(script)
    .replace(/^Use\s+/i, "")
    .replace(/\.$/, "")
    .replace(/^at most\s+/i, "use at most ")
    .trim();
  return `Expression and body language: emotionally specific and progressing ${inferExpressionArc(script)}. ${capitalizeFirst(beatProgression)}. ${capitalizeFirst(gestureBehavior)}. Keep the stance softly asymmetrical with hands relaxed and separated; avoid centered hand-clasped presenter blocking or a frozen front-on pose.`;
}

function inferBeatEmphasisPhrase(beat: string, lineIndex: number, totalLines: number): string {
  const normalizedBeat = beat.replace(/\s+/g, " ").trim();
  if (!normalizedBeat) {
    return lineIndex === totalLines - 1 ? "the CTA" : "the key benefit";
  }

  if (lineIndex === totalLines - 1 && /\b(apply now|learn more|know more|book now|join now|switch now)\b/i.test(normalizedBeat)) {
    const cta = normalizedBeat.match(/\b(apply now|learn more|know more|book now|join now|switch now)\b/i)?.[0];
    return cta ? `"${cta}"` : "the CTA";
  }

  const patterns = [
    /\btravel privileges worth over rs\.?\s*80,?000\b/i,
    /\bcomplimentary flight\b/i,
    /\bquarterly spend\b/i,
    /\b1(?:\.|,)?5\s*lakh\b/i,
    /\bone (?:and a half|point five) lakhs?\b/i,
    /\b5\s*percent\b/i,
    /\b2\s*percent\b/i,
    /\bzero joining fee\b/i
  ];

  for (const pattern of patterns) {
    const match = normalizedBeat.match(pattern)?.[0];
    if (match) {
      return `"${match}"`;
    }
  }

  const words = normalizedBeat.split(/\s+/).filter(Boolean);
  return `"${words.slice(0, Math.min(words.length, 5)).join(" ")}"`;
}

function inferBeatPace(script: string, lineIndex: number, totalLines: number): string {
  const normalizedScript = normalizeComparableText(script);
  if (lineIndex === totalLines - 1) {
    if (/\b(apply now|join now|book now|switch now)\b/.test(normalizedScript)) {
      return "slightly firmer pace";
    }
    return "slightly tightened pace";
  }
  if (script.includes("?")) {
    return "measured conversational pace";
  }
  return "measured but varied pace";
}

function inferBeatPause(lineIndex: number, totalLines: number): string {
  if (totalLines > 1 && lineIndex === 0) {
    return "brief pause before the close";
  }
  if (lineIndex === totalLines - 1) {
    return "brief pause before the close";
  }
  return "natural mid-line pause";
}

function inferBeatFinish(script: string, lineIndex: number, totalLines: number): string {
  const normalizedScript = normalizeComparableText(script);
  if (lineIndex === totalLines - 1) {
    if (/\b(apply now|join now|book now|switch now)\b/.test(normalizedScript)) {
      return "decisive warm finish";
    }
    if (/\b(learn more|know more|explore more|see how)\b/.test(normalizedScript)) {
      return "inviting assured finish";
    }
    return "settled confident finish";
  }
  if (script.includes("?")) {
    return "clarifying assured finish";
  }
  return "human assured finish";
}

function buildDialogueTone(backstory: Backstory, beat: string, script: string, lineIndex: number, totalLines: number): string {
  const pace = inferBeatPace(script, lineIndex, totalLines);
  const emphasis = inferBeatEmphasisPhrase(beat, lineIndex, totalLines);
  const pause = inferBeatPause(lineIndex, totalLines);
  const finish = inferBeatFinish(script, lineIndex, totalLines);
  const voiceDescriptor = trimPromptIncompleteEnding(FIXED_AD_DELIVERY_DESCRIPTOR);
  const clauses = [
    `${voiceDescriptor}, ${pace}`,
    `stress ${emphasis}`,
    pause,
    finish
  ];
  const selected: string[] = [];
  for (const clause of clauses) {
    const candidate = selected.length > 0 ? `${selected.join("; ")}; ${clause}` : clause;
    if (candidate.length <= 118 || selected.length === 0) {
      selected.push(clause);
      continue;
    }
    break;
  }
  return trimPromptIncompleteEnding(selected.join("; "));
}

function buildSceneDialogueBlock(backstory: Backstory, script: string): string {
  const beats = splitScriptIntoBeats(script, 2).slice(0, 2).map((beat) => compactPromptSectionText(beat, 110));
  const characterName = backstory.persona_name.toUpperCase();
  if (beats.length <= 1) {
    const singleBeat = beats[0] ?? compactPromptSectionText(script, 110);
    const deliveryTone = buildDialogueTone(backstory, singleBeat, script, 0, 1);
    return `${characterName} (${deliveryTone}) ${singleBeat}`;
  }

  const firstDeliveryTone = buildDialogueTone(backstory, beats[0]!, script, 0, beats.length);
  const secondDeliveryTone = buildDialogueTone(backstory, beats[1]!, script, 1, beats.length);
  return [
    `${characterName} (${firstDeliveryTone}) ${beats[0]}`,
    "A small visible reaction lands between the thoughts without breaking eye contact.",
    `${characterName} (CONT'D) (${secondDeliveryTone}) ${beats[1]}`
  ].join("\n");
}

function buildExactSceneDialogueBlock(backstory: Backstory, script: string): string {
  const characterName = backstory.persona_name.toUpperCase();
  const deliveryTone = trimPromptIncompleteEnding(
    `${FIXED_AD_DELIVERY_DESCRIPTOR}, exact wording only, no paraphrase, decisive finish`
  );
  return `${characterName} (${deliveryTone}) ${script}`;
}

function buildSceneFinishingBehavior(backstory: Backstory): string {
  const normalizedSetting = normalizeComparableText(backstory.setting);
  if (/\b(coastal|waterfront|resort|retreat|promenade)\b/.test(normalizedSetting)) {
    return "They let the last beat settle with direct eye contact, a faint smile, and a clean held finish in the same shot.";
  }
  return "They finish with steady eye contact, a small settled hold, and a clean ending in the same shot.";
}

function buildSceneBlockSoraPromptFallback(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  aspectRatio: SupportedAspectRatio
): string {
  const format = aspectRatio === "16:9" ? "16:9" : aspectRatio === "1:1" ? "1:1" : "9:16";
  const sceneHeader = `${SORA_PROMPT_WRITER_SCENE_START} ${inferSceneInteriorExterior(backstory.setting)} ${inferSceneLocationLabel(backstory)} - ${inferSceneTimeLabel(backstory)}`;
  const characterLine = `${backstory.persona_name.toUpperCase()} (${backstory.age_range}, ${inferSocialSignal(backstory)}, ${inferWardrobeCue(backstory)}) is ${buildSceneMidAction(backstory)}.`;
  const settingPhrase = compactPromptClausePhrase(backstory.setting, 110);
  const environmentLine = `${settingPhrase} The space feels premium and lived-in.`;
  const facialDetailLine = buildFacialDetailLine(backstory);
  const hairGroomingLine = buildHairGroomingDetailLine(backstory);
  const wardrobeAndFrameLine = buildWardrobeAndFrameDetailLine(backstory);
  const movementQualityLine = buildMovementQualityLine(backstory);
  const noticeCameraLine = buildSceneNoticeCamera(backstory);
  const bodyLanguageLine = buildSceneBodyLanguage(backstory, script);
  const cameraLine = `Single continuous ${format} direct-to-camera shot with stable framing or very slight naturalistic drift, no cuts.`;
  const framingLine =
    "Default framing is a tight medium close-up shot. Frame the character from mid-chest upward only with full face visibility, and do not show the beltline, lower torso, or a full-body frame unless the brief explicitly requires a wider composition.";
  const lightingLine =
    "Lighting stays white-balanced with no yellow cast and a premium iPhone-shot realism.";
  const opticalClarityLine =
    "Focus stays sharp on the face with crisp eyes and natural skin texture, with no dreamy softness, no beauty-filter smoothing, and only minimal natural background blur.";
  const scriptPurityLine =
    "Do not say any words before or after the exact script. Do not invent a second sentence, a sign-off, a thank-you line, or any alternate product, brand, or card name.";
  const dialogueBlock = buildExactSceneDialogueBlock(backstory, script);
  const exclusionsLine =
    "Do not include text, subtitles, captions, logos, readable signs, phones, laptops, tablets, monitors, or background music unless explicitly allowed.";
  const accentLine =
    "Spoken delivery is natural Indian English with a clear Indian accent suited to the persona and city context, not American, British, or neutralized global-ad delivery unless explicitly requested.";
  const finishingLine = buildSceneFinishingBehavior(backstory);

  const joinSceneBlock = (lines: string[]): string =>
    lines
      .filter(Boolean)
      .join("\n")
      .trim();

  const sceneCoreLines = [
    sceneHeader,
    characterLine,
    environmentLine,
    facialDetailLine,
    hairGroomingLine,
    wardrobeAndFrameLine,
    movementQualityLine,
    noticeCameraLine
  ];

  const requiredClosingLines = [dialogueBlock, accentLine, exclusionsLine, finishingLine, SORA_PROMPT_WRITER_SCENE_END];

  const sceneBlock = joinSceneBlock([
    ...sceneCoreLines,
    bodyLanguageLine,
    cameraLine,
    framingLine,
    lightingLine,
    opticalClarityLine,
    scriptPurityLine,
    ...requiredClosingLines
  ]);

  if (sceneBlock.length <= SORA_PROMPT_WRITER_MAX_CHARS) {
    return sceneBlock;
  }

  const prioritizedSceneBlock = joinSceneBlock([
    ...sceneCoreLines,
    buildSceneBodyLanguage(backstory, script),
    `Single continuous ${format} shot with stable framing or very slight naturalistic drift, no cuts.`,
    framingLine,
    "Lighting stays white-balanced with no yellow cast and a premium iPhone-shot realism.",
    opticalClarityLine,
    scriptPurityLine,
    ...requiredClosingLines
  ]);

  if (prioritizedSceneBlock.length <= SORA_PROMPT_WRITER_MAX_CHARS) {
    return prioritizedSceneBlock;
  }

  const emergencySceneBlock = [
    sceneHeader,
    `${backstory.persona_name.toUpperCase()} (${backstory.age_range}, ${inferSocialSignal(backstory)}, ${inferWardrobeCue(backstory)}) is ${compactPromptSectionText(buildSceneMidAction(backstory), 112)}.`,
    compactPromptSectionText(backstory.setting, 185),
    buildFacialDetailLine(backstory),
    buildHairGroomingDetailLine(backstory),
    buildWardrobeAndFrameDetailLine(backstory),
    buildMovementQualityLine(backstory),
    buildSceneNoticeCamera(backstory),
    buildSceneBodyLanguage(backstory, script),
    `Single continuous ${format} shot with stable framing or very slight naturalistic drift, no cuts.`,
    framingLine,
    "Lighting stays white-balanced with no yellow cast and a premium iPhone-shot realism.",
    opticalClarityLine,
    scriptPurityLine,
    buildExactSceneDialogueBlock(backstory, script),
    "Spoken delivery is natural Indian English with a clear Indian accent suited to the persona and city context.",
    "Do not include text, subtitles, captions, logos, readable signs, phones, laptops, tablets, monitors, or background music unless explicitly allowed.",
    buildSceneFinishingBehavior(backstory),
    SORA_PROMPT_WRITER_SCENE_END
  ]
    .filter(Boolean)
    .join("\n")
    .trim();

  if (emergencySceneBlock.length <= SORA_PROMPT_WRITER_MAX_CHARS) {
    return emergencySceneBlock;
  }

  const closingMarker = `\n${SORA_PROMPT_WRITER_SCENE_END}`;
  const maxBodyChars = Math.max(0, SORA_PROMPT_WRITER_MAX_CHARS - closingMarker.length);
  const withoutClosingMarker = emergencySceneBlock.endsWith(SORA_PROMPT_WRITER_SCENE_END)
    ? emergencySceneBlock.slice(0, -SORA_PROMPT_WRITER_SCENE_END.length).trimEnd()
    : emergencySceneBlock;
  const trimmedBody = withoutClosingMarker.slice(0, maxBodyChars).trim();
  return `${trimmedBody}${closingMarker}`;
}

function buildCompactSoraScriptLockedPrompt(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  aspectRatio: SupportedAspectRatio
): string {
  const format = aspectRatio === "16:9" ? "16:9" : aspectRatio === "1:1" ? "1:1" : "9:16";
  const sceneHeader = `${SORA_PROMPT_WRITER_SCENE_START} ${inferSceneInteriorExterior(backstory.setting)} ${inferSceneLocationLabel(backstory)} - ${inferSceneTimeLabel(backstory)}`;
  const characterLine = `${backstory.persona_name.toUpperCase()} (${backstory.age_range}, ${inferSocialSignal(backstory)}, ${inferWardrobeCue(backstory)}) is ${compactPromptSectionText(buildSceneMidAction(backstory), 110)}.`;
  const settingLine = `${compactPromptSectionText(backstory.setting, 140)} ${product === "kotak_air_plus" ? "The world reads as premium travel-day context." : "The world reads as practical everyday spend context."}`;
  const noticeCameraLine = buildSceneNoticeCamera(backstory);
  const bodyLanguageLine = buildSceneBodyLanguage(backstory, script);
  const cameraLine = `Single continuous ${format} direct-to-camera shot. Stable frame or slight natural drift only. No cuts.`;
  const framingLine =
    "Tight medium close-up only. Frame the character from mid-chest upward with full face visibility. Do not show the beltline, lower torso, or a full-body frame.";
  const lightingLine = "Lighting is clean, white-balanced, and naturally exposed with true-to-skin color.";
  const clarityLine =
    "Focus stays sharp on the face with crisp eyes and natural skin texture. No dreamy softness, no beauty-filter smoothing, and only minimal natural background blur.";
  const purityLine =
    "Only spoken words in the video are the exact script below. No extra opener, no paraphrase, no second sentence, no thank-you line, and no alternate brand or card name.";
  const dialogueLine = buildExactSceneDialogueBlock(backstory, script);
  const accentLine =
    "Spoken delivery is natural Indian English with a clear Indian accent suited to the persona and city context.";
  const exclusionsLine =
    "Do not include text, subtitles, captions, logos, readable signs, phones, laptops, tablets, monitors, or background music unless explicitly allowed.";
  const finishingLine = buildSceneFinishingBehavior(backstory);

  return [
    sceneHeader,
    characterLine,
    settingLine,
    noticeCameraLine,
    bodyLanguageLine,
    cameraLine,
    framingLine,
    lightingLine,
    clarityLine,
    purityLine,
    dialogueLine,
    accentLine,
    exclusionsLine,
    finishingLine,
    SORA_PROMPT_WRITER_SCENE_END
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}

const PROMPT_VISUAL_DETAIL_STOPWORDS = new Set([
  "with",
  "from",
  "that",
  "this",
  "they",
  "them",
  "their",
  "there",
  "here",
  "have",
  "has",
  "had",
  "into",
  "through",
  "where",
  "while",
  "wears",
  "wearing",
  "feels",
  "feeling",
  "looks",
  "looking",
  "premium",
  "polished",
  "natural",
  "clean",
  "realistic",
  "believable",
  "specific",
  "visual",
  "visually",
  "detail",
  "details",
  "character",
  "person",
  "persona",
  "social",
  "energy",
  "style",
  "styling",
  "wardrobe",
  "grooming",
  "facial",
  "body",
  "frame",
  "movement",
  "quality"
]);

function extractPromptAnchorTerms(value: string, maxTerms = 8): string[] {
  const normalized = normalizeComparableText(value);
  if (!normalized) {
    return [];
  }

  const terms = Array.from(
    new Set(
      normalized
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 4)
        .filter((term) => !PROMPT_VISUAL_DETAIL_STOPWORDS.has(term))
    )
  ).sort((a, b) => b.length - a.length);

  return terms.slice(0, maxTerms);
}

function promptContainsAnchor(prompt: string, source: string, maxTerms = 8): boolean {
  const promptComparable = normalizeComparableText(prompt);
  const anchors = extractPromptAnchorTerms(source, maxTerms);
  return anchors.some((anchor) => promptComparable.includes(anchor));
}

const PROMPT_DANGLING_FRAGMENT_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "with",
  "without",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "from",
  "through",
  "into",
  "by",
  "as",
  "over",
  "under",
  "is",
  "are",
  "was",
  "were",
  "be",
  "being",
  "been",
  "his",
  "her",
  "their",
  "layered",
  "paired",
  "tucked",
  "draped",
  "worn",
  "hand",
  "hands",
  "arm",
  "arms",
  "elbow",
  "elbows",
  "he",
  "she",
  "they"
]);

const PROMPT_TRUNCATED_TAIL_PATTERN =
  /(?:,\s*|\s+)(offering|creating|projecting|reflecting|balancing|capturing|giving|conveying|showing|revealing|signaling|maintaining|keeping|complemented|paired|featuring|framed)\b(?:\s+(?:a|an|the|his|her|their|warm|quiet|calm|refined|premium|natural|subtle|genuine|polished|clean|lived-in|grounded|climate-aware|travel-ready|engaging|approachable|steady|direct|thoughtful|observant)){0,5}\.$/i;

function hasTruncatedSceneBlockLine(prompt: string): boolean {
  return prompt
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .some((line) => {
      if (
        line.startsWith(SORA_PROMPT_WRITER_SCENE_START) ||
        line === SORA_PROMPT_WRITER_SCENE_END ||
        /^[A-Z][A-Z0-9 '.-]+(?: \(CONT'D\))? \([^)]+\) /.test(line) ||
        /^A small visible reaction lands between the thoughts/.test(line) ||
        /^Spoken delivery is natural Indian English/.test(line) ||
        /^Do not include text, subtitles, captions, logos/.test(line)
      ) {
        return false;
      }
      return (
        PROMPT_TRUNCATED_TAIL_PATTERN.test(line) ||
        /^Movement quality:\s+with\b/i.test(line) ||
        /^(Hair and grooming|Wardrobe and build|Movement quality):.*\b(?:one hand|both hands|occasionally|holding)\.$/i.test(
          line
        ) ||
        /^(Hair and grooming|Wardrobe and build|Movement quality):.*\b(?:a|an|the)\s+(?:chic|classic|refined|premium|soft|warm|quiet|natural|clean|grounded|poised|steady|direct|thoughtful|observant|engaging|approachable|lived-in|travel-ready|climate-aware|commanding)\.$/i.test(
          line
        ) ||
        /^(Hair and grooming|Wardrobe and build|Movement quality):.*\b(?:few|slight|slightly)\s+(?:natural|subtle|soft|warm|quiet|clean|refined)\.$/i.test(
          line
        ) ||
        /\bthan staged ad\.$/i.test(line) ||
        /\bthan staged\.$/i.test(line)
      );
    });
}

function getGeneratedSoraPromptRejectionReason(prompt: string, backstory?: Backstory): string | null {
  const normalized = prompt.replace(/\r/g, "").trim();
  if (normalized.length < 220) {
    return "too_short_under_220_chars";
  }
  if (normalized.length > SORA_PROMPT_WRITER_MAX_CHARS) {
    return "too_long_over_2500_chars";
  }
  if (!normalized.startsWith(SORA_PROMPT_WRITER_SCENE_START)) {
    return "missing_scene_start";
  }
  if (!normalized.includes(SORA_PROMPT_WRITER_SCENE_END)) {
    return "missing_scene_end";
  }
  if (/^\s*[-*•]/m.test(prompt)) {
    return "contains_bullets";
  }
  if (LEGACY_SORA_PROMPT_WRITER_SECTION_HEADERS.some((header) => normalized.includes(header))) {
    return "contains_legacy_section_labels";
  }
  if (!/(?:^|\n)\[SCENE START\]\s+(INT\.|EXT\.)\s+[A-Z]/.test(normalized)) {
    return "missing_scene_heading";
  }
  if (!/\bdirect(?:-|\s)to(?:-|\s)camera\b/i.test(normalized.replace(/\n/g, " "))) {
    return "missing_direct_to_camera_language";
  }
  if (!/(?:^|\n)[A-Z][A-Z0-9 '.-]+(?: \(CONT'D\))? \([^)]+\) .+/m.test(normalized)) {
    return "missing_dialogue_block";
  }
  if (!/\bnatural Indian English\b/i.test(normalized.replace(/\n/g, " "))) {
    return "missing_accent_rule";
  }
  if (!/\b(?:no|do not include)\b[^.\n]*(text|subtitles|captions|logos|signage|signs|phones?|laptops?|tablets?|monitors?|screens?|background music|music)\b/i.test(normalized.replace(/\n/g, " "))) {
    return "missing_exclusions";
  }
  if (!/\b(clean ending|clean held finish|cleanly|same shot|no cuts?)\b/i.test(normalized.replace(/\n/g, " "))) {
    return "missing_clean_ending_language";
  }
  if (/\b(Hook rule:|Core performance rule:|Expression rule:|Staging rule:|Performance naturalism and expressive motion:|Character:|Opening Hook:|Performance:|Scene:|Dialogue:|Style and Tone:|Negative Constraints:|Safety Constraints:)\b/i.test(normalized)) {
    return "contains_internal_policy_text";
  }
  if (hasTruncatedSceneBlockLine(normalized)) {
    return "contains_truncated_scene_line";
  }
  if (backstory) {
    if (!promptContainsAnchor(normalized, backstory.facial_features)) {
      return "missing_facial_visual_detail";
    }
    if (!promptContainsAnchor(normalized, backstory.hairstyle_grooming)) {
      return "missing_hair_grooming_detail";
    }
    if (!promptContainsAnchor(normalized, `${backstory.wardrobe_details} ${backstory.body_build}`)) {
      return "missing_wardrobe_body_frame_detail";
    }
    if (!promptContainsAnchor(normalized, `${backstory.posture_body_language} ${BACKSTORY_SPEAKING_ENERGY_FALLBACK}`)) {
      return "missing_movement_quality_detail";
    }
  }

  return null;
}

interface PromptWriterAttemptDebug {
  model: string;
  rawSample: string;
  normalizedSample: string;
  rejectionReason?: string;
  error?: string;
}

function compactPromptSectionText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  const sliced = normalized.slice(0, maxChars);
  const sentenceCut = Math.max(sliced.lastIndexOf(". "), sliced.lastIndexOf("; "), sliced.lastIndexOf(": "));
  let trimmed = "";

  if (sentenceCut > Math.max(36, Math.floor(maxChars * 0.72))) {
    trimmed = sliced.slice(0, sentenceCut + 1).trim();
  } else {
    const safeCut = sliced.lastIndexOf(" ");
    trimmed = (safeCut > Math.max(36, Math.floor(maxChars * 0.75)) ? sliced.slice(0, safeCut) : sliced).trim();
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  while (words.length > 4 && PROMPT_DANGLING_FRAGMENT_WORDS.has(words[words.length - 1]!.toLowerCase())) {
    words.pop();
  }

  trimmed = words.join(" ").trim();
  return `${trimmed.replace(/[,:;.\-–—\s]+$/g, "")}.`;
}

function enforceSceneCharacterIntroLine(prompt: string, backstory: Backstory): string {
  const lines = prompt.split("\n");
  const introIndex = lines.findIndex((line, index) => index > 0 && /^[A-Z][A-Z0-9 '.-]+ \([^)]+\) is .+/.test(line));
  if (introIndex < 0) {
    return prompt;
  }

  const match = lines[introIndex]!.match(/^[A-Z][A-Z0-9 '.-]+ \([^)]+\) is (.+)$/);
  if (!match) {
    return prompt;
  }

  lines[introIndex] = `${backstory.persona_name.toUpperCase()} (${backstory.age_range}, ${inferSocialSignal(backstory)}, ${inferWardrobeCue(backstory)}) is ${match[1]}`;
  return lines.join("\n");
}

function enforceSceneLightingLine(prompt: string): string {
  if (/\bwhite-balanced\b|\bwhite balanced\b|\bno yellow cast\b|\biPhone-shot\b/i.test(prompt)) {
    return prompt;
  }

  const lines = prompt.split("\n");
  const lightingLine = "Lighting stays white-balanced with no yellow cast and a premium iPhone-shot realism.";
  const cameraIndex = lines.findIndex((line) => /^Single continuous .*stable framing/i.test(line.trim()));
  if (cameraIndex >= 0) {
    lines.splice(cameraIndex + 1, 0, lightingLine);
    return lines.join("\n");
  }

  const dialogueIndex = lines.findIndex((line) => /^[A-Z][A-Z0-9 '.-]+(?: \(CONT'D\))? \([^)]+\) .+/.test(line.trim()));
  if (dialogueIndex >= 0) {
    lines.splice(dialogueIndex, 0, lightingLine);
    return lines.join("\n");
  }

  return `${prompt.trim()}\n${lightingLine}`;
}

function enforceSceneOpticalClarityLine(prompt: string): string {
  if (/\bcrisp eyes\b|\bsharp facial focus\b|\bsharp on the face\b|\bbeauty-filter\b|\bminimal natural background blur\b/i.test(prompt)) {
    return prompt;
  }

  const lines = prompt.split("\n");
  const clarityLine =
    "Focus stays sharp on the face with crisp eyes and natural skin texture, with no dreamy softness, no beauty-filter smoothing, and only minimal natural background blur.";
  const lightingIndex = lines.findIndex((line) => /white-balanced|white balanced|iPhone-shot|no yellow cast/i.test(line.trim()));
  if (lightingIndex >= 0) {
    lines.splice(lightingIndex + 1, 0, clarityLine);
    return lines.join("\n");
  }

  const cameraIndex = lines.findIndex((line) => /^Single continuous .*stable framing/i.test(line.trim()));
  if (cameraIndex >= 0) {
    lines.splice(cameraIndex + 1, 0, clarityLine);
    return lines.join("\n");
  }

  return `${prompt.trim()}\n${clarityLine}`;
}

function enforceSceneExactDialogueBlock(prompt: string, backstory: Backstory, script: string): string {
  const lines = prompt.split("\n");
  const filteredLines = lines.filter((line) => {
    const trimmed = line.trim();
    if (/^[A-Z][A-Z0-9 '.-]+(?: \(CONT'D\))? \([^)]+\) .+/.test(trimmed)) {
      return false;
    }
    if (/^A small visible reaction lands between the thoughts/i.test(trimmed)) {
      return false;
    }
    if (/^Do not say any words before or after the exact script\./i.test(trimmed)) {
      return false;
    }
    if (/^Only spoken words in the video, exactly as written with no additions before or after:?$/i.test(trimmed)) {
      return false;
    }
    return true;
  });

  const insertBeforeIndex = filteredLines.findIndex((line) => {
    const trimmed = line.trim();
    return (
      /^Spoken delivery is natural Indian English/i.test(trimmed) ||
      /^Do not include text, subtitles, captions, logos/i.test(trimmed) ||
      trimmed === SORA_PROMPT_WRITER_SCENE_END
    );
  });

  const dialogueLines = [
    "Only spoken words in the video, exactly as written with no additions before or after:",
    "Do not say any words before or after the exact script. Do not invent a second sentence, a sign-off, a thank-you line, or any alternate product, brand, or card name.",
    buildExactSceneDialogueBlock(backstory, script)
  ];

  if (insertBeforeIndex >= 0) {
    filteredLines.splice(insertBeforeIndex, 0, ...dialogueLines);
    return filteredLines.join("\n");
  }

  return `${filteredLines.join("\n")}\n${dialogueLines.join("\n")}`;
}

function alignPromptGenderPresentation(prompt: string, backstory: Backstory): string {
  const gender = normalizeGenderPresentation(backstory.gender_presentation) ?? inferGenderPresentationFromName(backstory.persona_name);
  if (!gender) {
    return prompt;
  }
  if (gender === "woman") {
    return prompt
      .replace(/\bHe\b/g, "She")
      .replace(/\bhe\b/g, "she")
      .replace(/\bHis\b/g, "Her")
      .replace(/\bhis\b/g, "her")
      .replace(/\bHim\b/g, "Her")
      .replace(/\bhim\b/g, "her")
      .replace(/\bHimself\b/g, "Herself")
      .replace(/\bhimself\b/g, "herself");
  }
  if (gender === "man") {
    return prompt
      .replace(/\bShe\b/g, "He")
      .replace(/\bshe\b/g, "he")
      .replace(/\bHer\b/g, "His")
      .replace(/\bher\b/g, "his")
      .replace(/\bHers\b/g, "His")
      .replace(/\bhers\b/g, "his")
      .replace(/\bHerself\b/g, "Himself")
      .replace(/\bherself\b/g, "himself");
  }
  return prompt;
}


function enforceGeneratedSoraPromptConstraints(
  prompt: string,
  backstory: Backstory,
  product: ProductKey,
  script: string,
  aspectRatio: SupportedAspectRatio,
  durationSeconds: number,
  guidelines?: string,
  brief?: string
): string {
  const normalized = prompt.replace(/\r/g, "").trim();
  const needsFallback =
    !normalized ||
    /\b(Hook rule:|Core performance rule:|Expression rule:|Staging rule:|Performance naturalism and expressive motion:|Character:|Opening Hook:|Performance:|Scene:|Dialogue:|Style and Tone:|Negative Constraints:|Safety Constraints:)\b/i.test(
      normalized
    );

  let candidate = needsFallback ? buildSceneBlockSoraPromptFallback(backstory, product, script, aspectRatio) : normalized;

  candidate = alignPromptGenderPresentation(candidate, backstory);
  candidate = enforceSceneCharacterIntroLine(candidate, backstory);
  candidate = enforceSceneLightingLine(candidate);
  candidate = enforceSceneOpticalClarityLine(candidate);
  candidate = enforceSceneExactDialogueBlock(candidate, backstory, script);
  candidate = alignPromptGenderPresentation(candidate, backstory);

  const rejectionReason = getGeneratedSoraPromptRejectionReason(candidate, backstory);
  if (rejectionReason) {
    candidate = buildSceneBlockSoraPromptFallback(backstory, product, script, aspectRatio);
    candidate = alignPromptGenderPresentation(candidate, backstory);
    candidate = enforceSceneLightingLine(candidate);
    candidate = enforceSceneOpticalClarityLine(candidate);
  }

  if (candidate.length > SORA_PROMPT_WRITER_MAX_CHARS) {
    return buildSceneBlockSoraPromptFallback(backstory, product, script, aspectRatio);
  }

  return candidate;
}

function getSoraPromptWriterThinkingBudget(): number {
  if (SORA_PROMPT_WRITER_REASONING_EFFORT === "low") {
    return Math.min(SORA_PROMPT_WRITER_THINKING_BUDGET, 512);
  }
  if (SORA_PROMPT_WRITER_REASONING_EFFORT === "medium") {
    return Math.min(SORA_PROMPT_WRITER_THINKING_BUDGET, 1536);
  }
  return SORA_PROMPT_WRITER_THINKING_BUDGET;
}

async function generateSoraPromptWithGemini(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  aspectRatio: SupportedAspectRatio,
  videoType: VideoType,
  durationSeconds: number,
  guidelines?: string,
  brief?: string,
  debugAttempts?: PromptWriterAttemptDebug[],
  promptVersion: PromptWriterVersion = DEFAULT_PROMPT_WRITER_VERSION
): Promise<string> {
  const ai = getClient();
  const models = Array.from(new Set([SORA_PROMPT_WRITER_MODEL, SORA_PROMPT_WRITER_FALLBACK_MODEL].filter(Boolean)));
  const input = getSoraPromptWriterInput(backstory, product, script, aspectRatio, videoType, durationSeconds, guidelines, brief);
  let lastError: unknown;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index]!;
    try {
      const response = await withGenAiRetry(`soraPromptWriter.generate:${model}`, () =>
        ai.models.generateContent({
          model,
          contents: `${getPromptWriterSystemPrompt(promptVersion)}\n\nINPUTS\n${input}`,
          config: {
            temperature: 0.4,
            maxOutputTokens: SORA_PROMPT_WRITER_MAX_OUTPUT_TOKENS,
            thinkingConfig: {
              thinkingBudget: getSoraPromptWriterThinkingBudget()
            }
          }
        })
      );

      const raw = extractPromptWriterText(response);
      const normalized = normalizeSoraPromptWriterOutput(raw);
      const enforced = enforceGeneratedSoraPromptConstraints(
        normalized,
        backstory,
        product,
        script,
        aspectRatio,
        durationSeconds,
        guidelines,
        brief
      );
      const rejectionReason = getGeneratedSoraPromptRejectionReason(enforced, backstory);
      if (rejectionReason) {
        debugAttempts?.push({
          model,
          rawSample: raw.slice(0, 1200),
          normalizedSample: enforced.slice(0, 1200),
          rejectionReason
        });
        throw new Error(`Sora prompt writer returned an unusable prompt (${rejectionReason}).`);
      }

      debugAttempts?.push({
        model,
        rawSample: raw.slice(0, 1200),
        normalizedSample: enforced.slice(0, 1200)
      });

      return enforced;
    } catch (error) {
      if (debugAttempts && !debugAttempts.some((attempt) => attempt.model === model && (attempt.rejectionReason || attempt.error))) {
        debugAttempts.push({
          model,
          rawSample: "",
          normalizedSample: "",
          error: errorMessage(error)
        });
      }
      lastError = error;
      const hasFallback = index < models.length - 1;
      if (!hasFallback) {
        throw error;
      }
      console.warn(
        `[pipeline] sora prompt writer failed on ${model}; falling back to ${models[index + 1]} due to: ${errorMessage(error)}`
      );
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Sora prompt writer failed for all configured models.");
}

interface SoraMotionPromptBuildResult {
  prompt: string;
  source: "gemini_prompt_writer" | "deterministic_fallback" | "provider_specific_builder";
  fallbackReason?: string;
  promptWriterAttempts?: PromptWriterAttemptDebug[];
}

interface VeoImagePromptBuildResult {
  prompt: string;
  source: "provider_specific_builder";
  sceneDirection: Pick<SceneDirection, "location_type" | "chosen_setting" | "activity" | "framing">;
}

export async function buildSoraMotionPromptDebug(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  aspectRatio: SupportedAspectRatio,
  videoType: VideoType,
  durationSeconds: number,
  guidelines?: string,
  brief?: string,
  useReferenceImage = false,
  promptVersion: PromptWriterVersion = DEFAULT_PROMPT_WRITER_VERSION
): Promise<SoraMotionPromptBuildResult> {
  void videoType;
  void useReferenceImage;
  void durationSeconds;
  void guidelines;
  void brief;
  const deterministicPrompt = buildCompactSoraScriptLockedPrompt(backstory, product, script, aspectRatio);

  if (!ENABLE_SORA_PROMPT_WRITER) {
    return {
      prompt: deterministicPrompt,
      source: "deterministic_fallback",
      fallbackReason: "Prompt writer disabled by configuration.",
      promptWriterAttempts: []
    };
  }

  const promptWriterAttempts: PromptWriterAttemptDebug[] = [];
  try {
    await generateSoraPromptWithGemini(
      backstory,
      product,
      script,
      aspectRatio,
      videoType,
      durationSeconds,
      guidelines,
      brief,
      promptWriterAttempts,
      promptVersion
    );
    return {
      prompt: buildCompactSoraScriptLockedPrompt(backstory, product, script, aspectRatio),
      source: "gemini_prompt_writer",
      promptWriterAttempts
    };
  } catch (error) {
    const reason = errorMessage(error);
    console.warn("[pipeline] sora prompt writer fallback to deterministic prompt", reason);
    return {
      prompt: deterministicPrompt,
      source: "deterministic_fallback",
      fallbackReason: reason,
      promptWriterAttempts
    };
  }
}

export async function buildSoraMotionPrompt(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  aspectRatio: SupportedAspectRatio,
  videoType: VideoType,
  durationSeconds: number,
  guidelines?: string,
  brief?: string,
  useReferenceImage = false,
  promptVersion: PromptWriterVersion = DEFAULT_PROMPT_WRITER_VERSION
): Promise<string> {
  const result = await buildSoraMotionPromptDebug(
    backstory,
    product,
    script,
    aspectRatio,
    videoType,
    durationSeconds,
    guidelines,
    brief,
    useReferenceImage,
    promptVersion
  );
  return result.prompt;
}

export async function buildVeoMotionPromptDebug(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  aspectRatio: SupportedAspectRatio,
  videoType: VideoType,
  durationSeconds: number,
  guidelines?: string,
  brief?: string,
  useReferenceImage = false,
  promptVersion: PromptWriterVersion = DEFAULT_PROMPT_WRITER_VERSION
): Promise<SoraMotionPromptBuildResult> {
  void promptVersion;
  const deterministicPrompt = getVeoPrompt(
    backstory,
    product,
    script,
    aspectRatio,
    videoType,
    durationSeconds,
    guidelines,
    brief,
    useReferenceImage
  );
  return {
    prompt: deterministicPrompt,
    source: "provider_specific_builder",
    promptWriterAttempts: []
  };
}

export async function buildVeoMotionPrompt(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  aspectRatio: SupportedAspectRatio,
  videoType: VideoType,
  durationSeconds: number,
  guidelines?: string,
  brief?: string,
  useReferenceImage = false,
  promptVersion: PromptWriterVersion = DEFAULT_PROMPT_WRITER_VERSION
): Promise<string> {
  const result = await buildVeoMotionPromptDebug(
    backstory,
    product,
    script,
    aspectRatio,
    videoType,
    durationSeconds,
    guidelines,
    brief,
    useReferenceImage,
    promptVersion
  );
  return result.prompt;
}

function buildVeoImagePromptFromSceneDirection(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  sceneDirection: SceneDirection,
  aspectRatio: SupportedAspectRatio,
  videoType: VideoType,
  guidelines?: string,
  brief?: string
): string {
  return getImagenPrompt(backstory, product, script, sceneDirection, aspectRatio, videoType, guidelines, brief);
}

export async function buildVeoImagePromptDebug(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  aspectRatio: SupportedAspectRatio,
  videoType: VideoType,
  guidelines?: string,
  brief?: string
): Promise<VeoImagePromptBuildResult> {
  const sceneDirection = await generateSceneDirection(backstory, product, script, guidelines, brief, []);
  return {
    prompt: buildVeoImagePromptFromSceneDirection(backstory, product, script, sceneDirection, aspectRatio, videoType, guidelines, brief),
    source: "provider_specific_builder",
    sceneDirection: {
      location_type: sceneDirection.location_type,
      chosen_setting: sceneDirection.chosen_setting,
      activity: sceneDirection.activity,
      framing: sceneDirection.framing
    }
  };
}

async function extendVideoToTargetDuration(
  videoBytes: Buffer<ArrayBufferLike>,
  targetSeconds: number,
  jobDir: string,
  prefix: string
): Promise<Buffer<ArrayBufferLike>> {
  const sourcePath = path.join(jobDir, `${prefix}.mp4`);
  const outputPath = path.join(jobDir, `${prefix}-extended.mp4`);
  await fs.writeFile(sourcePath, videoBytes);

  try {
    const currentDuration = await getVideoDurationSeconds(sourcePath, jobDir);
    if (Math.abs(targetSeconds - currentDuration) <= 0.03) {
      return videoBytes;
    }

    if (targetSeconds > currentDuration + 0.03) {
      const extendSeconds = targetSeconds - currentDuration;
      await runCommand(
        FFMPEG_BIN,
        [
          "-y",
          "-i",
          sourcePath,
          "-filter_complex",
          `[0:v]tpad=stop_mode=clone:stop_duration=${extendSeconds.toFixed(3)}[v]`,
          "-map",
          "[v]",
          "-map",
          "0:a?",
          "-c:v",
          "libx264",
          "-preset",
          "medium",
          "-crf",
          "18",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          outputPath
        ],
        jobDir
      );
    } else {
      const durationTag = Math.max(0.1, targetSeconds).toFixed(3);
      await runCommand(
        FFMPEG_BIN,
        [
          "-y",
          "-i",
          sourcePath,
          "-map",
          "0:v:0",
          "-map",
          "0:a?",
          "-c:v",
          "libx264",
          "-preset",
          "medium",
          "-crf",
          "18",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-t",
          durationTag,
          outputPath
        ],
        jobDir
      );
    }
    return fs.readFile(outputPath);
  } finally {
    await fs.unlink(sourcePath).catch(() => undefined);
    await fs.unlink(outputPath).catch(() => undefined);
  }
}

function resolveEndSlatePath(
  product: ProductKey,
  targetResolution?: { width: number; height: number }
): string | undefined {
  if (product === "kotak_air_plus" && targetResolution) {
    if (targetResolution.width === targetResolution.height) {
      const squareCandidate = END_SLATE_AIR_PLUS_SQUARE_PATH?.trim();
      if (squareCandidate) {
        return squareCandidate;
      }
    }

    if (targetResolution.width > targetResolution.height) {
      const landscapeCandidate = END_SLATE_AIR_PLUS_LANDSCAPE_PATH?.trim();
      if (landscapeCandidate) {
        return landscapeCandidate;
      }
    }
  }

  const productSpecific = product === "kotak_air_plus" ? END_SLATE_AIR_PLUS_PATH : END_SLATE_CASHBACK_PATH;
  const candidate = productSpecific || END_SLATE_VIDEO_PATH || DEFAULT_END_SLATE_PATH;
  return candidate?.trim() || undefined;
}

function resolveBackgroundScorePath(product: ProductKey): string | undefined {
  const productSpecific = product === "kotak_air_plus" ? BACKGROUND_SCORE_AIR_PLUS_PATH : BACKGROUND_SCORE_CASHBACK_PATH;
  const candidate = productSpecific || BACKGROUND_SCORE_PATH || DEFAULT_BACKGROUND_SCORE_PATH;
  return candidate?.trim() || undefined;
}

interface BackgroundScoreDirection {
  category: string;
  scriptType: string;
  rhythm: string;
  instrumentation: string;
  energyArc: string;
}

const MAX_LYRIA_BPM = 132;
const MIN_UPBEAT_BPM_AIR_PLUS = 118;
const MIN_UPBEAT_BPM_CASHBACK = 114;
const KLING_PROMPT_MAX_CHARS = 2400;

function deriveBackgroundScoreDirection(product: ProductKey, script: string): BackgroundScoreDirection {
  const value = script.toLowerCase();

  if (/\b(travel|trip|flight|airport|boarding|journey|lounge)\b/.test(value)) {
    return {
      category: "travel credit-card",
      scriptType: "departure/travel urgency",
      rhythm: "upbeat forward pulse around 116-130 BPM",
      instrumentation: "tight electronic percussion, light bass groove, subtle synth plucks",
      energyArc: "immediate start, rising urgency, clean decisive close"
    };
  }

  if (/\b(fuel|petrol|diesel|refuel|gas station|pump)\b/.test(value)) {
    return {
      category: "fuel spend benefit",
      scriptType: "on-the-go utility decision",
      rhythm: "upbeat driving pulse around 112-124 BPM",
      instrumentation: "percussive rhythm bed, muted bass, minimal tonal motif",
      energyArc: "confident build with practical, focused momentum"
    };
  }

  if (/\b(entertainment|movie|cinema|dining|restaurant|food|weekend|ott)\b/.test(value)) {
    return {
      category: "entertainment spend rewards",
      scriptType: "lifestyle reward reveal",
      rhythm: "upbeat controlled groove around 112-124 BPM",
      instrumentation: "clean drums, warm bass, light melodic accents",
      energyArc: "friendly hook, stable groove, clear branded finish"
    };
  }

  if (/\b(shopping|retail|mall|store|purchase|grocery|supermarket|checkout|essentials)\b/.test(value)) {
    return {
      category: "daily spend cashback",
      scriptType: "everyday value proposition",
      rhythm: "upbeat practical pulse around 110-122 BPM",
      instrumentation: "simple percussion, soft bass, short tonal stabs",
      energyArc: "clean and practical, with subtle urgency lift"
    };
  }

  if (product === "kotak_air_plus") {
    return {
      category: "travel credit-card",
      scriptType: "BOFU conversion push",
      rhythm: "urgent upbeat pulse around 118-132 BPM",
      instrumentation: "modern percussive groove, controlled bass, minimal synth motif",
      energyArc: "fast hook, constant momentum, sharp end"
    };
  }

  return {
    category: "cashback credit-card",
    scriptType: "BOFU conversion push",
    rhythm: "focused upbeat pulse around 112-124 BPM",
    instrumentation: "light percussion, subtle bass, restrained melodic texture",
    energyArc: "quick start, supportive bed, clean close"
  };
}

function getBackgroundScorePrompt(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  durationSeconds: number,
  guidelines?: string,
  brief?: string
): string {
  const spec = PRODUCT_SPECS[product];
  const direction = deriveBackgroundScoreDirection(product, script);
  const visualContext = deriveScriptVisualContext(script, product);
  const compactBrief = compactPromptContext(brief, 220);
  const compactGuidelines = compactPromptContext(guidelines, 220);
  const voiceContext = spec.voice?.join("; ") || spec.psychographics?.join("; ") || "";
  const productMusicProfile =
    product === "kotak_air_plus"
      ? "Product music profile: premium travel-forward ad bed, polished and airy, restrained modern pulse, mobility energy, no lounge-jazz or vacation-chill cues."
      : "Product music profile: practical everyday-savings ad bed, clean and smart, tighter rhythm, app-native metro energy, no luxury-orchestral or cinematic-trailer cues.";

  return [
    "Compose a background score only.",
    "No vocals, no spoken words, no chants, no lyrics.",
    "No recognizable copyrighted melody or artist imitation.",
    `Target length: about ${Math.max(4, Math.round(durationSeconds))} seconds.`,
    "Write one continuous music bed for the complete delivered ad cut, including the closing slate segment.",
    "Do not stop, drop out, or resolve before the closing slate begins.",
    "Carry the groove cleanly under dialogue, then simplify and resolve naturally across the final slate hold.",
    "Tone: BOFU urgency, confident, modern, performance-marketing energy with low-mix bed under dialogue.",
    "Tempo must feel upbeat and conversion-focused from the first beat, with no relaxed or ambient drift.",
    "Keep it clean under dialogue: light rhythmic pulse, supportive not dominant.",
    "Start quickly without a long intro and end cleanly for ad edit use.",
    `Category: ${direction.category}.`,
    `Script type: ${direction.scriptType}.`,
    `Rhythm direction: ${direction.rhythm}.`,
    `Instrumentation direction: ${direction.instrumentation}.`,
    `Energy arc: ${direction.energyArc}.`,
    `Visual context reference: ${visualContext.primary}.`,
    `Setting context: ${backstory.setting}.`,
    `Product context: ${spec.positioning || product}.`,
    spec.corePromise ? `Core promise: ${spec.corePromise}.` : "",
    spec.socialTone ? `Brand social tone: ${spec.socialTone}.` : "",
    spec.imageTreatment ? `Image treatment context: ${spec.imageTreatment}.` : "",
    productMusicProfile,
    voiceContext ? `Brand voice context: ${voiceContext}.` : "",
    `Persona speaking tone: ${FIXED_AD_DELIVERY_DESCRIPTOR}.`,
    compactBrief ? `Campaign brief context: ${compactBrief}.` : "",
    compactGuidelines ? `Brand guidelines context: ${compactGuidelines}.` : "",
    `Script intent: ${script}`
  ].join(" ");
}

function getBackgroundScoreNegativePrompt(product: ProductKey): string {
  const productSpecific =
    product === "kotak_air_plus"
      ? "sleepy ambient drift, lounge jazz, vacation chillout, cinematic trailer booms"
      : "luxury orchestral swells, cinematic trailer booms, club-drop EDM, comedy cues";

  return [
    "vocals",
    "spoken words",
    "lyrics",
    "chants",
    "jingle hook",
    "announcer tag",
    "copyrighted melody",
    "artist imitation",
    "abrupt stop",
    "music ending before the slate",
    "harsh riser",
    "heavy intro",
    "dominant topline melody",
    productSpecific
  ].join(", ");
}

function getLyriaWeightedPrompts(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  durationSeconds: number,
  guidelines?: string,
  brief?: string
): Array<{ text: string; weight: number }> {
  const basePrompt = getBackgroundScorePrompt(backstory, product, script, durationSeconds, guidelines, brief);
  const direction = deriveBackgroundScoreDirection(product, script);
  const visualContext = deriveScriptVisualContext(script, product);
  const primaryPrompt = [
    basePrompt,
    "Generate instrumental music only with no vocals.",
    "Prioritize upbeat pace and punchy rhythmic momentum suitable for BOFU performance ads.",
    "Keep a clean bed under dialogue and avoid long intros.",
    `Visual context ${visualContext.primary}.`,
    `Rhythm ${direction.rhythm}.`,
    `Energy arc ${direction.energyArc}.`
  ].join(" ");

  const productPrompt =
    product === "kotak_air_plus"
      ? "Premium mobility and travel momentum. Polished, confident, forward-driving pulse that stays intact through the closing slate and resolves cleanly at the very end."
      : "Everyday practical cashback energy. Clean, reliable, utility-first pulse that stays intact through the closing slate and resolves cleanly at the very end.";

  return [
    { text: primaryPrompt, weight: 0.8 },
    { text: productPrompt, weight: 0.2 }
  ];
}

function getLyriaGenerationConfig(product: ProductKey, script: string): Record<string, number> {
  const direction = deriveBackgroundScoreDirection(product, script);
  const rangeMatch = direction.rhythm.match(/(\d{2,3})\s*-\s*(\d{2,3})\s*bpm/i);
  const singleMatch = direction.rhythm.match(/(\d{2,3})\s*bpm/i);

  const bpm = rangeMatch
    ? Math.round((Number(rangeMatch[1]) + Number(rangeMatch[2])) / 2)
    : singleMatch
      ? Number(singleMatch[1])
      : product === "kotak_air_plus"
        ? 112
        : 106;

  const minUpbeatBpm = product === "kotak_air_plus" ? MIN_UPBEAT_BPM_AIR_PLUS : MIN_UPBEAT_BPM_CASHBACK;
  const tunedBpm = Math.max(minUpbeatBpm, Math.min(MAX_LYRIA_BPM, bpm));

  return {
    bpm: tunedBpm,
    guidance: product === "kotak_air_plus" ? 5.0 : 4.7,
    temperature: 1.1
  };
}

function getExtensionForAudioMimeType(mimeType: string): string {
  const value = mimeType.toLowerCase().split(";")[0].trim();
  if (value === "audio/wav" || value === "audio/x-wav") {
    return ".wav";
  }
  if (value === "audio/mpeg" || value === "audio/mp3") {
    return ".mp3";
  }
  if (value === "audio/aac") {
    return ".aac";
  }
  if (value === "audio/ogg") {
    return ".ogg";
  }
  if (value === "audio/flac") {
    return ".flac";
  }
  if (value === "audio/aiff") {
    return ".aiff";
  }
  if (value === "audio/mp4" || value === "audio/m4a") {
    return ".m4a";
  }
  return ".mp3";
}

async function generateBackgroundScoreWithLyria(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  durationSeconds: number,
  jobDir: string,
  guidelines?: string,
  brief?: string
): Promise<{ path: string; chunkCount: number; mimeType?: string }> {
  const ai = getClient();
  const buffers: Buffer[] = [];
  let audioMimeType: string | undefined;
  let setupResolved = false;
  let setupResolver: (() => void) | undefined;
  let setupRejecter: ((reason?: unknown) => void) | undefined;
  let finishResolver: (() => void) | undefined;
  let finishRejecter: ((reason?: unknown) => void) | undefined;
  let finished = false;
  let quietTimer: NodeJS.Timeout | undefined;
  let captureTimer: NodeJS.Timeout | undefined;
  let filteredReason: string | undefined;

  const settleFinish = (): void => {
    if (finished) {
      return;
    }
    finished = true;
    if (quietTimer) {
      clearTimeout(quietTimer);
      quietTimer = undefined;
    }
    if (captureTimer) {
      clearTimeout(captureTimer);
      captureTimer = undefined;
    }
    finishResolver?.();
  };

  const failFinish = (reason: unknown): void => {
    if (finished) {
      return;
    }
    finished = true;
    if (quietTimer) {
      clearTimeout(quietTimer);
      quietTimer = undefined;
    }
    if (captureTimer) {
      clearTimeout(captureTimer);
      captureTimer = undefined;
    }
    finishRejecter?.(reason);
  };

  const setupPromise = new Promise<void>((resolve, reject) => {
    setupResolver = resolve;
    setupRejecter = reject;
  });

  const finishPromise = new Promise<void>((resolve, reject) => {
    finishResolver = resolve;
    finishRejecter = reject;
  });
  void setupPromise.catch(() => undefined);
  void finishPromise.catch(() => undefined);

  const setupTimer = setTimeout(() => {
    if (!setupResolved) {
      setupRejecter?.(new Error(`Lyria setup did not complete within ${LYRIA_SETUP_TIMEOUT_MS}ms.`));
    }
  }, LYRIA_SETUP_TIMEOUT_MS);

  let session: Awaited<ReturnType<typeof ai.live.music.connect>> | undefined;
  let connectTimer: NodeJS.Timeout | undefined;
  const connectPromise = ai.live.music.connect({
    model: LYRIA_MODEL,
    callbacks: {
      onmessage: (message) => {
        if (message.setupComplete && !setupResolved) {
          setupResolved = true;
          clearTimeout(setupTimer);
          setupResolver?.();
          return;
        }

        if (message.filteredPrompt?.filteredReason) {
          filteredReason = message.filteredPrompt.filteredReason;
        }

        const chunk = message.audioChunk;
        if (!chunk?.data) {
          return;
        }

        try {
          const bytes = Buffer.from(chunk.data, "base64");
          if (bytes.length === 0) {
            return;
          }
          buffers.push(bytes);
          if (!audioMimeType && chunk.mimeType) {
            audioMimeType = chunk.mimeType;
          }
          if (buffers.length >= Math.max(1, LYRIA_MIN_CHUNKS)) {
            if (quietTimer) {
              clearTimeout(quietTimer);
            }
            quietTimer = setTimeout(() => {
              settleFinish();
            }, LYRIA_IDLE_FINISH_MS);
          }
        } catch (error) {
          failFinish(error);
        }
      },
      onerror: (event) => {
        const details =
          typeof event?.message === "string" && event.message.length > 0
            ? event.message
            : "unknown websocket error";
        failFinish(new Error(`Lyria websocket error: ${details}`));
      },
      onclose: () => {
        if (buffers.length > 0) {
          settleFinish();
          return;
        }
        failFinish(new Error("Lyria websocket closed before returning any audio chunks."));
      }
    }
  });

  try {
    session = (await Promise.race([
      connectPromise,
      new Promise<never>((_, reject) => {
        connectTimer = setTimeout(() => {
          reject(new Error(`Lyria connect did not complete within ${LYRIA_CONNECT_TIMEOUT_MS}ms.`));
        }, LYRIA_CONNECT_TIMEOUT_MS);
      })
    ])) as Awaited<ReturnType<typeof ai.live.music.connect>>;
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = undefined;
    }
  } catch (error) {
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = undefined;
    }
    clearTimeout(setupTimer);
    throw error;
  }

  try {
    await setupPromise;

    await session.setWeightedPrompts({
      weightedPrompts: getLyriaWeightedPrompts(backstory, product, script, durationSeconds, guidelines, brief)
    });
    await session.setMusicGenerationConfig({
      musicGenerationConfig: getLyriaGenerationConfig(product, script)
    });
    session.play();

    captureTimer = setTimeout(() => {
      settleFinish();
    }, LYRIA_CAPTURE_TIMEOUT_MS);
    await finishPromise;
  } finally {
    clearTimeout(setupTimer);
    if (quietTimer) {
      clearTimeout(quietTimer);
    }
    if (captureTimer) {
      clearTimeout(captureTimer);
    }
    try {
      session?.stop();
    } catch {
      // no-op
    }
    session?.close();
  }

  if (buffers.length === 0) {
    throw new Error(
      filteredReason
        ? `Lyria returned no audio chunks. Prompt was filtered: ${filteredReason}`
        : "Lyria returned no audio chunks."
    );
  }

  const ext = getExtensionForAudioMimeType(audioMimeType || "audio/wav");
  const outputPath = path.join(jobDir, `background-score-lyria${ext}`);
  await fs.writeFile(outputPath, Buffer.concat(buffers));
  return { path: outputPath, chunkCount: buffers.length, mimeType: audioMimeType };
}

interface FalLyriaAudioResult {
  audio?: {
    url?: string;
    content_type?: string;
    file_name?: string;
  };
}

async function downloadAudioFile(url: string): Promise<{ bytes: Buffer<ArrayBufferLike>; mimeType?: string }> {
  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(GENAI_HTTP_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`Audio download failed: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer()) as Buffer<ArrayBufferLike>;
  const mimeType = response.headers.get("content-type")?.trim() || undefined;
  return { bytes, mimeType };
}

async function generateBackgroundScoreWithFalLyria(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  durationSeconds: number,
  jobDir: string,
  guidelines?: string,
  brief?: string
): Promise<{ path: string; mimeType?: string }> {
  const falClient = fal as unknown as {
    config: (config: { credentials: string }) => void;
    subscribe: (
      endpointId: string,
      options: {
        input: Record<string, unknown>;
        mode?: "polling";
        pollInterval?: number;
      }
    ) => Promise<{ data?: FalLyriaAudioResult }>;
  };
  falClient.config({ credentials: requireFalApiKey() });

  const result = await withKlingRetry("fal.lyria2.subscribe", async () =>
    await falClient.subscribe(FAL_LYRIA_MODEL, {
      input: {
        prompt: getBackgroundScorePrompt(backstory, product, script, durationSeconds, guidelines, brief),
        negative_prompt: getBackgroundScoreNegativePrompt(product)
      },
      mode: "polling",
      pollInterval: KLING_POLL_INTERVAL_MS
    })
  );

  const audioUrl = result.data?.audio?.url?.trim();
  if (!audioUrl) {
    throw new Error("fal Lyria output did not contain an audio URL.");
  }

  const downloaded = await withKlingRetry("fal.lyria2.download", () => downloadAudioFile(audioUrl));
  const mimeType = result.data?.audio?.content_type?.trim() || downloaded.mimeType || undefined;
  const outputPath = path.join(jobDir, `background-score-fal-lyria${getExtensionForAudioMimeType(mimeType || "audio/mpeg")}`);
  await fs.writeFile(outputPath, downloaded.bytes);
  return { path: outputPath, mimeType };
}

async function generateBackgroundScore(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  durationSeconds: number,
  jobDir: string,
  guidelines?: string,
  brief?: string
): Promise<{ path: string; source: "fal-lyria2" | "lyria-live"; mimeType?: string; chunkCount?: number }> {
  try {
    const generated = await generateBackgroundScoreWithFalLyria(
      backstory,
      product,
      script,
      durationSeconds,
      jobDir,
      guidelines,
      brief
    );
    return { ...generated, source: "fal-lyria2" };
  } catch (error) {
    const falMessage = errorMessage(error);
    if (!ALLOW_LYRIA_LIVE_FALLBACK) {
      throw new Error(`fal Lyria failed: ${falMessage}`);
    }
    try {
      const generated = await generateBackgroundScoreWithLyria(
        backstory,
        product,
        script,
        durationSeconds,
        jobDir,
        guidelines,
        brief
      );
      return { ...generated, source: "lyria-live" };
    } catch (fallbackError) {
      throw new Error(`fal Lyria failed: ${falMessage}. Lyria Live failed: ${errorMessage(fallbackError)}`);
    }
  }
}

interface TimedScriptWord {
  token: string;
  start: number;
  end: number;
}

type TimedSuperCueVariant =
  | "standard"
  | "air_plus_complimentary_flight_chip"
  | "air_plus_travel_privileges_chip"
  | "air_plus_travel_earn_chip"
  | "air_plus_forex_chip";

interface TimedSuperCue {
  triggerWord: string;
  text: string;
  start: number;
  end: number;
  variant: TimedSuperCueVariant;
  persistUntilVideoEnd: boolean;
}

const COMPARABLE_NUMBER_TOKEN_MAP: Readonly<Record<string, string>> = {
  "0": "zero",
  "2": "two",
  "4": "four",
  "5": "five",
  "100": "hundred"
};

function normalizeWordToken(value: string): string {
  const lowered = value.toLowerCase().trim();
  if (!lowered) {
    return "";
  }

  if (lowered === "%" || lowered === "percent") {
    return "percent";
  }

  if (lowered === "₹" || lowered === "rs" || lowered === "rs." || lowered === "inr") {
    return "rs";
  }

  const alphanumeric = lowered.replace(/[^a-z0-9.]+/g, "");
  if (!alphanumeric) {
    return "";
  }

  return COMPARABLE_NUMBER_TOKEN_MAP[alphanumeric] ?? alphanumeric.replace(/\./g, "");
}

function tokenizeScriptWords(value: string): string[] {
  return value
    .replace(/%/g, " percent ")
    .replace(/₹/g, " rs ")
    .split(/\s+/)
    .map((word) => normalizeWordToken(word))
    .filter(Boolean);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function escapeDrawtext(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function escapeFilterPath(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function wrapHowToText(value: string, maxCharsPerLine = 24, maxLines = 8): string[] {
  const words = value
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) {
    return ["Follow this step"];
  }

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
    }
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines.slice(0, maxLines);
}

function parseHowToSteps(stepsText: string): string[] {
  const normalizedLines = stepsText
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  if (normalizedLines.length >= 2) {
    return normalizedLines.map((line) => line.replace(/^[-*•]\s*/, "").trim()).filter(Boolean);
  }

  const inlineSteps = stepsText
    .split(/(?=step\s*\d+\s*[:.)-])/gi)
    .map((part) => part.trim())
    .filter(Boolean);

  if (inlineSteps.length >= 2) {
    return inlineSteps;
  }

  return normalizedLines;
}

function buildHowToBackstory(product: ProductKey): Backstory {
  return {
    persona_name: product === "kotak_air_plus" ? "How-To Guide" : "How-To Guide",
    gender_presentation: "man",
    age_range: "25-40",
    city: "Mumbai",
    profession: "Instructional digital assistant",
    why_they_care: "This flow explains exactly what to do, step by step, with no ambiguity.",
    facial_features: BACKSTORY_FACIAL_FEATURES_FALLBACK,
    hairstyle_grooming: BACKSTORY_HAIRSTYLE_GROOMING_FALLBACK,
    wardrobe_details: BACKSTORY_WARDROBE_DETAILS_FALLBACK,
    posture_body_language: BACKSTORY_POSTURE_BODY_LANGUAGE_FALLBACK,
    expression_style: BACKSTORY_EXPRESSION_STYLE_FALLBACK,
    speaking_energy: BACKSTORY_SPEAKING_ENERGY_FALLBACK,
    body_build: BACKSTORY_BODY_BUILD_FALLBACK,
    speaking_style: [...BACKSTORY_SPEAKING_STYLE_LOCK],
    wardrobe_props: [WARDROBE_CLEAN_FALLBACK, WARDROBE_CLEAN_FALLBACK],
    setting: "App tutorial layout with right-side screengrab panel",
    compliance_notes: [
      "Use only user-provided screengrab visuals; no invented UI or fabricated actions.",
      "Keep instructions functional, literal, and non-promotional."
    ]
  };
}

function extractGeminiAudioPart(response: unknown): { dataBase64: string; mimeType: string } | null {
  if (!response || typeof response !== "object") {
    return null;
  }

  const candidatesValue = (response as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidatesValue)) {
    return null;
  }

  for (const candidate of candidatesValue) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const content = (candidate as { content?: unknown }).content;
    if (!content || typeof content !== "object") {
      continue;
    }
    const parts = (content as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) {
      continue;
    }
    for (const part of parts) {
      if (!part || typeof part !== "object") {
        continue;
      }
      const inlineData = (part as { inlineData?: unknown }).inlineData;
      if (!inlineData || typeof inlineData !== "object") {
        continue;
      }
      const data = (inlineData as { data?: unknown }).data;
      const mimeType = (inlineData as { mimeType?: unknown }).mimeType;
      if (typeof data === "string" && data.trim().length > 0) {
        return {
          dataBase64: data.trim(),
          mimeType: typeof mimeType === "string" && mimeType.trim().length > 0 ? mimeType.trim() : "audio/wav"
        };
      }
    }
  }

  return null;
}

function parseAudioRateFromMimeType(mimeType: string): number {
  const match = mimeType.match(/rate=(\d{4,6})/i);
  if (!match?.[1]) {
    return 24_000;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 8_000 ? parsed : 24_000;
}

function toSpeakableVoiceText(value: string): string {
  const normalizedQuotes = value.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'");
  const withSpokenUrls = normalizedQuotes.replace(/https?:\/\/[^\s)]+/gi, (rawUrl) => {
    const stripped = rawUrl.replace(/^https?:\/\//i, "");
    return stripped
      .replace(/[_-]+/g, " ")
      .replace(/\//g, " slash ")
      .replace(/\./g, " dot ")
      .replace(/\?/g, " question mark ")
      .replace(/&/g, " and ");
  });

  return withSpokenUrls
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\b(\d+)-digit\b/gi, "$1 digit")
    .replace(/\s+/g, " ")
    .trim();
}

function stripUrlsForSpeech(value: string): string {
  return value
    .replace(/https?:\/\/[^\s)]+/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function generateHowToVoiceoverTrack(
  ttsClient: GoogleGenAI,
  stepText: string,
  stepIndex: number,
  jobDir: string
): Promise<string> {
  const model = process.env.GEMINI_TTS_MODEL?.trim() || "gemini-2.5-flash-preview-tts";
  const voiceName = process.env.GEMINI_TTS_VOICE?.trim() || "Kore";
  const verbatimStepText = stepText.replace(/\s+/g, " ").trim();
  const spokenFallbackText = toSpeakableVoiceText(verbatimStepText);
  const noUrlFallbackText = stripUrlsForSpeech(spokenFallbackText);
  const containsUrl = /https?:\/\//i.test(verbatimStepText);
  const promptCandidates = containsUrl
    ? [noUrlFallbackText, spokenFallbackText]
    : [
        [
          "Speak the tutorial step below in a clear female voice.",
          "Read it verbatim: do not add, remove, paraphrase, summarize, translate, or reorder any words.",
          "Output audio only.",
          "",
          `STEP: ${verbatimStepText}`
        ].join("\n"),
        verbatimStepText,
        spokenFallbackText,
        noUrlFallbackText
      ];
  const promptAttempts = Array.from(
    new Set(promptCandidates.map((item) => item.trim()).filter((item) => item.length > 0))
  );

  let audioPart: { dataBase64: string; mimeType: string } | null = null;
  for (let promptIndex = 0; promptIndex < promptAttempts.length; promptIndex += 1) {
    const promptText = promptAttempts[promptIndex]!;
    let response: unknown | undefined;
    let lastRequestError: unknown;

    for (let requestAttempt = 1; requestAttempt <= HOWTO_TTS_MAX_ATTEMPTS; requestAttempt += 1) {
      try {
        response = await ttsClient.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: promptText
                }
              ]
            }
          ],
          config: {
            temperature: 0,
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName
                }
              }
            }
          } as unknown as Record<string, unknown>
        });
        break;
      } catch (error) {
        lastRequestError = error;
        const retryable = requestAttempt < HOWTO_TTS_MAX_ATTEMPTS && isRetryableGenAiError(error);
        if (!retryable) {
          break;
        }
        await sleep(HOWTO_TTS_RETRY_BASE_MS * requestAttempt);
      }
    }

    if (!response && lastRequestError) {
      continue;
    }
    audioPart = extractGeminiAudioPart(response);
    if (audioPart) {
      break;
    }
  }

  if (!audioPart) {
    throw new Error("Voice generation returned no audio payload after retries.");
  }

  const audioBytes = Buffer.from(audioPart.dataBase64, "base64");
  if (audioBytes.length === 0) {
    throw new Error("Voice generation returned empty audio bytes.");
  }

  const mimeType = audioPart.mimeType.toLowerCase();
  const directOutputPath =
    mimeType.includes("wav") || mimeType.includes("wave")
      ? path.join(jobDir, `howto-voice-${String(stepIndex + 1).padStart(2, "0")}.wav`)
      : mimeType.includes("mpeg") || mimeType.includes("mp3")
        ? path.join(jobDir, `howto-voice-${String(stepIndex + 1).padStart(2, "0")}.mp3`)
        : mimeType.includes("ogg")
          ? path.join(jobDir, `howto-voice-${String(stepIndex + 1).padStart(2, "0")}.ogg`)
          : "";

  if (directOutputPath) {
    await fs.writeFile(directOutputPath, audioBytes);
    return directOutputPath;
  }

  const rawPcmPath = path.join(jobDir, `howto-voice-${String(stepIndex + 1).padStart(2, "0")}.pcm`);
  const wavPath = path.join(jobDir, `howto-voice-${String(stepIndex + 1).padStart(2, "0")}.wav`);
  const sampleRate = parseAudioRateFromMimeType(audioPart.mimeType);
  await fs.writeFile(rawPcmPath, audioBytes);
  await runCommand(
    FFMPEG_BIN,
    ["-y", "-f", "s16le", "-ar", String(sampleRate), "-ac", "1", "-i", rawPcmPath, "-c:a", "pcm_s16le", wavPath],
    jobDir
  );
  return wavPath;
}

async function generateHowToVideoFromSteps(
  jobDir: string,
  product: ProductKey,
  script: string,
  howTo: HowToConfig | undefined,
  requestedDurationSeconds: number,
  onProgress: (details: { stepIndex: number; totalSteps: number; phase: "voice" | "layout" | "text" }) => Promise<void>
): Promise<{ videoBytes: Buffer; stepFileNames: string[] }> {
  if (!howTo || howTo.screengrabFiles.length === 0) {
    throw new Error("How-to video requires at least one screengrab image.");
  }

  const steps = parseHowToSteps(howTo.stepsText || script);
  if (steps.length === 0) {
    throw new Error("How-to video requires non-empty step-by-step text.");
  }

  const ttsClient = new GoogleGenAI({
    apiKey: requireApiKey(),
    httpOptions: {
      timeout: HOWTO_TTS_HTTP_TIMEOUT_MS
    }
  });
  const finalStepClips: string[] = [];
  const stepFileNames: string[] = [];
  const screengrabs = howTo.screengrabFiles.map((fileName) => path.join(jobDir, path.basename(fileName)));

  for (let index = 0; index < steps.length; index += 1) {
    const stepText = steps[index]!;
    const screengrabPath = screengrabs[Math.min(index, screengrabs.length - 1)]!;
    await fs.access(screengrabPath);

    await onProgress({ stepIndex: index, totalSteps: steps.length, phase: "voice" });
    const voicePath = await generateHowToVoiceoverTrack(ttsClient, stepText, index, jobDir);

    await onProgress({ stepIndex: index, totalSteps: steps.length, phase: "layout" });
    const baseClipPath = path.join(jobDir, `howto-step-${String(index + 1).padStart(2, "0")}-base.mp4`);
    const leftPanelWidth = 740;
    const rightPanelWidth = HOWTO_FRAME_WIDTH - leftPanelWidth;
    const baseFilterGraph = [
      `[1:v]scale=${rightPanelWidth}:${HOWTO_FRAME_HEIGHT}:force_original_aspect_ratio=decrease,pad=${rightPanelWidth}:${HOWTO_FRAME_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black[screen]`,
      `[0:v][screen]overlay=x=${leftPanelWidth}:y=0[tmp]`,
      `[tmp]drawbox=x=${leftPanelWidth - 2}:y=0:w=4:h=${HOWTO_FRAME_HEIGHT}:color=0x334155:t=fill[v]`
    ].join(";");

    await runCommand(
      FFMPEG_BIN,
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=0x0f172a:s=${HOWTO_FRAME_WIDTH}x${HOWTO_FRAME_HEIGHT}:r=30`,
        "-loop",
        "1",
        "-i",
        screengrabPath,
        "-i",
        voicePath,
        "-filter_complex",
        baseFilterGraph,
        "-map",
        "[v]",
        "-map",
        "2:a:0",
        "-r",
        "30",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-shortest",
        "-movflags",
        "+faststart",
        baseClipPath
      ],
      jobDir
    );

    await onProgress({ stepIndex: index, totalSteps: steps.length, phase: "text" });
    const finalClipPath = path.join(jobDir, `howto-step-${String(index + 1).padStart(2, "0")}.mp4`);
    const lines = wrapHowToText(stepText, 24, 8);
    const stepTitle = `Step ${index + 1}`;
    const drawtextFont = SUPERS_FONT_FILE && SUPERS_FONT_FILE.length > 0 ? `fontfile='${escapeDrawtext(SUPERS_FONT_FILE)}':` : "";
    const textFilter = [
      "drawbox=",
      "x=24:",
      "y=96:",
      `w=${leftPanelWidth - 48}:`,
      "h=220:",
      "color=0b1220@0.35:",
      "t=fill"
    ].join("");
    const titleFilter = [
      "drawtext=",
      drawtextFont,
      `text='${escapeDrawtext(stepTitle)}':`,
      "fontsize=44:",
      "fontcolor=0xF8FAFC:",
      "x=52:",
      "y=132:",
      "borderw=1:",
      "bordercolor=black@0.35"
    ].join("");
    const bodyFilter = [
      "drawtext=",
      drawtextFont,
      `text='${escapeDrawtext(lines.join("\\n"))}':`,
      "fontsize=40:",
      "line_spacing=12:",
      "fontcolor=0xE2E8F0:",
      "x=52:",
      "y=200:",
      `box=1:boxcolor=0f172a@0.35:boxborderw=14:`,
      "borderw=1:",
      "bordercolor=black@0.25"
    ].join("");

    await runCommand(
      FFMPEG_BIN,
      [
        "-y",
        "-i",
        baseClipPath,
        "-vf",
        [textFilter, titleFilter, bodyFilter].join(","),
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        finalClipPath
      ],
      jobDir
    );

    finalStepClips.push(finalClipPath);
    stepFileNames.push(path.basename(finalClipPath));
  }

  const concatPath = path.join(jobDir, "howto.concat.txt");
  await fs.writeFile(
    concatPath,
    finalStepClips.map((clipPath) => `file '${clipPath.replace(/'/g, "'\\''")}'`).join("\n"),
    "utf8"
  );

  const outputPath = path.join(jobDir, "raw.mp4");
  await runCommand(
    FFMPEG_BIN,
    [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatPath,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
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
    ],
    jobDir
  );

  const estimatedDuration = estimateHowToDurationSeconds(howTo.stepsText, howTo.screengrabFiles.length);
  if (requestedDurationSeconds > estimatedDuration) {
    // Preserve explicit longer duration requests by extending final hold.
    try {
      const bytes = await fs.readFile(outputPath);
      const extended = await extendVideoToTargetDuration(bytes, requestedDurationSeconds, jobDir, "howto");
      return { videoBytes: extended, stepFileNames };
    } catch (error) {
      if (!isFfmpegMissingError(error)) {
        throw error;
      }
    }
  }

  return { videoBytes: await fs.readFile(outputPath), stepFileNames };
}

function findTriggerStartIndex(tokens: string[], triggerTokens: string[], fromIndex: number): number {
  if (tokens.length === 0 || triggerTokens.length === 0) {
    return -1;
  }

  for (let i = fromIndex; i <= tokens.length - triggerTokens.length; i += 1) {
    let match = true;
    for (let j = 0; j < triggerTokens.length; j += 1) {
      if (tokens[i + j] !== triggerTokens[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      return i;
    }
  }

  return -1;
}

async function getVideoDurationSeconds(videoPath: string, cwd: string): Promise<number> {
  try {
    const probe = await runCommandWithOutput(
      FFPROBE_BIN,
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", videoPath],
      cwd
    );
    const parsed = Number(probe.stdout.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  } catch (error) {
    if (!isFfmpegMissingError(error)) {
      console.warn("[pipeline] ffprobe duration lookup failed, falling back to 8s", error);
    }
  }

  return META_FORMAT.durationSeconds;
}

async function getVideoResolution(videoPath: string, cwd: string): Promise<{ width: number; height: number }> {
  try {
    const probe = await runCommandWithOutput(
      FFPROBE_BIN,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0:s=x",
        videoPath
      ],
      cwd
    );
    const parsed = probe.stdout.trim().match(/^(\d{2,5})x(\d{2,5})$/);
    if (parsed?.[1] && parsed?.[2]) {
      const width = Number(parsed[1]);
      const height = Number(parsed[2]);
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        return { width, height };
      }
    }
  } catch (error) {
    if (!isFfmpegMissingError(error)) {
      console.warn("[pipeline] ffprobe resolution lookup failed, falling back to default frame size", error);
    }
  }

  return { width: KEYFRAME_WIDTH, height: KEYFRAME_HEIGHT };
}

async function normalizeVideoToFrameInPlace(videoPath: string, targetFrame: FrameSpec, jobDir: string): Promise<boolean> {
  const currentResolution = await getVideoResolution(videoPath, jobDir);
  if (currentResolution.width === targetFrame.width && currentResolution.height === targetFrame.height) {
    return false;
  }

  const outputPath = path.join(
    jobDir,
    `normalized-${targetFrame.aspectRatio.replace(":", "x")}-${targetFrame.width}x${targetFrame.height}.mp4`
  );

  await runCommand(
    FFMPEG_BIN,
    [
      "-y",
      "-i",
      videoPath,
      "-vf",
      `fps=30,scale=${targetFrame.width}:${targetFrame.height}:force_original_aspect_ratio=increase,crop=${targetFrame.width}:${targetFrame.height},setsar=1`,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      outputPath
    ],
    jobDir
  );

  await fs.rename(outputPath, videoPath).catch(async () => {
    await fs.copyFile(outputPath, videoPath);
    await fs.unlink(outputPath).catch(() => undefined);
  });

  return true;
}

async function hasAudioStream(videoPath: string, cwd: string): Promise<boolean> {
  const probe = await runCommandWithOutput(
    FFPROBE_BIN,
    ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", videoPath],
    cwd
  );

  return probe.stdout
    .split(/\r?\n/g)
    .map((value) => value.trim())
    .filter(Boolean).length > 0;
}

async function isLikelySilentAudio(audioPath: string, cwd: string): Promise<boolean> {
  const nullSink = process.platform === "win32" ? "NUL" : "/dev/null";
  try {
    const result = await runCommandWithOutput(
      FFMPEG_BIN,
      ["-v", "info", "-i", audioPath, "-af", "volumedetect", "-f", "null", nullSink],
      cwd
    );
    const output = `${result.stdout}\n${result.stderr}`;
    if (/max_volume:\s*-inf/i.test(output) || /mean_volume:\s*-inf/i.test(output)) {
      return true;
    }
    const maxMatch = output.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/i);
    if (!maxMatch) {
      return false;
    }
    const maxVolume = Number(maxMatch[1]);
    // Treat ultra-low tracks as effectively silent for ad mix use.
    return Number.isFinite(maxVolume) && maxVolume <= -42;
  } catch (error) {
    if (!isFfmpegMissingError(error)) {
      console.warn(`[pipeline] failed to evaluate background score loudness for ${audioPath}`, error);
    }
    return false;
  }
}

function sanitizeTriggerPhrase(value: string): string {
  return tokenizeScriptWords(value).join(" ");
}

function normalizeSupersText(value: string): string {
  return value
    .replace(/₹\s*/g, "Rs. ")
    .replace(/\binr\s*/gi, "Rs. ")
    .replace(/\bRs\s*(?=\d)/gi, "Rs. ")
    .replace(/\bRs\.\s*(?=\d)/gi, "Rs. ")
    .replace(/\b15l\b/gi, "1.5 lakh")
    .replace(/\b15\s+lakh(?:s)?\b/gi, "1.5 lakh")
    .replace(/\b1\.?5\s*l(?:akh|akhs)?\b/gi, "1.5 lakh")
    .replace(/\b1,?50,?000\b/g, "1.5 lakh")
    .replace(/\b150000\b/g, "1.5 lakh")
    .replace(/\bone\s+point\s+five\s+lakh\b/gi, "1.5 lakh")
    .replace(/\bone\s+and\s+a\s+half\s+lakh\b/gi, "1.5 lakh")
    .replace(/\b(?:rs\.?\s*)?1\.5\s+lakh\b/gi, "Rs. 1.5 lakh")
    .replace(/\s+/g, " ")
    .trim();
}

function capitalizeFirst(value: string): string {
  if (!value) {
    return value;
  }
  return value[0].toUpperCase() + value.slice(1);
}

function clampSupersTextLength(value: string): string {
  const normalized = normalizeSupersText(value);
  if (!normalized) {
    return "";
  }

  const lower = normalized.toLowerCase();
  if (/\btravel\b.*\b(?:80[, ]?000|80k|eighty thousand)\b|\b(?:80[, ]?000|80k|eighty thousand)\b.*\btravel\b/.test(lower)) {
    return "Travel perks worth 80K";
  }
  if (/\b(?:free|complimentary)\s+flight\b/.test(lower)) {
    return "Free flight at Rs. 1.5L spent this quarter";
  }
  if (/\bquarter(?:ly)?\b.*\b(?:1\.5\s*lakh|1\.5l)\b|\b(?:1\.5\s*lakh|1\.5l)\b.*\bquarter(?:ly)?\b/.test(lower)) {
    return "Rs. 1.5L quarterly spend";
  }
  if (/\b(?:5%|5 percent)\b.*\btravel\b|\btravel\b.*\b(?:5%|5 percent)\b/.test(lower)) {
    return "Earn 5% on travel";
  }
  if (/\bair\s*miles?\b/.test(lower)) {
    return "5 Air Miles/ Rs 100 spent on travel";
  }
  if (/\b(?:2%|2 percent)\b.*\b(?:forex|fx)\b|\b(?:forex|fx)\b.*\b(?:2%|2 percent)\b/.test(lower)) {
    return "2% forex markup";
  }
  if (/\bzero\b.*\bjoining\s+fee\b|\bjoining\s+fee\b.*\b(?:inr|rs\.?|₹)?\s*0\b|\bnil\s+joining\s+fee\b/.test(lower)) {
    return "Zero joining fee";
  }
  if (/\b(?:5%|5 percent)\s*cashback\b.*\b(?:essentials?|grocer(?:y|ies)|milk)\b|\b(?:essentials?|grocer(?:y|ies)|milk)\b.*\b(?:5%|5 percent)\s*cashback\b/.test(lower)) {
    return "5% cashback essentials";
  }
  if (/\b(?:5%|5 percent)\s*cashback\b.*\b(?:entertainment|movies?|dining|ott)\b|\b(?:entertainment|movies?|dining|ott)\b.*\b(?:5%|5 percent)\s*cashback\b/.test(lower)) {
    return "5% cashback OTT & dining";
  }
  if (/\b(?:up\s*to\s*)?(?:4(?:\s*%|\s*percent)|four\s*percent)\b.*\bfuel\b|\bfuel\b.*\b(?:up\s*to\s*)?(?:4(?:\s*%|\s*percent)|four\s*percent)\b/.test(lower)) {
    return "Up to 4% on fuel spends";
  }
  if (/\bfuel\b/.test(lower)) {
    return "Up to 4% on fuel spends";
  }
  if (/\b(?:5%|5 percent)\s*cashback\b|\bcashback\b/.test(lower)) {
    return "Get 5% cashback";
  }

  const compact = normalized
    .replace(/\bfor a limited period\b/gi, "")
    .replace(/\blike groceries and milk\b/gi, "essentials")
    .replace(/\bon your\b/gi, "on")
    .replace(/\s+/g, " ")
    .trim();

  if (compact.length <= SUPERS_MAX_TEXT_CHARS) {
    return capitalizeFirst(compact);
  }

  const words = compact.split(/\s+/).filter(Boolean);
  let clipped = "";
  for (const word of words) {
    const candidate = clipped ? `${clipped} ${word}` : word;
    if (candidate.length > SUPERS_MAX_TEXT_CHARS) {
      break;
    }
    clipped = candidate;
  }

  if (!clipped) {
    clipped = compact.slice(0, SUPERS_MAX_TEXT_CHARS).trim();
  }
  return capitalizeFirst(clipped);
}

function isAirPlusComplimentaryFlightSupersText(value: string): boolean {
  const normalized = clampSupersTextLength(value).toLowerCase().trim();
  if (!normalized) {
    return false;
  }

  if (normalized === AIR_PLUS_COMPLIMENTARY_FLIGHT_SUPERS_TEXT.toLowerCase()) {
    return true;
  }

  return (/\bfree flight\b|\bcomplimentary flight\b/.test(normalized) &&
    (/\b1\.5l\b|\b1\.5 lakh\b/.test(normalized) || /\bquarter/.test(normalized)));
}

function isAirPlusTravelPrivilegesSupersText(value: string): boolean {
  const normalized = clampSupersTextLength(value).toLowerCase().trim();
  if (!normalized) {
    return false;
  }

  return normalized === AIR_PLUS_TRAVEL_PRIVILEGES_SUPERS_TEXT.toLowerCase();
}

function isAirPlusTravelEarnSupersText(value: string): boolean {
  const normalized = clampSupersTextLength(value).toLowerCase().trim();
  if (!normalized) {
    return false;
  }

  if (normalized === AIR_PLUS_TRAVEL_EARN_SUPERS_TEXT.toLowerCase()) {
    return true;
  }

  return /\bearn\b[^.!?]{0,24}\b5%\b[^.!?]{0,24}\btravel\b|\b5%\b[^.!?]{0,24}\btravel\b/.test(normalized);
}

function isAirPlusForexSupersText(value: string): boolean {
  const normalized = clampSupersTextLength(value).toLowerCase().trim();
  if (!normalized) {
    return false;
  }

  if (normalized === AIR_PLUS_FOREX_SUPERS_TEXT.toLowerCase()) {
    return true;
  }

  return /\b(?:2%|2 percent|two percent)\b[^.!?]{0,24}\b(?:forex|fx)\b|\b(?:forex|fx)\b[^.!?]{0,24}\b(?:2%|2 percent|two percent)\b/.test(
    normalized
  );
}

function isZeroJoiningFeeSupersText(value: string): boolean {
  return clampSupersTextLength(value).toLowerCase().trim() === "zero joining fee";
}

function getTimedSuperCueVariant(text: string): TimedSuperCueVariant {
  if (isAirPlusComplimentaryFlightSupersText(text)) {
    return "air_plus_complimentary_flight_chip";
  }
  if (isAirPlusTravelPrivilegesSupersText(text)) {
    return "air_plus_travel_privileges_chip";
  }
  if (isAirPlusTravelEarnSupersText(text)) {
    return "air_plus_travel_earn_chip";
  }
  if (isAirPlusForexSupersText(text)) {
    return "air_plus_forex_chip";
  }
  return "standard";
}

function buildTimedSuperCue(rule: SupersTriggerRule, start: number, end: number, durationSeconds: number): TimedSuperCue {
  const variant = getTimedSuperCueVariant(rule.text);
  const persistUntilVideoEnd = variant === "air_plus_complimentary_flight_chip";

  return {
    triggerWord: rule.triggerWord,
    text: rule.text,
    start,
    end: persistUntilVideoEnd ? durationSeconds : end,
    variant,
    persistUntilVideoEnd
  };
}

function isAirPlusSpecialChipVariant(variant: TimedSuperCueVariant): boolean {
  return (
    variant === "air_plus_complimentary_flight_chip" ||
    variant === "air_plus_travel_privileges_chip" ||
    variant === "air_plus_travel_earn_chip" ||
    variant === "air_plus_forex_chip"
  );
}

function prioritizePersistentSupersCues(cues: TimedSuperCue[]): TimedSuperCue[] {
  const firstPersistentCue = cues.find((cue) => cue.persistUntilVideoEnd);
  if (!firstPersistentCue) {
    return cues.filter((cue) => cue.end > cue.start + 0.1);
  }

  return cues.filter((cue) => cue === firstPersistentCue || cue.start < firstPersistentCue.start - 0.01);
}

function findScriptMatch(value: string, pattern: RegExp): string | undefined {
  const match = value.match(pattern);
  const phrase = match?.[0] ? sanitizeTriggerPhrase(match[0]) : "";
  return phrase || undefined;
}

function findScriptMatchAny(value: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = findScriptMatch(value, pattern);
    if (match) {
      return match;
    }
  }
  return undefined;
}

function addAutoSupersRule(
  rules: SupersTriggerRule[],
  triggerWord: string | undefined,
  text: string,
  holdSeconds = SUPERS_DEFAULT_HOLD_SECONDS
): void {
  const normalizedTextOutput = clampSupersTextLength(text);
  if (!triggerWord || !normalizedTextOutput) {
    return;
  }

  const normalizedText = normalizedTextOutput.toLowerCase().trim();
  if (normalizedText === "cashback") {
    return;
  }

  if (rules.some((rule) => rule.text.toLowerCase().trim() === normalizedText)) {
    return;
  }

  rules.push({
    triggerWord,
    text: normalizedTextOutput,
    holdSeconds
  });
}

function deriveAutomaticSupersRules(product: ProductKey, script: string): SupersTriggerRule[] {
  const rules: SupersTriggerRule[] = [];

  if (product === "kotak_air_plus") {
    const travelPrivilegesMatch = findScriptMatchAny(script, [
      /\btravel\s+(?:privileges|privilidges|benefits?)\b[^.!?]{0,40}\b(?:80[, ]?000|80k|eighty\s*thousand)\b/i,
      /\b(?:80[, ]?000|80k|eighty\s*thousand)\b[^.!?]{0,40}\btravel\b[^.!?]{0,30}\b(?:privileges|privilidges|benefits?)\b/i,
      /\b(?:worth|value)\b[^.!?]{0,20}\b(?:80[, ]?000|80k|eighty\s*thousand)\b/i
    ]);
    addAutoSupersRule(
      rules,
      travelPrivilegesMatch,
      "Travel perks worth 80K",
      1.6
    );

    const freeFlightMatch = findScriptMatchAny(script, [
      /\b(?:free|complimentary)\s+(?:flight|flight\s+ticket)\b/i,
      /\b(?:unlock|get|earn)\b[^.!?]{0,40}\b(?:a\s+)?(?:free|complimentary)\s+(?:flight|flight\s+ticket)\b/i,
      /\b(?:flight|flight\s+ticket)\b[^.!?]{0,30}\b(?:free|complimentary)\b/i
    ]);
    addAutoSupersRule(
      rules,
      freeFlightMatch,
      "Free flight at Rs. 1.5L spent this quarter",
      1.7
    );

    const quarterlySpendAmountMatch = findScriptMatchAny(script, [
      /\b(?:quarter(?:ly)?\s+spends?|spend\s+in\s+(?:a|the)\s+quarter|this\s+quarter)\b[^.!?]{0,45}\b(?:₹\s*)?(?:1\.?5\s*l(?:akh|akhs)?|1,?50,?000|150000|one\s+point\s+five\s+lakh|one\s+and\s+a\s+half\s+lakh)\b/i,
      /\b(?:₹\s*)?(?:1\.?5\s*l(?:akh|akhs)?|1,?50,?000|150000|one\s+point\s+five\s+lakh|one\s+and\s+a\s+half\s+lakh)\b[^.!?]{0,45}\b(?:quarter(?:ly)?\s+spends?|spend\s+in\s+(?:a|the)\s+quarter|this\s+quarter)\b/i
    ]);
    const quarterlySpendMatch = findScriptMatchAny(script, [
      /\bquarter(?:ly)?\s+spends?\b/i,
      /\bspend\s+in\s+(?:a|the)\s+quarter\b/i,
      /\bthis\s+quarter\b/i
    ]);
    const spendThresholdAmountMatch = findScriptMatchAny(script, [
      /\b(?:₹\s*)?1\.?5\s*l(?:akh|akhs)?\b/i,
      /\b1,?50,?000\b/i,
      /\b150000\b/i,
      /\bone\s+point\s+five\s+lakh\b/i,
      /\bone\s+and\s+a\s+half\s+lakh\b/i
    ]);
    const freeFlightOrSpendTrigger =
      freeFlightMatch ??
      quarterlySpendAmountMatch ??
      quarterlySpendMatch ??
      spendThresholdAmountMatch;
    addAutoSupersRule(
      rules,
      freeFlightOrSpendTrigger,
      "Free flight at Rs. 1.5L spent this quarter",
      1.7
    );

    const travelRewardsMatch = findScriptMatchAny(script, [
      /\b(?:5%|5\s*percent|five\s*percent)\s*(?:on|for)?\s*travel\b/i,
      /\btravel\b[^.!?]{0,40}\b(?:5%|5\s*percent|five\s*percent)\b/i,
      /\b(?:5%|5\s*percent|five\s*percent)\s*(?:rewards?|reward\s*points?)\b/i,
      /\bearn\b[^.!?]{0,30}\b(?:5%|5\s*percent|five\s*percent)\b[^.!?]{0,30}\btravel\b/i
    ]);
    addAutoSupersRule(
      rules,
      travelRewardsMatch,
      "Earn 5% on travel",
      1.4
    );

    const airMilesMatch = findScriptMatchAny(script, [
      /\b(?:5|five)\s*air\s*miles?\s*(?:for|on)?\s*(?:every|per)\s*(?:₹\s*100|rs\.?\s*100|inr\s*100|100\s*rupees?|one\s*hundred)\s*(?:spent\s*)?(?:on|for)?\s*travel\b/i,
      /\b(?:₹\s*100|rs\.?\s*100|inr\s*100|100\s*rupees?|one\s*hundred)\b[^.!?]{0,50}\b(?:5|five)\s*air\s*miles?\b/i,
      /\b(?:on|for)\s*travel\b[^.!?]{0,60}\b(?:5|five)\s*air\s*miles?\b/i,
      /\b(?:5|five)\s*air\s*miles?\b[^.!?]{0,60}\b(?:on|for)\s*travel\b/i
    ]);
    addAutoSupersRule(
      rules,
      airMilesMatch,
      "5 Air Miles/ Rs 100 spent on travel",
      1.5
    );

    const forexMatch =
      findScriptMatchAny(script, [
        /\b(?:enjoy\s+(?:a\s+)?)?(?:low|just|only|flat)?\s*(?:2%|2\s*percent|two\s*percent)\s*(?:forex|fx)\s*(?:mark(?:-|\s)?up|markup|charge|charges|fee|fees)\b/i,
        /\b(?:forex|fx)\s*(?:mark(?:-|\s)?up|markup|charge|charges|fee|fees)\b[^.!?]{0,30}\b(?:2%|2\s*percent|two\s*percent)\b/i,
        /\b(?:2%|2\s*percent|two\s*percent)\b[^.!?]{0,30}\b(?:forex|fx)\b/i,
        /\b(?:forex|fx)\b[^.!?]{0,40}\b(?:2%|2\s*percent|two\s*percent)\b/i
      ]) ?? findScriptMatch(script, /\bforex\b|\bfx\b/i);
    addAutoSupersRule(
      rules,
      forexMatch,
      "2% forex markup",
      1.3
    );

    const zeroFeeMatch = findScriptMatchAny(script, [
      /\bzero\s+joining\s+fee\b/i,
      /\bjoining\s+fee\s+(?:inr|₹|rs\.?)?\s*0\b/i,
      /\b(?:inr|₹|rs\.?)\s*0\s+joining\s+fee\b/i,
      /\bnil\s+joining\s+fee\b/i,
      /\bjoining\s+fee\s+waived\b/i
    ]);
    addAutoSupersRule(
      rules,
      zeroFeeMatch,
      "Zero joining fee",
      1.3
    );
  } else {
    const essentialsMatch = findScriptMatchAny(script, [
      /\b(?:5%|5\s*percent|five\s*percent)\s*cashback\b[^.!?]{0,45}\b(?:essentials?|grocer(?:y|ies)|milk)\b/i,
      /\b(?:essentials?|grocer(?:y|ies)|milk)\b[^.!?]{0,45}\b(?:5%|5\s*percent|five\s*percent)\s*cashback\b/i,
      /\b(?:essentials?|grocer(?:y|ies)|milk)\b/i
    ]);
    addAutoSupersRule(
      rules,
      essentialsMatch,
      "5% cashback essentials",
      1.5
    );

    const entertainmentMatch = findScriptMatchAny(script, [
      /\b(?:5%|5\s*percent|five\s*percent)\s*cashback\b[^.!?]{0,45}\b(?:entertainment|movies?|dining|ott)\b/i,
      /\b(?:entertainment|movies?|dining|ott)\b[^.!?]{0,45}\b(?:5%|5\s*percent|five\s*percent)\s*cashback\b/i,
      /\b(?:entertainment|movies?|dining|ott)\b/i
    ]);
    addAutoSupersRule(
      rules,
      entertainmentMatch,
      "5% cashback OTT & dining",
      1.4
    );

    const fuelFourPercentMatch = findScriptMatchAny(script, [
      /\b(?:up\s*to\s*)?(?:4(?:\s*%|\s*percent)|four\s*percent)(?!\w)[^.!?]{0,60}\bfuel\b[^.!?]{0,24}\bspends?\b/i,
      /\b(?:up\s*to\s*)?(?:4(?:\s*%|\s*percent)|four\s*percent)(?!\w)[^.!?]{0,60}\bfuel\b/i,
      /\bfuel\b[^.!?]{0,60}\b(?:up\s*to\s*)?(?:4(?:\s*%|\s*percent)|four\s*percent)(?!\w)/i
    ]);
    if (fuelFourPercentMatch) {
      addAutoSupersRule(rules, fuelFourPercentMatch, "Up to 4% on fuel spends", 1.4);
    } else {
      const fuelMatch = findScriptMatchAny(script, [/\bfuel\b[^.!?]{0,60}\bspends?\b/i, /\bfuel\b/i]);
      addAutoSupersRule(
        rules,
        fuelMatch,
        "Up to 4% on fuel spends",
        1.4
      );
    }

    const cashbackMatch =
      findScriptMatchAny(script, [/\b5%\s*cashback\b/i, /\b5\s*percent\s*cashback\b/i, /\bfive\s*percent\s*cashback\b/i, /\b5%\b/i, /\b5\s*percent\b/i, /\bfive\s*percent\b/i]) ??
      findScriptMatch(script, /\bcashback\b/i);
    addAutoSupersRule(
      rules,
      cashbackMatch,
      "Get 5% cashback",
      1.2
    );

    const zeroFeeMatch = findScriptMatchAny(script, [
      /\bzero\s+joining\s+fee\b/i,
      /\bjoining\s+fee\s+(?:inr|₹|rs\.?)?\s*0\b/i,
      /\b(?:inr|₹|rs\.?)\s*0\s+joining\s+fee\b/i,
      /\bnil\s+joining\s+fee\b/i,
      /\bjoining\s+fee\s+waived\b/i
    ]);
    addAutoSupersRule(
      rules,
      zeroFeeMatch,
      "Zero joining fee",
      1.3
    );
  }

  if (rules.length === 0) {
    const fallbackTrigger = script
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .slice(0, 3)
      .join(" ");
    const fallbackText = product === "kotak_air_plus" ? "Earn 5% on travel" : "Get 5% cashback";
    addAutoSupersRule(rules, fallbackTrigger, fallbackText, 1.3);
  }

  return rules.slice(0, MAX_AUTO_SUPERS_RULES);
}

function normalizeSupersRules(rules: SupersTriggerRule[]): SupersTriggerRule[] {
  const normalized: SupersTriggerRule[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    const triggerWord = sanitizeTriggerPhrase(rule.triggerWord);
    const text = clampSupersTextLength(rule.text);

    if (!triggerWord || !text) {
      continue;
    }

    if (text.toLowerCase().trim() === "cashback") {
      continue;
    }

    const key = `${triggerWord}|${text.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push({
      triggerWord,
      text,
      holdSeconds:
        typeof rule.holdSeconds === "number"
          ? clampNumber(rule.holdSeconds, SUPERS_MIN_HOLD_SECONDS, SUPERS_MAX_HOLD_SECONDS)
          : undefined
    });
  }

  const hasSpecialImageChip = normalized.some((rule) => isAirPlusSpecialChipVariant(getTimedSuperCueVariant(rule.text)));
  const filtered = hasSpecialImageChip
    ? normalized.filter((rule) => !isZeroJoiningFeeSupersText(rule.text))
    : normalized;

  return filtered.slice(0, MAX_AUTO_SUPERS_RULES);
}

function resolveFastCueTimings(rules: SupersTriggerRule[], script: string, durationSeconds: number): TimedSuperCue[] {
  const scriptTokens = tokenizeScriptWords(script);
  const cues: TimedSuperCue[] = [];
  const triggerCursor = new Map<string, number>();

  for (const rule of rules) {
    const triggerTokens = tokenizeScriptWords(rule.triggerWord);
    if (triggerTokens.length === 0) {
      continue;
    }

    const key = triggerTokens.join(" ");
    const fromIndex = triggerCursor.get(key) ?? 0;
    const triggerIndex = findTriggerStartIndex(scriptTokens, triggerTokens, fromIndex);
    if (triggerIndex < 0) {
      continue;
    }

    triggerCursor.set(key, triggerIndex + triggerTokens.length);
    const start = scriptTokens.length > 0 ? (triggerIndex / scriptTokens.length) * durationSeconds : 0;
    const holdSeconds = clampNumber(
      (rule.holdSeconds ?? SUPERS_DEFAULT_HOLD_SECONDS) + SUPERS_EXTRA_HOLD_SECONDS,
      SUPERS_MIN_HOLD_SECONDS,
      SUPERS_MAX_HOLD_SECONDS
    );

    cues.push(buildTimedSuperCue(rule, start, start + holdSeconds, durationSeconds));
  }

  cues.sort((a, b) => a.start - b.start);
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index]!;
    if (cue.persistUntilVideoEnd) {
      cue.end = durationSeconds;
      continue;
    }
    const next = cues[index + 1];
    const maxEndByNext = next ? Math.max(cue.start + 0.2, next.start - 0.05) : durationSeconds;
    cue.end = Math.min(cue.end, maxEndByNext, durationSeconds);
  }

  return prioritizePersistentSupersCues(cues);
}

async function transcribeWordTimestampsWithWhisper(videoPath: string, jobDir: string): Promise<TimedScriptWord[]> {
  await runCommand(
    WHISPER_CLI_PATH,
    [
      videoPath,
      "--model",
      WHISPER_MODEL,
      "--model_dir",
      WHISPER_MODEL_DIR,
      "--word_timestamps",
      "True",
      "--output_format",
      "json",
      "--output_dir",
      jobDir
    ],
    jobDir
  );

  const transcriptPath = path.join(jobDir, `${path.parse(videoPath).name}.json`);
  const payload = JSON.parse(await fs.readFile(transcriptPath, "utf8")) as {
    segments?: Array<{ words?: Array<{ word?: string; start?: number; end?: number }> }>;
  };

  const words = payload.segments?.flatMap((segment) => segment.words ?? []) ?? [];
  return words
    .map((word) => ({
      token: normalizeWordToken(word.word ?? ""),
      start: Number(word.start ?? 0),
      end: Number(word.end ?? 0)
    }))
    .filter((word) => Boolean(word.token) && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start);
}

const SCRIPT_FIDELITY_IGNORED_TOKENS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "with",
  "without",
  "for",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "from",
  "your",
  "you",
  "this",
  "that",
  "just",
  "get",
  "enjoy",
  "unlock",
  "ready",
  "now",
  "apply",
  "learn",
  "more",
  "it",
  "is",
  "are",
  "be",
  "as",
  "into",
  "next",
  "up",
  "only",
  "low"
]);

interface ScriptFidelityCheckResult {
  pass: boolean;
  transcript: string;
  tokenOverlap: number;
  missingPhrases: string[];
  matchedPhrases: string[];
  reasons: string[];
}

function extractScriptFidelityRequiredPhrases(product: ProductKey, script: string): string[] {
  const normalizedScript = normalizeComparableText(script);
  const phrases = new Set<string>();
  if (normalizedScript.includes("kotak air plus")) {
    phrases.add("kotak air plus");
  }
  if (normalizedScript.includes("kotak cashback")) {
    phrases.add("kotak cashback");
  }
  if (normalizedScript.includes("apply now")) {
    phrases.add("apply now");
  }
  if (normalizedScript.includes("learn more")) {
    phrases.add("learn more");
  }

  for (const rule of deriveAutomaticSupersRules(product, script).slice(0, 2)) {
    const trigger = normalizeComparableText(rule.triggerWord);
    if (trigger) {
      phrases.add(trigger);
    }
  }

  return Array.from(phrases);
}

function calculateScriptTokenOverlap(script: string, transcript: string): number {
  const scriptTokens = tokenizeScriptWords(script).filter(
    (token) => token.length > 2 && !SCRIPT_FIDELITY_IGNORED_TOKENS.has(token)
  );
  if (scriptTokens.length === 0) {
    return 1;
  }
  const transcriptTokens = new Set(tokenizeScriptWords(transcript));
  const matches = scriptTokens.filter((token) => transcriptTokens.has(token));
  return matches.length / scriptTokens.length;
}

function inspectTranscriptScriptFidelity(product: ProductKey, script: string, transcript: string): ScriptFidelityCheckResult {
  const normalizedTranscript = normalizeComparableText(transcript);
  const requiredPhrases = extractScriptFidelityRequiredPhrases(product, script);
  const missingPhrases = requiredPhrases.filter((phrase) => !normalizedTranscript.includes(phrase));
  const matchedPhrases = requiredPhrases.filter((phrase) => normalizedTranscript.includes(phrase));
  const tokenOverlap = calculateScriptTokenOverlap(script, transcript);
  const reasons: string[] = [];

  if (!normalizedTranscript) {
    reasons.push("Transcript was empty or unusable.");
  }
  if (missingPhrases.length > 0) {
    reasons.push(`Missing critical script phrases: ${missingPhrases.join(", ")}.`);
  }
  if (tokenOverlap < SORA_SCRIPT_FIDELITY_MIN_TOKEN_OVERLAP) {
    reasons.push(
      `Content-word overlap ${tokenOverlap.toFixed(2)} is below the minimum ${SORA_SCRIPT_FIDELITY_MIN_TOKEN_OVERLAP.toFixed(2)}.`
    );
  }

  return {
    pass: reasons.length === 0,
    transcript: normalizedTranscript,
    tokenOverlap,
    missingPhrases,
    matchedPhrases,
    reasons
  };
}

async function inspectVideoScriptFidelityWithWhisper(
  videoPath: string,
  jobDir: string,
  product: ProductKey,
  script: string
): Promise<ScriptFidelityCheckResult> {
  const timedWords = await transcribeWordTimestampsWithWhisper(videoPath, jobDir);
  const transcript = timedWords.map((word) => word.token).join(" ").trim();
  return inspectTranscriptScriptFidelity(product, script, transcript);
}

function resolveAccurateCueTimings(rules: SupersTriggerRule[], timedWords: TimedScriptWord[], durationSeconds: number): TimedSuperCue[] {
  const cues: TimedSuperCue[] = [];
  const cursor = new Map<string, number>();
  const tokens = timedWords.map((word) => word.token);

  for (const rule of rules) {
    const triggerTokens = tokenizeScriptWords(rule.triggerWord);
    if (triggerTokens.length === 0) {
      continue;
    }

    const key = triggerTokens.join(" ");
    const fromIndex = cursor.get(key) ?? 0;
    const index = findTriggerStartIndex(tokens, triggerTokens, fromIndex);
    if (index < 0) {
      continue;
    }

    cursor.set(key, index + triggerTokens.length);
    const first = timedWords[index]!;
    const holdSeconds = clampNumber(
      (rule.holdSeconds ?? SUPERS_DEFAULT_HOLD_SECONDS) + SUPERS_EXTRA_HOLD_SECONDS,
      SUPERS_MIN_HOLD_SECONDS,
      SUPERS_MAX_HOLD_SECONDS
    );
    const start = clampNumber(first.start, 0, durationSeconds);
    const end = clampNumber(first.start + holdSeconds, 0, durationSeconds);
    cues.push(buildTimedSuperCue(rule, start, end, durationSeconds));
  }

  cues.sort((a, b) => a.start - b.start);
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index]!;
    if (cue.persistUntilVideoEnd) {
      cue.end = durationSeconds;
      continue;
    }
    const next = cues[index + 1];
    const maxEndByNext = next ? Math.max(cue.start + 0.2, next.start - 0.05) : durationSeconds;
    cue.end = Math.min(cue.end, maxEndByNext, durationSeconds);
  }
  return prioritizePersistentSupersCues(cues);
}

async function resolveSupersCueTimings(
  supers: SupersConfig,
  rules: SupersTriggerRule[],
  script: string,
  rawVideoPath: string,
  jobDir: string
): Promise<{ cues: TimedSuperCue[]; modeUsed: SupersConfig["timingMode"] }> {
  const durationSeconds = await getVideoDurationSeconds(rawVideoPath, jobDir);
  if (supers.timingMode === "accurate") {
    try {
      const timedWords = await transcribeWordTimestampsWithWhisper(rawVideoPath, jobDir);
      const accurateCues = resolveAccurateCueTimings(rules, timedWords, durationSeconds);
      if (accurateCues.length > 0) {
        return { cues: accurateCues, modeUsed: "accurate" };
      }
      console.warn("[pipeline] accurate supers mode found no matches, falling back to fast mode.");
    } catch (error) {
      if (isWhisperMissingError(error)) {
        console.warn("[pipeline] whisper CLI not found; falling back to fast supers timing.");
      } else {
        console.warn("[pipeline] accurate supers timing failed; falling back to fast mode.", error);
      }
    }
  }

  return {
    cues: resolveFastCueTimings(rules, script, durationSeconds),
    modeUsed: "fast"
  };
}

type CtaTimingMode = "accurate" | "fast" | "fallback";

interface InlineCtaTiming {
  phrase: string;
  startSeconds: number;
  modeUsed: CtaTimingMode;
}

const AIR_PLUS_INLINE_CTA_TRIGGER_PHRASE = "apply now";

function extractInlineCtaPhrase(script: string): string | undefined {
  const normalizedScript = normalizeComparableText(script);
  return normalizedScript.includes(AIR_PLUS_INLINE_CTA_TRIGGER_PHRASE) ? AIR_PLUS_INLINE_CTA_TRIGGER_PHRASE : undefined;
}

function shouldUseInlineAirPlusCtaOverlay(product: ProductKey, script: string): boolean {
  return (
    product === "kotak_air_plus" &&
    Boolean(END_SLATE_AIR_PLUS_INLINE_CTA_CARD_PATH) &&
    Boolean(END_SLATE_AIR_PLUS_INLINE_CTA_BUTTON_PATH) &&
    Boolean(extractInlineCtaPhrase(script))
  );
}

async function resolveInlineCtaTiming(script: string, videoPath: string, jobDir: string): Promise<InlineCtaTiming | undefined> {
  const phrase = extractInlineCtaPhrase(script);
  if (!phrase) {
    return undefined;
  }

  const durationSeconds = await getVideoDurationSeconds(videoPath, jobDir);
  const phraseTokens = tokenizeScriptWords(phrase);
  if (phraseTokens.length === 0) {
    return undefined;
  }

  try {
    const timedWords = await transcribeWordTimestampsWithWhisper(videoPath, jobDir);
    const tokens = timedWords.map((word) => word.token);
    const index = findTriggerStartIndex(tokens, phraseTokens, 0);
    if (index >= 0) {
      return {
        phrase,
        startSeconds: clampNumber(timedWords[index]!.start, 0, Math.max(0.05, durationSeconds - 0.05)),
        modeUsed: "accurate"
      };
    }
  } catch (error) {
    if (isWhisperMissingError(error)) {
      console.warn("[pipeline] whisper CLI not found; falling back to fast CTA timing.");
    } else {
      console.warn("[pipeline] accurate CTA timing failed; falling back to fast mode.", error);
    }
  }

  const scriptTokens = tokenizeScriptWords(script);
  const tokenIndex = findTriggerStartIndex(scriptTokens, phraseTokens, 0);
  if (tokenIndex >= 0 && scriptTokens.length > 0) {
    return {
      phrase,
      startSeconds: clampNumber((tokenIndex / scriptTokens.length) * durationSeconds, 0, Math.max(0.05, durationSeconds - 0.05)),
      modeUsed: "fast"
    };
  }

  return {
    phrase,
    startSeconds: clampNumber(
      durationSeconds - Math.max(AIR_PLUS_INLINE_CTA_MIN_PANEL_SECONDS, AIR_PLUS_INLINE_CTA_FALLBACK_TAIL_SECONDS),
      0,
      Math.max(0.05, durationSeconds - 0.05)
    ),
    modeUsed: "fallback"
  };
}

interface HighlightSegment {
  text: string;
  startIndex: number;
}

const supersTextAdvanceCache = new Map<string, number>();

function getSupersHighlightSegments(line: string): HighlightSegment[] {
  const pattern =
    /\bzero\b|₹\s*\d[\d,]*(?:\.\d+)?(?:\s*[kKlL]|\s*lakh)?|rs\.?\s*\d[\d,]*(?:\.\d+)?(?:\s*[kKlL]|\s*lakh)?|\d+(?:\.\d+)?%?/gi;
  const segments: HighlightSegment[] = [];

  for (const match of line.matchAll(pattern)) {
    const matched = match[0] ?? "";
    const rawIndex = match.index ?? 0;
    const leadingSpaces = matched.match(/^\s*/)?.[0].length ?? 0;
    let token = matched.trim();
    let startIndex = rawIndex + leadingSpaces;
    if (/^rs\.?/i.test(token)) {
      const digitIndex = token.search(/\d/);
      if (digitIndex >= 0) {
        startIndex += digitIndex;
        token = token.slice(digitIndex).trim();
      }
    }
    if (!token) {
      continue;
    }
    segments.push({
      text: token,
      startIndex
    });
  }

  return segments;
}

async function measureDrawtextTextAdvance(
  text: string,
  fontFile: string | undefined,
  fontSize: number,
  jobDir: string
): Promise<number> {
  if (!text) {
    return 0;
  }

  const cacheKey = `${fontFile ?? "default"}|${fontSize}|${text}`;
  const cached = supersTextAdvanceCache.get(cacheKey);
  if (typeof cached === "number") {
    return cached;
  }

  const sentinel = "H";
  const sentinelKey = `${fontFile ?? "default"}|${fontSize}|${sentinel}`;
  let sentinelWidth = supersTextAdvanceCache.get(sentinelKey);
  if (typeof sentinelWidth !== "number") {
    sentinelWidth = await measureDrawtextBoundingWidth(sentinel, fontFile, fontSize, jobDir);
    supersTextAdvanceCache.set(sentinelKey, sentinelWidth);
  }

  const combinedWidth = await measureDrawtextBoundingWidth(`${text}${sentinel}`, fontFile, fontSize, jobDir);
  const advance = Math.max(0, combinedWidth - sentinelWidth);
  supersTextAdvanceCache.set(cacheKey, advance);
  return advance;
}

async function measureDrawtextPrefixOffset(
  text: string,
  fontFile: string | undefined,
  fontSize: number,
  jobDir: string
): Promise<number> {
  if (!text) {
    return 0;
  }

  const cacheKey = `prefix|${fontFile ?? "default"}|${fontSize}|${text}`;
  const cached = supersTextAdvanceCache.get(cacheKey);
  if (typeof cached === "number") {
    return cached;
  }

  let width: number;
  if (/\s$/.test(text)) {
    width = await measureDrawtextTextAdvance(text, fontFile, fontSize, jobDir);
  } else {
    width = await measureDrawtextBoundingWidth(text, fontFile, fontSize, jobDir);
  }

  supersTextAdvanceCache.set(cacheKey, width);
  return width;
}

async function measureDrawtextBoundingWidth(
  text: string,
  fontFile: string | undefined,
  fontSize: number,
  jobDir: string
): Promise<number> {
  const cacheKey = `bbox|${fontFile ?? "default"}|${fontSize}|${text}`;
  const cached = supersTextAdvanceCache.get(cacheKey);
  if (typeof cached === "number") {
    return cached;
  }

  const fontConfig = fontFile ? `fontfile='${escapeDrawtext(fontFile)}':` : "";
  const filterGraph = [
    "color=c=black@0.0:s=2400x240:d=0.04",
    "format=rgba",
    [
      "drawtext=",
      fontConfig,
      "expansion=none:",
      `text='${escapeDrawtext(text)}':`,
      "fontcolor=white:",
      `fontsize=${fontSize}:`,
      "x=10:",
      "y=100"
    ].join(""),
    "bbox"
  ].join(",");
  const { stderr } = await runCommandWithOutput(
    FFMPEG_BIN,
    ["-v", "info", "-f", "lavfi", "-i", filterGraph, "-frames:v", "1", "-f", "null", "-"],
    jobDir
  );
  const match = stderr.match(/(?:\bw:(\d+)\b.*\bh:(\d+)\b.*\bcrop=\d+:\d+:\d+:\d+)|(?:\bcrop=(\d+):(\d+):\d+:\d+)/);
  const width = Number(match?.[1] ?? match?.[3] ?? 0);
  supersTextAdvanceCache.set(cacheKey, width);
  return width;
}

async function resolveSupersFontSizeToFit(params: {
  text: string;
  fontFile?: string;
  initialFontSize: number;
  maxTextWidthPx?: number;
  minFontSize?: number;
  safetyMarginPx?: number;
  jobDir: string;
}): Promise<number> {
  const { text, fontFile, initialFontSize, maxTextWidthPx, minFontSize = 28, safetyMarginPx = 24, jobDir } = params;
  if (!text || !maxTextWidthPx || maxTextWidthPx <= 0) {
    return initialFontSize;
  }

  let resolvedFontSize = initialFontSize;
  while (resolvedFontSize > minFontSize) {
    const bboxWidth = await measureDrawtextBoundingWidth(text, fontFile, resolvedFontSize, jobDir);
    const advanceWidth = await measureDrawtextTextAdvance(text, fontFile, resolvedFontSize, jobDir);
    const measuredWidth = Math.max(bboxWidth, advanceWidth) + safetyMarginPx;
    if (measuredWidth <= maxTextWidthPx) {
      return resolvedFontSize;
    }
    resolvedFontSize -= 2;
  }

  return Math.max(minFontSize, resolvedFontSize);
}

async function buildSingleLineSupersCueFilters(params: {
  cue: TimedSuperCue;
  fontFile?: string;
  fontConfig: string;
  fontSize: number;
  maxTextWidthPx?: number;
  textXExpr: string;
  textYExpr: string;
  baseColor: string;
  highlightColor: string;
  boxColor: string;
  boxBorderW: number;
  alphaExpr: string;
  enableExpr: string;
  jobDir: string;
}): Promise<string[]> {
  const {
    cue,
    fontFile,
    fontConfig,
    fontSize,
    maxTextWidthPx,
    textXExpr,
    textYExpr,
    baseColor,
    highlightColor,
    boxColor,
    boxBorderW,
    alphaExpr,
    enableExpr,
    jobDir
  } = params;
  const singleLineText = clampSupersTextLength(cue.text).replace(/\s+/g, " ").trim();
  if (!singleLineText) {
    return [];
  }
  const fittedFontSize = await resolveSupersFontSizeToFit({
    text: singleLineText,
    fontFile,
    initialFontSize: fontSize,
    maxTextWidthPx,
    jobDir
  });

  const baseBoxFilter = [
    "drawtext=",
    `${fontConfig}`,
    "expansion=none:",
    "fix_bounds=1:",
    `text='${escapeDrawtext(singleLineText)}':`,
    "fontcolor=white@0.0:",
    `fontsize=${fittedFontSize}:`,
    "line_spacing=0:",
    "box=1:",
    `boxcolor=${boxColor}:`,
    `boxborderw=${boxBorderW}:`,
    `x='${textXExpr}':`,
    `y='${textYExpr}':`,
    `alpha='${alphaExpr}':`,
    `enable='${enableExpr}'`
  ].join("");

  const baseTextFilter = [
    "drawtext=",
    `${fontConfig}`,
    "expansion=none:",
    "fix_bounds=1:",
    `text='${escapeDrawtext(singleLineText)}':`,
    `fontcolor=${baseColor}:`,
    `fontsize=${fittedFontSize}:`,
    "line_spacing=0:",
    "box=0:",
    `x='${textXExpr}':`,
    `y='${textYExpr}':`,
    `alpha='${alphaExpr}':`,
    `enable='${enableExpr}'`
  ].join("");

  if (highlightColor === baseColor) {
    return [baseBoxFilter, baseTextFilter];
  }

  const highlightSegments = getSupersHighlightSegments(singleLineText);
  const highlightFilters: string[] = [];

  for (const segment of highlightSegments) {
    if (!segment.text) {
      continue;
    }

    const prefix = singleLineText.slice(0, segment.startIndex);
    const offsetPx = await measureDrawtextPrefixOffset(prefix, fontFile, fittedFontSize, jobDir);
    const tokenWidthPx = await measureDrawtextBoundingWidth(segment.text, fontFile, fittedFontSize, jobDir);
    const erasePaddingPx = Math.max(4, Math.round(fittedFontSize * 0.1));
    const eraseTopOffsetPx = Math.round(fittedFontSize * 0.9);
    const eraseHeightPx = Math.round(fittedFontSize * 1.3);
    const tokenXExpr = `(${textXExpr})+${offsetPx.toFixed(2)}`;

    highlightFilters.push(
      [
        "drawbox=",
        `x='${tokenXExpr}-${erasePaddingPx}':`,
        `y='(${textYExpr})-${eraseTopOffsetPx}':`,
        `w=${tokenWidthPx + erasePaddingPx * 2}:`,
        `h=${eraseHeightPx}:`,
        "color=white@1.0:",
        "t=fill:",
        `enable='${enableExpr}'`
      ].join("")
    );
    highlightFilters.push(
      [
        "drawtext=",
        `${fontConfig}`,
        "expansion=none:",
        "fix_bounds=1:",
        `text='${escapeDrawtext(segment.text)}':`,
        `fontcolor=${highlightColor}:`,
        `fontsize=${fittedFontSize}:`,
        "line_spacing=0:",
        "box=0:",
        `x='${tokenXExpr}':`,
        `y='${textYExpr}':`,
        `alpha='${alphaExpr}':`,
        `enable='${enableExpr}'`
      ].join("")
    );
  }

  return [baseBoxFilter, baseTextFilter, ...highlightFilters];
}

async function buildAirPlusComplimentaryFlightChipFilters(params: {
  cue: TimedSuperCue;
  frameWidth: number;
  frameHeight: number;
  jobDir: string;
}): Promise<string[]> {
  const { cue, frameWidth, frameHeight, jobDir } = params;
  const fontFile = AIR_PLUS_COMPLIMENTARY_FLIGHT_STACK_FONT_FILE;
  const fontConfig = fontFile ? `fontfile='${escapeDrawtext(fontFile)}':` : "";
  const wordFree = "FREE";
  const wordFlight = "FLIGHT";
  const stackCount = AIR_PLUS_COMPLIMENTARY_FLIGHT_STACK_COUNT;
  const maxTextWidth = Math.max(420, Math.round(frameWidth * 0.8));
  const initialFontSize = clampNumber(Math.round(frameWidth * 0.158), 110, 178);
  const freeFontSize = await resolveSupersFontSizeToFit({
    text: wordFree,
    fontFile,
    initialFontSize,
    maxTextWidthPx: maxTextWidth,
    minFontSize: 104,
    jobDir
  });
  const flightFontSize = await resolveSupersFontSizeToFit({
    text: wordFlight,
    fontFile,
    initialFontSize,
    maxTextWidthPx: maxTextWidth,
    minFontSize: 104,
    jobDir
  });
  const textFontSize = Math.min(freeFontSize, flightFontSize);
  const freeTextWidth = await measureDrawtextBoundingWidth(wordFree, fontFile, textFontSize, jobDir);
  const flightTextWidth = await measureDrawtextBoundingWidth(wordFlight, fontFile, textFontSize, jobDir);
  const start = cue.start.toFixed(2);
  const end = cue.end.toFixed(2);
  const inDur = SUPERS_ANIM_IN_SECONDS.toFixed(2);
  const enableExpr = `between(t,${start},${end})`;
  const alphaExpr = `if(lt(t,${start}+${inDur}), (t-${start})/${inDur}, 1)`;
  const lineStep = Math.round(textFontSize * 1.18);
  const totalLineCount = stackCount * 2;
  const blockHeight = textFontSize + lineStep * (totalLineCount - 1);
  const startY = Math.round((frameHeight - blockHeight) / 2);
  const freeX = ((frameWidth - freeTextWidth) / 2).toFixed(2);
  const flightX = ((frameWidth - flightTextWidth) / 2).toFixed(2);
  const filters: string[] = [];

  for (let i = 0; i < stackCount; i += 1) {
    const freeY = startY + i * lineStep * 2;
    const flightY = freeY + lineStep;
    filters.push(
      [
        "drawtext=",
        `${fontConfig}`,
        "expansion=none:",
        "fix_bounds=1:",
        `text='${wordFree}':`,
        `fontcolor=white@${AIR_PLUS_COMPLIMENTARY_FLIGHT_TEXT_ALPHA}:`,
        `fontsize=${textFontSize}:`,
        "line_spacing=0:",
        `x='${freeX}':`,
        `y='${freeY}':`,
        `alpha='${alphaExpr}':`,
        `enable='${enableExpr}'`
      ].join("")
    );
    filters.push(
      [
        "drawtext=",
        `${fontConfig}`,
        "expansion=none:",
        "fix_bounds=1:",
        `text='${wordFlight}':`,
        `fontcolor=white@${AIR_PLUS_COMPLIMENTARY_FLIGHT_TEXT_ALPHA}:`,
        `fontsize=${textFontSize}:`,
        "line_spacing=0:",
        `x='${flightX}':`,
        `y='${flightY}':`,
        `alpha='${alphaExpr}':`,
        `enable='${enableExpr}'`
      ].join("")
    );
  }

  return filters;
}

async function buildAirPlusForexChipFilters(params: {
  cue: TimedSuperCue;
  frameWidth: number;
  jobDir: string;
}): Promise<string[]> {
  const { cue, frameWidth, jobDir } = params;
  const fontFile = AIR_PLUS_COMPLIMENTARY_FLIGHT_CHIP_FONT_FILE;
  const fontConfig = fontFile ? `fontfile='${escapeDrawtext(fontFile)}':` : "";
  const chipWidth = frameWidth;
  const chipHeight = clampNumber(Math.round(frameWidth * 0.24), 240, 300);
  const bottomMargin = AIR_PLUS_COMPLIMENTARY_FLIGHT_BAND_BOTTOM_MARGIN_PX;
  const dividerWidth = 3;
  const sectionInset = Math.round(chipWidth * 0.07);
  const sectionWidth = (chipWidth - dividerWidth) / 2;
  const maxSectionTextWidth = Math.max(220, Math.round(sectionWidth - sectionInset * 2));
  const initialFontSize = clampNumber(Math.round(chipHeight * 0.2), 46, 66);
  const leftFontSize = await resolveSupersFontSizeToFit({
    text: AIR_PLUS_FOREX_CHIP_LEFT_LINE_1,
    fontFile,
    initialFontSize,
    maxTextWidthPx: maxSectionTextWidth,
    minFontSize: 34,
    jobDir
  });
  const leftLine2FontSize = await resolveSupersFontSizeToFit({
    text: AIR_PLUS_FOREX_CHIP_LEFT_LINE_2,
    fontFile,
    initialFontSize,
    maxTextWidthPx: maxSectionTextWidth,
    minFontSize: 34,
    jobDir
  });
  const rightFontSize = await resolveSupersFontSizeToFit({
    text: AIR_PLUS_FOREX_CHIP_RIGHT_LINE_1,
    fontFile,
    initialFontSize,
    maxTextWidthPx: maxSectionTextWidth,
    minFontSize: 34,
    jobDir
  });
  const rightLine2FontSize = await resolveSupersFontSizeToFit({
    text: AIR_PLUS_FOREX_CHIP_RIGHT_LINE_2,
    fontFile,
    initialFontSize,
    maxTextWidthPx: maxSectionTextWidth,
    minFontSize: 34,
    jobDir
  });
  const textFontSize = Math.min(leftFontSize, leftLine2FontSize, rightFontSize, rightLine2FontSize);
  const leftTextWidthLine1 = await measureDrawtextBoundingWidth(
    AIR_PLUS_FOREX_CHIP_LEFT_LINE_1,
    fontFile,
    textFontSize,
    jobDir
  );
  const leftTextWidthLine2 = await measureDrawtextBoundingWidth(
    AIR_PLUS_FOREX_CHIP_LEFT_LINE_2,
    fontFile,
    textFontSize,
    jobDir
  );
  const rightTextWidthLine1 = await measureDrawtextBoundingWidth(
    AIR_PLUS_FOREX_CHIP_RIGHT_LINE_1,
    fontFile,
    textFontSize,
    jobDir
  );
  const rightTextWidthLine2 = await measureDrawtextBoundingWidth(
    AIR_PLUS_FOREX_CHIP_RIGHT_LINE_2,
    fontFile,
    textFontSize,
    jobDir
  );
  const start = cue.start.toFixed(2);
  const end = cue.end.toFixed(2);
  const inDur = SUPERS_ANIM_IN_SECONDS.toFixed(2);
  const enableExpr = `between(t,${start},${end})`;
  const alphaExpr = `if(lt(t,${start}+${inDur}), (t-${start})/${inDur}, 1)`;
  const chipXExpr = "0";
  const chipYExpr = `h-${chipHeight + bottomMargin}`;
  const dividerXExpr = `(${chipXExpr})+${Math.round(chipWidth / 2) - Math.round(dividerWidth / 2)}`;
  const dividerYExpr = `(${chipYExpr})+${Math.round(chipHeight * 0.18)}`;
  const dividerHeight = chipHeight - Math.round(chipHeight * 0.36);
  const lineGap = Math.round(textFontSize * 1.265);
  const textBlockHeight = lineGap * 2;
  const textStartYExpr = `(${chipYExpr})+${Math.round((chipHeight - textBlockHeight) / 2) - 4}`;
  const leftTextXExprLine1 = `(${chipXExpr})+${(sectionWidth / 2 - leftTextWidthLine1 / 2).toFixed(2)}`;
  const leftTextXExprLine2 = `(${chipXExpr})+${(sectionWidth / 2 - leftTextWidthLine2 / 2).toFixed(2)}`;
  const rightTextXExprLine1 = `(${chipXExpr})+${(sectionWidth + dividerWidth + sectionWidth / 2 - rightTextWidthLine1 / 2).toFixed(2)}`;
  const rightTextXExprLine2 = `(${chipXExpr})+${(sectionWidth + dividerWidth + sectionWidth / 2 - rightTextWidthLine2 / 2).toFixed(2)}`;

  return [
    [
      "drawbox=",
      `x='${chipXExpr}':`,
      `y='${chipYExpr}':`,
      `w=${chipWidth}:`,
      `h=${chipHeight}:`,
      "color=0xE53337@1.0:",
      "t=fill:",
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawbox=",
      `x='${chipXExpr}':`,
      `y='${chipYExpr}':`,
      `w=${chipWidth}:`,
      "h=2:",
      "color=white@0.58:",
      "t=fill:",
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawbox=",
      `x='${chipXExpr}':`,
      `y='(${chipYExpr})+${chipHeight - 2}':`,
      `w=${chipWidth}:`,
      "h=2:",
      "color=white@0.58:",
      "t=fill:",
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawbox=",
      `x='${dividerXExpr}':`,
      `y='${dividerYExpr}':`,
      `w=${dividerWidth}:`,
      `h=${dividerHeight}:`,
      "color=white@0.62:",
      "t=fill:",
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawtext=",
      `${fontConfig}`,
      "expansion=none:",
      "fix_bounds=1:",
      `text='${escapeDrawtext(AIR_PLUS_FOREX_CHIP_LEFT_LINE_1)}':`,
      "fontcolor=white:",
      `fontsize=${textFontSize}:`,
      "line_spacing=0:",
      `x='${leftTextXExprLine1}':`,
      `y='${textStartYExpr}':`,
      `alpha='${alphaExpr}':`,
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawtext=",
      `${fontConfig}`,
      "expansion=none:",
      "fix_bounds=1:",
      `text='${escapeDrawtext(AIR_PLUS_FOREX_CHIP_LEFT_LINE_2)}':`,
      "fontcolor=white:",
      `fontsize=${textFontSize}:`,
      "line_spacing=0:",
      `x='${leftTextXExprLine2}':`,
      `y='(${textStartYExpr})+${lineGap}':`,
      `alpha='${alphaExpr}':`,
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawtext=",
      `${fontConfig}`,
      "expansion=none:",
      "fix_bounds=1:",
      `text='${escapeDrawtext(AIR_PLUS_FOREX_CHIP_RIGHT_LINE_1)}':`,
      "fontcolor=white:",
      `fontsize=${textFontSize}:`,
      "line_spacing=0:",
      `x='${rightTextXExprLine1}':`,
      `y='${textStartYExpr}':`,
      `alpha='${alphaExpr}':`,
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawtext=",
      `${fontConfig}`,
      "expansion=none:",
      "fix_bounds=1:",
      `text='${escapeDrawtext(AIR_PLUS_FOREX_CHIP_RIGHT_LINE_2)}':`,
      "fontcolor=white:",
      `fontsize=${textFontSize}:`,
      "line_spacing=0:",
      `x='${rightTextXExprLine2}':`,
      `y='(${textStartYExpr})+${lineGap}':`,
      `alpha='${alphaExpr}':`,
      `enable='${enableExpr}'`
    ].join("")
  ];
}

async function buildAirPlusTravelEarnChipFilters(params: {
  cue: TimedSuperCue;
  frameWidth: number;
  jobDir: string;
}): Promise<string[]> {
  const { cue, frameWidth, jobDir } = params;
  const fontFile = AIR_PLUS_COMPLIMENTARY_FLIGHT_CHIP_FONT_FILE;
  const fontConfig = fontFile ? `fontfile='${escapeDrawtext(fontFile)}':` : "";
  const chipWidth = frameWidth;
  const chipHeight = clampNumber(Math.round(frameWidth * 0.24), 240, 300);
  const bottomMargin = AIR_PLUS_COMPLIMENTARY_FLIGHT_BAND_BOTTOM_MARGIN_PX;
  const dividerWidth = 3;
  const sectionInset = Math.round(chipWidth * 0.07);
  const sectionWidth = (chipWidth - dividerWidth) / 2;
  const maxSectionTextWidth = Math.max(220, Math.round(sectionWidth - sectionInset * 2));
  const initialFontSize = clampNumber(Math.round(chipHeight * 0.2), 46, 66);
  const leftFontSize = await resolveSupersFontSizeToFit({
    text: AIR_PLUS_TRAVEL_EARN_CHIP_LEFT_LINE_1,
    fontFile,
    initialFontSize,
    maxTextWidthPx: maxSectionTextWidth,
    minFontSize: 34,
    jobDir
  });
  const leftLine2FontSize = await resolveSupersFontSizeToFit({
    text: AIR_PLUS_TRAVEL_EARN_CHIP_LEFT_LINE_2,
    fontFile,
    initialFontSize,
    maxTextWidthPx: maxSectionTextWidth,
    minFontSize: 34,
    jobDir
  });
  const rightFontSize = await resolveSupersFontSizeToFit({
    text: AIR_PLUS_TRAVEL_EARN_CHIP_RIGHT_LINE_1,
    fontFile,
    initialFontSize,
    maxTextWidthPx: maxSectionTextWidth,
    minFontSize: 34,
    jobDir
  });
  const rightLine2FontSize = await resolveSupersFontSizeToFit({
    text: AIR_PLUS_TRAVEL_EARN_CHIP_RIGHT_LINE_2,
    fontFile,
    initialFontSize,
    maxTextWidthPx: maxSectionTextWidth,
    minFontSize: 34,
    jobDir
  });
  const textFontSize = Math.min(leftFontSize, leftLine2FontSize, rightFontSize, rightLine2FontSize);
  const leftTextWidthLine1 = await measureDrawtextBoundingWidth(
    AIR_PLUS_TRAVEL_EARN_CHIP_LEFT_LINE_1,
    fontFile,
    textFontSize,
    jobDir
  );
  const leftTextWidthLine2 = await measureDrawtextBoundingWidth(
    AIR_PLUS_TRAVEL_EARN_CHIP_LEFT_LINE_2,
    fontFile,
    textFontSize,
    jobDir
  );
  const rightTextWidthLine1 = await measureDrawtextBoundingWidth(
    AIR_PLUS_TRAVEL_EARN_CHIP_RIGHT_LINE_1,
    fontFile,
    textFontSize,
    jobDir
  );
  const rightTextWidthLine2 = await measureDrawtextBoundingWidth(
    AIR_PLUS_TRAVEL_EARN_CHIP_RIGHT_LINE_2,
    fontFile,
    textFontSize,
    jobDir
  );
  const start = cue.start.toFixed(2);
  const end = cue.end.toFixed(2);
  const inDur = SUPERS_ANIM_IN_SECONDS.toFixed(2);
  const enableExpr = `between(t,${start},${end})`;
  const alphaExpr = `if(lt(t,${start}+${inDur}), (t-${start})/${inDur}, 1)`;
  const chipXExpr = "0";
  const chipYExpr = `h-${chipHeight + bottomMargin}`;
  const dividerXExpr = `(${chipXExpr})+${Math.round(chipWidth / 2) - Math.round(dividerWidth / 2)}`;
  const dividerYExpr = `(${chipYExpr})+${Math.round(chipHeight * 0.18)}`;
  const dividerHeight = chipHeight - Math.round(chipHeight * 0.36);
  const lineGap = Math.round(textFontSize * 1.265);
  const textBlockHeight = lineGap * 2;
  const textStartYExpr = `(${chipYExpr})+${Math.round((chipHeight - textBlockHeight) / 2) - 4}`;
  const leftTextXExprLine1 = `(${chipXExpr})+${(sectionWidth / 2 - leftTextWidthLine1 / 2).toFixed(2)}`;
  const leftTextXExprLine2 = `(${chipXExpr})+${(sectionWidth / 2 - leftTextWidthLine2 / 2).toFixed(2)}`;
  const rightTextXExprLine1 = `(${chipXExpr})+${(sectionWidth + dividerWidth + sectionWidth / 2 - rightTextWidthLine1 / 2).toFixed(2)}`;
  const rightTextXExprLine2 = `(${chipXExpr})+${(sectionWidth + dividerWidth + sectionWidth / 2 - rightTextWidthLine2 / 2).toFixed(2)}`;

  return [
    [
      "drawbox=",
      `x='${chipXExpr}':`,
      `y='${chipYExpr}':`,
      `w=${chipWidth}:`,
      `h=${chipHeight}:`,
      "color=0xE53337@1.0:",
      "t=fill:",
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawbox=",
      `x='${chipXExpr}':`,
      `y='${chipYExpr}':`,
      `w=${chipWidth}:`,
      "h=2:",
      "color=white@0.58:",
      "t=fill:",
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawbox=",
      `x='${chipXExpr}':`,
      `y='(${chipYExpr})+${chipHeight - 2}':`,
      `w=${chipWidth}:`,
      "h=2:",
      "color=white@0.58:",
      "t=fill:",
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawbox=",
      `x='${dividerXExpr}':`,
      `y='${dividerYExpr}':`,
      `w=${dividerWidth}:`,
      `h=${dividerHeight}:`,
      "color=white@0.62:",
      "t=fill:",
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawtext=",
      `${fontConfig}`,
      "expansion=none:",
      "fix_bounds=1:",
      `text='${escapeDrawtext(AIR_PLUS_TRAVEL_EARN_CHIP_LEFT_LINE_1)}':`,
      "fontcolor=white:",
      `fontsize=${textFontSize}:`,
      "line_spacing=0:",
      `x='${leftTextXExprLine1}':`,
      `y='${textStartYExpr}':`,
      `alpha='${alphaExpr}':`,
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawtext=",
      `${fontConfig}`,
      "expansion=none:",
      "fix_bounds=1:",
      `text='${escapeDrawtext(AIR_PLUS_TRAVEL_EARN_CHIP_LEFT_LINE_2)}':`,
      "fontcolor=white:",
      `fontsize=${textFontSize}:`,
      "line_spacing=0:",
      `x='${leftTextXExprLine2}':`,
      `y='(${textStartYExpr})+${lineGap}':`,
      `alpha='${alphaExpr}':`,
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawtext=",
      `${fontConfig}`,
      "expansion=none:",
      "fix_bounds=1:",
      `text='${escapeDrawtext(AIR_PLUS_TRAVEL_EARN_CHIP_RIGHT_LINE_1)}':`,
      "fontcolor=white:",
      `fontsize=${textFontSize}:`,
      "line_spacing=0:",
      `x='${rightTextXExprLine1}':`,
      `y='${textStartYExpr}':`,
      `alpha='${alphaExpr}':`,
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawtext=",
      `${fontConfig}`,
      "expansion=none:",
      "fix_bounds=1:",
      `text='${escapeDrawtext(AIR_PLUS_TRAVEL_EARN_CHIP_RIGHT_LINE_2)}':`,
      "fontcolor=white:",
      `fontsize=${textFontSize}:`,
      "line_spacing=0:",
      `x='${rightTextXExprLine2}':`,
      `y='(${textStartYExpr})+${lineGap}':`,
      `alpha='${alphaExpr}':`,
      `enable='${enableExpr}'`
    ].join("")
  ];
}

async function buildAirPlusTravelPrivilegesChipFilters(params: {
  cue: TimedSuperCue;
  frameWidth: number;
  jobDir: string;
}): Promise<string[]> {
  const { cue, frameWidth, jobDir } = params;
  const fontFile = AIR_PLUS_COMPLIMENTARY_FLIGHT_CHIP_FONT_FILE;
  const fontConfig = fontFile ? `fontfile='${escapeDrawtext(fontFile)}':` : "";
  const chipWidth = frameWidth;
  const chipHeight = clampNumber(Math.round(frameWidth * 0.24), 240, 300);
  const bottomMargin = AIR_PLUS_COMPLIMENTARY_FLIGHT_BAND_BOTTOM_MARGIN_PX;
  const dividerWidth = 3;
  const sectionInset = Math.round(chipWidth * 0.07);
  const sectionWidth = (chipWidth - dividerWidth) / 2;
  const maxSectionTextWidth = Math.max(220, Math.round(sectionWidth - sectionInset * 2));
  const initialFontSize = clampNumber(Math.round(chipHeight * 0.2), 46, 66);
  const leftFontSize = await resolveSupersFontSizeToFit({
    text: AIR_PLUS_TRAVEL_PRIVILEGES_CHIP_LEFT_LINE_1,
    fontFile,
    initialFontSize,
    maxTextWidthPx: maxSectionTextWidth,
    minFontSize: 34,
    jobDir
  });
  const leftLine2FontSize = await resolveSupersFontSizeToFit({
    text: AIR_PLUS_TRAVEL_PRIVILEGES_CHIP_LEFT_LINE_2,
    fontFile,
    initialFontSize,
    maxTextWidthPx: maxSectionTextWidth,
    minFontSize: 34,
    jobDir
  });
  const rightFontSize = await resolveSupersFontSizeToFit({
    text: AIR_PLUS_TRAVEL_PRIVILEGES_CHIP_RIGHT_LINE_1,
    fontFile,
    initialFontSize,
    maxTextWidthPx: maxSectionTextWidth,
    minFontSize: 34,
    jobDir
  });
  const rightLine2FontSize = await resolveSupersFontSizeToFit({
    text: AIR_PLUS_TRAVEL_PRIVILEGES_CHIP_RIGHT_LINE_2,
    fontFile,
    initialFontSize,
    maxTextWidthPx: maxSectionTextWidth,
    minFontSize: 34,
    jobDir
  });
  const textFontSize = Math.min(leftFontSize, leftLine2FontSize, rightFontSize, rightLine2FontSize);
  const leftTextWidthLine1 = await measureDrawtextBoundingWidth(
    AIR_PLUS_TRAVEL_PRIVILEGES_CHIP_LEFT_LINE_1,
    fontFile,
    textFontSize,
    jobDir
  );
  const leftTextWidthLine2 = await measureDrawtextBoundingWidth(
    AIR_PLUS_TRAVEL_PRIVILEGES_CHIP_LEFT_LINE_2,
    fontFile,
    textFontSize,
    jobDir
  );
  const rightTextWidthLine1 = await measureDrawtextBoundingWidth(
    AIR_PLUS_TRAVEL_PRIVILEGES_CHIP_RIGHT_LINE_1,
    fontFile,
    textFontSize,
    jobDir
  );
  const rightTextWidthLine2 = await measureDrawtextBoundingWidth(
    AIR_PLUS_TRAVEL_PRIVILEGES_CHIP_RIGHT_LINE_2,
    fontFile,
    textFontSize,
    jobDir
  );
  const start = cue.start.toFixed(2);
  const end = cue.end.toFixed(2);
  const inDur = SUPERS_ANIM_IN_SECONDS.toFixed(2);
  const enableExpr = `between(t,${start},${end})`;
  const alphaExpr = `if(lt(t,${start}+${inDur}), (t-${start})/${inDur}, 1)`;
  const chipXExpr = "0";
  const chipYExpr = `h-${chipHeight + bottomMargin}`;
  const dividerXExpr = `(${chipXExpr})+${Math.round(chipWidth / 2) - Math.round(dividerWidth / 2)}`;
  const dividerYExpr = `(${chipYExpr})+${Math.round(chipHeight * 0.18)}`;
  const dividerHeight = chipHeight - Math.round(chipHeight * 0.36);
  const lineGap = Math.round(textFontSize * 1.265);
  const textBlockHeight = lineGap * 2;
  const textStartYExpr = `(${chipYExpr})+${Math.round((chipHeight - textBlockHeight) / 2) - 4}`;
  const leftTextXExprLine1 = `(${chipXExpr})+${(sectionWidth / 2 - leftTextWidthLine1 / 2).toFixed(2)}`;
  const leftTextXExprLine2 = `(${chipXExpr})+${(sectionWidth / 2 - leftTextWidthLine2 / 2).toFixed(2)}`;
  const rightTextXExprLine1 = `(${chipXExpr})+${(sectionWidth + dividerWidth + sectionWidth / 2 - rightTextWidthLine1 / 2).toFixed(2)}`;
  const rightTextXExprLine2 = `(${chipXExpr})+${(sectionWidth + dividerWidth + sectionWidth / 2 - rightTextWidthLine2 / 2).toFixed(2)}`;

  return [
    [
      "drawbox=",
      `x='${chipXExpr}':`,
      `y='${chipYExpr}':`,
      `w=${chipWidth}:`,
      `h=${chipHeight}:`,
      "color=0xE53337@1.0:",
      "t=fill:",
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawbox=",
      `x='${chipXExpr}':`,
      `y='${chipYExpr}':`,
      `w=${chipWidth}:`,
      "h=2:",
      "color=white@0.58:",
      "t=fill:",
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawbox=",
      `x='${chipXExpr}':`,
      `y='(${chipYExpr})+${chipHeight - 2}':`,
      `w=${chipWidth}:`,
      "h=2:",
      "color=white@0.58:",
      "t=fill:",
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawbox=",
      `x='${dividerXExpr}':`,
      `y='${dividerYExpr}':`,
      `w=${dividerWidth}:`,
      `h=${dividerHeight}:`,
      "color=white@0.62:",
      "t=fill:",
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawtext=",
      `${fontConfig}`,
      "expansion=none:",
      "fix_bounds=1:",
      `text='${escapeDrawtext(AIR_PLUS_TRAVEL_PRIVILEGES_CHIP_LEFT_LINE_1)}':`,
      "fontcolor=white:",
      `fontsize=${textFontSize}:`,
      "line_spacing=0:",
      `x='${leftTextXExprLine1}':`,
      `y='${textStartYExpr}':`,
      `alpha='${alphaExpr}':`,
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawtext=",
      `${fontConfig}`,
      "expansion=none:",
      "fix_bounds=1:",
      `text='${escapeDrawtext(AIR_PLUS_TRAVEL_PRIVILEGES_CHIP_LEFT_LINE_2)}':`,
      "fontcolor=white:",
      `fontsize=${textFontSize}:`,
      "line_spacing=0:",
      `x='${leftTextXExprLine2}':`,
      `y='(${textStartYExpr})+${lineGap}':`,
      `alpha='${alphaExpr}':`,
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawtext=",
      `${fontConfig}`,
      "expansion=none:",
      "fix_bounds=1:",
      `text='${escapeDrawtext(AIR_PLUS_TRAVEL_PRIVILEGES_CHIP_RIGHT_LINE_1)}':`,
      "fontcolor=white:",
      `fontsize=${textFontSize}:`,
      "line_spacing=0:",
      `x='${rightTextXExprLine1}':`,
      `y='${textStartYExpr}':`,
      `alpha='${alphaExpr}':`,
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawtext=",
      `${fontConfig}`,
      "expansion=none:",
      "fix_bounds=1:",
      `text='${escapeDrawtext(AIR_PLUS_TRAVEL_PRIVILEGES_CHIP_RIGHT_LINE_2)}':`,
      "fontcolor=white:",
      `fontsize=${textFontSize}:`,
      "line_spacing=0:",
      `x='${rightTextXExprLine2}':`,
      `y='(${textStartYExpr})+${lineGap}':`,
      `alpha='${alphaExpr}':`,
      `enable='${enableExpr}'`
    ].join("")
  ];
}

function buildSimpleSupersFilterGraph(filters: string[], sourceLabel = "0:v", outputLabel = "vout"): string {
  const chain = filters.length > 0 ? filters.join(",") : "null";
  return `[${sourceLabel}]${chain}[${outputLabel}]`;
}

function getAirPlusSpecialChipImagePath(variant: TimedSuperCueVariant): string | null {
  if (variant === "air_plus_complimentary_flight_chip") {
    return null;
  }
  if (variant === "air_plus_travel_privileges_chip") {
    return null;
  }
  if (variant === "air_plus_travel_earn_chip") {
    return null;
  }
  if (variant === "air_plus_forex_chip") {
    return null;
  }
  return null;
}

function getAirPlusSpecialChipImageWidth(frameWidth: number, variant: TimedSuperCueVariant): number {
  if (variant === "air_plus_travel_earn_chip" || variant === "air_plus_forex_chip") {
    return Math.min(Math.round(frameWidth * 0.9), 1040);
  }

  return Math.min(Math.round(frameWidth * 0.79), 980);
}

async function getAirPlusSupersFilter(
  cues: TimedSuperCue[],
  jobDir: string,
  frameWidth: number,
  frameHeight: number
): Promise<string> {
  const italicFontConfig =
    SUPERS_ITALIC_FONT_FILE && SUPERS_ITALIC_FONT_FILE.length > 0
      ? `fontfile='${escapeDrawtext(SUPERS_ITALIC_FONT_FILE)}':`
      : "";
  const textFontSize = Math.floor(SUPERS_FONT_SIZE * 0.92 * SUPERS_FONT_SCALE);
  const maxTextWidthPx = Math.floor(frameWidth - frameWidth * 0.054 - 64);
  const standardCues = cues.filter((cue) => cue.variant === "standard");
  const imageCues = cues.filter((cue) => isAirPlusSpecialChipVariant(cue.variant));
  const cueFilters = (
    await Promise.all(
      standardCues.map(async (cue) => {
        const start = cue.start.toFixed(2);
        const end = cue.end.toFixed(2);
        const inDur = SUPERS_ANIM_IN_SECONDS.toFixed(2);
        const outDur = SUPERS_ANIM_OUT_SECONDS.toFixed(2);
        const enableExpr = `between(t,${start},${end})`;
        const alphaExpr = `if(lt(t,${start}+${inDur}), (t-${start})/${inDur}, if(gt(t,${end}-${outDur}), (${end}-t)/${outDur}, 1))`;
        const textXExpr = "w*0.054";
        const textYExpr = AIR_PLUS_STANDARD_SUPERS_Y_EXPR;

        return buildSingleLineSupersCueFilters({
          cue,
          fontFile: SUPERS_ITALIC_FONT_FILE,
          fontConfig: italicFontConfig,
          fontSize: textFontSize,
          maxTextWidthPx,
          textXExpr,
          textYExpr,
          baseColor: SUPERS_AIR_PLUS_GREY,
          highlightColor: SUPERS_AIR_PLUS_GREY,
          boxColor: "white@0.95",
          boxBorderW: 18,
          alphaExpr,
          enableExpr,
          jobDir
        });
      })
    )
  ).flat();

  const baseGraph = buildSimpleSupersFilterGraph(cueFilters, "0:v", "airplus_base");
  if (imageCues.length === 0) {
    return baseGraph.replace("[airplus_base]", "[vout]");
  }

  const graphParts: string[] = [baseGraph];
  let currentLabel = "airplus_base";
  let imageIndex = 0;

  for (const imageCue of imageCues) {
    const imagePath = getAirPlusSpecialChipImagePath(imageCue.variant);
    if (!imagePath || !existsSync(imagePath)) {
      if (imageCue.variant === "air_plus_complimentary_flight_chip") {
        const fallbackChipFilters = await buildAirPlusComplimentaryFlightChipFilters({
          cue: imageCue,
          frameWidth,
          frameHeight,
          jobDir
        });
        graphParts.push(buildSimpleSupersFilterGraph(fallbackChipFilters, currentLabel, `airplus_fallback_${imageIndex}`));
        currentLabel = `airplus_fallback_${imageIndex}`;
      } else if (imageCue.variant === "air_plus_travel_privileges_chip") {
        const fallbackChipFilters = await buildAirPlusTravelPrivilegesChipFilters({
          cue: imageCue,
          frameWidth,
          jobDir
        });
        graphParts.push(buildSimpleSupersFilterGraph(fallbackChipFilters, currentLabel, `airplus_fallback_${imageIndex}`));
        currentLabel = `airplus_fallback_${imageIndex}`;
      } else if (imageCue.variant === "air_plus_travel_earn_chip") {
        const fallbackChipFilters = await buildAirPlusTravelEarnChipFilters({
          cue: imageCue,
          frameWidth,
          jobDir
        });
        graphParts.push(buildSimpleSupersFilterGraph(fallbackChipFilters, currentLabel, `airplus_fallback_${imageIndex}`));
        currentLabel = `airplus_fallback_${imageIndex}`;
      } else if (imageCue.variant === "air_plus_forex_chip") {
        const fallbackChipFilters = await buildAirPlusForexChipFilters({
          cue: imageCue,
          frameWidth,
          jobDir
        });
        graphParts.push(buildSimpleSupersFilterGraph(fallbackChipFilters, currentLabel, `airplus_fallback_${imageIndex}`));
        currentLabel = `airplus_fallback_${imageIndex}`;
      }
      imageIndex += 1;
      continue;
    }

    const chipWidth = getAirPlusSpecialChipImageWidth(frameWidth, imageCue.variant);
    const start = imageCue.start.toFixed(2);
    const end = imageCue.end.toFixed(2);
    const escapedChipPath = escapeFilterPath(imagePath);
    const movieLabel = `airplus_chip_${imageIndex}`;
    const nextLabel = `airplus_overlay_${imageIndex}`;

    graphParts.push(`movie='${escapedChipPath}',format=rgba,scale=${chipWidth}:-1[${movieLabel}]`);
    graphParts.push(
      `[${currentLabel}][${movieLabel}]overlay=x='(main_w-overlay_w)/2':y='main_h-overlay_h-${AIR_PLUS_SPECIAL_CHIP_BOTTOM_SAFE_MARGIN_PX}':enable='between(t,${start},${end})':eof_action=repeat[${nextLabel}]`
    );
    currentLabel = nextLabel;
    imageIndex += 1;
  }

  graphParts.push(`[${currentLabel}]copy[vout]`);
  return graphParts.join(";");
}

async function getDefaultKotakSupersFilter(cues: TimedSuperCue[], jobDir: string, frameWidth: number): Promise<string> {
  const fontConfig =
    SUPERS_FONT_FILE && SUPERS_FONT_FILE.length > 0 ? `fontfile='${escapeDrawtext(SUPERS_FONT_FILE)}':` : "";
  const textFontSize = Math.floor(SUPERS_FONT_SIZE * 0.94 * SUPERS_FONT_SCALE);
  const maxTextWidthPx = Math.floor(frameWidth - frameWidth * 0.036 - 72);
  const cueFilters = (
    await Promise.all(
      cues.map(async (cue) => {
        const start = cue.start.toFixed(2);
        const end = cue.end.toFixed(2);
        const inDur = SUPERS_ANIM_IN_SECONDS.toFixed(2);
        const outDur = SUPERS_ANIM_OUT_SECONDS.toFixed(2);
        const textXAnimatedExpr = `if(lt(t,${start}+${inDur}), (main_w*0.022)+((t-${start})/${inDur})*(main_w*0.036-main_w*0.022), main_w*0.036)`;
        const textYExpr = DEFAULT_KOTAK_STANDARD_SUPERS_Y_EXPR;
        const textAlphaExpr = `if(lt(t,${start}+${inDur}), (t-${start})/${inDur}, if(gt(t,${end}-${outDur}), (${end}-t)/${outDur}, 1))`;
        const enableExpr = `between(t,${start},${end})`;

        return buildSingleLineSupersCueFilters({
          cue,
          fontFile: SUPERS_FONT_FILE,
          fontConfig,
          fontSize: textFontSize,
          maxTextWidthPx,
          textXExpr: textXAnimatedExpr,
          textYExpr,
          baseColor: SUPERS_BRAND_BLUE,
          highlightColor: SUPERS_BRAND_RED,
          boxColor: "white@0.96",
          boxBorderW: 18,
          alphaExpr: textAlphaExpr,
          enableExpr,
          jobDir
        });
      })
    )
  ).flat();

  return buildSimpleSupersFilterGraph(cueFilters);
}

async function getSupersFilter(
  template: SupersConfig["template"],
  cues: TimedSuperCue[],
  product: ProductKey,
  jobDir: string,
  frameWidth: number,
  frameHeight: number
): Promise<string> {
  if (template !== "bottom_urgency") {
    throw new Error(`Unsupported supers template: ${template}`);
  }

  if (product === "kotak_air_plus") {
    return getAirPlusSupersFilter(cues, jobDir, frameWidth, frameHeight);
  }

  return getDefaultKotakSupersFilter(cues, jobDir, frameWidth);
}

interface Super1LayoutProfile {
  maxTextWidthRatio: number;
  verticalCenterRatio: number;
  minFontSize: number;
  maxFontSize: number;
  initialFontRatio: number;
  lineStepRatio: number;
  gradientStartRatio: number;
  gradientEndRatio: number;
  gradientPower: number;
  gradientMaxAlpha: number;
}

function isSquareFrame(frameWidth: number, frameHeight: number): boolean {
  return Math.abs(frameWidth - frameHeight) <= 4;
}

function getSuper1LayoutProfile(frameWidth: number, frameHeight: number): Super1LayoutProfile {
  if (isSquareFrame(frameWidth, frameHeight)) {
    return {
      maxTextWidthRatio: SUPER1_SQUARE_MAX_TEXT_WIDTH_RATIO,
      verticalCenterRatio: SUPER1_SQUARE_VERTICAL_CENTER_RATIO,
      minFontSize: SUPER1_SQUARE_MIN_FONT_SIZE,
      maxFontSize: SUPER1_SQUARE_MAX_FONT_SIZE,
      initialFontRatio: SUPER1_SQUARE_INITIAL_FONT_RATIO,
      lineStepRatio: SUPER1_SQUARE_LINE_STEP_RATIO,
      gradientStartRatio: SUPER1_SQUARE_GRADIENT_START_RATIO,
      gradientEndRatio: SUPER1_SQUARE_GRADIENT_END_RATIO,
      gradientPower: SUPER1_SQUARE_GRADIENT_POWER,
      gradientMaxAlpha: SUPER1_SQUARE_GRADIENT_MAX_ALPHA
    };
  }

  return {
    maxTextWidthRatio: SUPER1_MAX_TEXT_WIDTH_RATIO,
    verticalCenterRatio: SUPER1_VERTICAL_CENTER_RATIO,
    minFontSize: SUPER1_MIN_FONT_SIZE,
    maxFontSize: SUPER1_MAX_FONT_SIZE,
    initialFontRatio: SUPER1_INITIAL_FONT_RATIO,
    lineStepRatio: SUPER1_LINE_STEP_RATIO,
    gradientStartRatio: SUPER1_GRADIENT_START_RATIO,
    gradientEndRatio: SUPER1_GRADIENT_END_RATIO,
    gradientPower: SUPER1_GRADIENT_POWER,
    gradientMaxAlpha: SUPER1_GRADIENT_MAX_ALPHA
  };
}

async function getSuper1Filter(
  product: ProductKey,
  script: string,
  jobDir: string,
  frameWidth: number,
  frameHeight: number,
  durationSeconds: number,
  displayStartSeconds?: number,
  displayEndSeconds?: number
): Promise<{ filterGraph: string; copy: { line1: string; line2: string; label: string; rtbKey: string } }> {
  const copy = resolveSuper1Text(product, script);
  const layout = getSuper1LayoutProfile(frameWidth, frameHeight);
  const fontFile = SUPER1_RENDER_FONT_FILE;
  const fontConfig = fontFile ? `fontfile='${escapeDrawtext(fontFile)}':` : "";
  const maxTextWidth = Math.max(isSquareFrame(frameWidth, frameHeight) ? 380 : 460, Math.round(frameWidth * layout.maxTextWidthRatio));
  const initialFontSize = clampNumber(Math.round(frameWidth * layout.initialFontRatio), layout.minFontSize, layout.maxFontSize);
  const line1FontSize = await resolveSupersFontSizeToFit({
    text: copy.line1,
    fontFile,
    initialFontSize,
    maxTextWidthPx: maxTextWidth,
    minFontSize: layout.minFontSize,
    jobDir
  });
  const line2FontSize = await resolveSupersFontSizeToFit({
    text: copy.line2,
    fontFile,
    initialFontSize,
    maxTextWidthPx: maxTextWidth,
    minFontSize: layout.minFontSize,
    jobDir
  });
  const textFontSize = Math.min(line1FontSize, line2FontSize);
  const line1TextWidth = await measureDrawtextBoundingWidth(copy.line1, fontFile, textFontSize, jobDir);
  const line2TextWidth = await measureDrawtextBoundingWidth(copy.line2, fontFile, textFontSize, jobDir);
  const lineStep = Math.round(textFontSize * layout.lineStepRatio);
  const blockHeight = textFontSize + lineStep;
  const centerY = Math.round(frameHeight * layout.verticalCenterRatio);
  const line1Y = Math.round(centerY - blockHeight / 2);
  const line2Y = line1Y + lineStep;
  const line1X = ((frameWidth - line1TextWidth) / 2).toFixed(2);
  const line2X = ((frameWidth - line2TextWidth) / 2).toFixed(2);
  const effectiveStartSeconds =
    typeof displayStartSeconds === "number" && Number.isFinite(displayStartSeconds)
      ? clampNumber(displayStartSeconds, 0, Math.max(0, durationSeconds - (SUPER1_FADE_IN_SECONDS + 0.12)))
      : 0;
  const effectiveEndSeconds =
    typeof displayEndSeconds === "number" && Number.isFinite(displayEndSeconds)
      ? clampNumber(displayEndSeconds, effectiveStartSeconds + SUPER1_FADE_IN_SECONDS + 0.12, durationSeconds)
      : durationSeconds;
  const fadeOutWindow = Math.max(SUPER1_FADE_OUT_SECONDS, AIR_PLUS_INLINE_CTA_SUPER_FADE_SECONDS);
  const start = effectiveStartSeconds.toFixed(2);
  const end = effectiveEndSeconds.toFixed(2);
  const enableExpr = `between(t,${start},${end})`;
  const alphaExpr = `if(lt(t,${start}+${SUPER1_FADE_IN_SECONDS.toFixed(2)}),(t-${start})/${SUPER1_FADE_IN_SECONDS.toFixed(2)},if(gt(t,${end}-${fadeOutWindow.toFixed(2)}),(${end}-t)/${fadeOutWindow.toFixed(2)},1))`;
  const filters = [
    [
      "drawtext=",
      `${fontConfig}`,
      "expansion=none:",
      "fix_bounds=1:",
      `text='${escapeDrawtext(copy.line1)}':`,
      "fontcolor=white:",
      `fontsize=${textFontSize}:`,
      "line_spacing=0:",
      `x='${line1X}':`,
      `y='${line1Y}':`,
      `alpha='${alphaExpr}':`,
      `enable='${enableExpr}'`
    ].join(""),
    [
      "drawtext=",
      `${fontConfig}`,
      "expansion=none:",
      "fix_bounds=1:",
      `text='${escapeDrawtext(copy.line2)}':`,
      "fontcolor=white:",
      `fontsize=${textFontSize}:`,
      "line_spacing=0:",
      `x='${line2X}':`,
      `y='${line2Y}':`,
      `alpha='${alphaExpr}':`,
      `enable='${enableExpr}'`
    ].join("")
  ];
  const gradientStartRatio = layout.gradientStartRatio.toFixed(3);
  const gradientEndRange = (layout.gradientEndRatio - layout.gradientStartRatio).toFixed(3);
  const gradientPower = layout.gradientPower.toFixed(2);
  const gradientMaxAlpha = layout.gradientMaxAlpha.toFixed(2);
  const gradientAlphaExpr = `if(gte(Y\\,H*${gradientStartRatio})\\,255*${gradientMaxAlpha}*pow((Y-H*${gradientStartRatio})/(H*${gradientEndRange})\\,${gradientPower})\\,0)`;

  return {
    filterGraph: [
      `color=c=black:s=${frameWidth}x${frameHeight}:d=${durationSeconds.toFixed(3)},format=rgba,geq=r='0':g='0':b='0':a='${gradientAlphaExpr}',fade=t=in:st=${start}:d=${SUPER1_FADE_IN_SECONDS.toFixed(2)}:alpha=1,fade=t=out:st=${Math.max(effectiveStartSeconds, effectiveEndSeconds - fadeOutWindow).toFixed(2)}:d=${fadeOutWindow.toFixed(2)}:alpha=1[super1grad]`,
      `[0:v][super1grad]overlay=0:0:format=auto:enable='${enableExpr}',${filters.join(",")}[vout]`
    ].join(";"),
    copy
  };
}

export async function renderSupersVideo(
  rawVideoPath: string,
  finalVideoPath: string,
  supers: SupersConfig,
  product: ProductKey,
  script: string,
  jobDir: string,
  debugFileName = "supers-debug.json",
  options?: { super1DisplayEndSeconds?: number }
): Promise<{ applied: boolean; cueCount: number; modeUsed: SupersConfig["timingMode"]; ruleCount: number }> {
  if (!supers.enabled) {
    await fs.copyFile(rawVideoPath, finalVideoPath);
    return { applied: false, cueCount: 0, modeUsed: supers.timingMode, ruleCount: 0 };
  }

  if (supers.template === "super2") {
    const debugPath = path.join(jobDir, debugFileName);
    await fs.writeFile(
      debugPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          product,
          template: supers.template,
          applied: false,
          note: "super2 is not configured yet."
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.copyFile(rawVideoPath, finalVideoPath);
    return { applied: false, cueCount: 0, modeUsed: supers.timingMode, ruleCount: 0 };
  }

  if (supers.template === "super1") {
    const durationSeconds = await getVideoDurationSeconds(rawVideoPath, jobDir);
    const { width: frameWidth, height: frameHeight } = await getVideoResolution(rawVideoPath, jobDir);
    const resolvedCopy = resolveSuper1Text(product, script);
    const rawRules = supers.rules.length > 0 ? supers.rules : deriveAutomaticSupersRules(product, script);
    const rules = normalizeSupersRules(rawRules);
    let displayStartSeconds: number | undefined;
    let modeUsed = supers.timingMode;
    let matchedCue: TimedSuperCue | undefined;
    if (rules.length > 0) {
      const resolved = await resolveSupersCueTimings(supers, rules, script, rawVideoPath, jobDir);
      modeUsed = resolved.modeUsed;
      matchedCue =
        resolved.cues.find((cue) => resolveSuper1Text(product, cue.text).rtbKey === resolvedCopy.rtbKey) ??
        resolved.cues[0];
      displayStartSeconds = matchedCue?.start;
    }
    const { filterGraph, copy } = await getSuper1Filter(
      product,
      script,
      jobDir,
      frameWidth,
      frameHeight,
      durationSeconds,
      displayStartSeconds,
      options?.super1DisplayEndSeconds
    );
    const debugPath = path.join(jobDir, debugFileName);
    await fs.writeFile(
      debugPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          product,
          template: supers.template,
          durationSeconds,
          applied: true,
          requestedMode: supers.timingMode,
          modeUsed,
          displayStartSeconds,
          displayEndSeconds: options?.super1DisplayEndSeconds,
          copy,
          ruleCount: rules.length,
          matchedCue
        },
        null,
        2
      ),
      "utf8"
    );

    await runCommand(
      FFMPEG_BIN,
      [
        "-y",
        "-i",
        rawVideoPath,
        "-filter_complex",
        filterGraph,
        "-map",
        "[vout]",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        FINAL_EXPORT_PRESET,
        "-crf",
        FINAL_EXPORT_CRF,
        "-maxrate",
        FINAL_EXPORT_MAXRATE,
        "-bufsize",
        FINAL_EXPORT_BUFSIZE,
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-c:a",
        "aac",
        "-b:a",
        FINAL_EXPORT_AUDIO_BITRATE,
        finalVideoPath
      ],
      jobDir
    );

    return { applied: true, cueCount: matchedCue ? 1 : 0, modeUsed, ruleCount: rules.length };
  }

  const rawRules = supers.rules.length > 0 ? supers.rules : deriveAutomaticSupersRules(product, script);
  const rules = normalizeSupersRules(rawRules);
  const { cues, modeUsed } = await resolveSupersCueTimings(supers, rules, script, rawVideoPath, jobDir);

  const debugPath = path.join(jobDir, debugFileName);
  await fs.writeFile(
    debugPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        product,
        template: supers.template,
        requestedMode: supers.timingMode,
        modeUsed,
        ruleCount: rules.length,
        cueCount: cues.length,
        inlineTextViolations: cues.filter((cue) => /\r|\n/.test(cue.text)).length,
        rules,
        cues
      },
      null,
      2
    ),
    "utf8"
  );

  if (cues.length === 0) {
    await fs.copyFile(rawVideoPath, finalVideoPath);
    return { applied: false, cueCount: 0, modeUsed, ruleCount: rules.length };
  }

  const { width: frameWidth, height: frameHeight } = await getVideoResolution(rawVideoPath, jobDir);
  const filterGraph = await getSupersFilter(supers.template, cues, product, jobDir, frameWidth, frameHeight);
  await runCommand(
    FFMPEG_BIN,
    [
      "-y",
      "-i",
      rawVideoPath,
      "-filter_complex",
      filterGraph,
      "-map",
      "[vout]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      FINAL_EXPORT_PRESET,
      "-crf",
      FINAL_EXPORT_CRF,
      "-maxrate",
      FINAL_EXPORT_MAXRATE,
      "-bufsize",
      FINAL_EXPORT_BUFSIZE,
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      FINAL_EXPORT_AUDIO_BITRATE,
      finalVideoPath
    ],
    jobDir
  );

  return { applied: true, cueCount: cues.length, modeUsed, ruleCount: rules.length };
}

interface AirPlusInlineCtaLayoutProfile {
  cardYRatio: number;
  cardWidthRatio: number;
  cardHeightRatio: number;
  cardAppearSeconds: number;
  cardAppearOffsetY: number;
  buttonScale: number;
  buttonOverlayY: number;
  buttonAppearDelaySeconds: number;
  buttonAppearSeconds: number;
  buttonAppearOffsetY: number;
}

function getAirPlusInlineCtaLayoutProfile(targetResolution: { width: number; height: number }): AirPlusInlineCtaLayoutProfile {
  if (isSquareFrame(targetResolution.width, targetResolution.height)) {
    return {
      cardYRatio: AIR_PLUS_INLINE_CTA_SQUARE_CARD_Y_RATIO,
      cardWidthRatio: AIR_PLUS_INLINE_CTA_SQUARE_CARD_WIDTH_RATIO,
      cardHeightRatio: AIR_PLUS_INLINE_CTA_SQUARE_CARD_HEIGHT_RATIO,
      cardAppearSeconds: AIR_PLUS_INLINE_CTA_CARD_APPEAR_SECONDS,
      cardAppearOffsetY: AIR_PLUS_INLINE_CTA_SQUARE_CARD_APPEAR_OFFSET_Y,
      buttonScale: AIR_PLUS_INLINE_CTA_SQUARE_BUTTON_SCALE,
      buttonOverlayY: AIR_PLUS_INLINE_CTA_SQUARE_BUTTON_OVERLAY_Y,
      buttonAppearDelaySeconds: AIR_PLUS_INLINE_CTA_BUTTON_APPEAR_DELAY_SECONDS,
      buttonAppearSeconds: AIR_PLUS_INLINE_CTA_BUTTON_APPEAR_SECONDS,
      buttonAppearOffsetY: AIR_PLUS_INLINE_CTA_SQUARE_BUTTON_APPEAR_OFFSET_Y
    };
  }

  return {
    cardYRatio: AIR_PLUS_INLINE_CTA_CARD_Y_RATIO,
    cardWidthRatio: AIR_PLUS_INLINE_CTA_CARD_WIDTH_RATIO,
    cardHeightRatio: AIR_PLUS_INLINE_CTA_CARD_HEIGHT_RATIO,
    cardAppearSeconds: AIR_PLUS_INLINE_CTA_CARD_APPEAR_SECONDS,
    cardAppearOffsetY: AIR_PLUS_INLINE_CTA_CARD_APPEAR_OFFSET_Y,
    buttonScale: AIR_PLUS_INLINE_CTA_BUTTON_SCALE,
    buttonOverlayY: AIR_PLUS_INLINE_CTA_BUTTON_OVERLAY_Y,
    buttonAppearDelaySeconds: AIR_PLUS_INLINE_CTA_BUTTON_APPEAR_DELAY_SECONDS,
    buttonAppearSeconds: AIR_PLUS_INLINE_CTA_BUTTON_APPEAR_SECONDS,
    buttonAppearOffsetY: AIR_PLUS_INLINE_CTA_BUTTON_APPEAR_OFFSET_Y
  };
}

async function applyFreezeLastFrame(
  videoPath: string,
  jobDir: string,
  freezeSecondsOverride?: number,
  trimTailSecondsOverride?: number
): Promise<boolean> {
  const configuredFreezeSeconds =
    typeof freezeSecondsOverride === "number" ? freezeSecondsOverride : END_FREEZE_LAST_FRAME_SECONDS;
  if (!(configuredFreezeSeconds > 0)) {
    return false;
  }

  const durationSeconds = await getVideoDurationSeconds(videoPath, jobDir);
  if (!(durationSeconds > 0.2)) {
    return false;
  }

  const freezeSeconds = Math.max(0.05, configuredFreezeSeconds);
  const configuredTrimTailSeconds =
    typeof trimTailSecondsOverride === "number" ? Math.max(0, trimTailSecondsOverride) : 0;
  const trimTailSeconds = Math.min(configuredTrimTailSeconds, Math.max(0, durationSeconds - 0.25));
  const keptDurationSeconds = Math.max(0.05, durationSeconds - trimTailSeconds);
  const outputPath = path.join(jobDir, "final-freeze.mp4");
  const hasAudio = await hasAudioStream(videoPath, jobDir);
  const filterGraph =
    trimTailSeconds > 0
      ? hasAudio
        ? `[0:v]trim=duration=${keptDurationSeconds.toFixed(3)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${freezeSeconds.toFixed(3)}[v];[0:a]atrim=0:${keptDurationSeconds.toFixed(3)},asetpts=N/SR/TB,apad=pad_dur=${freezeSeconds.toFixed(3)}[a]`
        : `[0:v]trim=duration=${keptDurationSeconds.toFixed(3)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${freezeSeconds.toFixed(3)}[v]`
      : hasAudio
        ? `[0:v]tpad=stop_mode=clone:stop_duration=${freezeSeconds.toFixed(3)}[v];[0:a]apad=pad_dur=${freezeSeconds.toFixed(3)}[a]`
        : `[0:v]tpad=stop_mode=clone:stop_duration=${freezeSeconds.toFixed(3)}[v]`;

  const args = [
    "-y",
    "-i",
    videoPath,
    "-filter_complex",
    filterGraph,
    "-map",
    "[v]"
  ];

  if (hasAudio) {
    args.push("-map", "[a]");
  }

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    FINAL_EXPORT_PRESET,
    "-crf",
    FINAL_EXPORT_CRF,
    "-maxrate",
    FINAL_EXPORT_MAXRATE,
    "-bufsize",
    FINAL_EXPORT_BUFSIZE,
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart"
  );

  if (hasAudio) {
    args.push("-c:a", "aac", "-b:a", FINAL_EXPORT_AUDIO_BITRATE);
  } else {
    args.push("-an");
  }

  args.push(outputPath);

  await runCommand(FFMPEG_BIN, args, jobDir);

  await fs.rename(outputPath, videoPath).catch(async () => {
    await fs.copyFile(outputPath, videoPath);
    await fs.unlink(outputPath).catch(() => undefined);
  });

  return true;
}

async function applyAirPlusInlineCtaOverlay(
  videoPath: string,
  script: string,
  jobDir: string,
  inlineCtaTiming?: InlineCtaTiming,
  options?: { outputFileName?: string; debugFileName?: string }
): Promise<{ applied: boolean; reason?: string; timing?: InlineCtaTiming }> {
  const ctaCardPath = END_SLATE_AIR_PLUS_INLINE_CTA_CARD_PATH;
  const ctaButtonPath = END_SLATE_AIR_PLUS_INLINE_CTA_BUTTON_PATH;
  if (!ctaCardPath || !ctaButtonPath) {
    return { applied: false, reason: "inline CTA card/button assets are not configured" };
  }

  if (!existsSync(ctaCardPath)) {
    return { applied: false, reason: `inline CTA card file missing at ${ctaCardPath}` };
  }
  if (!existsSync(ctaButtonPath)) {
    return { applied: false, reason: `inline CTA button file missing at ${ctaButtonPath}` };
  }

  const timing = inlineCtaTiming ?? (await resolveInlineCtaTiming(script, videoPath, jobDir));
  if (!timing) {
    return { applied: false, reason: "no CTA phrase found in script" };
  }

  const targetResolution = await getVideoResolution(videoPath, jobDir);
  const layout = getAirPlusInlineCtaLayoutProfile(targetResolution);
  const baseDuration = Math.max(0.1, await getVideoDurationSeconds(videoPath, jobDir));
  const overlayDuration = Math.max(
    AIR_PLUS_INLINE_CTA_MIN_PANEL_SECONDS,
    clampNumber(baseDuration - timing.startSeconds, 0.1, baseDuration)
  );
  const outputPath = path.join(jobDir, options?.outputFileName ?? "final-with-inline-cta.mp4");
  const debugPath = path.join(jobDir, options?.debugFileName ?? "inline-cta-debug.json");
  const safeStartSeconds = clampNumber(
    timing.startSeconds,
    0,
    Math.max(0.05, Math.max(0.1, baseDuration) - 0.05)
  );
  const cardWidth = Math.round(targetResolution.width * layout.cardWidthRatio);
  const cardHeight = Math.round(targetResolution.height * layout.cardHeightRatio);
  const cardCrop = {
    x: Math.round((targetResolution.width - cardWidth) / 2),
    y: Math.round(targetResolution.height * layout.cardYRatio),
    width: cardWidth,
    height: cardHeight
  };
  const buttonWidth = Math.round(targetResolution.width * layout.buttonScale);
  const buttonHeight = Math.round(targetResolution.height * layout.buttonScale);
  const buttonOverlay = {
    x: Math.round((targetResolution.width - buttonWidth) / 2),
    y: layout.buttonOverlayY,
    width: buttonWidth,
    height: buttonHeight
  };
  const cardAppearStartSeconds = safeStartSeconds;
  const cardAppearDuration = Math.min(layout.cardAppearSeconds, overlayDuration);
  const buttonAppearStartSeconds = safeStartSeconds + layout.buttonAppearDelaySeconds;
  const buttonOverlayDuration = Math.max(0.1, overlayDuration - layout.buttonAppearDelaySeconds);
  const buttonAppearDuration = Math.min(layout.buttonAppearSeconds, buttonOverlayDuration);
  const cardOverlayYExpr = `${cardCrop.y + layout.cardAppearOffsetY}-min(max(t-${cardAppearStartSeconds.toFixed(3)}\\,0)/${cardAppearDuration.toFixed(3)}\\,1)*${layout.cardAppearOffsetY}`;
  const buttonOverlayYExpr = `${buttonOverlay.y + layout.buttonAppearOffsetY}-min(max(t-${buttonAppearStartSeconds.toFixed(3)}\\,0)/${buttonAppearDuration.toFixed(3)}\\,1)*${layout.buttonAppearOffsetY}`;

  const filterGraph = [
    `[0:v:0]split=2[cta_base][cta_blur_src]`,
    `[cta_blur_src]boxblur=luma_radius=${AIR_PLUS_INLINE_CTA_BLUR_LUMA_RADIUS}:luma_power=${AIR_PLUS_INLINE_CTA_BLUR_LUMA_POWER}[cta_blur]`,
    `color=c=black@${AIR_PLUS_INLINE_CTA_DIM_ALPHA.toFixed(2)}:s=${targetResolution.width}x${targetResolution.height}:d=${baseDuration.toFixed(3)},format=rgba[cta_dim]`,
    `[cta_blur][cta_dim]overlay=0:0:format=auto[cta_blur_dim]`,
    `[cta_base][cta_blur_dim]overlay=0:0:enable='gte(t,${safeStartSeconds.toFixed(3)})'[cta_bg]`,
    [
      `[1:v:0]fps=30,scale=${cardCrop.width}:${cardCrop.height}:flags=lanczos,format=rgba,`,
      `fade=t=in:st=0:d=${cardAppearDuration.toFixed(3)}:alpha=1,`,
      `trim=duration=${overlayDuration.toFixed(3)},setpts=PTS-STARTPTS+${safeStartSeconds.toFixed(3)}/TB[cta_card]`
    ].join(""),
    [
      `[2:v:0]fps=30,scale=${buttonOverlay.width}:${buttonOverlay.height}:flags=lanczos,format=rgba,`,
      `fade=t=in:st=0:d=${buttonAppearDuration.toFixed(3)}:alpha=1,`,
      `trim=duration=${buttonOverlayDuration.toFixed(3)},setpts=PTS-STARTPTS+${buttonAppearStartSeconds.toFixed(3)}/TB[cta_button]`
    ].join(""),
    `[cta_bg][cta_card]overlay=${cardCrop.x}:${cardOverlayYExpr}:format=auto[tmp]`,
    `[tmp][cta_button]overlay=${buttonOverlay.x}:${buttonOverlayYExpr}:format=auto[v]`
  ].join(";");

  await fs.writeFile(
    debugPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        cardPath: ctaCardPath,
        buttonPath: ctaButtonPath,
        timing,
        baseDuration,
        overlayDuration,
        layout,
        cardCrop,
        buttonOverlay,
        cardAppearStartSeconds,
        cardAppearDuration,
        buttonAppearStartSeconds,
        buttonAppearDuration
      },
      null,
      2
    ),
    "utf8"
  );

  await runCommand(
    FFMPEG_BIN,
    [
      "-y",
      "-i",
      videoPath,
      "-loop",
      "1",
      "-i",
      ctaCardPath,
      "-loop",
      "1",
      "-i",
      ctaButtonPath,
      "-filter_complex",
      filterGraph,
      "-map",
      "[v]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      FINAL_EXPORT_PRESET,
      "-crf",
      FINAL_EXPORT_CRF,
      "-maxrate",
      FINAL_EXPORT_MAXRATE,
      "-bufsize",
      FINAL_EXPORT_BUFSIZE,
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      FINAL_EXPORT_AUDIO_BITRATE,
      outputPath
    ],
    jobDir
  );

  await fs.rename(outputPath, videoPath).catch(async () => {
    await fs.copyFile(outputPath, videoPath);
    await fs.unlink(outputPath).catch(() => undefined);
  });

  return { applied: true, timing };
}

async function appendEndSlate(videoPath: string, product: ProductKey, jobDir: string): Promise<{ applied: boolean; reason?: string }> {
  const targetResolution = await getVideoResolution(videoPath, jobDir);
  const endSlatePath = resolveEndSlatePath(product, targetResolution);
  if (!endSlatePath) {
    return { applied: false, reason: "no end slate path configured" };
  }

  if (!existsSync(endSlatePath)) {
    return { applied: false, reason: `end slate file missing at ${endSlatePath}` };
  }

  const outputPath = path.join(jobDir, "final-with-end-slate.mp4");
  const mainDuration = Math.max(0.1, await getVideoDurationSeconds(videoPath, jobDir));
  const endSlateDuration = Math.max(0.1, await getVideoDurationSeconds(endSlatePath, jobDir));
  const mainHasAudio = await hasAudioStream(videoPath, jobDir);
  const endSlateHasAudio = await hasAudioStream(endSlatePath, jobDir);

  const args: string[] = ["-y", "-i", videoPath, "-i", endSlatePath];
  let nextInputIndex = 2;
  let mainAudioInput = "[0:a:0]";
  let endSlateAudioInput = "[1:a:0]";

  if (!mainHasAudio) {
    args.push(
      "-f",
      "lavfi",
      "-t",
      mainDuration.toFixed(3),
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000"
    );
    mainAudioInput = `[${nextInputIndex}:a:0]`;
    nextInputIndex += 1;
  }

  if (!endSlateHasAudio) {
    args.push(
      "-f",
      "lavfi",
      "-t",
      endSlateDuration.toFixed(3),
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000"
    );
    endSlateAudioInput = `[${nextInputIndex}:a:0]`;
    nextInputIndex += 1;
  }

  const filterGraph = [
    `[0:v:0]fps=30,scale=${targetResolution.width}:${targetResolution.height}:force_original_aspect_ratio=increase,crop=${targetResolution.width}:${targetResolution.height},setsar=1[v0]`,
    `[1:v:0]fps=30,scale=${targetResolution.width}:${targetResolution.height}:force_original_aspect_ratio=increase,crop=${targetResolution.width}:${targetResolution.height},setsar=1[v1]`,
    `${mainAudioInput}aformat=sample_rates=48000:channel_layouts=stereo[a0]`,
    `${endSlateAudioInput}aformat=sample_rates=48000:channel_layouts=stereo[a1]`,
    "[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]"
  ].join(";");

  await runCommand(
    FFMPEG_BIN,
    [
      ...args,
      "-filter_complex",
      filterGraph,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-r",
      "30",
      "-preset",
      FINAL_EXPORT_PRESET,
      "-crf",
      FINAL_EXPORT_CRF,
      "-maxrate",
      FINAL_EXPORT_MAXRATE,
      "-bufsize",
      FINAL_EXPORT_BUFSIZE,
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      FINAL_EXPORT_AUDIO_BITRATE,
      outputPath
    ],
    jobDir
  );

  await fs.rename(outputPath, videoPath).catch(async () => {
    await fs.copyFile(outputPath, videoPath);
    await fs.unlink(outputPath).catch(() => undefined);
  });

  return { applied: true };
}

async function applyBackgroundScore(
  videoPath: string,
  product: ProductKey,
  script: string,
  backstory: Backstory,
  jobDir: string,
  guidelines?: string,
  brief?: string
): Promise<{ applied: boolean; reason?: string; source?: "fal-lyria2" | "lyria-live" | "file" }> {
  const duration = Math.max(0.1, await getVideoDurationSeconds(videoPath, jobDir));

  if (!(EFFECTIVE_BACKGROUND_SCORE_VOLUME > 0)) {
    return { applied: false, reason: "background score volume is set to 0" };
  }

  let scorePath: string | undefined;
  let scoreSource: "fal-lyria2" | "lyria-live" | "file" | undefined;
  let lyriaFailureReason: string | undefined;

  if (BACKGROUND_SCORE_SOURCE !== "file") {
    try {
      const generated = await generateBackgroundScore(backstory, product, script, duration, jobDir, guidelines, brief);
      scorePath = generated.path;
      scoreSource = generated.source;
    } catch (error) {
      lyriaFailureReason = errorMessage(error);
      if (BACKGROUND_SCORE_SOURCE === "lyria") {
        return { applied: false, reason: `lyria background score generation failed: ${lyriaFailureReason}` };
      }
    }
  }

  if (!scorePath && BACKGROUND_SCORE_SOURCE !== "lyria") {
    const configuredPath = resolveBackgroundScorePath(product);
    if (!configuredPath) {
      return { applied: false, reason: lyriaFailureReason || "no background score path configured" };
    }
    if (!existsSync(configuredPath)) {
      return { applied: false, reason: `background score file missing at ${configuredPath}` };
    }
    scorePath = configuredPath;
    scoreSource = "file";
  }

  if (!scorePath) {
    return { applied: false, reason: lyriaFailureReason || "no background score source available" };
  }

  const tryAutoFileFallback = async (): Promise<boolean> => {
    if ((scoreSource !== "fal-lyria2" && scoreSource !== "lyria-live") || BACKGROUND_SCORE_SOURCE !== "auto") {
      return false;
    }
    const fallbackPath = resolveBackgroundScorePath(product);
    if (!fallbackPath || !existsSync(fallbackPath) || fallbackPath === scorePath) {
      return false;
    }
    if (!(await hasAudioStream(fallbackPath, jobDir))) {
      return false;
    }
    if (await isLikelySilentAudio(fallbackPath, jobDir)) {
      return false;
    }
    scorePath = fallbackPath;
    scoreSource = "file";
    return true;
  };

  if (!(await hasAudioStream(scorePath, jobDir))) {
    const switchedToFile = await tryAutoFileFallback();
    if (!switchedToFile) {
      return { applied: false, reason: `background score has no audio stream: ${scorePath}` };
    }
  }

  if (await isLikelySilentAudio(scorePath, jobDir)) {
    const switchedToFile = await tryAutoFileFallback();
    if (!switchedToFile) {
      if (scoreSource === "file") {
        // Local brand bed can be intentionally low-level; still mix it in.
        console.warn(`[pipeline] background score appears low-level but will still be used: ${scorePath}`);
      } else {
      const sourceLabel = scoreSource ?? "configured";
      return {
        applied: false,
        reason: `background score source is silent (${sourceLabel}: ${path.basename(scorePath)})`
      };
      }
    }
  }

  const outputPath = path.join(jobDir, "final-with-bgm.mp4");
  const mainHasAudio = await hasAudioStream(videoPath, jobDir);
  const fadeInSeconds = Math.min(BACKGROUND_SCORE_FADE_SECONDS, Math.max(0.12, duration / 5));
  const fadeOutSeconds = Math.min(BACKGROUND_SCORE_END_FADE_SECONDS, Math.max(0, duration - 0.02));
  const fadeOutStart = Math.max(0, duration - fadeOutSeconds);
  const durationTag = duration.toFixed(3);

  const args: string[] = ["-y", "-i", videoPath, "-stream_loop", "-1", "-i", scorePath];
  const bgProcessors = [
    "aformat=sample_rates=48000:channel_layouts=stereo",
    `atrim=0:${durationTag}`,
    "asetpts=N/SR/TB",
    `volume=${EFFECTIVE_BACKGROUND_SCORE_VOLUME.toFixed(3)}`
  ];
  if (fadeInSeconds > 0.01) {
    bgProcessors.push(`afade=t=in:st=0:d=${fadeInSeconds.toFixed(3)}`);
  }
  if (fadeOutSeconds > 0.01) {
    bgProcessors.push(`afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutSeconds.toFixed(3)}`);
  }
  bgProcessors.push(`apad=pad_dur=${durationTag}`, `atrim=0:${durationTag}[bg]`);
  const bgTrack = `[1:a:0]${bgProcessors.join(",")}`;

  const filterGraph = mainHasAudio
    ? [
        `[0:a:0]aformat=sample_rates=48000:channel_layouts=stereo,apad=pad_dur=${durationTag},atrim=0:${durationTag}[main]`,
        bgTrack,
        `[main][bg]amix=inputs=2:duration=longest:dropout_transition=0,atrim=0:${durationTag},asetpts=N/SR/TB[mix]`
      ].join(";")
    : [bgTrack, `[bg]atrim=0:${durationTag},asetpts=N/SR/TB[mix]`].join(";");

  await runCommand(
    FFMPEG_BIN,
    [
      ...args,
      "-filter_complex",
      filterGraph,
      "-map",
      "0:v:0",
      "-map",
      "[mix]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outputPath
    ],
    jobDir
  );

  await fs.rename(outputPath, videoPath).catch(async () => {
    await fs.copyFile(outputPath, videoPath);
    await fs.unlink(outputPath).catch(() => undefined);
  });

  return { applied: true, source: scoreSource };
}

async function finalizeRenderedVideo(params: {
  jobId: string;
  runToken: string;
  jobDir: string;
  videoProvider: VideoProvider;
  product: ProductKey;
  script: string;
  backstory: Backstory;
  rawVideoPath: string;
  supers: SupersConfig;
  isHowToFlow: boolean;
  guidelines?: string;
  brief?: string;
}): Promise<void> {
  const { jobId, runToken, jobDir, videoProvider, product, script, backstory, rawVideoPath, supers, isHowToFlow, guidelines, brief } = params;
  const finalVideoPath = path.join(jobDir, "final.mp4");
  const providerAssetFiles = getProviderAssetFileNames(videoProvider);
  let inlineCtaTiming: InlineCtaTiming | undefined;
  if (!isHowToFlow && shouldUseInlineAirPlusCtaOverlay(product, script)) {
    try {
      inlineCtaTiming = await resolveInlineCtaTiming(script, rawVideoPath, jobDir);
    } catch (error) {
      console.warn("[pipeline] inline CTA timing resolution failed; continuing without CTA-timed super fade.", error);
    }
  }

  await updateStepForRun(jobId, runToken, "finalize", "running", "Rendering supers overlay on final MP4...");

  const finalizeNotes: string[] = [];
  try {
    const supersConfigForRender = isHowToFlow ? { ...supers, enabled: false, rules: [] } : supers;
    const result = await renderSupersVideo(rawVideoPath, finalVideoPath, supersConfigForRender, product, script, jobDir, undefined, {
      super1DisplayEndSeconds: inlineCtaTiming?.startSeconds
    });
    finalizeNotes.push(result.applied ? `Supers: ${result.cueCount} cues (${result.modeUsed}).` : "Supers: no cues.");
  } catch (error) {
    console.warn("[pipeline] supers render failed; returning raw video as final fallback", error);
    await fs.copyFile(rawVideoPath, finalVideoPath);
    const detail = error instanceof Error ? error.message.split("\n")[0]?.slice(0, 120) : "";
    finalizeNotes.push(
      isFfmpegMissingError(error)
        ? "Supers: skipped (ffmpeg missing)."
        : `Supers: fallback${detail ? ` (${detail})` : ""}.`
    );
  }

  if (APPEND_END_SLATE) {
    if (inlineCtaTiming && product === "kotak_air_plus") {
      try {
        const inlineCtaResult = await applyAirPlusInlineCtaOverlay(finalVideoPath, script, jobDir, inlineCtaTiming);
        if (inlineCtaResult.applied) {
          finalizeNotes.push(`Slate: inline CTA on (${inlineCtaResult.timing?.modeUsed ?? inlineCtaTiming.modeUsed}).`);
        } else {
          finalizeNotes.push(`Slate: off${inlineCtaResult.reason ? ` (${inlineCtaResult.reason})` : ""}.`);
        }
      } catch (error) {
        console.warn("[pipeline] inline CTA overlay failed; keeping previous final MP4", error);
        finalizeNotes.push(isFfmpegMissingError(error) ? "Slate: off (ffmpeg missing)." : "Slate: off.");
      }
    } else {
      try {
        const preEndHoldApplied = await applyFreezeLastFrame(
          finalVideoPath,
          jobDir,
          PRE_END_SLATE_HOLD_SECONDS,
          MODEL_END_TRIM_SECONDS
        );
        if (preEndHoldApplied) {
          finalizeNotes.push("Pre-hold: on.");
        }
      } catch (error) {
        console.warn("[pipeline] pre-end-slate hold render failed; continuing without hold", error);
        finalizeNotes.push("Pre-hold: off.");
      }

      try {
        const endSlateResult = await appendEndSlate(finalVideoPath, product, jobDir);
        if (endSlateResult.applied) {
          finalizeNotes.push("Slate: on.");
        } else {
          finalizeNotes.push("Slate: off.");
        }
      } catch (error) {
        console.warn("[pipeline] end slate append failed; keeping previous final MP4", error);
        finalizeNotes.push(isFfmpegMissingError(error) ? "Slate: off (ffmpeg missing)." : "Slate: off.");
      }
    }
  }

  try {
    const freezeApplied = await applyFreezeLastFrame(
      finalVideoPath,
      jobDir,
      undefined,
      APPEND_END_SLATE ? 0 : MODEL_END_TRIM_SECONDS
    );
    if (freezeApplied) {
      finalizeNotes.push("Freeze: on.");
    }
  } catch (error) {
    console.warn("[pipeline] freeze-frame render failed; keeping previous final MP4", error);
    finalizeNotes.push("Freeze: off.");
  }

  try {
    await updateStepForRun(jobId, runToken, "finalize", "running", "Mixing background score for final MP4...");
    const bgScoreResult = await applyBackgroundScore(finalVideoPath, product, script, backstory, jobDir, guidelines, brief);
    if (bgScoreResult.applied) {
      finalizeNotes.push(`Audio: mixed${bgScoreResult.source ? ` (${bgScoreResult.source})` : ""}.`);
    } else {
      finalizeNotes.push(`Audio: skipped${bgScoreResult.reason ? ` (${bgScoreResult.reason})` : ""}.`);
    }
  } catch (error) {
    console.warn("[pipeline] background score mix failed; keeping previous final MP4", error);
    finalizeNotes.push(isFfmpegMissingError(error) ? "Audio: skipped (ffmpeg missing)." : "Audio: off.");
  }

  const finalizeMessage = `Final ready. ${finalizeNotes.join(" ")}`.trim();
  await copyFileIfExists(finalVideoPath, path.join(jobDir, providerAssetFiles.final));

  await ensureCurrentJobRun(jobId, runToken);
  await mutateJobForRun(jobId, runToken, (state) => {
    state.assets.finalMp4 = providerAssetFiles.final;
  });
  await updateStepForRun(jobId, runToken, "finalize", "completed", finalizeMessage);
  await setJobStatusForRun(jobId, runToken, "completed");
}

function getAdaptFilterGraphForMode(
  targetWidth: number,
  targetHeight: number,
  mode: "cover" | "blur" = ADAPT_COMPOSITION_MODE === "blur" ? "blur" : "cover",
  cropAnchor: "center" | "upper" = "center"
): string {
  if (mode === "blur") {
    return [
      `[0:v:0]fps=30,scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight},boxblur=24:12[bg]`,
      `[0:v:0]fps=30,scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease[fg]`,
      "[bg][fg]overlay=(W-w)/2:(H-h)/2[v]"
    ].join(";");
  }

  const cropY =
    cropAnchor === "upper" ? `max(0\\,min(ih-oh\\,(ih-oh)*0.18))` : "(ih-oh)/2";

  return [
    `[0:v:0]fps=30,scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}:(iw-ow)/2:${cropY},setsar=1[v]`
  ].join(";");
}

async function extractAdaptReferenceFrame(
  jobDir: string,
  sourceVideoPath: string,
  outputFileName: string,
  filterGraph: string
): Promise<Buffer> {
  const outputPath = path.join(jobDir, outputFileName);
  await runCommand(
    FFMPEG_BIN,
    [
      "-y",
      "-i",
      sourceVideoPath,
      "-filter_complex",
      filterGraph,
      "-map",
      "[v]",
      "-frames:v",
      "1",
      outputPath
    ],
    jobDir
  );
  return fs.readFile(outputPath);
}

export interface CrossAspectTrialInput {
  product: ProductKey;
  script: string;
  brief?: string;
  guidelines?: string;
  provider?: "sora" | "veo31_standard";
  durationSeconds?: 8 | 15 | 20;
  videoType?: VideoType;
  promptVersion?: PromptWriterVersion;
}

export interface CrossAspectTrialResult {
  outputDir: string;
  product: ProductKey;
  provider: "sora" | "veo31_standard";
  script: string;
  backstory: Backstory;
  master16x9Path: string;
  adapt9x16Path: string;
  adapt1x1Path: string;
  adapt4x3Path: string;
  guideFramePath: string;
  masterFramePath: string;
  adapt9x16FramePath: string;
  adapt1x1FramePath: string;
  adapt4x3FramePath: string;
  effectiveGuidelines: string;
}

function buildCrossAspectMasterGuidelines(guidelines?: string): string {
  const trialGuidelines = [
    "Experimental framing mode: generate a native 16:9 master specifically designed for later center-crops into 9:16, 1:1, and 4:3.",
    "Keep the face, eyes, head, shoulders, and upper torso fully readable inside the central safe column of the frame at all times.",
    "Center-lock the subject. Keep the nose bridge and eye line very close to horizontal center; do not use rule-of-thirds framing, off-center portrait composition, or side-weighted blocking.",
    "Frame another step wider than a normal direct-to-camera landscape ad. Prefer waist-up or slightly-lower-than-waist-up framing rather than chest-up, and avoid tight medium shots.",
    "The character should appear about 32 to 35 percent smaller than a normal 16:9 medium shot so later center-crops still feel comfortable.",
    "Keep all essential gestures, props, and performance beats inside the middle 22 to 26 percent of frame width.",
    "Treat the left and right outer frame as expendable background only. Do not place critical action, hands, luggage, text, products, or expressions near the edges.",
    "Use a landscape medium shot built specifically for center-crop adapts into portrait and square outputs.",
    "Avoid wide lateral movement, side entrances, edge-weighted composition, or gestures that break when center-cropped.",
    "Do not let the face drift toward either side during the line. Keep both shoulders comfortably inside the safe column with clear margin on both sides, and avoid leaned or asymmetrical poses that crop poorly.",
    "Background can extend wide, but only with non-critical atmosphere and no important story information."
  ].join(" ");

  return guidelines?.trim() ? `${guidelines.trim()}\n\n${trialGuidelines}` : trialGuidelines;
}

async function deriveVideoVariantFromMaster(
  sourcePath: string,
  outputPath: string,
  frame: { width: number; height: number },
  cropAnchor: "center" | "upper",
  jobDir: string
): Promise<void> {
  const filterGraph = getAdaptFilterGraphForMode(frame.width, frame.height, "cover", cropAnchor);
  await runCommand(
    FFMPEG_BIN,
    [
      "-y",
      "-i",
      sourcePath,
      "-filter_complex",
      filterGraph,
      "-map",
      "[v]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      FINAL_EXPORT_PRESET,
      "-crf",
      FINAL_EXPORT_CRF,
      "-maxrate",
      FINAL_EXPORT_MAXRATE,
      "-bufsize",
      FINAL_EXPORT_BUFSIZE,
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      FINAL_EXPORT_AUDIO_BITRATE,
      outputPath
    ],
    jobDir
  );
}

async function extractVideoFrameAt(
  videoPath: string,
  outputPath: string,
  timeSeconds: number,
  jobDir: string
): Promise<void> {
  await runCommand(
    FFMPEG_BIN,
    ["-y", "-ss", timeSeconds.toFixed(3), "-i", videoPath, "-frames:v", "1", outputPath],
    jobDir
  );
}

async function renderCrossAspectGuideFrame(
  videoPath: string,
  outputPath: string,
  jobDir: string
): Promise<void> {
  const { width, height } = await getVideoResolution(videoPath, jobDir);
  const portraitWidth = Math.round((height * 9) / 16);
  const squareWidth = height;
  const fourThreeWidth = Math.round((height * 4) / 3);
  const portraitX = Math.round((width - portraitWidth) / 2);
  const squareX = Math.round((width - squareWidth) / 2);
  const fourThreeX = Math.round((width - fourThreeWidth) / 2);
  const filterGraph = [
    `drawbox=x=${portraitX}:y=0:w=${portraitWidth}:h=${height}:color=0xff4d4d@0.90:t=6`,
    `drawbox=x=${squareX}:y=0:w=${squareWidth}:h=${height}:color=0x4dff88@0.90:t=6`,
    `drawbox=x=${fourThreeX}:y=0:w=${fourThreeWidth}:h=${height}:color=0x4da3ff@0.90:t=6`
  ].join(",");
  await runCommand(
    FFMPEG_BIN,
    ["-y", "-ss", "1.500", "-i", videoPath, "-vf", filterGraph, "-frames:v", "1", outputPath],
    jobDir
  );
}

export async function runCrossAspectTrial(input: CrossAspectTrialInput): Promise<CrossAspectTrialResult> {
  const provider = input.provider ?? "sora";
  const durationSeconds = input.durationSeconds ?? 8;
  const videoType = input.videoType ?? "point_to_camera_multi_scene";
  const promptVersion = input.promptVersion ?? DEFAULT_PROMPT_WRITER_VERSION;
  const effectiveGuidelines = buildCrossAspectMasterGuidelines(input.guidelines);
  const trialId = `cross-aspect-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const outputDir = path.join(process.cwd(), "generated-trials", trialId);
  await fs.mkdir(outputDir, { recursive: true });

  const backstory = await generateBackstory(input.script, input.product, effectiveGuidelines, input.brief);
  await fs.writeFile(path.join(outputDir, "script.txt"), `${input.script}\n`, "utf8");
  await fs.writeFile(path.join(outputDir, "brief.txt"), `${input.brief ?? ""}\n`, "utf8");
  await fs.writeFile(path.join(outputDir, "guidelines.txt"), `${effectiveGuidelines}\n`, "utf8");
  await fs.writeFile(path.join(outputDir, "backstory.json"), JSON.stringify(backstory, null, 2), "utf8");

  const videoConfig: VideoConfig = {
    type: videoType,
    durationSeconds,
    provider
  };

  let rawVideo: Buffer;
  if (shouldUseDirectTextToVideoFlow(videoConfig)) {
    rawVideo = await generateVideoFromText(
      backstory,
      input.product,
      input.script,
      async () => undefined,
      LANDSCAPE_FRAME_SPEC.aspectRatio,
      videoConfig,
      effectiveGuidelines,
      input.brief,
      undefined,
      outputDir,
      promptVersion
    );
  } else {
    const keyframeBytes = await generateKeyframe(
      backstory,
      input.product,
      input.script,
      effectiveGuidelines,
      input.brief,
      [],
      0,
      LANDSCAPE_FRAME_SPEC.aspectRatio,
      videoType
    );
    const normalizedKeyframe = await normalizeKeyframeToDirectory(outputDir, keyframeBytes, {
      width: LANDSCAPE_FRAME_SPEC.width,
      height: LANDSCAPE_FRAME_SPEC.height,
      sourceFileName: "keyframe-source-16x9.png",
      outputFileName: "keyframe-16x9.png"
    });
    rawVideo = await generateVideoFromImage(
      normalizedKeyframe,
      backstory,
      input.product,
      input.script,
      async () => undefined,
      LANDSCAPE_FRAME_SPEC.aspectRatio,
      videoConfig,
      effectiveGuidelines,
      input.brief,
      outputDir,
      promptVersion
    );
  }

  const master16x9Path = path.join(outputDir, "master-16x9.mp4");
  await fs.writeFile(master16x9Path, rawVideo);
  await normalizeVideoToFrameInPlace(master16x9Path, LANDSCAPE_FRAME_SPEC, outputDir).catch(() => undefined);

  const adapt9x16Path = path.join(outputDir, "adapt-9x16-from-master.mp4");
  const adapt1x1Path = path.join(outputDir, "adapt-1x1-from-master.mp4");
  const adapt4x3Path = path.join(outputDir, "adapt-4x3-from-master.mp4");
  await deriveVideoVariantFromMaster(master16x9Path, adapt9x16Path, PRIMARY_FRAME_SPEC, "center", outputDir);
  await deriveVideoVariantFromMaster(master16x9Path, adapt1x1Path, SQUARE_FRAME_SPEC, "center", outputDir);
  await deriveVideoVariantFromMaster(master16x9Path, adapt4x3Path, FOUR_THREE_FRAME_SPEC, "center", outputDir);

  const guideFramePath = path.join(outputDir, "master-16x9-guide.png");
  const masterFramePath = path.join(outputDir, "master-16x9-frame.png");
  const adapt9x16FramePath = path.join(outputDir, "adapt-9x16-frame.png");
  const adapt1x1FramePath = path.join(outputDir, "adapt-1x1-frame.png");
  const adapt4x3FramePath = path.join(outputDir, "adapt-4x3-frame.png");
  await renderCrossAspectGuideFrame(master16x9Path, guideFramePath, outputDir);
  await extractVideoFrameAt(master16x9Path, masterFramePath, 1.5, outputDir);
  await extractVideoFrameAt(adapt9x16Path, adapt9x16FramePath, 1.5, outputDir);
  await extractVideoFrameAt(adapt1x1Path, adapt1x1FramePath, 1.5, outputDir);
  await extractVideoFrameAt(adapt4x3Path, adapt4x3FramePath, 1.5, outputDir);

  return {
    outputDir,
    product: input.product,
    provider,
    script: input.script,
    backstory,
    master16x9Path,
    adapt9x16Path,
    adapt1x1Path,
    adapt4x3Path,
    guideFramePath,
    masterFramePath,
    adapt9x16FramePath,
    adapt1x1FramePath,
    adapt4x3FramePath,
    effectiveGuidelines
  };
}

export async function generateAdapts(jobId: string): Promise<Awaited<ReturnType<typeof mutateJob>>> {
  const job = await getJob(jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found.`);
  }

  const jobDir = getJobDir(jobId);
  const rawVideoPath = path.join(jobDir, "raw.mp4");
  const finalVideoPath = path.join(jobDir, "final.mp4");
  if (!existsSync(finalVideoPath)) {
    throw new Error("Final MP4 not found. Generate the main video first.");
  }

  const targets = [
    { fileName: ADAPT_SQUARE_FILENAME, width: 1080, height: 1080, aspectRatio: "1:1" as const, slug: "1x1" },
    { fileName: ADAPT_LANDSCAPE_FILENAME, width: 1920, height: 1080, aspectRatio: "16:9" as const, slug: "16x9" }
  ] as const;

  let backstory = job.backstory;
  const selectedVideo = resolveVideoConfig(job.video);
  const effectiveSupers = resolveSupersConfig(job.supers, selectedVideo);
  const preserveBumperIdentity = isBumperVideoType(selectedVideo.type);
  const shouldRegenerateAdapts = ADAPT_GENERATION_MODE === "regenerate" && !preserveBumperIdentity;
  if (!shouldRegenerateAdapts && !existsSync(rawVideoPath)) {
    throw new Error("Raw MP4 not found. Please regenerate the main video before creating adapts.");
  }
  if (!backstory) {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(jobDir, "backstory.json"), "utf8"));
      backstory = backstorySchema.parse(parsed);
    } catch (error) {
      throw new Error(
        `Backstory not found for adapt regeneration (${error instanceof Error ? error.message : String(error)}).`
      );
    }
  }

  try {
    for (const target of targets) {
      const outputPath = path.join(jobDir, target.fileName);
      const baseName = path.parse(target.fileName).name;
      const baseAdaptPath = path.join(jobDir, `${baseName}-base.mp4`);
      const shouldUsePortraitMasterReframe = target.aspectRatio === "1:1";
      const shouldRegenerateThisTarget = shouldRegenerateAdapts && !shouldUsePortraitMasterReframe;
      const adaptFilterGraph = getAdaptFilterGraphForMode(
        target.width,
        target.height,
        target.aspectRatio === "16:9" && preserveBumperIdentity ? "blur" : "cover",
        target.aspectRatio === "1:1" ? "upper" : "center"
      );

      if (shouldRegenerateThisTarget) {
        const generationAspectRatio: SupportedAspectRatio = target.aspectRatio === "1:1" ? "16:9" : target.aspectRatio;
        const generationWidth = generationAspectRatio === "16:9" ? 1920 : target.width;
        const generationHeight = generationAspectRatio === "16:9" ? 1080 : target.height;
        const maxAdaptVideoAttempts = Math.max(1, VEO_CELEBRITY_FILTER_REGENERATE_ATTEMPTS);
        const useTextToVideo = shouldUseDirectTextToVideoFlow(selectedVideo);
        let generatedVideo: Buffer | undefined;
        let lastAdaptVideoError: unknown;

        for (let adaptAttempt = 1; adaptAttempt <= maxAdaptVideoAttempts; adaptAttempt += 1) {
          try {
            if (useTextToVideo) {
              generatedVideo = await generateVideoFromText(
                backstory,
                job.product,
                job.script,
                async () => undefined,
                generationAspectRatio,
                selectedVideo,
                job.guidelines,
                job.brief,
                job.soraPrompt,
                jobDir,
                job.promptVersion
              );
            } else {
              const generatedKeyframe = await generateKeyframe(
                backstory,
                job.product,
                job.script,
                job.guidelines,
                job.brief,
                backstory.setting ? [backstory.setting] : [],
                adaptAttempt - 1,
                generationAspectRatio,
                selectedVideo.type
              );

              const normalizedKeyframe = await normalizeKeyframeToFrame(jobId, generatedKeyframe, {
                width: generationWidth,
                height: generationHeight,
                sourceFileName: `keyframe-source-${target.slug}-gen-${adaptAttempt}.png`,
                outputFileName: `keyframe-${target.slug}-gen-${adaptAttempt}.png`
              });

              generatedVideo = await generateVideoFromImage(
                normalizedKeyframe,
                backstory,
                job.product,
                job.script,
                async () => undefined,
                generationAspectRatio,
                selectedVideo,
                job.guidelines,
                job.brief,
                jobDir,
                job.promptVersion
              );
            }
            break;
          } catch (error) {
            lastAdaptVideoError = error;
            if (useTextToVideo) {
              if (adaptAttempt >= maxAdaptVideoAttempts) {
                throw error;
              }
            } else if (adaptAttempt >= maxAdaptVideoAttempts || !isVeoCelebrityLikenessFilterError(error)) {
              throw error;
            }
            console.warn(
              useTextToVideo
                ? `[pipeline] adapt generation ${target.fileName} failed; retrying text-to-video generation (${adaptAttempt + 1}/${maxAdaptVideoAttempts}).`
                : `[pipeline] adapt generation ${target.fileName} hit celebrity-likeness filter; retrying with a regenerated keyframe (${adaptAttempt + 1}/${maxAdaptVideoAttempts}).`
            );
          }
        }

        if (!generatedVideo) {
          throw lastAdaptVideoError instanceof Error
            ? lastAdaptVideoError
            : new Error(`Adapt generation failed for ${target.fileName}.`);
        }

        const generatedPath = path.join(jobDir, `${baseName}-generated.mp4`);
        await fs.writeFile(generatedPath, generatedVideo);

        if (generationWidth !== target.width || generationHeight !== target.height) {
          await runCommand(
            FFMPEG_BIN,
            [
              "-y",
              "-i",
              generatedPath,
              "-filter_complex",
              adaptFilterGraph,
              "-map",
              "[v]",
              "-map",
              "0:a?",
              "-c:v",
              "libx264",
              "-preset",
              "medium",
              "-crf",
              "18",
              "-pix_fmt",
              "yuv420p",
              "-movflags",
              "+faststart",
              "-c:a",
              "copy",
              baseAdaptPath
            ],
            jobDir
          );
        } else {
          await fs.copyFile(generatedPath, baseAdaptPath);
        }

        await fs.unlink(generatedPath).catch(() => undefined);
      } else if (preserveBumperIdentity && !shouldUsePortraitMasterReframe) {
        const generationAspectRatio: SupportedAspectRatio = target.aspectRatio === "1:1" ? "9:16" : target.aspectRatio;
        const generationWidth = generationAspectRatio === "16:9" ? 1920 : 1080;
        const generationHeight = generationAspectRatio === "9:16" ? 1920 : 1080;
        const referenceFilterGraph = getAdaptFilterGraphForMode(
          generationWidth,
          generationHeight,
          generationAspectRatio === "16:9" ? "blur" : "cover",
          generationAspectRatio === "9:16" ? "upper" : "center"
        );
        const referenceImage = await extractAdaptReferenceFrame(
          jobDir,
          rawVideoPath,
          `adapt-reference-${target.slug}.png`,
          referenceFilterGraph
        );
        const generatedVideo = await generateVideoFromImage(
          referenceImage,
          backstory,
          job.product,
          job.script,
          async () => undefined,
          generationAspectRatio,
          selectedVideo,
          job.guidelines,
          job.brief,
          jobDir,
          job.promptVersion
        );
        const generatedPath = path.join(jobDir, `${baseName}-generated.mp4`);
        await fs.writeFile(generatedPath, generatedVideo);
        if (generationWidth !== target.width || generationHeight !== target.height) {
          await runCommand(
            FFMPEG_BIN,
            [
              "-y",
              "-i",
              generatedPath,
              "-filter_complex",
              adaptFilterGraph,
              "-map",
              "[v]",
              "-map",
              "0:a?",
              "-c:v",
              "libx264",
              "-preset",
              "medium",
              "-crf",
              "18",
              "-pix_fmt",
              "yuv420p",
              "-movflags",
              "+faststart",
              "-c:a",
              "copy",
              baseAdaptPath
            ],
            jobDir
          );
        } else {
          await fs.copyFile(generatedPath, baseAdaptPath);
        }
        await fs.unlink(generatedPath).catch(() => undefined);
      } else {
        const adaptSourcePath = preserveBumperIdentity ? rawVideoPath : rawVideoPath;
        await runCommand(
          FFMPEG_BIN,
          [
            "-y",
            "-i",
            adaptSourcePath,
            "-filter_complex",
            adaptFilterGraph,
            "-map",
            "[v]",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-c:a",
            "copy",
            baseAdaptPath
          ],
          jobDir
        );
      }

      let inlineCtaTiming: InlineCtaTiming | undefined;
      if (shouldUseInlineAirPlusCtaOverlay(job.product, job.script)) {
        try {
          inlineCtaTiming = await resolveInlineCtaTiming(job.script, baseAdaptPath, jobDir);
        } catch (error) {
          console.warn(`[pipeline] adapt inline CTA timing resolution failed for ${target.fileName}; continuing without CTA-timed super fade.`, error);
        }
      }

      try {
        const result = await renderSupersVideo(
          baseAdaptPath,
          outputPath,
          effectiveSupers,
          job.product,
          job.script,
          jobDir,
          `supers-debug-${target.slug}.json`,
          {
            super1DisplayEndSeconds: inlineCtaTiming?.startSeconds
          }
        );
        if (!result.applied) {
          await fs.copyFile(baseAdaptPath, outputPath);
        }
      } catch (error) {
        console.warn(`[pipeline] adapt supers render failed for ${target.fileName}; falling back to no-supers adapt`, error);
        await fs.copyFile(baseAdaptPath, outputPath);
      }

      if (inlineCtaTiming && job.product === "kotak_air_plus") {
        try {
          await applyAirPlusInlineCtaOverlay(outputPath, job.script, jobDir, inlineCtaTiming, {
            outputFileName: `final-with-inline-cta-${target.slug}.mp4`,
            debugFileName: `inline-cta-debug-${target.slug}.json`
          });
        } catch (error) {
          console.warn(`[pipeline] adapt inline CTA overlay failed for ${target.fileName}; keeping non-inline CTA adapt`, error);
        }
      }

      try {
        await applyFreezeLastFrame(outputPath, jobDir, undefined, MODEL_END_TRIM_SECONDS);
      } catch (error) {
        console.warn(`[pipeline] adapt freeze-frame render failed for ${target.fileName}; keeping non-freeze output`, error);
      }

      await fs.unlink(baseAdaptPath).catch(() => undefined);
    }
  } catch (error) {
    if (isFfmpegMissingError(error)) {
      throw new Error("Cannot generate adapts because ffmpeg/ffprobe is not installed in the environment.");
    }
    throw error;
  }

  return mutateJob(jobId, (state) => {
    state.assets.adaptSquareMp4 = ADAPT_SQUARE_FILENAME;
    state.assets.adaptLandscapeMp4 = ADAPT_LANDSCAPE_FILENAME;
  });
}

export async function promoteRawAttemptToFinal(
  jobId: string,
  rawFileName: string,
  qcFileName?: string
): Promise<Awaited<ReturnType<typeof mutateJob>>> {
  const job = await getJob(jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found.`);
  }

  const jobDir = getJobDir(jobId);
  const normalizedRawFileName = path.basename(rawFileName);
  const sourceRawPath = path.join(jobDir, normalizedRawFileName);
  if (!existsSync(sourceRawPath)) {
    throw new Error(`Raw attempt file not found: ${normalizedRawFileName}`);
  }

  const selectedVideo = resolveVideoConfig(job.video);
  const isHowToFlow = isHowToVideoType(selectedVideo.type);
  const effectiveSupers = resolveSupersConfig(job.supers, selectedVideo);
  let backstory = job.backstory;

  if (!backstory) {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(jobDir, "backstory.json"), "utf8"));
      backstory = backstorySchema.parse(parsed);
    } catch (error) {
      throw new Error(`Backstory not found for finalization (${error instanceof Error ? error.message : String(error)}).`);
    }
  }

  const rawVideoPath = path.join(jobDir, "raw.mp4");
  await fs.copyFile(sourceRawPath, rawVideoPath);
  if (!isHowToFlow && MODEL_END_TRIM_SECONDS > 0) {
    try {
      await applyFreezeLastFrame(rawVideoPath, jobDir, MODEL_END_TRIM_SECONDS, MODEL_END_TRIM_SECONDS);
    } catch (error) {
      console.warn("[pipeline] promoted raw ending stabilization failed; keeping promoted raw video without tail cleanup", error);
    }
  }

  const normalizedQcFileName = qcFileName ? path.basename(qcFileName) : undefined;
  if (normalizedQcFileName) {
    const sourceQcPath = path.join(jobDir, normalizedQcFileName);
    if (!existsSync(sourceQcPath)) {
      throw new Error(`QC file not found: ${normalizedQcFileName}`);
    }
    await fs.copyFile(sourceQcPath, path.join(jobDir, "qc.json"));
  }

  await mutateJob(jobId, (state) => {
    state.status = "running";
    state.error = undefined;
    state.assets.rawMp4 = "raw.mp4";
    state.assets.qcJson = normalizedQcFileName ? "qc.json" : state.assets.qcJson;
    state.assets.finalMp4 = undefined;
    const videoStep = state.steps.find((step) => step.id === "video");
    if (videoStep) {
      videoStep.status = "completed";
      videoStep.message = `Promoted ${normalizedRawFileName} into delivery flow.`;
    }
    const finalizeStep = state.steps.find((step) => step.id === "finalize");
    if (finalizeStep) {
      finalizeStep.status = "pending";
      finalizeStep.message = undefined;
    }
  });

  await finalizeRenderedVideo({
    jobId,
    runToken: job.runToken ?? randomUUID(),
    jobDir,
    product: job.product,
    script: job.script,
    backstory,
    rawVideoPath,
    supers: effectiveSupers,
    isHowToFlow,
    guidelines: job.guidelines,
    brief: job.brief
  });

  return (await getJob(jobId)) as Awaited<ReturnType<typeof mutateJob>>;
}

export async function generateBackstory(
  script: string,
  product: ProductKey,
  guidelines?: string,
  brief?: string,
  recentSignals: RecentBackstorySignals = createEmptyRecentBackstorySignals()
): Promise<Backstory> {
  const effectiveRecentSignals = mergeRecentBackstorySignals(
    getRuntimeRecentBackstorySignals(product),
    hasRecentBackstorySignals(recentSignals) ? recentSignals : await getRecentBackstorySignalsForProduct(product)
  );
  const ai = getClient();
  const response = await generateLogicContent(
    ai,
    "generateBackstory",
    getBackstoryPrompt(script, product, guidelines, brief, effectiveRecentSignals),
    0.6
  );

  const text = responseText(response).trim();
  if (!text) {
    throw new Error("Backstory response was empty.");
  }

  const json = parseJsonObject(text);
  const parsed = backstorySchema.parse(normalizeBackstoryShape(json));
  const sanitized = scrubBackstoryDevices(parsed, script, product, effectiveRecentSignals, brief);
  recordRuntimeRecentBackstory(product, sanitized);
  return sanitized;
}

async function generateKeyframe(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  guidelines?: string,
  brief?: string,
  recentSettings: string[] = [],
  safetyRetryAttempt = 0,
  aspectRatio: SupportedAspectRatio = PRIMARY_FRAME_SPEC.aspectRatio,
  videoType: VideoType = DEFAULT_VIDEO_CONFIG.type
): Promise<Buffer> {
  const ai = getClient();
  const sceneDirection = await generateSceneDirection(backstory, product, script, guidelines, brief, recentSettings);
  const maxForbiddenVisualRegenerations = Math.max(1, Number(process.env.KEYFRAME_TEXT_RETRY_ATTEMPTS ?? 3));
  let lastForbiddenVisualReason = "";

  for (let forbiddenVisualAttempt = 0; forbiddenVisualAttempt < maxForbiddenVisualRegenerations; forbiddenVisualAttempt += 1) {
    const retrySafetyDirective =
      safetyRetryAttempt > 0
        ? `Safety retry ${safetyRetryAttempt}: generate a distinctly new, fully fictional face identity with no resemblance to any known or public person.`
        : "";
    const forbiddenVisualDirective =
      forbiddenVisualAttempt > 0
        ? `Regeneration retry ${forbiddenVisualAttempt}: the previous image was rejected because it contained visible text, signage, lettering, or a card-like object. Do not show any terminal sign, storefront text, gate number, document, label, or card-shaped object anywhere.`
        : "";
    const prompt = `${buildVeoImagePromptFromSceneDirection(backstory, product, script, sceneDirection, aspectRatio, videoType, guidelines, brief)} ${retrySafetyDirective} ${forbiddenVisualDirective}`;
    const response = await withGenAiRetry(`generateKeyframe.${aspectRatio}`, () =>
      ai.models.generateImages({
        model: process.env.GEMINI_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL,
        prompt,
        config: {
          numberOfImages: 1,
          aspectRatio
        }
      })
    );

    const imageBytes = response.generatedImages?.[0]?.image?.imageBytes;
    if (!imageBytes) {
      throw new Error("Image generation did not return image bytes.");
    }

    const imageBuffer = Buffer.from(imageBytes, "base64");

    try {
      const inspection = await inspectGeneratedKeyframeForForbiddenVisuals(ai, imageBuffer);
      if (!inspection.hasForbiddenVisual) {
        return imageBuffer;
      }
      lastForbiddenVisualReason = inspection.reason;
      console.warn(`[pipeline] generated keyframe rejected due to forbidden visual: ${inspection.reason}`);
      continue;
    } catch (error) {
      console.warn("[pipeline] generated keyframe inspection failed; using prompt-only exclusions for this attempt", error);
      return imageBuffer;
    }
  }

  throw new Error(
    `Image generation repeatedly produced forbidden text/card visuals${lastForbiddenVisualReason ? `: ${lastForbiddenVisualReason}` : ""}.`
  );
}

interface NormalizeKeyframeOptions {
  width: number;
  height: number;
  sourceFileName: string;
  outputFileName: string;
}

async function normalizeKeyframeToDirectory(
  targetDir: string,
  sourceBytes: Buffer,
  options: NormalizeKeyframeOptions
): Promise<Buffer> {
  const sourcePath = path.join(targetDir, options.sourceFileName);
  const outputPath = path.join(targetDir, options.outputFileName);

  await fs.writeFile(sourcePath, sourceBytes);

  try {
    // Force a deterministic portrait frame for downstream image-to-video generation.
    await runCommand(
      FFMPEG_BIN,
      [
        "-y",
        "-i",
        sourcePath,
        "-vf",
        `scale=${options.width}:${options.height}:force_original_aspect_ratio=increase,crop=${options.width}:${options.height}`,
        "-frames:v",
        "1",
        outputPath
      ],
      targetDir
    );
    return fs.readFile(outputPath);
  } catch (error) {
    if (!isFfmpegMissingError(error)) {
      throw error;
    }

    // Fallback: keep generated image output so pipeline remains usable without ffmpeg.
    await fs.writeFile(outputPath, sourceBytes);
    return sourceBytes;
  }
}

async function normalizeKeyframeToFrame(jobId: string, sourceBytes: Buffer, options: NormalizeKeyframeOptions): Promise<Buffer> {
  return normalizeKeyframeToDirectory(getJobDir(jobId), sourceBytes, options);
}

async function normalizeKeyframeToPortrait(jobId: string, sourceBytes: Buffer): Promise<Buffer> {
  return normalizeKeyframeToFrame(jobId, sourceBytes, {
    width: KEYFRAME_WIDTH,
    height: KEYFRAME_HEIGHT,
    sourceFileName: "keyframe-source.png",
    outputFileName: "keyframe.png"
  });
}

async function copyFileIfExists(sourcePath: string, targetPath: string): Promise<void> {
  if (sourcePath === targetPath) {
    return;
  }
  try {
    await fs.copyFile(sourcePath, targetPath);
  } catch {
    // Ignore optional sidecar copy failures.
  }
}

export async function generateSharedImageFirstKeyframe(
  outputDir: string,
  backstory: Backstory,
  product: ProductKey,
  script: string,
  guidelines?: string,
  brief?: string,
  videoType: VideoType = DEFAULT_VIDEO_CONFIG.type
): Promise<Buffer> {
  await fs.mkdir(outputDir, { recursive: true });
  const rawKeyframe = await generateKeyframe(
    backstory,
    product,
    script,
    guidelines,
    brief,
    [],
    0,
    PRIMARY_FRAME_SPEC.aspectRatio,
    videoType
  );
  return normalizeKeyframeToDirectory(outputDir, rawKeyframe, {
    width: KEYFRAME_WIDTH,
    height: KEYFRAME_HEIGHT,
    sourceFileName: "shared-keyframe-source.png",
    outputFileName: "keyframe.png"
  });
}

function resolveFalImageSize(aspectRatio: SupportedAspectRatio, modelId: string = FAL_IMAGE_MODEL): string {
  const usesGptImage = /gpt-image-1(?:\.5)?/i.test(modelId);
  if (usesGptImage) {
    if (aspectRatio === "16:9") {
      return "1536x1024";
    }
    if (aspectRatio === "1:1") {
      return "1024x1024";
    }
    return "1024x1536";
  }

  if (aspectRatio === "16:9") {
    return "landscape_16_9";
  }
  if (aspectRatio === "1:1") {
    return "square_hd";
  }
  return "portrait_16_9";
}

function extractFalImageUrl(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const candidates: unknown[] = [];
  const value = data as {
    images?: Array<{ url?: unknown }>;
    image?: { url?: unknown } | string;
    url?: unknown;
  };
  if (Array.isArray(value.images)) {
    candidates.push(...value.images);
  }
  if (typeof value.image !== "undefined") {
    candidates.push(value.image);
  }
  if (typeof value.url !== "undefined") {
    candidates.push({ url: value.url });
  }
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
    if (candidate && typeof candidate === "object") {
      const maybeUrl = (candidate as { url?: unknown }).url;
      if (typeof maybeUrl === "string" && maybeUrl.trim()) {
        return maybeUrl.trim();
      }
    }
  }
  return undefined;
}

async function downloadImageBytesFromUrl(url: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    const detail = error instanceof Error ? `${error.message}${error.cause ? ` :: ${String(error.cause)}` : ""}` : String(error);
    throw new Error(`Image download fetch failed for ${url}: ${detail}`);
  }
  if (!response.ok) {
    throw new Error(`Image download failed for ${url}: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function generateFalImageBytes(prompt: string, aspectRatio: SupportedAspectRatio): Promise<Buffer> {
  const falClient = fal as unknown as {
    config: (config: { credentials: string }) => void;
    run: (
      endpointId: string,
      options: {
        input: Record<string, unknown>;
      }
    ) => Promise<{ data?: unknown }>;
  };
  falClient.config({ credentials: requireFalApiKey() });

  let result: { data?: unknown };
  try {
    result = await withGenAiRetry("fal.image.run", () =>
      withTimeout(
        falClient.run(FAL_IMAGE_MODEL, {
          input: {
            prompt,
          image_size: resolveFalImageSize(aspectRatio, FAL_IMAGE_MODEL),
          background: "auto",
          quality: "high",
          output_format: "png",
          num_images: 1,
          sync_mode: true
        }
      }),
        FAL_IMAGE_SUBSCRIBE_TIMEOUT_MS,
        `fal image generation timed out after ${FAL_IMAGE_POLL_MAX_ATTEMPTS} polls.`
      )
    );
  } catch (error) {
    const detail =
      error &&
      typeof error === "object" &&
      "body" in error &&
      typeof (error as { body?: unknown }).body !== "undefined"
        ? JSON.stringify((error as { body?: unknown }).body)
        : "";
    const cause =
      error &&
      typeof error === "object" &&
      "cause" in error &&
      typeof (error as { cause?: unknown }).cause !== "undefined"
        ? ` :: cause=${String((error as { cause?: unknown }).cause)}`
        : "";
    const base = error instanceof Error ? error.message : String(error);
    throw new Error(detail ? `${base}${cause} :: ${detail}` : `${base}${cause}`);
  }

  const imageUrl = extractFalImageUrl(result.data);
  if (!imageUrl) {
    throw new Error("fal image generation did not return an image URL.");
  }

  return withGenAiRetry("fal.image.download", () => downloadImageBytesFromUrl(imageUrl));
}

export async function generateSoraImageForVeoKeyframe(
  outputDir: string,
  backstory: Backstory,
  product: ProductKey,
  script: string,
  guidelines?: string,
  brief?: string,
  videoType: VideoType = DEFAULT_VIDEO_CONFIG.type
): Promise<Buffer> {
  await fs.mkdir(outputDir, { recursive: true });
  const imagePrompt = await buildVeoImagePromptDebug(
    backstory,
    product,
    script,
    PRIMARY_FRAME_SPEC.aspectRatio,
    videoType,
    guidelines,
    brief
  );
  const rawKeyframe = await generateFalImageBytes(imagePrompt.prompt, PRIMARY_FRAME_SPEC.aspectRatio);
  return normalizeKeyframeToDirectory(outputDir, rawKeyframe, {
    width: KEYFRAME_WIDTH,
    height: KEYFRAME_HEIGHT,
    sourceFileName: "sora-image-keyframe-source.png",
    outputFileName: "keyframe.png"
  });
}

async function generateVideoWithVeo(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  onPoll: (details: { attempt: number; status: string; operationName?: string }) => Promise<void>,
  aspectRatio: SupportedAspectRatio = PRIMARY_FRAME_SPEC.aspectRatio,
  videoConfig: VideoConfig = DEFAULT_VIDEO_CONFIG,
  guidelines?: string,
  brief?: string,
  keyframeBytes?: Buffer,
  jobDir?: string,
  forceVeo = false,
  promptVersion: PromptWriterVersion = DEFAULT_PROMPT_WRITER_VERSION
): Promise<Buffer> {
  const resolvedVideo = resolveVideoConfig(videoConfig);
  const pollPolicy = getVeoMotionPollPolicy(resolvedVideo);
  if (!forceVeo && shouldUseKlingForDuration(resolvedVideo.durationSeconds)) {
    return generateVideoWithKling(
      backstory,
      product,
      script,
      onPoll,
      aspectRatio,
      resolvedVideo,
      guidelines,
      brief,
      keyframeBytes,
      jobDir
    );
  }

  const ai = getClient();
  // Veo currently supports 4-8s per generation request. Extend in post when target duration is higher.
  const requestedDurationSeconds = clampNumber(Math.round(resolvedVideo.durationSeconds), 4, 8);
  const maybeExtendDuration = async (
    bytes: Buffer<ArrayBufferLike>,
    prefix: string
  ): Promise<Buffer<ArrayBufferLike>> => {
    if (!(resolvedVideo.durationSeconds > requestedDurationSeconds) || !jobDir) {
      return bytes;
    }
    try {
      return await extendVideoToTargetDuration(bytes, resolvedVideo.durationSeconds, jobDir, prefix);
    } catch (error) {
      if (!isFfmpegMissingError(error)) {
        throw error;
      }
      console.warn("[pipeline] could not extend Veo duration because ffmpeg/ffprobe is unavailable.");
      return bytes;
    }
  };
  const veoConfig: GenerateVideosConfig = {
    numberOfVideos: 1,
    aspectRatio,
    durationSeconds: requestedDurationSeconds,
    resolution: META_FORMAT.resolution
  };
  const veoModel = keyframeBytes
    ? process.env.GEMINI_VEO_MODEL?.trim() || DEFAULT_VEO_IMAGE_VIDEO_MODEL
    : process.env.GEMINI_VEO_TEXT_MODEL?.trim() ||
      process.env.GEMINI_VEO_STANDARD_MODEL?.trim() ||
      DEFAULT_VEO_TEXT_VIDEO_MODEL;
  const veoPrompt = await buildVeoMotionPrompt(
    backstory,
    product,
    script,
    aspectRatio,
    resolvedVideo.type,
    resolvedVideo.durationSeconds > 8 ? 8 : resolvedVideo.durationSeconds,
    guidelines,
    brief,
    Boolean(keyframeBytes),
    promptVersion
  );

  let operation = await withGenAiRetry("generateVideo.submit", () =>
    ai.models.generateVideos({
      model: veoModel,
      prompt: veoPrompt,
      ...(keyframeBytes
        ? {
            image: {
              imageBytes: keyframeBytes.toString("base64"),
              mimeType: "image/png"
            }
          }
        : {}),
      config: veoConfig
    })
  );

  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt += 1) {
    const done = Boolean(operation.done);
    const opName = (operation as { name?: string }).name;
    await onPoll({
      attempt,
      status: done ? "done" : "running",
      operationName: opName
    });

    if (done) {
      break;
    }

    await sleep(POLL_INTERVAL_MS);
    operation = await withGenAiRetry("generateVideo.poll", () =>
      ai.operations.getVideosOperation({ operation })
    );
  }

  if (!operation.done) {
    throw new Error(`Video operation timed out after ${POLL_MAX_ATTEMPTS} attempts.`);
  }

  const error = (operation as { error?: { message?: string } }).error;
  if (error?.message) {
    throw new Error(`Video generation failed: ${error.message}`);
  }

  const video = operation.response?.generatedVideos?.[0]?.video;
  const videoBytes = video?.videoBytes;
  if (videoBytes) {
    let output = Buffer.from(videoBytes, "base64") as Buffer<ArrayBufferLike>;
    output = await maybeExtendDuration(output, "veo-inline");
    return output;
  }

  const uri = video?.uri;
  if (uri) {
    const downloadResponse = await fetch(uri, {
      headers: {
        "x-goog-api-key": requireApiKey()
      }
    });

    if (downloadResponse.ok) {
      let output = Buffer.from(await downloadResponse.arrayBuffer()) as Buffer<ArrayBufferLike>;
      output = await maybeExtendDuration(output, "veo-uri");
      return output;
    }

    throw new Error(`Failed to download generated video: HTTP ${downloadResponse.status}`);
  }

  const filteredCount = operation.response?.raiMediaFilteredCount ?? 0;
  const filteredReasons = operation.response?.raiMediaFilteredReasons?.join(" | ");
  if (filteredCount > 0) {
    throw new Error(
      `Video output was filtered by safety policy (${filteredCount} item${filteredCount > 1 ? "s" : ""}).${
        filteredReasons ? ` Reasons: ${filteredReasons}` : ""
      }`
    );
  }

  throw new Error("Video output did not include a downloadable URI or inline bytes.");
}

async function generateVideoFromImage(
  keyframeBytes: Buffer,
  backstory: Backstory,
  product: ProductKey,
  script: string,
  onPoll: (details: { attempt: number; status: string; operationName?: string }) => Promise<void>,
  aspectRatio: SupportedAspectRatio = PRIMARY_FRAME_SPEC.aspectRatio,
  videoConfig: VideoConfig = DEFAULT_VIDEO_CONFIG,
  guidelines?: string,
  brief?: string,
  jobDir?: string,
  promptVersion: PromptWriterVersion = DEFAULT_PROMPT_WRITER_VERSION
): Promise<Buffer> {
  const resolvedVideo = resolveVideoConfig(videoConfig);
  if (resolvedVideo.provider === "veo31_standard") {
    return generateVideoWithFalVeoImage(
      keyframeBytes,
      backstory,
      product,
      script,
      onPoll,
      aspectRatio,
      resolvedVideo,
      guidelines,
      brief,
      jobDir,
      promptVersion
    );
  }
  if (resolvedVideo.provider === "sora_i2v") {
    return generateVideoWithFalVeoImage(
      keyframeBytes,
      backstory,
      product,
      script,
      onPoll,
      aspectRatio,
      resolvedVideo,
      guidelines,
      brief,
      jobDir,
      promptVersion
    );
  }
  return generateVideoWithVeo(
    backstory,
    product,
    script,
    onPoll,
    aspectRatio,
    videoConfig,
    guidelines,
    brief,
    keyframeBytes,
    jobDir,
    false,
    promptVersion
  );
}

interface KlingFileResource {
  url?: string;
  file_data?: string;
}

interface KlingSubscribeResult {
  requestId?: string;
  data?: unknown;
}

interface SoraVideoResource {
  id?: string;
  status?: string;
  error?: { message?: string } | string;
}

function normalizeKlingStatus(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === "in_queue") {
    return "queued";
  }
  if (normalized === "in_progress") {
    return "running";
  }
  if (normalized === "completed") {
    return "done";
  }
  return normalized || "running";
}

function extractKlingFileResource(value: unknown): KlingFileResource | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const maybeUrl = (value as { url?: unknown }).url;
  const maybeFileData = (value as { file_data?: unknown }).file_data;
  const resource: KlingFileResource = {};
  if (typeof maybeUrl === "string" && maybeUrl.trim()) {
    resource.url = maybeUrl.trim();
  }
  if (typeof maybeFileData === "string" && maybeFileData.trim()) {
    resource.file_data = maybeFileData.trim();
  }
  return resource.url || resource.file_data ? resource : undefined;
}

function extractKlingVideoResource(payload: unknown): KlingFileResource | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const objectPayload = payload as Record<string, unknown>;
  const direct = extractKlingFileResource(objectPayload.video);
  if (direct) {
    return direct;
  }

  if (Array.isArray(objectPayload.videos)) {
    for (const candidate of objectPayload.videos) {
      const fromList = extractKlingFileResource(candidate);
      if (fromList) {
        return fromList;
      }
    }
  }

  const nestedOutput = objectPayload.output;
  if (nestedOutput && typeof nestedOutput === "object") {
    const nested = extractKlingFileResource((nestedOutput as Record<string, unknown>).video);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

async function downloadKlingVideoResource(videoResource: KlingFileResource): Promise<Buffer<ArrayBufferLike>> {
  if (videoResource.file_data) {
    return Buffer.from(videoResource.file_data, "base64") as Buffer<ArrayBufferLike>;
  }

  if (!videoResource.url) {
    throw new Error("Kling output did not contain a downloadable video URL.");
  }

  const response = await fetch(videoResource.url);
  if (!response.ok) {
    throw new Error(`Kling video download failed: HTTP ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer()) as Buffer<ArrayBufferLike>;
}

function getKlingNegativePrompt(): string {
  return [
    "credit card",
    "debit card",
    "payment card",
    "physical card",
    "card close-up",
    "phone",
    "smartphone",
    "tablet",
    "laptop",
    "monitor",
    "screen",
    "UI overlay",
    "on-screen text",
    "background music",
    "subtitle",
    "watermark",
    "logo",
    "abrupt cut",
    "fade to black",
    "generic office lobby",
    "plain corporate corridor",
    "showroom",
    "railway concourse",
    "generic hallway"
  ].join(", ");
}

function getKlingPrompt(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  aspectRatio: SupportedAspectRatio,
  durationSeconds: number,
  videoType: VideoType,
  guidelines?: string,
  brief?: string
): string {
  const spec = PRODUCT_SPECS[product];
  const compactBrief = compactPromptContext(brief, 120);
  const compactGuidelines = compactPromptContext(guidelines, 120);
  const compactSpeakingStyle = FIXED_AD_DELIVERY_DESCRIPTOR;
  const compactAudience = compactPromptContext(spec.audienceSummary, 110);
  const compactProductMood = compactPromptContext(spec.imageVibe, 120);
  const trimmedScript = script.replace(/\s+/g, " ").trim();
  const maxScriptChars = 180;
  const scriptIntent = trimmedScript.length > maxScriptChars ? `${trimmedScript.slice(0, maxScriptChars - 1)}...` : trimmedScript;
  const isEightSecondBumper = videoType === "point_to_camera_multi_scene" && durationSeconds <= 8.5;
  const sceneBackgrounds = isEightSecondBumper ? deriveMultiSceneBackgroundPlan(product, script, brief).slice(0, 2) : [];
  const sceneBeats = isEightSecondBumper ? splitScriptIntoBeats(script, 2).slice(0, 2) : [];
  const sceneOneBeat = sceneBeats[0] ?? trimmedScript;
  const sceneTwoBeat = sceneBeats[1] ?? "Apply Now.";
  const mainSubjectLine = isEightSecondBumper
    ? `Main subject: affluent Indian persona, ${backstory.age_range}, based in ${backstory.city}, polished and premium but approachable.`
    : `Main subject: affluent Indian persona, ${backstory.age_range}, ${compactPromptContext(backstory.profession, 80)}, based in ${backstory.city}.`;
  const parts = [
    `Generate a ${Math.max(8, Math.round(durationSeconds))}-second ${aspectRatio} BOFU ad video.`,
    mainSubjectLine,
    `Performance tone: ${compactSpeakingStyle}.`,
    "Delivery style: direct-to-camera, conversational urgency, energetic but controlled pacing, with visible facial and body response that changes with each spoken beat.",
    "On-camera speech rule: the visible main character must deliver every scripted line on camera. No off-camera narrator, no voiceover-only treatment, no hidden speaker, and no disembodied speech.",
    product === "kotak_air_plus"
      ? "Cinematic style: premium editorial travel-film realism, rich but believable contrast, shallow depth separation, elegant lens feel, tasteful bokeh, and polished natural light. Keep the result aspirational and affluent, not flat corporate video."
      : "Cinematic style: premium editorial realism with natural depth, clean contrast, and polished but believable lighting.",
    "Accent rule: spoken delivery must sound like natural Indian English with a clear Indian accent suited to the persona and city context. Do not use American, British, or neutralized global-ad accents.",
    "Audio rules: voice only, clean and dry. No background music, score, jingle, sung vocal, rhythmic music bed, ambient sound bed, crowd bed, transit noise bed, room-tone build, or stylized sound design. Prefer silence over any non-speech bed.",
    "Human realism rule: the person must look fully photographic and human, not cartoonish, animated, illustrated, painterly, plastic, doll-like, CGI-like, beauty-filtered, over-smoothed, waxy, or uncanny. Avoid exaggerated jawlines, inflated hair volume, hyper-perfect symmetry, glamour-retouched skin, and overly sharp beard edges. Preserve natural skin texture, pores, asymmetry, and believable imperfections.",
    "Performance realism rule: no mannequin-still delivery, dead eyes, fixed grin, rigid shoulders, pinned elbows, robotic nodding, or repeated hand loops. Let the eyes, brows, mouth, posture, and one restrained gesture change with the words beat by beat.",
    "Visual rules: natural lighting, realistic textures, no cards, no phone/laptop/tablet/TV screens, no logos, no subtitles, no title cards, no signage text, and no other readable on-screen text.",
    product === "kotak_air_plus"
      ? "Air Plus world rule: every scene must clearly read as premium travel, trip-day business travel, hotel arrival, terminal-adjacent movement, or affluent mobility. Avoid generic office lobby, plain corporate corridor, railway concourse, and random urban curbside backdrops unless they contain unmistakable travel cues like luggage, concierge arrival, or departure movement."
      : "Cashback+ world rule: keep scenes grounded in practical everyday spend contexts, not generic corporate or luxury-travel worlds.",
    "Continuity rule: preserve the same face, hairstyle, facial hair, wardrobe palette, accessory story, lens feel, and color grade across all scenes.",
    "Dialogue lock rule: use the exact spoken script verbatim. Do not paraphrase, improvise, replace words, or introduce unrelated business, deployment, technology, or corporate wording.",
    "Script-order rule: the first core benefit must land in the opening third of the runtime, not late.",
    "Lip sync rule: if the subject is visibly speaking, mouth movement must stay believable and aligned through every scene, including the middle beat.",
    "Ending rule: complete the full spoken script cleanly, then hold direct eye contact with a subtle smile on the same shot for the final 0.6 to 0.8 seconds. No abrupt transition and no cut before the last word finishes.",
    "Do not add a last-second cut, turn, zoom, new gesture, or extra action after dialogue completion.",
    isEightSecondBumper ? "Structure rule: use exactly 2 scenes with exactly 1 clean cut on a sentence boundary." : "",
    isEightSecondBumper ? `Scene 1 dialogue must be exactly: ${sceneOneBeat}` : "",
    isEightSecondBumper ? `Scene 2 dialogue must be exactly: ${sceneTwoBeat}` : "",
    isEightSecondBumper && sceneBackgrounds[0] ? `Scene 1 setting: ${sceneBackgrounds[0]}.` : "",
    isEightSecondBumper && sceneBackgrounds[1] ? `Scene 2 setting: ${sceneBackgrounds[1]}.` : "",
    isEightSecondBumper && product === "kotak_air_plus"
      ? "For Air Plus bumpers, profession is styling context only. It must not push the scene into an office, showroom, or plain corporate corridor. Both scenes must show unmistakable premium travel-day cues such as luggage, terminal-adjacent architecture, hotel arrival, departure movement, concierge, or cab transfer."
      : "",
    isEightSecondBumper
      ? "Do not invent abstract business copy, corporate mission language, or global-mobility phrasing. The only spoken words must be the exact provided script."
      : "",
    `Product mood: ${compactProductMood}.`,
    `Audience: ${compactAudience}.`,
    compactBrief ? `Campaign brief: ${compactBrief}.` : "",
    compactGuidelines ? `Brand guidance: ${compactGuidelines}.` : "",
    `Spoken intent: ${scriptIntent}`
  ];

  return clampPromptToSentenceBoundary(parts.filter(Boolean).join(" "), KLING_PROMPT_MAX_CHARS);
}

async function generateVideoWithKling(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  onPoll: (details: { attempt: number; status: string; operationName?: string }) => Promise<void>,
  aspectRatio: SupportedAspectRatio = PRIMARY_FRAME_SPEC.aspectRatio,
  videoConfig: VideoConfig = DEFAULT_VIDEO_CONFIG,
  guidelines?: string,
  brief?: string,
  _keyframeBytes?: Buffer,
  jobDir?: string
): Promise<Buffer> {
  const resolvedVideo = resolveVideoConfig(videoConfig);
  const pollPolicy = getKlingMotionPollPolicy(resolvedVideo);
  const requestedSeconds = Math.max(4, Math.round(resolvedVideo.durationSeconds));
  const timing = resolveKlingSeconds(requestedSeconds);
  const falClient = fal as unknown as {
    config: (config: { credentials: string }) => void;
    subscribe: (
      endpointId: string,
      options: {
        input: Record<string, unknown>;
        mode?: "polling";
        pollInterval?: number;
        onQueueUpdate?: (update: { status?: string; request_id?: string }) => void;
      }
    ) => Promise<KlingSubscribeResult>;
  };
  falClient.config({ credentials: requireFalApiKey() });

  const endpointId = KLING_TEXT_MODEL;
  const prompt = getKlingPrompt(
    backstory,
    product,
    script,
    aspectRatio,
    resolvedVideo.durationSeconds,
    resolvedVideo.type,
    guidelines,
    brief
  );
  const input: Record<string, unknown> = {
    prompt,
    duration: timing.requestSeconds,
    aspect_ratio: aspectRatio,
    negative_prompt: getKlingNegativePrompt()
  };

  let pollAttempt = 0;
  const emitPoll = (status: string, operationName?: string): void => {
    pollAttempt += 1;
    void onPoll({ attempt: pollAttempt, status, operationName }).catch((error) => {
      console.warn("[pipeline] kling poll callback failed", error);
    });
  };

  const result = await withKlingRetry("kling.subscribe", async () =>
    await withTimeout(
      falClient.subscribe(endpointId, {
        input,
        mode: "polling",
        pollInterval: pollPolicy.intervalMs,
        onQueueUpdate(update) {
          const statusRaw = typeof update.status === "string" ? update.status : "IN_PROGRESS";
          const requestId = typeof update.request_id === "string" ? update.request_id : undefined;
          emitPoll(normalizeKlingStatus(statusRaw), requestId);
        }
      }),
      pollPolicy.subscribeTimeoutMs ?? KLING_SUBSCRIBE_TIMEOUT_MS,
      `Kling operation timed out after ${pollPolicy.maxAttempts} polls.`
    )
  );

  const requestId = typeof result.requestId === "string" ? result.requestId : undefined;
  if (pollAttempt === 0) {
    await onPoll({ attempt: 1, status: "running", operationName: requestId });
    pollAttempt = 1;
  }
  await onPoll({ attempt: pollAttempt + 1, status: "done", operationName: requestId });

  const videoResource = extractKlingVideoResource(result.data);
  if (!videoResource) {
    throw new Error("Kling output did not contain a generated video.");
  }

  let videoBytes = await withKlingRetry("kling.download", () => downloadKlingVideoResource(videoResource));
  if (jobDir && Math.abs(requestedSeconds - Number(timing.requestSeconds)) > 0.03) {
    try {
      videoBytes = await extendVideoToTargetDuration(videoBytes, requestedSeconds, jobDir, `kling-${requestId ?? "video"}`);
    } catch (error) {
      if (!isFfmpegMissingError(error)) {
        throw error;
      }
      console.warn("[pipeline] could not extend Kling duration because ffmpeg/ffprobe is unavailable.");
    }
  }

  return videoBytes;
}

type FalVeoDurationSeconds = "4s" | "6s" | "8s";
type FalVeoResolution = "720p" | "1080p";

interface FalQueueStatusPayload {
  status?: string;
  request_id?: string;
  queue_position?: number;
}

interface FalQueueClientLike {
  config: (config: { credentials: string }) => void;
  queue: {
    submit: (
      endpointId: string,
      options: {
        input: Record<string, unknown>;
      }
    ) => Promise<FalQueueStatusPayload>;
    status: (
      endpointId: string,
      options: {
        requestId: string;
        logs?: boolean;
      }
    ) => Promise<FalQueueStatusPayload>;
    result: (endpointId: string, options: { requestId: string }) => Promise<KlingSubscribeResult>;
  };
  storage?: {
    upload: (file: Blob) => Promise<string>;
  };
}

function resolveFalVeoSeconds(targetSeconds: number): { requestSeconds: FalVeoDurationSeconds; targetSeconds: number } {
  if (targetSeconds <= 4) {
    return { requestSeconds: "4s", targetSeconds };
  }
  if (targetSeconds <= 6) {
    return { requestSeconds: "6s", targetSeconds };
  }
  return { requestSeconds: "8s", targetSeconds };
}

function resolveFalVeoResolution(aspectRatio: SupportedAspectRatio): FalVeoResolution {
  void aspectRatio;
  return "1080p";
}

async function submitAndWaitForFalVideoResult(
  falClient: FalQueueClientLike,
  endpointId: string,
  input: Record<string, unknown>,
  onPoll: (details: { attempt: number; status: string; operationName?: string }) => Promise<void>,
  pollPolicy: { intervalMs: number; maxAttempts: number; subscribeTimeoutMs?: number },
  providerLabel: string
): Promise<KlingSubscribeResult> {
  const submitResult = await withProviderStage(providerLabel, "submit", () =>
    withGenAiRetry(`${providerLabel}.submit`, () =>
      falClient.queue.submit(endpointId, {
        input
      })
    )
  );

  const requestId = typeof submitResult.request_id === "string" ? submitResult.request_id : "";
  if (!requestId) {
    throw new Error(`${providerLabel} submit response did not include request_id.`);
  }

  let attempt = 1;
  const timeoutAt = Date.now() + (pollPolicy.subscribeTimeoutMs ?? FAL_VEO_SUBSCRIBE_TIMEOUT_MS);
  await onPoll({
    attempt,
    status: normalizeKlingStatus(typeof submitResult.status === "string" ? submitResult.status : "IN_QUEUE"),
    operationName: requestId
  });

  let terminalStatus = typeof submitResult.status === "string" ? submitResult.status : "IN_QUEUE";
  while (attempt < pollPolicy.maxAttempts && Date.now() < timeoutAt) {
    await sleep(pollPolicy.intervalMs);
    const statusResult = await withProviderStage(providerLabel, `status (${requestId})`, () =>
      withGenAiRetry(`${providerLabel}.status`, () =>
        falClient.queue.status(endpointId, {
          requestId,
          logs: true
        })
      )
    );
    attempt += 1;
    terminalStatus = typeof statusResult.status === "string" ? statusResult.status : terminalStatus;
    await onPoll({
      attempt,
      status: normalizeKlingStatus(terminalStatus),
      operationName: requestId
    });
    if (terminalStatus === "COMPLETED") {
      const result = await withProviderStage(providerLabel, `result (${requestId})`, () =>
        withGenAiRetry(`${providerLabel}.result`, () =>
          falClient.queue.result(endpointId, {
            requestId
          })
        )
      );
      await onPoll({
        attempt: attempt + 1,
        status: "done",
        operationName: requestId
      });
      return {
        ...result,
        requestId: typeof result.requestId === "string" && result.requestId ? result.requestId : requestId
      };
    }
  }

  throw new ProviderPollTimeoutError(
    `${providerLabel} operation timed out after ${attempt} polls. requestId=${requestId}`
  );
}

async function generateVideoWithFalVeo(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  onPoll: (details: { attempt: number; status: string; operationName?: string }) => Promise<void>,
  aspectRatio: SupportedAspectRatio = PRIMARY_FRAME_SPEC.aspectRatio,
  videoConfig: VideoConfig = DEFAULT_VIDEO_CONFIG,
  guidelines?: string,
  brief?: string,
  jobDir?: string,
  promptVersion: PromptWriterVersion = DEFAULT_PROMPT_WRITER_VERSION
): Promise<Buffer> {
  return withVeoConcurrencyLimit(async () => {
    const resolvedVideo = resolveVideoConfig(videoConfig);
    const pollPolicy = getFalVeoMotionPollPolicy(resolvedVideo);
    const requestedSeconds = Math.max(4, Math.round(resolvedVideo.durationSeconds));
    const timing = resolveFalVeoSeconds(requestedSeconds);
    const falClient = fal as unknown as FalQueueClientLike;
    falClient.config({ credentials: requireFalApiKey() });

    const prompt = await buildVeoMotionPrompt(
      backstory,
      product,
      script,
      aspectRatio,
      resolvedVideo.type,
      Math.min(8, resolvedVideo.durationSeconds),
      guidelines,
      brief,
      false,
      promptVersion
    );
    const input: Record<string, unknown> = {
      prompt,
      aspect_ratio: resolveFalSoraAspectRatio(aspectRatio),
      duration: timing.requestSeconds,
      resolution: resolveFalVeoResolution(aspectRatio),
      generate_audio: true,
      auto_fix: true,
      safety_tolerance: "4",
      negative_prompt: getKlingNegativePrompt()
    };

    const result = await submitAndWaitForFalVideoResult(
      falClient,
      FAL_VEO_TEXT_MODEL,
      input,
      onPoll,
      pollPolicy,
      "fal.veo.text"
    );
    const requestId = typeof result.requestId === "string" ? result.requestId : undefined;
    const videoResource = extractKlingVideoResource(result.data);
    if (!videoResource) {
      throw new Error("fal Veo output did not contain a generated video.");
    }

    let videoBytes = await withProviderStage("fal.veo.text", "download", () =>
      withGenAiRetry("fal.veo.download", () => downloadKlingVideoResource(videoResource))
    );
    if (jobDir && Math.abs(requestedSeconds - Number.parseInt(timing.requestSeconds, 10)) > 0.03) {
      try {
        videoBytes = await extendVideoToTargetDuration(videoBytes, requestedSeconds, jobDir, `fal-veo-${requestId ?? "video"}`);
      } catch (error) {
        if (!isFfmpegMissingError(error)) {
          throw error;
        }
        console.warn("[pipeline] could not extend fal Veo duration because ffmpeg/ffprobe is unavailable.");
      }
    }

    return videoBytes;
  });
}

async function generateVideoWithFalVeoImage(
  keyframeBytes: Buffer,
  backstory: Backstory,
  product: ProductKey,
  script: string,
  onPoll: (details: { attempt: number; status: string; operationName?: string }) => Promise<void>,
  aspectRatio: SupportedAspectRatio = PRIMARY_FRAME_SPEC.aspectRatio,
  videoConfig: VideoConfig = DEFAULT_VIDEO_CONFIG,
  guidelines?: string,
  brief?: string,
  jobDir?: string,
  promptVersion: PromptWriterVersion = DEFAULT_PROMPT_WRITER_VERSION
): Promise<Buffer> {
  return withVeoConcurrencyLimit(async () => {
    const resolvedVideo = resolveVideoConfig(videoConfig);
    const pollPolicy = getFalVeoMotionPollPolicy(resolvedVideo);
    const requestedSeconds = Math.max(4, Math.round(resolvedVideo.durationSeconds));
    const timing = resolveFalVeoSeconds(requestedSeconds);
    const falClient = fal as unknown as FalQueueClientLike;
    falClient.config({ credentials: requireFalApiKey() });

    if (!falClient.storage) {
      throw new Error("fal storage client is not available for Veo image-to-video uploads.");
    }

    const uploadedKeyframeUrl = await withProviderStage("fal.veo.image", "upload keyframe", () =>
      withGenAiRetry("fal.veo.uploadKeyframe", () =>
        falClient.storage!.upload(new Blob([keyframeBytes], { type: "image/png" }))
      )
    );
    const prompt =
      resolvedVideo.provider === "sora_i2v"
        ? getCompactReferenceLockedVeoPrompt(
            backstory,
            product,
            script,
            aspectRatio,
            Math.min(8, resolvedVideo.durationSeconds),
            guidelines,
            brief
          )
        : await buildVeoMotionPrompt(
            backstory,
            product,
            script,
            aspectRatio,
            resolvedVideo.type,
            Math.min(8, resolvedVideo.durationSeconds),
            guidelines,
            brief,
            true,
            promptVersion
          );
    const input: Record<string, unknown> = {
      prompt,
      image_url: uploadedKeyframeUrl,
      aspect_ratio: resolveFalSoraAspectRatio(aspectRatio),
      duration: timing.requestSeconds,
      resolution: resolveFalVeoResolution(aspectRatio),
      generate_audio: true,
      auto_fix: true,
      safety_tolerance: "4",
      negative_prompt: getKlingNegativePrompt()
    };

    const result = await submitAndWaitForFalVideoResult(
      falClient,
      FAL_VEO_IMAGE_MODEL,
      input,
      onPoll,
      pollPolicy,
      "fal.veo.image"
    );
    const requestId = typeof result.requestId === "string" ? result.requestId : undefined;
    const videoResource = extractKlingVideoResource(result.data);
    if (!videoResource) {
      throw new Error("fal Veo image-to-video output did not contain a generated video.");
    }

    let videoBytes = await withProviderStage("fal.veo.image", "download", () =>
      withGenAiRetry("fal.veo.image.download", () => downloadKlingVideoResource(videoResource))
    );
    if (jobDir && Math.abs(requestedSeconds - Number.parseInt(timing.requestSeconds, 10)) > 0.03) {
      try {
        videoBytes = await extendVideoToTargetDuration(videoBytes, requestedSeconds, jobDir, `fal-veo-image-${requestId ?? "video"}`);
      } catch (error) {
        if (!isFfmpegMissingError(error)) {
          throw error;
        }
        console.warn("[pipeline] could not extend fal Veo image-to-video duration because ffmpeg/ffprobe is unavailable.");
      }
    }

    return videoBytes;
  });
}

async function generateVideoWithFalSora(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  onPoll: (details: { attempt: number; status: string; operationName?: string }) => Promise<void>,
  aspectRatio: SupportedAspectRatio = PRIMARY_FRAME_SPEC.aspectRatio,
  videoConfig: VideoConfig = DEFAULT_VIDEO_CONFIG,
  guidelines?: string,
  brief?: string,
  jobDir?: string,
  promptOverride?: string
): Promise<Buffer> {
  const resolvedVideo = resolveVideoConfig(videoConfig);
  const pollPolicy = getFalSoraMotionPollPolicy(resolvedVideo);
  const requestedSeconds = Math.max(4, Math.round(resolvedVideo.durationSeconds));
  const timing = resolveSoraSeconds(requestedSeconds);
  const falClient = fal as unknown as {
    config: (config: { credentials: string }) => void;
    subscribe: (
      endpointId: string,
      options: {
        input: Record<string, unknown>;
        mode?: "polling";
        pollInterval?: number;
        onQueueUpdate?: (update: { status?: string; request_id?: string }) => void;
      }
    ) => Promise<KlingSubscribeResult>;
  };
  falClient.config({ credentials: requireFalApiKey() });

  const prompt = clampPromptToSentenceBoundary(
    promptOverride ??
      (await buildSoraMotionPrompt(
        backstory,
        product,
        script,
        aspectRatio,
        resolvedVideo.type,
        resolvedVideo.durationSeconds,
        guidelines,
        brief,
        false
      )),
    FAL_SORA_PROMPT_MAX_CHARS
  );
  const input: Record<string, unknown> = {
    prompt,
    resolution: FAL_SORA_RESOLUTION,
    aspect_ratio: resolveFalSoraAspectRatio(aspectRatio),
    duration: timing.requestSeconds,
    delete_video: true
  };

  let pollAttempt = 0;
  const emitPoll = (status: string, operationName?: string): void => {
    pollAttempt += 1;
    void onPoll({ attempt: pollAttempt, status, operationName }).catch((error) => {
      console.warn("[pipeline] fal sora poll callback failed", error);
    });
  };

  const result = await withSoraRetry("fal.sora.subscribe", async () =>
    await withTimeout(
      falClient.subscribe(FAL_SORA_TEXT_MODEL, {
        input,
        mode: "polling",
        pollInterval: pollPolicy.intervalMs,
        onQueueUpdate(update) {
          const statusRaw = typeof update.status === "string" ? update.status : "IN_PROGRESS";
          const requestId = typeof update.request_id === "string" ? update.request_id : undefined;
          emitPoll(normalizeKlingStatus(statusRaw), requestId);
        }
      }),
      pollPolicy.subscribeTimeoutMs ?? FAL_SORA_SUBSCRIBE_TIMEOUT_MS,
      `fal Sora operation timed out after ${pollPolicy.maxAttempts} polls.`
    )
  );

  const requestId = typeof result.requestId === "string" ? result.requestId : undefined;
  if (pollAttempt === 0) {
    await onPoll({ attempt: 1, status: "running", operationName: requestId });
    pollAttempt = 1;
  }
  await onPoll({ attempt: pollAttempt + 1, status: "done", operationName: requestId });

  const videoResource = extractKlingVideoResource(result.data);
  if (!videoResource) {
    throw new Error("fal Sora output did not contain a generated video.");
  }

  let videoBytes = await withSoraRetry("fal.sora.download", () => downloadKlingVideoResource(videoResource));
  if (jobDir && Math.abs(requestedSeconds - Number(timing.requestSeconds)) > 0.03) {
    try {
      videoBytes = await extendVideoToTargetDuration(videoBytes, requestedSeconds, jobDir, `fal-sora-${requestId ?? "video"}`);
    } catch (error) {
      if (!isFfmpegMissingError(error)) {
        throw error;
      }
      console.warn("[pipeline] could not extend fal Sora duration because ffmpeg/ffprobe is unavailable.");
    }
  }

  return videoBytes;
}

async function enhanceVideoWithFalTopaz(
  videoBytes: Buffer,
  onPoll: (details: { attempt: number; status: string; operationName?: string }) => Promise<void>,
  videoConfig: VideoConfig = DEFAULT_VIDEO_CONFIG
): Promise<Buffer> {
  void videoConfig;
  const falClient = fal as unknown as {
    config: (config: { credentials: string }) => void;
    subscribe: (
      endpointId: string,
      options: {
        input: Record<string, unknown>;
        mode?: "polling";
        pollInterval?: number;
        onQueueUpdate?: (update: { status?: string; request_id?: string }) => void;
      }
    ) => Promise<KlingSubscribeResult>;
    storage: {
      upload: (file: Blob) => Promise<string>;
    };
  };
  falClient.config({ credentials: requireFalApiKey() });

  const uploadedVideoUrl = await withGenAiRetry("fal.topaz.uploadVideo", () =>
    falClient.storage.upload(new Blob([videoBytes], { type: "video/mp4" }))
  );

  const input: Record<string, unknown> = {
    video_url: uploadedVideoUrl,
    upscale_factor: TOPAZ_UPSCALE_FACTOR,
    model: TOPAZ_MODEL,
    recover_detail: clampTopazFloat(TOPAZ_RECOVER_DETAIL, 0.35),
    compression: clampTopazFloat(TOPAZ_COMPRESSION, 0.12),
    noise: clampTopazFloat(TOPAZ_NOISE, 0.1),
    halo: clampTopazFloat(TOPAZ_HALO, 0.08),
    grain: clampTopazFloat(TOPAZ_GRAIN, 0.03),
    H264_output: TOPAZ_H264_OUTPUT
  };

  let pollAttempt = 0;
  const emitPoll = (status: string, operationName?: string): void => {
    pollAttempt += 1;
    void onPoll({ attempt: pollAttempt, status, operationName }).catch((error) => {
      console.warn("[pipeline] fal topaz poll callback failed", error);
    });
  };

  const result = await withGenAiRetry("fal.topaz.subscribe", async () =>
    await withTimeout(
      falClient.subscribe(FAL_TOPAZ_VIDEO_MODEL, {
        input,
        mode: "polling",
        pollInterval: FAL_TOPAZ_POLL_INTERVAL_MS,
        onQueueUpdate(update) {
          const statusRaw = typeof update.status === "string" ? update.status : "IN_PROGRESS";
          const requestId = typeof update.request_id === "string" ? update.request_id : undefined;
          emitPoll(normalizeKlingStatus(statusRaw), requestId);
        }
      }),
      FAL_TOPAZ_SUBSCRIBE_TIMEOUT_MS,
      `fal Topaz operation timed out after ${FAL_TOPAZ_POLL_MAX_ATTEMPTS} polls.`
    )
  );

  const requestId = typeof result.requestId === "string" ? result.requestId : undefined;
  if (pollAttempt === 0) {
    await onPoll({ attempt: 1, status: "running", operationName: requestId });
    pollAttempt = 1;
  }
  await onPoll({ attempt: pollAttempt + 1, status: "done", operationName: requestId });

  const videoResource = extractKlingVideoResource(result.data) || extractKlingFileResource(result.data);
  if (!videoResource) {
    throw new Error("fal Topaz output did not contain an enhanced video.");
  }

  return withGenAiRetry("fal.topaz.download", async () =>
    await withTimeout(
      downloadKlingVideoResource(videoResource),
      FAL_TOPAZ_DOWNLOAD_TIMEOUT_MS,
      `fal Topaz download timed out after ${Math.round(FAL_TOPAZ_DOWNLOAD_TIMEOUT_MS / 1000)} seconds.`
    )
  );
}

async function generateVideoFromText(
  backstory: Backstory,
  product: ProductKey,
  script: string,
  onPoll: (details: { attempt: number; status: string; operationName?: string }) => Promise<void>,
  aspectRatio: SupportedAspectRatio = PRIMARY_FRAME_SPEC.aspectRatio,
  videoConfig: VideoConfig = DEFAULT_VIDEO_CONFIG,
  guidelines?: string,
  brief?: string,
  soraPromptOverride?: string,
  jobDir?: string,
  promptVersion: PromptWriterVersion = DEFAULT_PROMPT_WRITER_VERSION
): Promise<Buffer> {
  const resolvedVideo = resolveVideoConfig(videoConfig);
  const provider = resolveTextToVideoProvider(resolvedVideo);
  if (provider === "veo31_standard") {
    return generateVideoWithFalVeo(
      backstory,
      product,
      script,
      onPoll,
      aspectRatio,
      resolvedVideo,
      guidelines,
      brief,
      jobDir,
      promptVersion
    );
  }
  if (shouldPreferFalSoraFor1080p(resolvedVideo)) {
    return generateVideoWithFalSora(
      backstory,
      product,
      script,
      onPoll,
      aspectRatio,
      resolvedVideo,
      guidelines,
      brief,
      jobDir,
      soraPromptOverride
    );
  }
  const pollPolicy = getSoraMotionPollPolicy(resolvedVideo);
  const useSoraOnlyFallbackChain = shouldUseSoraOnlyTextToVideo(product, resolvedVideo);
  if (shouldUseKlingForDuration(resolvedVideo.durationSeconds) && !soraPromptOverride?.trim()) {
    return generateVideoWithKling(
      backstory,
      product,
      script,
      onPoll,
      aspectRatio,
      resolvedVideo,
      guidelines,
      brief,
      undefined,
      jobDir
    );
  }

  let soraPrompt = soraPromptOverride?.trim() || "";
  try {
    const requestedSeconds = Math.max(4, Math.round(resolvedVideo.durationSeconds));
    const timing = resolveSoraSeconds(requestedSeconds);
    if (!soraPrompt) {
      soraPrompt = await buildSoraMotionPrompt(
        backstory,
        product,
        script,
        aspectRatio,
        resolvedVideo.type,
        resolvedVideo.durationSeconds,
        guidelines,
        brief,
        false,
        promptVersion
      );
    }
    const apiKey = requireOpenAiApiKey();
    const soraSize = resolveSoraSize(aspectRatio);
    const form = new FormData();
    form.set("model", resolveSoraModel(soraSize));
    form.set("prompt", soraPrompt);
    form.set("seconds", String(timing.requestSeconds));
    form.set("size", soraSize);

    let videoResource = await withSoraRetry("sora.submit", async () => {
      const response = await fetch(`${OPENAI_API_BASE}/videos`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        body: form
      });
      if (!response.ok) {
        const message = await parseOpenAiErrorMessage(response);
        throw new Error(`Video generation failed: HTTP ${response.status} ${message}`);
      }
      return (await response.json()) as SoraVideoResource;
    });

    const videoId = videoResource.id?.trim();
    if (!videoId) {
      throw new Error("Video generation failed: missing video id.");
    }

    for (let attempt = 1; attempt <= pollPolicy.maxAttempts; attempt += 1) {
      const status = (videoResource.status ?? "processing").toLowerCase();
      await onPoll({
        attempt,
        status,
        operationName: videoId
      });

      if (status === "completed") {
        break;
      }

      if (status === "failed" || status === "cancelled" || status === "expired") {
        const errorValue = videoResource.error;
        const providerMessage =
          typeof errorValue === "string"
            ? errorValue
            : typeof errorValue?.message === "string"
              ? errorValue.message
              : "Video generation failed.";
        throw new Error(`Video generation failed: ${providerMessage}`);
      }

      await sleep(pollPolicy.intervalMs);
      videoResource = await withSoraRetry("sora.poll", async () => {
        const response = await fetch(`${OPENAI_API_BASE}/videos/${videoId}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`
          }
        });
        if (!response.ok) {
          const message = await parseOpenAiErrorMessage(response);
          throw new Error(`Video polling failed: HTTP ${response.status} ${message}`);
        }
        return (await response.json()) as SoraVideoResource;
      });
    }

    if ((videoResource.status ?? "").toLowerCase() !== "completed") {
      throw new Error(`Video operation timed out after ${pollPolicy.maxAttempts} polls.`);
    }

    const contentResponse = await withSoraRetry("sora.download", async () => {
      const response = await fetch(`${OPENAI_API_BASE}/videos/${videoId}/content`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      });
      if (!response.ok) {
        const message = await parseOpenAiErrorMessage(response);
        throw new Error(`Video content download failed: HTTP ${response.status} ${message}`);
      }
      return response;
    });

    let videoBytes = Buffer.from(await contentResponse.arrayBuffer()) as Buffer<ArrayBufferLike>;
    if (timing.targetSeconds > timing.requestSeconds && jobDir) {
      try {
        videoBytes = await extendVideoToTargetDuration(videoBytes, timing.targetSeconds, jobDir, `sora-${videoId}`);
      } catch (error) {
        if (!isFfmpegMissingError(error)) {
          throw error;
        }
        console.warn("[pipeline] could not extend Sora duration because ffmpeg/ffprobe is unavailable.");
      }
    }

    return videoBytes;
  } catch (error) {
    if (!process.env.FAL_KEY?.trim()) {
      throw error;
    }
    console.warn("[pipeline] Sora text-to-video failed; falling back to fal Sora 2.", error);
    await onPoll({
      attempt: 1,
      status: "fallback_to_fal_sora_2",
      operationName: "fal-sora-2"
    });
    try {
      return await generateVideoWithFalSora(
        backstory,
        product,
        script,
        onPoll,
        aspectRatio,
        resolvedVideo,
        guidelines,
        brief,
        jobDir,
        soraPrompt
      );
    } catch (falSoraError) {
      if (useSoraOnlyFallbackChain) {
        throw falSoraError;
      }
      console.warn("[pipeline] fal Sora text-to-video failed; falling back to Kling.", falSoraError);
      await onPoll({
        attempt: 1,
        status: "fallback_to_kling",
        operationName: "kling"
      });
      return generateVideoWithKling(
        backstory,
        product,
        script,
        onPoll,
        aspectRatio,
        resolvedVideo,
        guidelines,
        brief,
        undefined,
        jobDir
      );
    }
  }
}

export async function runPipeline(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found.`);
  }

  const runToken = job.runToken ?? randomUUID();
  if (!job.runToken) {
    await mutateJob(jobId, (state) => {
      state.runToken = runToken;
    });
  }

  const ensureActiveRun = async (): Promise<void> => {
    await ensureCurrentJobRun(jobId, runToken);
  };
  const mutateCurrentJob = async (mutate: (state: JobRecord) => void): Promise<void> => {
    await mutateJobForRun(jobId, runToken, mutate);
  };
  const updateCurrentStep = async (
    stepId: "backstory" | "keyframe" | "video" | "finalize",
    status: "pending" | "running" | "completed" | "failed",
    message?: string
  ): Promise<void> => {
    await updateStepForRun(jobId, runToken, stepId, status, message);
  };
  const setCurrentStatus = async (status: "queued" | "running" | "completed" | "failed", error?: string): Promise<void> => {
    await setJobStatusForRun(jobId, runToken, status, error);
  };

  await setCurrentStatus("running");
  const jobDir = getJobDir(jobId);
  let selectedVideo = resolveVideoConfig(job.video);
  const providerAssetFiles = getProviderAssetFileNames(selectedVideo.provider);
  if (isHowToVideoType(selectedVideo.type)) {
    const autoDuration = estimateHowToDurationSeconds(job.howTo?.stepsText ?? job.script, job.howTo?.screengrabFiles.length ?? 0);
    selectedVideo = { ...selectedVideo, durationSeconds: autoDuration };
    await mutateCurrentJob((state) => {
      state.video = selectedVideo;
    });
  }
  const isHowToFlow = isHowToVideoType(selectedVideo.type);
  const effectiveSupers = resolveSupersConfig(job.supers, selectedVideo);
  const videoProviderLabel = getVideoProviderLabel(selectedVideo);
  const recentSignals = await getRecentBackstorySignalsForProduct(job.product);
  const recentSettings = recentSignals.settings;

  try {
    let backstory: Backstory;
    if (job.backstory) {
      await updateCurrentStep("backstory", "running", "Using shared persona profile from parent run...");
      backstory = job.backstory;
    } else if (isHowToFlow) {
      await updateCurrentStep("backstory", "running", "How-to mode: preparing instructional profile...");
      backstory = buildHowToBackstory(job.product);
    } else {
      await updateCurrentStep("backstory", "running", "Generating persona backstory...");
      backstory = await generateBackstory(job.script, job.product, job.guidelines, job.brief, recentSignals);
    }
    await ensureActiveRun();
    await fs.writeFile(path.join(jobDir, "backstory.json"), JSON.stringify(backstory, null, 2), "utf8");
    await mutateCurrentJob((state) => {
      state.backstory = backstory;
    });
    await updateCurrentStep(
      "backstory",
      "completed",
      job.backstory ? "Shared persona profile ready." : isHowToFlow ? "Instruction profile ready." : "Persona profile generated."
    );

    const useTextToVideo = shouldUseDirectTextToVideoFlow(selectedVideo);
    let keyframe: Buffer | undefined;
    if (useTextToVideo || isHowToFlow) {
      await updateCurrentStep(
        "keyframe",
        "running",
        isHowToFlow
          ? "Skipping concept frame. How-to mode uses uploaded screengrabs."
          : "Skipping concept frame. This video type uses direct motion generation with persona context."
      );
      await mutateCurrentJob((state) => {
        state.assets.keyframePng = undefined;
      });
      await updateCurrentStep(
        "keyframe",
        "completed",
        isHowToFlow ? "Concept frame skipped (uploaded screengrabs flow)." : "Concept frame skipped (direct motion flow)."
      );
    } else {
      const existingKeyframePath = job.assets.keyframePng ? path.join(jobDir, job.assets.keyframePng) : undefined;
      if (existingKeyframePath) {
        try {
          await updateCurrentStep("keyframe", "running", "Using shared concept frame from parent run...");
          keyframe = await fs.readFile(existingKeyframePath);
          await copyFileIfExists(existingKeyframePath, path.join(jobDir, providerAssetFiles.keyframe));
          await mutateCurrentJob((state) => {
            state.assets.keyframePng = providerAssetFiles.keyframe;
          });
          await updateCurrentStep("keyframe", "completed", "Shared concept frame ready.");
        } catch {
          keyframe = undefined;
        }
      }

      if (!keyframe) {
        await updateCurrentStep("keyframe", "running", "Building concept frame...");
        const rawKeyframe = await generateKeyframe(
          backstory,
          job.product,
          job.script,
          job.guidelines,
          job.brief,
          recentSettings,
          0,
          PRIMARY_FRAME_SPEC.aspectRatio,
          selectedVideo.type
        );
        await ensureActiveRun();
        keyframe = await normalizeKeyframeToPortrait(jobId, rawKeyframe);
        await copyFileIfExists(path.join(jobDir, "keyframe.png"), path.join(jobDir, providerAssetFiles.keyframe));
        await copyFileIfExists(path.join(jobDir, "keyframe-source.png"), path.join(jobDir, providerAssetFiles.keyframeSource));
        await mutateCurrentJob((state) => {
          state.assets.keyframePng = providerAssetFiles.keyframe;
        });
        await updateCurrentStep("keyframe", "completed", "Concept frame ready.");
      }
    }

    await updateCurrentStep("video", "running", `Submitting ${videoProviderLabel} generation request (${selectedVideo.durationSeconds}s)...`);
    let rawVideo: Buffer | undefined;
    let lastVideoError: unknown;
    let finalQcResult: z.infer<typeof generatedVideoQcSchema> | undefined;
    let selectedQcAttemptFileName: string | undefined;
    if (isHowToFlow) {
      const howToRender = await generateHowToVideoFromSteps(
        jobDir,
        job.product,
        job.script,
        job.howTo,
        selectedVideo.durationSeconds,
        async (progress) => {
          const humanStep = progress.stepIndex + 1;
          const phaseLabel =
            progress.phase === "voice"
              ? "voiceover"
              : progress.phase === "layout"
                ? "screen template"
                : "step text overlay";
          await updateCurrentStep(
            "video",
            "running",
            `Rendering how-to step ${humanStep}/${progress.totalSteps}: ${phaseLabel}.`
          );
        }
      );
      rawVideo = howToRender.videoBytes;
      await mutateCurrentJob((state) => {
        state.assets.howToStepMp4s = howToRender.stepFileNames;
      });
    } else {
      const runVideoQc = VIDEO_QC_ENABLED && shouldRunVideoQc(selectedVideo.type);
      const qcClient = runVideoQc ? getClient() : undefined;
      const maxVideoAttempts = getMaxVideoGenerationAttempts(selectedVideo, runVideoQc);
      let activeVideoPollToken = "";

      for (let videoAttempt = 1; videoAttempt <= maxVideoAttempts; videoAttempt += 1) {
        const videoPollToken = randomUUID();
        activeVideoPollToken = videoPollToken;
        try {
          let candidateVideo: Buffer | undefined;
          if (useTextToVideo) {
            candidateVideo = await generateVideoFromText(
              backstory,
              job.product,
              job.script,
              async (poll) => {
                if (activeVideoPollToken !== videoPollToken) {
                  return;
                }
                await mutateCurrentJob((state) => {
                  state.operationName = poll.operationName;
                });
                const message =
                  poll.status === "fallback_to_fal_sora_2"
                    ? `${videoProviderLabel} switching to fallback motion provider after primary generation failed.`
                    : poll.status === "fallback_to_kling"
                      ? `${videoProviderLabel} switching to secondary fallback motion provider after fallback generation failed.`
                    : `${videoProviderLabel} operation ${poll.status}. Generation attempt ${videoAttempt}/${maxVideoAttempts}, poll ${poll.attempt}.`;
                await updateCurrentStep("video", "running", message);
              },
              PRIMARY_FRAME_SPEC.aspectRatio,
              selectedVideo,
              job.guidelines,
              job.brief,
              job.soraPrompt,
              jobDir,
              job.promptVersion
            );
          } else {
            if (!keyframe) {
              throw new Error("Keyframe missing for image-to-video flow.");
            }
            candidateVideo = await generateVideoFromImage(
              keyframe,
              backstory,
              job.product,
              job.script,
              async (poll) => {
                if (activeVideoPollToken !== videoPollToken) {
                  return;
                }
                await mutateCurrentJob((state) => {
                  state.operationName = poll.operationName;
                });
                await updateCurrentStep(
                  "video",
                  "running",
                  `${videoProviderLabel} operation ${poll.status}. Generation attempt ${videoAttempt}/${maxVideoAttempts}, poll ${poll.attempt}.`
                );
              },
              PRIMARY_FRAME_SPEC.aspectRatio,
              selectedVideo,
              job.guidelines,
              job.brief,
              jobDir,
              job.promptVersion
            );
          }

          if (!candidateVideo) {
            throw new Error("Video generation returned no output bytes.");
          }
          activeVideoPollToken = "";

          const attemptFileName = `raw-attempt-${String(videoAttempt).padStart(2, "0")}.mp4`;
          const attemptVideoPath = path.join(jobDir, attemptFileName);
          const shouldRunSoraScriptFidelityGuard =
            SORA_SCRIPT_FIDELITY_GUARD_ENABLED && useTextToVideo && selectedVideo.provider === "sora";
          if (shouldRunSoraScriptFidelityGuard) {
            await ensureActiveRun();
            await fs.writeFile(attemptVideoPath, candidateVideo);
            await updateCurrentStep("video", "running", `Checking script fidelity for attempt ${videoAttempt}/${maxVideoAttempts}...`);
            try {
              const scriptFidelityResult = await inspectVideoScriptFidelityWithWhisper(
                attemptVideoPath,
                jobDir,
                job.product,
                job.script
              );
              const scriptFidelityPath = path.join(jobDir, `script-fidelity-attempt-${String(videoAttempt).padStart(2, "0")}.json`);
              await fs.writeFile(
                scriptFidelityPath,
                JSON.stringify(
                  {
                    checkedAt: new Date().toISOString(),
                    attempt: videoAttempt,
                    maxAttempts: maxVideoAttempts,
                    provider: selectedVideo.provider,
                    expectedScript: job.script,
                    ...scriptFidelityResult
                  },
                  null,
                  2
                ),
                "utf8"
              );

              if (!scriptFidelityResult.pass) {
                lastVideoError = new Error(`Script fidelity rejected attempt ${videoAttempt}/${maxVideoAttempts}: ${scriptFidelityResult.reasons.join(" ")}`);
                if (videoAttempt < maxVideoAttempts) {
                  await updateCurrentStep(
                    "video",
                    "running",
                    `Script fidelity rejected attempt ${videoAttempt}/${maxVideoAttempts}: ${scriptFidelityResult.reasons.join(" ")} Regenerating motion.`
                  );
                  continue;
                }
                throw lastVideoError;
              }
            } catch (error) {
              if (!isWhisperMissingError(error)) {
                throw error;
              }
              console.warn("[pipeline] whisper CLI not found; skipping Sora script fidelity guard.");
            }
          }

          if (runVideoQc && qcClient) {
            const qcAttemptFileName = `qc-attempt-${String(videoAttempt).padStart(2, "0")}.json`;
            const qcAttemptPath = path.join(jobDir, qcAttemptFileName);
            await ensureActiveRun();
            await fs.writeFile(attemptVideoPath, candidateVideo);
            await updateCurrentStep("video", "running", `Reviewing motion QC for attempt ${videoAttempt}/${maxVideoAttempts}...`);
            const qcResult = await inspectGeneratedVideoForQc(qcClient, {
              videoBytes: candidateVideo,
              product: job.product,
              script: job.script,
              videoConfig: selectedVideo,
              supers: effectiveSupers
            });
            finalQcResult = qcResult;
            await fs.writeFile(
              qcAttemptPath,
              JSON.stringify(
                {
                  checkedAt: new Date().toISOString(),
                  attempt: videoAttempt,
                  maxAttempts: maxVideoAttempts,
                  videoType: selectedVideo.type,
                  durationSeconds: selectedVideo.durationSeconds,
                  ...qcResult
                },
                null,
                2
              ),
              "utf8"
            );

            if (!qcResult.pass) {
              lastVideoError = new Error(`Video QC rejected attempt ${videoAttempt}/${maxVideoAttempts}: ${qcResult.summary}`);
              if (videoAttempt < maxVideoAttempts) {
                await updateCurrentStep("video", "running", `QC rejected attempt ${videoAttempt}/${maxVideoAttempts}: ${qcResult.summary}. Regenerating motion.`);
                continue;
              }
              throw lastVideoError;
            }

            selectedQcAttemptFileName = qcAttemptFileName;
          }

          rawVideo = candidateVideo;
          break;
        } catch (error) {
          activeVideoPollToken = "";
          lastVideoError = error;
          const canRetry = videoAttempt < maxVideoAttempts;
          if (useTextToVideo) {
            if (!canRetry) {
              throw error;
            }
            await updateCurrentStep("video", "running", `Motion generation hit a transient/safety issue. Retrying (${videoAttempt + 1}/${maxVideoAttempts}).`);
            continue;
          }
          if (!canRetry || !isVeoCelebrityLikenessFilterError(error)) {
            throw error;
          } else {
            await updateCurrentStep("video", "running", `Safety filter detected public-figure likeness risk. Regenerating concept frame and retrying (${videoAttempt + 1}/${maxVideoAttempts}).`);

            const retriedKeyframe = await generateKeyframe(
              backstory,
              job.product,
              job.script,
              job.guidelines,
              job.brief,
              recentSettings,
              videoAttempt,
              PRIMARY_FRAME_SPEC.aspectRatio,
              selectedVideo.type
            );
            await ensureActiveRun();
            keyframe = await normalizeKeyframeToPortrait(jobId, retriedKeyframe);
            await copyFileIfExists(path.join(jobDir, "keyframe.png"), path.join(jobDir, providerAssetFiles.keyframe));
            await copyFileIfExists(path.join(jobDir, "keyframe-source.png"), path.join(jobDir, providerAssetFiles.keyframeSource));
            await mutateCurrentJob((state) => {
              state.assets.keyframePng = providerAssetFiles.keyframe;
            });
          }
        }
      }
    }

    if (!rawVideo) {
      throw lastVideoError instanceof Error ? lastVideoError : new Error("Video output was not available after retries.");
    }

    await ensureActiveRun();
    await fs.writeFile(path.join(jobDir, "raw-provider.mp4"), rawVideo);
    await fs.writeFile(path.join(jobDir, providerAssetFiles.rawProvider), rawVideo);
    let publishedRawVideo = rawVideo;
    if (shouldApplyTopazUpscale(selectedVideo)) {
      try {
        await updateCurrentStep("video", "running", "Enhancing source video with Topaz AI...");
        const topazVideo = await enhanceVideoWithFalTopaz(
          rawVideo,
          async (poll) => {
            const message = `Topaz enhancement ${poll.status}. Attempt ${poll.attempt}.`;
            await updateCurrentStep("video", "running", message);
          },
          selectedVideo
        );
        publishedRawVideo = topazVideo;
        await fs.writeFile(path.join(jobDir, "raw-topaz.mp4"), topazVideo);
        await fs.writeFile(path.join(jobDir, providerAssetFiles.rawTopaz), topazVideo);
      } catch (error) {
        console.warn("[pipeline] Topaz enhancement failed; continuing with provider output", error);
      }
    }
    await fs.writeFile(path.join(jobDir, "raw.mp4"), publishedRawVideo);
    const mainOutputAspectRatio: SupportedAspectRatio = isHowToFlow ? "16:9" : PRIMARY_FRAME_SPEC.aspectRatio;
    try {
      await normalizeVideoToFrameInPlace(path.join(jobDir, "raw.mp4"), resolveFrameSpec(mainOutputAspectRatio), jobDir);
    } catch (error) {
      console.warn("[pipeline] output resolution normalization failed; keeping raw provider resolution", error);
    }
    if (!isHowToFlow && MODEL_END_TRIM_SECONDS > 0) {
      try {
        // Stabilize the published raw cut by replacing the model's last transition-prone tail
        // with a same-frame hold of equal duration. Keep raw-provider.mp4 untouched.
        await applyFreezeLastFrame(
          path.join(jobDir, "raw.mp4"),
          jobDir,
          MODEL_END_TRIM_SECONDS,
          MODEL_END_TRIM_SECONDS
        );
      } catch (error) {
        console.warn("[pipeline] raw ending stabilization failed; keeping raw video without tail cleanup", error);
      }
    }
    if (selectedQcAttemptFileName) {
      await fs.copyFile(path.join(jobDir, selectedQcAttemptFileName), path.join(jobDir, "qc.json"));
      await fs.copyFile(path.join(jobDir, selectedQcAttemptFileName), path.join(jobDir, providerAssetFiles.qc));
    }
    await copyFileIfExists(path.join(jobDir, "raw.mp4"), path.join(jobDir, providerAssetFiles.raw));
    await mutateCurrentJob((state) => {
      state.assets.rawMp4 = providerAssetFiles.raw;
      state.assets.qcJson = selectedQcAttemptFileName ? providerAssetFiles.qc : undefined;
      if (!isHowToFlow) {
        state.assets.howToStepMp4s = undefined;
      }
    });
    await updateCurrentStep(
      "video",
      "completed",
      finalQcResult ? `Base video generated. QC passed: ${finalQcResult.summary}` : "Base video generated."
    );

    await ensureActiveRun();
    const rawVideoPath = path.join(jobDir, "raw.mp4");
    await finalizeRenderedVideo({
      jobId,
      runToken,
      jobDir,
      videoProvider: selectedVideo.provider,
      product: job.product,
      script: job.script,
      backstory,
      rawVideoPath,
      supers: effectiveSupers,
      isHowToFlow,
      guidelines: job.guidelines,
      brief: job.brief
    });

    const completedJob = await getJob(jobId);
    if (completedJob) {
      try {
        await maybeSendJobReply(completedJob);
      } catch (replyError) {
        console.warn("[pipeline] gmail success reply failed", replyError);
      }
    }
  } catch (error) {
    if (error instanceof JobRunSupersededError) {
      return;
    }
    const message = errorMessage(error);
    await setCurrentStatus("failed", message);

    for (const stepId of ["backstory", "keyframe", "video", "finalize"] as const) {
      const existing = (await getJob(jobId))?.steps.find((step) => step.id === stepId);
      if (existing && existing.status === "running") {
        await updateCurrentStep(stepId, "failed", message);
        break;
      }
    }

    const failedJob = await getJob(jobId);
    if (failedJob) {
      try {
        await maybeSendJobReply(failedJob);
      } catch (replyError) {
        console.warn("[pipeline] gmail failure reply failed", replyError);
      }
    }

    throw error;
  }
}
