import { NextResponse } from "next/server";
import { getRun } from "@/app/lib/runs";
import { generateBackstory, generateSharedImageFirstKeyframe } from "@/app/lib/pipeline";
import { Backstory, DEFAULT_VIDEO_CONFIG, ProductKey, VideoType } from "@/app/lib/types";

type Payload = {
  runId?: string;
  product?: ProductKey;
  script?: string;
  brief?: string;
  guidelines?: string;
  videoType?: VideoType;
};

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = (await request.json()) as Payload;
    const runId = typeof payload.runId === "string" ? payload.runId.trim() : "";
    const provider = "veo31_standard";
    const directProduct = payload.product;
    const directScript = typeof payload.script === "string" ? payload.script.trim() : "";
    const directBrief = typeof payload.brief === "string" ? payload.brief.trim() : "";
    const directGuidelines = typeof payload.guidelines === "string" ? payload.guidelines : undefined;
    const videoType = payload.videoType ?? DEFAULT_VIDEO_CONFIG.type;

    let resolvedRunId = runId;
    let resolvedProduct: ProductKey | undefined;
    let resolvedScript = "";
    let resolvedBrief = "";
    let backstory: Backstory | undefined;

    if (runId) {
      const run = await getRun(runId);
      if (!run) {
        return NextResponse.json({ error: `Run not found: ${runId}` }, { status: 404 });
      }
      resolvedProduct = run.product;
      resolvedScript = run.sharedPlan?.script?.trim() ?? "";
      resolvedBrief = run.brief?.trim() ?? "";
      backstory = run.sharedPlan?.backstory;
      if (!resolvedScript || !backstory) {
        return NextResponse.json({ error: "Run is missing shared script or shared backstory." }, { status: 400 });
      }
    } else {
      if (!directProduct || !directScript || !directBrief) {
        return NextResponse.json(
          { error: "Provide either runId, or product + script + brief." },
          { status: 400 }
        );
      }
      resolvedRunId = `imgdebug-${Date.now()}`;
      resolvedProduct = directProduct;
      resolvedScript = directScript;
      resolvedBrief = directBrief;
      backstory = await generateBackstory(resolvedScript, resolvedProduct, directGuidelines, resolvedBrief);
    }

    const outputDir = `${process.cwd()}/generated-runs/${resolvedRunId}/debug-${provider}-${Date.now()}`;
    await generateSharedImageFirstKeyframe(
      outputDir,
      backstory,
      resolvedProduct!,
      resolvedScript,
      directGuidelines,
      resolvedBrief,
      videoType
    );

    return NextResponse.json({
      ok: true,
      provider,
      runId: resolvedRunId,
      product: resolvedProduct,
      script: resolvedScript,
      brief: resolvedBrief,
      backstory,
      outputDir,
      keyframePath: `${outputDir}/keyframe.png`,
      sourcePath: `${outputDir}/shared-keyframe-source.png`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
