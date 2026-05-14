# Kotak Ad Intelligence Studio

Next.js + TypeScript + Tailwind app for generating BOFU Meta creatives (8s / 15s / 20s) for:
- `Kotak Air Plus`
- `Kotak Cashback`

## Slide Studio MVP

This repo now also includes a local-first AI slide generation app designed as a production-minded MVP for a Genspark-like deck workflow.

- Route: `http://127.0.0.1:3000/slide-studio`
- Local database: `storage/slide-studio.sqlite`
- Local uploads: `storage/uploads/<projectId>/`
- Local exports: `storage/exports/`

What it supports today:

1. Create presentation projects with title, prompt, audience, tone, and target slide count.
2. Ingest direct prompt text plus uploaded local files.
3. Run an explicit intelligence pipeline:
   - intent extraction
   - deck type classification
   - audience inference
   - evidence awareness
   - narrative planning
   - outline generation
   - slide generation
   - single-slide regeneration with deck context
4. Review and edit the outline before slide generation.
5. Edit individual slides with a sidebar list, notes, bullets, and regenerate actions.
6. Preview slides with deterministic layout rules.
7. Export the deck as JSON locally.

Sora Studio bulk email delivery:

- Excel/CSV imports can include an `Email`, `Recipient Email`, `Notification Email`, `Notify Email`, or `Delivery Email` column.
- Sora Studio currently renders Model 2 only by default (`SORA_STUDIO_RENDER_MODELS=seedance2`). Model 1 remains in code and can be re-enabled later with `SORA_STUDIO_RENDER_MODELS=sora2,seedance2`.
- If a row has an email value, the completed Model 2 video for that row is emailed as soon as its MP4 is saved.
- If the row has no email value, the UI's default notification email is used. If that is blank, `SORA_STUDIO_NOTIFY_EMAIL_TO` is used.
- Emails attach the MP4 directly when it is at or under `SORA_STUDIO_EMAIL_ATTACHMENT_MAX_MB` (default `20`). Larger files need `PUBLIC_APP_URL` or `SORA_STUDIO_PUBLIC_APP_URL` for link delivery.
- Gmail sending requires Google Workspace service-account credentials with the Gmail send scope and `GMAIL_WORKSPACE_USER`.

Runtime notes:

- If `GEMINI_API_KEY` or `GOOGLE_API_KEY` is set, outline and slide copy use Gemini structured generation.
- If no Gemini key is set, the app falls back to a local heuristic generator so the workflow still runs end-to-end.
- The local database layer uses Node's built-in `node:sqlite`, so the slide studio path assumes a modern Node runtime. The repo already includes a local Node 24 toolchain under `.node/bin/`.
- Current local text extraction is strongest for `txt`, `md`, `csv`, `html`, and `json`. Binary formats like `pdf`/`pptx` are stored, but the local parser falls back to placeholder text until a richer parser is added.

Recommended local startup for this route:

```bash
PATH="$PWD/.node/bin:$PATH" npm run dev
```

Then open:

`http://127.0.0.1:3000/slide-studio`

## Hypergro Sales Deck App

This repo also includes a separate Hypergro deck generator built on Gemini, a `Nano Banana Pro` visual preset, and Google Slides rendering.

- Route: `http://127.0.0.1:4415/hypergro-sales-deck`
- Dev command: `npm run dev:hypergro`
- Build command: `npm run build:hypergro`
- Start command: `npm run start:hypergro`

What it does:

1. Accepts a strategic brief, a sample deck upload, or a pasted sample deck excerpt.
2. Uses Gemini to generate a BCG-style Hypergro sales storyline and slide copy.
3. Applies a reusable `Nano Banana Pro` visual direction for executive-quality deck composition.
4. Renders the deck into Google Slides with reusable TypeScript slide templates.
5. Stores local outputs under `generated-decks/<jobId>/`.

Required env for deck generation:

- `GEMINI_API_KEY` or `GOOGLE_API_KEY`

Optional env for live Google Slides export:

- `GOOGLE_SERVICE_ACCOUNT_JSON`
- or `GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY`
- `GOOGLE_SLIDES_PARENT_FOLDER_ID`

If Google Slides credentials are not set, the app still generates the deck JSON and local preview but skips live Slides export.

## What It Does

Single-page workflow:
1. Accepts product toggle + optional campaign brief.
2. Auto-generates an urgency-led BOFU script for selected duration and video type (or lets you edit manually).
3. Generates backstory JSON from Gemini text model using the script.
4. Generates a keyframe with Imagen and normalizes it to exact `9:16` portrait (`1080x1920`) before video generation.
5. Generates a portrait raw video with model routing by duration/type:
   - 8s bumper ads (multi-scene backend) and montage: direct text-to-video flow.
   - feature flows: image-to-video with reference-image identity consistency.
   - 15s/20s (all types): Kling via fal with auto-extension/post-processing.
