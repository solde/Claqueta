// One system user per console user. In the pod (agentd runs as root) every user gets a real uid/gid, a /home/<user> on the persistent volume and a private tmux server;
// every process of theirs is started with `setpriv` (uid, gid, supplementary groups, no_new_privs) and a clean environment. Without root (development, CI) users
// share the uid but keep separate HOME directories, so the rest of the logic is the same and testable.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { signToken } from "./keys.mjs";
import { baseEnv, searchPath, linkDir } from "./platform.mjs";

export const NAME_RE = /^[a-z][a-z0-9._-]{1,31}$/;
export const RESERVED = new Set(["root", "daemon", "bin", "sys", "sync", "games", "man", "lp", "mail", "news", "uucp", "proxy", "www-data", "backup", "list", "irc", "gnats", "nobody", "node", "app", "agent", "gateway", "claude", "collado", "admin", "system", "sistema", "agente", "tmux", "git", "ubuntu", "debian", "sshd", "messagebus"]);
export const GID_USERS = 10010, GID_DEV = 10011, UID_APP = 10002, UID_FIRST = 20000;
const REQUIRED_ALLOW = ["Bash(collado-app:*)", "Bash(collado-api:*)", "Bash(collado-doc:*)", "Bash(git:*)", "WebSearch", "WebFetch"];

export class Users {
  /** `portable` = desktop build: one local person, no setpriv / `env -i` (they do not exist on Windows); processes get their clean environment through spawn's `env` option instead. */
  constructor({ root, homes, shared, state, apiUrl, ctlUrl, tokenKey, log = () => {}, sharedClaude = {}, portable = false, extraPath = [] }) {
    Object.assign(this, { root, homes, shared, state, apiUrl, ctlUrl, tokenKey, log, sharedClaude, portable, extraPath });
    fs.mkdirSync(state, { recursive: true }); fs.mkdirSync(homes, { recursive: true });
    this.file = path.join(state, "users.json"); this.db = this.#load();
  }
  #load() { try { return JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { return { users: {}, next: UID_FIRST }; } }
  #save() { const t = this.file + ".tmp"; fs.writeFileSync(t, JSON.stringify(this.db, null, 2), { mode: 0o600 }); fs.renameSync(t, this.file); }
  list() { return Object.values(this.db.users); }
  get(name) { return this.db.users[name]; }
  homeOf(name) { return path.join(this.homes, name); }

