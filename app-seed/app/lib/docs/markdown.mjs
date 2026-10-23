// Claqueta Markdown -> AST. CommonMark-ish subset + GFM tables/task lists + directives:
//   :::name key=value key="two words"   ...content...   :::        (callout, box, columns, cover, toc, data, chart, signature, kv, landscape, portrait, pagebreak)
//   ---col---   splits a `columns` block;  \pagebreak  or  :::pagebreak:::  forces a page break;  {#id .class key=val} after a heading/image sets attributes.
export function parseAttrs(s) {
  const out = {}; const re = /([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|(\S+)))?/g; let m;
  while ((m = re.exec(s || ""))) out[m[1]] = m[2] ?? m[3] ?? m[4] ?? true;
  return out;
}
const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
/** Splits the optional `---` metadata header (title, subtitle, cover, client...) from the Markdown body. */
export function frontMatter(src) {
  const m = FM.exec(src); if (!m) return { meta: {}, body: src };
  const meta = {}; for (const line of m[1].split(/\r?\n/)) { const k = line.match(/^([\w-]+):\s*(.*)$/); if (k) meta[k[1]] = k[2].replace(/^["']|["']$/g, ""); }
  return { meta, body: src.slice(m[0].length) };
}

// ---- inline ---------------------------------------------------------------------------------------------------------------------------
export function parseInline(s) {
  const out = []; let i = 0, buf = "";
  const flush = () => { if (buf) { out.push({ k: "text", v: buf }); buf = ""; } };
  const closeAt = (str, from, tok) => { for (let j = from; j < str.length; j++) { if (str[j] === "\\") { j++; continue; } if (str.startsWith(tok, j)) return j; } return -1; };
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) { if (s[i + 1] === "\n") { flush(); out.push({ k: "br" }); i += 2; continue; } buf += s[i + 1]; i += 2; continue; }
    if (c === "`") { const e = s.indexOf("`", i + 1); if (e > 0) { flush(); out.push({ k: "code", v: s.slice(i + 1, e) }); i = e + 1; continue; } }
    if (c === "!" && s[i + 1] === "[") { const m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)(\{[^}]*\})?/.exec(s.slice(i)); if (m) { flush(); out.push({ k: "img", alt: m[1], src: m[2], title: m[3] || "", attrs: parseAttrs((m[4] || "").slice(1, -1)) }); i += m[0].length; continue; } }
    if (c === "[") { const m = /^\[((?:[^\]\\]|\\.)*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(s.slice(i)); if (m) { flush(); out.push({ k: "a", href: m[2], c: parseInline(m[1]) }); i += m[0].length; continue; } }
    if (c === "<") { const m = /^<((?:https?:\/\/|mailto:)[^>\s]+)>/.exec(s.slice(i)); if (m) { flush(); out.push({ k: "a", href: m[1], c: [{ k: "text", v: m[1].replace(/^mailto:/, "") }] }); i += m[0].length; continue; } }
    let matched = false;
    for (const [tok, kind] of [["**", "b"], ["__", "b"], ["~~", "s"], ["==", "mark"], ["*", "i"], ["_", "i"]]) {
      if (!s.startsWith(tok, i)) continue;
      if (tok === "_" && i > 0 && /\w/.test(s[i - 1])) continue;                       // snake_case stays literal
      if (s[i + tok.length] === " " || i + tok.length >= s.length) continue;
      const e = closeAt(s, i + tok.length, tok); if (e < 0 || s[e - 1] === " ") continue;
      if (tok === "_" && /\w/.test(s[e + 1] || "")) continue;
      flush(); out.push({ k: kind, c: parseInline(s.slice(i + tok.length, e)) }); i = e + tok.length; matched = true; break;
    }
    if (matched) continue;
    if (c === "\n") { if (buf.endsWith("  ")) { buf = buf.replace(/ +$/, ""); flush(); out.push({ k: "br" }); } else buf += " "; i++; continue; }
    buf += c; i++;
  }
  flush(); return out;
}

