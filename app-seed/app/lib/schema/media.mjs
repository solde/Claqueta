// Modules F/G — assets (light MAM: metadata + link to real storage), delivery specs, QC, issues, delivery packages, editorial compliance.
import { f, req } from "./dsl.mjs";

export default {
  assets: {
    module: "prod", title: ["title"], icon: "reel", group: "content", program: "program_id", parent: "episode_id",
    list: ["title", "kind", "episode_id", "version", "status", "codec", "duration_sec", "location_kind"], sort: "-updated", search: ["title", "uri", "tags", "description", "checksum"],
    ext: { read: false },
    fields: {
      title: req(f.text()), program_id: f.ref("programs"), season_id: f.ref("seasons"), episode_id: f.ref("episodes"),
      kind: f.enm(["raw", "edit", "master", "audio", "graphic", "script", "subtitle", "still", "music", "other"]),
      version: f.text({ max: 20, default: "v1" }), status: f.enm(["ingest", "working", "approved", "archived", "deleted"]), description: f.long({ max: 3000 }),
      location_kind: f.enm(["nas", "cloud", "tape", "url", "local", "other"]), uri: f.text({ max: 1000, help: "path / URL / tape id (the app never stores the video)" }),
      container: f.text({ max: 20 }), codec: f.text({ max: 60 }), resolution: f.text({ max: 20 }), fps: f.text({ max: 12 }), audio: f.text({ max: 60 }),
      duration_sec: f.int({ min: 0 }), size_mb: f.int({ min: 0 }), checksum: f.text({ max: 128 }), language: f.text({ max: 20 }),
      shot_at: f.date(), tags: f.tags(), right_id: f.ref("rights"), retention_until: f.date(), notes: f.long({ max: 2000 }),
    },
  },

  delivery_specs: {
    module: "prod", title: ["name"], icon: "spec", group: "quality",
    list: ["name", "partner_id", "container", "video_codec", "resolution", "loudness"], sort: "name", search: ["name", "notes"],
    ext: { read: true },
    fields: {
      name: req(f.text()), partner_id: f.ref("partners"), container: f.text({ max: 30, default: "MXF" }), video_codec: f.text({ max: 60, default: "XDCAM HD422 50" }),
      resolution: f.text({ max: 30, default: "1920x1080" }), fps: f.text({ max: 12, default: "25p" }), scan: f.text({ max: 20 }), colorspace: f.text({ max: 40, default: "Rec.709" }),
      audio_layout: f.text({ max: 120, default: "Stereo + M&E" }), loudness: f.text({ max: 60, default: "-23 LUFS (EBU R128)" }), true_peak: f.text({ max: 20, default: "-1 dBTP" }),
      subtitles: f.text({ max: 200 }), duration_rule: f.text({ max: 200 }), naming: f.text({ max: 200 }), delivery_method: f.text({ max: 200 }),
      checklist: f.json({ help: "[{id,label,category,required}]" }), notes: f.long({ max: 4000 }),
    },
  },

  qc_reports: {
    module: "prod", title: ["episode_id", "version"], icon: "check", group: "quality", program: "program_id", parent: "episode_id",
    list: ["date", "episode_id", "version", "spec_id", "result", "performed_by"], sort: "-date", search: ["notes", "performed_by"],
    offline: ["checks", "notes", "result"],
    ext: { read: true },
    fields: {
      episode_id: req(f.ref("episodes", { cascade: true })), program_id: f.ref("programs"), asset_id: f.ref("assets"), spec_id: f.ref("delivery_specs"),
      version: f.text({ max: 20, default: "v1" }), date: req(f.date()), performed_by: f.text({ max: 120 }),
      checks: f.json({ help: "{item_id: {ok:true|false|null, note}}" }), result: f.enm(["pass", "pass_notes", "fail"]), notes: f.long({ max: 4000 }),
    },
  },

  qc_issues: {
    module: "prod", title: ["description"], icon: "bug", group: "quality", program: "program_id", parent: "episode_id",
    list: ["episode_id", "severity", "description", "tc", "status", "assigned"], sort: "-created", search: ["description", "assigned"],
    board: { field: "status" }, offline: ["status", "notes"],
    ext: { read: true },
    fields: {
      episode_id: req(f.ref("episodes", { cascade: true })), program_id: f.ref("programs"), qc_id: f.ref("qc_reports"), asset_id: f.ref("assets"),
      severity: f.enm(["low", "medium", "high", "blocker"]), description: req(f.long({ max: 2000 })), tc: f.text({ max: 12 }),
      status: f.enm(["open", "in_progress", "resolved", "wontfix"]), assigned: f.text({ max: 120 }), resolved_at: f.datetime({ ro: true }), notes: f.long({ max: 2000 }),
    },
  },

  deliveries: {
    module: "prod", title: ["episode_id", "version"], icon: "truck", group: "quality", program: "program_id", parent: "episode_id",
    list: ["episode_id", "version", "partner_id", "spec_id", "status", "sent_at", "accepted_at"], sort: "-created", search: ["tracking_ref", "notes"],
    ext: { read: true },
    fields: {
      episode_id: req(f.ref("episodes", { cascade: true })), program_id: f.ref("programs"), partner_id: f.ref("partners"), spec_id: f.ref("delivery_specs"),
      version: f.text({ max: 20, default: "v1" }), status: f.enm(["preparing", "sent", "accepted", "rejected"]),
      items: f.json({ help: "[{asset_id,name,size_mb,checksum}] frozen at send time" }), checklist_state: f.json(), method: f.text({ max: 200 }), tracking_ref: f.text({ max: 120 }),
      sent_at: f.datetime({ ro: true }), sent_by: f.text({ ro: true, max: 120 }), accepted_at: f.datetime(), manifest_hash: f.text({ ro: true, max: 128 }), notes: f.long({ max: 3000 }),
    },
  },

  editorial_lines: {
    module: "prod", title: ["title"], icon: "pen", group: "quality", program: "program_id", parent: "program_id",
    list: ["title", "program_id", "approved"], sort: "program_id,title", search: ["title", "body"],
    fields: {
      program_id: f.ref("programs", { cascade: true }), title: req(f.text()), body: f.long({ max: 20000 }), approved: f.bool(), approved_by: f.text({ ro: true, max: 120 }),
    },
  },

  compliance_checks: {
    module: "prod", title: ["item"], icon: "shield", group: "quality", program: "program_id", parent: "episode_id",
    list: ["episode_id", "area", "item", "status", "reviewer", "date"], sort: "episode_id,area", search: ["item", "notes", "reviewer"],
    board: { field: "status" }, offline: ["status", "notes"],
    ext: { read: false },
    fields: {
      program_id: f.ref("programs"), episode_id: req(f.ref("episodes", { cascade: true })),
      area: f.enm(["minors", "advertising", "accessibility", "data_protection", "pluralism", "copyright", "other"]), item: req(f.text({ max: 300 })),
      status: f.enm(["pending", "ok", "review", "breach", "na"]), reviewer: f.text({ max: 120 }), date: f.date(), notes: f.long({ max: 3000 }),
    },
  },
};
