// Documents, brands (visual identity), document templates, generated files, agent jobs, app users.
import { f, req } from "./dsl.mjs";

/** Document types (format, bible, rundown, script, dossier, audience study, contract, report...) used by documents and templates. */
export const DOC_TYPES = ["format", "bible", "rundown", "script", "dossier", "audience", "target", "competitor", "production", "marketing", "report", "contract", "callsheet", "budget", "delivery", "minutes", "other"];

export default {
  documents: {
    module: "prod", title: ["title"], icon: "doc", group: "docs", program: "program_id", parent: "program_id",
    list: ["title", "type", "program_id", "status", "language", "updated"], sort: "-updated", search: ["title", "content", "tags"],
    ext: { read: true, where: "shared = 1" },
    fields: {
      program_id: f.ref("programs", { cascade: true }), episode_id: f.ref("episodes"), title: req(f.text()),
      type: f.enm(DOC_TYPES, { default: "other" }), status: f.enm(["draft", "review", "approved", "final"]), language: f.enm(["es", "ca", "en"]),
      content: f.long({ max: 600000, help: "Markdown with Claqueta directives" }), template_id: f.ref("doc_templates"), brand_id: f.ref("brands"),
      vars: f.json({ help: "values for the template variables" }), options: f.json({ help: "layout overrides (page size, cover, toc...)" }),
      tags: f.tags(), shared: f.bool({ help: "visible to external members of the programme" }), version: f.int({ default: 1, ro: true }),
    },
  },

  doc_versions: {
    module: "prod", title: ["title"], icon: "doc", group: "docs", parent: "document_id", noHistory: true, hidden: true,
    list: ["document_id", "version", "created_by", "created"], sort: "-created",
    fields: { document_id: req(f.ref("documents", { cascade: true })), version: f.int(), title: f.text(), content: f.long({ max: 600000 }), note: f.text({ max: 300 }) },
  },

  brands: {
    module: "prod", title: ["name"], icon: "palette", group: "docs",
    list: ["name", "primary", "accent", "font_heading", "font_body", "cover"], sort: "name", search: ["name"],
    fields: {
      name: req(f.text({ unique: true })), description: f.text({ max: 500 }),
      primary: f.text({ max: 9, default: "#1f3a5f", format: "color" }), accent: f.text({ max: 9, default: "#e0a100", format: "color" }),
      text_color: f.text({ max: 9, default: "#1c1f24", format: "color" }), muted: f.text({ max: 9, default: "#6b7280", format: "color" }),
      bg: f.text({ max: 9, default: "#ffffff", format: "color" }), table_head_bg: f.text({ max: 9, default: "", format: "color" }), table_stripe: f.text({ max: 9, default: "#f4f6f8", format: "color" }),
      font_heading: f.text({ max: 80, default: "Inter" }), font_body: f.text({ max: 80, default: "Inter" }), font_mono: f.text({ max: 80, default: "DejaVu Sans Mono" }),
      font_files: f.json({ help: "[{family, weight, style, attachment_id}] custom fonts (uploaded as attachments)" }),
      base_size: f.num({ default: 10.5, min: 7, max: 16, help: "pt" }), line_height: f.num({ default: 1.45, min: 1, max: 2.5 }),
      logo_attachment_id: f.int({ help: "attachment id of the logo (png/svg/jpg)" }), logo_height_mm: f.int({ default: 14, min: 4, max: 60 }),
      page_size: f.enm(["A4", "A3", "Letter", "Legal"]), orientation: f.enm(["portrait", "landscape"]), margin_mm: f.json({ help: "{top,right,bottom,left}" }),
      cover: f.enm(["band", "none", "full", "minimal", "split"], { default: "band" }), header_text: f.text({ max: 300, default: "{{brand}} · {{title}}" }),
      footer_text: f.text({ max: 300, default: "{{confidentiality}} · {{date}}" }), page_numbers: f.bool({ default: 1 }), heading_numbering: f.bool(),
      watermark: f.text({ max: 40, help: "e.g. DRAFT; empty = none" }), confidentiality: f.text({ max: 80, default: "Confidencial" }),
      legal_footer: f.long({ max: 1000 }), custom_css: f.long({ max: 20000, help: "appended to the generated stylesheet (HTML/PDF)" }),
      is_default: f.bool(),
    },
  },

  doc_templates: {
    module: "prod", title: ["name"], icon: "template", group: "docs",
    list: ["name", "type", "language", "brand_id", "builtin"], sort: "name", search: ["name", "description", "body"],
    fields: {
      name: req(f.text()), type: f.enm(["format", "bible", "rundown", "script", "dossier", "audience", "target", "competitor", "production", "marketing", "report", "contract", "callsheet", "budget", "delivery", "minutes", "other"], { default: "other" }),
      language: f.enm(["es", "ca", "en"]), description: f.text({ max: 600 }), brand_id: f.ref("brands"),
      body: f.long({ max: 300000, help: "Markdown + {{variables}} + data blocks" }),
      variables: f.json({ help: "[{key,label,type,default}] shown as a form when generating" }), options: f.json({ help: "layout overrides" }),
      builtin: f.bool({ ro: true }), key: f.text({ max: 60, ro: true }),
    },
  },

  exports: {
    module: "prod", title: ["name"], icon: "download", group: "docs", program: "program_id", noHistory: true,
    list: ["name", "format", "program_id", "created_by", "created"], sort: "-created", search: ["name"],
    fields: {
      name: req(f.text()), format: f.text({ max: 10 }), program_id: f.ref("programs", { cascade: true }), document_id: f.ref("documents"),
      attachment_id: f.int(), bytes: f.int(), notes: f.text({ max: 500 }),
    },
  },

  jobs: {
    module: "prod", title: ["kind"], icon: "robot", group: "agent", program: "program_id", parent: "program_id", noHistory: true,
    list: ["kind", "program_id", "status", "by", "created", "finished"], sort: "-created", search: ["kind", "prompt"],
    fields: {
      program_id: f.ref("programs", { cascade: true }), kind: req(f.text({ max: 40 })), prompt: f.long({ max: 20000 }), extra: f.long({ max: 5000 }),
      status: f.enm(["queued", "running", "done", "failed", "cancelled"]), output: f.long({ max: 600000, ro: true }), document_id: f.ref("documents", { ro: true }),
      error: f.long({ max: 5000, ro: true }), finished: f.datetime({ ro: true }), by: f.text({ ro: true, max: 120 }),
    },
  },
};
