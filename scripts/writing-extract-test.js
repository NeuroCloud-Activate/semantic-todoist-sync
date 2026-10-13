'use strict';

// Task 2: context file extraction tests.
// Style: plain node + assert, prints `PASS <case>` lines, exits non-zero on failure.

const assert = require('assert');

function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// Minimal htmlToMarkdown stub: <h1-6>, <p>, <table> -> Markdown. Lives in the
// test file so extract.js stays decoupled from any specific converter.
function stubHtmlToMarkdown(html) {
  let md = html;
  md = md.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, _lvl, inner) => '# ' + stripTags(inner).trim() + '\n');
  md = md.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_, row) => {
    const cells = [];
    const re = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let m;
    while ((m = re.exec(row)) !== null) cells.push(stripTags(m[1]).trim().replace(/\|/g, '\\|'));
    return '| ' + cells.join(' | ') + ' |\n';
  });
  md = md.replace(/<\/?(table|tbody|thead|tr|th|td)[^>]*>/gi, '');
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, inner) => stripTags(inner).trim() + '\n');
  md = md.replace(/<[^>]+>/g, '');
  md = md.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return md;
}

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, '');
}

async function buildDocxBytes() {
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>');
  zip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>');
  const cell = (t) => '<w:tc><w:p><w:r><w:t>' + t + '</w:t></w:r></w:p></w:tc>';
  zip.file('word/document.xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Report</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Intro paragraph.</w:t></w:r></w:p>' +
    '<w:tbl><w:tr>' + cell('a') + cell('b') + '</w:tr><w:tr>' + cell('c') + cell('d') + '</w:tr></w:tbl>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Next</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>After paragraph.</w:t></w:r></w:p>' +
    '</w:body></w:document>');
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  return toArrayBuffer(buf);
}

async function buildDocxPreambleBytes() {
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>');
  zip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>');
  zip.file('word/document.xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:r><w:t>Preamble text.</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Report</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Body text.</w:t></w:r></w:p>' +
    '</w:body></w:document>');
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  return toArrayBuffer(buf);
}

