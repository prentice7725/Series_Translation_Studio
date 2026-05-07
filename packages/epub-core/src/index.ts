import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, normalize, posix, relative, resolve } from "node:path";
import AdmZip from "adm-zip";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
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
  navItem?: EpubManifestItem;
  tocItem?: EpubManifestItem;
}

export interface ExtractTextBlocksInput {
  documentId: string;
  spineItems: EpubSpineItem[];
  extractedDir: string;
  opfPath: string;
  minTextLength?: number;
}

export interface ExtractedChapter {
  id: ChapterId;
  title?: string;
  spineHref: string;
  chapterIndex: number;
  blocks: TextBlock[];
}

export interface EpubTextReplacement {
  spineHref: string;
  xpath: string;
  text: string;
}

export interface RebuildEpubInput {
  extractedDir: string;
  outputPath: string;
  replacements: EpubTextReplacement[];
  workingDir?: string;
  metadata?: {
    title?: string;
  };
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text"
});

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  format: true
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
  const tocId = packageNode?.spine?.["@_toc"] ? String(packageNode.spine["@_toc"]) : undefined;
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
    spineItems,
    navItem: manifest.find((item) => item.properties?.split(/\s+/).includes("nav")),
    tocItem: tocId ? manifestById.get(tocId) : manifest.find((item) => item.mediaType === "application/x-dtbncx+xml")
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
      const blocks = collectBlocks(root, input.minTextLength)
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
        .filter((block) => shouldKeepBlock(block.sourceText, input.minTextLength));

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

