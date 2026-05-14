# Kotak Ad Intelligence Studio
## Simple PRD

Date: March 24, 2026
Status: current-state product document
Audience: client stakeholders, marketing teams, product teams, and review teams

## 1. Product Summary

Kotak Ad Intelligence Studio is a system that converts a marketing requirement into a short-form final video ad. It takes a brief, generates a script, plans the character and scene, creates the base video, applies the correct supers, appends the end slate, and outputs a review-ready final asset.

## 2. Business Problem

Kotak needs a faster and more repeatable way to create short premium ads for products such as Air Plus without rebuilding the full creative process manually for every variation.

Today, the main need is:

- move quickly from requirement to reviewable video
- preserve the correct RTB in the final asset
- keep the output premium, direct, and on-brand
- make the process reviewable and repeatable

## 3. Product Goal

Enable Kotak teams to go from requirement gathering to a final video asset in one structured workflow.

## 4. Users

Primary users:

- marketing team
- product marketing team
- growth and performance team
- creative review stakeholders

Secondary users:

- creative operations
- internal product or engineering operators

## 5. Requirement Gathering Inputs

The process starts with requirement gathering. The team defines:

- product
- offer or RTB to push
- audience
- funnel stage
- platform and format
- tone and brand guardrails
- duration

Example:

- Product: Kotak Air Plus
- RTB: 5% on travel
- Audience: premium frequent travellers
- Funnel stage: BOFU
- Platform: Meta
- Duration: 8 seconds

## 6. End-to-End Workflow

1. Requirement Gathering
- Team defines the core communication need.

2. Brief Creation
- The need is written into a structured creative brief.

3. Script Generation
- The system creates a short spoken script that fits the requested duration.

4. Persona and Scene Planning
- The system defines the character, city, setting, wardrobe, body language, and performance style.

5. Video Prompt Generation
- The system converts the brief and persona into one final scene prompt.

6. Video Generation
- The system creates the base video performance.

7. Supers Application
- The correct RTB overlay is selected and timed into the video.

8. End Slate Append
- The correct branded end slate is added to the final export.

9. Delivery
- The final video and supporting artifacts are made available for review.

## 7. Functional Requirements

### 7.1 Brief Input

The system must accept:

- product
- brief
- duration
- video type
- optional guidelines

### 7.2 Script Generation

The system must:

- generate a short duration-fit spoken script
- preserve the main RTB from the brief
- keep the CTA clear where required

### 7.3 Persona and Scene Planning

The system must define:

- who is speaking
- where they are
- how they look
- how they move
- how they should emotionally deliver the script

### 7.4 Video Prompt Generation

The system must generate one final prompt that includes:

- character identity
- setting
- wardrobe
- movement
- expression
- spoken delivery
- lighting
- camera setup
- exclusions

### 7.5 Video Generation

The system must create a base video from the generated prompt.

### 7.6 Supers

The system must:

- map the RTB to the correct on-screen treatment
- place the supers correctly for the format
- keep the look brand-consistent

### 7.7 End Slate

The system must append the correct branded end slate for the final format.

### 7.8 Review Outputs

The system should expose:

- generated script
- persona and scene output
- final video prompt
- raw video
- final video

## 8. Quality Requirements

The output should be:

- premium
- direct-to-camera
- human and believable
- commercially clear
- visually consistent with Kotak brand intent

The system should avoid:

- generic talking-head videos
- wrong offer emphasis
- inconsistent character identity
- weak or misplaced supers
- incomplete endings

## 9. Success Criteria

The product is successful when:

- the RTB survives from brief to final video
- the video is reviewable without heavy manual correction
- the supers are correct and readable
- the end slate is appended consistently
- teams can generate multiple clear routes from different briefs

## 10. Operating Model

Recommended process for Kotak:

1. define campaign need and message priority
2. write short structured briefs
3. run the briefs through the system
4. review outputs in batches
5. approve, refine, or regenerate

## 11. Out of Scope

This PRD does not cover:

- media planning
- ad platform publishing
- long-form film production
- full human-free approval workflows

## 12. Final Product Statement

Kotak Ad Intelligence Studio is a structured creative production workflow, not just a prompt tool. It starts at requirement gathering, carries the message through script and scene planning, generates the video, applies supers and end slate, and produces a final review-ready ad asset.
