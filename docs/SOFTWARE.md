# Cómo está hecho el software

Claqueta (nombre interno: **Collado**) es una suite de gestión de producción para televisión, radio y podcast. Es **un solo código** que se ejecuta de dos maneras:

| | Servicio (web) | Aplicación de escritorio |
|---|---|---|
| Quién lo usa | Un equipo, desde el navegador | Una persona, en su equipo (macOS, Windows, Linux) |
| Red | Detrás de un proxy, con login, roles y 2FA | Solo `127.0.0.1`; cualquier otra petición se cancela |
| Procesos | Contenedores: gateway, agentd (como root) y la app | Un proceso Electron que arranca los mismos servidores |
| Datos | Una base SQLite por organización en un volumen | Una base SQLite por organización en la carpeta de usuario |
| Agente | Claude Code por persona, en un usuario de sistema | Claude Code de la propia persona, en una consola integrada |

Este documento explica **cómo encajan las piezas**. El diseño y la seguridad del servicio están en [ARCHITECTURE.md](ARCHITECTURE.md); lo específico del escritorio, en [DESKTOP.md](DESKTOP.md). El índice de ficheros está en [CODE-MAP.md](CODE-MAP.md), las rutas HTTP en [API.md](API.md), las entidades en [DATA-MODEL.md](DATA-MODEL.md) y las reglas para documentar en [DOCUMENTATION.md](DOCUMENTATION.md).

## 1. Principios de diseño
1. **Sin compilación y casi sin dependencias.** El servidor es Node (≥ 24.7, con `node:sqlite`); la interfaz son módulos ES que el navegador carga tal cual. Las únicas dependencias de ejecución son `ws`, `@lydell/node-pty`, xterm.js y un generador de QR. No hay *bundler*, *framework* ni paso de *build* del código propio.
2. **Declarativo.** Las entidades se describen una vez (`app-seed/app/lib/schema/*.mjs`) y de ahí salen la tabla, la API, el formulario, la lista, los permisos y las etiquetas.
3. **Todo pasa por un motor.** La interfaz, el agente y los informes leen y escriben mediante `engine.mjs`, que aplica permisos, validación, reglas de negocio e historial en una transacción.
4. **Seguro por construcción.** Nada es de fiar por estar en `127.0.0.1`: cada capa exige una clave o un token firmado; el agente actúa **con los permisos de su persona**; los datos sensibles se cifran.
5. **Offline en el escritorio.** La ventana solo puede hablar con servidores locales; la única salida a internet es la sincronización en la nube, y solo después de que la persona conecte una cuenta.

## 2. Procesos
### Escritorio
```
Electron (desktop/main.mjs)
 ├─ servicio de render (HTTP local con clave por arranque): PDF, SVG→PNG y reducción de imágenes con Chromium
 ├─ proceso "hub" (desktop/hub.mjs, Electron en modo Node)
 │    ├─ gateway   (login por *nonce*, roles, shell web, proxy a la app)
 │    ├─ agentd    (usuario local, consolas pty, archivos, login de Claude, supervisor)
 │    └─ servidor de la app (hilo de trabajo: SPA, API, SQLite)
 └─ ventana (BrowserWindow) → solo 127.0.0.1
```
Los puertos son aleatorios y las claves (`INTERNAL_KEY`, *nonce* de login, clave del servicio de render) existen solo durante ese arranque. El *hub* reúne gateway y agentd en un proceso para ahorrar memoria; el servidor de la app corre como hilo del mismo proceso con su propio límite de memoria y reinicio independiente.

### Servicio
`gateway` (único expuesto) → `agentd` (en el contenedor *workbench*, como root, crea un usuario de sistema por persona) → `app` (usuario `app`, código editable solo por quien tiene `service.manage`). Ver [ARCHITECTURE.md](ARCHITECTURE.md).

