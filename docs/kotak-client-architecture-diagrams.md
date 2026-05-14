# Kotak Client Architecture Diagrams

Date: March 22, 2026
Purpose: simple architecture views for Kotak stakeholders. These diagrams explain what the system does, how it moves from brief to video, and where quality controls sit.

## 1. Business-Level System View

```mermaid
flowchart LR
    A["Kotak Team<br/>Product brief, offer, audience, guardrails"] --> B["Ad Intelligence Studio"]

    subgraph B ["Kotak Ad Intelligence Studio"]
      B1["Script Engine<br/>Creates short conversion-ready dialogue"]
      B2["Persona Engine<br/>Builds a believable traveler backstory"]
      B3["Prompt Engine<br/>Turns the brief into a generation-ready scene"]
      B4["Video Generation<br/>Creates the draft video"]
      B5["Quality Control<br/>Checks lip sync, setting, ending, brand fit"]
      B6["Delivery Layer<br/>Final video links and assets"]
      B1 --> B2 --> B3 --> B4 --> B5 --> B6
    end

    B6 --> C["Kotak Review Team<br/>Review, compare, approve, rerun"]
```

## 2. Brief-to-Video Generation Flow

```mermaid
flowchart TD
    A["Input<br/>Product, brief, duration, guidelines"] --> B["Script Generation"]
    B --> C["Backstory Generation"]
    C --> D["Scene Prompt Generation"]
    D --> E["Video Generation"]
    E --> F["Automated Quality Check"]
    F --> G{"Passes quality checks?"}
    G -- "Yes" --> H["Finalize Video"]
    H --> I["Final Link"]
    G -- "No" --> J["Repair or Regenerate"]
    J --> D
```

## 3. What Drives Better Creative Quality

```mermaid
flowchart TD
    A["Brief"] --> B["Commercial Intent<br/>Offer, CTA, audience, platform"]
    A --> C["Persona Layer<br/>Age, gender presentation, city, profession, why they care"]
    A --> D["Visual Identity Layer<br/>Face, hair, wardrobe, body frame, movement quality"]
    A --> E["Scene Layer<br/>Setting, staging, hook, camera, lighting"]
    A --> F["Safety Layer<br/>No logos, no screens, no text, accent rules, ending rules"]

    B --> G["Final Scene Prompt"]
    C --> G
    D --> G
    E --> G
    F --> G

    G --> H["More believable, varied, premium direct-to-camera outputs"]
```

## 4. Reliability and Guardrail Architecture

```mermaid
flowchart LR
    A["Generation Output"] --> B["Validation Layer"]
    B --> C{"Valid and complete?"}
    C -- "Yes" --> D["Video Generation"]
    C -- "No" --> E["Repair Layer"]
    E --> F["Fallback Prompt Builder"]
    F --> D
    D --> G["Quality Control"]
    G --> H{"Pass?"}
    H -- "Yes" --> I["Final Delivery"]
    H -- "No" --> J["Retry or Promote Best Attempt"]
```

## 5. Review and Delivery Workflow

```mermaid
flowchart LR
    A["Kotak Brief"] --> B["Generate Multiple Videos"]
    B --> C["Review Scripts and Prompts"]
    C --> D["Review Final Videos"]
    D --> E{"Approve?"}
    E -- "Yes" --> F["Use in campaign or stakeholder review"]
    E -- "No" --> G["Adjust brief, offer, or guardrails"]
    G --> A
```

## 6. Operating Model for Kotak

```mermaid
flowchart TD
    A["Marketing / Product Team"] --> B["Define message priority<br/>Offer, audience, channel"]
    B --> C["Creative System"]
    C --> D["Scripts"]
    C --> E["Backstories"]
    C --> F["Videos"]
    D --> G["Internal Review"]
    E --> G
    F --> G
    G --> H["Approved set for campaign, pitch, or UAT"]
```

## Suggested Slide Usage

- Slide 1: Diagram 1 for a simple executive overview
- Slide 2: Diagram 2 to explain the end-to-end flow
- Slide 3: Diagram 3 to explain why output quality improved
- Slide 4: Diagram 4 to explain reliability and safeguards
- Slide 5: Diagram 5 or 6 to explain review workflow and how Kotak teams would use it

## Speaker Notes

- Keep the language client-facing. Say "persona engine" or "scene prompt generation," not internal function names.
- Emphasize that the system is not just generating prompts. It is controlling quality across script, character, setting, video generation, and review.
- Call out that quality checks happen after generation, not just before it.
- If asked about failures, explain that the system can retry generation and can also promote the best attempt when needed for review.
