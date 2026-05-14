import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SoraStudioAspectRatio,
  SoraStudioBriefAttachment,
  SoraStudioInputRow,
  SoraStudioResolvedInputRow
} from "./types";

type HeaderKey =
  | "product"
  | "brief"
  | "businessObjective"
  | "creativeObjectiveFunnel"
  | "videoDuration"
  | "ratioDimensions"
  | "language"
  | "notificationEmail";

const HEADER_ALIASES: Record<HeaderKey, string[]> = {
  product: ["product"],
  brief: ["brief", "campaignbrief"],
  businessObjective: ["businessobjective", "objective"],
  creativeObjectiveFunnel: ["creativeobjectivefunnel", "creativeobjective", "funnel", "creativefunnel"],
  videoDuration: ["videoduration", "duration", "videolength"],
  ratioDimensions: ["ratiodimensions", "ratio", "dimensions", "aspectratio", "ratioordimensions"],
  language: ["language", "lang"],
  notificationEmail: [
    "notificationemail",
    "recipientemail",
    "email",
    "emailaddress",
    "emailid",
    "notifyemail",
    "deliveryemail"
  ]
};

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let index = 0;
  let inQuotes = false;

  while (index < line.length) {
    const char = line[index] ?? "";

    if (char === '"') {
      const peek = line[index + 1] ?? "";
      if (inQuotes && peek === '"') {
        current += '"';
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
    const score = counts.some((count) => count > 1) ? average : 0;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

function isRowEmpty(cells: string[]): boolean {
  return cells.every((cell) => compact(cell).length === 0);
}

function mapCellsToRows(table: string[][]): SoraStudioInputRow[] {
  if (table.length === 0) {
    return [];
  }

  const maxProbe = Math.min(table.length, 10);
  let headerRowIndex = 0;
  for (let rowIndex = 0; rowIndex < maxProbe; rowIndex += 1) {
    const normalized = (table[rowIndex] ?? []).map((cell) => normalizeHeader(String(cell ?? "")));
    const hasProduct = normalized.some((header) => HEADER_ALIASES.product.includes(header));
    const hasBrief = normalized.some((header) => HEADER_ALIASES.brief.includes(header));
    if (hasProduct && hasBrief) {
      headerRowIndex = rowIndex;
      break;
    }
  }

  const headerRow = table[headerRowIndex] ?? [];
  const normalizedHeaders = headerRow.map((header) => normalizeHeader(String(header ?? "")));
  const indexByHeader = new Map<HeaderKey, number>();

  (Object.keys(HEADER_ALIASES) as HeaderKey[]).forEach((key) => {
    const index = normalizedHeaders.findIndex((header) => HEADER_ALIASES[key].includes(header));
    if (index >= 0) {
      indexByHeader.set(key, index);
    }
  });

  const getCell = (cells: string[], key: HeaderKey): string => {
    const index = indexByHeader.get(key);
    if (typeof index !== "number") {
      return "";
    }
    return compact(String(cells[index] ?? ""));
  };

  const rows: SoraStudioInputRow[] = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex < table.length; rowIndex += 1) {
    const cells = table[rowIndex] ?? [];
    if (isRowEmpty(cells)) {
      continue;
    }

    rows.push({
      rowNumber: rowIndex + 1,
      product: getCell(cells, "product"),
      brief: getCell(cells, "brief"),
      businessObjective: getCell(cells, "businessObjective"),
      creativeObjectiveFunnel: getCell(cells, "creativeObjectiveFunnel"),
      videoDuration: getCell(cells, "videoDuration"),
      ratioDimensions: getCell(cells, "ratioDimensions"),
      language: getCell(cells, "language"),
      notificationEmail: getCell(cells, "notificationEmail")
    });
  }

  return rows;
}

function parseDelimitedContent(content: string): SoraStudioInputRow[] {
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
    "    rows.append(['' if cell is None else str(cell) for cell in row])",
    "print(json.dumps(rows, ensure_ascii=False))"
  ].join("\n");

  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn(pythonBin, ["-c", script, workbookPath], { stdio: ["ignore", "pipe", "pipe"] });
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
    throw new Error("Python parser returned invalid workbook payload.");
  }

  return parsed.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []));
}