## 3. Capas
| Capa | Dónde | Responsabilidad |
|---|---|---|
| Escritorio | `desktop/` | Ventana, arranque y parada de procesos, bloqueo de red, puente seguro con el sistema (carpetas, abrir archivos), render de documentos, sincronización en la nube, actualizaciones |
| Gateway | `gateway/gateway.mjs`, `gateway/lib/auth.mjs`, `gateway/static/` | Login (argon2id o scrypt), 2FA TOTP, sesiones, roles (RBAC), auditoría, shell web, gestor de archivos, proxy a la app y a las consolas |
| agentd | `gateway/agentd.mjs`, `gateway/lib/agentd/` | Usuarios de sistema, consolas (tmux o pty), operaciones de archivos *como la persona*, trabajos `claude -p`, login automático de Claude, supervisor de la app, API de control |
| App (servidor) | `app-seed/app/lib/` | Motor de datos, reglas, informes, API, motor de documentos, memorias, gráficos, predicción |
| App (interfaz) | `app-seed/app/public/` | SPA sin compilación: vistas, formularios y listas genéricas, i18n, *skins* |
| Agente | `app-seed/workspace/agent/`, `tools/` | Pautas (`AGENT.md`), skills de dominio y las herramientas `collado-api`, `collado-doc`, `collado-app` |

## 4. Ciclo de una petición
1. El navegador (o la ventana de Electron) llama al **gateway** con su cookie de sesión (`HttpOnly`, `SameSite=Strict`) y la cabecera `x-requested-with` en toda escritura.
2. El gateway comprueba *host*, origen y sesión; calcula los permisos de la persona **en su organización activa** y reenvía `/app/*` a la app con cabeceras de identidad (`x-collado-user`, `-perms`, `-org`…) y la **clave interna**. Las cabeceras `x-collado-*` que traiga el cliente se descartan.
3. La app (`access.mjs`) construye el **contexto** (usuario, permisos, organización, ámbito externo). El enrutador (`routes.mjs`) ejecuta el manejador dentro de `inOrg(org)`: una `AsyncLocalStorage` hace que **toda consulta vaya a la base de esa organización**, aunque el manejador espere (`await`).
4. El **motor** (`engine.mjs`) valida (`convert`), comprueba permisos de módulo y de campo, ejecuta los *hooks* de negocio (`logic.mjs`: importes, bloqueos, estados), escribe y registra el cambio, todo en una transacción (`BEGIN IMMEDIATE`).
5. La respuesta vuelve convertida: importes de céntimos a euros, secretos descifrados solo si hay permiso, JSON y *tags* ya interpretados.

El **agente** entra por el mismo camino: `collado-api` llama a la app con un **token firmado** (HMAC, 24 h, con los permisos y la organización de la persona) en lugar de la cookie.

## 5. Datos
- **Esquema** (`schema/*.mjs` + `dsl.mjs`): cada entidad declara campos tipados (`text`, `long`, `int`, `num`, `pct`, `money`, `bool`, `date`, `datetime`, `time`, `enum`, `ref`, `json`, `tags`, `secret`), permisos por campo, título, listas, tableros, calendario y ámbito de programa. `syncSchema()` crea tablas y **solo añade** columnas: nunca borra ni altera.
- **Importes** en céntimos (enteros) en SQLite y euros en la API; las fechas son cadenas `YYYY-MM-DD` sin zona horaria.
- **Secretos** (DNI, IBAN, tarifas…) cifrados con AES-256-GCM; la clave maestra viene de `COLLADO_DATA_KEY` o de `data.key`, y cada organización deriva **sus propias subclaves** (HKDF) para que un texto cifrado copiado a otra empresa no se pueda leer.
- **Concurrencia optimista**: toda fila lleva `rev`; una actualización con un `rev` antiguo falla con 409.
- **Historial**: la tabla `changes` guarda el diff de cada cambio (con secretos enmascarados).
- **Adjuntos** cifrados en una carpeta por organización; los externos solo ven los marcados como compartidos.
- **Multiempresa**: una base SQLite y una carpeta de adjuntos por organización (`db.mjs`); la organización original conserva su ruta histórica.
- **Filtros** de la API: `f.campo=valor` con `>=`, `<=`, `!=`, `in:a|b`, `~texto`, `null`, `notnull`.

