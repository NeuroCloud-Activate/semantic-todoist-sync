"use strict";

// Citation styles: metadata extraction, reference entries, in-text markers and
// reference-list planning. Pure functions, no Obsidian API, no dependencies.

function stripMdExtension(path) {
  return path.endsWith(".md") ? path.slice(0, -3) : path;
}

// "Jane A. Smith" -> ["Smith", "Jane A."]; "Smith, Jane A." -> ["Smith", "Jane A."]
function splitAuthor(a) {
  const s = String(a || "").trim();
  if (!s) return ["", ""];
  if (s.includes(",")) {
    const i = s.indexOf(",");
    return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
  }
  const parts = s.split(/\s+/);
  if (parts.length === 1) return [parts[0], ""];
  return [parts[parts.length - 1], parts.slice(0, -1).join(" ")];
}

// "Dale H." -> "D. H." (first letter of each given-name part, hyphen-aware)
function initials(given) {
  return String(given || "")
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + ".")
    .join(" ");
}

function authorList(authors) {
  return authors.map((a) => {
    const parts = splitAuthor(a);
    const ini = initials(parts[1]);
    return ini ? parts[0] + ", " + ini : parts[0];
  });
}

function metaFromFrontmatter(frontmatter) {
  const fm = frontmatter && typeof frontmatter === "object" ? frontmatter : {};
  const meta = {};
  const rawAuthors = fm.authors !== undefined ? fm.authors : fm.author;
  const authors = [];
  if (typeof rawAuthors === "string") authors.push(rawAuthors);
  else if (Array.isArray(rawAuthors)) {
    for (const a of rawAuthors) {
      if (typeof a === "string" && a.trim()) authors.push(a);
    }
  }
  meta.authors = authors.map((a) => {
    const parts = splitAuthor(a);
    return parts[1] ? parts[0] + ", " + parts[1] : parts[0];
  });
  const rawYear = fm.year !== undefined ? fm.year : (fm.date !== undefined ? fm.date : fm.published);
  if (rawYear !== undefined && rawYear !== null) {
    const m = String(rawYear).match(/\d{4}/);
    if (m) meta.year = Number(m[0]);
  }
  if (typeof fm.title === "string" && fm.title.trim()) meta.title = fm.title;
  const journal = fm.journal || fm["container-title"] || fm.publication;
  if (typeof journal === "string" && journal.trim()) meta.journal = journal;
  for (const k of ["volume", "issue", "pages", "doi", "url", "publisher"]) {
    if (fm[k] !== undefined && fm[k] !== null && String(fm[k]).trim() !== "") meta[k] = fm[k];
  }
  return meta;
}

// Dedupe key: DOI, else URL, else [[path]], else title.
function sourceKey(source) {
  const meta = (source && source.meta) || {};
  if (meta.doi) return meta.doi;
  if (meta.url) return meta.url;
  if (source && typeof source.path === "string" && source.path) {
    return "[[" + stripMdExtension(source.path) + "]]";
  }
  if (meta.title) return meta.title;
  return "";
}

function apaAuthorList(authors) {
  const parts = authorList(authors);
  const joined = parts.length <= 1 ? parts.join("") : parts.slice(0, -1).join(", ") + ", & " + parts[parts.length - 1];
  return joined.replace(/\.$/, ""); // initials already end with "."; the head adds the sentence period
}

function natureAuthorList(authors) {
  const parts = authorList(authors);
  if (parts.length >= 6) return parts[0] + " et al.";
  if (parts.length <= 1) return parts.join("");
  return parts.slice(0, -1).join(", ") + " & " + parts[parts.length - 1];
}

function formatReference(style, source) {
  const meta = (source && source.meta) || {};
  const authors = Array.isArray(meta.authors) ? meta.authors.filter((a) => typeof a === "string" && a.trim()) : [];
  const year = meta.year !== undefined && meta.year !== null && String(meta.year) !== "" ? String(meta.year) : null;
  const title = typeof meta.title === "string" ? meta.title : "";
  const path = source && typeof source.path === "string" && source.path ? stripMdExtension(source.path) : "";
  const isWeb = source && source.kind === "web";

  if (style === "apa") {
    const yr = year || "n.d.";
    if (meta.journal) {
      const head = authors.length
        ? apaAuthorList(authors) + ". (" + yr + "). " + title + ". "
        : title + ". (" + yr + "). ";
      let tail = "*" + meta.journal + "*";
      if (meta.volume) {
        tail += ", *" + meta.volume + "*";
        if (meta.issue) tail += "(" + meta.issue + ")";
      }
      if (meta.pages) tail += ", " + meta.pages;
      tail += ".";
      if (meta.doi) tail += " https://doi.org/" + meta.doi;
      return head + tail;
    }
    if (isWeb) {
      let tail = "";
      if (meta.site) tail += meta.site + ". ";
      if (meta.url) tail += meta.url;
      return "*" + title + "*. (" + yr + "). " + tail;
    }
    const head = authors.length
      ? apaAuthorList(authors) + ". (" + yr + "). " + title + ". "
      : "*" + title + "*. (" + yr + "). ";
    const tail = path ? "[[" + path + "]]" : (meta.url || "");
    return head + tail;
  }

  // nature
  if (meta.journal) {
    const head = authors.length
      ? natureAuthorList(authors) + " " + title + ". "
      : title + ". ";
    let tail = "*" + meta.journal + "* ";
    if (meta.volume) tail += "**" + meta.volume + "**";
    if (meta.pages) tail += ", " + meta.pages;
    if (meta.doi) tail += "; https://doi.org/" + meta.doi;
    tail += " (" + (year || "n.d.") + ").";
    return head + tail;
  }
  if (isWeb) {
    let out = title + ". ";
    if (meta.site) out += "*" + meta.site + "* ";
    if (meta.url) out += meta.url;
    return out;
  }
  let out = "";
  if (authors.length) out += natureAuthorList(authors) + " ";
  out += title + ". ";
  if (path) out += "[[" + path + "]]";
  else if (meta.url) out += meta.url;
  if (year) out += " (" + year + ")";
  return out;
}

