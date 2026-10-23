// Module M — project memoirs: the image gallery, shoot locations and the memoirs written section by section (see lib/memoir-catalog.mjs for the sections and their fields).
import { f, req, ro } from "./dsl.mjs";

export const MEDIA_KINDS = ["photo", "still", "behind_scenes", "graphic", "screenshot", "press", "logo", "document", "other"];
export const MEDIA_PHASES = ["shoot", "development", "preproduction", "post", "delivery", "broadcast", "promotion", "other"];
export const MEMOIR_KINDS = ["subsidy", "annual", "client", "season_close", "festival", "internal"];

export default {
  media_items: {
    module: "prod", title: ["title"], icon: "image", group: "memoirs", program: "program_id", parent: "program_id",
    list: ["title", "kind", "phase", "episode_id", "shot_date", "featured", "rights"], sort: "-featured,position,-id", search: ["title", "caption", "credit", "people", "tags"],
    fields: {
      program_id: req(f.ref("programs", { cascade: true })), episode_id: f.ref("episodes"), title: req(f.text()), kind: f.enm(MEDIA_KINDS), phase: f.enm(MEDIA_PHASES, { default: "other" }),
      caption: f.long({ max: 1000, help: "caption printed under the image" }), alt_text: f.text({ max: 300, help: "describes the image for screen readers" }), credit: f.text({ max: 120, help: "author / photographer" }),
      shot_date: f.date(), location_id: f.ref("locations"), people: f.text({ max: 300, help: "who appears" }),
      rights: f.enm(["owned", "licensed", "release_pending", "restricted"]), rights_note: f.text({ max: 300 }), tags: f.tags(), featured: f.bool(), position: f.int({ default: 0 }),
      attachment_id: ro(f.int({ help: "the image file (attachment of this row)" })), width: ro(f.int()), height: ro(f.int()),
      origin: ro(f.enm(["upload", "agent", "generated"])), spec: f.json({ help: "graphic spec, when the image was generated" }),
    },
  },

  locations: {
    module: "prod", title: ["name"], icon: "pin", group: "memoirs", program: "program_id", parent: "program_id",
    list: ["name", "kind", "city", "country", "shoot_days", "date_from"], sort: "program_id,name", search: ["name", "address", "city", "description"],
    fields: {
      program_id: req(f.ref("programs", { cascade: true })), name: req(f.text()), kind: f.enm(["exterior", "studio", "interior", "remote", "other"]), address: f.text({ max: 300 }), city: f.text({ max: 120 }), country: f.text({ max: 120 }),
      lat: f.num({ min: -90, max: 90 }), lng: f.num({ min: -180, max: 180 }), date_from: f.date(), date_to: f.date(), shoot_days: f.int({ min: 0 }), description: f.long({ max: 3000 }),
      permit: f.text({ max: 300, help: "permit or authorisation" }), contact: f.text({ max: 300 }),
    },
  },

  memoirs: {
    module: "prod", title: ["title"], icon: "book", group: "memoirs", program: "program_id", parent: "program_id",
    list: ["title", "kind", "status", "language", "period_start", "period_end", "funder"], sort: "-updated", search: ["title", "funder", "brief"],
    fields: {
      program_id: req(f.ref("programs", { cascade: true })), season_id: f.ref("seasons"), title: req(f.text()), kind: f.enm(MEMOIR_KINDS, { default: "annual" }), language: f.enm(["es", "ca", "en"]),
      status: f.enm(["draft", "writing", "review", "approved", "delivered"]), period_start: f.date(), period_end: f.date(), funder: f.text({ max: 200, help: "who receives it (funder, broadcaster, client)" }), funder_ref: f.text({ max: 120, help: "file or call reference" }),
      audience_note: f.text({ max: 300, help: "who reads it and what they look for" }), tone: f.enm(["institutional", "narrative", "technical"]), brief: f.long({ max: 6000, help: "instructions for whoever writes it (person or agent)" }),
      brand_id: f.ref("brands"), cover_media_id: f.ref("media_items"), document_id: ro(f.ref("documents")), built_at: ro(f.datetime()),
    },
  },

  memoir_sections: {
    module: "prod", title: ["title"], icon: "doc", group: "memoirs", program: "program_id", parent: "memoir_id", hidden: true,
    list: ["memoir_id", "position", "key", "title", "status"], sort: "memoir_id,position", search: ["title", "body"],
    fields: {
      program_id: f.ref("programs", { cascade: true }), memoir_id: req(f.ref("memoirs", { cascade: true })), key: req(f.text({ max: 60 })), title: f.text({ max: 200 }), position: f.int({ default: 0 }),
      status: f.enm(["empty", "draft", "review", "approved", "skipped"]), body: f.long({ max: 60000, help: "Collado Markdown" }), fields: f.json({ help: "structured fields of the section (see the catalogue)" }),
      media_ids: f.json({ help: "gallery images of the section" }), visuals: f.json({ help: "graphics of the section: [{type, ...spec}]" }), agent_brief: f.long({ max: 3000 }), notes: f.long({ max: 3000 }),
      author: f.text({ max: 80 }), origin: f.enm(["human", "agent"]),
    },
  },
};
