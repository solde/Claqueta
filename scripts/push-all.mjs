// Pushes everything to every remote in one go (the rule of this project: Gitea AND GitHub, always):
//   1. the full repository (this checkout) to its `origin` on Gitea;
//   2. the standalone desktop repository (`scripts/export-desktop.mjs`) to Gitea (claqueta-desktop) and to GitHub (solde/Claqueta).
// The two desktop remotes grew from different first commits, so the local export clone keeps both histories: when GitHub's branch is not an ancestor of ours it is merged with
// `-s ours` (our tree wins, nothing is rewritten) and both remotes then accept plain fast-forward pushes. No force push is ever used.
// Usage: node scripts/push-all.mjs [--message "text"] [--export-dir ~/.cache/claqueta-export] [--ssh-key ~/.ssh/gitea] [--github git@github.com:solde/Claqueta.git] [--dry-run]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; }, dry = args.includes("--dry-run");
const home = (p) => p.replace(/^~(?=\/)/, os.homedir());
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "desktop", "update.config.json"), "utf8"));
const GITEA = `${cfg.host}/${cfg.repo}.git`, GITHUB = opt("github", "git@github.com:solde/Claqueta.git"), DIR = path.resolve(home(opt("export-dir", "~/.cache/claqueta-export"))), KEY = home(opt("ssh-key", "~/.ssh/gitea"));
const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: `ssh -i ${KEY} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new` };
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }).trim();
const tryGit = (cwd, ...a) => { try { return git(cwd, ...a); } catch { return null; } };
const say = (m) => console.log(m);

if (git(ROOT, "status", "--porcelain")) { console.error("the working tree has uncommitted changes: commit them first"); process.exit(1); }

// 1. the full repository
const branch = git(ROOT, "rev-parse", "--abbrev-ref", "HEAD");
say(`full repository: pushing ${branch} to origin`); if (!dry) say(git(ROOT, "push", "origin", branch) || "pushed");

// 2. the desktop repository, kept in a persistent clone so history accumulates one commit per export
if (!fs.existsSync(path.join(DIR, ".git"))) { fs.mkdirSync(path.dirname(DIR), { recursive: true }); git(path.dirname(DIR), "clone", "-q", GITEA, DIR); }
for (const [name, url] of [["origin", GITEA], ["github", GITHUB]]) { if (tryGit(DIR, "remote", "get-url", name) === null) git(DIR, "remote", "add", name, url); else git(DIR, "remote", "set-url", name, url); }
git(DIR, "fetch", "-q", "origin"); tryGit(DIR, "fetch", "-q", "github");
git(DIR, "checkout", "-q", "-B", "main", "origin/main"); git(DIR, "reset", "-q", "--hard", "origin/main");
const gh = tryGit(DIR, "rev-parse", "-q", "--verify", "github/main");
if (gh && tryGit(DIR, "merge-base", "--is-ancestor", gh, "HEAD") === null) {
  say("desktop repository: joining GitHub's history (merge -s ours, nothing is rewritten)");
  git(DIR, "-c", "user.name=export", "-c", "user.email=export@localhost", "merge", "-q", "-s", "ours", "--allow-unrelated-histories", "-m", "Join the GitHub history", gh);
}
say(execFileSync(process.execPath, [path.join(ROOT, "scripts", "export-desktop.mjs"), DIR, ...(opt("message") ? ["--message", opt("message")] : [])], { cwd: ROOT, encoding: "utf8", env }).trim());
for (const remote of ["origin", "github"]) { say(`desktop repository: pushing main to ${remote} (${remote === "origin" ? GITEA : GITHUB})`); if (!dry) say(git(DIR, "push", "-q", remote, "main") || "pushed"); }
