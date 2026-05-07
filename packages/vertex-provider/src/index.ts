import { VertexAI } from "@google-cloud/vertexai";
import {
  parseTranslationResponse,
  type ProviderConfig,
  type ProviderError,
  type TranslationProvider,
  type TranslationRequest,
  type TranslationResponse,
  type ValidationResult
} from "@sts/translator-core";

export interface VertexTranslationProviderConfig extends ProviderConfig {
  projectId: string;
  location: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
}

interface GenerateContentResponse {
  response?: {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
        }>;
      };
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };
}

export class VertexTranslationProvider implements TranslationProvider {
  readonly name = "vertex-ai";
  private readonly config: VertexTranslationProviderConfig;

  constructor(config: Partial<VertexTranslationProviderConfig> = {}) {
    this.config = {
      projectId: config.projectId ?? process.env.VERTEX_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? "",
      location: config.location ?? process.env.VERTEX_LOCATION ?? "us-central1",
      model: config.model ?? process.env.VERTEX_MODEL ?? "gemini-2.5-flash",
      timeoutMs: config.timeoutMs ?? Number(process.env.VERTEX_TIMEOUT_MS ?? 60000),
      maxRetries: config.maxRetries ?? 1
    };
  }

  async validateConfig(config: ProviderConfig = this.config): Promise<ValidationResult> {
    if (!config.projectId) {
      return { ok: false, message: "VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT is required." };
    }
    if (!config.location) {
      return { ok: false, message: "VERTEX_LOCATION is required." };
    }
    if (!config.model) {
      return { ok: false, message: "VERTEX_MODEL is required." };
    }

    return { ok: true };
  }

  async translateSegment(input: TranslationRequest): Promise<TranslationResponse> {
    const validation = await this.validateConfig();
    if (!validation.ok) {
      throw makeProviderError("CONFIG_INVALID", validation.message ?? "Invalid Vertex config.", false);
    }

    return retry(this.config.maxRetries, async () => {
      try {
        const result = await withTimeout(
          this.generateContent(input),
          this.config.timeoutMs,
          "Vertex AI request timed out."
        );
        return result;
      } catch (caught) {
        throw classifyVertexError(caught);
      }
    });
  }

  private async generateContent(input: TranslationRequest): Promise<TranslationResponse> {
    const vertex = new VertexAI({
      project: this.config.projectId,
      location: this.config.location
    });
    const model = vertex.getGenerativeModel({
      model: this.config.model,
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json"
      }
    });
    const result = (await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `${input.systemPrompt}\n\nCURRENT_TEXT:\n${input.sourceText}`
            }
          ]
        }
      ]
    })) as GenerateContentResponse;
    const text = result.response?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
    if (!text) {
      throw makeProviderError("EMPTY_RESPONSE", "Vertex AI returned no text.", true);
    }

    const parsed = parseTranslationResponse(text);
    return {
      ...parsed,
      usage: {
        inputTokens: result.response?.usageMetadata?.promptTokenCount,
        outputTokens: result.response?.usageMetadata?.candidatesTokenCount,
        totalTokens: result.response?.usageMetadata?.totalTokenCount
      }
    };
  }
}

async function retry<T>(maxRetries: number, callback: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await callback();
    } catch (caught) {
      lastError = caught;
      const error = classifyVertexError(caught);
      if (!error.retryable || attempt === maxRetries) {
        throw error;
      }
    }
  }

  throw classifyVertexError(lastError);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(
      () => rejectPromise(makeProviderError("TIMEOUT", message, true)),
      timeoutMs
    );

    promise
      .then(resolvePromise, rejectPromise)
      .finally(() => clearTimeout(timeout));
  });
}

function classifyVertexError(caught: unknown): ProviderError {
  if (isProviderError(caught)) {
    return caught;
  }

  const message = caught instanceof Error ? caught.message : "Vertex AI request failed.";
  const status = readStatus(caught);
  const retryable =
    status === 408 ||
    status === 429 ||
    (typeof status === "number" && status >= 500) ||
    /timeout|temporarily|unavailable|quota/i.test(message);

  return makeProviderError(status ? `VERTEX_${status}` : "VERTEX_ERROR", message, retryable, caught);
}

function readStatus(caught: unknown): number | undefined {
  if (!caught || typeof caught !== "object") {
    return undefined;
  }

  const record = caught as Record<string, unknown>;
  const status = record.status ?? record.code;
  return typeof status === "number" ? status : undefined;
}

function makeProviderError(
  code: string,
  message: string,
  retryable: boolean,
  cause?: unknown
): ProviderError {
  const error = new Error(message, { cause }) as ProviderError;
  error.code = code;
  error.retryable = retryable;
  error.cause = cause;
  return error;
}

function isProviderError(caught: unknown): caught is ProviderError {
  return (
    caught instanceof Error &&
    "code" in caught &&
    "retryable" in caught &&
    typeof (caught as ProviderError).code === "string" &&
    typeof (caught as ProviderError).retryable === "boolean"
  );
}
