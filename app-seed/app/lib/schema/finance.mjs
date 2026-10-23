// Module D (+ commercial) — budgets (versions), actual costs, purchase orders, invoicing, payments, bank reconciliation, grants, sponsorship.
import { f, req, finSensitive } from "./dsl.mjs";

/** The budget chapters, in the order they are reported. */
export const CHAPTERS = ["development", "script", "artistic", "technical", "studios", "equipment", "location", "postproduction", "music_rights", "insurance", "travel", "marketing", "overheads", "contingency", "other"];

export default {
  budgets: {
    module: "fin", title: ["name", "version"], titleSep: " v", icon: "euro", group: "finance", program: "program_id", parent: "program_id",
    list: ["name", "program_id", "season_id", "version", "status", "total"], sort: "program_id,name,-version", search: ["name", "notes"],
    fields: {
      program_id: f.ref("programs", { cascade: true }), season_id: f.ref("seasons"), name: req(f.text()), kind: f.enm(["budget", "template"]),
      version: f.int({ default: 1, min: 1 }), status: f.enm(["draft", "submitted", "approved", "obsolete"]),
      currency: f.text({ max: 3, default: "EUR" }), contingency_pct: f.pct({ default: 5 }), episodes: f.int({ default: 0, min: 0, help: "episodes the budget covers (to derive the per-episode cost)" }),
      subtotal: f.money({ ro: true }), vat: f.money({ ro: true }), total: f.money({ ro: true }),
      approved_by: f.text({ ro: true, max: 120 }), approved_at: f.datetime({ ro: true }), notes: f.long({ max: 5000 }), parent_id: f.ref("budgets", { ro: true }),
    },
  },

  budget_lines: {
    module: "fin", title: ["code", "description"], icon: "euro", group: "finance", parent: "budget_id", program: "program_id",
    list: ["code", "chapter", "description", "qty", "unit", "unit_cost", "amount"], sort: "budget_id,code", search: ["code", "description"],
    fields: {
      budget_id: req(f.ref("budgets", { cascade: true })), program_id: f.ref("programs"), episode_id: f.ref("episodes"),
      chapter: f.enm(["development", "script", "artistic", "technical", "studios", "equipment", "location", "postproduction", "music_rights", "insurance", "travel", "marketing", "overheads", "contingency", "other"], { default: "other" }),
      code: f.text({ max: 20 }), description: req(f.text()), qty: f.num({ default: 1 }), unit: f.text({ max: 20, default: "ud" }), unit_cost: f.money(),
      amount: f.money({ ro: true }), vat_rate: f.num({ default: 21, min: 0, max: 100 }), irpf_rate: f.num({ default: 0, min: 0, max: 100 }),
      account: f.text({ max: 30, help: "accounting account (Odoo export)" }), notes: f.long({ max: 2000 }),
    },
  },

  purchase_orders: {
    module: "fin", title: ["number", "description"], icon: "cart", group: "finance", program: "program_id",
    list: ["number", "supplier_id", "program_id", "description", "amount", "status", "needed_date"], sort: "-number", search: ["number", "description"],
    fields: {
      number: f.text({ max: 30, unique: true, ro: true }), program_id: req(f.ref("programs")), episode_id: f.ref("episodes"), budget_line_id: f.ref("budget_lines"),
      supplier_id: f.ref("partners", { filter: { kind: "supplier" } }), description: req(f.text()), amount: req(f.money()), vat_rate: f.num({ default: 21, min: 0, max: 100 }),
      needed_date: f.date(), status: f.enm(["draft", "pending", "approved", "rejected", "invoiced", "closed", "cancelled"]),
      requested_by: f.text({ ro: true, max: 120 }), approved_by: f.text({ ro: true, max: 120 }), approved_at: f.datetime({ ro: true }), notes: f.long({ max: 3000 }),
    },
  },

  bills: {
    module: "fin", title: ["number", "description"], icon: "receipt", group: "finance", program: "program_id",
    list: ["date", "number", "supplier_id", "program_id", "description", "base", "total", "status", "due_date"], sort: "-date", search: ["number", "description", "supplier_name"],
    fields: {
      kind: f.enm(["invoice", "expense", "payroll", "other"]), number: f.text({ max: 60 }), date: req(f.date()), due_date: f.date(),
      supplier_id: f.ref("partners"), person_id: f.ref("people"), supplier_name: f.text({ max: 200 }),
      program_id: f.ref("programs"), season_id: f.ref("seasons"), episode_id: f.ref("episodes"), budget_line_id: f.ref("budget_lines"), po_id: f.ref("purchase_orders"),
      description: req(f.text()), base: req(f.money()), vat_rate: f.num({ default: 21, min: 0, max: 100 }), irpf_rate: f.num({ default: 0, min: 0, max: 100 }),
      vat: f.money({ ro: true }), irpf: f.money({ ro: true }), total: f.money({ ro: true }),
      status: f.enm(["pending", "approved", "rejected", "paid"]), paid_date: f.date(), payment_method: f.enm(["transfer", "card", "cash", "direct_debit", "other"]),
      approved_by: f.text({ ro: true, max: 120 }), approved_at: f.datetime({ ro: true }), bank_movement_id: f.ref("bank_movements", { ro: true }), notes: f.long({ max: 3000 }),
    },
  },

  client_invoices: {
    module: "fin", title: ["number"], icon: "receipt", group: "finance", program: "program_id",
    list: ["number", "date", "client_id", "program_id", "concept", "base", "total", "paid_amount", "status", "due_date"], sort: "-date", search: ["number", "concept"],
    fields: {
      series: f.text({ max: 10, default: "F" }), number: f.text({ max: 40, unique: true, help: "left empty it is assigned on issue" }), date: req(f.date()), due_date: f.date(),
      client_id: req(f.ref("partners")), program_id: f.ref("programs"), season_id: f.ref("seasons"), episode_id: f.ref("episodes"), plan_id: f.ref("billing_plan"),
      concept: req(f.text({ max: 500 })), base: req(f.money()), vat_rate: f.num({ default: 21, min: 0, max: 100 }), irpf_rate: f.num({ default: 0, min: 0, max: 100, help: "withholding applied by the client" }),
      vat: f.money({ ro: true }), irpf: f.money({ ro: true }), total: f.money({ ro: true }), paid_amount: f.money({ ro: true }),
      status: f.enm(["draft", "issued", "partial", "paid", "void"]), notes: f.long({ max: 3000 }),
    },
  },

  payments: {
    module: "fin", title: ["date", "amount"], icon: "euro", group: "finance", parent: "invoice_id", program: "program_id",
    list: ["date", "invoice_id", "amount", "method", "reference"], sort: "-date", search: ["reference"],
    fields: {
      invoice_id: req(f.ref("client_invoices", { cascade: true })), program_id: f.ref("programs"), date: req(f.date()), amount: req(f.money()),
      method: f.enm(["transfer", "card", "cash", "direct_debit", "other"]), reference: f.text({ max: 120 }), bank_movement_id: f.ref("bank_movements", { ro: true }),
    },
  },

  billing_plan: {
    module: "fin", title: ["description"], icon: "calendar", group: "finance", program: "program_id", parent: "program_id",
    list: ["expected_date", "program_id", "description", "amount", "status"], sort: "expected_date", search: ["description"],
    calendar: { start: "expected_date", label: "description" },
    fields: {
      program_id: req(f.ref("programs", { cascade: true })), season_id: f.ref("seasons"), episode_id: f.ref("episodes"), client_id: f.ref("partners"),
      description: req(f.text()), expected_date: req(f.date()), amount: req(f.money()), vat_rate: f.num({ default: 21, min: 0, max: 100 }),
      trigger: f.enm(["date", "delivery", "air", "milestone"]), status: f.enm(["planned", "invoiced", "cancelled"]),
    },
  },

  bank_movements: {
    module: "fin", title: ["date", "concept"], icon: "bank", group: "finance",
    list: ["date", "concept", "amount", "reference", "matched"], sort: "-date", search: ["concept", "reference", "counterparty"],
    fields: {
      date: req(f.date()), concept: req(f.text({ max: 500 })), amount: req(f.money({ help: "positive = in, negative = out" })), counterparty: f.text({ max: 200 }),
      reference: f.text({ max: 120 }), account: f.text({ max: 60 }), batch: f.text({ max: 60, ro: true }),
      matched: f.bool({ ro: true }), matched_entity: f.text({ ro: true, max: 40 }), matched_id: f.int({ ro: true }),
    },
  },

  grants: {
    module: "fin", title: ["name"], icon: "gift", group: "finance", program: "program_id",
    list: ["name", "body", "program_id", "requested", "granted", "status", "justify_by"], sort: "-created", search: ["name", "body", "reference"],
    calendar: { start: "justify_by", label: "name" },
    fields: {
      name: req(f.text()), body: f.text({ max: 200, help: "granting authority" }), reference: f.text({ max: 80 }), program_id: f.ref("programs"), season_id: f.ref("seasons"),
      status: f.enm(["planned", "applied", "granted", "denied", "partial_paid", "paid", "justified"]),
      requested: f.money(), granted: f.money(), received: f.money(), apply_by: f.date(), resolution_date: f.date(), justify_by: f.date(),
      installments: f.json({ help: "[{date, amount, received}] expected payments (feeds the cashflow)" }), eligible_notes: f.long({ max: 4000 }), notes: f.long({ max: 4000 }),
    },
  },

  rate_cards: {
    module: "fin", title: ["name"], icon: "tag", group: "commercial",
    list: ["name", "program_id", "daypart", "unit", "price", "valid_from", "valid_to"], sort: "name", search: ["name", "daypart"],
    fields: {
      name: req(f.text()), program_id: f.ref("programs"), channel_id: f.ref("partners"), daypart: f.text({ max: 80 }),
      unit: f.enm(["spot_10", "spot_20", "spot_30", "billboard", "mention", "placement", "package", "other"], { default: "spot_20" }),
      price: req(f.money()), valid_from: f.date(), valid_to: f.date(), notes: f.long({ max: 2000 }),
    },
  },

  sponsorships: {
    module: "fin", title: ["name"], icon: "handshake", group: "commercial", program: "program_id",
    list: ["name", "sponsor_id", "program_id", "kind", "fee", "status", "start_date", "end_date"], sort: "-created", search: ["name", "deliverables"],
    calendar: { start: "start_date", end: "end_date", label: "name" },
    fields: {
      name: req(f.text()), sponsor_id: req(f.ref("partners")), program_id: f.ref("programs"), season_id: f.ref("seasons"),
      kind: f.enm(["sponsorship", "placement", "branded", "spots", "billboard", "other"]), status: f.enm(["proposal", "negotiation", "signed", "executed", "invoiced", "lost"]),
      fee: f.money(), start_date: f.date(), end_date: f.date(), contract_id: f.ref("contracts"), invoice_id: f.ref("client_invoices"),
      deliverables: f.long({ max: 5000 }), restrictions: f.long({ max: 3000 }), notes: f.long({ max: 3000 }),
    },
  },

  ad_spots: {
    module: "fin", title: ["description"], icon: "megaphone", group: "commercial", program: "program_id", parent: "sponsorship_id",
    list: ["broadcast_id", "sponsorship_id", "position", "duration_sec", "price", "status"], sort: "-created", search: ["description"],
    fields: {
      sponsorship_id: req(f.ref("sponsorships", { cascade: true })), program_id: f.ref("programs"), broadcast_id: f.ref("broadcasts"), rate_card_id: f.ref("rate_cards"),
      description: f.text(), position: f.enm(["pre", "mid", "post", "billboard", "inside"]), duration_sec: f.int({ default: 20, min: 0 }),
      price: f.money(), status: f.enm(["planned", "aired", "invoiced"]), invoice_id: f.ref("client_invoices", { ro: true }),
    },
  },

  placements: {
    module: "fin", title: ["brand"], icon: "bag", group: "commercial", program: "program_id", parent: "sponsorship_id",
    list: ["brand", "episode_id", "scene", "tc_in", "approved"], sort: "-created", search: ["brand", "scene", "description"],
    fields: {
      sponsorship_id: f.ref("sponsorships", { cascade: true }), program_id: f.ref("programs"), episode_id: f.ref("episodes"), brand: req(f.text({ max: 120 })),
      description: f.long({ max: 2000 }), scene: f.text({ max: 200 }), tc_in: f.text({ max: 12 }), tc_out: f.text({ max: 12 }),
      approved: f.bool(), disclosure: f.bool({ help: "on-screen notice of product placement shown" }), notes: f.long({ max: 2000 }),
    },
  },
};