async function parseXlsxContent(file: File, fileBuffer: Buffer): Promise<SoraStudioInputRow[]> {
  const safeFileName = path.basename((file.name || "input.xlsx").replace(/[^a-zA-Z0-9._-]+/g, "-"));
  const tmpPath = path.join(os.tmpdir(), `sora-studio-import-${Date.now()}-${randomUUID()}-${safeFileName}`);
  await fs.writeFile(tmpPath, fileBuffer);

  const candidates = [process.env.EXCEL_PARSER_PYTHON_BIN?.trim(), process.env.PYTHON_BIN?.trim(), "python3", "python"].filter(
    (item): item is string => Boolean(item)
  );

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
    `Unable to parse XLSX. Ensure Python with openpyxl is installed, or upload CSV. ${
      lastError instanceof Error ? lastError.message : String(lastError ?? "")
    }`.trim()
  );
}

export async function parseSoraStudioRowsFromFile(file: File): Promise<SoraStudioInputRow[]> {
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
    return parseDelimitedContent(buffer.toString("utf8"));
  }

  const isXlsx =
    fileName.endsWith(".xlsx") || fileName.endsWith(".xlsm") || fileName.endsWith(".xltx") || fileName.endsWith(".xltm");

  if (isXlsx) {
    return parseXlsxContent(file, buffer);
  }

  throw new Error("Unsupported file format. Upload .xlsx/.xlsm or CSV/TSV.");
}

function parseRequestedDurationSeconds(value: string): { requested: number; requestSeconds: 4 | 8 | 12 | 16 | 20; warning?: string } {
  const normalized = compact(value).toLowerCase();
  const match = normalized.match(/(\d{1,3})/);
  const parsed = match ? Number.parseInt(match[1] ?? "", 10) : Number.NaN;
  const requested = Number.isFinite(parsed) && parsed > 0 ? parsed : 8;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { requested: 8, requestSeconds: 8, warning: `Could not parse duration "${value}". Defaulted to 8s.` };
  }

  if (requested <= 4) {
    return { requested, requestSeconds: 4 };
  }
  if (requested <= 8) {
    return { requested, requestSeconds: 8 };
  }
  if (requested <= 12) {
    return { requested, requestSeconds: 12 };
  }
  if (requested === 15) {
    return { requested, requestSeconds: 16, warning: "Requested 15s. Normalized to 16s render as configured." };
  }
  if (requested <= 16) {
    return { requested, requestSeconds: 16 };
  }
  if (requested <= 20) {
    return { requested, requestSeconds: 20 };
  }
  return {
    requested,
    requestSeconds: 20,
    warning: `Requested ${requested}s. fal Sora currently supports up to 20s in this flow; clamped to 20s render.`
  };
}

function parseRequestedAspectRatio(value: string): { requestedAspectRatio: SoraStudioAspectRatio; renderAspectRatio: "9:16" | "16:9"; warning?: string } {
  const normalized = compact(value).toLowerCase();

  if (normalized.includes("16:9") || normalized.includes("landscape") || normalized.includes("1920x1080")) {
    return { requestedAspectRatio: "16:9", renderAspectRatio: "16:9" };
  }

  if (normalized.includes("1:1") || normalized.includes("square") || normalized.includes("1080x1080")) {
    return {
      requestedAspectRatio: "1:1",
      renderAspectRatio: "9:16",
      warning: "Requested 1:1. fal Sora in this flow renders 9:16/16:9 only, so rendered 9:16 master."
    };
  }

  return { requestedAspectRatio: "9:16", renderAspectRatio: "9:16" };
}