## 6. Motor de documentos (`app-seed/app/lib/docs/`)
`Markdown de Collado → AST → HTML → PDF / DOCX / XLSX`.
1. `vars.mjs` sustituye `{{variables}}` con filtros y bloques `{{#if}}`/`{{#each}}`; el texto sustituido se escapa salvo con el filtro `md`.
2. `markdown.mjs` produce el AST (Markdown habitual + directivas `:::callout`, `:::columns`, `:::data`, `:::chart`, `:::graphic`, `:::gallery`, `:::toc`…).
3. `render.mjs` resuelve los bloques vivos **con los permisos de quien renderiza** (`datasets.mjs`, `graphics.mjs`), con los datos reales del programa.
4. `html.mjs` + `brand.mjs` generan HTML paginado con la **marca** (colores, tipografías, portada, cabeceras). El PDF lo imprime Chromium (escritorio) o WeasyPrint (servicio).
5. `docx.mjs`, `xlsx.mjs` y `zip.mjs` escriben Word y Excel **sin librerías**; los gráficos SVG se rasterizan para Word.
6. `lint.mjs` revisa el documento (variables sin resolver, marcas pendientes, estructura).

## 7. Módulos de producto recientes
- **Memorias de proyecto** (`memoir-catalog.mjs`, `memoir.mjs`, `views/memoir.js`): un catálogo de secciones con sus campos genera la interfaz, el *brief* del agente, el cálculo de completitud y el documento ensamblado. Estudio: [MEMORIAS.md](MEMORIAS.md).
- **Galería y gráficos** (`media.mjs`, `docs/graphics.mjs`, `views/gallery.js`, `views/graphics.js`): imágenes con pie, autoría y derechos; gráficos SVG con la marca (cifras, cronología, organigrama, mapa de localizaciones, metas, citas, portadas, cascada, mapa de calor).
- **Predicción de audiencias** (`forecast.mjs`, `views/forecast.js`): tendencia suavizada sobre el histórico, efectos de franja y rangos de confianza; todo local.
- **Iconos** (`scripts/build-icons.mjs`): conjunto SVG propio generado en dos copias (shell y app).

## 8. El agente
- **Consolas**: tmux en el servicio y procesos `node-pty` propios en el escritorio (que también funciona en Windows), con *scrollback* que se reenvía a cada ventana nueva.
- **Pautas**: `AGENT.md` (+ `AGENT.desktop.md`), 13 skills de dominio y un `CLAUDE.md` por persona y por proyecto. En el escritorio cada proyecto tiene su carpeta local.
- **Herramientas**: `collado-api` (datos), `collado-doc` (documentos, memorias, galería, gráficos) y `collado-app` (servicio); todas usan el token de la persona.
- **Generaciones** (`jobs.mjs`): `claude -p` sin herramientas de escritura; el resultado se guarda como borrador.
- **Login automático** (escritorio, `claudelogin.mjs`): lanza `claude auth login` en un pty y detecta el enlace de autorización.

## 9. Seguridad (resumen)
- **Escritorio**: `webRequest` cancela todo lo que no sea local; las ventanas no pueden navegar fuera; el puente `colladoDesktop` (preload) solo expone carpetas, abrir archivos y la nube, y cada llamada se valida en el proceso principal (remitente, origen, rutas dentro del espacio de trabajo, no se ejecutan programas).
- **Claves por capa**: gateway y agentd comparten `INTERNAL_KEY`; la app recibe claves **derivadas**; las personas usan tokens firmados con caducidad.
- **Cabeceras**: CSP en shell y app, `nosniff`, `no-store`, cookies `HttpOnly`, comprobación de origen.
- **Sincronización en la nube**: cifrado AES-256-GCM con una clave derivada de la frase de paso (scrypt + HKDF); el proveedor no ve contenidos ni nombres; las credenciales no se suben.
- **Archivos**: cada operación del gestor se ejecuta como la persona, así que el sistema operativo impone lo que puede tocar.

