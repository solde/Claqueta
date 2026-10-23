// Module A/B/I — programmes, seasons, episodes, planning, tasks, collaboration.
import { f, req } from "./dsl.mjs";

const DESKTOP = process.env.COLLADO_DESKTOP === "1";   // projects have their own local folder only in the desktop build
/** Kinds of programme (format families) that workflow templates and defaults are keyed by. */
export const PROGRAM_KINDS = ["magazine", "news", "gameshow", "documentary", "live_radio", "podcast", "series", "entertainment", "other"];
/** Lifecycle of an episode, in order: planned, script, recorded, edited, qc, delivered, aired. */
export const EPISODE_STATUS = ["planned", "script", "recorded", "edited", "qc", "delivered", "aired"];

export default {
  partners: {
    module: "prod", title: ["name"], icon: "building", group: "directory",
    list: ["name", "kind", "vat_id", "contact_name", "email"], sort: "name", search: ["name", "vat_id", "contact_name", "email"],
    fields: {
      name: req(f.text()),
      kind: f.enm(["channel", "client", "supplier", "sponsor", "society", "authority", "producer", "other"]),
      vat_id: f.text({ max: 40 }),
      address: f.long({ max: 1000 }), country: f.text({ max: 60 }),
      contact_name: f.text(), email: f.email(), phone: f.text({ max: 40 }), web: f.url(),
      payment_days: f.int({ default: 30, min: 0, max: 365 }),
      iban: f.secret({ perm: { read: "fin.view", write: "fin.edit" } }),
      active: f.bool({ default: 1 }),
      notes: f.long({ max: 5000 }),
    },
  },

  workflow_templates: {
    module: "prod", title: ["name"], icon: "flow", group: "settings",
    list: ["name", "kind", "description"], sort: "name", search: ["name", "description"],
    fields: {
      name: req(f.text()), kind: f.enm(["magazine", "news", "gameshow", "documentary", "live_radio", "podcast", "series", "entertainment", "other"]),
      description: f.long({ max: 2000 }),
      milestones: f.json({ help: "[{title, offset_days, duration_days, kind, after:[index]}] relative to the programme start; offsets from the episode air date are negative" }),
      tasks: f.json({ help: "[{title, offset_days, priority}]" }),
      episode_pipeline: f.json({ help: "[{status, days_before_air}] deadlines per episode status" }),
      budget_template_id: f.ref("budgets", { filter: { kind: "template" } }),
      checklist: f.json({ help: "delivery/compliance checklist items" }),
    },
  },

  programs: {
    module: "prod", title: ["name"], icon: "tv", group: "programs", program: "id",
    list: ["name", "kind", "channel_id", "status", "start_date"], sort: "name", search: ["name", "code", "logline", "genre"],
    board: { field: "status" },
    ext: { read: true },
    sections: [
      { key: "main", fields: ["name", ...(DESKTOP ? ["folder"] : []), "code", "kind", "status", "channel_id", "client_id", "logline", "genre", "format_desc", "language", "color"] },
      { key: "schedule", fields: ["start_date", "end_date", "duration_min", "episodes_per_season", "slot_desc", "template_id"] },
      { key: "money", fields: ["contract_value", "currency"] },
      { key: "team", fields: ["producer", "executive", "notes"] },
    ],
    fields: {
      name: req(f.text()), code: f.text({ max: 20, unique: true }),
      kind: f.enm(["magazine", "news", "gameshow", "documentary", "live_radio", "podcast", "series", "entertainment", "other"]),
      status: f.enm(["development", "active", "paused", "closed"]),
      channel_id: f.ref("partners", { filter: { kind: "channel" }, help: "network / broadcaster" }),
      client_id: f.ref("partners", { help: "who is invoiced, if not the network" }),
      logline: f.long({ max: 1000 }), genre: f.text({ max: 80 }), format_desc: f.long({ max: 8000 }),
      language: f.enm(["es", "ca", "en", "other"]), color: f.text({ max: 9, format: "color", default: "#2b6cb0" }),
      ...(DESKTOP ? { folder: req(f.folder({ help: "Carpeta de este equipo donde el proyecto guarda sus archivos (distinta para cada proyecto). El gestor de archivos se abre aquí." })) } : {}),
      start_date: f.date(), end_date: f.date(), duration_min: f.int({ min: 0, max: 1000 }),
      episodes_per_season: f.int({ min: 0, max: 1000 }), slot_desc: f.text({ max: 200 }),
      template_id: f.ref("workflow_templates"),
      contract_value: f.money({ perm: { read: "fin.view", write: "fin.edit" }, help: "agreed price with the network/client (excl. VAT)" }),
      currency: f.text({ max: 3, default: "EUR" }),
      producer: f.text({ max: 120 }), executive: f.text({ max: 120 }),
      notes: f.long({ max: 8000 }),
    },
  },

  seasons: {
    module: "prod", title: ["name"], icon: "layers", group: "programs", program: "program_id", parent: "program_id",
    list: ["program_id", "number", "name", "status", "start_date", "end_date", "episodes_planned"], sort: "program_id,number", search: ["name"],
    ext: { read: true },
    fields: {
      program_id: req(f.ref("programs", { cascade: true })), number: f.int({ default: 1, min: 0, max: 999 }), name: f.text(),
      status: f.enm(["planning", "production", "delivered", "aired", "closed"]),
      start_date: f.date(), end_date: f.date(), air_start: f.date(), episodes_planned: f.int({ min: 0, max: 1000 }), notes: f.long({ max: 5000 }),
    },
  },

  episodes: {
    module: "prod", title: ["number", "title"], titlePrefix: "E", icon: "film", group: "programs", program: "program_id", parent: "program_id",
    list: ["program_id", "number", "title", "status", "shoot_date", "air_date"], sort: "program_id,season_id,number", search: ["title", "synopsis"],
    board: { field: "status" }, calendar: { start: "air_date", label: "title" },
    ext: { read: true },
    sections: [
      { key: "main", fields: ["program_id", "season_id", "number", "title", "status", "synopsis", "responsible"] },
      { key: "dates", fields: ["shoot_date", "edit_due", "delivery_due", "air_date", "duration_target", "duration_actual"] },
      { key: "extra", fields: ["notes"] },
    ],
    fields: {
      program_id: req(f.ref("programs", { cascade: true })), season_id: f.ref("seasons"),
      number: f.int({ default: 1, min: 0, max: 99999 }), title: f.text(),
      status: f.enm(["planned", "script", "recorded", "edited", "qc", "delivered", "aired"]),
      synopsis: f.long({ max: 8000 }), responsible: f.text({ max: 120 }),
      shoot_date: f.date(), edit_due: f.date(), delivery_due: f.date(), air_date: f.date(),
      duration_target: f.int({ min: 0, max: 100000, help: "seconds" }), duration_actual: f.int({ min: 0, max: 100000, help: "seconds" }),
      notes: f.long({ max: 8000 }),
    },
  },

  milestones: {
    module: "prod", title: ["title"], icon: "flag", group: "planning", program: "program_id", parent: "program_id",
    list: ["program_id", "title", "kind", "start_date", "end_date", "status", "owner"], sort: "start_date", search: ["title", "owner"],
    board: { field: "status" }, calendar: { start: "start_date", end: "end_date", label: "title" },
    fields: {
      program_id: req(f.ref("programs", { cascade: true })), season_id: f.ref("seasons"), episode_id: f.ref("episodes"),
      title: req(f.text()), kind: f.enm(["phase", "milestone"]),
      start_date: req(f.date()), end_date: f.date(), progress: f.pct({ default: 0 }),
      status: f.enm(["todo", "doing", "done", "blocked"]), owner: f.text({ max: 120 }),
      depends_on: f.json({ help: "array of milestone ids this one depends on" }), notes: f.long({ max: 3000 }),
    },
  },

  tasks: {
    module: "prod", title: ["title"], icon: "check", group: "collab", program: "program_id", parent: "program_id",
    list: ["title", "program_id", "status", "priority", "assignee", "due"], sort: "due", search: ["title", "notes", "assignee"],
    board: { field: "status" }, calendar: { start: "due", label: "title" },
    ext: { read: true, where: "assignee = :user", write: "assignee = :user", writeFields: ["status", "notes"] },
    offline: ["status", "notes"],
    fields: {
      program_id: f.ref("programs", { cascade: true }), episode_id: f.ref("episodes"),
      title: req(f.text()), status: f.enm(["todo", "doing", "review", "done"]), priority: f.enm(["low", "medium", "high"], { default: "medium" }),
      assignee: f.text({ max: 120, help: "gateway username of the person responsible" }), due: f.date(), notes: f.long({ max: 8000 }),
      related_entity: f.text({ max: 40 }), related_id: f.int(),
    },
  },

  comments: {
    module: "prod", title: ["body"], icon: "chat", group: "collab", program: "program_id", noHistory: true,
    list: ["entity", "row_id", "body", "created_by", "created"], sort: "-created", search: ["body"],
    ext: { read: true, write: true },
    fields: {
      entity: req(f.text({ max: 40 })), row_id: req(f.int()), program_id: f.ref("programs", { cascade: true }),
      body: req(f.long({ max: 10000 })), mentions: f.tags(),
    },
  },

  approvals: {
    module: "prod", title: ["subject"], icon: "stamp", group: "collab", program: "program_id", parent: "program_id",
    list: ["subject", "kind", "program_id", "approver", "status", "due"], sort: "-created", search: ["subject", "approver", "comment"],
    ext: { read: true, where: "approver = :user OR requested_by = :user", write: "approver = :user", writeFields: ["status", "comment"] },
    fields: {
      program_id: f.ref("programs", { cascade: true }), episode_id: f.ref("episodes"),
      entity: req(f.text({ max: 40 })), row_id: req(f.int()), subject: req(f.text()),
      kind: f.enm(["editorial", "network", "legal", "financial", "client", "internal"]),
      status: f.enm(["pending", "approved", "rejected", "changes"]),
      requested_by: f.text({ max: 120 }), approver: f.text({ max: 120, help: "username (internal or external)" }), due: f.date(),
      comment: f.long({ max: 5000 }), decided_at: f.datetime({ ro: true }), decided_by: f.text({ ro: true, max: 120 }),
    },
  },

  notifications: {
    module: "own", title: ["title"], icon: "bell", group: "collab", noHistory: true,
    list: ["title", "body", "created", "read"], sort: "-created",
    fields: {
      user: req(f.text({ max: 120 })), title: req(f.text()), body: f.long({ max: 2000 }), link: f.text({ max: 300 }),
      kind: f.text({ max: 40 }), key: f.text({ max: 200, unique: true }), read: f.bool(),
    },
  },

  members: {
    module: "prod", title: ["username"], icon: "users", group: "collab", program: "program_id", parent: "program_id", adminOnly: true,
    list: ["program_id", "username", "side", "can_comment"], sort: "program_id,username", search: ["username", "org"],
    fields: {
      program_id: req(f.ref("programs", { cascade: true })), username: req(f.text({ max: 60, help: "gateway username (role «externo»)" })),
      side: f.enm(["network", "freelance", "supplier", "client", "other"]), org: f.text({ max: 120 }), can_comment: f.bool({ default: 1 }),
      sees_budget: f.bool({ help: "may see budget summaries (read-only)" }),
    },
  },

  rundown_items: {
    module: "prod", title: ["title"], icon: "list", group: "planning", program: "program_id", parent: "episode_id",
    list: ["position", "block", "title", "kind", "duration_sec", "responsible"], sort: "episode_id,position", search: ["title", "block", "content"],
    ext: { read: true },
    fields: {
      program_id: f.ref("programs", { cascade: true }), episode_id: req(f.ref("episodes", { cascade: true })),
      position: f.int({ default: 0 }), block: f.text({ max: 80 }), title: req(f.text()),
      kind: f.enm(["intro", "studio", "interview", "report", "game", "music", "ad", "promo", "break", "closing", "other"]),
      duration_sec: f.int({ default: 60, min: 0, max: 36000 }), responsible: f.text({ max: 120 }), location: f.text({ max: 120 }),
      fixed_time: f.time({ help: "hard-set clock time (live shows)" }), content: f.long({ max: 50000 }), media_ref: f.text({ max: 300 }), notes: f.long({ max: 3000 }),
      status: f.enm(["draft", "ready", "locked", "done"]),
    },
  },

  risks: {
    module: "prod", title: ["title"], icon: "alert", group: "reports", program: "program_id", parent: "program_id",
    list: ["title", "program_id", "category", "probability", "impact", "status", "owner"], sort: "-score",
    search: ["title", "mitigation", "owner"],
    fields: {
      program_id: f.ref("programs", { cascade: true }), title: req(f.text()),
      category: f.enm(["economic", "legal", "human", "technical", "editorial", "commercial", "other"]),
      probability: f.int({ default: 3, min: 1, max: 5 }), impact: f.int({ default: 3, min: 1, max: 5 }), score: f.int({ ro: true }),
      status: f.enm(["open", "mitigated", "accepted", "closed"]), owner: f.text({ max: 120 }), mitigation: f.long({ max: 4000 }), review_date: f.date(),
    },
  },
};
