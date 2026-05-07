import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { extractTextBlocks, parseOpf, rebuildEpub, unpackEpub } from "./index";

describe("epub core", () => {
  it("unpacks an EPUB, parses spine, and extracts text blocks", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sts-epub-"));
    const epubPath = join(tempDir, "sample.epub");
    const extractedDir = join(tempDir, "extracted");

    try {
      writeFileSync(epubPath, buildSampleEpub().toBuffer());

      const unpacked = await unpackEpub({ epubPath, outputDir: extractedDir });
      const opf = parseOpf({ extractedDir: unpacked.extractedDir, opfPath: unpacked.rootfilePath });
      const chapters = await extractTextBlocks({
        documentId: "doc_1",
        spineItems: opf.spineItems,
        extractedDir: unpacked.extractedDir,
        opfPath: unpacked.rootfilePath
      });

      expect(opf.title).toBe("Sample Book");
      expect(opf.spineItems).toHaveLength(1);
      expect(opf.navItem?.id).toBe("nav");
      expect(opf.tocItem?.id).toBe("toc");
      expect(chapters).toHaveLength(1);
      expect(chapters[0]?.blocks.map((block) => block.sourceText)).toEqual([
        "Chapter One",
        "Cordelia looked at him.",
        "A second paragraph."
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rebuilds an EPUB with text replacements", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sts-epub-"));
    const epubPath = join(tempDir, "sample.epub");
    const extractedDir = join(tempDir, "extracted");
    const rebuiltPath = join(tempDir, "rebuilt.epub");
    const verifyDir = join(tempDir, "verify");

    try {
      writeFileSync(epubPath, buildSampleEpub().toBuffer());

      const unpacked = await unpackEpub({ epubPath, outputDir: extractedDir });
      const opf = parseOpf({ extractedDir: unpacked.extractedDir, opfPath: unpacked.rootfilePath });
      const chapters = await extractTextBlocks({
        documentId: "doc_1",
        spineItems: opf.spineItems,
        extractedDir: unpacked.extractedDir,
        opfPath: unpacked.rootfilePath
      });
      const paragraph = chapters[0]?.blocks.find(
        (block) => block.sourceText === "Cordelia looked at him."
      );

      expect(paragraph).toBeDefined();

      await rebuildEpub({
        extractedDir,
        outputPath: rebuiltPath,
        metadata: {
          title: "Sample Book M1 Export"
        },
        replacements: [
          {
            spineHref: chapters[0]!.spineHref,
            xpath: paragraph!.xpath,
            text: "코델리아는 그를 바라보았다."
          }
        ]
      });

      expect(readFirstZipLocalHeader(rebuiltPath)).toEqual({
        fileName: "mimetype",
        compressionMethod: 0
      });

      const zip = new AdmZip(rebuiltPath);
      expect(zip.getEntry("OPS/chapter1.xhtml")?.getData().toString("utf8")).toContain(
        "코델리아는 그를 바라보았다."
      );

      const rebuilt = await unpackEpub({ epubPath: rebuiltPath, outputDir: verifyDir });
      const rebuiltOpf = parseOpf({
        extractedDir: rebuilt.extractedDir,
        opfPath: rebuilt.rootfilePath
      });
      expect(rebuiltOpf.title).toBe("Sample Book M1 Export");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function buildSampleEpub(): AdmZip {
  const zip = new AdmZip();
  zip.addFile("mimetype", Buffer.from("application/epub+zip"));
  zip.addFile(
    "META-INF/container.xml",
    Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`)
  );
  zip.addFile(
    "OPS/package.opf",
    Buffer.from(`<?xml version="1.0"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Sample Book</dc:title>
  </metadata>
  <manifest>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="toc">
    <itemref idref="chapter1"/>
  </spine>
</package>`)
  );
  zip.addFile(
    "OPS/nav.xhtml",
    Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml">Chapter One</a></li></ol></nav></body>
</html>`)
  );
  zip.addFile("OPS/toc.ncx", Buffer.from(`<?xml version="1.0"?><ncx></ncx>`));
  zip.addFile(
    "OPS/chapter1.xhtml",
    Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <h1>Chapter One</h1>
    <p>Cordelia looked at him.</p>
    <p>A second paragraph.</p>
  </body>
</html>`)
  );
  return zip;
}

function readFirstZipLocalHeader(zipPath: string): {
  fileName: string;
  compressionMethod: number;
} {
  const data = readFileSync(zipPath);
  const signature = data.readUInt32LE(0);
  if (signature !== 0x04034b50) {
    throw new Error("Invalid zip local file header.");
  }

  const compressionMethod = data.readUInt16LE(8);
  const fileNameLength = data.readUInt16LE(26);
  const extraFieldLength = data.readUInt16LE(28);
  const fileName = data
    .subarray(30, 30 + fileNameLength + extraFieldLength)
    .subarray(0, fileNameLength)
    .toString("utf8");

  return {
    fileName,
    compressionMethod
  };
}
