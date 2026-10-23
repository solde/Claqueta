#!/usr/bin/env node
// Control of the app supervisor for the agent and for people in the shell: collado-app status | logs [n] | restart | rollback | reset
// (restart/rollback/reset/logs need the service.manage permission: only people who can change the code can run them)
import { ctl, fail } from "./client.mjs";
const [cmd = "status", arg] = process.argv.slice(2);
const show = (s) => console.log(`app: ${s.app.state}${s.app.healthy ? " (sana)" : ""} · pid ${s.app.pid ?? "-"} · reinicios ${s.app.restarts} · uptime ${s.app.uptime_s}s`);
if (cmd === "status") show(await ctl("GET", "/status"));
else if (cmd === "logs") console.log((await ctl("GET", `/logs?n=${+arg || 100}`)).lines.join("\n"));
else if (["restart", "rollback", "reset"].includes(cmd)) { const s = await ctl("POST", "/" + cmd, {}); if (s.backup) console.log("copia del código anterior:", s.backup); show(s); }
else fail("uso: collado-app status | logs [n] | restart | rollback | reset", 2);
