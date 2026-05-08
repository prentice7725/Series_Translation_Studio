import { describe, expect, it } from "vitest";
import type { GlossaryTerm, ProjectId } from "@sts/common";
import {
  buildGlossaryPromptSection,
  findGlossaryHits,
  parseGlossaryCsv,
  validateGlossaryTranslation
} from "./index";

describe("glossary core", () => {
  it("imports CSV and finds hits", () => {
    const parsed = parseGlossaryCsv(
      "source_term,canonical_ko,category,aliases,forbidden_targets,confidence\nBarrayar,바라야,planet,,바라야르,gold"
    );
    const term = makeTerm(parsed.terms[0]!);
    const hits = findGlossaryHits("He returned to Barrayar.", [term]);

    expect(hits).toHaveLength(1);
    expect(buildGlossaryPromptSection(hits)).toContain("Barrayar => 바라야");
  });

  it("detects missing canonical and forbidden target", () => {
    const hit = findGlossaryHits("Barrayar", [
      makeTerm({
        sourceTerm: "Barrayar",
        canonicalKo: "바라야",
        category: "planet",
        confidence: "gold",
        doNotTranslate: false,
        needsReview: false,
        forbiddenTargets: "바라야르"
      })
    ])[0]!;

    expect(validateGlossaryTranslation({ hits: [hit], translation: "그 행성으로 갔다." })).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "glossary_mismatch" })])
    );
    expect(validateGlossaryTranslation({ hits: [hit], translation: "바라야르로 갔다." })).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "forbidden_term" })])
    );
  });
});

function makeTerm(input: Partial<GlossaryTerm> & Pick<GlossaryTerm, "sourceTerm" | "canonicalKo">): GlossaryTerm {
  const now = new Date().toISOString() as GlossaryTerm["createdAt"];
  return {
    id: "term_1",
    projectId: "project_1" as ProjectId,
    sourceTerm: input.sourceTerm,
    canonicalKo: input.canonicalKo,
    category: input.category ?? "term",
    aliases: input.aliases,
    forbiddenTargets: input.forbiddenTargets,
    contextRules: input.contextRules,
    notes: input.notes,
    confidence: input.confidence ?? "candidate",
    doNotTranslate: input.doNotTranslate ?? false,
    needsReview: input.needsReview ?? false,
    createdAt: now,
    updatedAt: now
  };
}
