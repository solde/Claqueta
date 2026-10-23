import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AuthStore, AuthError } from "../gateway/lib/auth.mjs";

const mk = () => new AuthStore(fs.mkdtempSync(path.join(os.tmpdir(), "collado-auth-")));
const P = (a, t) => a.permissionsOf(a.resolve(t), "principal");
const req = { headers: { "user-agent": "t" }, socket: { remoteAddress: "1.2.3.4" } };

test("bootstrap, login, permissions follow role changes immediately", async () => {
  const a = mk();
  const pw = await a.cliUpsert("david");
  const { token } = await a.login("david", pw, req);
  assert.equal(a.resolve(token).username, "david");
  assert.ok(P(a, token).includes("users.manage"));
  await a.createUser("david", { username: "ana", password: "una-clave-larga-1", roles: ["lector"] }, "principal");
  const t2 = (await a.login("ana", "una-clave-larga-1", req)).token;
  assert.deepEqual(P(a, t2), ["app.view"]);
  a.upsertRole("david", "guionista", { permissions: ["app.view", "app.edit"] }, true, "principal");
  await a.updateUser("david", "ana", { roles: ["lector", "guionista"] }, "principal");
  assert.deepEqual(P(a, t2), ["app.edit", "app.view"]);
  a.upsertRole("david", "guionista", { permissions: ["app.view"] }, false, "principal");
  assert.deepEqual(P(a, t2), ["app.view"]);
  a.deleteRole("david", "guionista", "principal");
  assert.deepEqual(a.db.users.ana.memberships.principal.roles, ["lector"]);
});

test("wrong password, unknown user, disabled user and throttling", async () => {
  const a = mk();
  await a.createUser("cli", { username: "bob", password: "contraseña-larga-1", roles: ["admin"] }, "principal");
  await assert.rejects(a.login("bob", "mal", req), /incorrectos/);
  await assert.rejects(a.login("nadie", "mal", req), /incorrectos/);
  for (let i = 0; i < 4; i++) await assert.rejects(a.login("bob", "mal", req));
  await assert.rejects(a.login("bob", "contraseña-larga-1", req), (e) => e.status === 429);
});

test("the last super-admin cannot be removed, disabled or demoted; the org admin role is locked and carries no platform permissions", async () => {
  const a = mk();
  await a.cliUpsert("root1");   // the first user ever created is a super-admin
  assert.equal(a.db.users.root1.super, true);
  await assert.rejects(a.updateUser("x", "root1", { disabled: true }, "principal", { actorSuper: true }), (e) => e.status === 409);
  await assert.rejects(a.updateUser("x", "root1", { super: false }, "principal", { actorSuper: true }), (e) => e.status === 409);
  assert.throws(() => a.deleteUser("x", "root1", "principal", { actorSuper: true }), (e) => e.status === 409);
  assert.throws(() => a.upsertRole("x", "admin", { permissions: [] }, false, "principal"), (e) => e.status === 409);
  assert.throws(() => a.deleteRole("x", "admin", "principal"), (e) => e.status === 409);
  assert.ok(!a.db.orgs.principal.roles.admin.permissions.includes("service.manage") && a.db.orgs.principal.roles.admin.permissions.includes("users.manage"));
  assert.throws(() => a.upsertRole("x", "pwned", { permissions: ["service.manage"] }, true, "principal"), /plataforma/);
  await a.createUser("root1", { username: "root2", password: "contraseña-larga-2", super: true }, "principal", { actorSuper: true });
  await a.updateUser("root2", "root1", { disabled: true }, "principal", { actorSuper: true });
  await assert.rejects(a.updateUser("root1", "root2", { disabled: true }, "principal", { actorSuper: true }), (e) => e.status === 409);
});

