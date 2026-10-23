# Claqueta de escritorio (macOS · Windows · Linux)

La misma suite, empaquetada como aplicación que corre **en el propio equipo y sin conexión**. Es Electron alrededor de los tres componentes de siempre
(todo Node, sin reescribir nada): **gateway** (interfaz + permisos), **app** (motor de datos SQLite + SPA) y **agentd** (consolas, archivos). Cada uno es un proceso
hijo ligado a `127.0.0.1`, con claves que solo existen durante esa ejecución.

```
Claqueta.app ─ Electron (ventana)
   ├─ gateway  :auto  UI del shell, RBAC, sesión local sin login
   ├─ agentd   :auto  consolas (node-pty), gestor de archivos, supervisor de la app
   │    └─ app :auto  motor + SPA + SQLite  (copia de solo lectura incluida en el programa)
   └─ servicio de render (Chromium): PDF y SVG→PNG, solo accesible con clave
```

## Probarlo / desarrollarlo
```bash
npm ci
npm run desktop            # abre la app (datos en la carpeta de usuario del sistema)
npm run desktop:smoke      # arranca todo, hace 10 comprobaciones reales dentro de la ventana y una captura (.scratch/)
npm test                   # unitarias (incluye tests/desktop.test.mjs)
COLLADO_DATA_DIR=/ruta npm run desktop     # datos en otra carpeta
```

## Generar instaladores
```bash
npm run icons              # (solo si cambias app-seed/app/public/icon.svg) → build/icon.png
npm run dist:mac           # .dmg + .zip   (de la arquitectura de la máquina: arm64 o x64)
npm run dist:win           # instalador NSIS + portable .exe
npm run dist:linux         # .AppImage + .deb
```
Cada plataforma debe construirse **en su sistema** (`node-pty` lleva un binario nativo por plataforma). `.github/workflows/desktop.yml` lo hace con una matriz
(macOS Apple Silicon e Intel, Windows, Ubuntu): ejecútalo desde Actions o con una etiqueta `v*`. Resultado en `dist/`.

**Construir desde un Mac sin Rosetta**: macOS arm64/x64 se construyen bien (hay que tener en `node_modules/@lydell/` los binarios de `node-pty` de cada plataforma: `npm pack @lydell/node-pty-<so>-<arch>@1.1.0` y descomprimir), y Windows/Linux salen como **archivos** (`npx electron-builder --win zip --x64 --linux tar.gz --x64`). Los instaladores NSIS, AppImage y deb necesitan binarios x86 (Rosetta) o construirse en su propio sistema.

**Sin firmar.** Los instaladores no están firmados ni notarizados. macOS: clic derecho → Abrir la primera vez (o `xattr -dr com.apple.quarantine /Applications/Claqueta.app`).
Windows: SmartScreen → «Más información» → «Ejecutar de todos modos». Para firmar, define los secretos de electron-builder (`CSC_LINK`, `CSC_KEY_PASSWORD`,
`APPLE_ID`…) y quita `CSC_IDENTITY_AUTO_DISCOVERY` del workflow. Linux: si el AppImage falla por el sandbox de Chromium (Ubuntu 24.04+), `./Claqueta.AppImage --no-sandbox` o instala el `.deb`.

## Dónde quedan los datos
Carpeta de usuario del sistema (`Claqueta`): macOS `~/Library/Application Support/Claqueta`, Windows `%APPDATA%\Claqueta`, Linux `~/.config/Claqueta`. La app se llamó antes *Collado*: si ya existe la carpeta `Collado` y no la nueva, se sigue usando esa (no se pierden datos ni hay que mover nada).
`data/appdata` (bases SQLite por organización, adjuntos cifrados, `data.key`), `data/homes/<usuario>` (archivos y sesión de Claude de la persona), `gateway/` (usuarios, auditoría),
`logs/`. **Copia la carpeta entera** para hacer una copia de seguridad; `data.key` hace falta para leer lo cifrado. Menú *Archivo → Abrir carpeta de datos / registros*.

> El nombre visible de la app está en `desktop/brand.mjs`. Los identificadores internos (comandos `collado-api`/`collado-doc`/`collado-app`, cookies, variables `COLLADO_*`, carpetas del servidor) conservan el nombre `collado`; el servicio web sigue llamándose Collado.

