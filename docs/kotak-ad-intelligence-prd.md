# Kotak Ad Intelligence Studio PRD

Date: March 22, 2026
Status: Backward documentation from the implemented system
Audience: Kotak marketing, product, creative operations, growth, and internal engineering stakeholders
Owner: Codex working session

## 1. Product Summary

Kotak Ad Intelligence Studio is an internal creative generation system that converts a product brief into short-form ad outputs. The current implementation is optimized for premium direct-to-camera video ads for Kotak products, especially Kotak Air Plus and Kotak Cashback.

The system takes a brief, generates a short script, builds a believable character backstory, writes a generation-ready scene prompt, creates the video, runs automated quality checks, and produces final reviewable asset links.

This PRD documents the product as it exists today, not an aspirational future-only spec.

## 2. Problem Statement

Kotak needs a repeatable way to generate premium, on-brand short-form ad creative without depending on a fully manual scripting and creative development workflow for every iteration.

The initial implementation exposed three core quality problems:
- generated videos felt stiff, presenter-like, and low-engagement
- the same premium ad archetype repeated across outputs
- prompts were too generic, which reduced video realism and distinctiveness

The product was therefore reworked into a system that treats creative quality as a pipeline problem rather than only a prompting problem.

## 3. Product Vision

Enable Kotak teams to move from brief to reviewable video outputs quickly, while preserving:
- premium brand feel
- direct-response clarity
- believable human presence
- repeatable creative operations
- auditability and debug visibility

## 4. Goals

### Primary goals

- Convert a brief into a short video-ready creative asset flow
- Generate stronger first-pass direct-to-camera videos for performance and awareness use cases
- Reduce repeated character, wardrobe, and setting patterns
- Enforce consistent exclusions, safety rules, and ending behavior
- Provide debug visibility into script, backstory, prompt, QC, and final output

### Secondary goals

- Support multiple Kotak products with product-specific scripting logic
- Make batch generation possible for campaign exploration
- Improve internal trust in generated outputs through validation and review tooling

## 5. Non-Goals

- Full campaign planning or media planning
- Long-form brand film generation
- Automatic publishing into ad platforms
- Human-free approval and deployment
- Fully general creative generation across every Kotak format without product tuning

## 6. Target Users

### Primary users

- Kotak marketing managers
- Kotak product marketers
- Kotak growth and performance teams
- creative strategy and creative operations stakeholders

### Secondary users

- internal engineering or product teams operating the pipeline
- reviewers comparing multiple generated routes

## 7. Core Use Cases

### Use case 1: Performance video generation

A Kotak marketer provides:
- product
- brief
- duration
- video type
- optional guidelines

The system returns:
- a short conversion-oriented script
- a persona backstory
- a scene-level generation prompt
- a generated video
- a final video link for review

### Use case 2: Offer-led creative exploration

A Kotak team wants to test different offers such as:
- Unbox booking rewards
- low forex markup
- lounge guest pass
- complimentary flight milestone

The system should preserve the brief’s stated offer through script, prompt, and video.

### Use case 3: Batch creative exploration

A Kotak reviewer wants multiple distinct outputs from different briefs or message angles and needs:
- visible character and setting variation
- quick review links
- quality metadata

### Use case 4: Creative debugging

An internal operator uses the debug route to inspect:
- generated script
- backstory
- final prompt
- prompt source
- quality outcomes

## 8. Product Scope

### In scope today

- short-form point-to-camera video generation
- direct-response and premium-awareness style briefs
- brief-to-script generation
- persona/backstory generation
- scene prompt generation
- automated video QC
- final video delivery links
- debug and review flows
- regeneration and raw-attempt promotion flows

### Supported products today

- Kotak Air Plus
- Kotak Cashback

### Current strongest format

- 8-second vertical direct-to-camera video
- premium Indian traveler or aspirational consumer setting
- direct spoken line with clean hold at end

