#!/usr/bin/env node
// Talk to the Claqueta API with YOUR permissions (the token in ~/.collado/token). Output is JSON.
//   collado-api schema [entity]                       data model (entities, fields, enums) as you can see it
//   collado-api list <entity> [field=value ... q=text sort=-date limit=50]     list rows ("f." filters: status=in:a|b  date=>=2026-01-01)
//   collado-api get <entity> <id>                     one row (+ labels of references)
//   collado-api create <entity> '<json>' | @file.json | -        create a row;   batch <entity> '<json array>'
//   collado-api update <entity> <id> '<json>'         partial update (send {"rev": n} to detect concurrent edits)
//   collado-api delete <entity> <id>
//   collado-api report <name> [k=v ...]               budget, episode-variance, cashflow, tax, profitability, conflicts, timesheets, rundown, gantt, ratings, rights-check, delivery-readiness
//   collado-api action <name> '<json>'                apply-template, budget-version, reorder-rundown, import-ratings, import-bank, init-compliance, plan-episode ...
//   collado-api alerts [program=ID] | dashboard [program=ID] | search <text> | me
//   collado-api raw <METHOD> </api/path> ['<json>']   anything else
// Money is a plain number in euros; dates are YYYY-MM-DD; enum values are the codes shown by `schema`.
import fs from "node:fs";
import { app, fail, parseArgs } from "./client.mjs";
const { pos, flags } = parseArgs(process.argv.slice(2));
const [cmd, a, b, c] = pos;
/** A JSON body from an argument: inline JSON, `@file`, or `-` for stdin. */
const body = (x) => { if (x === undefined) return {}; if (x === "-") return JSON.parse(fs.readFileSync(0, "utf8")); if (x.startsWith("@")) return JSON.parse(fs.readFileSync(x.slice(1), "utf8")); try { return JSON.parse(x); } catch { fail("el cuerpo no es JSON válido"); } };
/** `key=value` arguments to an object. */
const kv = (arr) => { const out = {}; for (const s of arr) { const i = s.indexOf("="); if (i < 0) fail(`argumento no válido: ${s} (usa campo=valor)`); out[s.slice(0, i)] = s.slice(i + 1); } return out; };
/** Object to a query string. */
const qs = (o) => { const p = new URLSearchParams(o); const s = p.toString(); return s ? "?" + s : ""; };
/** Prints a result as JSON (compact with --compact). */
const out = (v) => console.log(JSON.stringify(v, null, flags.compact ? 0 : 2));
const reserved = new Set(["q", "sort", "limit", "offset", "ids", "refs"]);
switch (cmd) {
  case "schema": { const s = await app("GET", "/api/schema"); if (!a) { out(Object.values(s.entities).map((e) => ({ entity: e.name, module: e.module, title: e.title, fields: Object.keys(e.fields).length, canWrite: e.canWrite }))); break; } const e = s.entities[a]; if (!e) fail(`entidad desconocida: ${a}`); out({ ...e, fields: Object.fromEntries(Object.values(e.fields).map((f) => [f.name, [f.type, f.required ? "required" : "", f.options ? f.options.join("|") : "", f.to ? `-> ${f.to}` : "", f.ro ? "read-only" : "", f.help || ""].filter(Boolean).join(" ")])) }); break; }
  case "list": { const q = {}; for (const [k, v] of Object.entries(kv(pos.slice(2)))) q[reserved.has(k) ? k : `f.${k}`] = v; const r = await app("GET", `/api/e/${a}${qs({ limit: 100, ...q })}`); out(flags.refs ? r : { total: r.total, rows: r.rows }); break; }
  case "get": out(await app("GET", `/api/e/${a}/${b}`)); break;
  case "create": out(await app("POST", `/api/e/${a}`, body(b))); break;
  case "batch": out(await app("POST", `/api/e/${a}/batch`, { rows: body(b) })); break;
  case "update": out(await app("PATCH", `/api/e/${a}/${b}`, body(c))); break;
  case "delete": out(await app("DELETE", `/api/e/${a}/${b}`)); break;
  case "history": out(await app("GET", `/api/e/${a}/${b}/history`)); break;
  case "report": out(await app("GET", `/api/reports/${a}${qs(kv(pos.slice(2)))}`)); break;
  case "action": out(await app("POST", `/api/actions/${a}`, body(b))); break;
  case "alerts": out(await app("GET", `/api/alerts${qs(kv(pos.slice(1)))}`)); break;
  case "dashboard": out(await app("GET", `/api/dashboard${qs(kv(pos.slice(1)))}`)); break;
  case "search": out(await app("GET", `/api/search${qs({ q: pos.slice(1).join(" ") })}`)); break;
  case "me": out(await app("GET", "/api/me")); break;
  case "raw": out(await app(a.toUpperCase(), b, c === undefined ? undefined : body(c))); break;
  default: fail(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(2, 17).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"), 2);
}
