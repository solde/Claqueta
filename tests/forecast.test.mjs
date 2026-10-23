// Unit tests of the audience forecast (app/lib/forecast.mjs and reports.audienceForecast): the model on synthetic histories and the report over real broadcasts and ratings.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, ".."), T = fs.mkdtempSync(path.join(os.tmpdir(), "collado-fc-")), APP = path.join(ROOT, "app-seed/app");
process.env.COLLADO_DESKTOP = "1"; process.env.WORKSPACE_DIR = path.join(T, "shared");
const { fitModel, predict, forecastMeasure, quality, bandOf, weekdayOf } = await import(`${APP}/lib/forecast.mjs`);
const { openDb, syncSchema } = await import(`${APP}/lib/db.mjs`), { initKey } = await import(`${APP}/lib/crypto.mjs`), E = await import(`${APP}/lib/engine.mjs`); await import(`${APP}/lib/logic.mjs`);
const { localCtx } = await import(`${APP}/lib/access.mjs`), R = await import(`${APP}/lib/reports.mjs`);
const addDays = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const series = (n, f, start = "2026-01-05") => Array.from({ length: n }, (_, i) => ({ value: f(i), date: addDays(start, 7 * i), time: "22:00", kind: "premiere" }));

test("helpers: time bands and weekdays", () => { assert.equal(bandOf("22:15"), "prime"); assert.equal(bandOf("18:00"), "access"); assert.equal(bandOf("09:00"), "morning"); assert.equal(bandOf(""), null); assert.equal(weekdayOf("2026-01-05"), 0); assert.equal(weekdayOf("2026-01-11"), 6); });

test("too little history gives no model; a flat series is predicted flat; a falling one keeps falling, damped", () => {
  assert.equal(fitModel(series(2, () => 1000)), null); assert.equal(quality(null), "none");
  const flat = forecastMeasure(series(12, () => 1000), [{ date: "2026-04-06" }]); assert.ok(Math.abs(flat.slots[0].forecast.p50 - 1000) < 30, JSON.stringify(flat.slots[0]));
  const fall = fitModel(series(10, (i) => 1500 - i * 80)), p = predict(fall, { date: "2026-03-16", time: "22:00", kind: "premiere" }, 1), q = predict(fall, { date: "2026-03-16", time: "22:00", kind: "premiere" }, 8);
  assert.ok(p.p50 < 800 && p.p50 > 400, `next ${p.p50}`); assert.ok(q.p50 < p.p50, "keeps falling"); assert.ok(q.p50 > 100, "the trend is damped, not extrapolated to zero");
});

test("the interval is ordered, positive and widens with the horizon and with noisy or scarce data", () => {
  const noisy = fitModel(series(12, (i) => 1000 + (i % 2 ? 300 : -300))), calm = fitModel(series(12, (i) => 1000 + (i % 2 ? 20 : -20)));
  const w = (m, k) => { const p = predict(m, { date: "2026-04-06" }, k); assert.ok(0 < p.p10 && p.p10 < p.p50 && p.p50 < p.p90); return (p.p90 - p.p10) / p.p50; };
  assert.ok(w(noisy, 1) > w(calm, 1) * 3); assert.ok(w(calm, 6) > w(calm, 1));
  assert.ok(w(fitModel(series(4, (i) => 1000 + (i % 2 ? 100 : -100))), 1) > w(fitModel(series(12, (i) => 1000 + (i % 2 ? 100 : -100))), 1), "less history, wider range");
  assert.equal(quality(calm), "high"); assert.equal(quality(noisy), "medium"); assert.equal(quality(fitModel(series(12, (i) => 1000 + (i % 2 ? 500 : -500)))), "low"); assert.equal(quality(fitModel(series(4, () => 1000))), "low", "little history is never reliable");
});

test("slot effects: premieres beat repeats and the forecast follows the kind of the slot", () => {
  const pts = Array.from({ length: 16 }, (_, i) => ({ value: i % 2 ? 600 : 1200, date: addDays("2026-01-05", 7 * i), time: "22:00", kind: i % 2 ? "repeat" : "premiere" }));
  const m = fitModel(pts), prem = predict(m, { date: "2026-05-04", time: "22:00", kind: "premiere" }, 1), rep = predict(m, { date: "2026-05-04", time: "22:00", kind: "repeat" }, 1);
  assert.ok(prem.p50 > rep.p50 * 1.3, `${prem.p50} vs ${rep.p50}`); assert.ok(prem.factors.some((f) => f.factor === "kind" && f.key === "premiere" && f.pct > 0));
});

test("audienceForecast: uses the broadcasts and ratings of the programme, the target chosen and a what-if slot", async () => {
  initKey(T); openDb(T); syncSchema(); const ctx = localCtx("david");
  const prog = await E.create(ctx, "programs", { name: "Forecast", folder: path.join(T, "p") }), other = await E.create(ctx, "programs", { name: "Other", folder: path.join(T, "o") });
  assert.equal(R.audienceForecast(ctx, { program_id: prog.id }).quality, "none");
  for (let i = 0; i < 8; i++) { const date = addDays("2026-01-05", 7 * i), b = await E.create(ctx, "broadcasts", { program_id: prog.id, date, start_time: "22:00", kind: "premiere", status: "aired" });
    await E.create(ctx, "ratings", { program_id: prog.id, broadcast_id: b.id, date, audience_avg: 1200 - i * 30, share_pct: 9 - i * 0.2, target_label: "Total individuos" });
    await E.create(ctx, "ratings", { program_id: prog.id, date, audience_avg: 50, share_pct: 1, target_label: "Jóvenes" }); }
  await E.create(ctx, "ratings", { program_id: other.id, date: "2026-01-05", audience_avg: 99999, share_pct: 50, target_label: "Total individuos" });
  const far = addDays(new Date().toISOString().slice(0, 10), 30), b2 = await E.create(ctx, "broadcasts", { program_id: prog.id, date: far, start_time: "22:00", kind: "premiere", status: "planned" });
  const r = R.audienceForecast(ctx, { program_id: prog.id, scenario: { date: far, time: "22:00", kind: "repeat" } });
  assert.equal(r.target, "Total individuos"); assert.equal(r.history.length, 8); assert.equal(r.targets[0].n, 8); assert.equal(r.slots.length, 1); assert.equal(r.slots[0].id, b2.id); assert.equal(r.projected, false);
  assert.ok(r.slots[0].audience.p50 > 700 && r.slots[0].audience.p50 < 1100, JSON.stringify(r.slots[0].audience)); assert.ok(r.slots[0].share.p50 > 4 && r.slots[0].share.p50 < 9); assert.ok(r.what_if.audience.p50 > 0);
  assert.equal(R.audienceForecast(ctx, { program_id: prog.id, target: "Jóvenes" }).history.length, 8);
  await E.update(ctx, "broadcasts", b2.id, { status: "cancelled" }); const p = R.audienceForecast(ctx, { program_id: prog.id, weeks: 4 });
  assert.equal(p.projected, true); assert.equal(p.slots.length, 4); assert.ok(p.slots.every((s) => s.date >= new Date().toISOString().slice(0, 10) && s.audience));
});
