# Claqueta

Aplicación de escritorio (macOS · Windows · Linux) para la **gestión de producción de televisión, radio y podcast**. Funciona **en el propio equipo y sin conexión**: programas y episodios, planificación, finanzas, contratos y derechos, documentos de calidad (HTML, PDF, Word, Excel), memorias de proyecto con galería de imágenes y gráficos, predicción de audiencias y un agente Claude Code opcional que trabaja con tus datos. Estilo Neumorfismo 2.0, claro y oscuro; en castellano, catalán e inglés.

- **Descargas:** [GitHub](https://github.com/solde/Claqueta/releases/latest) · [Gitea](https://gitea.solde.cat/dsoldevila/claqueta-desktop/releases/latest)
- **Documentación:** [cómo está hecho](docs/SOFTWARE.md) · [pautas de documentación](docs/DOCUMENTATION.md) · [mapa del código](docs/CODE-MAP.md) · [API](docs/API.md) · [modelo de datos](docs/DATA-MODEL.md)

## Qué hace
| Área | Resumen |
|---|---|
| Programas y planificación | Fichas, temporadas, episodios, plantillas de flujo, hitos con Gantt y camino crítico, escaletas con tiempos, calendario con conflictos |
| Recursos y equipo | Directorio, disponibilidad, reservas de estudios y equipos, control de horas con convenios |
| Finanzas | Presupuestos por capítulos con versiones, previsto/comprometido/real, facturas, tesorería, IVA, subvenciones, rentabilidad, exportación a Odoo |
| Contratos y derechos | Contratos con alertas, derechos con ventanas y territorios, cue sheets, RGPD |
| Material, calidad y entrega | Metadatos, especificaciones por cadena, QC, entregas con huella SHA-256, cumplimiento normativo |
| Emisión y audiencias | Parrilla, mediciones (CSV), targets, competencia y **predicción de audiencias** (modelo estadístico local) |
| **Memorias de proyecto** | Memorias por secciones (subvención, anual, cliente, cierre de temporada, festivales) con datos reales, **galería de imágenes** y **gráficos con la marca**; se exportan a PDF o Word |
| Documentos | Markdown con bloques de datos vivos → PDF, Word, HTML, Excel y PowerPoint con marcas y plantillas propias |
| Agente | Claude Code integrado: consola, pautas de experto en producción y herramientas para leer datos, crear documentos, memorias, imágenes y gráficos |
| Proyectos en tu equipo | Cada proyecto guarda sus archivos en **su propia carpeta**; gestor de archivos que abre con la aplicación por defecto |
| Nube opcional | Sincroniza **todo el espacio de trabajo** (cifrado de extremo a extremo) con una carpeta sincronizada, Google Drive u OneDrive |

## Descargar e instalar
| Sistema | Archivo | Notas |
|---|---|---|
| macOS (Apple Silicon) | `Claqueta-<versión>-mac-arm64.dmg` (o `.zip`) | Abre el `.dmg` y arrastra Claqueta a Aplicaciones |
| macOS (Intel) | `Claqueta-<versión>-mac-x64.dmg` (o `.zip`) | ídem |
| Windows 10/11 (64 bits) | `Claqueta-<versión>-win-x64.zip` (portable: descomprime y ejecuta `Claqueta.exe`) | instalador `…-setup.exe` cuando esté publicado |
| Linux (64 bits) | `Claqueta-<versión>-linux-x64.tar.gz` (descomprime y ejecuta `./claqueta`) | si falla por el sandbox: `--no-sandbox` |

Las versiones **no están firmadas**: macOS → clic derecho › Abrir la primera vez (o `xattr -dr com.apple.quarantine /Applications/Claqueta.app`); Windows → SmartScreen › Más información › Ejecutar de todos modos. `SHA256SUMS.txt` (adjunto a cada versión) permite verificar las descargas. Más detalles: [docs/DESCARGAS.md](docs/DESCARGAS.md).

**Actualizar:** *Ayuda › Buscar actualizaciones…* consulta la página de versiones (solo cuando tú lo pides; la app nunca se conecta sola) y te lleva a la descarga de tu sistema. Instálala encima: **tus datos no se tocan** (viven en la carpeta de usuario, fuera de la aplicación).

## Cómo está hecho
Un solo código, sin compilación ni frameworks. La aplicación es **Electron** envolviendo tres piezas Node que se ejecutan en tu equipo, enlazadas solo a `127.0.0.1`:

```
Electron (desktop/main.mjs)
 ├─ servicio de render (Chromium): PDF, SVG→PNG, reducción de imágenes
 ├─ proceso "hub" (desktop/hub.mjs)
 │    ├─ gateway  (login local, roles, shell web, proxy)         gateway/
 │    ├─ agentd   (consolas, archivos, login de Claude, supervisor) gateway/lib/agentd/
 │    └─ servidor de la app (motor de datos SQLite, API, documentos) app-seed/app/lib/
 └─ ventana → solo puede cargar servidores locales (cualquier otra petición se cancela)
```
- **Datos declarativos:** cada entidad se describe una vez (`app-seed/app/lib/schema/`) y de ahí salen la tabla, la API, el formulario, los permisos y las etiquetas. Todo pasa por un único motor (`engine.mjs`) con validación, reglas de negocio e historial en una transacción.
- **Seguro por construcción:** claves por arranque, permisos por módulo y por campo, secretos cifrados (AES-256-GCM), una base de datos por organización, el agente actúa con los permisos de su persona.
- **Documentos sin librerías:** Markdown de Collado → AST → HTML/PDF/Word/Excel con escritores propios.
- **Interfaz sin build:** módulos ES cargados tal cual, `h()` para construir el DOM, iconos SVG propios, diccionarios es/ca/en.
- **Sin conexión:** la única salida a internet es la sincronización en la nube, y solo si conectas una cuenta.

Explicación completa de capas, procesos, flujo de una petición, datos, seguridad, nube, publicación y pruebas: **[docs/SOFTWARE.md](docs/SOFTWARE.md)**.

## Estructura del repositorio
| Carpeta | Contenido |
|---|---|
| `desktop/` | Proceso principal de Electron, servicio de render, sincronización en la nube (`sync/`), actualizaciones, autotest |
| `gateway/` | Gateway (login, shell web) y agentd (usuarios, consolas, archivos, supervisor) |
| `app-seed/app/` | Servidor de la app (`lib/`) e interfaz (`public/`) |
| `app-seed/workspace/agent/` | Pautas del agente y skills de dominio |
| `tools/` | `collado-api`, `collado-doc`, `collado-app` (herramientas del agente) |
| `scripts/` | Generación de documentación, iconos, exportación y publicación |
| `tests/` | Pruebas unitarias |
| `docs/` | Documentación (ver abajo) |

El índice completo, fichero a fichero, está en **[docs/CODE-MAP.md](docs/CODE-MAP.md)**.

## Desarrollo
```bash
npm ci
npm run desktop          # abre la app en modo desarrollo
npm run desktop:smoke    # arranca todo y hace comprobaciones reales dentro de la ventana (Electron)
npm test                 # pruebas unitarias (incluye la comprobación de documentación)
npm run docs             # regenera la documentación generada (API, modelo de datos, mapa del código, memorias, iconos)
npm run dist:mac | dist:win | dist:linux     # instaladores en dist/ (cada uno en su propio sistema operativo)
```
Requiere Node ≥ 24.7 para el desarrollo (la aplicación empaquetada trae su propio Node dentro de Electron).

## Documentación y pautas
Toda la documentación sigue las reglas de **[docs/DOCUMENTATION.md](docs/DOCUMENTATION.md)**; un test las comprueba en cada `npm test`. En resumen:

1. **Cabecera en todo fichero fuente** (qué es, por qué existe, cómo se usa); su primera frase alimenta el mapa del código.
2. **Comentario `/** … */` en toda exportación y método público**: una línea, tercera persona, con unidades, errores y permisos.
3. **Comentarios `//` para el porqué**, no para repetir el código; sin código comentado.
4. **Código en inglés; documentación en castellano; interfaz en es/ca/en.**
5. **Lo que se puede generar se genera** (`npm run docs`): [API](docs/API.md), [modelo de datos](docs/DATA-MODEL.md), [mapa del código](docs/CODE-MAP.md), [memorias](docs/MEMORIAS.md). Nunca se editan a mano.
6. **Las pruebas documentan**: cabecera por fichero y nombres que son frases.
7. **Quien cambia el comportamiento actualiza la documentación en el mismo cambio.**

| Documento | Para qué |
|---|---|
| [SOFTWARE.md](docs/SOFTWARE.md) | Cómo está hecho el software |
| [DOCUMENTATION.md](docs/DOCUMENTATION.md) | Pautas de documentación y lista de comprobación |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) · [OPERATIONS.md](docs/OPERATIONS.md) | Diseño y seguridad del servicio; operación |
| [DESKTOP.md](docs/DESKTOP.md) | La app de escritorio: nube, carpetas de proyecto, límites |
| [CODE-MAP.md](docs/CODE-MAP.md) · [API.md](docs/API.md) · [DATA-MODEL.md](docs/DATA-MODEL.md) · [MEMORIAS.md](docs/MEMORIAS.md) | Referencias generadas |

_Los documentos generados se producen desde el repositorio completo de Collado: pueden mencionar ficheros que este repositorio de escritorio no incluye._

## Publicar una versión
1. Sube la versión en `package.json` y haz commit.
2. Construye los instaladores en cada sistema (`npm run dist:*`).
3. Publica: `npm run release -- --tag vX.Y.Z` (Gitea: crea la versión si no existe y sube todo lo de `dist/` más `SHA256SUMS.txt`; token en `GITEA_TOKEN`, en `~/.config/claqueta/gitea-token` o con `--ssh-key ~/.ssh/gitea`, que firma las peticiones con una clave SSH registrada en tu cuenta). En GitHub: `gh release create vX.Y.Z dist/Claqueta-* --repo solde/Claqueta`.
4. Los dos repositorios (Gitea y GitHub) se actualizan siempre juntos con `npm run push` (`scripts/push-all.mjs`: exporta el código de escritorio y lo sube a ambos sin *force push*).

Las etiquetas `v*` también activan el flujo `.gitea/workflows/release.yml` (necesita *runners* de Gitea Actions con las etiquetas de cada sistema).