export async function rebuildEpub(input: RebuildEpubInput): Promise<{ outputPath: string }> {
  const sourceDir = resolve(input.extractedDir);
  const rebuildDir = resolve(input.workingDir ?? `${input.outputPath}.work`);
  const outputPath = resolve(input.outputPath);

  if (rebuildDir === sourceDir || sourceDir.startsWith(`${rebuildDir}\\`)) {
    throw new Error("Invalid rebuild working directory.");
  }

  rmSync(rebuildDir, { recursive: true, force: true });
  mkdirSync(dirname(rebuildDir), { recursive: true });
  cpSync(sourceDir, rebuildDir, { recursive: true });

  const replacementsBySpine = groupReplacements(input.replacements);
  for (const [spineHref, replacements] of replacementsBySpine) {
    const htmlPath = resolve(rebuildDir, spineHref);
    if (!htmlPath.startsWith(rebuildDir)) {
      throw new Error(`Invalid spine href outside rebuild dir: ${spineHref}`);
    }

    const root = parse(readFileSync(htmlPath, "utf8"), {
      blockTextElements: {
        script: true,
        noscript: true,
        style: true,
        pre: false
      }
    });

    for (const replacement of replacements) {
      const element = findBySimpleXpath(root, replacement.xpath);
      if (!element) {
        throw new Error(`Replacement target was not found: ${spineHref} ${replacement.xpath}`);
      }

      element.set_content(escapeHtml(replacement.text));
    }

    writeFileSync(htmlPath, root.toString());
  }

  if (input.metadata?.title) {
    updateOpfMetadata({
      extractedDir: rebuildDir,
      title: input.metadata.title
    });
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeEpubZip({ sourceDir: rebuildDir, outputPath });
  rmSync(rebuildDir, { recursive: true, force: true });

  return { outputPath };
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

function updateOpfMetadata(input: { extractedDir: string; title: string }): void {
  const rootfilePath = findRootfilePath(input.extractedDir);
  const absoluteOpfPath = join(input.extractedDir, rootfilePath);
  const opf = xmlParser.parse(readFileSync(absoluteOpfPath, "utf8"));
  opf.package ??= {};
  opf.package.metadata ??= {};
  opf.package.metadata["dc:title"] = input.title;
  writeFileSync(absoluteOpfPath, xmlBuilder.build(opf));
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

function collectBlocks(root: HTMLElement, minTextLength?: number): HTMLElement[] {
  return root
    .querySelectorAll(Array.from(blockTags).join(","))
    .filter((element) =>
      shouldKeepBlock(normalizeText(element.structuredText || element.textContent), minTextLength)
    );
}

function firstHeading(root: HTMLElement): string | undefined {
  const heading = root.querySelector("h1,h2,h3,h4,h5,h6");
  const text = heading ? normalizeText(heading.structuredText || heading.textContent) : undefined;
  return text || undefined;
}

function shouldKeepBlock(text: string, minTextLength = 2): boolean {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  return normalized.length >= minTextLength;
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

function findBySimpleXpath(root: HTMLElement, xpath: string): HTMLElement | undefined {
  const parts = xpath
    .replace(/^\//, "")
    .split("/")
    .filter(Boolean)
    .map((part) => {
      const match = /^([a-z0-9:-]+)\[(\d+)\]$/i.exec(part);
      if (!match) {
        throw new Error(`Unsupported xpath format: ${xpath}`);
      }

      return {
        tag: match[1].toLowerCase(),
        index: Number(match[2])
      };
    });

  let current: HTMLElement | undefined =
    root.tagName && parts[0]?.tag === root.tagName.toLowerCase() ? root : undefined;
  let remaining = current ? parts.slice(1) : parts;

  if (!current) {
    current = firstChildElement(root, remaining[0]?.tag, remaining[0]?.index);
    remaining = remaining.slice(1);
  }

  for (const part of remaining) {
    current = current ? firstChildElement(current, part.tag, part.index) : undefined;
  }

  return current;
}

function firstChildElement(
  parent: HTMLElement,
  tag: string | undefined,
  oneBasedIndex: number | undefined
): HTMLElement | undefined {
  if (!tag || !oneBasedIndex) {
    return undefined;
  }

  return parent.childNodes.filter(
    (node): node is HTMLElement =>
      node instanceof HTMLElement && node.tagName.toLowerCase() === tag
  )[oneBasedIndex - 1];
}

function groupReplacements(replacements: EpubTextReplacement[]): Map<string, EpubTextReplacement[]> {
  const grouped = new Map<string, EpubTextReplacement[]>();

  for (const replacement of replacements) {
    const spineHref = normalizeEpubPath(replacement.spineHref);
    grouped.set(spineHref, [...(grouped.get(spineHref) ?? []), replacement]);
  }

  return grouped;
}

function writeEpubZip(input: { sourceDir: string; outputPath: string }): void {
  const entries = [
    "mimetype",
    ...listFiles(input.sourceDir)
      .map((entryPath) => normalizeEpubPath(relative(input.sourceDir, entryPath)))
      .filter((epubPath) => epubPath !== "mimetype")
  ].map((epubPath) => ({
    name: epubPath,
    data: readFileSync(join(input.sourceDir, epubPath))
  }));

  writeStoreZip(input.outputPath, entries);
}

function listFiles(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((entry) => {
      const entryPath = join(dir, entry);
      return statSync(entryPath).isDirectory() ? listFiles(entryPath) : [entryPath];
    })
    .sort((a, b) => normalizeEpubPath(a).localeCompare(normalizeEpubPath(b)));
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function writeStoreZip(outputPath: string, entries: Array<{ name: string; data: Buffer }>): void {
  const fileParts: Buffer[] = [];
  const centralDirectoryParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(entry.data.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    fileParts.push(localHeader, name, entry.data);

    const centralDirectory = Buffer.alloc(46);
    centralDirectory.writeUInt32LE(0x02014b50, 0);
    centralDirectory.writeUInt16LE(20, 4);
    centralDirectory.writeUInt16LE(20, 6);
    centralDirectory.writeUInt16LE(0x0800, 8);
    centralDirectory.writeUInt16LE(0, 10);
    centralDirectory.writeUInt16LE(0, 12);
    centralDirectory.writeUInt16LE(0, 14);
    centralDirectory.writeUInt32LE(crc, 16);
    centralDirectory.writeUInt32LE(entry.data.length, 20);
    centralDirectory.writeUInt32LE(entry.data.length, 24);
    centralDirectory.writeUInt16LE(name.length, 28);
    centralDirectory.writeUInt16LE(0, 30);
    centralDirectory.writeUInt16LE(0, 32);
    centralDirectory.writeUInt16LE(0, 34);
    centralDirectory.writeUInt16LE(0, 36);
    centralDirectory.writeUInt32LE(0, 38);
    centralDirectory.writeUInt32LE(offset, 42);
    centralDirectoryParts.push(centralDirectory, name);

    offset += localHeader.length + name.length + entry.data.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectory = Buffer.concat(centralDirectoryParts);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  writeFileSync(outputPath, Buffer.concat([...fileParts, centralDirectory, endOfCentralDirectory]));
}

const crcTable = Array.from({ length: 256 }, (_value, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
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
