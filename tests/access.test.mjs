import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// STRICT mode is decided at import time from the environment: this file runs in its own process
const { internalKeys, signToken } = await import("../gateway/lib/agentd/keys.mjs");
const k = internalKeys("master"); process.env.APP_KEY = k.app; process.env.COLLADO_TOKEN_KEY = k.token;
const APP = path.resolve(import.meta.dirname, "../app-seed/app");
const { openDb, syncSchema } = await import(`${APP}/lib/db.mjs`); const { ctxFromReq, STRICT } = await import(`${APP}/lib/access.mjs`);
openDb(fs.mkdtempSync(path.join(os.tmpdir(), "collado-acc-"))); syncSchema();
const req = (h) => ({ headers: h });

test("production mode: only the gateway key or a valid person's token identify a caller", () => {
  assert.equal(STRICT, true);
  assert.throws(() => ctxFromReq(req({})), /unauthorized/); assert.throws(() => ctxFromReq(req({ "x-collado-user": "root", "x-collado-perms": "users.manage" })), /unauthorized/);
  assert.throws(() => ctxFromReq(req({ "x-collado-key": "wrong", "x-collado-user": "root" })), /unauthorized/);
  const gw = ctxFromReq(req({ "x-collado-key": k.app, "x-collado-user": "ana", "x-collado-perms": "app.view,external", "x-collado-roles": "externo", "accept-language": "ca-ES" })); assert.equal(gw.user, "ana"); assert.equal(gw.external, true); assert.equal(gw.lang, "ca");
  const tok = signToken(k.token, { user: "marta", perms: ["app.view", "fin.view"] }); const ag = ctxFromReq(req({ authorization: `Bearer ${tok}` })); assert.equal(ag.user, "marta"); assert.ok(ag.perms.has("fin.view") && !ag.perms.has("fin.edit")); assert.equal(ag.agent, true);
  assert.throws(() => ctxFromReq(req({ authorization: `Bearer ${tok}x` })), /unauthorized/); assert.throws(() => ctxFromReq(req({ authorization: `Bearer ${signToken(k.token, { user: "a", perms: [], ttlS: -1 })}` })), /unauthorized/);
});

test("the organization comes from the gateway header or from the SIGNED token; a bad slug is rejected; the agent cannot choose another one", () => {
  const gw = (h) => ctxFromReq(req({ "x-collado-key": k.app, "x-collado-user": "ana", "x-collado-perms": "app.view", ...h }));
  assert.equal(gw({}).org, "principal"); assert.equal(gw({ "x-collado-org": "acme", "x-collado-org-name": encodeURIComponent("Acme TV") }).org, "acme");
  assert.equal(gw({ "x-collado-org": "acme", "x-collado-org-name": encodeURIComponent("Acme TV") }).orgName, "Acme TV");
  assert.throws(() => gw({ "x-collado-org": "../x" }), /invalid_org/);
  const tok = signToken(k.token, { user: "marta", perms: ["app.view"], org: "acme" });
  assert.equal(ctxFromReq(req({ authorization: `Bearer ${tok}`, "x-collado-org": "principal" })).org, "acme", "a header sent by the agent is ignored: the token decides");
  assert.equal(ctxFromReq(req({ authorization: `Bearer ${signToken(k.token, { user: "m", perms: [] })}` })).org, "principal");
});
