import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { extractTextBlocks, parseOpf, unpackEpub } from "./index";

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
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>`)
  );
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
