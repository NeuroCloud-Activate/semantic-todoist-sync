'use strict';

// Context file extraction: binary bytes -> [{ text, locator }] segments.
// CommonJS; parsers are required lazily inside the branch that needs them so
// mobile startup never pays for mammoth/xlsx. Never requires "obsidian".

const CONTEXT_EXTENSIONS = ['md', 'txt', 'docx', 'xlsx', 'csv', 'pdf', 'png', 'jpg', 'jpeg'];

const MAX_ROWS_PER_SHEET = 2000;
const IMAGE_EXTENSIONS = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

function unsupported(name) {
  const ext = extensionOf(name);
  const err = new Error('unsupported context file type: ' + (ext ? '.' + ext : name));
  err.code = 'unsupported-type';
  throw err;
}

function extensionOf(name) {
  const base = String(name).split(/[\\/]/).pop();
  const i = base.lastIndexOf('.');
  return i < 0 ? '' : base.slice(i + 1).toLowerCase();
}

// Split Markdown text into segments at ATX headings. Locator is the heading
// text; content before the first heading gets locator "".
function splitOnHeadings(markdown) {
  const segments = [];
  let locator = '';
  let lines = [];
  const push = () => {
    const text = lines.join('\n').trim();
    if (text) segments.push({ text, locator });
    lines = [];
  };
  for (const line of String(markdown).split('\n')) {
    const m = /^(#{1,6})\s+(.*?)(\s+#+\s*)?$/.exec(line);
    if (m) {
      push();
      locator = m[2].trim();
    } else {
      lines.push(line);
    }
  }
  push();
  return segments;
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|');
}

function rowsToMarkdownTable(rows) {
  const out = [];
  for (const row of rows) out.push('| ' + row.map(escapeCell).join(' | ') + ' |');
  return out.join('\n');
}

async function convertDocx(arrayBuffer) {
  // Browser build uses { arrayBuffer }; Node's mammoth wants { buffer }.
  const mammoth = require('mammoth');
  try {
    const result = await mammoth.convertToHtml({ arrayBuffer });
    if (result && typeof result.value === 'string') return result.value;
    throw new Error('empty mammoth result');
  } catch (err) {
    if (typeof Buffer !== 'undefined' && arrayBuffer instanceof ArrayBuffer) {
      const result = await mammoth.convertToHtml({ buffer: Buffer.from(arrayBuffer) });
      return result.value;
    }
    throw err;
  }
}

function workbookToSegments(wb, singleSheetLocator) {
  const segments = [];
  for (const sheetName of wb.SheetNames) {
    const XLSX = require('xlsx');
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    while (rows.length && rows[rows.length - 1].every((c) => String(c) === '')) rows.pop();
    const total = rows.length;
    const kept = rows.slice(0, MAX_ROWS_PER_SHEET);
    let text = rowsToMarkdownTable(kept);
    if (total > MAX_ROWS_PER_SHEET) {
      text += '\n(truncated: ' + (total - MAX_ROWS_PER_SHEET) + ' more rows)';
    }
    if (!text.trim()) continue;
    segments.push({
      text,
      locator: singleSheetLocator || 'Sheet: ' + sheetName,
    });
  }
  return segments;
}

async function extractPdf(arrayBuffer, deps) {
  const pdfjsLib = await deps.loadPdfJs();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const segments = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const text = (content.items || []).map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
    if (text) segments.push({ text, locator: 'p. ' + n });
  }
  return segments;
}

async function extractContextFile(name, bytes, deps) {
  const ext = extensionOf(name);
  if (!CONTEXT_EXTENSIONS.includes(ext)) unsupported(name);
  const arrayBuffer = bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer;

  if (ext === 'md' || ext === 'txt') {
    return splitOnHeadings(new TextDecoder().decode(arrayBuffer));
  }
  if (ext === 'docx') {
    return splitOnHeadings(deps.htmlToMarkdown(await convertDocx(arrayBuffer)));
  }
  if (ext === 'xlsx') {
    const XLSX = require('xlsx');
    return workbookToSegments(XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' }), null);
  }
  if (ext === 'csv') {
    const XLSX = require('xlsx');
    const text = new TextDecoder().decode(arrayBuffer);
    return workbookToSegments(XLSX.read(text, { type: 'string' }), 'Sheet: 1');
  }
  if (ext === 'pdf') {
    return extractPdf(arrayBuffer, deps);
  }
  if (IMAGE_EXTENSIONS[ext]) {
    if (typeof deps.describeImage !== 'function') return [];
    return [{ text: await deps.describeImage(arrayBuffer, IMAGE_EXTENSIONS[ext]), locator: 'image' }];
  }
  unsupported(name);
}

module.exports = { extractContextFile, CONTEXT_EXTENSIONS };