## Carpeta local de cada proyecto
**Cada proyecto guarda sus archivos en su propia carpeta.** Se elige al **crear** el proyecto (campo *Carpeta local*, justo bajo el nombre, con el botón **Elegir carpeta…**; propone «última carpeta padre usada / nombre del proyecto») y se cambia en la **ficha del programa** (tarjeta *Carpeta local* › **Cambiar carpeta…**, o la pestaña Editar).
- **Obligatoria, absoluta y única**: no puede estar vacía, no se puede repetir ni anidar con la carpeta de otro proyecto (uno dentro de otro), y si no existe se crea. Al cambiarla, los archivos ya existentes **no se mueven** (la ficha lo avisa).
- **Qué se guarda ahí:** el `CLAUDE.md` del proyecto, todo lo que el agente genere, y una copia en claro de cada documento exportado desde la app (`Documentos/`, sin sobrescribir). Los **adjuntos** de las fichas (contratos, facturas…) siguen cifrados dentro de los datos de la app.
- **Dónde se abre el gestor de archivos:** el botón **Abrir carpeta** de la ficha y *Archivos › Proyectos* abren ahí. Para el gestor, la carpeta se enlaza dentro del espacio de la persona en `Proyectos/<nombre>-<id>` (enlace simbólico; *junction* en Windows): consola y agente la alcanzan sin ampliar permisos. Solo se reemplaza un enlace creado por la app.
- **Doble clic** (o Intro) abre el archivo con la aplicación predeterminada del sistema; Espacio da la vista previa. Programas, scripts e instaladores (`.app`, `.exe`, `.sh`…) no se ejecutan: se muestran en su carpeta. Mover a la papelera desde otro disco copia y borra.
- Solo existe en la versión de escritorio: el servicio web no tiene este campo.

## Inicio de sesión de Claude (automático)
Al abrir la app sin sesión de Claude Code (o con *Configuración › Iniciar sesión en Claude Code*), la app ejecuta `claude auth login` por ti: **se abre el navegador solo**, autorizas y la ventana se cierra y reinicia la consola. Sin pasos en la consola. Si el navegador no se abre, la tarjeta ofrece el enlace y una casilla por si la página muestra un código. Requiere tener `claude` instalado (si no, lo explica). La sesión vive en el llavero del sistema con la configuración en el espacio de trabajo (`CLAUDE_CONFIG_DIR`). El acceso a Google Drive/OneDrive se abre igual, con el navegador y sin contraseñas en la app.

## Nube: Google Drive, OneDrive o una carpeta sincronizada
*Configuración → Nube y sincronización…* lleva **todos los datos de Claqueta** a la nube para trabajar desde otro equipo: bases de datos de cada organización, adjuntos, `data.key`, la carpeta personal (archivos de trabajo) y la lista de organizaciones.
- **Opciones:** Google Drive (API), OneDrive (Microsoft Graph) o una **carpeta** (la que ya sincronizan Google Drive para escritorio u OneDrive, o cualquier carpeta compartida; no necesita cuentas ni claves).
- **Cifrado de extremo a extremo.** Antes de salir del equipo todo se cifra con AES-256-GCM con una clave derivada (scrypt) de la **contraseña de sincronización** que eliges al conectar. La nube ve solo objetos opacos: ni contenido ni nombres de archivo ni la estructura. Sin la contraseña no hay recuperación; en otro equipo se escribe una vez. *(Decisión de diseño mía: sin ella la clave de cifrado de los datos viajaría junto a ellos.)*
- **Un equipo a la vez.** El manifiesto lleva un *lease* (equipo + caducidad de 20 min, renovado cada 5). Al arrancar: si otro equipo lo tiene, preguntas (tomar el control / trabajar sin sincronizar / salir); si la nube es más reciente, se descarga **antes** de abrir las bases de datos; si hay cambios en ambos lados, eliges nube o este equipo. Lo que se sobrescribe va antes a `sync/backups/` (últimas 5 copias). Se sube al cerrar (con una ventana de progreso), cada 15 min si hay cambios y con «Sincronizar ahora».
- **Qué no viaja:** credenciales de Claude, tokens de API, sesiones y auditoría, el enlace `Proyectos/` (son rutas de *este* equipo, y la «Carpeta local» de cada programa también lo es), cachés, `node_modules` y archivos de más de 256 MB (se cuentan como omitidos).
- **Bases de datos:** se copian con `VACUUM INTO` (consistentes aunque la app esté escribiendo); si no cambiaron desde la última vez no se vuelven a subir. Solo se sube lo que la nube aún no tiene (por contenido).
- **Sin conexión:** la app arranca igual con los datos locales, avisa y se pone al día cuando vuelve internet. Los tokens y la clave se guardan en el almacén seguro del sistema (llavero / DPAPI / libsecret); si no existe, en un archivo `0600`.
- **Alcance mínimo en las cuentas:** Google `drive.file` (solo los archivos que crea Claqueta, en la carpeta «Claqueta») y Microsoft `Files.ReadWrite.AppFolder` (solo `/Apps/<tu app>`). Claqueta nunca ve el resto del Drive.

