# Kotak Project Status Tracker

Date: March 25, 2026
Purpose: simple tracker for what has been built, what is working, what is still open, and what should happen next.

## 1. Current Product Scope

This project currently supports:

- brief to script generation
- persona and backstory generation
- video prompt generation
- video generation
- supers rendering
- end slate append
- final video delivery links
- debug visibility across intermediate steps

Primary current product:

- Kotak Air Plus

Secondary product in system:

- Kotak Cashback

## 2. What Has Been Built

### Core pipeline

- brief ingestion for product, duration, video type, and guidelines
- script generation route
- backstory generation layer
- video prompt generation layer
- video job pipeline
- raw and final asset generation
- retry and reconcile flows

### Prompt and creative quality work

- age range constrained to `25-38`
- direct-to-camera language made explicit in generated prompts
- on-camera speaking enforced, not voiceover-only
- white-balanced lighting rule added
- no yellow hue rule added
- premium iPhone-shot realism rule added
- natural Indian English delivery rule added
- no background music/noise instruction added for raw video generation
- anti-cartoon / anti-plastic-face negative constraints added
- stronger body-language and gesture rules added
- stronger acting-beat rules added
- stronger delivery-direction rules added for spoken lines

### Supers system

- RTB-aware supers selection
- persistent RTB overlays for Air Plus
- raised placement for Meta-safe composition
- red-band lower-third backend treatments for:
  - free flight
  - 5% on travel
  - 2% forex
  - privileges worth `₹80K`
- current supers + finalization flow supports:
  - accurate timing
  - raw-to-final delivery flow
  - debug output

### End slate

- end slate append is active
- portrait Air Plus end slate has been replaced with the new attached slate

### Documentation created

- deck source
- PRD
- client architecture diagrams
- client-friendly brief-to-video architecture note
- simplified client PRD
- Air Plus dry-test reports
- live examples and sample outputs

## 3. What Has Been Validated

### Dry validation

- `20-case` Air Plus dry run completed
- result:
  - `/api/script`: `19/20`
  - `/api/debug/video-prompt`: `19/20`

Main dry-run artifact:

- [airplus-batch-20-step-by-step-2026-03-24.md](/Users/neha/Documents/Codex/docs/airplus-batch-20-step-by-step-2026-03-24.md)

### End-to-end validation

- `5 fresh Air Plus creatives` completed end to end
- result:
  - `5/5 completed`

Main end-to-end artifact:

- [fresh-airplus-first5-e2e-2026-03-24.md](/Users/neha/Documents/Codex/docs/fresh-airplus-first5-e2e-2026-03-24.md)

Completed final videos from that set:

- [FA5-01 Travel Rewards Push](http://127.0.0.1:3000/api/jobs/1774326774463-b2f5dbac/asset/final.mp4)
- [FA5-02 Global Travel Forex](http://127.0.0.1:3000/api/jobs/1774327408718-b2c9e422/asset/final.mp4)
- [FA5-03 Free Flight Urgency](http://127.0.0.1:3000/api/jobs/1774328095735-ef22cc6a/asset/final.mp4)
- [FA5-04 Travel Privileges Value](http://127.0.0.1:3000/api/jobs/1774328778973-c77cc943/asset/final.mp4)
- [FA5-05 Guest Pass Every Quarter](http://127.0.0.1:3000/api/jobs/1774329420955-3dee8229/asset/final.mp4)

## 4. What Is Working Well

- end-to-end Air Plus generation is working
- script to prompt to video flow is functioning
- age and direct-to-camera constraints are holding
- RTB-specific supers logic is working
- red-band lower-third treatments are implemented
- final videos are being produced and stored correctly
- end slate replacement is in place

## 5. Current Open Issues

### Script and semantic issues

- one hard dry-run script failure remains:
  - `AP20-19` free-flight validity edge
- some supporting-fact cases still soften or drift:
  - accelerated Air Miles can collapse to generic travel rewards
  - Priority Pass specificity can be lost
  - explicit `2%` wording can soften in broader international-travel scripts
  - fuel surcharge waiver script quality is still weak
  - multi-RTB cases can preserve the primary RTB but soften the secondary one

### Prompt and creative quality issues

- movement and expression quality is improved, but not fully solved
- some generated performances can still feel stiff
- some identity-detail lines can still over-compress in edge cases

### Operational issues

- motion generation remains slow
- some jobs complete on disk before the API state is reconciled
- reconcile is still needed in some cases when final files exist but the job remains `running`

## 6. Recommended Next Work

### Priority 1

- fix the remaining script-route edge case for `AP20-19`
- hard-preserve supporting-fact RTBs more reliably:
  - `5 Air Miles / Rs. 100`
  - `Priority Pass`
  - explicit `2% forex`

### Priority 2

- continue improving motion and expression realism
- reduce stiff presenter behavior further
- tighten body-language and acting-beat output quality

### Priority 3

- re-finalize selected videos if any supers styling changes are approved
- generate a second fresh batch for client review after semantic fixes

## 7. Immediate Next Actions

1. Fix script preservation for the remaining edge RTBs.
2. Rerun the 20-case dry Air Plus regression suite.
3. Generate a second curated batch of 5 to 10 videos.
4. Prepare the final Kotak review pack:
   - deck
   - architecture diagram
   - PRD
   - selected final videos

## 8. Key Files

Main tracker docs:

- [kotak-final-project-deck.md](/Users/neha/Documents/Codex/docs/kotak-final-project-deck.md)
- [kotak-client-brief-to-video-architecture.md](/Users/neha/Documents/Codex/docs/kotak-client-brief-to-video-architecture.md)
- [kotak-client-simple-prd.md](/Users/neha/Documents/Codex/docs/kotak-client-simple-prd.md)
- [kotak-ad-intelligence-prd.md](/Users/neha/Documents/Codex/docs/kotak-ad-intelligence-prd.md)

Main test artifacts:

- [airplus-batch-20-step-by-step-2026-03-24.md](/Users/neha/Documents/Codex/docs/airplus-batch-20-step-by-step-2026-03-24.md)
- [fresh-airplus-first5-e2e-2026-03-24.md](/Users/neha/Documents/Codex/docs/fresh-airplus-first5-e2e-2026-03-24.md)

Core implementation:

- [pipeline.ts](/Users/neha/Documents/Codex/app/lib/pipeline.ts)
- [route.ts](/Users/neha/Documents/Codex/app/api/script/route.ts)
- [route.ts](/Users/neha/Documents/Codex/app/api/debug/video-prompt/route.ts)
- [route.ts](/Users/neha/Documents/Codex/app/api/jobs/route.ts)

## 9. Simple Status

Overall status:

- `Built`: yes
- `End-to-end working`: yes
- `Presentation-ready foundation`: yes
- `Fully hardened`: not yet

Recommended project status label:

- `Working beta with strong client-review readiness`
