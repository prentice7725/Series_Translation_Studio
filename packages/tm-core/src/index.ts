import { createHash } from "node:crypto";
import type { TmGrade, TmMatch, TmUnit } from "@sts/common";

export const tmGradeWeights: Record<TmGrade, number> = {
  gold: 1,
  gold_candidate: 0.75,
  silver: 0.4,
  reference: 0.25,
  rejected: 0
};

export function tmSourceHash(sourceText: string): string {
  return createHash("sha256").update(normalizeTmText(sourceText)).digest("hex");
}

export function findTmMatches(input: {
  sourceText: string;
  units: TmUnit[];
  limit?: number;
  minScore?: number;
}): TmMatch[] {
  const source = normalizeTmText(input.sourceText);
  const sourceHash = tmSourceHash(input.sourceText);
  const minScore = input.minScore ?? 0.35;
  const limit = input.limit ?? 5;

  return input.units
    .filter((unit) => unit.grade !== "rejected")
    .map((unit): TmMatch => {
      const exact = unit.sourceHash === sourceHash;
      const score = exact ? 1 : diceCoefficient(source, normalizeTmText(unit.sourceText));
      return {
        unit,
        score,
        weightedScore: score * tmGradeWeights[unit.grade],
        matchType: exact ? "exact" : "fuzzy"
      };
    })
    .filter((match) => match.matchType === "exact" || match.score >= minScore)
    .sort((a, b) => b.weightedScore - a.weightedScore || b.score - a.score)
    .slice(0, limit);
}

export function buildTmPromptSection(matches: TmMatch[]): string {
  if (matches.length === 0) {
    return "TRANSLATION_MEMORY:\n- No TM matches.";
  }

  return [
    "TRANSLATION_MEMORY:",
    ...matches.map((match) =>
      [
        `- source: ${match.unit.sourceText}`,
        `  target: ${match.unit.targetText}`,
        `  grade=${match.unit.grade}`,
        `match=${match.matchType}`,
        `score=${match.score.toFixed(2)}`,
        `weight=${match.weightedScore.toFixed(2)}`,
        match.unit.notes ? `notes=${match.unit.notes}` : undefined
      ]
        .filter(Boolean)
        .join("\n")
    )
  ].join("\n");
}

export function tmVersionHash(units: TmUnit[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        units
          .filter((unit) => unit.grade !== "rejected")
          .map((unit) => ({
            sourceHash: unit.sourceHash,
            targetText: unit.targetText,
            grade: unit.grade,
            origin: unit.origin,
            confidence: unit.confidence
          }))
          .sort((a, b) => a.sourceHash.localeCompare(b.sourceHash))
      )
    )
    .digest("hex");
}

export function normalizeTmText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function diceCoefficient(left: string, right: string): number {
  if (left === right) {
    return 1;
  }
  if (left.length < 2 || right.length < 2) {
    return 0;
  }

  const leftBigrams = bigramCounts(left);
  const rightBigrams = bigramCounts(right);
  let overlap = 0;

  for (const [bigram, count] of leftBigrams) {
    overlap += Math.min(count, rightBigrams.get(bigram) ?? 0);
  }

  return (2 * overlap) / (left.length - 1 + right.length - 1);
}

function bigramCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = 0; index < text.length - 1; index += 1) {
    const bigram = text.slice(index, index + 2);
    counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
  }
  return counts;
}