## 9. User Workflow

1. User submits a brief and product context.
2. System generates a short, duration-fit script.
3. System generates a character backstory that becomes the source of truth for the person and world.
4. System generates a scene-block video prompt.
5. System submits the prompt into video generation.
6. System runs automated quality control on the generated attempt.
7. If QC passes, the system finalizes the video.
8. If QC fails, the system retries or allows promotion of the best available raw attempt.
9. User reviews final links and compares options.

## 10. Functional Requirements

### 10.1 Brief ingestion

The system must accept:
- product
- brief
- optional guidelines
- duration
- video type

The system should support client-facing performance, awareness, and advisory-style brief inputs.

### 10.2 Script generation

The system must:
- generate a short spoken script that fits the requested duration
- preserve the commercial objective of the brief
- include a CTA where appropriate
- apply product-specific RTB logic

The system should:
- preserve explicit offer-led messaging from the brief
- avoid reverting to generic RTBs when a specific offer is clearly stated

### 10.3 Backstory generation

The system must generate a backstory including:
- persona name
- gender presentation
- age range
- city
- profession
- motivation or why they care
- facial features
- hairstyle and grooming
- wardrobe details
- posture and body language
- expression style
- speaking energy
- body build
- setting

The backstory must act as the primary source of truth for character and setting decisions downstream.

### 10.4 Prompt generation

The system must generate one final scene-block prompt that:
- feels like a filmed moment rather than an instruction list
- starts with a behavior-first opening
- includes visible identity markers
- reflects the backstory’s social and visual world
- includes exclusions and delivery constraints
- uses stable framing or slight naturalistic drift only when it helps
- keeps lighting white-balanced, with no yellow cast, and an iPhone-shot realism

The prompt must explicitly include:
- one facial, skin-tone, or face-shape detail
- one hair or grooming detail
- one wardrobe or body-frame detail
- one movement-quality detail

### 10.5 Video generation

The system must:
- pass the prompt into the video-generation engine
- store raw and final artifacts
- support retries across attempts

### 10.6 Quality control

The system must evaluate:
- spoken-script match
- lip sync quality
- ending stability
- brand and setting fit
- continuity for the format

The system should reject outputs that fail obvious brand-fit or performance checks.

### 10.7 Delivery

The system must expose final assets through stable review links.

The system should expose:
- input JSON
- backstory JSON
- QC JSON
- raw video
- final video

### 10.8 Debugging and operations

The system must support:
- review of intermediate outputs
- retry of failed jobs
- manual promotion of raw attempts when needed
- reconciliation of stale-running jobs with final files on disk

## 11. Creative Quality Requirements

### Performance quality

Outputs should feel:
- premium
- intimate
- direct-to-camera
- behavior-first
- emotionally alive
- polished without looking rehearsed

### Character quality

Outputs should avoid:
- repeated male-only casting
- repeated blazer-and-lounge sameness
- generic premium-ad identity
- flat or under-described visual presence

### Staging quality

Outputs should avoid:
- static presenter blocking
- dead-symmetry framing
- over-busy object actions
- scenes that feel staged just for the camera

### Lighting quality

Outputs should:
- maintain white-balanced lighting
- avoid yellow or amber color contamination unless explicitly requested
- preserve natural skin tones
- feel like premium phone-shot realism, not fake cinematic over-stylization

## 12. Safety and Brand Constraints

The system must support prompt-level and QC-level enforcement for:
- no readable text
- no subtitles or captions
- no logos
- no screens unless explicitly allowed
- no background music unless explicitly allowed
- Indian English accent requirements
- stable ending behavior after dialogue

## 13. Success Metrics

### Product metrics

- time from brief to first reviewable output
- number of usable outputs per batch
- percentage of outputs passing QC on first or second attempt
- diversity across character, wardrobe, and setting
- reduction in repeated archetypes across batch outputs

### Quality metrics

