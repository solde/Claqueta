// Audience forecasting from the measured history of a programme. Pure functions, no I/O, nothing leaves the machine.
// Model (log scale, so audiences stay positive and effects are multiplicative):
//   1. level + damped trend: weighted least squares over the episodes in order, recent ones weigh more (half-life HALF_LIFE episodes);
//   2. slot effects: the residuals of the fit grouped by weekday, time band and kind of broadcast, shrunk towards "no effect" when there are few points;
//   3. interval: spread of the residuals, widened with the horizon and when there is little data (80 % interval: P10..P90).
// It is a statistical estimate, not a promise: `quality` tells how much history backs it.
const HALF_LIFE = 6, PHI = 0.9, SHRINK = 3, Z80 = 1.2816, MIN_POINTS = 3;
const BANDS = [["morning", 0, 12 * 60], ["afternoon", 12 * 60, 17 * 60], ["access", 17 * 60, 20 * 60 + 30], ["prime", 20 * 60 + 30, 23 * 60 + 30], ["late", 23 * 60 + 30, 48 * 60]];
const mins = (hhmm) => { const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/** Time band of an "HH:MM" start (morning, afternoon, access, prime, late) or null. */
export const bandOf = (time) => { const m = mins(time); if (m === null) return null; const b = BANDS.find(([, a, z]) => m >= a && m < z); return b ? b[0] : "late"; };
/** Weekday of a YYYY-MM-DD date, 0 = Monday. */
export const weekdayOf = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return Number.isNaN(d.getTime()) ? null : (d.getUTCDay() + 6) % 7; };   // 0 = Monday
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

/** Weighted least squares of y on t. Returns { a, b } with y ~ a + b*t. */
function wls(t, y, w) {
  const sw = w.reduce((s, x) => s + x, 0), mt = t.reduce((s, x, i) => s + w[i] * x, 0) / sw, my = y.reduce((s, x, i) => s + w[i] * x, 0) / sw;
  let sxx = 0, sxy = 0; for (let i = 0; i < t.length; i++) { sxx += w[i] * (t[i] - mt) ** 2; sxy += w[i] * (t[i] - mt) * (y[i] - my); }
  const b = sxx > 1e-9 ? sxy / sxx : 0; return { a: my - b * mt, b };
}

/** points: [{ value, date, time?, kind? }] in chronological order (value > 0). Returns a model, or null when there is too little history. */
export function fitModel(points) {
  const pts = points.filter((p) => Number.isFinite(p.value) && p.value > 0); if (pts.length < MIN_POINTS) return null;
  const n = pts.length, t = pts.map((_, i) => i), y = pts.map((p) => Math.log(p.value)), w = t.map((i) => 0.5 ** ((n - 1 - i) / HALF_LIFE));
  let { a, b } = wls(t, y, w);
  b = Math.max(-0.08, Math.min(0.08, b));   // a trend steeper than 8 % per episode is noise on so little data: do not extrapolate it
  const level = a + b * (n - 1), res = y.map((v, i) => v - (a + b * i));
  const group = (key) => { const g = new Map(); pts.forEach((p, i) => { const k = key(p); if (k == null) return; (g.get(k) || g.set(k, []).get(k)).push(res[i]); }); return new Map([...g].map(([k, r]) => [k, { n: r.length, effect: (r.reduce((s, x) => s + x, 0) / r.length) * (r.length / (r.length + SHRINK)) }])); };
  const effects = { weekday: group((p) => weekdayOf(p.date)), band: group((p) => bandOf(p.time)), kind: group((p) => p.kind || null) };
  // effects explain part of the spread: the interval uses what is left over after them
  const slotEff = (p) => (effects.weekday.get(weekdayOf(p.date))?.effect || 0) + (effects.band.get(bandOf(p.time))?.effect || 0) + (effects.kind.get(p.kind || null)?.effect || 0);
  const left = pts.map((p, i) => res[i] - slotEff(p) / 2);   // each effect is estimated from the same residuals: count them at half so the spread is not understated
  const sw = w.reduce((s, x) => s + x, 0), sigma = Math.max(0.05, Math.sqrt(left.reduce((s, r, i) => s + w[i] * r * r, 0) / sw * (n / Math.max(1, n - 2))));
  const last = pts[n - 1], recent = pts.slice(-4).map((p) => p.value);
  return { n, level, slope: b, sigma, effects, last: { date: last.date, value: last.value }, recent_avg: recent.reduce((s, x) => s + x, 0) / recent.length, first_date: pts[0].date };
}

const EFFECT_LABEL = { weekday: "weekday", band: "band", kind: "kind" };
/** Forecast for one future slot { date, time?, kind? } `ahead` episodes after the last measured one (ahead >= 1). */
export function predict(model, slot, ahead = 1) {
  let trend = 0; for (let k = 1; k <= ahead; k++) trend += model.slope * PHI ** k;
  const used = [], eff = (name, key) => { const e = model.effects[name].get(key); if (!e || key == null) return 0; used.push({ factor: EFFECT_LABEL[name], key: String(key), pct: round((Math.exp(e.effect) - 1) * 100, 1), n: e.n }); return e.effect; };
  const mu = model.level + trend + eff("weekday", weekdayOf(slot.date)) + eff("band", bandOf(slot.time)) + eff("kind", slot.kind || null);
  const sd = model.sigma * Math.sqrt(1 + 0.06 * ahead + 1 / model.n) * (model.n < 6 ? 1.25 : 1);
  const at = (z) => Math.exp(mu + z * sd);
  return { p10: at(-Z80), p50: at(0), p90: at(Z80), factors: used, ahead };
}

/** Confidence of the estimate from the amount and the spread of the history. */
export function quality(model) { if (!model) return "none"; if (model.n >= 12 && model.sigma < 0.2) return "high"; if (model.n >= 6 && model.sigma < 0.35) return "medium"; return "low"; }

/** One measure (audience, share…): fits the history and predicts every slot. points as in fitModel; slots: [{ date, time?, kind?, ...whatever }] in chronological order. */
export function forecastMeasure(points, slots, digits = 0) {
  const model = fitModel(points); if (!model) return { model: null, quality: "none", slots: slots.map((s) => ({ ...s, forecast: null })) };
  return { model: { n: model.n, trend_pct_per_episode: round((Math.exp(model.slope) - 1) * 100, 1), spread_pct: round(model.sigma * 100, 0), recent_avg: round(model.recent_avg, digits) }, quality: quality(model),
    slots: slots.map((s, i) => { const p = predict(model, s, i + 1); return { ...s, forecast: { p10: round(p.p10, digits), p50: round(p.p50, digits), p90: round(p.p90, digits) }, factors: p.factors }; }) };
}
