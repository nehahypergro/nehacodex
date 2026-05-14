import "server-only";

const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "another",
  "because",
  "before",
  "being",
  "between",
  "could",
  "every",
  "from",
  "have",
  "into",
  "just",
  "like",
  "likely",
  "might",
  "other",
  "should",
  "their",
  "there",
  "these",
  "those",
  "through",
  "using",
  "want",
  "with",
  "would",
  "your"
]);

export function truncateText(value: string, maxLength: number): string {
  const clean = value.trim();
  if (clean.length <= maxLength) {
    return clean;
  }
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function sentenceCase(value: string): string {
  const clean = value.trim();
  if (!clean) {
    return "";
  }
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function splitIntoSentences(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
}

export function firstSentence(value: string): string {
  return splitIntoSentences(value)[0] ?? normalizeWhitespace(value);
}

export function extractKeywords(input: string, limit = 8): string[] {
  const counts = new Map<string, number>();
  const words = input
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]+/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));

  for (const word of words) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

export function keywordSet(input: string): Set<string> {
  return new Set(extractKeywords(input, 24));
}

export function overlapScore(a: string, b: string): number {
  const aWords = keywordSet(a);
  const bWords = keywordSet(b);
  if (aWords.size === 0 || bWords.size === 0) {
    return 0;
  }

  let matches = 0;
  for (const word of aWords) {
    if (bWords.has(word)) {
      matches += 1;
    }
  }

  return matches / Math.max(aWords.size, bWords.size);
}

export function summarizeText(input: string, maxLength = 280): string {
  const normalized = normalizeWhitespace(input);
  if (!normalized) {
    return "";
  }

  const summary = firstSentence(normalized);
  return truncateText(summary || normalized, maxLength);
}