### Credenciales de la aplicación (hay que crearlas una vez; yo no puedo)
Google y Microsoft exigen que la app esté registrada. Sin los identificadores el botón pide pegarlos. Se pueden dejar de fábrica en `desktop/cloud.config.json`, en las variables `COLLADO_GOOGLE_CLIENT_ID`, `COLLADO_GOOGLE_CLIENT_SECRET`, `COLLADO_MS_CLIENT_ID`, o pegarlos en el diálogo.
- **Google:** [console.cloud.google.com](https://console.cloud.google.com) → proyecto nuevo → *APIs y servicios* → activar **Google Drive API** → *Pantalla de consentimiento OAuth* (Externo; en modo «Pruebas» añade tu cuenta como usuario de prueba, o publícala) → *Credenciales* → *ID de cliente OAuth* de tipo **Aplicación de escritorio** → copia Client ID y Client secret (en apps de escritorio no es confidencial).
- **Microsoft:** [entra.microsoft.com](https://entra.microsoft.com) → *Registros de aplicaciones* → nuevo → cuentas «en cualquier directorio y cuentas personales» → *Autenticación* → plataforma **Aplicaciones móviles y de escritorio** con URI `http://localhost` y «Permitir flujos de cliente público» → *Permisos de API*: `Files.ReadWrite.AppFolder` y `offline_access` → copia el Id. de aplicación (cliente).
- Mientras la sincronización esté conectada, **Claqueta usa internet** para esto (solo a `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`, `login.microsoftonline.com`, `graph.microsoft.com` y a las URL de descarga/subida que devuelven esas APIs). Desconectada, no toca la red.

## Rendimiento (consumo en reposo)
Medido en macOS arm64 con la app recién abierta, sin sesión de Claude activa (`ps`, suma de todos los procesos): **antes 1072 MB / 0,63 % CPU → ahora 619 MB / 0,33 %** (una app Electron vacía ocupa 371 MB: ese es el suelo).
- **Un solo proceso Node** para gateway + agentd (`desktop/hub.mjs`) y el servidor de la app como **hilo (worker)** de ese proceso, con su tope de 320 MB y reinicio limpio: antes eran tres procesos (~290 MB). `COLLADO_APP_PROCESS=1` vuelve al proceso separado.
- **Claude Code no se arranca solo**: la consola empieza cerrada y Claude se inicia al abrirla; con nadie mirándolo durante 45 min se detiene (la conversación se reanuda con `--continue`). Un Claude activo son ~200 MB.
- **Sin service worker** en escritorio (solo interceptaba y copiaba cada petición del servidor local) ni la librería de QR (no hay 2FA).
- **Ventana de render reutilizada** para PDF y gráficos (antes un renderer de Chromium nuevo por petición); se cierra tras 1 min sin uso.
- El supervisor sondea cada 10 s una vez sano (antes cada 2 s); el código de pruebas solo se carga al probar.
Sin cambios de comportamiento visibles: 78 tests y 27 comprobaciones reales dentro de la ventana.

## Pautas del agente (CLAUDE.md) y caja de herramientas
- **CLAUDE.md de cada persona** (en su espacio de trabajo, `data/homes/<usuario>/CLAUDE.md`): importa `AGENT.md` (pautas generales), **`AGENT.desktop.md`** (entorno de escritorio: rutas, carpeta de proyecto, qué cambia respecto al servidor, no usar la skill de servicio) y `TEAM.md`. Como la carpeta de datos de macOS tiene un espacio (`Application Support`) y un `@import` no admite espacios, las rutas se escriben **relativas** (`@../../shared/agent/AGENT.md`). Un CLAUDE.md anterior se repara sin tocar el texto de la persona.
- **CLAUDE.md de cada proyecto**: al guardar un programa con *Carpeta local*, se crea **una vez** un `CLAUDE.md` en esa carpeta (plantilla `PROJECT.template.md`) con los datos del programa, dónde guardar cada cosa y los pasos al empezar (leer la ficha, **comprobar las herramientas**). Nunca se sobrescribe; si no se puede escribir (disco de solo lectura, carpeta de la nube sin montar) se ignora.
- **`collado-doc check [--program ID] [--json]`**: la caja de herramientas para documentos de máxima calidad. Informa de qué hay y qué falta —motor de PDF y gráficos (vienen en la app), `pdftoppm`/poppler (ver las páginas), LibreOffice (revisar Word/Excel/PowerPoint), Python 3.9+ con `python-pptx`, `python-docx`, `openpyxl`, `pillow`, `lxml`, fuentes de las marcas, `pandoc`, y la carpeta del proyecto—, **qué se pierde** sin cada una y el **comando exacto** para este sistema (brew / winget·scoop / apt). Las pautas obligan al agente a ejecutarlo al empezar cada proyecto, a **no instalar software del sistema sin permiso** y a decir qué no ha podido comprobar. Salida con código 1 solo si falta algo imprescindible.
- Variables en la consola del agente: `COLLADO_WORK` (carpeta de trabajo), `COLLADO_WORKSPACE`, `COLLADO_TOOLS`, `COLLADO_TOKEN_FILE`, `CLAUDE_CONFIG_DIR`; `HOME` es el real (el llavero de macOS). `COLLADO_PYTHON` permite indicar otro Python (p. ej. de un entorno virtual).

## Qué cambia respecto a la versión web
| | Web (servidor) | Escritorio |
|---|---|---|
| Acceso | login + 2FA + RBAC | una persona local (super-admin) entra directamente; sin login ni contraseña. Las organizaciones, roles y usuarios siguen existiendo |
| Consolas | tmux + un usuario de sistema por persona | procesos `node-pty` persistentes (sobreviven a cerrar/recargar la vista) con el usuario del equipo; la «home» de Claqueta es privada (`data/homes`) |
| PDF | WeasyPrint | Chromium integrado (sin instalar nada). Sin la numeración de página del índice (`target-counter`) ni PDF/A |
| Gráficos en Word | librsvg | Chromium integrado |
| Código de la app | el agente puede modificarlo (git, rollback) | de solo lectura; «Servicio» solo permite ver registros y reiniciar |
| Aspecto | Neobrutalismo | Neumorfismo 2.0 (claro y oscuro según el sistema), solo con tipografías del sistema: `neu.css`, activado por `data-skin="neu"` en el HTML que sirve el modo escritorio |
| Red | sirve a internet | solo `127.0.0.1`; **toda petición a otro host se cancela** (fuentes, librerías y datos son locales) |

## Funciona sin internet… salvo lo que es de Claude
Datos, documentos (HTML/PDF/Word/Excel), calendario, finanzas, archivos, terminal bash, etc. funcionan 100 % offline. **Claude Code** (consola «Claude Code», botón «Preguntar»,
generaciones del agente) necesita: 1) tener instalado `claude` (la consola lo explica y da el comando) y 2) conexión a la API de Claude para conversar. Sin él, el resto sigue igual.
Opcionales y externos al programa (solo el agente, vía `collado-doc`): Python + `python-pptx` para `.pptx`, `pdftoppm` para vistas PNG.

