import { createHash, randomUUID } from "node:crypto";
import type { BlockId, JobId, TextBlock, TranslationSegment } from "@sts/common";
import { nowTimestamp } from "@sts/common";

export interface TranslationRequest {
  sourceLang: "en";
  targetLang: "ko";
  sourceText: string;
  systemPrompt: string;
  promptVersion: string;
}

export interface TranslationCacheKeyInput {
  sourceHash: string;
  provider: string;
  model: string;
  promptVersion: string;
  promptHash: string;
  glossaryVersion?: string;
  stylebookVersion?: string;
  tmContextHash?: string;
  translationOptionsHash?: string;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface TranslationResponse {
  translation: string;
  usedTerms: string[];
  uncertainTerms: string[];
  qaFlags: string[];
  notes?: string;
  responseJson: unknown;
  usage?: TokenUsage;
}

export interface ProviderConfig {
  projectId?: string;
  location?: string;
  model?: string;
  timeoutMs?: number;
}

export interface ValidationResult {
  ok: boolean;
  message?: string;
}

export interface ProviderError extends Error {
  code: string;
  retryable: boolean;
  cause?: unknown;
}

export interface TranslationProvider {
  name: string;
  translateSegment(input: TranslationRequest): Promise<TranslationResponse>;
  validateConfig(config?: ProviderConfig): Promise<ValidationResult>;
}

export interface TranslateTextBlockInput {
  jobId: JobId;
  block: TextBlock;
  provider: TranslationProvider;
  prompt?: string;
  promptVersion?: string;
}

export const literaryKoPromptVersion = "literary-ko-v1";

export const literaryKoPrompt = [
  "You are a professional English-to-Korean literary translator.",
  "Translate only CURRENT_TEXT.",
  "Do not add explanations, summaries, or content not present in the source.",
  "Preserve paragraph intent and natural literary tone in Korean.",
  "Return strict JSON with this shape:",
  '{"translation":"string","used_terms":[],"uncertain_terms":[],"qa_flags":[],"notes":"string"}'
].join("\n");

export class MockTranslationProvider implements TranslationProvider {
  readonly name = "mock";

  async validateConfig(): Promise<ValidationResult> {
    return { ok: true };
  }

  async translateSegment(input: TranslationRequest): Promise<TranslationResponse> {
    const responseJson = {
      translation: `[ko] ${input.sourceText}`,
      used_terms: [],
      uncertain_terms: [],
      qa_flags: [],
      notes: "mock translation"
    };

    return parseTranslationResponse(responseJson);
  }
}

export async function translateTextBlock(
  input: TranslateTextBlockInput
): Promise<TranslationSegment> {
  const prompt = input.prompt ?? literaryKoPrompt;
  const promptVersion = input.promptVersion ?? literaryKoPromptVersion;
  const createdAt = nowTimestamp();
  const sourceHash = sha256(input.block.sourceText);
  const promptHash = sha256(`${promptVersion}\n${prompt}`);

  try {
    const response = await input.provider.translateSegment({
      sourceLang: "en",
      targetLang: "ko",
      sourceText: input.block.sourceText,
      systemPrompt: prompt,
      promptVersion
    });

    return {
      id: randomUUID() as TranslationSegment["id"],
      jobId: input.jobId,
      blockId: input.block.id as BlockId,
      sourceText: input.block.sourceText,
      aiTranslation: response.translation,
      finalTranslation: response.translation,
      status: "translated",
      responseJson: JSON.stringify({
        provider: input.provider.name,
        response: response.responseJson,
        usage: response.usage
      }),
      sourceHash,
      promptHash,
      createdAt,
      updatedAt: createdAt
    };
  } catch (caught) {
    const providerError = readProviderError(caught);
    return {
      id: randomUUID() as TranslationSegment["id"],
      jobId: input.jobId,
      blockId: input.block.id as BlockId,
      sourceText: input.block.sourceText,
      status: "error",
      errorMessage: caught instanceof Error ? caught.message : "Translation failed.",
      responseJson: JSON.stringify({
        provider: input.provider.name,
        providerError
      }),
      sourceHash,
      promptHash,
      createdAt,
      updatedAt: createdAt
    };
  }
}

export function parseTranslationResponse(raw: unknown): TranslationResponse {
  const parsed = typeof raw === "string" ? parseJson(raw) : raw;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Provider response must be a JSON object.");
  }

  const record = parsed as Record<string, unknown>;
  const translation = record.translation;
  if (typeof translation !== "string" || !translation.trim()) {
    throw new Error("Provider response JSON is missing translation.");
  }

  return {
    translation,
    usedTerms: readStringArray(record.used_terms),
    uncertainTerms: readStringArray(record.uncertain_terms),
    qaFlags: readStringArray(record.qa_flags),
    notes: typeof record.notes === "string" ? record.notes : undefined,
    responseJson: parsed,
    usage: readUsage(record.usage)
  };
}

function readProviderError(caught: unknown): { code: string; retryable: boolean } | undefined {
  if (
    caught instanceof Error &&
    "code" in caught &&
    "retryable" in caught &&
    typeof (caught as ProviderError).code === "string" &&
    typeof (caught as ProviderError).retryable === "boolean"
  ) {
    return {
      code: (caught as ProviderError).code,
      retryable: (caught as ProviderError).retryable
    };
  }
  return undefined;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function createTranslationCacheKey(input: TranslationCacheKeyInput): string {
  return sha256(
    JSON.stringify({
      sourceTextHash: input.sourceHash,
      provider: input.provider,
      model: input.model,
      promptTemplateVersion: input.promptVersion,
      promptHash: input.promptHash,
      glossaryVersion: input.glossaryVersion ?? "none",
      stylebookVersion: input.stylebookVersion ?? "none",
      tmContextHash: input.tmContextHash ?? "none",
      translationOptionsHash: input.translationOptionsHash ?? "default"
    })
  );
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(stripJsonFence(raw));
  } catch (error) {
    throw new Error("Provider response was not valid JSON.", { cause: error });
  }
}

function stripJsonFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return {
    inputTokens: readNumber(record.inputTokens ?? record.promptTokenCount),
    outputTokens: readNumber(record.outputTokens ?? record.candidatesTokenCount),
    totalTokens: readNumber(record.totalTokens ?? record.totalTokenCount)
  };
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
