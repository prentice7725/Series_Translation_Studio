import { describe, expect, it } from "vitest";
import { parseEditorialResponse, shouldRegisterGoldCandidate } from "./index";

describe("editorial-core", () => {
  it("parses approve responses and gold candidate eligibility", () => {
    const response = parseEditorialResponse({
      editorial_translation: "그는 문을 열었다.",
      decision: "approve",
      tm_grade: "gold_candidate",
      confidence: 0.91,
      rationale: "ok",
      used_reference_parts: [],
      qa_flags: []
    });

    expect(response.decision).toBe("approve");
    expect(shouldRegisterGoldCandidate(response)).toBe(true);
  });

  it("downgrades low-confidence approve to needs_review", () => {
    const response = parseEditorialResponse({
      editorial_translation: "그는 문을 열었다.",
      decision: "approve",
      tm_grade: "gold_candidate",
      confidence: 0.5,
      rationale: "uncertain",
      used_reference_parts: [],
      qa_flags: []
    });

    expect(response.decision).toBe("needs_review");
    expect(shouldRegisterGoldCandidate(response)).toBe(false);
  });
});
