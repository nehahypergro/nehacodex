import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { ProductKey, VideoType } from "./types";

type CanonicalHeader =
  | "product"
  | "brief"
  | "businessObjective"
  | "creativeObjectiveFunnel"
  | "videoDuration"
  | "ratioDimensions"
  | "language";

const HEADER_ALIASES: Record<CanonicalHeader, string[]> = {
  product: ["product"],
  brief: ["brief", "campaignbrief"],
  businessObjective: ["businessobjective", "objective"],
  creativeObjectiveFunnel: ["creativeobjectivefunnel", "creativeobjective", "funnel", "creativefunnel"],
  videoDuration: ["videoduration", "duration", "videolength"],
  ratioDimensions: ["ratiodimensions", "ratio", "dimensions", "aspectratio", "ratioordimensions"],
  language: ["language", "lang"]
};

export interface SoraImportRow {
  rowNumber: number;
  productRaw: string;
  briefRaw: string;
  businessObjectiveRaw: string;
  creativeObjectiveFunnelRaw: string;
  videoDurationRaw: string;
  ratioDimensionsRaw: string;
  languageRaw: string;
}

export interface SoraResolvedRow {
  rowNumber: number;
  originalProduct: string;
  product: ProductKey;
  brief: string;
  guidelines?: string;
  durationSeconds: 8 | 15 | 20;
  videoType: VideoType;
  requestedAspectRatio?: "9:16" | "1:1" | "16:9";
  requestedLanguage?: string;
  warnings: string[];
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function inferProduct(value: string, brief: string): { product: ProductKey; warning?: string } {
  const normalized = compactText(value).toLowerCase();
  const normalizedBrief = compactText(brief).toLowerCase();
  const combined = `${normalized} ${normalizedBrief}`.trim();

  if (combined.includes("cashback")) {
    return { product: "kotak_cashback" };
  }
  if (
    combined.includes("air plus") ||
    combined.includes("airplus") ||
    combined.includes("travel") ||
    combined.includes("credit card") ||
    combined.includes("credit cards") ||
    combined.includes("card")
  ) {
    return { product: "kotak_air_plus" };
  }

  return {
    product: "kotak_air_plus",
    warning: `Product "${value}" is outside the native two-product pipeline. Mapped to generic Kotak Air Plus motion profile while preserving your exact product name in script/prompt generation.`
  };
}

function inferDurationSeconds(value: string): { seconds: 8 | 15 | 20; warning?: string } {
  const normalized = compactText(value).toLowerCase();
  if (!normalized) {
    return { seconds: 8, warning: "Missing video duration, defaulted to 8s." };
  }

  const match = normalized.match(/(\d{1,3})/);
  const parsed = match ? Number.parseInt(match[1] ?? "", 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { seconds: 8, warning: `Could not parse duration "${value}", defaulted to 8s.` };
  }

  if (parsed <= 10) {
    return { seconds: 8 };
  }
  if (parsed <= 17) {
    return { seconds: 15 };
  }
  return { seconds: 20 };
}

function inferAspectRatio(value: string): "9:16" | "1:1" | "16:9" | undefined {
  const normalized = compactText(value).toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized.includes("9:16") ||
    normalized.includes("1080x1920") ||
    normalized.includes("1920x1080 portrait") ||
    normalized.includes("portrait")
  ) {
    return "9:16";
  }
  if (normalized.includes("1:1") || normalized.includes("1080x1080") || normalized.includes("square")) {
    return "1:1";
  }
  if (normalized.includes("16:9") || normalized.includes("1920x1080") || normalized.includes("landscape")) {
    return "16:9";
  }
  return undefined;
}

