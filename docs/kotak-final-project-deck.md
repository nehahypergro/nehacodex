# Kotak Ad Intelligence Studio
## Final Project Deck for Kotak

Date: March 22, 2026
Audience: Kotak marketing, product, creative, and growth stakeholders
Presenter goal: explain what was built, what changed in the final version, what now works better, and what remains to be tightened before wider rollout.

## Slide 1 - Title
### On-slide copy
- Kotak Ad Intelligence Studio
- Brief to final ad output in one system
- Final review of the Air Plus prompt-generation and video pipeline

### Speaker notes
- This project is not a prompt experiment in isolation. It is an end-to-end system that moves from brief to script, backstory, visual prompt, video generation, supers, and final output.
- The heaviest recent work was on the scene-prompt generator because that stage was driving stiffness, repetition, and low engagement in the point-to-camera videos.

## Slide 2 - Executive Summary
### On-slide copy
- We built a full creative pipeline for Kotak Air Plus and Kotak Cashback.
- We replaced a weak prompt style with a cinematic scene-block video prompt generator.
- We made character identity, setting, wardrobe, and movement explicit and enforceable.
- We added validation, fallback repair, and live debug visibility.
- The system is materially better, but two issues remain open: offer-specific script persistence and some prompt-line clipping.

### Speaker notes
- The outcome is a more reliable premium direct-to-camera system, not just better wording.
- The prompt generator now has stronger constraints around realism, human behavior, identity detail, exclusions, and ending quality.
- The honest state today is improved and usable, but not yet fully polished in every edge case.

## Slide 3 - Problem We Needed to Fix
### On-slide copy
- Earlier outputs were too stiff and presenter-like.
- The same premium-ad archetype repeated across videos.
- Men dominated by default on neutral briefs.
- Wardrobe and setting often collapsed into the same blazer-and-lounge formula.
- Character prompts were under-described, which weakened motion quality and distinctiveness.

### Speaker notes
- The core problem was not only generation quality. It was the contract we gave the system.
- If the prompt contract is vague, the output drifts toward generic ad behavior: centered speaker, minimal life, weak hooks, repeated identity, and polished-but-empty settings.
- We treated this as a systems issue: prompt design, backstory quality, validation, and fallback behavior all had to change together.

## Slide 4 - End-to-End Product Scope
### On-slide copy
- Input: product, brief, guidelines, duration, video type
- Script generation: `/api/script`
- Backstory generation: `generateBackstory(...)`
- Scene prompt generation: internal prompt-building layer
- Motion and finalization: video generation, supers, end slate, audio, adapts
- Storage: `generated/<jobId>/...`

### Speaker notes
- The full app lives in `app/lib/pipeline.ts` with product-specific behavior in the script route and UI workflow around it.
- The pipeline is not only for prompt generation. It also handles asset production, product-specific supers, freeze holds, end slates, and ratio adapts.
- That matters for Kotak because prompt quality has to fit into a larger reliable production system, not a one-off manual workflow.

## Slide 5 - What Changed in Script Generation
### On-slide copy
- Duration-locked script generation remains in `/api/script`.
- BOFU Meta framing is preserved for short conversion formats.
- RTB and CTA logic are explicit and product-aware.
- Known gap: some brief-specific offers still regress to the default strongest RTB.

### Speaker notes
- We improved a number of offer-handling paths, including quarterly flight and some guest-pass phrasing, but one important edge case still remains.
- In local live testing on March 22, 2026, guest-pass briefs could still classify correctly but fall back to the default Unbox RTB in the returned script.
- This is now clearly isolated as a script-layer issue rather than a prompt-writer issue.

## Slide 6 - What Changed in Backstory Generation
### On-slide copy
- Backstory is now the source of truth for character and setting.
- `gender_presentation` was added to the schema.
- Recent-window balancing reduces repeated male casting on neutral briefs.
- Persona naming was diversified.
- Wardrobe is now contextual to setting instead of defaulting to the same blazer-led look.
- Air Plus settings stay anchored in premium travel-day worlds.

### Speaker notes
- This was a major structural improvement.
- The schema now explicitly carries gender presentation, facial features, hairstyle and grooming, wardrobe details, body build, posture, speaking energy, and setting.
- We also added recent-signal memory so repeated dry runs do not keep producing the same identity pattern.
- Contextual wardrobe logic now responds to resort, lounge, concierge, hotel-arrival, and transit-adjacent contexts instead of flattening everything into one corporate silhouette.

## Slide 7 - What Changed in the Video Prompt Generator
### On-slide copy
- The final prompt contract is now a cinematic scene block.
- Backstory drives character, setting, wardrobe, social signal, and behavior.
- The opening must be behavior-first, not a neutral talking head.
- The action vocabulary is generation-safe and low-hallucination.
- Camera behavior is stable, with only slight natural drift when useful.
- Accent, exclusions, and ending behavior are explicit.

### Speaker notes
- The active system prompt in `app/lib/pipeline.ts` now tells the system to write one generation-ready scene block instead of a fragmented checklist.
- It enforces premium direct-to-camera energy without drifting into over-directed or staged performance.
- The prompt contract also blocks risky object interactions, screens, logos, text, and other elements that commonly introduce generation failure.

## Slide 8 - Identity and Differentiation Rules
### On-slide copy
- Every output must surface:
- one facial, skin-tone, or face-shape detail
- one hair or grooming detail
- one wardrobe or body-frame detail
- one movement-quality detail
- Character identity should vary strongly while preserving premium style DNA.

### Speaker notes
- This rule exists because generic identity leads to generic video.
- We now explicitly reject prompts that do not carry those visible identity anchors.
- The target is not generic premium-ad polish. The target is a believable premium traveler with a distinct face, silhouette, and movement pattern.

