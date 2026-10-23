// Tiny safe Markdown renderer for comments and agent outputs (escape first, then a few inline/blocks rules). The document engine does the real work on the server.
import { esc } from "./dom.js";
/** A small safe Markdown renderer (escape first, then a few block and inline rules) for comments and agent output; the document engine on the server does the real work. */
export function md(src) {
  const lines = String(src ?? "").replace(/\r/g, "").split("\n"); const out = []; let list = null, code = null;
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>").replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>').replace(/(^|\s)@([a-z][a-z0-9._-]{1,31})/g, '$1<span class="nb-badge nb-badge--blue">@$2</span>');
  const flush = () => { if (list) { out.push(`<${list.t}>${list.items.join("")}</${list.t}>`); list = null; } };
  for (const l of lines) {
    if (l.startsWith("```")) { if (code) { out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`); code = null; } else { flush(); code = []; } continue; }
    if (code) { code.push(l); continue; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { flush(); out.push(`<h${m[1].length + 2}>${inline(m[2])}</h${m[1].length + 2}>`); }
    else if ((m = /^\s*[-*]\s+(.*)$/.exec(l))) { if (!list || list.t !== "ul") { flush(); list = { t: "ul", items: [] }; } list.items.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { if (!list || list.t !== "ol") { flush(); list = { t: "ol", items: [] }; } list.items.push(`<li>${inline(m[1])}</li>`); }
    else if (!l.trim()) flush(); else { flush(); out.push(`<p>${inline(l)}</p>`); }
  }
  flush(); if (code) out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`); return out.join("");
}