function inferVideoType(durationSeconds: 8 | 15 | 20, businessObjective: string, creativeObjectiveFunnel: string, brief: string): VideoType {
  const intent = `${businessObjective} ${creativeObjectiveFunnel} ${brief}`.toLowerCase();

  if (durationSeconds === 8) {
    return intent.includes("montage") ? "montage" : "point_to_camera_multi_scene";
  }

  if (/\b(feature|benefit|comparison|half|split)\b/.test(intent)) {
    return "features_half_half";
  }
  if (/\b(montage|awareness|tofu|top of funnel)\b/.test(intent)) {
    return "montage";
  }
  return "montage";
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let index = 0;
  let inQuotes = false;

  while (index < line.length) {
    const char = line[index] ?? "";
    if (char === "\"") {
      const peek = line[index + 1] ?? "";
      if (inQuotes && peek === "\"") {
        current += "\"";
        index += 2;
        continue;
      }
      inQuotes = !inQuotes;
      index += 1;
      continue;
    }

    if (!inQuotes && char === delimiter) {
      cells.push(current);
      current = "";
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  cells.push(current);
  return cells;
}

function detectDelimiter(lines: string[]): string {
  const sample = lines.slice(0, 8).filter((line) => line.trim().length > 0);
  if (sample.length === 0) {
    return ",";
  }

  const candidates: Array<"," | "\t" | ";"> = [",", "\t", ";"];
  let best = ",";
  let bestScore = -1;

  for (const candidate of candidates) {
    const counts = sample.map((line) => parseDelimitedLine(line, candidate).length);
    const average = counts.reduce((sum, count) => sum + count, 0) / counts.length;
    const hasMultipleCols = counts.some((count) => count > 1);
    const score = hasMultipleCols ? average : 0;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

function isRowEmpty(cells: string[]): boolean {
  return cells.every((cell) => compactText(cell).length === 0);
}

function mapCellsToRows(table: string[][]): SoraImportRow[] {
  if (table.length === 0) {
    return [];
  }

  const findHeaderRowIndex = (): number => {
    const maxProbe = Math.min(table.length, 10);
    for (let rowIndex = 0; rowIndex < maxProbe; rowIndex += 1) {
      const row = table[rowIndex] ?? [];
      const normalized = row.map((cell) => normalizeHeader(String(cell ?? "")));
      const hasProduct = normalized.some((header) => HEADER_ALIASES.product.includes(header));
      const hasBrief = normalized.some((header) => HEADER_ALIASES.brief.includes(header));
      if (hasProduct && hasBrief) {
        return rowIndex;
      }
    }
    return 0;
  };

  const headerRowIndex = findHeaderRowIndex();
  const headerRow = table[headerRowIndex] ?? [];
  const indexByCanonicalHeader = new Map<CanonicalHeader, number>();
  const normalizedHeaders = headerRow.map((header) => normalizeHeader(String(header ?? "")));

  (Object.keys(HEADER_ALIASES) as CanonicalHeader[]).forEach((key) => {
    const aliases = HEADER_ALIASES[key];
    const index = normalizedHeaders.findIndex((header) => aliases.includes(header));
    if (index >= 0) {
      indexByCanonicalHeader.set(key, index);
    }
  });

  const getCell = (cells: string[], key: CanonicalHeader): string => {
    const index = indexByCanonicalHeader.get(key);
    if (typeof index !== "number") {
      return "";
    }
    return compactText(String(cells[index] ?? ""));
  };

  const rows: SoraImportRow[] = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex < table.length; rowIndex += 1) {
    const cells = table[rowIndex] ?? [];
    if (isRowEmpty(cells)) {
      continue;
    }
    rows.push({
      rowNumber: rowIndex + 1,
      productRaw: getCell(cells, "product"),
      briefRaw: getCell(cells, "brief"),
      businessObjectiveRaw: getCell(cells, "businessObjective"),
      creativeObjectiveFunnelRaw: getCell(cells, "creativeObjectiveFunnel"),
      videoDurationRaw: getCell(cells, "videoDuration"),
      ratioDimensionsRaw: getCell(cells, "ratioDimensions"),
      languageRaw: getCell(cells, "language")
    });
  }

  return rows;
}

function parseDelimitedContent(content: string): SoraImportRow[] {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const delimiter = detectDelimiter(lines);
  const table = lines.map((line) => parseDelimitedLine(line, delimiter));
  return mapCellsToRows(table);
}

async function runPythonParser(pythonBin: string, workbookPath: string): Promise<string[][]> {
  const script = [
    "import json, sys",
    "from openpyxl import load_workbook",
    "workbook_path = sys.argv[1]",
    "wb = load_workbook(workbook_path, read_only=True, data_only=True)",
    "sheet = wb[wb.sheetnames[0]]",
    "rows = []",
    "for row in sheet.iter_rows(values_only=True):",
    "    rows.append([\"\" if cell is None else str(cell) for cell in row])",
    "print(json.dumps(rows, ensure_ascii=False))"
  ].join("\n");

  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn(pythonBin, ["-c", script, workbookPath], {
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : `Failed to start ${pythonBin}.`);
  }

  if (!proc.stdout || !proc.stderr) {
    throw new Error(`Failed to capture parser output streams for ${pythonBin}.`);
  }

  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  proc.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    proc.on("error", (error) => reject(error));
    proc.on("close", (code) => resolve(typeof code === "number" ? code : 1));
  }).catch((error) => {
    throw new Error(error instanceof Error ? error.message : `Failed while running ${pythonBin}.`);
  });

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `Python parser exited with code ${exitCode}.`);
  }

  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Python parser returned an invalid workbook payload.");
  }
  return parsed.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []));
}

