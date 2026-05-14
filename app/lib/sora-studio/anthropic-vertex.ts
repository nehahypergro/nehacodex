import { GoogleAuth } from "google-auth-library";
import { z } from "zod";
import { SoraStudioResolvedInputRow } from "./types";

const DEFAULT_VERTEX_LOCATION = "global";
const DEFAULT_ANTHROPIC_VERTEX_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TIMEOUT_MS = 120000;

const VERTEX_LOCATION = process.env.ANTHROPIC_VERTEX_LOCATION?.trim() || DEFAULT_VERTEX_LOCATION;
const ANTHROPIC_VERTEX_MODEL = process.env.ANTHROPIC_VERTEX_MODEL?.trim() || DEFAULT_ANTHROPIC_VERTEX_MODEL;
const ANTHROPIC_VERTEX_FALLBACK_MODELS = (process.env.ANTHROPIC_VERTEX_FALLBACK_MODELS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const ANTHROPIC_VERTEX_FALLBACK_LOCATIONS = (process.env.ANTHROPIC_VERTEX_FALLBACK_LOCATIONS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const ANTHROPIC_VERTEX_MAX_TOKENS = Number(process.env.ANTHROPIC_VERTEX_MAX_TOKENS ?? DEFAULT_MAX_TOKENS);
const ANTHROPIC_VERTEX_HTTP_TIMEOUT_MS = Number(process.env.ANTHROPIC_VERTEX_HTTP_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

const outputSchema = z.object({
  script: z.string().trim().min(12).max(2000),
  soraPrompt: z.string().trim().min(40).max(12000)
});

export interface SoraStudioAnthropicVertexOutput {
  script: string;
  soraPrompt: string;
  model: string;
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed);
  }

  const withoutFence = trimmed.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  if (withoutFence.startsWith("{") && withoutFence.endsWith("}")) {
    return JSON.parse(withoutFence);
  }

  const first = withoutFence.indexOf("{");
  const last = withoutFence.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return JSON.parse(withoutFence.slice(first, last + 1));
  }

  throw new Error("Anthropic Vertex response did not include a JSON object.");
}

function enforcePromptLocks(prompt: string): string {
  const lines = [prompt.trim()];
  const lower = prompt.toLowerCase();

  if (!lower.includes("indian face") && !lower.includes("indian faces")) {
    lines.push("Casting lock: use authentic Indian faces only; no non-Indian faces.");
  }
  if (!lower.includes("kotak mahindra bank")) {
    lines.push("Brand lock: this ad is for Kotak Mahindra Bank.");
  }
  if (!lower.includes("no subtitles") && !lower.includes("no subtitle")) {
    lines.push("No subtitles, watermarks, logos, on-screen UI, phone/laptop/tablet screens, or card close-ups.");
  }

  return lines.join("\n");
}

function extractTextFromClaudeResponse(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const message = payload as { content?: unknown };
  if (!Array.isArray(message.content)) {
    return "";
  }

  const parts = message.content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      const entry = item as { type?: unknown; text?: unknown };
      if (entry.type === "text" && typeof entry.text === "string") {
        return entry.text;
      }
      return "";
    })
    .filter((text) => text.trim().length > 0);

  return parts.join("\n").trim();
}

async function parseVertexErrorMessage(response: Response): Promise<string> {
  const raw = await response.text();
  if (!raw) {
    return `HTTP ${response.status}`;
  }

  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    return parsed.error?.message?.trim() || raw;
  } catch {
    return raw;
  }
}

function buildScriptWriterPrompt(row: SoraStudioResolvedInputRow): string {
  return [
    "You are a senior ad scriptwriter and prompt director for India-focused short video ads.",
    "Return STRICT JSON only with keys: script, soraPrompt.",
    "Hard constraints:",
    "1) Always use Indian faces only.",
    "2) Brand is always Kotak Mahindra Bank.",
    "3) Keep script in the requested language.",
    "4) Keep narrative aligned to brief, business objective, and funnel objective.",
    "5) soraPrompt must be production-ready for text-to-video.",
    "6) No subtitles, watermarks, logos, on-screen UI, phone/laptop/tablet screens, or card close-ups.",
    "",
    `Product: ${row.product}`,
    `Brief: ${row.brief}`,
    `Business Objective: ${row.businessObjective || "Not provided"}`,
    `Creative Objective / Funnel: ${row.creativeObjectiveFunnel || "Not provided"}`,
    `Requested Duration: ${row.requestedDurationSeconds}s (render request is ${row.requestDurationSeconds}s)`,
    `Requested Ratio: ${row.requestedAspectRatio} (render ratio is ${row.renderAspectRatio})`,
    `Language: ${row.resolvedLanguage}`,
    "",
    "Output JSON schema:",
    '{"script":"...", "soraPrompt":"..."}'
  ].join("\n");
}

function resolveVertexHost(location: string): string {
  const normalized = location.trim().toLowerCase();
  if (normalized === "global") {
    return "aiplatform.googleapis.com";
  }
  if (normalized === "us" || normalized === "eu") {
    return `aiplatform.${normalized}.rep.googleapis.com`;
  }
  return `${normalized}-aiplatform.googleapis.com`;
}