## Slide 9 - Guardrails, Validation, and Repair
### On-slide copy
- Validator rejects unusable or generic scene prompts.
- Gender alignment is repaired post-generation when needed.
- Wardrobe cue cleanup prevents broken intro phrasing.
- Fallback prompt builder uses the same scene-block format.
- Live debug route exposes brief, backstory, attempts, and final prompt.

### Speaker notes
- This is what made the system dependable enough to iterate quickly.
- We do not just accept the first raw prompt from the system.
- We normalize it, validate it, repair specific issues, and only then use it.
- The debug route at `/api/debug/video-prompt` lets us inspect exactly what the system produced at each stage.

## Slide 10 - Representative Live Example
### On-slide copy
- Brief: 8s Air Plus Meta reel focused on Unbox travel rewards
- Script: “Earn more from travel with Kotak Air Plus, with five percent rewards via Unbox bookings. Apply Now.”
- Backstory outcome: female luxury-founder traveler in a premium hotel-district travel setting
- Prompt outcome: behavior-first, direct-to-camera scene block with identity, wardrobe, movement, exclusions, and ending constraints

### Speaker notes
- On March 22, 2026, a live debug run on `http://127.0.0.1:3000/api/debug/video-prompt` returned:
- Persona: `Tara Krishnan`
- Gender presentation: `woman`
- Setting: `Hotel-district arcade walkway with polished travel styling and discreet baggage movement`
- Final prompt shape:
- `[SCENE START] EXT. HIGH-END HOTEL ARRIVAL ZONE - DAY`
- `TARA KRISHNAN ... is already in a lived-in arrival moment...`
- `Hair and grooming: ...`
- `Wardrobe and build: ...`
- `Movement quality: ...`
- `TARA KRISHNAN (...) Maximize your travel with Kotak Air Plus.`
- This is a materially better input for text-to-video than the earlier generic talking-head prompts.

## Slide 11 - Live Dry-Run Results
### On-slide copy
- Fresh 10-case local batch run on March 22, 2026
- All 10 prompt generations returned through the primary prompt-writer path
- Gender and wardrobe diversity improved materially
- Scene-block structure held consistently
- Remaining issues were visible and traceable, not hidden

### Speaker notes
- The local batch was run against `http://127.0.0.1:3000`.
- The positive result is that the prompt system now varies gender, names, wardrobe, and setting more credibly than before.
- The honest negatives are:
- some hair and movement lines still clip too hard
- quarterly guest-pass style briefs are still inconsistent in the script route
- That is exactly the kind of state a stakeholder review should see: better system quality, plus clear remaining work.

## Slide 12 - Business Value for Kotak
### On-slide copy
- Better prompt quality means stronger first-pass creative realism.
- More varied personas reduce ad fatigue and template repetition.
- Safer prompt constraints reduce failures from screens, props, and over-complex actions.
- Debug visibility makes the system easier to trust and tune.
- The pipeline supports repeatable creative operations, not just one-off prompt writing.

### Speaker notes
- This is valuable because Kotak does not need random creative novelty. It needs repeatable, premium, on-brand velocity.
- The system now supports faster iteration without losing auditability.
- The final workflow is closer to an internal creative operating system than a single generation feature.

## Slide 13 - Open Issues
### On-slide copy
- Offer-specific script persistence still needs hardening.
- Some prompt prose still clips in hair and movement lines.
- Prompt quality is improved, but not yet fully production-finished for every edge case.

### Speaker notes
- The most important unresolved item is the offer-preservation issue in `/api/script`.
- Example: a brief focused on “complimentary lounge guest pass every quarter” can still revert to the default Unbox RTB even when the brief intent is recognized.
- The remaining prompt clipping is now narrower than before, but it still needs cleanup so the scene block stays complete and elegant across all lines.

## Slide 14 - Recommended Next Steps
### On-slide copy
- Fix offer-preservation in `/api/script`
- Finish compaction cleanup for hair and movement lines
- Run a new regression batch across 10 to 20 briefs
- Lock the acceptance criteria for Kotak review
- Move to stakeholder UAT with approved product claims only

### Speaker notes
- The technical next step is not another broad rewrite.
- It is targeted hardening of the two remaining weak areas.
- After that, the system is in a much stronger state for Kotak-facing UAT and feedback on creative quality rather than basic reliability.

## Appendix A - Key Files and Routes
### On-slide copy
- `app/lib/pipeline.ts`
- `app/lib/types.ts`
- `app/api/script/route.ts`
- `app/api/debug/video-prompt/route.ts`
- `docs/test-cases.md`
- `generated/<jobId>/...`

### Speaker notes
- Key references for the final implementation:
- `app/lib/pipeline.ts`
  - active video prompt-writer contract
  - backstory normalization
  - gender balancing and contextual wardrobe
  - prompt validation and repair
- `app/lib/types.ts`
  - `gender_presentation` addition to backstory schema
- `app/api/script/route.ts`
  - duration locking, RTB policy, CTA behavior, current guest-pass gap
- `app/api/debug/video-prompt/route.ts`
  - inspection path for live prompt debugging

## Appendix B - Suggested Presentation Flow
### On-slide copy
- Start with business outcome, not prompt mechanics
- Move from pipeline view to prompt-writer changes
- Show one real example
- Be explicit about what is finished and what is still open

### Speaker notes
- Recommended order for the live meeting:
- 1. Frame the studio as a scalable creative system
- 2. Show why the prompt-generator rewrite mattered
- 3. Show one representative live example
- 4. Call out remaining issues before Kotak has to ask
- 5. End on a concrete UAT readiness plan
