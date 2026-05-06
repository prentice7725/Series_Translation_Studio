import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, posix, relative, resolve } from "node:path";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import { HTMLElement, parse } from "node-html-parser";
import type { BlockId, ChapterId, TextBlock } from "@sts/common";
import { nowTimestamp } from "@sts/common";

export interface UnpackedEpub {
  extractedDir: string;
  rootfilePath: string;
}

export interface EpubManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}

export interface EpubSpineItem {
  id: string;
  href: string;
  mediaType: string;
  index: number;
  isLinear: boolean;
}

export interface ParsedOpf {
  opfPath: string;
  packageDir: string;
  title?: string;
  manifest: EpubManifestItem[];
  spineItems: EpubSpineItem[];
}

export interface ExtractTextBlocksInput {
  documentId: string;
  spineItems: EpubSpineItem[];
  extractedDir: string;
  opfPath: string;
}

export interface ExtractedChapter {
  id: ChapterId;
  title?: string;
  spineHref: string;
  chapterIndex: number;
  blocks: TextBlock[];
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text"
});

const blockTags = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "li"
]);

export async function unpackEpub(input: {
  epubPath: string;
  outputDir: string;
}): Promise<UnpackedEpub> {
  mkdirSync(input.outputDir, { recursive: true });

  const zip = new AdmZip(input.epubPath);
  const mimetype = zip.getEntry("mimetype")?.getData().toString("utf8").trim();
  if (mimetype !== "application/epub+zip") {
    throw new Error("Invalid EPUB: mimetype entry is missing or incorrect.");
  }

  zip.extractAllTo(input.outputDir, true);
  const rootfilePath = findRootfilePath(input.outputDir);

  return {
    extractedDir: input.outputDir,
    rootfilePath
  };
}

export function findRootfilePath(extractedDir: string): string {
  const containerPath = join(extractedDir, "META-INF", "container.xml");
  const container = xmlParser.parse(readFileSync(containerPath, "utf8"));
  const rootfiles = container.container?.rootfiles?.rootfile;
  const rootfile = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles;
  const fullPath = rootfile?.["@_full-path"];

  if (!fullPath || typeof fullPath !== "string") {
    throw new Error("Invalid EPUB: container.xml does not include a rootfile.");
  }

  return fullPath;
}

export function parseOpf(input: { extractedDir: string; opfPath: string }): ParsedOpf {
  const absoluteOpfPath = join(input.extractedDir, input.opfPath);
  const opf = xmlParser.parse(readFileSync(absoluteOpfPath, "utf8"));
  const packageNode = opf.package;
  const metadata = packageNode?.metadata ?? {};
  const manifestNode = packageNode?.manifest?.item;
  const spineNode = packageNode?.spine?.itemref;

  const manifest = toArray(manifestNode).map((item) => ({
    id: String(item["@_id"]),
    href: String(item["@_href"]),
    mediaType: String(item["@_media-type"]),
    properties: item["@_properties"] ? String(item["@_properties"]) : undefined
  }));

  const manifestById = new Map(manifest.map((item) => [item.id, item]));
  const packageDir = dirname(input.opfPath).replaceAll("\\", "/");
  const spineItems = toArray(spineNode).flatMap((item, index): EpubSpineItem[] => {
    const id = String(item["@_idref"]);
    const manifestItem = manifestById.get(id);
    if (!manifestItem) {
      return [];
    }

    return [
      {
        id,
        href: normalizeEpubPath(posix.join(packageDir, manifestItem.href)),
        mediaType: manifestItem.mediaType,
        index,
        isLinear: item["@_linear"] !== "no"
      }
    ];
  });

  return {
    opfPath: input.opfPath,
    packageDir,
    title: readTitle(metadata),
    manifest,
    spineItems
  };
}

