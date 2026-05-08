import { createHash } from "node:crypto";
import type { GlossaryHit, GlossaryIssue, GlossaryTerm } from "@sts/common";

export interface ParsedGlossaryCsv {
  terms: Array<{
    sourceTerm: string;
    canonicalKo: string;
    category: string;
    aliases?: string;
    forbiddenTargets?: string;
    contextRules?: string;
    notes?: string;
    confidence: GlossaryTerm["confidence"];
    doNotTranslate: boolean;
    needsReview: boolean;
  }>;
  skippedCount: number;
}

export function findGlossaryHits(text: string, terms: GlossaryTerm[]): GlossaryHit[] {
  const normalized = text.toLowerCase();
  return terms
    .filter((term) => !term.needsReview)
    .flatMap((term): GlossaryHit[] => {
      const candidates = [term.sourceTerm, ...splitList(term.aliases)].filter(Boolean);
      const matched = candidates.some((candidate) => normalized.includes(candidate.toLowerCase()));
      if (!matched) {
        return [];
      }

      return [
        {
          termId: term.id,
          sourceTerm: term.sourceTerm,
          canonicalKo: term.canonicalKo,
          category: term.category,
          confidence: term.confidence,
          notes: term.notes,
          doNotTranslate: term.doNotTranslate,
          forbiddenTargets: splitList(term.forbiddenTargets)
        }
      ];
    });
}

export function buildGlossaryPromptSection(hits: GlossaryHit[]): string {
  if (hits.length === 0) {
    return "GLOSSARY:\n- No glossary hits.";
  }

  return [
    "GLOSSARY:",
    ...hits.map((hit) =>
      [
        `- ${hit.sourceTerm} => ${hit.canonicalKo}`,
        `category=${hit.category}`,
        `confidence=${hit.confidence}`,
        hit.doNotTranslate ? "do_not_translate=true" : undefined,
        hit.forbiddenTargets.length > 0
          ? `forbidden=${hit.forbiddenTargets.join("|")}`
          : undefined,
        hit.notes ? `notes=${hit.notes}` : undefined
      ]
        .filter(Boolean)
        .join("; ")
    )
  ].join("\n");
}

export function validateGlossaryTranslation(input: {
  hits: GlossaryHit[];
  translation: string;
}): GlossaryIssue[] {
  return input.hits.flatMap((hit): GlossaryIssue[] => {
    const issues: GlossaryIssue[] = [];
    if (!hit.doNotTranslate && !input.translation.includes(hit.canonicalKo)) {
      issues.push({
        type: "glossary_mismatch",
        severity: hit.confidence === "gold" ? "error" : "warning",
        sourceTerm: hit.sourceTerm,
        message: `'${hit.sourceTerm}'는 glossary에서 '${hit.canonicalKo}'로 등록되어 있습니다.`,
        suggestion: hit.canonicalKo
      });
    }

    for (const forbidden of hit.forbiddenTargets) {
      if (forbidden && input.translation.includes(forbidden)) {
        issues.push({
          type: "forbidden_term",
          severity: "error",
          sourceTerm: hit.sourceTerm,
          message: `'${hit.sourceTerm}'에 금지 번역어 '${forbidden}'가 사용되었습니다.`,
          suggestion: hit.canonicalKo
        });
      }
    }

    return issues;
  });
}

export function parseGlossaryCsv(csv: string): ParsedGlossaryCsv {
  const rows = parseCsvRows(csv).filter((row) => row.some((cell) => cell.trim()));
  const header = rows.shift()?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const index = (name: string) => header.indexOf(name);
  const sourceIndex = index("source_term");
  const targetIndex = index("canonical_ko");
  let skippedCount = 0;

  if (sourceIndex < 0 || targetIndex < 0) {
    throw new Error("Glossary CSV must include source_term and canonical_ko columns.");
  }

  const terms = rows.flatMap((row) => {
    const sourceTerm = row[sourceIndex]?.trim();
    const canonicalKo = row[targetIndex]?.trim();
    if (!sourceTerm || !canonicalKo) {
      skippedCount += 1;
      return [];
    }

    return [
      {
        sourceTerm,
        canonicalKo,
        category: readCell(row, header, "category") || "term",
        aliases: readCell(row, header, "aliases"),
        forbiddenTargets: readCell(row, header, "forbidden_targets"),
        contextRules: readCell(row, header, "context_rules"),
        notes: readCell(row, header, "notes"),
        confidence: readConfidence(readCell(row, header, "confidence")),
        doNotTranslate: readBoolean(readCell(row, header, "do_not_translate")),
        needsReview: readBoolean(readCell(row, header, "needs_review"))
      }
    ];
  });

  return { terms, skippedCount };
}

export function exportGlossaryCsv(terms: GlossaryTerm[]): string {
  const header = [
    "source_term",
    "canonical_ko",
    "category",
    "aliases",
    "forbidden_targets",
    "context_rules",
    "notes",
    "confidence",
    "do_not_translate",
    "needs_review"
  ];
  const rows = terms.map((term) =>
    [
      term.sourceTerm,
      term.canonicalKo,
      term.category,
      term.aliases ?? "",
      term.forbiddenTargets ?? "",
      term.contextRules ?? "",
      term.notes ?? "",
      term.confidence,
      String(term.doNotTranslate),
      String(term.needsReview)
    ].map(escapeCsvCell)
  );

  return [header, ...rows].map((row) => row.join(",")).join("\n");
}

export function glossaryVersionHash(terms: GlossaryTerm[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        terms
          .map((term) => ({
            sourceTerm: term.sourceTerm,
            canonicalKo: term.canonicalKo,
            aliases: term.aliases,
            forbiddenTargets: term.forbiddenTargets,
            confidence: term.confidence,
            doNotTranslate: term.doNotTranslate,
            needsReview: term.needsReview
          }))
          .sort((a, b) => a.sourceTerm.localeCompare(b.sourceTerm))
      )
    )
    .digest("hex");
}

function splitList(value: string | undefined): string[] {
  return value
    ? value
        .split(/[|;,]/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function readCell(row: string[], header: string[], name: string): string | undefined {
  const cell = row[header.indexOf(name)]?.trim();
  return cell || undefined;
}

function readConfidence(value: string | undefined): GlossaryTerm["confidence"] {
  return value === "gold" || value === "silver" || value === "candidate" ? value : "candidate";
}

function readBoolean(value: string | undefined): boolean {
  return /^(1|true|yes|y)$/i.test(value ?? "");
}

function escapeCsvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}