async function parseXlsxContent(file: File, fileBuffer: Buffer): Promise<SoraImportRow[]> {
  const safeFileName = path.basename((file.name || "input.xlsx").replace(/[^a-zA-Z0-9._-]+/g, "-"));
  const tmpPath = path.join(os.tmpdir(), `sora-import-${Date.now()}-${randomUUID()}-${safeFileName}`);
  await fs.writeFile(tmpPath, fileBuffer);

  const candidates = [
    process.env.EXCEL_PARSER_PYTHON_BIN?.trim(),
    process.env.PYTHON_BIN?.trim(),
    "python3",
    "python"
  ].filter((value): value is string => Boolean(value));

  let lastError: unknown;
  try {
    for (const pythonBin of candidates) {
      try {
        const table = await runPythonParser(pythonBin, tmpPath);
        return mapCellsToRows(table);
      } catch (error) {
        lastError = error;
      }
    }
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }

  throw new Error(
    `Unable to parse XLSX file. Ensure Python with openpyxl is available or upload CSV. ${
      lastError instanceof Error ? lastError.message : String(lastError ?? "")
    }`.trim()
  );
}

export async function parseSoraImportRowsFromFile(file: File): Promise<SoraImportRow[]> {
  const fileName = (file.name || "").toLowerCase();
  const mime = (file.type || "").toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  const isDelimited =
    fileName.endsWith(".csv") ||
    fileName.endsWith(".tsv") ||
    mime.includes("csv") ||
    mime.includes("tab-separated-values") ||
    mime.startsWith("text/");

  if (isDelimited) {
    const text = buffer.toString("utf8");
    return parseDelimitedContent(text);
  }

  const isXlsx =
    fileName.endsWith(".xlsx") || fileName.endsWith(".xlsm") || fileName.endsWith(".xltx") || fileName.endsWith(".xltm");

  if (isXlsx) {
    return parseXlsxContent(file, buffer);
  }

  throw new Error("Unsupported file format. Upload .xlsx/.xlsm or a CSV/TSV exported from Excel.");
}

export function resolveSoraImportRow(raw: SoraImportRow): SoraResolvedRow {
  const warnings: string[] = [];
  const inferredProduct = inferProduct(raw.productRaw, raw.briefRaw);
  const product = inferredProduct.product;
  if (inferredProduct.warning) {
    warnings.push(inferredProduct.warning);
  }

  const brief = compactText(raw.briefRaw);
  if (brief.length < 12) {
    throw new Error(`Row ${raw.rowNumber}: brief must be at least 12 characters.`);
  }

  const duration = inferDurationSeconds(raw.videoDurationRaw);
  if (duration.warning) {
    warnings.push(duration.warning);
  }

  const requestedAspectRatio = inferAspectRatio(raw.ratioDimensionsRaw);
  if (raw.ratioDimensionsRaw && !requestedAspectRatio) {
    warnings.push(`Could not parse ratio "${raw.ratioDimensionsRaw}". Defaulted to 9:16 master generation.`);
  }

  const language = compactText(raw.languageRaw);
  const businessObjective = compactText(raw.businessObjectiveRaw);
  const creativeObjectiveFunnel = compactText(raw.creativeObjectiveFunnelRaw);
  const videoType = inferVideoType(duration.seconds, businessObjective, creativeObjectiveFunnel, brief);

  const guidelinesLines: string[] = [];
  if (raw.productRaw) {
    guidelinesLines.push(`Exact Kotak product context from planning sheet: ${raw.productRaw}.`);
    guidelinesLines.push("Bank context is always Kotak Mahindra Bank.");
  }
  if (businessObjective) {
    guidelinesLines.push(`Business objective: ${businessObjective}.`);
  }
  if (creativeObjectiveFunnel) {
    guidelinesLines.push(`Creative objective / funnel: ${creativeObjectiveFunnel}.`);
  }
  if (language) {
    guidelinesLines.push(`Spoken script language must be ${language}. Keep wording and pronunciation natural for ${language}.`);
  }
  if (requestedAspectRatio) {
    if (requestedAspectRatio === "9:16") {
      guidelinesLines.push("Primary delivery ratio: 9:16 portrait.");
    } else {
      guidelinesLines.push(
        `Requested delivery ratio: ${requestedAspectRatio}. Generate the master in 9:16 first, then create adapts for ${requestedAspectRatio}.`
      );
      warnings.push(`Requested ${requestedAspectRatio}; pipeline still renders a 9:16 master and requires adapt generation afterward.`);
    }
  }

  return {
    rowNumber: raw.rowNumber,
    originalProduct: raw.productRaw,
    product,
    brief,
    guidelines: guidelinesLines.length > 0 ? guidelinesLines.join("\n") : undefined,
    durationSeconds: duration.seconds,
    videoType,
    requestedAspectRatio,
    requestedLanguage: language || undefined,
    warnings
  };
}

export function resolveImportOptions(formData: FormData): { autoStart: boolean; maxRows: number } {
  const autoStart = parseBoolean(
    typeof formData.get("autoStart") === "string" ? String(formData.get("autoStart")) : undefined,
    true
  );
  const maxRows = Math.min(200, parsePositiveInt(typeof formData.get("maxRows") === "string" ? String(formData.get("maxRows")) : undefined, 50));
  return { autoStart, maxRows };
}
