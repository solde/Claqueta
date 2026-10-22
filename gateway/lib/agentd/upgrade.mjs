// Installing and upgrading the editable app from the image seed. The app dir is a git repo with a pure `seed` branch: on upgrade the new seed is committed there and merged
// into the agent's branch with `-X theirs` (non-conflicting customisations survive, conflicts take the new seed; the previous code stays in a tag). Idempotent.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function seedHash(dir) {
  const h = crypto.createHash("sha256"); const walk = (d, rel = "") => { for (const f of fs.readdirSync(d).sort()) { if (f === "node_modules" || f === ".git") continue; const p = path.join(d, f), r = path.join(rel, f); const st = fs.statSync(p); if (st.isDirectory()) walk(p, r); else { h.update(r + "\0"); h.update(fs.readFileSync(p)); } } };
  walk(dir); return h.digest("hex").slice(0, 16);
}
const rmAll = (dir, keep = new Set()) => { for (const f of fs.readdirSync(dir)) if (!keep.has(f)) fs.rmSync(path.join(dir, f), { recursive: true, force: true }); };
const GITIGNORE = "node_modules/\n*.log\n.env\n.collado-seed\n";

/** Returns "installed" | "current" | "merged" | "replaced". `sup` is the Supervisor (for git as the right user). */
export function installOrUpgradeApp({ sup, seedAppDir, appDir, log }) {
  const hash = seedHash(seedAppDir), stateFile = path.join(appDir, ".collado-seed"), g = (...a) => sup.git(...a);
  const copySeed = () => fs.cpSync(seedAppDir, appDir, { recursive: true });
  const stamp = () => fs.writeFileSync(stateFile, JSON.stringify({ hash, at: new Date().toISOString() }));
  fs.mkdirSync(appDir, { recursive: true });
  if (!fs.existsSync(path.join(appDir, "server.mjs"))) {
    copySeed(); fs.writeFileSync(path.join(appDir, ".gitignore"), GITIGNORE);
    g("init", "-q", "-b", "main"); g("add", "-A"); g("commit", "-q", "-m", "seed: original app"); g("branch", "-f", "seed", "HEAD"); stamp(); log(`app installed from the seed ${hash}`); return "installed";
  }
  let cur = {}; try { cur = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { /* legacy install */ }
  if (cur.hash === hash) return "current";
  if (!fs.existsSync(path.join(appDir, ".git"))) { fs.writeFileSync(path.join(appDir, ".gitignore"), GITIGNORE); g("init", "-q", "-b", "main"); g("add", "-A"); g("commit", "-q", "-m", "seed: existing app"); }
  const branch = g("symbolic-ref", "--short", "HEAD").stdout.trim() || "main";
  if (g("rev-parse", "--verify", "-q", "seed").status !== 0) { const root = g("rev-list", "--max-parents=0", branch).stdout.trim().split("\n").pop(); g("branch", "seed", root); }
  g("add", "-A"); g("commit", "-q", "-m", `snapshot: before seed upgrade ${hash}`);
  const tag = `pre-upgrade-${new Date().toISOString().slice(0, 10)}-${hash.slice(0, 6)}`; g("tag", "-f", tag, "HEAD");
  // 1. new seed on the seed branch
  g("checkout", "-q", "seed"); rmAll(appDir, new Set([".git", "node_modules", ".collado-seed"])); copySeed(); fs.writeFileSync(path.join(appDir, ".gitignore"), GITIGNORE); g("add", "-A"); g("commit", "-q", "--allow-empty", "-m", `seed: ${hash}`);
  // 2. merge into the working branch
  g("checkout", "-q", branch);
  const m = g("merge", "-X", "theirs", "--no-edit", "-m", `seed upgrade ${hash}`, "seed");
  if (m.status === 0) { stamp(); log(`app upgraded to the seed ${hash} (merged; previous code: tag ${tag})`); return "merged"; }
  g("merge", "--abort"); g("reset", "-q", "--hard", tag);
  g("read-tree", "-u", "--reset", "seed"); g("add", "-A"); g("commit", "-q", "-m", `seed upgrade ${hash}: conflicts, took the new seed (previous code: tag ${tag})`);
  fs.writeFileSync(path.join(appDir, "UPGRADE-NOTES.md"), `# Seed upgrade ${hash}\n\nThe image brought a new version of the app and some of the previous customisations conflicted with it, so the new seed was taken as is.\nYour previous code is in the git tag \`${tag}\`:\n\n    git diff ${tag} HEAD    # what changed\n    git checkout ${tag} -- path/to/file   # recover a file\n\nRe-apply the customisations you still want and delete this file.\n`);
  stamp(); log(`app upgraded to the seed ${hash} (conflicts: replaced; previous code: tag ${tag})`); return "replaced";
}

/** Managed agent files (instructions, skills) are overwritten on every new image; TEAM.md belongs to the team and is only created. */
export function installShared({ seedWorkspace, shared, log }) {
  fs.mkdirSync(shared, { recursive: true }); const stateFile = path.join(shared, ".collado-seed"), hash = fs.existsSync(path.join(seedWorkspace, "agent")) ? seedHash(path.join(seedWorkspace, "agent")) : "none";
  let cur = {}; try { cur = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { /* first run */ }
  if (fs.existsSync(path.join(seedWorkspace, "agent")) && cur.hash !== hash) { fs.rmSync(path.join(shared, "agent"), { recursive: true, force: true }); fs.cpSync(path.join(seedWorkspace, "agent"), path.join(shared, "agent"), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify({ hash })); log(`agent guidelines installed (${hash})`); }
  const team = path.join(shared, "TEAM.md"); if (!fs.existsSync(team) && fs.existsSync(path.join(seedWorkspace, "TEAM.md"))) fs.copyFileSync(path.join(seedWorkspace, "TEAM.md"), team);
}