## No verificado
**La nube con cuentas reales de Google y Microsoft no se ha probado** (no hay credenciales ni cuentas aquí): el motor, el cifrado, los conflictos, el flujo OAuth (PKCE) y los conectores se prueban con servidores simulados de Drive v3 y Graph (`tests/sync.test.mjs`, `tests/cloud*.test.mjs`) y de extremo a extremo con una carpeta en la ventana real. Las diferencias reales (cuotas, límites de tamaño, cambios de API) pueden requerir ajustes.
Probado en macOS (arm64): arranque, `.app` empaquetado, 10 comprobaciones end-to-end (PDF, DOCX, SVG→PNG, terminal, archivos, bloqueo de red, cierre limpio). **Windows y Linux no se han
ejecutado** (no hay máquinas aquí): el código evita `tmux`, `setpriv`, `env -i`, `zip` y symlinks de directorio, pero conviene pasar `npm run desktop:smoke` en cada sistema. En Windows la consola
usa PowerShell y Claude Code puede necesitar Git for Windows. Los instaladores no se han abierto en Windows/Linux. El login de Claude en macOS usa el llavero del sistema (el tutorial lo detecta).

## Memorias de proyecto, galería y gráficos
- **Estudio de secciones y campos:** [MEMORIAS.md](MEMORIAS.md) (generado desde el catálogo `app-seed/app/lib/memoir-catalog.mjs`; `node scripts/memoir-study.mjs` lo regenera).
- **En la app:** grupo *Memorias* del menú: Memorias (editor por secciones), Galería (subida con arrastrar y soltar, pies de foto, autoría y derechos, generador de gráficos) y Localizaciones. «Ensamblar documento» crea un documento editable que se exporta a PDF o Word.
- **Para el agente:** `collado-doc memoir | media | graphic` y la skill `collado-memorias`. Los gráficos (cifras, cronología, organigrama, mapa de localizaciones, metas, citas, separadores, portadas, cascada, mapa de calor) se dibujan con la marca del equipo; `:::graphic` y `:::gallery` funcionan en cualquier documento.
- **Imágenes:** en la versión de escritorio las fotos se reducen con Electron (`/image` del servicio de render) para las miniaturas y para no inflar los PDF; fuera de ella se usa el original.