## 10. Sincronización en la nube (escritorio)
`desktop/sync/`: el motor (`engine.mjs`) es independiente del proveedor (carpeta sincronizada, Google Drive, OneDrive). Es **direccionable por contenido y cifrado**: `config.json` (sal y comprobación de clave), `manifest.bin` (generación, *lease*, tabla de ficheros) y un objeto `o-<hash>` por contenido distinto. Un equipo trabaja cada vez (*lease*); al empezar se descarga lo que otro empujó, con copia de seguridad de lo reemplazado; al terminar se sube solo lo nuevo. Las bases SQLite se copian con `VACUUM INTO`.

## 11. Interfaz
SPA en `app-seed/app/public/js`: `main.js` (arranque y enrutador por *hash*), `dom.js` (`h()`, hiperscript), `forms.js`/`lists.js`/`detail.js` (genéricos, guiados por el esquema), `ui.js` (componentes), `i18n.js` (diccionarios es/ca/en servidos por la API) y `views/` (vistas cargadas bajo demanda). El *shell* (`gateway/static/`) aloja la app en un `iframe`, la consola y el gestor de archivos; se comunican con `postMessage`. Estilo: kit neobrutalista (`nb.css`) y, en el escritorio, la capa Neumorfismo 2.0 (`neu.css`, `data-skin="neu"`), claro y oscuro.

## 12. Compilación y publicación
- `npm run desktop` abre la app en desarrollo; `npm run dist:mac | dist:win | dist:linux` construyen con `electron-builder` (`package.json › build`). Desde un Mac sin Rosetta salen `.dmg`/`.zip` de macOS (arm64 y x64), `.zip` de Windows y `.tar.gz` de Linux; los instaladores NSIS, AppImage y deb necesitan construirse en su sistema.
- `scripts/export-desktop.mjs` exporta solo el código de escritorio a un repositorio independiente (historia nueva, README, flujo de publicación); `scripts/publish-release.mjs` crea la versión en Gitea y sube los instaladores con `SHA256SUMS.txt` (autenticación por token o por firma HTTP con una clave SSH, `gitea-auth.mjs`).
- Versiones sin firmar; *Ayuda › Buscar actualizaciones* consulta la página de versiones solo cuando la persona lo pide.

## 13. Pruebas
| Nivel | Qué | Cómo |
|---|---|---|
| Unitarias | Auth y RBAC, motor y reglas, documentos, sincronización, memorias, predicción, iconos, i18n, documentación | `npm test` (`node --test tests/*.test.mjs`) |
| Autotest de escritorio | La pila completa dentro de la ventana de Electron (login, archivos, render, sincronización, memorias, herramientas del agente…) con capturas | `npm run desktop:smoke` |
| E2E del servicio | Gateway + agentd + app con un agente **falso** (nunca el Claude real); interfaz con Playwright | `tests/run-e2e.sh`, `tests/run-e2e-app.sh` |

## 14. Cómo añadir cosas
- **Una entidad o un campo**: declara en `schema/*.mjs`, añade las etiquetas (es, ca, en: el test lo exige) y ejecuta `npm run docs`. La tabla, API y formulario aparecen solos.
- **Una regla de negocio**: `hook(entidad, "before" | "after", fn)` en `logic.mjs`.
- **Un informe o una acción**: añádelo a `REPORTS`/`ACTIONS` en `routes.mjs` y su descripción en `scripts/docs-api.mjs`.
- **Un origen de datos para documentos**: `DATASETS` en `docs/datasets.mjs`.
- **Un tipo de gráfico**: función en `docs/graphics.mjs` y entrada en `GRAPHIC_TYPES` (con su ejemplo).
- **Una vista**: módulo en `public/js/views/`, ruta en `main.js` y entrada de menú; textos en los tres `ui.*.mjs`.
- **Una sección de memoria**: `memoir-catalog.mjs` y `npm run docs`.
- **Un icono**: `scripts/build-icons.mjs` y `npm run docs`.