- prompt completeness
- script-to-brief relevance
- brand-fit pass rate
- lip-sync pass rate
- reviewer approval rate

### Current benchmark snapshot

Based on the latest local 10-video generation batch on March 22, 2026:
- 10 out of 10 final video links were delivered
- 8 out of 10 completed through normal QC-pass flow
- 2 out of 10 required promotion of the best available raw attempt after QC failure
- prompt generation showed materially improved gender and wardrobe variation compared with the earlier baseline

## 14. Known Issues

### Issue 1: Offer-specific script persistence

Some offer-led briefs still produce awkward or partially degraded script phrasing, especially in guest-pass style cases.

Impact:
- weakens message fidelity between brief and final video

### Issue 2: Prompt prose clipping

Some scene-block lines are still clipped or overly terse, especially:
- hair and grooming lines
- movement-quality lines
- occasional wardrobe detail lines

Impact:
- reduces prompt elegance
- can weaken generation precision

### Issue 3: Operational recovery complexity

Some long-running video jobs can end up requiring:
- manual raw-attempt promotion
- reconcile actions to align status with generated files

Impact:
- operational friction in batch generation

## 15. Risks

- repeated generation drift back to generic premium-ad behavior
- offer-preservation failures in scripts reducing campaign accuracy
- job-state mismatches between generated files and API status
- dependence on motion-generation quality for lip sync and brand-fit outcomes

## 16. Dependencies

- script-generation logic
- backstory schema and normalization
- prompt validation and fallback logic
- video generation path
- QC inspection pipeline
- job storage and asset serving

## 17. Out of Scope for This Phase

- automatic publishing to Meta or other ad platforms
- auto-selection of best creative by live performance
- multilingual ad generation
- brand legal approval automation
- image-first or storyboard-first campaign planning

## 18. Rollout Recommendation

### Phase 1: Controlled internal use

- use for internal Kotak review and exploration
- run defined batches against approved claims only
- treat outputs as human-reviewed creative drafts

### Phase 2: Stakeholder UAT

- introduce a fixed acceptance checklist
- compare outputs across 10 to 20 benchmark briefs
- lock product-specific messaging rules

### Phase 3: Production hardening

- close offer-persistence gaps
- remove remaining prompt clipping
- reduce need for manual promotion or reconcile flows

## 19. Acceptance Criteria for the Next Milestone

The product should be considered ready for broader Kotak review when:
- explicit offer-led briefs preserve the intended offer through script and prompt
- prompt lines are complete and readable across identity, hair, wardrobe, and movement
- batch generation delivers a high QC-pass rate without manual promotion on most runs
- final links are consistently reachable and operationally stable

## 20. Implementation Mapping

This PRD maps directly to the current implementation:
- pipeline orchestration: [pipeline.ts](/Users/neha/Documents/Codex/app/lib/pipeline.ts)
- backstory types: [types.ts](/Users/neha/Documents/Codex/app/lib/types.ts)
- script route: [route.ts](/Users/neha/Documents/Codex/app/api/script/route.ts)
- job creation: [route.ts](/Users/neha/Documents/Codex/app/api/jobs/route.ts)
- debug prompt route: [route.ts](/Users/neha/Documents/Codex/app/api/debug/video-prompt/route.ts)
- asset serving: [route.ts](/Users/neha/Documents/Codex/app/api/jobs/[id]/asset/[name]/route.ts)
- client-facing diagrams: [kotak-client-architecture-diagrams.md](/Users/neha/Documents/Codex/docs/kotak-client-architecture-diagrams.md)
- presentation deck: [kotak-final-project-deck.md](/Users/neha/Documents/Codex/docs/kotak-final-project-deck.md)

## 21. Recommended Next Actions

1. harden offer-specific script persistence
2. finish prompt-line completeness cleanup
3. simplify recovery when raw attempts need promotion
4. convert this PRD into a shorter Kotak-facing summary version