test("multi-company: only a super-admin creates organizations and users in all of them; a person can belong to several; permissions are per organization; Servicio is super-only", async () => {
  const a = mk(); await a.cliUpsert("boss");
  const acme = a.createOrg("boss", { slug: "acme", name: "Acme TV" }); assert.equal(acme.slug, "acme");
  assert.throws(() => a.createOrg("boss", { slug: "Bad Slug", name: "x" }), /no válido/); assert.throws(() => a.createOrg("boss", { slug: "acme", name: "x" }), /Ya existe/);
  // the super-admin creates people in every organization; a person can be in several with different roles
  await a.createUser("boss", { username: "ana", password: "una-clave-larga-1", roles: ["editor"] }, "principal", { actorSuper: true });
  const r = await a.createUser("boss", { username: "ana", roles: ["contabilidad"] }, "acme", { actorSuper: true }); assert.equal(r.existing, true);
  await a.createUser("boss", { username: "pepe", password: "una-clave-larga-2", roles: ["admin"] }, "acme", { actorSuper: true });
  const t = (await a.login("ana", "una-clave-larga-1", req)).token;
  assert.equal(a.contextOf(t).org, "principal"); assert.ok(a.contextOf(t).perms.has("agent.console"));
  a.switchOrg(t, "acme"); const cx = a.contextOf(t); assert.equal(cx.org, "acme"); assert.ok(cx.perms.has("fin.edit") && !cx.perms.has("agent.console"), "permissions come from the roles IN that organization");
  assert.deepEqual(a.publicUser(cx.user, "acme").orgs.map((o) => o.slug).sort(), ["acme", "principal"]);
  // an org admin never gets platform permissions nor reaches another organization
  const pepe = a.db.users.pepe; assert.ok(a.permissionsOf(pepe, "acme").includes("users.manage") && !a.permissionsOf(pepe, "acme").includes("service.manage") && !a.permissionsOf(pepe, "acme").includes("platform.admin"));
  assert.equal(a.canUseOrg(pepe, "principal"), false);
  // an org admin may add a brand-new person to THEIR organization but cannot add existing accounts, grant super-admin or edit people who are also elsewhere
  await assert.rejects(a.createUser("pepe", { username: "ana", roles: [] }, "acme"), (e) => e.status === 409);
  await assert.rejects(a.createUser("pepe", { username: "new1", password: "una-clave-larga-3", super: true }, "acme"), (e) => e.status === 403);
  await a.createUser("pepe", { username: "new1", password: "una-clave-larga-3", roles: ["lector"] }, "acme");
  await a.updateUser("pepe", "ana", { roles: ["lector"] }, "acme");   // roles in his organization: allowed
  await assert.rejects(a.updateUser("pepe", "ana", { disabled: true }, "acme"), (e) => e.status === 403);
  await assert.rejects(a.updateUser("pepe", "boss", { roles: [] }, "acme"), (e) => e.status === 404);
  await assert.rejects(a.updateUser("pepe", "new1", { super: true }, "acme"), (e) => e.status === 403);
  // removing from an organization keeps the account; the last organization deletes it
  assert.deepEqual(a.deleteUser("pepe", "ana", "acme"), { removed_from: "acme" }); assert.ok(a.db.users.ana); assert.equal(a.db.users.ana.memberships.acme, undefined);
  assert.equal(a.contextOf(t).org, "principal", "the session falls back to an organization the person still has");
  assert.deepEqual(a.deleteUser("pepe", "new1", "acme"), { deleted: true });
  // disabled organizations cannot be used; the legacy one cannot be disabled
  a.updateOrg("boss", "acme", { disabled: true }); assert.equal(a.canUseOrg(a.db.users.pepe, "acme"), false);
  assert.throws(() => a.updateOrg("boss", "principal", { disabled: true }), /principal/);
  // the audit of an organization does not leak another one's events
  a.audit("pepe", "x.test", { org: "acme" }); a.audit("boss", "y.test", { org: "principal" });
  assert.ok(a.readAudit(50, "acme").some((e) => e.action === "x.test") && !a.readAudit(50, "acme").some((e) => e.action === "y.test"));
});

