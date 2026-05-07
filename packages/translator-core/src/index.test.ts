import { describe, expect, it } from "vitest";
import type { BlockId, ChapterId, JobId, TextBlock } from "@sts/common";
import {
  MockTranslationProvider,
  parseTranslationResponse,
  translateTextBlock
} from "./index";

describe("translator core", () => {
  it("parses strict translation JSON", () => {
    expect(
      parseTranslationResponse({
        translation: "그는 문을 열었다.",
        used_terms: ["door"],
        uncertain_terms: [],
        qa_flags: [],
        notes: "ok"
      })
    ).toMatchObject({
      translation: "그는 문을 열었다.",
      usedTerms: ["door"],
      notes: "ok"
    });
  });

  it("translates a text block with the mock provider", async () => {
    const segment = await translateTextBlock({
      jobId: "job_1" as JobId,
      block: makeBlock("He opened the door."),
      provider: new MockTranslationProvider()
    });

    expect(segment.status).toBe("translated");
    expect(segment.aiTranslation).toBe("[ko] He opened the door.");
    expect(segment.finalTranslation).toBe(segment.aiTranslation);
  });
});

function makeBlock(sourceText: string): TextBlock {
  return {
    id: "block_1" as BlockId,
    chapterId: "chapter_1" as ChapterId,
    documentId: "doc_1",
    blockIndex: 0,
    xpath: "/html[1]/body[1]/p[1]",
    htmlTag: "p",
    sourceText,
    normalizedText: sourceText,
    textHash: "hash",
    createdAt: new Date().toISOString() as TextBlock["createdAt"]
  };
}