// ---- blocks ---------------------------------------------------------------------------------------------------------------------------
const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes("-") && (l.includes("|") || false);
const splitRow = (l) => { let t = l.trim(); if (t.startsWith("|")) t = t.slice(1); if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1); const cells = []; let cur = ""; for (let i = 0; i < t.length; i++) { if (t[i] === "\\" && t[i + 1] === "|") { cur += "|"; i++; } else if (t[i] === "|") { cells.push(cur); cur = ""; } else cur += t[i]; } cells.push(cur); return cells.map((x) => x.trim()); };
const BLOCK_START = /^(\s{0,3}(#{1,6}\s|>|```|~~~|[-*+]\s|\d+[.)]\s|:::|\\pagebreak|---+\s*$|\*\*\*+\s*$))/;

/** Collado Markdown to block nodes: headings, lists (with tasks), quotes, code, tables, and the `:::name` directives (callout, box, columns, cover, toc, data, chart, graphic, gallery, kv, signature, landscape, pagebreak, raw). */
export function parseBlocks(src, depth = 0) {
  const lines = String(src).replace(/\r\n?/g, "\n").split("\n"); const blocks = []; let i = 0;
  const para = [];
  const flushPara = () => { if (para.length) { blocks.push({ t: "p", inlines: parseInline(para.join("\n")) }); para.length = 0; } };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { flushPara(); i++; continue; }
    if (para.length && (BLOCK_START.test(line) || (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])))) flushPara();
    let m;
    if ((m = /^(#{1,6})\s+(.*?)\s*(\{[^}]*\})?\s*#*\s*$/.exec(line))) { flushPara(); const a = parseAttrs((m[3] || "").slice(1, -1).replace(/#(\S+)/g, 'id=$1').replace(/\.(\S+)/g, 'class=$1')); blocks.push({ t: "h", level: m[1].length, inlines: parseInline(m[2]), attrs: a }); i++; continue; }
    if (/^\s*\\pagebreak\s*$/.test(line)) { flushPara(); blocks.push({ t: "pagebreak" }); i++; continue; }
    if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line) && !para.length) { flushPara(); blocks.push({ t: "hr" }); i++; continue; }
    if ((m = /^\s{0,3}(```|~~~)\s*([\w+-]*)/.exec(line))) { flushPara(); const fence = m[1], lang = m[2]; const buf = []; i++; while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]); i++; blocks.push({ t: "code", lang, text: buf.join("\n") }); continue; }
    if ((m = /^\s{0,3}:::\s*([\w-]+)\s*(.*)$/.exec(line)) && depth < 6) {
      flushPara(); const name = m[1].toLowerCase(), attrs = parseAttrs(m[2].replace(/:::\s*$/, "")); i++;
      const selfClosing = /:::\s*$/.test(line) && m[2].trim().length > 0; const buf = [];
      if (!selfClosing) { let d = 1; while (i < lines.length) { const l = lines[i]; if (/^\s{0,3}:::\s*$/.test(l)) { d--; if (d === 0) { i++; break; } } else if (/^\s{0,3}:::\s*[\w-]+/.test(l) && !/:::\s*$/.test(l.trim().replace(/^:::/, ""))) d++; buf.push(l); i++; } }
      blocks.push(directive(name, attrs, buf.join("\n"), depth)); continue;
    }
    if (/^\s{0,3}>/.test(line)) { flushPara(); const buf = []; while (i < lines.length && /^\s{0,3}>/.test(lines[i])) buf.push(lines[i++].replace(/^\s{0,3}>\s?/, "")); blocks.push({ t: "quote", blocks: parseBlocks(buf.join("\n"), depth + 1) }); continue; }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushPara(); const head = splitRow(line), seps = splitRow(lines[i + 1]); const align = seps.map((s) => (s.startsWith(":") && s.endsWith(":") ? "center" : s.endsWith(":") ? "right" : s.startsWith(":") ? "left" : "")); i += 2;
      const rows = []; while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(splitRow(lines[i++]));
      let attrs = {}; if (i < lines.length && /^\s*\{[^}]*\}\s*$/.test(lines[i])) { attrs = parseAttrs(lines[i].trim().slice(1, -1)); i++; }
      const cell = (txt, k) => { const span = /^(.*?)\s*\{colspan=(\d+)\}$/.exec(txt); return { inlines: parseInline(span ? span[1] : txt), colspan: span ? Number(span[2]) : 1, align: align[k] || "" }; };
      blocks.push({ t: "table", head: head.map(cell), rows: rows.map((r) => r.map(cell)), align, attrs }); continue;
    }
    if ((m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line))) { flushPara(); const r = parseList(lines, i, depth); blocks.push(r.block); i = r.next; continue; }
    para.push(line.replace(/\s+$/, (sp) => (sp.length >= 2 ? "  " : ""))); i++;
  }
  flushPara(); return blocks;
}
function parseList(lines, start, depth) {
  const first = /^(\s*)([-*+]|\d+[.)])\s+/.exec(lines[start]); const indent = first[1].length; const ordered = /\d/.test(first[2]);
  const items = []; let i = start;
  while (i < lines.length) {
    const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
    if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
    let text = m[3]; const sub = []; i++;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { if (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && lines[i + 1].match(/^(\s*)/)[1].length > indent) { sub.push(""); i++; continue; } break; }
      const ind = l.match(/^(\s*)/)[1].length;
      if (ind > indent) { sub.push(l.slice(Math.min(ind, indent + 2))); i++; continue; }
      break;
    }
    let checked; const tk = /^\[( |x|X)\]\s+(.*)$/.exec(text); if (tk) { checked = tk[1] !== " "; text = tk[2]; }
    const nested = sub.length ? parseBlocks(sub.join("\n"), depth + 1) : [];
    items.push({ inlines: parseInline(text), blocks: nested, checked });
  }
  return { block: { t: ordered ? "ol" : "ul", items, start: ordered ? Number(/\d+/.exec(first[2])[0]) : 1 }, next: i };
}
function directive(name, attrs, body, depth) {
  switch (name) {
    case "callout": return { t: "callout", kind: attrs.kind || "info", title: typeof attrs.title === "string" ? attrs.title : "", blocks: parseBlocks(body, depth + 1) };
    case "box": return { t: "box", color: attrs.color || "accent", blocks: parseBlocks(body, depth + 1) };
    case "columns": { const parts = body.split(/^\s*---col---\s*$/m); return { t: "columns", cols: parts.map((p) => parseBlocks(p, depth + 1)), gap: attrs.gap }; }
    case "cover": return { t: "cover", attrs, extra: parseBlocks(body, depth + 1) };
    case "toc": return { t: "toc", depth: Number(attrs.depth) || 2, title: typeof attrs.title === "string" ? attrs.title : null };
    case "data": return { t: "data", attrs };
    case "chart": return { t: "chart", attrs };
    case "graphic": return { t: "graphic", attrs, body: body.trim() };
    case "gallery": return { t: "gallery", attrs, body: body.trim() };
    case "signature": return { t: "signature", names: String(attrs.names || "").split("|").map((x) => x.trim()).filter(Boolean), place: attrs.place || "" };
    case "kv": { const pairs = body.split("\n").map((l) => l.match(/^\s*([^:]+):\s*(.*)$/)).filter(Boolean).map((m) => [parseInline(m[1].trim()), parseInline(m[2].trim())]); return { t: "kv", pairs }; }
    case "landscape": case "portrait": return { t: "section", orientation: name, blocks: parseBlocks(body, depth + 1) };
    case "pagebreak": return { t: "pagebreak" };
    case "raw": return { t: "raw", html: body };
    default: return { t: "box", color: "plain", blocks: parseBlocks(body, depth + 1) };
  }
}
/** Parses a whole document into { meta, blocks }. */
export function parseDocument(src) { const { meta, body } = frontMatter(String(src ?? "")); return { meta, blocks: parseBlocks(body) }; }
/** Plain text of inline nodes (for the index, lint and image alt text). */
export const inlineText = (inl) => (inl || []).map((n) => (n.k === "text" || n.k === "code" ? n.v : n.k === "br" ? " " : n.k === "img" ? n.alt : n.c ? inlineText(n.c) : "")).join("");
