// Cross-platform helpers for the desktop build (macOS / Windows / Linux). In the pod none of this is used: users are real system users and everything goes through setpriv/tmux.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** True on Windows. */
export const IS_WIN = process.platform === "win32";
/** Inside Electron the "node" binary is the Electron executable and only behaves as Node with ELECTRON_RUN_AS_NODE=1. */
export const NODE_ENV = process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {};
/** Variables Windows needs in any child process (sockets, crypto, cmd.exe...). */
const WIN_KEYS = ["SystemRoot", "SYSTEMROOT", "windir", "ComSpec", "PATHEXT", "TEMP", "TMP", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "LOCALAPPDATA", "APPDATA", "USERNAME", "COMPUTERNAME", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"];
/** The few variables a child process needs to work at all on this platform (Windows needs system variables; elsewhere only a temp dir). */
export const baseEnv = () => (IS_WIN ? Object.fromEntries(WIN_KEYS.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])) : { TMPDIR: process.env.TMPDIR || os.tmpdir() });

/** The user's real command search path plus the usual places where Claude Code and friends get installed (a GUI app does not inherit the terminal's PATH on macOS/Linux). */
export function searchPath(extra = []) {
  const real = os.homedir(), sep = path.delimiter;
  const common = IS_WIN ? [path.join(real, ".local", "bin"), path.join(real, "AppData", "Roaming", "npm"), path.join(real, ".claude", "local")]
    : [path.join(real, ".local", "bin"), path.join(real, ".claude", "local"), path.join(real, ".npm-global", "bin"), path.join(real, ".volta", "bin"), path.join(real, ".bun", "bin"), "/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/local/sbin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  const seen = new Set(), out = [];
  for (const d of [...extra, ...String(process.env.PATH || "").split(sep), ...common]) if (d && !seen.has(d)) { seen.add(d); out.push(d); }
  return out;
}
/** Absolute path of an executable found in `dirs`, or null. */
export function which(cmd, dirs) {
  const exts = IS_WIN ? String(process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").concat([""]) : [""];
  for (const d of dirs) for (const e of exts) { const f = path.join(d, cmd + e); try { if (fs.statSync(f).isFile()) { if (!IS_WIN) fs.accessSync(f, fs.constants.X_OK); return f; } } catch { /* next */ } }
  return null;
}
/** Directory symlinks need a privilege on Windows; junctions do not. */
export const linkDir = (target, link) => fs.symlinkSync(target, link, IS_WIN ? "junction" : undefined);

/** Small launchers so the agent (and the person's shell) can run `collado-api`, `collado-doc` and `collado-app` without Node installed. */
export function installToolLaunchers(binDir, toolsDir, nodeBin = process.execPath) {
  fs.mkdirSync(binDir, { recursive: true });
  for (const t of ["collado-api", "collado-doc", "collado-app"]) {
    const js = path.join(toolsDir, `${t}.mjs`);
    if (IS_WIN) fs.writeFileSync(path.join(binDir, `${t}.cmd`), `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${nodeBin}" "${js}" %*\r\n`);
    else fs.writeFileSync(path.join(binDir, t), `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${nodeBin}" "${js}" "$@"\n`, { mode: 0o755 });
  }
}
