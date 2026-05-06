export interface TranslationRequest {
  sourceLang: "en";
  targetLang: "ko";
  sourceText: string;
}

export interface TranslationResponse {
  translation: string;
  responseJson?: unknown;
}

export interface TranslationProvider {
  name: string;
  translateSegment(input: TranslationRequest): Promise<TranslationResponse>;
}
