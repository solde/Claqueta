// Tiny DSL to declare entities. A field is { type, required, default, options, to, ro, perm, ... }:
//   text long int num pct money bool date datetime time enum ref json tags secret
// `perm`: { read: "people.view", write: "people.edit" } restricts one field (e.g. rates, national ids) inside an otherwise visible entity.
const F = (type, o = {}) => ({ type, ...o });
/** Field constructors: `f.text()`, `f.money()`, `f.enm([...])`, `f.ref("entity")`... Each returns the field definition the engine, forms and database are built from. */
export const f = {
  text: (o) => F("text", { max: 300, ...o }),
  long: (o) => F("long", { max: 200000, ...o }),
  int: (o) => F("int", o),
  num: (o) => F("num", o),
  pct: (o) => F("pct", { min: 0, max: 100, ...o }),
  money: (o) => F("money", o),
  bool: (o) => F("bool", { default: 0, ...o }),
  date: (o) => F("date", o),
  datetime: (o) => F("datetime", o),
  time: (o) => F("time", o),
  enm: (options, o) => F("enum", { options, default: options[0], ...o }),
  ref: (to, o) => F("ref", { to, ...o }),
  json: (o) => F("json", { max: 400000, ...o }),
  tags: (o) => F("tags", o),
  secret: (o) => F("secret", { max: 2000, ...o }),
  email: (o) => F("text", { format: "email", max: 200, ...o }),
  url: (o) => F("text", { format: "url", max: 1000, ...o }),
  folder: (o) => F("text", { format: "folder", max: 1000, ...o }),   // a path on this computer (the desktop build offers a native folder picker)
};
/** Marks a field as required. */
export const req = (fld) => ({ ...fld, required: true });
/** Marks a field as read-only for the API (only internal writes may set it). */
export const ro = (fld) => ({ ...fld, ro: true });
/** Field permission for sensitive personal data (read people.view, write people.edit). */
export const peopleSensitive = { read: "people.view", write: "people.edit" };
/** Field permission for financial data (read fin.view, write fin.edit). */
export const finSensitive = { read: "fin.view", write: "fin.edit" };
/** Field permission for legal data (read legal.view, write legal.edit). */
export const legalSensitive = { read: "legal.view", write: "legal.edit" };
