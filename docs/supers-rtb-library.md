# Supers RTB Library

Date: March 22, 2026
Purpose: canonical RTB-to-supers mapping for Kotak products. This is the current implementation reference and the recommended starting point for image-driven supers selection.

## Current Supers System Constraints

- template: `bottom_urgency`
- default hold: `1.5s`
- max auto supers per video: `8`
- max supers text length: `25` characters
- if no manual rules are provided, supers are derived automatically from the script

Source:
- [pipeline.ts](/Users/neha/Documents/Codex/app/lib/pipeline.ts)
- [spec.ts](/Users/neha/Documents/Codex/app/lib/spec.ts)

## Canonical Air Plus Supers

| RTB / Claim | Exact super text | Source type | Notes |
|---|---|---|---|
| 5% rewards on travel bookings via Kotak Unbox | `Earn 5% on travel` | Primary hook | Use only when the message is specifically travel rewards via Unbox. |
| Limited period: joining fee INR 0 | `Zero joining fee` | Primary hook | Always treat as limited-period in script/disclaimer. |
| Spend INR 1.5L this quarter to unlock a complimentary flight | `Free flight at Rs. 1.5L spent this quarter` | Primary hook | Always tie to quarterly spend threshold. |
| Annual travel privileges and savings worth over 80,000 rupees | `Travel perks worth 80K` | Supporting fact | Secondary proof, not always the hero RTB. |
| Travel bookings on Kotak Unbox earn 5 Air Miles per Rs 100 | `5 Air Miles/ Rs 100 spent on travel` | Supporting fact | Use when the script angle is earn rate rather than % rewards language. |
| Low foreign exchange markup of 2% | `2% forex markup` | Supporting fact | Use only for international travel / forex-led messaging. |

## Canonical Cashback Supers

| RTB / Claim | Exact super text | Source type | Notes |
|---|---|---|---|
| 5% cashback on daily essentials like groceries and milk | `5% cashback essentials` | Primary hook | Use for groceries, milk, essentials, household-budget cues. |
| 5% cashback on entertainment | `5% cashback OTT & dining` | Primary hook | Current super copy is broader than just movies. |
| Up to 4% benefit on fuel spends | `Up to 4% on fuel spends` | Primary hook | Never convert this into an absolute savings claim. |
| Limited period: joining fee INR 0 | `Zero joining fee` | Primary hook | Always keep limited-period in script/disclaimer. |
| Generic cashback fallback | `Get 5% cashback` | Fallback | Use only when the message is broad and no stronger category RTB is available. |

## RTBs Known to the Script Layer But Not Mapped to Auto-Supers

### Air Plus

- welcome benefit: 2,500 Air Miles after card issuance
- renewal benefit: 2,500 Air Miles on annual fee payment
- domestic lounge visits
- international lounge visits / Priority Pass support
- one Air Mile equals one rupee for redemption
- airline and hotel loyalty transfer partners
- one percent fuel surcharge waiver
- eligibility and billing-cycle details

These are valid supporting facts, but they are not currently canonical auto-supers.

### Cashback

The Cashback product is currently much tighter and mostly centers on:
- essentials
- entertainment
- fuel
- joining fee

There are fewer secondary proof facts currently mapped in the implementation.

## Recommended Rules for Image-Driven Supers

If supers are selected from images rather than from the script, use this logic:

1. Choose one hero RTB per image or moment.
2. Use exact canonical super text from the tables above.
3. Do not combine multiple RTBs in a single super.
4. Do not invent broader claims than the product allows.
5. If the image context does not strongly support the RTB, do not show the super.

## Recommended Image Cue Mapping

### Air Plus

| Image cue | Recommended super |
|---|---|
| airport / lounge / luggage / travel desk | `Earn 5% on travel` |
| forex / international departure context | `2% forex markup` |
| application / start / acquisition context | `Zero joining fee` |
| reward-milestone / aspirational-trip context | `Free flight at Rs. 1.5L spent this quarter` |
| premium-value / privilege montage | `Travel perks worth 80K` |

### Cashback

| Image cue | Recommended super |
|---|---|
| groceries / milk / home pantry / supermarket | `5% cashback essentials` |
| movie / OTT / dining / weekend outing | `5% cashback OTT & dining` |
| car / commute / fuel station | `Up to 4% on fuel spends` |
| acquisition / switching / value start | `Zero joining fee` |
| broad practical spend context with no tighter cue | `Get 5% cashback` |

## Brand and Claim Guardrails

### Air Plus

- `Earn 5% on travel` must remain tied to Kotak Unbox travel bookings in the script or disclaimer.
- `Zero joining fee` is limited-period.
- `Free flight at Rs. 1.5L spent this quarter` must remain tied to the spend threshold.
- Do not imply always-free travel or unconditional travel rewards.

### Cashback

- Do not imply cashback on everything.
- Keep cashback category-specific where possible.
- Fuel must remain `up to 4%`.
- Joining fee is limited-period.
- Avoid exaggerated savings language.

## Practical Recommendation

For image-fed supers, do not build a freeform text generator first.

Start with:
- a fixed canonical supers library
- image-to-RTB classification
- exact approved overlay text

That will keep the supers layer much more controllable than open-text generation.