6. Produces final MP4 output (supers always enabled) with post-processing depending on environment support.

`Bumper ads` and `Montage` use direct Sora text-to-video (no image reference for bumper masters) while still using the generated backstory.

Assets are saved per job under:

`generated/<jobId>/{input.json,job.json,backstory.json,keyframe.png,raw.mp4,final.mp4}`

The UI also shows the last 10 jobs so outputs can be reopened.

## Requirements

- Node.js 20+
- npm
- Gemini API key
- OpenAI API key for direct Sora text-to-video flows
- fal API key (`FAL_KEY`) for fal Sora fallback, Kling generation, and fal-based music
- `ffmpeg` / `ffprobe` (recommended for full finalize pipeline)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create local env file:

```bash
cp .env.example .env.local
```

3. Set required key in `.env.local`:

```bash
GEMINI_API_KEY=...
OPENAI_API_KEY=...
FAL_KEY=...
```

Optional Sora prompt-writer override:

```bash
SORA_PROMPT_WRITER_MODEL=gemini-3-pro-preview
SORA_PROMPT_WRITER_FALLBACK_MODEL=gemini-2.5-pro
SORA_PROMPT_WRITER_REASONING_EFFORT=high
SORA_PROMPT_WRITER_THINKING_BUDGET=2048
ENABLE_SORA_PROMPT_WRITER=true
```

4. Run dev server:

```bash
npm run dev
```

5. Open:

`http://127.0.0.1:3000`

## Excel-To-Sora Bulk Import

You can upload an Excel-style planning sheet and auto-create Sora jobs row-by-row.

Endpoint:

- `POST /api/jobs/import-excel`
- Content type: `multipart/form-data`
- Required field: `file`
- Optional fields:
  - `autoStart` (`true`/`false`, default `true`)
  - `maxRows` (default `50`, max `200`)

Expected sheet headers (first row):

- `Product`
- `Brief`
- `Business Objective`
- `Creative Objective / Funnel`
- `Video Duration`
- `Ratio / Dimensions`
- `Language`

Behavior:

- `provider` is forced to `sora`.
- For each row, Gemini generates both:
  - final spoken `script`
  - row-specific `soraPrompt` used directly in Sora generation
- If `Product` is outside the legacy two-key pipeline, import still proceeds:
  - exact product name is preserved in Gemini script/prompt generation
  - internal motion profile falls back to a generic Kotak path with warnings in response
- `Video Duration` is normalized to `8`, `15`, or `20`.
- `Ratio / Dimensions` is parsed for `9:16`, `1:1`, or `16:9`.
- If ratio is `1:1` or `16:9`, import still generates a `9:16` master and flags a warning so adapts can be generated after completion.
- `Language`, `Business Objective`, and `Creative Objective / Funnel` are appended into generation guidelines so script + motion prompts align to your row intent.
- Indian-face casting is hard-enforced in the prompt, and brand context is hard-locked to Kotak Mahindra Bank.

Prerequisites for this import route:

- `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) must be set.
- `OPENAI_API_KEY` must be set for Sora generation.

Example:

```bash
curl -X POST "http://127.0.0.1:3000/api/jobs/import-excel" \
  -F "file=@/absolute/path/to/sora-inputs.xlsx" \
  -F "autoStart=true" \
  -F "maxRows=50"
```

## Gmail Workspace Email Flow

This app can poll a Gmail Workspace inbox, turn each inbound campaign brief into a job, and reply on the same email thread with public video links.

Target mailbox currently defaults to:

- `neha@hypergro.ai`

Required env in addition to the normal video keys:

- `PUBLIC_APP_URL`
- `GMAIL_WORKSPACE_USER`
- `GMAIL_PROCESSED_LABEL`
- `GMAIL_INBOX_QUERY`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
  or
- `GOOGLE_CLIENT_EMAIL`
- `GOOGLE_PRIVATE_KEY`

Operational requirements:

- The mailbox must be Google Workspace, not consumer Gmail.
- The service account must have domain-wide delegation enabled.
- The Google Workspace admin must authorize Gmail scopes for:
  - `https://www.googleapis.com/auth/gmail.modify`
  - `https://www.googleapis.com/auth/gmail.send`
  - `https://www.googleapis.com/auth/gmail.labels`
