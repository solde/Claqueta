// Module H — schedule grid, airings and audience data, audience research (targets, competition).
import { f, req } from "./dsl.mjs";

export default {
  broadcasts: {
    module: "prod", title: ["date", "start_time"], icon: "antenna", group: "broadcast", program: "program_id",
    list: ["date", "start_time", "end_time", "channel_id", "program_id", "episode_id", "kind", "status"], sort: "date,start_time", search: ["title", "notes"],
    calendar: { start: "date", label: "title" }, ext: { read: true },
    fields: {
      program_id: f.ref("programs"), episode_id: f.ref("episodes"), channel_id: f.ref("partners", { filter: { kind: "channel" } }),
      title: f.text(), date: req(f.date()), start_time: req(f.time()), end_time: f.time(),
      kind: f.enm(["premiere", "repeat", "live", "preview"]), status: f.enm(["planned", "confirmed", "aired", "cancelled"]),
      actual_start: f.time(), actual_end: f.time(), notes: f.long({ max: 2000 }),
    },
  },

  ratings: {
    module: "prod", title: ["source", "date"], icon: "chart", group: "broadcast", program: "program_id", parent: "broadcast_id",
    list: ["date", "broadcast_id", "source", "target_label", "audience_avg", "share_pct", "rating_pct", "reach"], sort: "-date", search: ["source", "target_label"],
    fields: {
      broadcast_id: f.ref("broadcasts", { cascade: true }), program_id: f.ref("programs"), episode_id: f.ref("episodes"), date: req(f.date()),
      source: f.text({ max: 80, default: "Kantar" }), target_label: f.text({ max: 120, default: "Total individuos" }), target_id: f.ref("targets"),
      audience_avg: f.int({ min: 0, help: "average audience (thousands)" }), share_pct: f.num({ min: 0, max: 100 }), rating_pct: f.num({ min: 0, max: 100 }),
      reach: f.int({ min: 0, help: "thousands" }), peak: f.int({ min: 0 }), minute_curve: f.json({ help: "[audience per minute]" }), batch: f.text({ max: 60, ro: true }), notes: f.text({ max: 500 }),
    },
  },

  targets: {
    module: "prod", title: ["name"], icon: "target", group: "audience", program: "program_id", parent: "program_id",
    list: ["name", "program_id", "age_range", "size_note"], sort: "program_id,name", search: ["name", "description", "habits", "channels", "needs"],
    fields: {
      program_id: f.ref("programs", { cascade: true }), name: req(f.text()), age_range: f.text({ max: 40 }), description: f.long({ max: 4000 }),
      habits: f.long({ max: 4000 }), channels: f.long({ max: 3000 }), needs: f.long({ max: 3000 }), size_note: f.text({ max: 300 }), sources: f.long({ max: 2000 }),
    },
  },

  competitors: {
    module: "prod", title: ["programme"], icon: "swords", group: "audience", program: "program_id", parent: "program_id",
    list: ["programme", "channel", "slot", "share", "program_id"], sort: "program_id,programme", search: ["programme", "channel", "notes"],
    fields: {
      program_id: f.ref("programs", { cascade: true }), programme: req(f.text()), channel: f.text({ max: 120 }), slot: f.text({ max: 120 }), share: f.text({ max: 60 }),
      notes: f.long({ max: 3000 }), source: f.text({ max: 300 }),
    },
  },
};
