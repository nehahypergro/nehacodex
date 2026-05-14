# Kotak Ad Intelligence Studio: Test Case Matrix

## Scope
- UI and API flow for job creation and processing.
- Script generation constraints (duration-locked word budgets).
- Motion generation routing by duration/type.
- Supers behavior (triggering, formatting, timing, fallbacks).
- Finalization chain (freeze hold, end slate, audio continuity).
- Adapt generation (`1:1`, `16:9`) and post-processing.
- Failure handling and retry behavior.

## Environments
- Local dev: `http://127.0.0.1:3000`
- Required keys in `.env`: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `FAL_KEY`
- `ffmpeg` and `ffprobe` installed for full finalize coverage

## Execution Notes
- Use `scripts/test-supers.sh` for current automated supers/API coverage.
- Run high-cost live generation tests selectively (they consume provider credits and time).
- For each completed job, inspect:
  - `generated/<jobId>/job.json`
  - `generated/<jobId>/supers-debug*.json`
  - `generated/<jobId>/raw.mp4`
  - `generated/<jobId>/final.mp4`

## A. API Validation Cases

| ID | Area | Input | Expected |
|---|---|---|---|
| API-001 | Product enum | `product=invalid_product` | `400` with validation error |
| API-002 | Script min | script length `<12` | `400` |
| API-003 | Script max | script length `>900` | `400` |
| API-004 | Missing product | omit `product` | `400` |
| API-005 | Missing script | omit `script` | `400` |
| API-006 | Duration enum | `durationSeconds=10` | `400` |
| API-007 | Video type enum | invalid `video.type` | `400` |
| API-008 | Supers timing enum | `timingMode=slow` | `400` |
| API-009 | Supers template enum | invalid `template` | `400` |
| API-010 | Supers rule max | >12 rules | `400` |
| API-011 | Supers hold low | `holdSeconds=0.5` | `400` |
| API-012 | Supers hold high | `holdSeconds=4.1` | `400` |
| API-013 | Rule trigger empty | `triggerWord=""` | `400` |
| API-014 | Rule text empty | `text=""` | `400` |
| API-015 | Brief optional | omit brief | `202` accepted |
| API-016 | Guidelines optional | omit guidelines | `202` accepted |
| API-017 | Jobs list | `GET /api/jobs` | `200`, <=10 jobs |
| API-018 | Unknown job | `GET /api/jobs/<bad-id>` | `404` |
| API-019 | Unknown asset | invalid asset path | `404` |
| API-020 | Adapts before final | call adapts with no final | error response |

## B. Script Generation Cases (`/api/script`)

| ID | Area | Input | Expected |
|---|---|---|---|
| SCR-001 | 8s word bounds | duration `8` + valid brief | output `22-25` words |
| SCR-002 | 12s word bounds | duration `12` + valid brief | output `24-27` words |
| SCR-003 | 15s word bounds | duration `15` + valid brief | output `28-31` words |
| SCR-004 | Brief min | brief `<12` chars | API error |
| SCR-005 | Compliance text | Air Plus constraints in prompt context | script avoids disallowed claims |
| SCR-006 | CTA enforcement | any product | ends with direct CTA intent |
| SCR-007 | No visual direction | generated spoken script | no camera/visual/subtitle wording |
| SCR-008 | Model fallback | force primary model failure | fallback model used, script returned |

## C. Core Pipeline Cases (`/api/jobs`)