async function buildXlsxBytes() {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a', 'b'], ['c', 'd']]), 'Q3');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['e', 'f'], ['g', 'h']]), 'Q4');
  return toArrayBuffer(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

async function buildBigXlsxBytes() {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  const rows = [];
  for (let i = 0; i < 2500; i++) rows.push(['r' + i, 'v' + i]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Big');
  return toArrayBuffer(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

function fakePdfDeps() {
  return {
    htmlToMarkdown: stubHtmlToMarkdown,
    loadPdfJs: async () => ({
      getDocument: () => ({
        promise: {
          numPages: 2,
          getPage: async (n) => (n === 1
            ? { getTextContent: async () => ({ items: [{ str: 'Hello' }, { str: 'world' }] }) }
            : { getTextContent: async () => ({ items: [] }) }),
        },
      }),
    }),
  };
}

async function main() {
  const { extractContextFile, CONTEXT_EXTENSIONS } = require('../src/context/extract.js');

  assert.deepStrictEqual(
    CONTEXT_EXTENSIONS, ['md', 'txt', 'docx', 'xlsx', 'csv', 'pdf', 'png', 'jpg', 'jpeg']);
  console.log('PASS extensions');

  // docx: split per heading, table survives, locator = heading text.
  {
    const segs = await extractContextFile('notes.docx', await buildDocxBytes(),
      { htmlToMarkdown: stubHtmlToMarkdown });
    assert.strictEqual(segs.length, 2, 'docx splits into 2 segments, got ' + JSON.stringify(segs));
    assert.strictEqual(segs[0].locator, 'Report');
    assert.strictEqual(segs[1].locator, 'Next');
    assert.ok(segs[0].text.includes('Intro paragraph.'), 'docx paragraph kept');
    assert.ok(segs[0].text.includes('| a | b |'), 'docx table kept, got: ' + segs[0].text);
    assert.ok(segs[1].text.includes('After paragraph.'));
  }
  console.log('PASS docx');

  // xlsx: one segment per sheet, locator `Sheet: <name>`, Markdown table.
  {
    const segs = await extractContextFile('data.xlsx', await buildXlsxBytes(),
      { htmlToMarkdown: stubHtmlToMarkdown });
    assert.strictEqual(segs.length, 2, 'xlsx two sheets -> two segments');
    assert.strictEqual(segs[0].locator, 'Sheet: Q3');
    assert.strictEqual(segs[1].locator, 'Sheet: Q4');
    assert.ok(segs[0].text.includes('| a | b |'), 'xlsx table, got: ' + segs[0].text);
  }
  console.log('PASS xlsx');

  // 2500-row sheet -> 2000 rows + truncation line.
  {
    const segs = await extractContextFile('big.xlsx', await buildBigXlsxBytes(),
      { htmlToMarkdown: stubHtmlToMarkdown });
    assert.strictEqual(segs.length, 1);
    assert.ok(segs[0].text.includes('(truncated: 500 more rows)'), 'truncation note');
    assert.ok(!segs[0].text.includes('| r2000 |'), 'rows past 2000 dropped');
    assert.ok(segs[0].text.includes('| r1999 |'), 'row 2000 kept');
  }
  console.log('PASS xlsx-truncation');

  // csv: one segment, locator `Sheet: 1`.
  {
    const csv = 'a,b\nc,d\n';
    const bytes = toArrayBuffer(Buffer.from(csv, 'utf8'));
    const segs = await extractContextFile('data.csv', bytes, { htmlToMarkdown: stubHtmlToMarkdown });
    assert.strictEqual(segs.length, 1);
    assert.strictEqual(segs[0].locator, 'Sheet: 1');
    assert.ok(segs[0].text.includes('| a | b |'), 'csv table, got: ' + segs[0].text);
  }
  console.log('PASS csv');

  // pdf: fake pdfjsLib, 2 pages with page 2 empty -> one segment, locator `p. 1`.
  {
    const segs = await extractContextFile('doc.pdf', new ArrayBuffer(8), fakePdfDeps());
    assert.strictEqual(segs.length, 1);
    assert.strictEqual(segs[0].locator, 'p. 1');
    assert.ok(segs[0].text.includes('Hello world'), 'pdf text joined, got: ' + segs[0].text);
  }
  console.log('PASS pdf');

  // png with describeImage -> one segment locator "image".
  {
    const segs = await extractContextFile('pic.png', new ArrayBuffer(4), {
      htmlToMarkdown: stubHtmlToMarkdown,
      describeImage: async () => 'a cat on a mat',
    });
    assert.strictEqual(segs.length, 1);
    assert.strictEqual(segs[0].locator, 'image');
    assert.strictEqual(segs[0].text, 'a cat on a mat');
  }
  console.log('PASS png-described');

  // png without describeImage -> [].
  {
    const segs = await extractContextFile('pic.png', new ArrayBuffer(4),
      { htmlToMarkdown: stubHtmlToMarkdown });
    assert.deepStrictEqual(segs, []);
  }
  console.log('PASS png-undescribed');

  // md splits per heading too.
  {
    const md = '# Alpha\nhello\n## Beta\nworld\n';
    const segs = await extractContextFile('n.md', toArrayBuffer(Buffer.from(md, 'utf8')),
      { htmlToMarkdown: stubHtmlToMarkdown });
    assert.strictEqual(segs.length, 2);
    assert.strictEqual(segs[0].locator, 'Alpha');
    assert.strictEqual(segs[1].locator, 'Beta');
  }
  console.log('PASS md');

  // xlsx cell containing a newline stays on one Markdown table row (<br>).
  {
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,
      XLSX.utils.aoa_to_sheet([['a', 'b'], ['line1\nline2', 'd'], ['p\r\nq', 'y']]), 'S');
    const bytes = toArrayBuffer(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    const segs = await extractContextFile('nl.xlsx', bytes, { htmlToMarkdown: stubHtmlToMarkdown });
    assert.strictEqual(segs.length, 1);
    assert.ok(segs[0].text.includes('line1<br>line2'), 'LF -> <br>, got: ' + segs[0].text);
    assert.ok(segs[0].text.includes('p<br>q'), 'CRLF -> single <br>, got: ' + segs[0].text);
    assert.ok(!segs[0].text.includes('\r'), 'no raw CR left, got: ' + JSON.stringify(segs[0].text));
    assert.strictEqual(segs[0].text.split('\n').length, 3, '3 rows stay 3 lines, got: ' + segs[0].text);
  }
  console.log('PASS xlsx-newline-cell');

  // headings inside fenced code blocks do not split (docx path via htmlToMarkdown stub).
  {
    const fenced = '# Title\nhello\n```\n# comment\ncode\n```\nworld\n';
    const segs = await extractContextFile('notes.docx', await buildDocxBytes(),
      { htmlToMarkdown: () => fenced });
    assert.strictEqual(segs.length, 1, 'fence # stays one segment, got ' + JSON.stringify(segs));
    assert.strictEqual(segs[0].locator, 'Title');
    assert.ok(segs[0].text.includes('# comment'), 'fence content kept');
  }
  console.log('PASS md-fence-backtick');

  // ~~~ fences also suppress heading splits.
  {
    const md = '# Title\nhello\n~~~\n# comment\ncode\n~~~\nworld\n';
    const segs = await extractContextFile('n.md', toArrayBuffer(Buffer.from(md, 'utf8')),
      { htmlToMarkdown: stubHtmlToMarkdown });
    assert.strictEqual(segs.length, 1, 'tilde fence # stays one segment, got ' + JSON.stringify(segs));
  }
  console.log('PASS md-fence-tilde');

  // pdf items with missing/undefined str are skipped, never "undefined".
  {
    const deps = {
      htmlToMarkdown: stubHtmlToMarkdown,
      loadPdfJs: async () => ({
        getDocument: () => ({
          promise: {
            numPages: 1,
            getPage: async () => ({
              getTextContent: async () => ({ items: [{ str: 'Hello' }, {}, { str: undefined }, null, undefined, { str: '' }, { str: 'world' }] }),
            }),
          },
        }),
      }),
    };
    const segs = await extractContextFile('doc.pdf', new ArrayBuffer(8), deps);
    assert.strictEqual(segs.length, 1);
    assert.ok(!segs[0].text.includes('undefined'), 'no undefined, got: ' + segs[0].text);
    assert.ok(segs[0].text.includes('Hello world'), 'text joined, got: ' + segs[0].text);
  }
  console.log('PASS pdf-undefined-str');

  // uppercase .DOCX is handled.
  {
    const segs = await extractContextFile('NOTES.DOCX', await buildDocxBytes(),
      { htmlToMarkdown: stubHtmlToMarkdown });
    assert.strictEqual(segs.length, 2);
    assert.strictEqual(segs[0].locator, 'Report');
  }
  console.log('PASS docx-uppercase-ext');

  // docx text before the first heading gets locator "".
  {
    const segs = await extractContextFile('pre.docx', await buildDocxPreambleBytes(),
      { htmlToMarkdown: stubHtmlToMarkdown });
    assert.strictEqual(segs.length, 2, 'preamble + heading -> 2 segments, got ' + JSON.stringify(segs));
    assert.strictEqual(segs[0].locator, '');
    assert.ok(segs[0].text.includes('Preamble text.'), 'preamble kept, got: ' + segs[0].text);
    assert.strictEqual(segs[1].locator, 'Report');
  }
  console.log('PASS docx-preamble-locator');

  // .jpg passes mime image/jpeg to describeImage.
  {
    let gotMime = null;
    const segs = await extractContextFile('pic.jpg', new ArrayBuffer(4), {
      htmlToMarkdown: stubHtmlToMarkdown,
      describeImage: async (_bytes, mime) => { gotMime = mime; return 'a dog'; },
    });
    assert.strictEqual(gotMime, 'image/jpeg', 'mime, got: ' + gotMime);
    assert.strictEqual(segs.length, 1);
    assert.strictEqual(segs[0].text, 'a dog');
  }
  console.log('PASS jpg-mime');

  // .pptx rejects with code unsupported-type.
  {
    await assert.rejects(
      extractContextFile('deck.pptx', new ArrayBuffer(4), { htmlToMarkdown: stubHtmlToMarkdown }),
      (err) => err && err.code === 'unsupported-type');
  }
  console.log('PASS unsupported-type');

  console.log('writing-extract-test: PASS');
}

main().catch((err) => { console.error('FAIL', err); process.exit(1); });