  /** Creates the system user on first use and keeps its groups and permissions current. Returns the registry entry. */
  ensure(name, perms = [], org = null) {
    if (!NAME_RE.test(name) || RESERVED.has(name)) throw new Error(`invalid_user:${name}`);
    let u = this.db.users[name];
    if (!u) {
      if (this.root && this.#inPasswd(name)) throw new Error(`reserved_user:${name}`);
      const uid = this.root ? this.db.next++ : process.getuid?.() ?? 0, id = this.root ? uid : process.getgid?.() ?? 0;
      u = this.db.users[name] = { name, uid, gid: id, created: new Date().toISOString(), perms: [], dev: false, last_attach: null, org: org || "principal" };
      this.log(`user ${name}: created uid=${uid}`);
    }
    let orgChanged = false; if (org && org !== u.org) { u.org = org; orgChanged = true; }   // the API token follows the organization the person is working in
    const dev = perms.includes("service.manage");
    if (dev !== u.dev || perms.join() !== u.perms.join()) { u.dev = dev; u.perms = perms; }
    this.#save(); this.#syncSystem(); this.#seedHome(u);
    if (orgChanged) this.refreshToken(u);
    return u;
  }
  groupsFor(u) { return this.root ? [GID_USERS, ...(u.dev ? [GID_DEV] : [])] : []; }
  #inPasswd(name) { try { return fs.readFileSync("/etc/passwd", "utf8").split("\n").some((l) => l.split(":")[0] === name); } catch { return false; } }

  /** /etc/passwd and /etc/group are not persistent in a container: re-create our entries (idempotent). */
  #syncSystem() {
    if (!this.root) return;
    const managed = (line) => { const [n, , id] = line.split(":"); const num = Number(id); return this.db.users[n] || num >= UID_FIRST || n === "app" || n === "collado-users" || n === "collado-dev"; };
    const rewrite = (file, extra) => { let cur = ""; try { cur = fs.readFileSync(file, "utf8"); } catch { /* new */ } const keep = cur.split("\n").filter((l) => l && !managed(l)); fs.writeFileSync(file, [...keep, ...extra].join("\n") + "\n"); };
    const us = this.list();
    rewrite("/etc/passwd", [`app:x:${UID_APP}:${UID_APP}:Collado app:/data/appdata:/usr/sbin/nologin`, ...us.map((u) => `${u.name}:x:${u.uid}:${u.gid}:Collado user:${this.homeOf(u.name)}:/bin/bash`)]);
    rewrite("/etc/group", [`app:x:${UID_APP}:`, `collado-users:x:${GID_USERS}:${us.map((u) => u.name).join(",")}`, `collado-dev:x:${GID_DEV}:app,${us.filter((u) => u.dev).map((u) => u.name).join(",")}`.replace(/,$/, ""), ...us.map((u) => `${u.name}:x:${u.gid}:`)]);
  }
  chown(p, u, recursive = false) { if (!this.root) return; try { fs.chownSync(p, u.uid, u.gid); if (recursive && fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p)) this.chown(path.join(p, f), u, true); } catch { /* best effort */ } }

  #seedHome(u) {
    const home = this.homeOf(u.name), w = (p, data, mode = 0o600) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data, { mode }); };
    for (const d of [home, path.join(home, "work"), path.join(home, ".claude"), path.join(home, ".collado")]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    const claudeMd = path.join(home, "CLAUDE.md");
    if (!fs.existsSync(claudeMd)) {
      const tpl = path.join(this.shared, "agent", "CLAUDE.template.md");
      const body = fs.existsSync(tpl) ? fs.readFileSync(tpl, "utf8").replaceAll("{{SHARED}}", this.shared).replaceAll("{{USER}}", u.name) : `@${this.shared}/agent/AGENT.md\n@${this.shared}/TEAM.md\n`;
      w(claudeMd, body, 0o644);
    }
    // settings: created once, then only the required permissions are added (never removed or reordered): the person owns the rest
    const sf = path.join(home, ".claude", "settings.json"); let s = {}; try { s = JSON.parse(fs.readFileSync(sf, "utf8")); } catch { /* new */ }
    s.permissions ||= { defaultMode: "acceptEdits", allow: [] }; s.permissions.allow ||= []; for (const a of REQUIRED_ALLOW) if (!s.permissions.allow.includes(a)) s.permissions.allow.push(a);
    s.env = { DISABLE_AUTOUPDATER: "1", ...(s.env || {}) }; w(sf, JSON.stringify(s, null, 2));
    // managed skills: symlinks into the shared directory (updated with every image)
    const skills = path.join(this.shared, "agent", "skills"), dst = path.join(home, ".claude", "skills"); fs.mkdirSync(dst, { recursive: true });
    if (fs.existsSync(skills)) for (const n of fs.readdirSync(skills)) { const l = path.join(dst, `collado-${n.replace(/^collado-/, "")}`); try { fs.rmSync(l, { recursive: true, force: true }); } catch { /* ignore */ } linkDir(path.join(skills, n), l); }
    const rc = path.join(home, ".bashrc"); if (!fs.existsSync(rc)) w(rc, `# Collado user shell\nexport PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"\nexport PS1='\\[\\e[1;33m\\]\\u\\[\\e[0m\\]@collado:\\w\\$ '\numask ${u.dev ? "002" : "077"}\n`, 0o644);
    if (!fs.existsSync(path.join(home, ".bash_profile"))) w(path.join(home, ".bash_profile"), "[ -f ~/.bashrc ] && . ~/.bashrc\n", 0o644);
    this.chown(home, u, true);
    fs.chmodSync(home, 0o700);
  }
  /** (Re)writes the person's API token: the app trusts it with exactly the permissions they had when it was issued. */
  refreshToken(u) {
    const f = path.join(this.homeOf(u.name), ".collado", "token"); fs.writeFileSync(f, signToken(this.tokenKey, { user: u.name, perms: u.perms, org: u.org || "principal" }) + "\n", { mode: 0o600 }); this.chown(f, u);
    return f;
  }

  /** Clean environment of a user process. */
  env(u, extra = {}) {
    const home = this.homeOf(u.name);
    if (this.portable) {   // desktop: the person's own PATH (Claude Code lives in ~/.local/bin or an npm prefix), a private HOME, nothing else from the host environment
      const dirs = [path.join(this.shared, "bin"), path.join(home, ".local", "bin"), path.join(home, ".npm-global", "bin"), ...this.extraPath];
      return { ...baseEnv(), HOME: home, USERPROFILE: home, USER: u.name, LOGNAME: u.name, TERM: "xterm-256color", COLORTERM: "truecolor", LANG: process.env.LANG || "en_US.UTF-8", TZ: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
        PATH: searchPath(dirs).join(path.delimiter), NPM_CONFIG_PREFIX: path.join(home, ".npm-global"), NPM_CONFIG_CACHE: path.join(home, ".npm-cache"),
        COLLADO_API: this.apiUrl, COLLADO_CTL: this.ctlUrl, COLLADO_USER: u.name, COLLADO_TOKEN_FILE: path.join(home, ".collado", "token"), COLLADO_SHARED: this.shared, DISABLE_AUTOUPDATER: "1", ...this.sharedClaude, ...extra };
    }
    return { HOME: home, USER: u.name, LOGNAME: u.name, SHELL: "/bin/bash", TERM: "xterm-256color", COLORTERM: "truecolor", LANG: "C.UTF-8", TZ: process.env.TZ || "Europe/Madrid",
      PATH: [path.join(home, ".local/bin"), path.join(home, ".npm-global/bin"), "/opt/claude/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":"), NPM_CONFIG_PREFIX: path.join(home, ".npm-global"), NPM_CONFIG_CACHE: path.join(home, ".npm-cache"),
      COLLADO_API: this.apiUrl, COLLADO_CTL: this.ctlUrl, COLLADO_USER: u.name, COLLADO_TOKEN_FILE: path.join(home, ".collado", "token"), COLLADO_SHARED: this.shared,
      GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: "*", DISABLE_AUTOUPDATER: "1", ...(process.env.LD_LIBRARY_PATH ? { LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH } : {}), ...this.sharedClaude, ...extra };
  }
  /** The `env` option to pass to spawn(): the portable build has no `env -i` wrapper, so it must be given explicitly (undefined = what wrap() already encodes). */
  spawnEnv(u, extra) { return this.portable ? this.env(u, extra) : undefined; }
  /** argv to run `argv` as user `u` with env `env`: [command, args]. */
  wrap(u, argv, env = this.env(u)) {
    if (this.portable) return [argv[0], argv.slice(1)];
    const envArgs = Object.entries(env).map(([k, v]) => `${k}=${v}`);
    if (!this.root) return ["env", ["-i", ...envArgs, ...argv]];
    return ["setpriv", [`--reuid=${u.uid}`, `--regid=${u.gid}`, `--groups=${[u.gid, ...this.groupsFor(u)].join(",")}`, "--no-new-privs", "env", "-i", ...envArgs, ...argv]];
  }
  run(u, argv, opts = {}) { const [cmd, args] = this.wrap(u, argv, opts.env); return spawnSync(cmd, args, { encoding: "utf8", cwd: opts.cwd, input: opts.input, timeout: opts.timeout, env: this.spawnEnv(u, opts.env) }); }
}
