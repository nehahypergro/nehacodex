import "server-only";

import {
  AssumptionItem,
  AssumptionLog,
  AudienceProfile,
  DeckStrategy,
  NarrativePlan,
  PresentationIntent,
  ProjectRecord,
  SlideBlueprint
} from "@/app/lib/slide-studio/types";

type BlueprintTemplate = Omit<SlideBlueprint, "slideIndex"> & { priority: number };

type StructureSpec = {
  label: string;
  rationale: string;
  base: BlueprintTemplate[];
  expansions: BlueprintTemplate[];
};

const STRUCTURES: Record<PresentationIntent["deckType"], StructureSpec> = {
  pitch_deck: {
    label: "Investor-style narrative",
    rationale: "Lead with context and pain, build to why this opportunity matters, then close on why this approach wins.",
    base: [
      { slideType: "title", purpose: "Frame the opportunity immediately.", keyQuestion: "Why are we here?", narrativeRole: "Open the argument.", priority: 1 },
      { slideType: "problem", purpose: "Define the core pain or unmet need.", keyQuestion: "What is broken or underserved?", narrativeRole: "Create urgency.", priority: 1 },
      { slideType: "market/context", purpose: "Show why the market matters now.", keyQuestion: "Why is this opportunity credible?", narrativeRole: "Build external context.", priority: 1 },
      { slideType: "comparison", purpose: "Clarify what is different from alternatives.", keyQuestion: "Why this approach versus the default?", narrativeRole: "Create differentiation.", priority: 2 },
      { slideType: "process/how-it-works", purpose: "Explain how the proposed solution works.", keyQuestion: "How does this create value?", narrativeRole: "Translate strategy into mechanics.", priority: 1 },
      { slideType: "metrics/KPI", purpose: "Summarize traction, proof, or directional evidence.", keyQuestion: "What proof exists?", narrativeRole: "Strengthen credibility.", priority: 2 },
      { slideType: "recommendation", purpose: "Make the investment or strategic ask explicit.", keyQuestion: "What should the audience believe and do?", narrativeRole: "Drive the decision.", priority: 1 },
      { slideType: "roadmap", purpose: "Show the next phase of execution.", keyQuestion: "What happens next after agreement?", narrativeRole: "Lower execution risk.", priority: 2 },
      { slideType: "closing", purpose: "End with a tight recap and call to action.", keyQuestion: "Why act now?", narrativeRole: "Close decisively.", priority: 1 }
    ],
    expansions: [
      { slideType: "agenda", purpose: "Prime the audience on the flow.", keyQuestion: "How will this story unfold?", narrativeRole: "Orientation.", priority: 3 },
      { slideType: "market/context", purpose: "Add a second context lens if the topic is complex.", keyQuestion: "What market force reinforces the story?", narrativeRole: "Deepen context.", priority: 3 }
    ]
  },
  strategy_deck: {
    label: "Strategy narrative",
    rationale: "Start with orientation, explain the current situation, evaluate choices, and conclude with a recommended path.",
    base: [
      { slideType: "title", purpose: "Set the strategic question.", keyQuestion: "What decision is on the table?", narrativeRole: "Frame the deck.", priority: 1 },
      { slideType: "agenda", purpose: "Orient the audience on the sequence.", keyQuestion: "How will we get to the recommendation?", narrativeRole: "Create clarity.", priority: 2 },
      { slideType: "market/context", purpose: "Ground the strategy in current conditions.", keyQuestion: "What context matters most?", narrativeRole: "Establish the case for change.", priority: 1 },
      { slideType: "problem", purpose: "Define the strategic friction.", keyQuestion: "What obstacle is preventing progress?", narrativeRole: "Focus attention.", priority: 1 },
      { slideType: "comparison", purpose: "Compare the strategic options.", keyQuestion: "What are the tradeoffs across options?", narrativeRole: "Surface choice architecture.", priority: 1 },
      { slideType: "metrics/KPI", purpose: "Explain the metrics that matter.", keyQuestion: "How should success be measured?", narrativeRole: "Create evaluation criteria.", priority: 2 },
      { slideType: "recommendation", purpose: "State the proposed path clearly.", keyQuestion: "What should we choose?", narrativeRole: "Land the strategy.", priority: 1 },
      { slideType: "roadmap", purpose: "Translate strategy into execution.", keyQuestion: "What is the sequence to execute?", narrativeRole: "Bridge decision to action.", priority: 1 },
      { slideType: "closing", purpose: "Reinforce the thesis and next step.", keyQuestion: "What should the team leave with?", narrativeRole: "Conclude.", priority: 1 }
    ],
    expansions: [
      { slideType: "process/how-it-works", purpose: "Explain the operating model behind the recommendation.", keyQuestion: "How will the strategy work in practice?", narrativeRole: "Add execution detail.", priority: 3 },
      { slideType: "market/context", purpose: "Add another external lens if useful.", keyQuestion: "What additional market factor matters?", narrativeRole: "Expand context.", priority: 3 }
    ]
  },
  performance_review: {
    label: "Performance review narrative",
    rationale: "Move from summary to drivers, then toward implications and next actions.",
    base: [
      { slideType: "title", purpose: "Frame the review period and topic.", keyQuestion: "What period and scope are we reviewing?", narrativeRole: "Set context.", priority: 1 },
      { slideType: "agenda", purpose: "Clarify the flow of the review.", keyQuestion: "How will the review be structured?", narrativeRole: "Orient.", priority: 2 },
      { slideType: "metrics/KPI", purpose: "Summarize the current performance picture.", keyQuestion: "What happened?", narrativeRole: "Lead with evidence.", priority: 1 },
      { slideType: "market/context", purpose: "Add external context and demand signals.", keyQuestion: "What external conditions shaped performance?", narrativeRole: "Explain environment.", priority: 2 },
      { slideType: "problem", purpose: "Call out the main drag or risk.", keyQuestion: "Where are the biggest issues?", narrativeRole: "Focus on the gap.", priority: 1 },
      { slideType: "comparison", purpose: "Compare actuals with target or benchmark.", keyQuestion: "How far are we from desired performance?", narrativeRole: "Quantify the gap.", priority: 1 },
      { slideType: "recommendation", purpose: "State what should change.", keyQuestion: "What corrective action is required?", narrativeRole: "Turn diagnosis into action.", priority: 1 },
      { slideType: "roadmap", purpose: "Sequence the improvement plan.", keyQuestion: "What happens next and when?", narrativeRole: "Create accountability.", priority: 1 },
      { slideType: "closing", purpose: "Summarize the operating takeaway.", keyQuestion: "What should leadership remember?", narrativeRole: "Close the review.", priority: 1 }
    ],
    expansions: [
      { slideType: "process/how-it-works", purpose: "Break down the operating workflow behind the KPI movement.", keyQuestion: "Which process needs intervention?", narrativeRole: "Add process diagnosis.", priority: 3 }
    ]
  },
  launch_plan: {
    label: "Launch narrative",
    rationale: "Explain the market moment, message, execution path, and launch sequence.",
    base: [
      { slideType: "title", purpose: "Introduce the launch topic.", keyQuestion: "What are we launching and why now?", narrativeRole: "Open the story.", priority: 1 },
      { slideType: "agenda", purpose: "Explain the launch story arc.", keyQuestion: "What will this deck cover?", narrativeRole: "Orient.", priority: 2 },
      { slideType: "market/context", purpose: "Ground the launch in customer and market reality.", keyQuestion: "What market conditions matter most?", narrativeRole: "Show the opening.", priority: 1 },
      { slideType: "problem", purpose: "Define the customer or business problem.", keyQuestion: "What problem is the launch solving?", narrativeRole: "Create relevance.", priority: 1 },
      { slideType: "process/how-it-works", purpose: "Explain the offer and activation mechanics.", keyQuestion: "How will the launch work?", narrativeRole: "Make the motion concrete.", priority: 1 },
      { slideType: "comparison", purpose: "Position against alternatives or current baseline.", keyQuestion: "What makes this launch distinct?", narrativeRole: "Sharpen positioning.", priority: 2 },
      { slideType: "recommendation", purpose: "State the launch thesis and key message.", keyQuestion: "What should we emphasize?", narrativeRole: "Focus the message.", priority: 1 },
      { slideType: "roadmap", purpose: "Lay out the launch timeline.", keyQuestion: "What is the launch sequence?", narrativeRole: "Show execution readiness.", priority: 1 },
      { slideType: "closing", purpose: "End on the core launch case.", keyQuestion: "Why should the team align around this plan?", narrativeRole: "Close with conviction.", priority: 1 }
    ],
    expansions: [
      { slideType: "metrics/KPI", purpose: "Add success metrics for the launch.", keyQuestion: "How will launch success be measured?", narrativeRole: "Add measurement.", priority: 3 }
    ]
  },
  case_study: {
    label: "Case study narrative",
    rationale: "Tell a before-and-after story with evidence, mechanism, and takeaway.",
    base: [
      { slideType: "title", purpose: "Introduce the case and scope.", keyQuestion: "What case are we examining?", narrativeRole: "Set up the example.", priority: 1 },
      { slideType: "agenda", purpose: "Preview the case flow.", keyQuestion: "How will the case unfold?", narrativeRole: "Orient.", priority: 2 },
      { slideType: "problem", purpose: "State the original challenge.", keyQuestion: "What problem existed before intervention?", narrativeRole: "Start the story.", priority: 1 },
      { slideType: "process/how-it-works", purpose: "Explain the approach taken.", keyQuestion: "What was done?", narrativeRole: "Show the mechanism.", priority: 1 },
      { slideType: "metrics/KPI", purpose: "Present the observed outcome or indicators.", keyQuestion: "What changed?", narrativeRole: "Demonstrate proof.", priority: 1 },
      { slideType: "comparison", purpose: "Contrast before versus after.", keyQuestion: "How is the end state different?", narrativeRole: "Make the change visible.", priority: 1 },
      { slideType: "market/context", purpose: "Place the case in a broader market context.", keyQuestion: "Why does this case matter more broadly?", narrativeRole: "Generalize the lesson.", priority: 2 },
      { slideType: "recommendation", purpose: "Translate the case into a takeaway.", keyQuestion: "What should others do with this insight?", narrativeRole: "Drive application.", priority: 1 },
      { slideType: "closing", purpose: "Close on the broader implication.", keyQuestion: "What is the enduring takeaway?", narrativeRole: "Close the lesson.", priority: 1 }
    ],
    expansions: [
      { slideType: "roadmap", purpose: "Add next steps if the case is ongoing.", keyQuestion: "What is the next phase?", narrativeRole: "Extend the story.", priority: 3 }
    ]
  },
  proposal: {
    label: "Proposal narrative",
    rationale: "Establish the need, explain the proposed approach, and make adoption easy.",
    base: [
      { slideType: "title", purpose: "Frame the proposal.", keyQuestion: "What is being proposed?", narrativeRole: "Open the ask.", priority: 1 },
      { slideType: "agenda", purpose: "Orient the audience to the case.", keyQuestion: "How will the proposal be justified?", narrativeRole: "Set expectations.", priority: 2 },
      { slideType: "problem", purpose: "Define the need or gap.", keyQuestion: "What problem requires action?", narrativeRole: "Create need.", priority: 1 },
      { slideType: "market/context", purpose: "Provide context for the recommendation.", keyQuestion: "Why is this proposal timely?", narrativeRole: "Create urgency.", priority: 2 },
      { slideType: "process/how-it-works", purpose: "Describe the proposed solution and workflow.", keyQuestion: "How will the proposal work?", narrativeRole: "Explain the offer.", priority: 1 },
      { slideType: "comparison", purpose: "Compare proposed versus alternative paths.", keyQuestion: "Why this option over others?", narrativeRole: "Establish differentiation.", priority: 1 },
      { slideType: "recommendation", purpose: "Make the ask explicit.", keyQuestion: "What approval is required?", narrativeRole: "Land the ask.", priority: 1 },
      { slideType: "roadmap", purpose: "Define delivery stages.", keyQuestion: "How would implementation unfold?", narrativeRole: "Reduce adoption friction.", priority: 1 },
      { slideType: "closing", purpose: "Reinforce the proposal logic.", keyQuestion: "Why move forward now?", narrativeRole: "Close the case.", priority: 1 }
    ],
    expansions: [
      { slideType: "metrics/KPI", purpose: "Add expected success measures.", keyQuestion: "How will success be tracked?", narrativeRole: "Add accountability.", priority: 3 }
    ]
  },
  educational_explainer: {
    label: "Educational narrative",
    rationale: "Progress from framing to explanation, examples, and a practical takeaway.",
    base: [
      { slideType: "title", purpose: "Introduce the concept.", keyQuestion: "What will the audience learn?", narrativeRole: "Set the lesson.", priority: 1 },
      { slideType: "agenda", purpose: "Preview the learning flow.", keyQuestion: "How will the concept be explained?", narrativeRole: "Orient the learner.", priority: 1 },
      { slideType: "market/context", purpose: "Explain why the concept matters in context.", keyQuestion: "Why should the audience care?", narrativeRole: "Build relevance.", priority: 2 },
      { slideType: "problem", purpose: "Clarify the confusion or misconception.", keyQuestion: "What question or challenge does this concept solve?", narrativeRole: "Create a learning need.", priority: 1 },
      { slideType: "process/how-it-works", purpose: "Explain the concept step by step.", keyQuestion: "How does it work?", narrativeRole: "Teach the mechanism.", priority: 1 },
      { slideType: "comparison", purpose: "Contrast it with alternatives or misconceptions.", keyQuestion: "How is it different from adjacent ideas?", narrativeRole: "Sharpen understanding.", priority: 2 },
      { slideType: "recommendation", purpose: "Summarize the practical takeaway.", keyQuestion: "What should the audience remember or do?", narrativeRole: "Make it actionable.", priority: 1 },
      { slideType: "closing", purpose: "Reinforce the key lesson.", keyQuestion: "What is the simplest summary?", narrativeRole: "End with retention.", priority: 1 }
    ],
    expansions: [
      { slideType: "metrics/KPI", purpose: "Add a compact proof or quantitative angle if relevant.", keyQuestion: "What evidence supports the explanation?", narrativeRole: "Support the lesson.", priority: 3 },
      { slideType: "roadmap", purpose: "Offer a next-step learning path.", keyQuestion: "What should someone explore next?", narrativeRole: "Extend learning.", priority: 3 }
    ]
  },
  sales_deck: {
    label: "Sales narrative",
    rationale: "Start from buyer pain, show why the solution matters, and close with a low-friction next step.",
    base: [
      { slideType: "title", purpose: "Frame the buyer problem and category.", keyQuestion: "What solution space are we discussing?", narrativeRole: "Open the buyer conversation.", priority: 1 },
      { slideType: "problem", purpose: "Surface the buyer's pain.", keyQuestion: "What pain is costing the buyer now?", narrativeRole: "Create urgency.", priority: 1 },
      { slideType: "market/context", purpose: "Show why the issue matters now.", keyQuestion: "Why is the timing meaningful?", narrativeRole: "Strengthen urgency.", priority: 1 },
      { slideType: "comparison", purpose: "Differentiate from status quo and alternatives.", keyQuestion: "Why switch from the current approach?", narrativeRole: "Earn the right to win.", priority: 1 },
      { slideType: "process/how-it-works", purpose: "Explain the solution flow.", keyQuestion: "How does the solution deliver value?", narrativeRole: "Build buyer understanding.", priority: 1 },
      { slideType: "metrics/KPI", purpose: "Add evidence, proof, or outcome framing.", keyQuestion: "What proof supports the promise?", narrativeRole: "Increase credibility.", priority: 2 },
      { slideType: "recommendation", purpose: "State the commercial next step.", keyQuestion: "What should the buyer do next?", narrativeRole: "Drive motion.", priority: 1 },
      { slideType: "roadmap", purpose: "Reduce friction with an implementation path.", keyQuestion: "How fast can this be adopted?", narrativeRole: "Ease risk.", priority: 1 },
      { slideType: "closing", purpose: "End on the decision frame.", keyQuestion: "Why act now rather than later?", narrativeRole: "Close with conviction.", priority: 1 }
    ],
    expansions: [
      { slideType: "agenda", purpose: "Orient the buyer if a longer deck is needed.", keyQuestion: "What will be covered?", narrativeRole: "Orientation.", priority: 3 }
    ]
  },
  internal_review_deck: {
    label: "Internal review narrative",
    rationale: "Focus on clarity, current state, blockers, decisions, and accountable next steps.",
    base: [
      { slideType: "title", purpose: "Frame the review scope.", keyQuestion: "What are we reviewing?", narrativeRole: "Set scope.", priority: 1 },
      { slideType: "agenda", purpose: "Organize the review.", keyQuestion: "How is the review structured?", narrativeRole: "Orient the team.", priority: 1 },
      { slideType: "metrics/KPI", purpose: "Show current state.", keyQuestion: "Where do we stand?", narrativeRole: "Anchor the conversation.", priority: 1 },
      { slideType: "problem", purpose: "Highlight blockers and risks.", keyQuestion: "What is getting in the way?", narrativeRole: "Focus on issues.", priority: 1 },
      { slideType: "comparison", purpose: "Compare current vs target or plan.", keyQuestion: "Where is the gap?", narrativeRole: "Make progress visible.", priority: 1 },
      { slideType: "process/how-it-works", purpose: "Clarify how the team is operating.", keyQuestion: "What operating motion matters here?", narrativeRole: "Explain mechanics.", priority: 2 },
      { slideType: "recommendation", purpose: "State the decisions or changes required.", keyQuestion: "What needs to change?", narrativeRole: "Drive alignment.", priority: 1 },
      { slideType: "roadmap", purpose: "Assign a forward path.", keyQuestion: "What happens next, and when?", narrativeRole: "Create accountability.", priority: 1 },
      { slideType: "closing", purpose: "Leave the team with a clear takeaway.", keyQuestion: "What should everyone remember?", narrativeRole: "Close clearly.", priority: 1 }
    ],
    expansions: [
      { slideType: "market/context", purpose: "Add external context if it affects execution.", keyQuestion: "What external factor is influencing the team?", narrativeRole: "Add external context.", priority: 3 }
    ]
  },
  roadmap_deck: {
    label: "Planning narrative",
    rationale: "Explain the objective, constraints, path, and milestones needed to execute cleanly.",
    base: [
      { slideType: "title", purpose: "Name the roadmap and objective.", keyQuestion: "What are we planning toward?", narrativeRole: "Frame the work.", priority: 1 },
      { slideType: "agenda", purpose: "Preview the plan.", keyQuestion: "How will the plan be explained?", narrativeRole: "Orient.", priority: 1 },
      { slideType: "problem", purpose: "Explain why planning is required.", keyQuestion: "What constraint or challenge must the roadmap solve?", narrativeRole: "Create need.", priority: 1 },
      { slideType: "market/context", purpose: "Capture the surrounding conditions.", keyQuestion: "What context shapes the roadmap?", narrativeRole: "Set constraints.", priority: 2 },
      { slideType: "process/how-it-works", purpose: "Describe the execution model.", keyQuestion: "How will delivery work?", narrativeRole: "Explain the motion.", priority: 1 },
      { slideType: "comparison", purpose: "Compare sequencing options if relevant.", keyQuestion: "Why this sequence instead of another?", narrativeRole: "Justify the plan.", priority: 2 },
      { slideType: "recommendation", purpose: "State the recommended sequencing logic.", keyQuestion: "What plan should we adopt?", narrativeRole: "Lock the plan.", priority: 1 },
      { slideType: "roadmap", purpose: "Lay out milestones and stages.", keyQuestion: "What is the timeline and ownership logic?", narrativeRole: "Visualize execution.", priority: 1 },
      { slideType: "closing", purpose: "Reinforce the execution takeaway.", keyQuestion: "What matters most going forward?", narrativeRole: "Close with clarity.", priority: 1 }
    ],
    expansions: [
      { slideType: "metrics/KPI", purpose: "Add milestone metrics if relevant.", keyQuestion: "How will progress be tracked?", narrativeRole: "Add checkpoints.", priority: 3 }
    ]
  }
};