function formatInText(style, items) {
  const list = Array.isArray(items) ? items : [];
  if (style === "apa") {
    // writing-mode: task 4 fix — several sources share ONE bracket: (A, 2020; B, n.d.)
    const parts = list.map((it) => {
      const meta = (it && it.source && it.source.meta) || {};
      const authors = Array.isArray(meta.authors) ? meta.authors : [];
      const year = meta.year ? String(meta.year) : "n.d.";
      if (authors.length === 0) return "*" + (meta.title || "") + "*, " + year;
      const surnames = authors.map((a) => splitAuthor(a)[0]);
      let name;
      if (surnames.length === 1) name = surnames[0];
      else if (surnames.length === 2) name = surnames[0] + " & " + surnames[1];
      else name = surnames[0] + " et al.";
      return name + ", " + year;
    });
    if (parts.length === 0) return "";
    return "(" + parts.join("; ") + ")";
  }
  // writing-mode: task 4 fix — Nature numbers read ascending and are de-duplicated: [1,3]
  const numbers = Array.from(new Set(list.map((it) => (it && it.number) || 0))).sort((a, b) => a - b);
  return "[" + numbers.join(",") + "]";
}

function planReferences(noteText, style, sources) {
  const text = typeof noteText === "string" ? noteText : "";
  const srcs = Array.isArray(sources) ? sources : [];
  const isNature = style === "nature";
  const numbers = {};
  const added = [];

  const lines = text.split("\n");
  const lineOffset = (i) => {
    let off = 0;
    for (let j = 0; j < i; j++) off += lines[j].length + 1;
    return off;
  };

  // First heading line "References" or "Bibliography" (any level).
  let headingIdx = -1;
  let headingLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(References|Bibliography)\s*$/i.exec(lines[i]);
    if (m) {
      headingIdx = i;
      headingLevel = m[1].length;
      break;
    }
  }

  let from;
  let to;
  let sectionLines = [];
  if (headingIdx === -1) {
    from = text.length;
    to = text.length;
  } else {
    from = lineOffset(headingIdx) + lines[headingIdx].length + 1;
    let endIdx = lines.length;
    for (let i = headingIdx + 1; i < lines.length; i++) {
      const m = /^(#{1,6})\s/.exec(lines[i]);
      if (m && m[1].length <= headingLevel) {
        endIdx = i;
        break;
      }
    }
    to = lineOffset(endIdx);
    sectionLines = lines.slice(headingIdx + 1, endIdx);
  }

  const entryLines = sectionLines.filter((l) =>
    isNature ? /^\d+\.\s/.test(l) : l.startsWith("- ")
  );

  let nextNum = 1;
  for (const l of entryLines) {
    const m = /^(\d+)\.\s/.exec(l);
    if (m) nextNum = Math.max(nextNum, parseInt(m[1], 10) + 1);
  }

  const newEntries = [];
  for (const source of srcs) {
    const key = sourceKey(source);
    const existing = key ? entryLines.find((l) => l.includes(key)) : null;
    if (existing) {
      if (isNature) {
        const m = /^(\d+)\.\s/.exec(existing);
        if (m) numbers[key] = parseInt(m[1], 10);
      }
      continue;
    }
    if (isNature) {
      numbers[key] = nextNum;
      nextNum += 1;
      newEntries.push(numbers[key] + ". " + formatReference("nature", source));
    } else {
      newEntries.push("- " + formatReference("apa", source));
    }
  }
  added.push(...newEntries);

  if (newEntries.length === 0) return { numbers, added, edit: null };

  let editText;
  if (headingIdx === -1) {
    editText = "\n\n## References\n\n" + newEntries.join("\n") + "\n";
  } else if (isNature) {
    const body = sectionLines
      .filter((l) => l.trim().length > 0)
      .concat(newEntries)
      .join("\n");
    editText = body ? body + "\n" : "";
  } else {
    // APA: re-sort all "- " entries in the section (compare without "*", case-insensitive).
    const existingEntries = entryLines.map((l) => l.slice(2));
    const all = existingEntries.concat(newEntries.map((e) => e.slice(2)));
    all.sort((a, b) => {
      const ka = a.replace(/\*/g, "").toLowerCase();
      const kb = b.replace(/\*/g, "").toLowerCase();
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    editText = all.map((e) => "- " + e).join("\n") + "\n";
  }

  return { numbers, added, edit: { from, to, text: editText } };
}

module.exports = { metaFromFrontmatter, sourceKey, formatReference, formatInText, planReferences };
