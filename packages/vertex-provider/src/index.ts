import type {
  TranslationProvider,
  TranslationRequest,
  TranslationResponse
} from "@sts/translator-core";

export class VertexTranslationProvider implements TranslationProvider {
  readonly name = "vertex-ai";

  async translateSegment(_input: TranslationRequest): Promise<TranslationResponse> {
    throw new Error("Vertex AI provider is planned for M2.");
  }
}
