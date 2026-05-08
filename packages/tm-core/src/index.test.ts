import { describe, expect, it } from "vitest";
import type { TmUnit } from "@sts/common";
import { buildTmPromptSection, findTmMatches, tmSourceHash } from "./index";

const baseUnit: Omit<TmUnit, "id" | "sourceText" | "targetText" | "sourceHash" | "grade"> = {
  projectId: "project-1" as TmUnit["projectId"],
  origin: "manual",
  createdAt: "2026-01-01T00:00:00.000Z" as TmUnit["createdAt"],
  updatedAt: "2026-01-01T00:00:00.000Z" as TmUnit["updatedAt"]
};

describe("tm-core", () => {
  it("returns exact matches above fuzzy matches", () => {
    const units: TmUnit[] = [
      {
        ...baseUnit,
        id: "silver",
        sourceText: "He opened the door slowly.",
        targetText: "그는 천천히 문을 열었다.",
        sourceHash: tmSourceHash("He opened the door slowly."),
        grade: "silver"
      },
      {
        ...baseUnit,
        id: "gold",
        sourceText: "He opened the door.",
        targetText: "그는 문을 열었다.",
        sourceHash: tmSourceHash("He opened the door."),
        grade: "gold"
      }
    ];

    const matches = findTmMatches({ sourceText: "He opened the door.", units });
    expect(matches[0]?.unit.id).toBe("gold");
    expect(matches[0]?.matchType).toBe("exact");
  });

  it("excludes rejected units from prompt context", () => {
    const units: TmUnit[] = [
      {
        ...baseUnit,
        id: "rejected",
        sourceText: "Miles smiled.",
        targetText: "마일스가 웃었다.",
        sourceHash: tmSourceHash("Miles smiled."),
        grade: "rejected"
      }
    ];

    expect(findTmMatches({ sourceText: "Miles smiled.", units })).toHaveLength(0);
    expect(buildTmPromptSection([])).toContain("No TM matches");
  });
});