| ID | Area | Input | Expected |
|---|---|---|---|
| PIPE-001 | Air Plus 8s P2C | type `point_to_camera`, `8s` | job `completed`, final mp4 present |
| PIPE-002 | Cashback 8s P2C | type `point_to_camera`, `8s` | completed, 4 cue supers expected |
| PIPE-003 | Air Plus 12s P2C | type `point_to_camera`, `12s` | completed, no abrupt ending |
| PIPE-004 | Cashback 12s P2C | type `point_to_camera`, `12s` | completed, end slate appended |
| PIPE-005 | Air Plus 15s P2C | type `point_to_camera`, `15s` | completed via 15s Kling route |
| PIPE-006 | Cashback 15s P2C | type `point_to_camera`, `15s` | completed via 15s Kling route |
| PIPE-007 | Multi-scene 8s | type `point_to_camera_multi_scene`, `8s` | completed, text-to-video flow |
| PIPE-008 | Multi-scene 12s | type `point_to_camera_multi_scene`, `12s` | completed |
| PIPE-009 | Multi-scene 15s | type `point_to_camera_multi_scene`, `15s` | completed via 15s Kling route |
| PIPE-010 | Montage 8s | type `montage`, `8s` | completed |
| PIPE-011 | Montage 12s | type `montage`, `12s` | completed |
| PIPE-012 | Montage 15s | type `montage`, `15s` | completed via 15s Kling route |
| PIPE-013 | Features 8s | type `features_half_half`, `8s` | completed |
| PIPE-014 | Features 12s | type `features_half_half`, `12s` | completed |
| PIPE-015 | Features 15s | type `features_half_half`, `15s` | completed via 15s Kling route |

## D. Supers Logic and Formatting Cases

| ID | Area | Input | Expected |
|---|---|---|---|
| SUP-001 | Mandatory supers | any valid job | finalize note includes supers applied/fallback |
| SUP-002 | Auto RTB triggers | no manual rules | cues created from script RTBs |
| SUP-003 | Manual rule override | explicit rules present | cue text uses provided rules |
| SUP-004 | Inline-only text | include potential newline payload | no cue has `\\n` in `supers-debug` |
| SUP-005 | Char cap | long super text | capped to configured max chars |
| SUP-006 | Wrap behavior | long phrase > line width | wraps cleanly to next line, no overlap |
| SUP-007 | Skip generic term | trigger only `cashback` | no isolated “Cashback” super |
| SUP-008 | Fuel RTB cue | script mentions `up to 4% fuel` | cue appears with correct `%` |
| SUP-009 | Numeric format | amount/magnitude text | `Rs.` normalization where configured |
| SUP-010 | Air Plus style | Air Plus job | white band, grey italic text, red numeric highlight |
| SUP-011 | Cashback style | Cashback job | brand-locked cashback design |
| SUP-012 | Timing hold | cue display | baseline + extra hold applied |
| SUP-013 | Cue count sanity | standard scripts | >=1 cue and <= configured max |
| SUP-014 | No draw artifacts | generated frames | no stray grey lines/artifact bars |
| SUP-015 | Font lock | both products | Source Sans family used |
| SUP-016 | Font scale regressions | compare previous output | expected text size adjustment retained |

## E. Backstory and Visual Direction Cases

| ID | Area | Input | Expected |
|---|---|---|---|
| BKS-001 | Backstory schema | valid generation | strict JSON fields present |
| BKS-002 | Persona variation | run 3 similar jobs | non-identical persona/backdrop tendency |
| BKS-003 | No sweat/wrinkle | any job | prompts include no sweat spots/wrinkles |
| BKS-004 | Air Plus treatment | Air Plus brief | affluent aspirational Indian treatment |
| BKS-005 | Device/card exclusion | any job | no cards/screens in generated motion intent |
| BKS-006 | Brief influence | distinct brief styles | prompt context reflects campaign brief |

## F. Finalization and Continuity Cases

| ID | Area | Input | Expected |
|---|---|---|---|
| FIN-001 | Pre-end hold | normal job | freeze hold before slate applied |
| FIN-002 | End slate append | product-specific assets present | correct product end slate stitched |
| FIN-003 | Final freeze | all types/durations | final ends with freeze frame |
| FIN-004 | No hard cut | inspect final 0.5s | no abrupt cut to black |
| FIN-005 | Music mix | bg score file configured | audio mixed through to end slate |
| FIN-006 | Music continuity | stitched final | music does not drop before slate end |
| FIN-007 | Music volume | configured multiplier | loudness change reflected without clipping |
| FIN-008 | Missing ffmpeg | simulate missing binary | clear fallback note, job still returns best effort |
| FIN-009 | Missing end slate file | wrong path in env | finalize continues with slate-off note |
| FIN-010 | Missing bg score file | invalid score path | finalize completes with audio skipped reason |

