// The image gallery of a programme: adding pictures (uploaded or generated), reading them back (full size, thumbnail or reduced for a document).
import * as E from "./engine.mjs";
import { addFile } from "./files.mjs";
import { imageInfo } from "./docs/imageinfo.mjs";
import { renderGraphic } from "./docs/graphics.mjs";
import { brandRowFor, svgToPng, imageFor } from "./docs/render.mjs";
import { resolveBrand } from "./docs/brand.mjs";
import { bad } from "./util.mjs";

const stem = (n) => String(n || "imagen").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120) || "imagen";
const FIELDS = ["episode_id", "title", "kind", "phase", "caption", "alt_text", "credit", "shot_date", "location_id", "people", "rights", "rights_note", "tags", "featured", "position"];

/** Stores an image as a gallery item. `buffer` must be png, jpeg, gif, webp or svg. Returns the media_items row. */
export async function addMedia(ctx, { program_id, name, buffer, origin = "upload", spec, ...fields }) {
  const info = imageInfo(buffer); if (!info) throw bad("not_an_image");
  E.getRow(ctx, "programs", program_id);   // read access to the programme
  const body = { program_id: Number(program_id), title: fields.title || stem(name), ...Object.fromEntries(FIELDS.filter((k) => fields[k] !== undefined && k !== "title").map((k) => [k, fields[k]])), ...(spec ? { spec } : {}) };
  if (!body.kind) body.kind = origin === "upload" ? "photo" : "graphic";
  const row = await E.create(ctx, "media_items", body);
  try {
    const att = addFile(ctx, { entity: "media_items", id: row.id, name: name || `${row.title}.${info.mime.split("/")[1].replace("svg+xml", "svg")}`, mime: info.mime, buffer });
    return await E.update(ctx, "media_items", row.id, { attachment_id: att.id, width: info.w || null, height: info.h || null, origin }, { internal: true });
  } catch (e) { await E.remove?.(ctx, "media_items", row.id).catch(() => {}); throw e; }
}

/** Draws a graphic from a spec with the programme's brand and stores it (PNG, so it works in every export; SVG when no rasteriser is available). */
export async function saveGraphic(ctx, { program_id, spec, svg, title, caption, lang, brand_id, ...fields }) {
  const brand = resolveBrand(brandRowFor(ctx, brand_id) || {}), l = lang || ctx.lang || "es";
  const g = svg ? { svg: String(svg), width: 0, height: 0, title: title || "Gráfico", type: "custom" } : await renderGraphic(ctx, spec, { brand, lang: l });
  const png = await svgToPng(g.svg, Math.min(2400, Math.max(1200, g.width * 2 || 1600)));
  return addMedia(ctx, { program_id, name: `${(title || g.title || "grafico").replace(/[^\p{L}\p{N} ._-]/gu, "")}.${png ? "png" : "svg"}`, buffer: png || Buffer.from(g.svg, "utf8"), origin: fields.origin || "generated", spec: spec || undefined, title: title || g.title, caption, kind: fields.kind || "graphic", ...fields, origin: fields.origin || "generated" });
}

export { imageFor };