export async function extractTextBlocks(input: ExtractTextBlocksInput): Promise<ExtractedChapter[]> {
  const extractedDir = resolve(input.extractedDir);

  return input.spineItems
    .filter(
      (item) =>
        item.isLinear &&
        (item.mediaType === "application/xhtml+xml" ||
          item.mediaType === "text/html" ||
          /\.x?html?$/i.test(item.href))
    )
    .map((item) => {
      const htmlPath = resolve(extractedDir, item.href);
      if (!htmlPath.startsWith(extractedDir)) {
        throw new Error(`Invalid spine href outside extracted dir: ${item.href}`);
      }

      const root = parse(readFileSync(htmlPath, "utf8"), {
        blockTextElements: {
          script: true,
          noscript: true,
          style: true,
          pre: false
        }
      });
      const chapterId = makeId("chapter", input.documentId, item.index) as ChapterId;
      const title = firstHeading(root);
      const blocks = collectBlocks(root)
        .map((element, blockIndex): TextBlock => {
          const sourceText = normalizeText(element.structuredText || element.textContent);
          return {
            id: makeId("block", input.documentId, item.index, blockIndex) as BlockId,
            chapterId,
            documentId: input.documentId,
            blockIndex,
            xpath: buildSimpleXpath(element),
            htmlTag: element.tagName.toLowerCase(),
            sourceText,
            normalizedText: normalizeText(sourceText),
            textHash: sha256(sourceText),
            createdAt: nowTimestamp()
          };
        })
        .filter((block) => shouldKeepBlock(block.sourceText));

      return {
        id: chapterId,
        title,
        spineHref: item.href,
        chapterIndex: item.index,
        blocks
      };
    });
}

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function copyEpubToWorkspace(input: {
  epubPath: string;
  workspaceSourceDir: string;
  bookId: string;
}): { copiedPath: string; fileHash: string } {
  mkdirSync(input.workspaceSourceDir, { recursive: true });
  const data = readFileSync(input.epubPath);
  const fileHash = sha256(data);
  const copiedPath = join(input.workspaceSourceDir, `${input.bookId}.epub`);
  writeFileSync(copiedPath, data);
  return { copiedPath, fileHash };
}

function readTitle(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }

  const record = metadata as Record<string, unknown>;
  const title = record["dc:title"] ?? record.title;
  if (Array.isArray(title)) {
    return stringifyXmlValue(title[0]);
  }

  return stringifyXmlValue(title);
}

function stringifyXmlValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "#text" in value) {
    return String((value as Record<string, unknown>)["#text"]);
  }
  return undefined;
}

function collectBlocks(root: HTMLElement): HTMLElement[] {
  return root
    .querySelectorAll(Array.from(blockTags).join(","))
    .filter((element) => shouldKeepBlock(normalizeText(element.structuredText || element.textContent)));
}

function firstHeading(root: HTMLElement): string | undefined {
  const heading = root.querySelector("h1,h2,h3,h4,h5,h6");
  const text = heading ? normalizeText(heading.structuredText || heading.textContent) : undefined;
  return text || undefined;
}

function shouldKeepBlock(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  return normalized.length >= 2;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildSimpleXpath(element: HTMLElement): string {
  const parts: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current.tagName) {
    const tag = current.tagName.toLowerCase();
    const siblings = current.parentNode?.childNodes.filter(
      (node) => node instanceof HTMLElement && node.tagName.toLowerCase() === tag
    );
    const index = siblings ? siblings.indexOf(current) + 1 : 1;
    parts.unshift(`${tag}[${index}]`);
    current = current.parentNode instanceof HTMLElement ? current.parentNode : null;
  }

  return `/${parts.join("/")}`;
}

function makeId(...parts: Array<string | number>): string {
  return parts.map((part) => String(part).replace(/[^a-zA-Z0-9_-]/g, "_")).join("_");
}

function normalizeEpubPath(path: string): string {
  return normalize(path).replaceAll("\\", "/");
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

export function relativeEpubPath(input: { extractedDir: string; absolutePath: string }): string {
  return normalize(relative(input.extractedDir, input.absolutePath)).replaceAll("\\", "/");
}