- `PUBLIC_APP_URL` must be an internet-accessible base URL. Email replies use that base to send browser-openable video links, not local file paths.

Available routes:

- `POST /api/email/gmail/poll`
  - polls the inbox immediately, creates jobs, and starts the pipeline
- `POST /api/email/gmail/webhook`
  - webhook target for external triggers; currently re-polls the inbox on receipt

## Notes

- All Gemini calls happen server-side.
- Script generation (`/api/script`) uses Gemini (`GEMINI_SCRIPT_MODEL`, default `gemini-3-flash-preview`) with fallback models.
- Video QC uses a dedicated multimodal Gemini model (`GEMINI_QC_MODEL`, default `gemini-3.1-pro-preview`) against the generated MP4, with its own fallback list.
- Veo generation is asynchronous and polled with retries.
- `Bumper ads` and `Montage` are routed through direct Sora text-to-video first. If direct Sora fails and `FAL_KEY` is present, the fallback is fal `Sora 2 Pro` text-to-video. The portrait output is normalized to exact `1080x1920`.
- 15s and 20s generation are routed to Kling via fal (`Kling text-to-video`), then finalized through the same supers/end-slate/audio pipeline.
- Direct text-to-video is used for `point_to_camera_multi_scene` (Bumper ads) and `montage`; feature videos use image-to-video.
- Image/video prompts explicitly block cards and screens (`no cards`, `no phones/laptops/tablets/TV/UI`) across generation flows.
- Freeze-frame hold is applied across all durations (`8s/15s/20s`) and formats (final output + adapts) to avoid abrupt endings.
- If `ffmpeg`/`ffprobe` are missing, finalization may fall back or skip certain finishing steps.
- If present, `assets/end-slate-air-plus.mp4` and `assets/end-slate-cashback.mp4` are auto-used as product-specific end slates.
- Background music defaults to generated mode: it prefers fal `Lyria 2`, otherwise falls back to Gemini `Lyria Live`, then local score files if generation is unavailable. The mix is applied after the stitched end slate with fade-in and fade-out.

Optional env for generated background music:

- `BACKGROUND_SCORE_SOURCE=auto`
- `FAL_LYRIA_MODEL=fal-ai/lyria2`
- `LYRIA_MODEL=models/lyria-realtime-exp` for Gemini Developer API fallback
- `FAL_KEY=...`

## Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run test:supers` (runs supers validation + live E2E edge-case suite)

## Educational Series API (MFD Shaala)

The Ruby server (`app.rb`) now supports a stitched long-form flow for 60-90s educational outputs built from 8s clips.

Endpoint:

- `POST /api/generate-educational-series`
- Default local server for `app.rb`: `http://127.0.0.1:8791` (override with `PORT`).

What it does:

1. Uses default host image angles automatically (or provided host references if sent in API).
2. Splits your locked script into host chunks.
3. Inserts infographic clips only where script sections are concept-heavy and need visual explanation (optional).
4. Generates all clips as 8s Veo image-to-video units.
5. Keeps each host dialogue chunk short enough to complete naturally within each 8s clip.
6. Stitches all clips into one final MP4.

Output files are saved to:

- `public/generated-series/<seriesId>/final.mp4`
- `public/generated-series/<seriesId>/series-plan.json`

Default host angles:

- Put host angle files in `assets/` with names like `host-angle-01.png`, `host-angle-02.png`.
- They are auto-loaded and shuffled across host dialogue clips when `shuffleHostAngles` is `true`.

Minimal request body:

```json
{
  "seriesTitle": "MFD Shaala",
  "lockedScript": "Your full 60-90 second educational script...",
  "seriesInstructions": "Any specific direction to follow (optional).",
  "clipDurationSeconds": 8,
  "includeInfographics": true,
  "aspectRatio": "9:16",
  "shuffleHostAngles": true,
  "maxWordsPerHostClip": 18
}
```

Notes:

- `targetDurationSeconds` is optional. If omitted, the backend auto-estimates duration from script length and keeps it within 60-90 seconds.

Optional host overrides:

- `reference_images` (array of `{ base64, mime_type }`) to force specific host angles.
- `reference_image_base64` + `reference_image_mime_type` as single-image fallback.

Model note:

- Set `GEMINI_VEO_MODEL` to your preferred Veo 3 variant (for example `veo-3.0-generate-001` for Veo 3 standard).
- For the dedicated text-to-video `veo31_standard` flow, the app uses fal's `fal-ai/veo3.1` endpoint.
- Configure `FAL_KEY` before using `provider: "veo31_standard"`.
- Optionally override the standard text model with `FAL_VEO_TEXT_MODEL`.
