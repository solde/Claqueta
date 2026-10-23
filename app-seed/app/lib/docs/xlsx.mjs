// Dataset/table -> .xlsx without libraries: typed cells (money, dates, percentages), brand-coloured headers, frozen header row, filters, live SUM totals, print setup.
import { zip } from "./zip.mjs";
import { hexNoHash, readable } from "./brand.mjs";
import { str } from "./format.mjs";

const X = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const colName = (n) => { let s = ""; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const serial = (iso) => { const t = Date.parse(String(iso).length === 10 ? iso + "T00:00:00Z" : iso); return Number.isNaN(t) ? null : t / 864e5 + 25569; };
const SYMBOL = { EUR: "€", USD: "$", GBP: "£" };

export function buildXlsx({ title = "", author = "Collado", sheets, brand = {}, lang = "es", currency = "EUR" }) {
  const prim = hexNoHash(brand.primary || "#1f3a5f"), stripe = hexNoHash(brand.table_stripe || "#f4f6f8"), ink = readable(brand.table_head_bg || brand.primary || "#1f3a5f") === "#ffffff" ? "FFFFFF" : "111111";
  const font = X(brand.font_body || "Calibri");
  const xfs = [{ numFmt: 0, font: 0, fill: 0, border: 0, align: "" }]; const xfKey = new Map([["0|0|0|0|", 0]]);
  const numFmts = []; const fmtId = (code) => { let i = numFmts.indexOf(code); if (i < 0) { numFmts.push(code); i = numFmts.length - 1; } return 164 + i; };
  const xf = (o) => { const k = `${o.numFmt || 0}|${o.font || 0}|${o.fill || 0}|${o.border || 0}|${o.align || ""}`; if (xfKey.has(k)) return xfKey.get(k); xfs.push(o); xfKey.set(k, xfs.length - 1); return xfs.length - 1; };
  const cur = `#,##0.00\\ "${SYMBOL[currency] || currency}";[Red]\\-#,##0.00\\ "${SYMBOL[currency] || currency}"`;
  const FMT = { money: () => fmtId(cur), pct: () => fmtId("0.0%"), date: () => fmtId("dd/mm/yyyy"), datetime: () => fmtId("dd/mm/yyyy hh:mm"), num: () => fmtId("#,##0.##"), duration: () => fmtId("[h]:mm:ss") };
  const sheetsXml = [];
  sheets.forEach((sh, si) => {
    const cols = sh.columns, rows = sh.rows || []; const out = []; let r = 1;
    const put = (c, rr, v, s, type) => { const ref = colName(c) + rr; if (v === null || v === undefined || v === "") return `<c r="${ref}" s="${s}"/>`; if (type === "n") return `<c r="${ref}" s="${s}"><v>${v}</v></c>`; if (type === "f") return `<c r="${ref}" s="${s}"><f>${X(v.f)}</f><v>${v.v ?? 0}</v></c>`; return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${X(v)}</t></is></c>`; };
    const mergeRefs = [];
    if (sh.title) { out.push(`<row r="${r}" ht="24" customHeight="1">${put(0, r, sh.title, xf({ font: 2 }), "s")}</row>`); r++; }
    if (sh.subtitle) { out.push(`<row r="${r}">${put(0, r, sh.subtitle, xf({ font: 3 }), "s")}</row>`); r++; }
    if (sh.title || sh.subtitle) r++;
    const headRow = r; out.push(`<row r="${r}" ht="22" customHeight="1">${cols.map((c, i) => put(i, r, c.label, xf({ font: 1, fill: 2, border: 1, align: c.align === "right" || ["money", "num", "pct"].includes(c.type) ? "right" : "left" }), "s")).join("")}</row>`); r++;
    const first = r;
    for (const [ri, row] of rows.entries()) {
      out.push(`<row r="${r}">${cols.map((c, i) => {
        const v = row[c.key]; const fill = row._bold ? 4 : ri % 2 ? 3 : 0; const base = { fill, border: 1, font: row._bold ? 4 : 0 };
        if (v === null || v === undefined || v === "") return put(i, r, "", xf(base), "s");
        if (c.type === "money") return put(i, r, Number(v), xf({ ...base, numFmt: FMT.money() }), "n");
        if (c.type === "pct") return put(i, r, Number(v) / 100, xf({ ...base, numFmt: FMT.pct() }), "n");
        if (c.type === "num") return put(i, r, Number(v), xf({ ...base, numFmt: FMT.num() }), "n");
        if (c.type === "duration") return put(i, r, Number(v) / 86400, xf({ ...base, numFmt: FMT.duration() }), "n");
        if (c.type === "date") { const d = serial(v); return d === null ? put(i, r, v, xf(base), "s") : put(i, r, d, xf({ ...base, numFmt: FMT.date() }), "n"); }
        if (c.type === "datetime") { const d = serial(v); return d === null ? put(i, r, v, xf(base), "s") : put(i, r, d, xf({ ...base, numFmt: FMT.datetime() }), "n"); }
        return put(i, r, c.type === "bool" ? (v ? "✓" : "") : Array.isArray(v) ? v.join(", ") : String(v), xf({ ...base, align: "wrap" }), "s");
      }).join("")}</row>`); r++;
    }
    const last = r - 1;
    if (sh.totals !== false && cols.some((c) => c.total === "sum") && rows.length) {
      out.push(`<row r="${r}">${cols.map((c, i) => { const s = xf({ font: 4, fill: 5, border: 2, numFmt: c.type === "money" ? FMT.money() : c.type === "num" ? FMT.num() : 0 });
        if (i === 0 && c.total !== "sum") return put(i, r, str(lang, "total"), s, "s"); if (c.total === "sum") { const sum = rows.filter((x) => !x._bold || !rows.some((y) => y._indent)).reduce((a, x) => a + (Number(x[c.key]) || 0), 0); return put(i, r, { f: `SUM(${colName(i)}${first}:${colName(i)}${last})`, v: Math.round(sum * 100) / 100 }, s, "f"); } return put(i, r, "", s, "s"); }).join("")}</row>`); r++;
    }
    const widths = cols.map((c, i) => c.width || Math.min(60, Math.max(10, c.label.length + 3, ...rows.slice(0, 200).map((x) => String(x[c.key] ?? "").length + 2))));
    sheetsXml.push({ name: String(sh.name || `Hoja${si + 1}`).replace(/[\[\]:*?/\\]/g, " ").slice(0, 31) || `Hoja${si + 1}`,
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0"${si === 0 ? ' tabSelected="1"' : ""}>${sh.freeze !== false ? `<pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/>` : ""}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${out.join("")}</sheetData>${sh.autofilter !== false && rows.length ? `<autoFilter ref="A${headRow}:${colName(cols.length - 1)}${last}"/>` : ""}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${sh.landscape || cols.length > 6 ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;L${X(title)}&amp;R&amp;P / &amp;N</oddFooter></headerFooter></worksheet>` });
  });
  const fonts = `<fonts count="5"><font><sz val="10"/><name val="${font}"/></font><font><b/><sz val="10"/><color rgb="FF${ink}"/><name val="${font}"/></font><font><b/><sz val="16"/><color rgb="FF${prim}"/><name val="${font}"/></font><font><sz val="10"/><color rgb="FF6B7280"/><name val="${font}"/></font><font><b/><sz val="10"/><name val="${font}"/></font></fonts>`;
  const fills = `<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF${hexNoHash(brand.table_head_bg || brand.primary || "#1f3a5f")}"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF${stripe}"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3E8EF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF6D6"/><bgColor indexed="64"/></patternFill></fill></fills>`;
  const borders = `<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFCFD4DB"/></bottom><diagonal/></border><border><left/><right/><top style="medium"><color rgb="FF${prim}"/></top><bottom/><diagonal/></border></borders>`;
  const cellXfs = xfs.map((o) => `<xf numFmtId="${o.numFmt || 0}" fontId="${o.font || 0}" fillId="${o.fill || 0}" borderId="${o.border || 0}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"${o.align ? ` applyAlignment="1"><alignment horizontal="${o.align === "right" ? "right" : "left"}" vertical="top"${o.align === "wrap" ? ' wrapText="1"' : ""}/></xf>` : "/>"}`).join("");
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map((c, i) => `<numFmt numFmtId="${164 + i}" formatCode="${X(c)}"/>`).join("")}</numFmts>` : ""}${fonts}${fills}${borders}<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${cellXfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  return zip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetsXml.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><sheets>${sheetsXml.map((s, i) => `<sheet name="${X(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetsXml.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheetsXml.length + 1}" Type="${R}/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: styles },
    ...sheetsXml.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: s.xml })),
    { name: "docProps/core.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${X(title)}</dc:title><dc:creator>${X(author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>` },
  ]);
}