function clampSlideCount(value: number): number {
  return Math.max(5, Math.min(12, value));
}

function materializeSequence(sequence: BlueprintTemplate[]): SlideBlueprint[] {
  return sequence.map((item, index) => ({
    slideIndex: index + 1,
    slideType: item.slideType,
    purpose: item.purpose,
    keyQuestion: item.keyQuestion,
    narrativeRole: item.narrativeRole
  }));
}

function adaptSequence(templates: StructureSpec, targetSlideCount: number): SlideBlueprint[] {
  const count = clampSlideCount(targetSlideCount);
  const working = [...templates.base];

  while (working.length < count && templates.expansions.length > 0) {
    const next = templates.expansions[working.length - templates.base.length] ?? templates.expansions.at(-1);
    if (!next) {
      break;
    }
    working.splice(Math.max(1, working.length - 1), 0, next);
  }

  while (working.length > count) {
    let removableIndex = -1;
    let highestPriority = -1;
    working.forEach((item, index) => {
      if (item.priority > highestPriority) {
        highestPriority = item.priority;
        removableIndex = index;
      }
    });

    if (removableIndex < 0) {
      break;
    }
    working.splice(removableIndex, 1);
  }

  return materializeSequence(working);
}

export function buildAssumptionLog(args: {
  project: ProjectRecord;
  intent: PresentationIntent;
  audienceProfile: AudienceProfile;
  evidenceGaps: string[];
}): AssumptionLog {
  const items: AssumptionItem[] = [];

  if (!args.project.audience.trim()) {
    items.push({
      id: "audience",
      label: "Audience",
      value: args.audienceProfile.audienceLabel,
      confidence: "medium",
      rationale: "The audience field was not supplied, so the system inferred likely stakeholders from the prompt."
    });
  }

  if (!args.project.tone.trim()) {
    items.push({
      id: "tone",
      label: "Tone",
      value: args.audienceProfile.recommendedTone,
      confidence: "medium",
      rationale: "The requested tone was not explicit, so the default tone was chosen based on the audience profile."
    });
  }

  if (args.intent.inferredIndustry) {
    items.push({
      id: "industry",
      label: "Industry context",
      value: args.intent.inferredIndustry,
      confidence: "low",
      rationale: "Industry context was inferred from topic keywords and should be treated as directional."
    });
  }

  if (args.evidenceGaps.length > 0) {
    items.push({
      id: "evidence",
      label: "Evidence strength",
      value: args.evidenceGaps[0],
      confidence: "low",
      rationale: "Research coverage is limited, so some statements will rely on reasoned framing rather than hard proof."
    });
  }

  if (items.length === 0) {
    items.push({
      id: "default",
      label: "Assumption posture",
      value: "The deck is using explicit user inputs with minimal inference.",
      confidence: "high",
      rationale: "The prompt already contains enough structure to keep assumptions light."
    });
  }

  return {
    summary: "The system tracks a small set of assumptions so weak inputs do not block progress or get presented as facts.",
    items
  };
}