async function getGoogleAccessTokenAndProjectId(): Promise<{ accessToken: string; projectId: string }> {
  const explicitToken = process.env.ANTHROPIC_VERTEX_ACCESS_TOKEN?.trim();
  if (explicitToken) {
    const explicitProjectId = process.env.ANTHROPIC_VERTEX_PROJECT_ID?.trim();
    if (!explicitProjectId) {
      throw new Error("ANTHROPIC_VERTEX_PROJECT_ID is required when using ANTHROPIC_VERTEX_ACCESS_TOKEN.");
    }
    return { accessToken: explicitToken, projectId: explicitProjectId };
  }

  let inlineCredentials: Record<string, unknown> | undefined;
  const inlineCredentialsRaw = process.env.ANTHROPIC_VERTEX_SERVICE_ACCOUNT_JSON?.trim();
  if (inlineCredentialsRaw) {
    try {
      inlineCredentials = JSON.parse(inlineCredentialsRaw) as Record<string, unknown>;
    } catch {
      throw new Error("ANTHROPIC_VERTEX_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
  }

  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    credentials: inlineCredentials
  });

  const client = await auth.getClient();
  const tokenResponse = await (client as unknown as { getAccessToken: () => Promise<unknown> }).getAccessToken();
  const accessToken =
    typeof tokenResponse === "string"
      ? tokenResponse
      : typeof tokenResponse === "object" && tokenResponse && "token" in tokenResponse && typeof (tokenResponse as { token?: unknown }).token === "string"
        ? ((tokenResponse as { token?: string }).token ?? "")
        : "";

  if (!accessToken) {
    throw new Error("Could not obtain Google access token for Vertex AI. Configure ADC or service account credentials.");
  }

  const projectId = process.env.ANTHROPIC_VERTEX_PROJECT_ID?.trim() || (await auth.getProjectId());
  if (!projectId) {
    throw new Error("ANTHROPIC_VERTEX_PROJECT_ID is required when project id cannot be inferred from credentials.");
  }

  return { accessToken, projectId };
}

export async function generateSoraStudioScriptAndPromptWithAnthropicVertex(
  row: SoraStudioResolvedInputRow
): Promise<SoraStudioAnthropicVertexOutput> {
  const { accessToken, projectId } = await getGoogleAccessTokenAndProjectId();

  const prompt = buildScriptWriterPrompt(row);
  const requestBody = {
    anthropic_version: "vertex-2023-10-16",
    messages: [{ role: "user", content: prompt }],
    max_tokens: Number.isFinite(ANTHROPIC_VERTEX_MAX_TOKENS) ? Math.max(256, ANTHROPIC_VERTEX_MAX_TOKENS) : DEFAULT_MAX_TOKENS,
    temperature: 0.35,
    stream: false
  };

  const timeoutMs =
    Number.isFinite(ANTHROPIC_VERTEX_HTTP_TIMEOUT_MS) && ANTHROPIC_VERTEX_HTTP_TIMEOUT_MS > 0
      ? ANTHROPIC_VERTEX_HTTP_TIMEOUT_MS
      : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const locationCandidates = [VERTEX_LOCATION, ...ANTHROPIC_VERTEX_FALLBACK_LOCATIONS].filter(
    (item, index, array) => item.length > 0 && array.indexOf(item) === index
  );
  const modelCandidates = [ANTHROPIC_VERTEX_MODEL, ...ANTHROPIC_VERTEX_FALLBACK_MODELS].filter(
    (item, index, array) => item.length > 0 && array.indexOf(item) === index
  );
  const fallbackErrors: string[] = [];

  for (const location of locationCandidates) {
    const vertexHost = resolveVertexHost(location);
    for (const modelId of modelCandidates) {
      const endpoint =
        `https://${vertexHost}/v1/projects/${projectId}/locations/${location}` +
        `/publishers/anthropic/models/${modelId}:rawPredict`;

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json; charset=utf-8"
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`Anthropic Vertex request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
        }
        throw error;
      }

      if (!response.ok) {
        const message = await parseVertexErrorMessage(response);
        const normalizedMessage = message.toLowerCase();
        const retryableModelMiss =
          response.status === 404 ||
          (response.status === 403 && /not have access|permission|forbidden/i.test(normalizedMessage)) ||
          (response.status === 400 && /not servable in region|supported regions|unavailable in region/i.test(normalizedMessage)) ||
          response.status >= 500;
        if (retryableModelMiss) {
          fallbackErrors.push(`${location}/${modelId}: HTTP ${response.status} ${message}`);
          continue;
        }
        throw new Error(`Anthropic Vertex request failed: HTTP ${response.status} ${message}`);
      }

      const json = (await response.json()) as unknown;
      const text = extractTextFromClaudeResponse(json);
      if (!text) {
        throw new Error("Anthropic Vertex returned an empty response text.");
      }

      const parsed = outputSchema.parse(parseJsonObject(text));
      clearTimeout(timeout);
      return {
        script: parsed.script.replace(/\s+/g, " ").trim(),
        soraPrompt: enforcePromptLocks(parsed.soraPrompt),
        model: `${location}/${modelId}`
      };
    }
  }

  clearTimeout(timeout);
  throw new Error(
    `Anthropic Vertex model access failed for all candidates. ${fallbackErrors.length > 0 ? fallbackErrors.join(" | ") : "No models to try."}`
  );
}

export function getSoraStudioScriptWriterPromptTemplate(row: SoraStudioResolvedInputRow): string {
  return buildScriptWriterPrompt(row);
}
