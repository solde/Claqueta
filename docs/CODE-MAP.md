# Mapa del código

_Generado por `scripts/docs-code-map.mjs` a partir de la primera frase del comentario de cabecera de cada fichero (todo fichero fuente debe empezar con uno). No lo edites a mano: cambia la cabecera del fichero y ejecuta `npm run docs`._

Para entender cómo encajan las piezas, lee antes [SOFTWARE.md](SOFTWARE.md). Las reglas para escribir y mantener esta documentación están en [DOCUMENTATION.md](DOCUMENTATION.md).

## `desktop/`
Aplicación de escritorio (Electron): ventana, procesos hijos, bloqueo de red, render de documentos, sincronización en la nube, actualizaciones.

| Fichero | Para qué sirve |
|---|---|
| `brand.mjs` | The name the desktop app shows to the person (window, menus, dialogs, installer, the shell's top bar). |
| `hub.mjs` | One process for the gateway AND agentd (they are two small servers that talk over loopback): in the desktop app that saves a whole Electron-as-Node process (~100 MB) with no change in behaviour. |
| `main.mjs` | Main process of the Claqueta desktop app (macOS, Windows, Linux): starts and supervises the local servers and shows the window. |
| `preload.cjs` | The only bridge between the page and the operating system. |
| `render-service.mjs` | Document rendering for the desktop build, done by Electron's own Chromium (so there is nothing to install: no WeasyPrint, no librsvg, no Python). |
| `selftest.mjs` | End-to-end checks that run inside the real window (`electron . --smoke-test=out.png`): the same requests the UI makes, against the real servers. |
| `sync/controller.mjs` | Orchestrates cloud sync for the desktop app: connect / disconnect, the decision at start-up (pull what another computer pushed, handle conflicts and the one-computer-at-a-time lease), periodic lease renewal and pushes while the app runs, and the final push when it closes. |
| `sync/crypto.mjs` | Encryption of everything that leaves this computer. |
| `sync/engine.mjs` | Cloud sync of the whole Collado workspace, provider-agnostic (a folder, Google Drive, OneDrive: see ./providers). |
| `sync/oauth.mjs` | OAuth 2.0 for a desktop application: authorization code + PKCE with a loopback redirect (RFC 8252). |
| `sync/providers/folder.mjs` | A folder as the "cloud": the folder that Google Drive for desktop or OneDrive already keeps in sync on this computer (or any shared/network folder). |
| `sync/providers/google.mjs` | Google Drive (REST v3). Scope drive.file: Collado can only see the files it created itself, never the rest of the Drive. |
| `sync/providers/http.mjs` | Small shared HTTP layer for the cloud providers: bearer token, retries with back-off on throttling and server errors, one forced refresh on 401. |
| `sync/providers/microsoft.mjs` | OneDrive through Microsoft Graph. |
| `update.mjs` | "Buscar actualizaciones": asks the release page of the repository (Gitea API) whether there is a newer version and which installer fits this computer. |

## `gateway/`
Gateway (login, roles, 2FA, shell web, proxy) y agentd (usuarios, consolas, supervisor de la app, archivos, trabajos del agente).

| Fichero | Para qué sirve |
|---|---|
| `agentd.mjs` | agentd, the control daemon behind the gateway: system users, consoles, the supervisor of the app, file operations and agent jobs (in the desktop build it runs inside the hub process). |
| `gateway.mjs` | Claqueta gateway, the front door: the ONLY thing exposed to the network (via the private Traefik; on the desktop only to this computer). |
| `lib/agentd/claudelogin.mjs` | Automatic Claude Code login (desktop): agentd runs `claude auth login` for the person in the background. |
| `lib/agentd/console.mjs` | Persistent consoles: one tmux server per user (socket `collado-<user>`), sessions `claude` and `shell`. |
| `lib/agentd/files.mjs` | File manager backend: every operation runs fsops.mjs as the person (see there), agentd only authenticates, routes and streams. |
| `lib/agentd/fsops.mjs` | File operations on one person's home, executed AS that person (setpriv in the pod): it can only do what their uid can do, so a symlink or a ".." cannot reach anything else. |
| `lib/agentd/jobs.mjs` | Headless agent runs (`claude -p`) on behalf of a person: same system user, same Claude login and settings as their console. |
| `lib/agentd/keys.mjs` | Shared secrets inside the pod. |
| `lib/agentd/platform.mjs` | Cross-platform helpers for the desktop build (macOS / Windows / Linux). |
| `lib/agentd/ptyconsole.mjs` | Persistent consoles WITHOUT tmux (it does not exist on Windows): the Claude and shell sessions of each person are node-pty processes owned by agentd, with a scrollback buffer that is replayed to every new WebSocket. |
| `lib/agentd/supervisor.mjs` | Supervisor of the editable app: runs it as the `app` user, restarts it when its files change or it crashes, keeps its log, takes git snapshots when it is healthy, offers rollback / reset to the image seed. |
| `lib/agentd/upgrade.mjs` | Installing and upgrading the editable app from the image seed. |
| `lib/agentd/users.mjs` | One system user per console user. |
| `lib/auth.mjs` | Users, roles (RBAC), sessions and audit log of the Claqueta gateway. |
| `static/files.js` | Claqueta file manager ("Archivos"): a Finder-like explorer over the person's own home folder. |
| `static/icons.js` | GENERATED by scripts/build-icons.mjs: do not edit. |
| `static/index.html` | The shell of the application: one top bar (navigation, search, notifications, console toggle, user menu), the app in an iframe, the console dock and the file manager. |
| `static/login.html` | Login page (password and TOTP code). |
| `static/login.js` | Two-step login: password, then (when the account has 2FA) the TOTP / recovery code. |
| `static/nb.css` | Claqueta neobrutalism kit — tokens + atomic components. |
| `static/neu.css` | Collado desktop skin: Neumorphism 2.0 (soft, extruded surfaces with a double light/dark shadow, large radii, pastel accents, charcoal primary actions). |
| `static/onboard.js` | First-login tutorial: walks a new person through logging in to Claude Code in THEIR console (each person has their own system user and login). |
| `static/shell.css` | Shell (tabs, console, service and admin screens) in the neobrutalism kit: thick borders, hard shadows, flat colours, no blur/gradients/transparency. |
| `static/shell.js` | Claqueta shell: ONE top bar (navigation, global search, notifications, agent, console toggle, user menu), the app in an iframe, a console dock on the right (open / close / maximise / resize), the service panel and users + roles administration. |
| `static/theme.css` | Claqueta shell and login: legacy class names mapped to the neobrutalism kit (nb.css must be loaded first). |
| `static/tour.js` | Guided tour of the whole platform: highlights each zone of the shell, switches view / opens the console for you, and offers a "try it" button. |

## `app-seed/app/lib/`
Servidor de la app: motor de datos, reglas de negocio, informes, API, motor de documentos, memorias, gráficos, predicción de audiencias.

| Fichero | Para qué sirve |
|---|---|
| `access.mjs` | Identity and permissions. The gateway authenticates and sends x-collado-* headers; requests without them come from inside the pod (the agent, curl on 127.0.0.1) and are trusted with every permission. |
| `actions.mjs` | Operations that are more than one CRUD call: imports (ratings, bank), reconciliation, accounting exports, calendar export, checklists, scheduling helpers. |
| `agent-client.mjs` | How the app asks for an agent run. |
| `alerts.mjs` | Alerts (things that need attention) and the portfolio dashboard. |
| `crypto.mjs` | AES-256-GCM for `secret` fields and attachments. |
| `db.mjs` | SQLite (node:sqlite) setup: pragmas, tiny query helpers, transactions, and additive table/column creation from the schema. |
| `docs/brand.mjs` | Brand kits -> render brand (logo/fonts resolved) -> stylesheet for HTML/PDF. |
| `docs/charts.mjs` | Minimal SVG charts (bar, hbar, line, donut, gantt) drawn from dataset rows. |
| `docs/datasets.mjs` | Data sources for documents: named queries that return { title, columns, rows, totals?, chart? } already filtered by the caller's permissions. |
| `docs/docx.mjs` | Claqueta AST -> .docx (WordprocessingML) without libraries. |
| `docs/format.mjs` | Locale-aware formatting and the fixed strings of generated documents (cover labels, TOC title, page counters...). |
| `docs/graphics.mjs` | Graphics for memoirs and documents, drawn as SVG from a small declarative spec in the colours and fonts of the brand kit. |
| `docs/html.mjs` | AST -> standalone, print-ready HTML (also the format the PDF renderer consumes). |
| `docs/imageinfo.mjs` | Size and type of an image from its first bytes (png, jpeg, gif, webp, svg): enough to lay out a gallery without decoding the picture. |
| `docs/lint.mjs` | Quality checks for a document before it is sent out: unresolved variables, failed data blocks, leftover placeholders, structure problems, length. |
| `docs/markdown.mjs` | Claqueta Markdown -> AST. CommonMark-ish subset + GFM tables/task lists + directives: :::name key=value key="two words" ...content... |
| `docs/render.mjs` | Orchestrator of the document engine: gathers context (programme, episode, company, variables), expands the template, parses Claqueta Markdown, resolves data/chart blocks with the caller's permissions, and renders to HTML / PDF / DOCX / XLSX / Markdown. |
| `docs/seed.mjs` | Built-in brand kits and document templates (Spanish). |
| `docs/vars.mjs` | Template variables: {{path.to.value \| filter:arg \| filter}}, {{#if cond}}..{{else}}..{{/if}}, {{#each list}}..{{this.x}} {{@index}}..{{/each}}. |
| `docs/xlsx.mjs` | Dataset/table -> .xlsx without libraries: typed cells (money, dates, percentages), brand-coloured headers, frozen header row, filters, live SUM totals, print setup. |
| `docs/zip.mjs` | Tiny ZIP writer (deflate) for OOXML containers: no dependencies. |
| `engine.mjs` | Generic entity engine: validation, CRUD, filters, change log, field encryption, external scoping, hooks. |
| `files.mjs` | Attachments: encrypted files (contracts, invoices, call sheets, logos, fonts...) stored under DATA/files, or plain links to external storage (NAS, cloud). |
| `forecast.mjs` | Audience forecasting from the measured history of a programme. |
| `i18n/ca.mjs` | Catalan labels: entities, groups, fields and option values (see es.mjs for the structure; ui.ca.mjs has the interface texts). |
| `i18n/en.mjs` | English labels: entities, groups, fields and option values (see es.mjs for the structure; ui.en.mjs has the interface texts). |
| `i18n/es.mjs` | Castellano. Key families: e (entities "singular\|plural"), g (groups), f (fields), fe ("entity.field" overrides), o (option labels), oe ("[entity.]field.value" overrides). |
| `i18n/index.mjs` | Label resolution shared by the server (documents, exports) and the client (served as JSON by /api/i18n/:lang). |
| `i18n/ui.ca.mjs` | Textos de la interfície (català). |
| `i18n/ui.en.mjs` | UI texts (English): the labels and phrases of the interface (`ui`) and the error messages (`msg`); ui.es.mjs and ui.ca.mjs must have the same keys (a test checks it). |
| `i18n/ui.es.mjs` | Textos de la interfaz (castellano). |
| `jobs.mjs` | Headless agent generations: "write me an audience study / bible / dossier..." for a programme. |
| `logic.mjs` | Business rules attached to the engine: computed amounts, numbering, approvals, notifications, status side effects. |
| `maintenance.mjs` | Periodic housekeeping: status flips that depend on dates, weekly digest of high alerts as notifications, old notification cleanup, orphan file sweep. |
| `media.mjs` | The image gallery of a programme: adding pictures (uploaded or generated), reading them back (full size, thumbnail or reduced for a document). |
| `memoir-catalog.mjs` | Catalogue of the sections of a project memoir ("memoria de proyecto") and of the fields each one needs. |
| `memoir.mjs` | Project memoirs: the facts the app already knows, the sections people (or the agent) write, and the assembly into one editable document. |
| `migrate-v1.mjs` | One-time move from the first version of the app (projects/documents/tasks/personas/competitors/episodes/jobs) to the programme model. |
| `project-guide.mjs` | Desktop build: when a programme has a local folder, that folder gets its own CLAUDE.md (the rules for the agent in THAT project: where files go, what to check before making documents). |
| `reports.mjs` | Read-only computations over the data: budget vs actual, cashflow, taxes, profitability, resource conflicts, working time, rundown timing, gantt, ratings, delivery readiness, rights coverage. |
| `routes.mjs` | HTTP API. Everything under /api; static files are served by server.mjs. |
| `schema/broadcast.mjs` | Module H — schedule grid, airings and audience data, audience research (targets, competition). |
| `schema/core.mjs` | Module A/B/I — programmes, seasons, episodes, planning, tasks, collaboration. |
| `schema/docs.mjs` | Documents, brands (visual identity), document templates, generated files, agent jobs, app users. |
| `schema/dsl.mjs` | Tiny DSL to declare entities. A field is { type, required, default, options, to, ro, perm, ... }: text long int num pct money bool date datetime time enum ref json tags secret `perm`: { read: "people.view", write: "people.edit" } restricts one field (e.g. rates, national ids) inside an otherwise vis |
| `schema/finance.mjs` | Module D (+ commercial) — budgets (versions), actual costs, purchase orders, invoicing, payments, bank reconciliation, grants, sponsorship. |
| `schema/legal.mjs` | Module E — contracts, rights (formats, music, archive, talent), cue sheets, GDPR (processing register, consents, data-subject requests, retention). |
| `schema/media.mjs` | Modules F/G — assets (light MAM: metadata + link to real storage), delivery specs, QC, issues, delivery packages, editorial compliance. |
| `schema/memoir.mjs` | Module M — project memoirs: the image gallery, shoot locations and the memoirs written section by section (see lib/memoir-catalog.mjs for the sections and their fields). |
| `schema/people.mjs` | Module C — people (staff, freelance, talent, guests), availability, studios & equipment, bookings, crew, collective agreements, timesheets. |
| `schema.mjs` | Aggregates the entity definitions and derives what the engine and the UI need. |
| `seeds.mjs` | First-run content: workflow templates per programme type, budget skeletons, delivery specs, a generic working-time agreement, GDPR starters, settings. |
| `token.mjs` | Verification of the signed tokens agentd gives to console users (the same format agentd signs). |
| `util.mjs` | Small helpers shared by the whole app: errors, HTTP, dates, money, CSV. |

## `app-seed/app/public/`
Interfaz de la app (SPA sin compilación): módulos JS, vistas, estilos y service worker.

| Fichero | Para qué sirve |
|---|---|
| `app.css` | App layout and specialised views on top of the neobrutalism kit (nb.css). |
| `index.html` | The single page of the app (a SPA with no build step): loads js/main.js, which routes by URL hash and renders every view with the h() helper. |
| `js/agent.js` | Sends a request to the person's agent console (the shell that hosts the app types it there). |
| `js/api.js` | fetch wrapper: relative URLs only (the app lives under /app/ behind the gateway), JSON in/out, errors as exceptions with a stable `code`. |
| `js/calendar.js` | Month grid + week/timeline helpers used by the entity calendar view and the master calendar. |
| `js/charts.js` | Small SVG charts in the neobrutalism palette (CSS variables, thick strokes, no gradients). |
| `js/detail.js` | Generic record page: editable form + comments, files, approvals, history, and automatic "related records" for every entity that points here. |
| `js/dom.js` | Hyperscript helper: h("div.class#id", { onclick, style: {...}, dataset: {...} }, child, [children], "text"). |
| `js/forms.js` | Generic form builder driven by the schema: every field type, reference pickers, sections, validation, create/update with optimistic concurrency. |
| `js/i18n.js` | Client i18n: dictionary comes from the server (api/i18n/<lang>), so the UI, the documents and the exports speak with the same labels. |
| `js/icons.js` | GENERATED by scripts/build-icons.mjs: do not edit. |
| `js/lists.js` | Generic entity list: table / board / calendar views, search, sort, status chips, create, row actions, CSV export. |
| `js/main.js` | Boot, navigation, router. Views are loaded lazily (ES modules, no build step). |
| `js/md.js` | Tiny safe Markdown renderer for comments and agent outputs (escape first, then a few inline/blocks rules). |
| `js/offline.js` | Partial offline support: a queue (IndexedDB) of small field updates made while the network is down; replayed when it comes back. |
| `js/ui.js` | UI components in the neobrutalism kit (nb.css). |
| `js/views/broadcast.js` | Audiences: summary, charts and CSV import of measurement data. |
| `js/views/dashboard.js` | Dashboard (portfolio view), alerts page. |
| `js/views/docs.js` | Documents: generation dialog (templates -> editable document or direct PDF/DOCX/HTML), editor with live preview and lint, agent generations page. |
| `js/views/extras.js` | Specialised sections of record pages: episode readiness, QC checklist, delivery package, cue sheet export, job output... |
| `js/views/finance.js` | Finance: budget editor (versions, actuals), cashflow, taxes, bank reconciliation, profitability. |
| `js/views/forecast.js` | Audience forecast: expected audience and share of the next broadcasts of a programme (from its measured history), plus a what-if for any slot. |
| `js/views/gallery.js` | Image gallery of a programme: upload (also by drag and drop), captions, credits and rights, featured pictures, generated graphics, and a request to the agent. |
| `js/views/graphics.js` | Graphic generator: pick a type, fill in its few fields (or the full JSON), preview it with the brand kit and either store it in the gallery or use it live in a section. |
| `js/views/memoir.js` | Project memoirs: list and creation, and the editor that works section by section (guide, real data, structured fields, text, images, graphics, agent). |
| `js/views/planning.js` | Planning: master calendar with resource conflicts, rundown (escaleta) editor, gantt. |
| `js/views/programs.js` | Programme list (cards) and the programme workspace: one place with every module filtered to the programme. |
| `js/views/settings.js` | Settings: company, finance, alerts, compliance checklists, capabilities, language. |
| `nb.css` | Claqueta neobrutalism kit — tokens + atomic components. |
| `neu.css` | Collado desktop skin: Neumorphism 2.0 (soft, extruded surfaces with a double light/dark shadow, large radii, pastel accents, charcoal primary actions). |
| `sw.js` | Service worker: offline support for the shell (static files) and read-only fallback for the API GETs the field work needs (rundowns, schedules, tasks...). |

## `tools/`
Herramientas de línea de comandos del agente (`collado-api`, `collado-doc`, `collado-app`) y sus ayudantes.

| Fichero | Para qué sirve |
|---|---|
| `client.mjs` | Shared by the agent tools: where the app and agentd are, and the person's API token (written by agentd on every console attach). |
| `collado-api.mjs` | Talk to the Claqueta API with YOUR permissions (the token in ~/.collado/token). |
| `collado-app.mjs` | Control of the app supervisor for the agent and for people in the shell: collado-app status \| logs [n] \| restart \| rollback \| reset (restart/rollback/reset/logs need the service.manage permission: only people who can change the code can run them) |
| `collado-doc.mjs` | Document toolbox for agents and people: render Claqueta Markdown (see the collado-documentos skill) to PDF / Word / HTML with a brand kit, preview pages as PNG to check the layout, lint, create editable documents in the app, export tables to Excel, build slide decks. |
| `colladodeck.py` | Build a PowerPoint from a JSON spec with python-pptx, using the brand kit (colours, fonts). |
| `colladodoc.py` | Helpers for building Word/Excel files by hand with python-docx / openpyxl in the team's brand (colours, fonts, margins) when the Markdown route is not enough. |
| `doccheck.mjs` | "Caja de herramientas" for documents: which of the things that make documents come out at the best possible quality are available on THIS computer, what is lost if one is missing, and the exact command to install it on this operating system. |

## `scripts/`
Scripts de desarrollo, generación de documentación y publicación.

| Fichero | Para qué sirve |
|---|---|
| `build-icons.mjs` | Icon set of the UI (replaces the emoji): 24x24 outline icons drawn with currentColor, so they follow the theme (light/dark) and the text colour of whatever contains them. |
| `docs-all.mjs` | Regenerates every generated document in one go: icons, the memoir study, the HTTP reference, the data model and the code map. |
| `docs-api.mjs` | Writes docs/API.md: the HTTP interfaces of the three layers (gateway, agentd, app). |
| `docs-code-map.mjs` | Writes docs/CODE-MAP.md: the index of every source file with the first sentence of its header comment (the "what is this file for" that every file must start with). |
| `docs-data-model.mjs` | Writes docs/DATA-MODEL.md: every entity of the application (what becomes a table, an API resource, a form and a list) with its fields, generated from lib/schema/*.mjs so the reference cannot drift from the code. |
| `export-desktop.mjs` | Exports ONLY the desktop app (Claqueta) from this repository into a standalone repository: no server deployment (Dockerfile, deploy/, ops docs, e2e stack), a desktop README, a Gitea Actions release workflow and a downloads page. |
| `gitea-auth.mjs` | Authentication for the Gitea API without a token: HTTP Signatures (draft-cavage) made with an SSH key that is registered in the Gitea account. |
| `make-icons.mjs` | Renders app-seed/app/public/icon.svg into build/icon.png (1024x1024, rounded square with the usual margin). |
| `memoir-study.mjs` | Writes docs/MEMORIAS.md: the study of what a project memoir needs (sections, fields, data the app fills in, visuals), generated from the catalogue the app uses, so the document and the product cannot drift apart. |
| `publish-release.mjs` | Publishes installers to a Gitea release: creates the release for the tag if it does not exist, uploads every installer found in --dir (replacing an asset of the same name) and a SHA256SUMS.txt covering everything attached. |
| `push-all.mjs` | Pushes everything to every remote in one go (the rule of this project: Gitea AND GitHub, always): 1. |
| `vendor.mjs` | Copies the front-end libraries from node_modules into gateway/static/vendor (the same files the Dockerfile copies), so the program never needs a CDN or the network at run time. |

## `tests/`
Pruebas unitarias y de integración.

| Fichero | Para qué sirve |
|---|---|
| `access.test.mjs` | Unit tests of identity and permissions (app/lib/access.mjs, token.mjs): which caller a request resolves to in production and in development, and where the organization comes from. |
| `agent-guides.test.mjs` | Unit tests of the agent guidelines: the CLAUDE.md files created for each person and project (desktop and server templates, repaired imports), the shipped guideline files and `collado-doc check`. |
| `agentd.test.mjs` | Unit tests of agentd building blocks (gateway/lib/agentd): derived keys and signed tokens, console users and their homes, and installing/upgrading the editable app from the seed. |
| `auth.test.mjs` | Unit tests of the gateway login store (gateway/lib/auth.mjs): login, roles and permissions, throttling, super-admin and multi-organization rules, password policy, persistence and TOTP 2FA. |
| `cloud-controller.test.mjs` | Unit tests of the cloud-sync controller (desktop/sync/controller.mjs) against a fake provider: connect, start-up pull, conflicts, the lease question, offline start and disconnect. |
| `cloud.test.mjs` | Unit tests of the cloud-sync providers and OAuth (desktop/sync/oauth.mjs, providers/*) against fake servers: PKCE flow, retries, Google Drive and OneDrive uploads and downloads. |
| `desktop.test.mjs` | Unit tests of the desktop-only pieces: portable users and clean environments, tool launchers, pty consoles, zip without a binary, password hashes, the local identity and the Neumorphism skin. |
| `docs-coverage.test.mjs` | Enforces the documentation guidelines of docs/DOCUMENTATION.md: every source file has a header comment, every export and public class method has a doc comment, the generated documents (API, data model, code map, memoir study) match what the code would generate now, and every route, report and action |
| `docs.test.mjs` | Unit tests of the document engine (app/lib/docs): Markdown parsing, variables, every built-in template in three languages, data sources and permissions, and the DOCX, XLSX and PDF writers. |
| `e2e/e2e_app_flow.py` | Interaction test of the production app: create programme from template, rundown, budget editing, documents (editor, preview, lint, downloads), kanban, comments, files, approvals, language, offline queue. |
| `e2e/e2e_app.py` | UI smoke test of the production app (no gateway): loads the main views against sample data, checks content, console errors and layout. |
| `e2e/e2e_collado.py` | E2E of the whole stack against a local gateway+agentd with a FAKE agent (never the real Claude Code): login + forced password change, RBAC (roles/users), persistent console, app (projects/docs/tasks/targets), app -> console messages, supervisor (broken app -> rollback), revocation. |
| `engine.test.mjs` | Unit tests of the generic entity engine and business rules (app/lib/engine.mjs, logic.mjs): CRUD, money, secrets, permissions, budget locking, external scoping and workflows. |
| `files.test.mjs` | Unit tests of the file manager worker (gateway/lib/agentd/fsops.mjs): create, rename, copy, containment inside the home, trash and restore, search and zip. |
| `fixtures/sample-data.mjs` | Realistic sample data (fictional names) used by tests and for demos: `node tests/tools/render-sample.mjs <outdir>`. |
| `forecast.test.mjs` | Unit tests of the audience forecast (app/lib/forecast.mjs and reports.audienceForecast): the model on synthetic histories and the report over real broadcasts and ratings. |
| `i18n.test.mjs` | Consistency tests of the dictionaries: every entity, field and option has a label in es, ca and en, every UI key exists, and the shell and app share the same style kit. |
| `icons.test.mjs` | Tests of the SVG icon set: the generated files are up to date, every icon draws something, every icon the code asks for exists, and no emoji is left in the interface. |
| `memoir.test.mjs` | Unit tests of project memoirs (app/lib/memoir*.mjs, docs/graphics.mjs, media.mjs): the section catalogue, completeness, graphics, the gallery, assembly into documents and the generated study. |
| `orgs.test.mjs` | Unit tests of multi-organization isolation in the app (app/lib/db.mjs): separate databases, settings, sequences, encryption sub-keys and attachments per company. |
| `project-folders.test.mjs` | Unit tests of per-project folders in the desktop build: validation (required, absolute, unique, not nested), exports copied into the folder, and the automatic Claude login. |
| `run-e2e-app.sh` | UI smoke test of the production app against sample data (no gateway/tmux needed). |
| `run-e2e.sh` | Local E2E of the whole stack: gateway + agentd (dev mode: one uid, one HOME per person) + the app, with a FAKE agent script (never the real Claude Code). |
| `sync.test.mjs` | Unit tests of the cloud-sync engine (desktop/sync/engine.mjs): intact round trip, wrong passphrases and tampering, incremental pushes, the lease, deletions, backups and path safety. |
| `tools/render-sample.mjs` | Renders every built-in template with the sample data into <outdir> (html, pdf when WeasyPrint is available, docx) for visual review. |
| `tools/seed-sample.mjs` | Fills a data directory with the sample programme (used by the UI smoke test): node tests/tools/seed-sample.mjs <datadir> |
| `update.test.mjs` | Unit tests of the update check (desktop/update.mjs): version comparison, picking the installer of each system and the release listing rules. |