function parseBriefAttachments(raw: SoraStudioInputRow["briefAttachments"]): {
  attachments: SoraStudioBriefAttachment[];
  warning?: string;
} {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { attachments: [] };
  }

  const valid: SoraStudioBriefAttachment[] = [];
  for (const item of raw.slice(0, 8)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const mediaType = item.mediaType === "video" ? "video" : item.mediaType === "image" ? "image" : null;
    const source = item.source === "upload" ? "upload" : item.source === "url" ? "url" : null;
    const name = compact(item.name || "");
    const url = compact(item.url || "");
    if (!mediaType || !source || !name || !url) {
      continue;
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      continue;
    }

    valid.push({
      id: item.id ? compact(item.id) : undefined,
      name,
      mediaType,
      source,
      url,
      mimeType: item.mimeType ? compact(item.mimeType) : undefined
    });
  }

  if (valid.length === raw.length) {
    return { attachments: valid };
  }
  return {
    attachments: valid,
    warning: `Some brief attachments were invalid and skipped (${valid.length}/${raw.length} kept).`
  };
}

export function resolveSoraStudioInputRow(raw: SoraStudioInputRow): SoraStudioResolvedInputRow {
  const warnings: string[] = [];
  const product = compact(raw.product);
  const brief = compact(raw.brief);
  const businessObjective = compact(raw.businessObjective);
  const creativeObjectiveFunnel = compact(raw.creativeObjectiveFunnel);
  const language = compact(raw.language) || "English";
  const notificationEmail = compact(raw.notificationEmail ?? "");

  if (!product) {
    throw new Error(`Row ${raw.rowNumber}: Product is required.`);
  }
  if (brief.length < 12) {
    throw new Error(`Row ${raw.rowNumber}: Brief must be at least 12 characters.`);
  }

  const duration = parseRequestedDurationSeconds(raw.videoDuration);
  if (duration.warning) {
    warnings.push(duration.warning);
  }

  const ratio = parseRequestedAspectRatio(raw.ratioDimensions);
  if (ratio.warning) {
    warnings.push(ratio.warning);
  }

  const parsedAttachments = parseBriefAttachments(raw.briefAttachments);
  if (parsedAttachments.warning) {
    warnings.push(parsedAttachments.warning);
  }

  const strictParityMode = typeof raw.strictParityMode === "boolean" ? raw.strictParityMode : true;

  return {
    rowNumber: raw.rowNumber,
    product,
    brief,
    businessObjective,
    creativeObjectiveFunnel,
    videoDuration: raw.videoDuration,
    ratioDimensions: raw.ratioDimensions,
    language: raw.language,
    notificationEmail: notificationEmail || undefined,
    requestedDurationSeconds: duration.requested,
    requestDurationSeconds: duration.requestSeconds,
    requestedAspectRatio: ratio.requestedAspectRatio,
    renderAspectRatio: ratio.renderAspectRatio,
    resolvedLanguage: language,
    strictParityMode,
    briefAttachments: parsedAttachments.attachments,
    warnings
  };
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

export function resolveSoraStudioImportOptions(formData: FormData): {
  autoRender: boolean;
  maxRows: number;
  strictParityMode: boolean;
  notificationEmail?: string;
} {
  const autoRender = parseBoolean(typeof formData.get("autoRender") === "string" ? String(formData.get("autoRender")) : undefined, true);
  const maxRows = Math.min(300, parsePositiveInt(typeof formData.get("maxRows") === "string" ? String(formData.get("maxRows")) : undefined, 100));
  const strictParityMode = parseBoolean(
    typeof formData.get("strictParityMode") === "string" ? String(formData.get("strictParityMode")) : undefined,
    true
  );
  const notificationEmail =
    typeof formData.get("notificationEmail") === "string" ? compact(String(formData.get("notificationEmail"))) : "";
  return { autoRender, maxRows, strictParityMode, notificationEmail: notificationEmail || undefined };
}