export function buildNarrativePlan(args: {
  intent: PresentationIntent;
  audienceProfile: AudienceProfile;
  deckStrategy: DeckStrategy;
  evidenceGaps: string[];
}): NarrativePlan {
  return {
    story: `${args.intent.topic} should be presented as a connected argument that moves from context to implication to action.`,
    takeaway: args.intent.desiredOutcome,
    audienceCareAbout: args.audienceProfile.priorities,
    informationGaps: args.evidenceGaps,
    sectionPlan: [
      {
        id: "setup",
        label: "Setup",
        objective: "Frame the topic and make the audience care quickly.",
        audienceNeed: "Relevance and orientation"
      },
      {
        id: "analysis",
        label: "Analysis",
        objective: "Explain the current state, constraints, and tradeoffs.",
        audienceNeed: "Confidence in the logic"
      },
      {
        id: "decision",
        label: "Decision",
        objective: "Translate the analysis into a crisp recommendation and next step.",
        audienceNeed: "Actionable clarity"
      }
    ]
  };
}

export function buildDeckStrategy(args: {
  project: ProjectRecord;
  intent: PresentationIntent;
}): DeckStrategy {
  const structure = STRUCTURES[args.intent.deckType];
  return {
    deckType: args.intent.deckType,
    structureLabel: structure.label,
    rationale: structure.rationale,
    sequence: adaptSequence(structure, args.project.targetSlideCount)
  };
}