test("upgrade from the single-company store: everything becomes the legacy organization, old administrators become super-admins", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collado-auth-v1-"));
  fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({ version: 1, users: { adm: { username: "adm", name: "adm", hash: "x", roles: ["admin"] }, ed: { username: "ed", name: "ed", hash: "x", roles: ["editor"] } },
    roles: { admin: { permissions: [], locked: true }, editor: { description: "e", permissions: ["app.view", "service.manage"] } } }));
  const a = new AuthStore(dir);
  assert.equal(a.db.version, 2); assert.equal(a.db.users.adm.super, true); assert.ok(!a.db.users.ed.super);
  assert.deepEqual(a.db.users.ed.memberships, { principal: { roles: ["editor"] } });
  assert.deepEqual(a.db.orgs.principal.roles.editor.permissions, ["app.view"], "platform permissions are stripped from organization roles");
  assert.ok(a.permissionsOf(a.db.users.adm, "principal").includes("service.manage") && !a.permissionsOf(a.db.users.ed, "principal").includes("service.manage"));
  assert.equal(fs.statSync(path.join(dir, "auth.json")).mode & 0o777, 0o600);
});

test("password policy, own password change revokes the other sessions, reset forces change", async () => {
  const a = mk();
  await a.createUser("cli", { username: "eva", password: "contraseña-larga-1", roles: ["editor"] }, "principal");
  await assert.rejects(a.createUser("cli", { username: "x1", password: "corta", roles: [] }, "principal"), (e) => e.status === 400);
  const s1 = (await a.login("eva", "contraseña-larga-1", req)).token, s2 = (await a.login("eva", "contraseña-larga-1", req)).token;
  await a.changeOwnPassword("eva", "contraseña-larga-1", "otra-clave-larga-2", s1);
  assert.ok(a.resolve(s1)); assert.equal(a.resolve(s2), null);
  const r = await a.updateUser("admin", "eva", { reset_password: true }, "principal");
  assert.ok(r.password.length >= 10); assert.equal(a.resolve(s1), null); assert.equal(a.db.users.eva.must_change, true);
});

test("store is persisted with mode 0600 and survives a reload; disabled users lose their session", async () => {
  const a = mk();
  await a.createUser("cli", { username: "zoe", password: "contraseña-larga-1", roles: ["admin"] }, "principal");
  await a.createUser("cli", { username: "leo", password: "contraseña-larga-1", roles: ["lector"] }, "principal");
  const tok = (await a.login("leo", "contraseña-larga-1", req)).token;
  assert.equal(fs.statSync(a.file).mode & 0o777, 0o600);
  const b = new AuthStore(a.dir);
  assert.equal(b.resolve(tok).username, "leo");
  await b.updateUser("zoe", "leo", { disabled: true }, "principal");
  assert.equal(b.resolve(tok), null);
  assert.ok(b.readAudit().some((e) => e.action === "user.disable"));
});

import { totpCode, verifyTotp, b32encode, b32decode } from "../gateway/lib/auth.mjs";

