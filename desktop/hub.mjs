// One process for the gateway AND agentd (they are two small servers that talk over loopback): in the desktop app that saves a whole Electron-as-Node process (~100 MB) with no change in
// behaviour. The editable app server stays in its own process (own heap limit, restarts independently). COLLADO_HUB tells the gateway not to exit on its own: agentd owns the shutdown,
// because it has to stop the app server and the consoles first.
process.env.COLLADO_HUB = "1";
await import("../gateway/agentd.mjs");
await import("../gateway/gateway.mjs");
