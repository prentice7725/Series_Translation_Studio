import type {
  GlossaryHit,
  QaFlag,
  TmMatch,
  UsedReferencePart
} from "@sts/common";
import type { TokenUsage, ValidationResult } from "@sts/translator-core";

export interface EditorialRequest {
  projectId: string;
  bookId: string;
  segmentId: string;
  sourceText: string;
  aiTranslation: string;
  referenceTranslation?: string;
  tmMatches: TmMatch[];
  glossaryHits: GlossaryHit[];
  stylebookSummary: string;
  characterProfiles: Array<{ name: string; summary: string }>;
  previousContext: Array<{ sourceText: string; translation: string }>;
  systemPrompt: string;
  promptVersion: string;
}

export interface EditorialResponse {
  editorialTranslation: string;
  decision: "approve" | "needs_review" | "reject";
  tmGrade: "gold_candidate" | "none" | "rejected";
  confidence: number;
  rationale: string;
  usedReferenceParts: UsedReferencePart[];
  qaFlags: QaFlag[];
  responseJson: unknown;
  usage?: TokenUsage;
}

export interface EditorialProvider {
  name: string;
  editSegment(input: EditorialRequest): Promise<EditorialResponse>;
  validateConfig(): Promise<ValidationResult>;
}

export const editorialPromptVersion = "editorial-ko-v1";

export const editorialPrompt = [
  "You are an AI Korean literary editor for a spoiler-safe EPUB translation workflow.",
  "Compare SOURCE_TEXT, AI_TRANSLATION, optional REFERENCE_TRANSLATION, TM, glossary, stylebook, and previous context.",
  "Create a polished Korean editorial_translation for only the current segment.",
  "Do not add plot explanations, summaries, or content that is not present in the source.",
  "Glossary and gold TM have priority. Existing Korean reference is useful context, not an answer key.",
  "Return strict JSON with this shape:",
  '{"editorial_translation":"string","decision":"approve|needs_review|reject","tm_grade":"gold_candidate|none|rejected","confidence":0.0,"rationale":"string","used_reference_parts":[],"qa_flags":[]}'
].join("\n");

export class MockEditorialProvider implements EditorialProvider {
  readonly name = "mock";

  async validateConfig(): Promise<ValidationResult> {
    return { ok: true };
  }

  async editSegment(input: EditorialRequest): Promise<EditorialResponse> {
    return parseEditorialResponse({
      editorial_translation: input.aiTranslation,
      decision: "approve",
      tm_grade: "gold_candidate",
      confidence: 0.9,
      rationale: "mock editorial approval",
      used_reference_parts: [],
      qa_flags: []
    });
  }
}

export function buildEditorialUserPrompt(input: EditorialRequest): string {
  return [
    input.systemPrompt,
    "",
    `SOURCE_TEXT:\n${input.sourceText}`,
    "",
    `AI_TRANSLATION:\n${input.aiTranslation}`,
    "",
    `REFERENCE_TRANSLATION:\n${input.referenceTranslation || "None"}`,
    "",
    "TM_MATCHES:",
    input.tmMatches.length
      ? input.tmMatches
          .map(
            (match) =>
              `- ${match.unit.grade} ${match.matchType} ${match.weightedScore.toFixed(2)}\n  source: ${match.unit.sourceText}\n  target: ${match.unit.targetText}`
          )
          .join("\n")
      : "- None",
    "",
    "GLOSSARY_HITS:",
    input.glossaryHits.length
      ? input.glossaryHits
          .map((hit) => `- ${hit.sourceTerm} => ${hit.canonicalKo}; confidence=${hit.confidence}`)
          .join("\n")
      : "- None",
    "",
    `STYLEBOOK:\n${input.stylebookSummary || "None"}`,
    "",
    "PREVIOUS_CONTEXT:",
    input.previousContext.length
      ? input.previousContext
          .map((context) => `- source: ${context.sourceText}\n  translation: ${context.translation}`)
          .join("\n")
      : "- None"
  ].join("\n");
}

export function parseEditorialResponse(raw: unknown): EditorialResponse {
  const parsed = typeof raw === "string" ? parseJson(raw) : raw;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Editorial response must be a JSON object.");
  }

  const record = parsed as Record<string, unknown>;
  const editorialTranslation = readString(record.editorial_translation);
  if (!editorialTranslation.trim()) {
    throw new Error("Editorial response is missing editorial_translation.");
  }

  const confidence = readNumber(record.confidence);
  return {
    editorialTranslation,
    decision: readDecision(record.decision, confidence),
    tmGrade: readTmGrade(record.tm_grade),
    confidence,
    rationale: readString(record.rationale),
    usedReferenceParts: readUsedReferenceParts(record.used_reference_parts),
    qaFlags: readQaFlags(record.qa_flags),
    responseJson: parsed,
    usage: readUsage(record.usage)
  };
}

export function shouldRegisterGoldCandidate(response: EditorialResponse): boolean {
  return (
    response.decision === "approve" &&
    response.tmGrade === "gold_candidate" &&
    response.confidence >= 0.85 &&
    !response.qaFlags.some((flag) => flag.severity === "error" || flag.severity === "blocking")
  );
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(stripJsonFence(raw));
  } catch (error) {
    throw new Error("Editorial response was not valid JSON.", { cause: error });
  }
}

function stripJsonFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

function readDecision(value: unknown, confidence: number): EditorialResponse["decision"] {
  if (value === "approve" && confidence >= 0.85) {
    return "approve";
  }
  if (value === "reject") {
    return "reject";
  }
  return "needs_review";
}

function readTmGrade(value: unknown): EditorialResponse["tmGrade"] {
  return value === "gold_candidate" || value === "rejected" ? value : "none";
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function readUsedReferenceParts(value: unknown): UsedReferencePart[] {
  return Array.isArray(value)
    ? value.flatMap((item): UsedReferencePart[] =>
        item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string"
          ? [{ text: (item as { text: string }).text, purpose: readString((item as { purpose?: unknown }).purpose) || undefined }]
          : []
      )
    : [];
}

function readQaFlags(value: unknown): QaFlag[] {
  return Array.isArray(value)
    ? value.flatMap((item): QaFlag[] => {
        if (!item || typeof item !== "object") {
          return [];
        }
        const record = item as Record<string, unknown>;
        const severity = readSeverity(record.severity);
        return [
          {
            type: readString(record.type) || "editorial",
            severity,
            message: readString(record.message)
          }
        ];
      })
    : [];
}

function readSeverity(value: unknown): QaFlag["severity"] {
  return value === "info" || value === "warning" || value === "error" || value === "blocking"
    ? value
    : "warning";
}

function readUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return {
    inputTokens: typeof record.inputTokens === "number" ? record.inputTokens : undefined,
    outputTokens: typeof record.outputTokens === "number" ? record.outputTokens : undefined,
    totalTokens: typeof record.totalTokens === "number" ? record.totalTokens : undefined
  };
}