## G. Adapts Cases (`/api/jobs/{id}/adapts`)

| ID | Area | Input | Expected |
|---|---|---|---|
| ADP-001 | Adapt endpoint | completed source job | returns job with adapt assets |
| ADP-002 | Adapt 1:1 ratio | inspect output | real `1:1`, no portrait pillarbox artifact |
| ADP-003 | Adapt 16:9 ratio | inspect output | real `16:9`, no head crop regression |
| ADP-004 | Supers on adapts | adapt outputs | supers rendered and legible |
| ADP-005 | Freeze on adapts | adapt outputs | freeze hold applied |
| ADP-006 | 15s adapt regen | 15s source job | adapts complete with correct ratio and supers |
| ADP-007 | Adapt retry path | transient model failure | retries and completes/fails with clear error |

## H. Failure and Recovery Cases

| ID | Area | Input | Expected |
|---|---|---|---|
| ERR-001 | Missing `GEMINI_API_KEY` | unset env | backstory/keyframe step fails with clear error |
| ERR-002 | Missing `OPENAI_API_KEY` | text flow requiring it | video step fails with clear error |
| ERR-003 | Missing `FAL_KEY` + 15s | 15s job | fails early with explicit env error |
| ERR-004 | Provider timeout | force low poll attempts | timeout message + failed status |
| ERR-005 | Safety filter event | trigger-like prompt | retry or controlled fail with note |
| ERR-006 | Job resume visibility | crash during run | `GET /api/jobs/{id}` reflects failed/running status |
| ERR-007 | Retry stability | transient 429/5xx simulation | retries happen, not immediate fail |

## I. UI/UX Cases

| ID | Area | Input | Expected |
|---|---|---|---|
| UI-001 | Product buttons | render page | Air Plus grey, Cashback pale red |
| UI-002 | Removed sections | form area | removed blocks are absent |
| UI-003 | Backstory display | completed job | white textbox, readable formatting, bold headings |
| UI-004 | Step labels | top stepper | model names hidden, neutral “agent” style labels |
| UI-005 | Jobs panel | list view | last 10 jobs visible |
| UI-006 | Progress updates | running job | step statuses progress queued->running->completed |
| UI-007 | Error surfacing | failed job | visible error message in UI |
| UI-008 | Mobile responsiveness | narrow viewport | controls and previews stay usable |

## J. Regression Pack (Run Every Change)

1. `npm run lint`
2. `npm run build`
3. `scripts/test-supers.sh` on local server
4. One live 8s Cashback P2C job
5. One live 15s Cashback P2C job (Kling path)
6. Run adapts for the 15s job
7. Manually verify:
   - supers present and readable
   - no abrupt ending
   - music continuity through end slate
   - aspect ratios are correct (`9:16`, `1:1`, `16:9`)

## Quick API Payload Samples

### 1) Core job
```bash
curl -sS -X POST http://127.0.0.1:3000/api/jobs \
  -H 'content-type: application/json' \
  -d '{
    "product":"kotak_cashback",
    "script":"Get 5% cashback on essentials and entertainment, plus up to 4% on fuel spends. Limited period joining fee zero. Apply now.",
    "brief":"BOFU urgency creative for metro salaried audience",
    "video":{"type":"point_to_camera","durationSeconds":15}
  }'
```

### 2) Generate adapts
```bash
curl -sS -X POST http://127.0.0.1:3000/api/jobs/<jobId>/adapts
```

### 3) Script generation
```bash
curl -sS -X POST http://127.0.0.1:3000/api/script \
  -H 'content-type: application/json' \
  -d '{
    "product":"kotak_air_plus",
    "durationSeconds":8,
    "videoType":"point_to_camera",
    "brief":"Aspirational frequent-travel BOFU push",
    "guidelines":"Confident, efficient, inspiring. No exaggerated claims."
  }'
```
