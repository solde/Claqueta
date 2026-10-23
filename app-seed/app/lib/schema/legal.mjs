// Module E — contracts, rights (formats, music, archive, talent), cue sheets, GDPR (processing register, consents, data-subject requests, retention).
import { f, req, legalSensitive } from "./dsl.mjs";

export default {
  contracts: {
    module: "legal", title: ["title"], icon: "contract", group: "legal", program: "program_id",
    list: ["title", "type", "party", "program_id", "status", "start_date", "end_date", "value"], sort: "end_date", search: ["title", "party", "notes"],
    calendar: { start: "end_date", label: "title" },
    fields: {
      title: req(f.text()), type: f.enm(["crew", "talent", "guest", "supplier", "network", "sponsorship", "format_license", "music", "archive", "image_release", "rights_assignment", "nda", "other"]),
      status: f.enm(["draft", "signing", "active", "expired", "terminated"]),
      party: f.text({ max: 200, help: "counterparty name (free text if not in the directory)" }), person_id: f.ref("people"), partner_id: f.ref("partners"),
      program_id: f.ref("programs"), episode_id: f.ref("episodes"),
      signed_date: f.date(), start_date: f.date(), end_date: f.date(), auto_renew: f.bool(), notice_days: f.int({ default: 30, min: 0, max: 730, help: "days of notice before expiry to raise an alert" }),
      value: f.money({ perm: { read: "fin.view", write: "legal.edit" } }), payment_terms: f.text({ max: 300 }),
      exclusivity: f.bool(), territory: f.text({ max: 300 }), contains_personal_data: f.bool({ default: 1 }), minors_involved: f.bool(),
      summary: f.long({ max: 6000 }), key_terms: f.long({ max: 6000, perm: legalSensitive }), notes: f.long({ max: 4000 }),
    },
  },

  rights: {
    module: "legal", title: ["title"], icon: "key", group: "legal", program: "program_id",
    list: ["title", "kind", "holder", "media", "territory", "window_start", "window_end", "status"], sort: "window_end", search: ["title", "holder", "territory", "notes"],
    calendar: { start: "window_start", end: "window_end", label: "title" },
    fields: {
      title: req(f.text()), kind: f.enm(["format", "music", "archive", "talent_image", "footage", "script", "other"]),
      holder: f.text({ max: 200, help: "rights holder / licensor" }), partner_id: f.ref("partners"), person_id: f.ref("people"), contract_id: f.ref("contracts"),
      program_id: f.ref("programs"), episode_id: f.ref("episodes"),
      media: f.enm(["all", "tv", "radio", "online", "festival", "internal"]), territory: f.text({ max: 300, default: "ES" }),
      languages: f.text({ max: 120 }), exclusivity: f.enm(["none", "semi", "exclusive"]),
      window_start: f.date(), window_end: f.date(), perpetual: f.bool(), max_runs: f.int({ min: 0 }), runs_used: f.int({ default: 0, min: 0 }),
      fee: f.money({ perm: { read: "fin.view", write: "legal.edit" } }), status: f.enm(["negotiating", "cleared", "restricted", "expired"], { default: "cleared" }),
      restrictions: f.long({ max: 4000 }), notes: f.long({ max: 4000 }),
    },
  },

  cue_sheets: {
    module: "legal", title: ["title"], icon: "music", group: "legal", program: "program_id", parent: "episode_id",
    list: ["title", "episode_id", "status", "total_music_sec"], sort: "-created", search: ["title"],
    fields: {
      episode_id: req(f.ref("episodes", { cascade: true })), program_id: f.ref("programs"), title: req(f.text()),
      status: f.enm(["draft", "ready", "submitted"]), society: f.text({ max: 80, default: "SGAE" }), submitted_at: f.date(), reference: f.text({ max: 80 }),
      total_music_sec: f.int({ ro: true }), notes: f.long({ max: 2000 }),
    },
  },

  cue_items: {
    module: "legal", title: ["title"], icon: "music", group: "legal", parent: "cue_sheet_id", program: "program_id",
    list: ["position", "title", "composer", "publisher", "usage", "duration_sec", "tc_in"], sort: "cue_sheet_id,position", search: ["title", "composer", "publisher", "performer"],
    fields: {
      cue_sheet_id: req(f.ref("cue_sheets", { cascade: true })), program_id: f.ref("programs"), position: f.int({ default: 0 }),
      title: req(f.text()), composer: f.text({ max: 300 }), author: f.text({ max: 300 }), publisher: f.text({ max: 300 }), performer: f.text({ max: 300 }),
      label: f.text({ max: 200 }), library: f.text({ max: 200 }), isrc: f.text({ max: 20 }), iswc: f.text({ max: 20 }),
      usage: f.enm(["bi", "bv", "vi", "vv", "theme", "jingle", "logo", "other"]), tc_in: f.text({ max: 12 }), duration_sec: f.int({ default: 0, min: 0 }),
      society: f.text({ max: 80 }), share_pct: f.pct({ default: 100 }), right_id: f.ref("rights"), notes: f.text({ max: 500 }),
    },
  },

  processing_activities: {
    module: "legal", title: ["name"], icon: "shield", group: "gdpr",
    list: ["name", "purpose", "legal_basis", "retention_months", "owner", "review_date"], sort: "name", search: ["name", "purpose", "data_categories"],
    fields: {
      name: req(f.text()), purpose: f.long({ max: 2000 }), legal_basis: f.enm(["consent", "contract", "legal_obligation", "legitimate_interest", "public_interest", "vital_interest"]),
      data_categories: f.long({ max: 2000 }), data_subjects: f.long({ max: 1000 }), recipients: f.long({ max: 1000 }), international_transfers: f.long({ max: 1000 }),
      retention_months: f.int({ default: 60, min: 0, max: 1200 }), security_measures: f.long({ max: 2000 }), owner: f.text({ max: 120 }),
      dpia_required: f.bool(), review_date: f.date(), notes: f.long({ max: 2000 }),
    },
  },

  consents: {
    module: "legal", title: ["subject", "kind"], icon: "shield", group: "gdpr", program: "program_id",
    list: ["subject", "kind", "program_id", "status", "granted_date", "expires"], sort: "expires", search: ["subject", "notes"],
    calendar: { start: "expires", label: "subject" },
    fields: {
      subject: req(f.text({ max: 200, help: "person (or guardian for minors)" })), person_id: f.ref("people"), program_id: f.ref("programs"), episode_id: f.ref("episodes"),
      kind: f.enm(["image", "data", "minor_guardian", "marketing", "voice"]), status: f.enm(["granted", "revoked", "expired", "pending"]),
      granted_date: f.date(), expires: f.date(), minor: f.bool(), contract_id: f.ref("contracts"), notes: f.long({ max: 2000 }),
    },
  },

  dsr_requests: {
    module: "legal", title: ["requester", "kind"], icon: "inbox", group: "gdpr",
    list: ["requester", "kind", "received", "due", "status"], sort: "due", search: ["requester", "notes"],
    calendar: { start: "due", label: "requester" },
    fields: {
      requester: req(f.text({ max: 200 })), kind: f.enm(["access", "rectification", "erasure", "portability", "objection", "restriction"]),
      received: req(f.date()), due: f.date({ help: "one month from reception unless extended" }), status: f.enm(["received", "in_progress", "resolved", "rejected"]),
      resolution: f.long({ max: 4000 }), handled_by: f.text({ max: 120 }), notes: f.long({ max: 3000 }),
    },
  },

  retention_policies: {
    module: "legal", title: ["name"], icon: "archive", group: "gdpr",
    list: ["name", "entity", "months", "date_field", "action"], sort: "name", search: ["name", "entity"],
    fields: {
      name: req(f.text()), entity: req(f.text({ max: 40 })), filter: f.text({ max: 300, help: "SQL condition, e.g. status = 'expired'" }),
      date_field: f.text({ max: 40, default: "updated" }), months: req(f.int({ default: 60, min: 1, max: 1200 })), action: f.enm(["review", "anonymize", "delete"]), notes: f.long({ max: 1000 }),
    },
  },
};