test("TOTP matches the RFC 6238 vectors and a code works once", () => {
  const secret = b32encode(Buffer.from("12345678901234567890"));
  assert.equal(secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.deepEqual(b32decode(secret), Buffer.from("12345678901234567890"));
  assert.equal(totpCode(secret, 1), "287082");               // t=59
  assert.equal(totpCode(secret, 37037036), "081804");        // t=1111111109
  const now = 59_000;
  assert.equal(verifyTotp(secret, "287082", 0, now), 1);
  assert.equal(verifyTotp(secret, "287082", 1, now), null, "same counter cannot be replayed");
  assert.equal(verifyTotp(secret, "000000", 0, now), null);
  assert.equal(verifyTotp(secret, "abc", 0, now), null);
});

test("2FA login: password then code; recovery codes are single-use; replays and wrong codes are rejected", async () => {
  const a = new AuthStore(fs.mkdtempSync(path.join(os.tmpdir(), "collado-2fa-")), { require2fa: true });
  await a.createUser("cli", { username: "eva", password: "contraseña-larga-1", roles: ["admin"] }, "principal");
  assert.equal(a.needsEnroll(a.db.users.eva), true);
  const first = await a.login("eva", "contraseña-larga-1", req);
  assert.ok(first.token, "without 2FA yet the session is issued (the gateway restricts it until enrolment)");
  const { secret } = a.startEnroll("eva");
  assert.throws(() => a.confirmEnroll("eva", "000000"), /no es correcto/);
  const counter = Math.floor(Date.now() / 30000);
  const codes = a.confirmEnroll("eva", totpCode(secret, counter));
  assert.equal(codes.length, 8); assert.equal(a.needsEnroll(a.db.users.eva), false);
  assert.throws(() => a.startEnroll("eva"), /Ya tienes/);

  const step1 = await a.login("eva", "contraseña-larga-1", req);
  assert.ok(step1.pending && !step1.token);
  await assert.rejects(a.loginTotp(step1.pending, "123456", req), /Código incorrecto/);
  await assert.rejects(a.loginTotp(step1.pending, totpCode(secret, counter), req), /Código incorrecto/, "the enrolment code cannot be replayed");
  const ok = await a.loginTotp(step1.pending, totpCode(secret, counter + 1), req);
  assert.equal(a.resolve(ok.token).username, "eva");
  await assert.rejects(a.loginTotp(step1.pending, totpCode(secret, counter + 1), req), /caducó/, "the pending login is consumed");

  const s2 = await a.login("eva", "contraseña-larga-1", req);
  const rec = await a.loginTotp(s2.pending, codes[0], req); assert.ok(rec.token);
  const s3 = await a.login("eva", "contraseña-larga-1", req);
  await assert.rejects(a.loginTotp(s3.pending, codes[0], req), /Código incorrecto/, "a recovery code works once");
  await assert.rejects(a.disableOwn2fa("eva", "contraseña-larga-1"), /obligatoria/);

  a.reset2fa("admin", "eva");
  assert.equal(a.resolve(rec.token), null, "reset revokes sessions"); assert.equal(a.needsEnroll(a.db.users.eva), true);
});

test("five wrong codes burn the pending login; X-Forwarded-For uses the rightmost entry", async () => {
  const a = new AuthStore(fs.mkdtempSync(path.join(os.tmpdir(), "collado-2fa-")), { trustProxy: true });
  await a.createUser("cli", { username: "leo", password: "contraseña-larga-1", roles: ["admin"] }, "principal");
  const { secret } = a.startEnroll("leo"); a.confirmEnroll("leo", totpCode(secret, Math.floor(Date.now() / 30000)));
  const r = { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" }, socket: { remoteAddress: "10.0.0.1" } };
  assert.equal(a.clientIp(r), "203.0.113.9");
  const p = (await a.login("leo", "contraseña-larga-1", r)).pending;
  for (let i = 0; i < 5; i++) await assert.rejects(a.loginTotp(p, "000000", r));
  await assert.rejects(a.loginTotp(p, "000000", r), (e) => e.status === 401 || e.status === 429);
});

test("changes made by the CLI (another process, same files) are seen by a running gateway", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collado-auth-"));
  const server = new AuthStore(dir), cli = new AuthStore(dir);   // the server started before the user existed
  const pw = await cli.cliUpsert("xcollado", { roles: ["admin"] });
  const { token } = await server.login("xcollado", pw, req);
  assert.equal(server.resolve(token).username, "xcollado");
  const pw2 = await cli.cliUpsert("xcollado");                  // password reset from the CLI: old sessions revoked, new password works
  assert.equal(server.resolve(token), null);
  await assert.rejects(server.login("xcollado", pw, req), AuthError);
  assert.ok((await server.login("xcollado", pw2, req)).token);
});
