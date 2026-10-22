// Module C — people (staff, freelance, talent, guests), availability, studios & equipment, bookings, crew, collective agreements, timesheets.
import { f, req, peopleSensitive } from "./dsl.mjs";

export default {
  people: {
    module: "prod", title: ["name"], icon: "person", group: "directory",
    list: ["name", "kind", "profession", "email", "phone", "agreement_id"], sort: "name", search: ["name", "profession", "email", "phone", "agent_name"],
    sections: [
      { key: "main", fields: ["name", "kind", "profession", "email", "phone", "city", "language", "active", "agreement_id", "partner_id"] },
      { key: "work", fields: ["rate_type", "rate", "agent_name", "agent_contact"] },
      { key: "private", fields: ["national_id", "iban", "address", "birth_date", "social_security"] },
      { key: "notes", fields: ["notes", "private_notes"] },
    ],
    fields: {
      name: req(f.text()), kind: f.enm(["staff", "freelance", "talent", "guest", "supplier_contact"]),
      profession: f.text({ max: 120 }), email: f.email(), phone: f.text({ max: 40 }), city: f.text({ max: 80 }), language: f.text({ max: 60 }),
      active: f.bool({ default: 1 }), agreement_id: f.ref("agreements"), partner_id: f.ref("partners", { help: "company invoicing for this person, if any" }),
      rate_type: f.enm(["day", "hour", "month", "fee", "episode"], { default: "day", perm: peopleSensitive }),
      rate: f.money({ perm: peopleSensitive }),
      agent_name: f.text({ max: 120 }), agent_contact: f.text({ max: 200 }),
      national_id: f.secret({ perm: peopleSensitive }), iban: f.secret({ perm: peopleSensitive }), address: f.secret({ perm: peopleSensitive }),
      birth_date: f.secret({ perm: peopleSensitive }), social_security: f.secret({ perm: peopleSensitive }),
      notes: f.long({ max: 5000 }), private_notes: f.long({ max: 5000, perm: peopleSensitive }),
    },
  },

  agreements: {
    module: "people", title: ["name"], icon: "scale", group: "settings",
    list: ["name", "max_daily_hours", "max_weekly_hours", "min_daily_rest", "overtime_mult"], sort: "name", search: ["name"],
    fields: {
      name: req(f.text()), max_daily_hours: f.num({ default: 8, min: 0, max: 24 }), max_weekly_hours: f.num({ default: 40, min: 0, max: 168 }),
      min_daily_rest: f.num({ default: 12, min: 0, max: 24, help: "hours between two working days" }), min_weekly_rest: f.num({ default: 36, min: 0, max: 168 }),
      overtime_mult: f.num({ default: 1.25, min: 1, max: 5 }), night_from: f.time({ default: "22:00" }), night_to: f.time({ default: "06:00" }),
      night_mult: f.num({ default: 1.25, min: 1, max: 5 }), holiday_mult: f.num({ default: 1.75, min: 1, max: 5 }),
      max_overtime_year: f.int({ default: 80, min: 0, max: 2000 }), notes: f.long({ max: 4000 }),
    },
  },

  availability: {
    module: "prod", title: ["person_id", "kind"], icon: "calendar", group: "directory", parent: "person_id",
    list: ["person_id", "kind", "start_date", "end_date", "reason"], sort: "start_date", search: [],
    calendar: { start: "start_date", end: "end_date", label: "person_id" },
    fields: {
      person_id: req(f.ref("people", { cascade: true })), kind: f.enm(["unavailable", "holiday", "sick", "tentative", "available"]),
      start_date: req(f.date()), end_date: req(f.date()), reason: f.text({ max: 300, perm: peopleSensitive }),
    },
  },

  resources: {
    module: "prod", title: ["name"], icon: "camera", group: "directory",
    list: ["name", "kind", "code", "location", "status"], sort: "kind,name", search: ["name", "code", "location", "specs"],
    fields: {
      name: req(f.text()), kind: f.enm(["studio", "mobile_unit", "camera", "audio", "lighting", "edit_suite", "room", "vehicle", "other"]),
      code: f.text({ max: 30 }), location: f.text({ max: 200 }), capacity: f.int({ min: 0, max: 100000 }),
      status: f.enm(["available", "maintenance", "retired"]), partner_id: f.ref("partners", { help: "rental company / owner" }),
      daily_cost: f.money({ perm: { read: "fin.view", write: "fin.edit" } }), specs: f.long({ max: 6000 }), notes: f.long({ max: 4000 }),
    },
  },

  bookings: {
    module: "prod", title: ["title"], icon: "calendar", group: "planning", program: "program_id", parent: "resource_id",
    list: ["start", "end", "resource_id", "title", "program_id", "status"], sort: "start", search: ["title", "notes"],
    calendar: { start: "start", end: "end", label: "title", resource: "resource_id" },
    ext: { read: true },
    fields: {
      resource_id: req(f.ref("resources", { cascade: true })), program_id: f.ref("programs"), episode_id: f.ref("episodes"),
      title: req(f.text()), kind: f.enm(["shoot", "broadcast", "edit", "rehearsal", "setup", "meeting", "other"]),
      start: req(f.datetime()), end: req(f.datetime()), status: f.enm(["tentative", "confirmed", "cancelled"]), notes: f.long({ max: 3000 }),
    },
  },

  crew_assignments: {
    module: "prod", title: ["person_id", "role"], icon: "users", group: "planning", program: "program_id", parent: "episode_id",
    list: ["person_id", "role", "episode_id", "start", "end", "status"], sort: "start", search: ["role", "notes"],
    calendar: { start: "start", end: "end", label: "role", person: "person_id" },
    fields: {
      program_id: f.ref("programs", { cascade: true }), episode_id: f.ref("episodes", { cascade: true }), booking_id: f.ref("bookings", { cascade: true }),
      person_id: req(f.ref("people")), role: req(f.text({ max: 120 })), start: req(f.datetime()), end: req(f.datetime()),
      status: f.enm(["proposed", "confirmed", "declined"]), rate_override: f.money({ perm: { read: "people.view", write: "people.edit" } }),
      call_time: f.time(), notes: f.long({ max: 2000 }),
    },
  },

  timesheets: {
    module: "people", title: ["person_id", "date"], icon: "clock", group: "directory", program: "program_id",
    list: ["date", "person_id", "program_id", "start", "end", "hours", "overtime", "status"], sort: "-date", search: ["notes"],
    offline: ["start", "end", "break_min", "notes"],
    fields: {
      person_id: req(f.ref("people")), program_id: f.ref("programs"), episode_id: f.ref("episodes"),
      date: req(f.date()), start: req(f.time()), end: req(f.time()), break_min: f.int({ default: 0, min: 0, max: 600 }),
      hours: f.num({ ro: true }), overtime: f.num({ ro: true }), night_hours: f.num({ ro: true }), holiday: f.bool(),
      rest_ok: f.bool({ ro: true, default: 1 }), status: f.enm(["draft", "validated", "paid"]), notes: f.long({ max: 2000 }),
    },
  },
};
