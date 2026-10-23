# Arquitectura de Claqueta

> Este documento describe el **diseño y la seguridad del servicio**. Para una visión de todo el software (servicio y escritorio), procesos, capas, datos y publicación, empieza por [SOFTWARE.md](SOFTWARE.md); las reglas para documentar están en [DOCUMENTATION.md](DOCUMENTATION.md).

```
internet ──https──► Traefik público (web-public) ──► [pod collado]
   ├─ gateway   (uid 10001, PVC collado-gw /gw)          :8080  ← único expuesto: login+RBAC+2FA, shell web, proxy /app/* y /_gw/ws/term
   └─ workbench (root, solo agentd; PVC collado-work /data y /home)       solo 127.0.0.1
        agentd :8081  usuarios de sistema por persona · consolas tmux · supervisor de la app · API de control · jobs `claude -p`
        app    :3000  /data/app (usuario `app`, código editable solo por quien tiene service.manage), datos cifrables en /data/appdata (700)
        /home/<usuario>: cada persona (uid desde 20000), su Claude Code, sus ficheros, su token de API
```

## Capas
1. **Gateway** (`gateway/`): autenticación (argon2id, 2FA TOTP, sesiones, bloqueos), roles/permisos, auditoría, shell web (consola xterm.js, servicio, usuarios), proxy a la app con cabeceras de identidad **+ clave interna**. No es editable por el agente.
2. **agentd** (`gateway/agentd.mjs`, `lib/agentd/*`): `users.mjs` (usuarios de sistema, homes, ajustes y skills gestionados, tokens), `console.mjs` (tmux por usuario, reaper, máximo de usuarios), `supervisor.mjs` (app como usuario `app`, reinicio por cambios, snapshots git, rollback), `upgrade.mjs` (semilla de la imagen ↔ repo git de la app con merge), `jobs.mjs` (`claude -p` como la persona), `keys.mjs`.
3. **App** (`app-seed/app`): motor declarativo (`lib/schema/*` → tablas, API `/api/e/*`, formularios), reglas (`logic.mjs`), informes (`reports.mjs`, `alerts.mjs`), motor de documentos (`lib/docs/*`), SPA sin build (`public/`), diccionarios es/ca/en (`lib/i18n`).
4. **Agente** (`app-seed/workspace/agent`, `tools/`): pautas (`AGENT.md`), 12 skills de dominio, `collado-api`, `collado-doc`, `collado-app`, helpers Python.

## Gestor de archivos
`Archivos` (shell, `static/files.js`) habla con `/_gw/api/files/*` (permiso `agent.console` o `agent.shell`; cabecera CSRF en toda escritura; auditoría `files.*`). El gateway reenvía a agentd (`/files/*`, solo con la clave del gateway), que ejecuta cada operación con `lib/agentd/fsops.mjs` **como el usuario de sistema de la persona** (`setpriv`, igual que la consola): el kernel limita lo que puede tocar; además el worker rechaza rutas fuera de su home (`outside_home`). Las descargas y los `.zip` se transmiten en streaming; las subidas se escriben en un temporal y se renombran (límite `FILES_MAX_UPLOAD_MB`, 200 por defecto). La vista previa solo sirve tipos seguros (imágenes, PDF, audio/vídeo, texto como `text/plain`) con `nosniff` y CSP restrictiva; el resto se descarga. La papelera es `~/.Trash` (+ `.origins.json`). Un enlace simbólico dentro del home apunta a donde pueda llegar ese usuario, nada más.

## Confianza dentro del pod (nada es de fiar por estar en 127.0.0.1)
- `INTERNAL_KEY` (Secret `collado-internal`, solo gateway y agentd). La app recibe claves **derivadas** (`APP_KEY`, `COLLADO_TOKEN_KEY`): una app comprometida no puede suplantar al gateway ante agentd.
- agentd acepta: gateway (clave), app (clave derivada, solo `/job`) y **tokens de persona** (HMAC, 24 h, con los permisos de esa persona; `~/.collado/token`, 0600). La app acepta: gateway (clave + cabeceras de identidad) y tokens de persona; todo lo demás, 401.
- **El agente actúa con los permisos de su persona** (mismos módulos, campos sensibles y ámbito) porque llama a la API con su token.
- Procesos de usuario: `setpriv --reuid --regid --groups --no-new-privs` + `env -i` (sin `INTERNAL_KEY` ni claves). Capacidades del contenedor: CHOWN, DAC_OVERRIDE, FOWNER, SETUID, SETGID, KILL. PSA del namespace: baseline.

## Organizaciones (multiempresa)
- **Gateway**: `auth.json` v2 → `orgs{slug:{name,disabled,roles}}` y `users{…, super, memberships{slug:{roles}}}`. La sesión guarda la organización activa (`POST /_gw/api/me/org`); permisos = unión de los roles de esa organización (menos los de plataforma); el super-admin tiene todos en todas. Cabeceras hacia la app: `x-collado-org` (+ nombre), y la auditoría se etiqueta con la organización.
- **agentd**: el token firmado de cada persona lleva `o` (organización); al cambiar de organización el gateway llama a `/org` y el token se reescribe. Los trabajos `claude -p` no tocan el token.
- **App**: `lib/db.mjs` abre una SQLite por organización y la resuelve con `AsyncLocalStorage` (cada petición corre dentro de `inOrg(slug)`: un handler con `await` no puede tocar otra empresa); adjuntos en `files/` de cada organización; subclaves de cifrado por organización; trabajos, mantenimiento y alertas recorren todas. La organización de una llamada sale de la cabecera del gateway o del token firmado (el agente no puede elegir otra).
- La organización `principal` conserva su ruta histórica (`appdata/collado.db`, `appdata/files`) para no mover datos.

## Permisos y módulos
| Permiso | Permite |
|---|---|
| `app.view` / `app.edit` | Ver / editar datos de producción (programas, planificación, material, emisión, documentos) |
| `fin.view` / `fin.edit` / `fin.approve` | Finanzas (presupuestos, gastos, facturas, tesorería) / aprobar presupuestos, órdenes y facturas |
| `legal.view` / `legal.edit` | Contratos, derechos, cue sheets, RGPD |
| `people.view` / `people.edit` | Datos sensibles del equipo (DNI, IBAN, tarifas) |
| `external` | Acceso externo acotado a programas donde es miembro |
| `agent.jobs` / `agent.console` / `agent.shell` | Generaciones del agente / consola Claude / bash propia |
| `service.manage` | **Solo super-admin.** Servicio: logs, reinicio, rollback; el agente de esa persona puede modificar el código (común a todas las organizaciones) |
| `platform.admin` | **Solo super-admin.** Crear/desactivar organizaciones, saltar entre ellas, usuarios en todas |
| `users.manage` | Usuarios, roles y auditoría de su organización |

Los campos con `perm` se omiten en lecturas y se rechazan en escrituras sin el permiso; los `secret` se cifran en la base de datos. Todo cambio se registra (`changes`) con valores sensibles cifrados/enmascarados.

## Motor de datos
`lib/schema/*.mjs` declara entidades y campos (tipos, enums, referencias, permisos por campo, calendario, tablero, ámbito de programa, acceso externo). `syncSchema()` crea tablas y **solo añade** columnas. Importes en céntimos en SQLite y euros en la API. Optimistic concurrency (`rev`), historial, comentarios, aprobaciones, adjuntos cifrados, notificaciones, búsqueda y exportaciones CSV. La interfaz genérica (lista/tablero/calendario/formulario/detalle/relacionados) sale del mismo esquema que lee el agente (`/api/schema`).

## Documentos
Markdown de Claqueta → AST → HTML (CSS paginado con la marca) → PDF (WeasyPrint) / DOCX y XLSX (escritores propios sin dependencias) / PPTX (python-pptx). Bloques de datos (`:::data`, `:::chart`) consultan el origen con **los permisos de quien renderiza**. Marcas y plantillas son datos editables. Las vistas previas en PNG (pdftoppm) permiten al agente revisar el resultado.

## Seguridad en internet, actualizaciones y límites
Ver «Exposición a internet» abajo. Las actualizaciones fusionan la semilla con el código del volumen (ver OPERATIONS). Límites: el cifrado protege copias y volcados, no a un administrador con consola; la clave `data.key` debe custodiarse aparte; SSO/OIDC no está implementado; Word/PowerPoint no se han abierto en las aplicaciones reales.

## Exposición a internet (endurecimiento)
Un shell con un agente detrás de una URL pública exige defensa en profundidad:
- **2FA TOTP obligatorio** (`REQUIRE_2FA=1`): tras la contraseña hace falta el código de la app de autenticación; una cuenta sin 2FA solo puede cambiar la contraseña y activarlo (API, app y consola devuelven 403/401 hasta entonces). Códigos de recuperación de un solo uso (8, solo se guardan sus hashes); un código TOTP no se puede reutilizar. Un admin puede quitar el 2FA a un usuario (pestaña Usuarios) o por CLI (`user:2fa-reset`).
- **Límite de intentos**: bloqueo progresivo por usuario+IP y por IP (contraseña y código); el login pendiente de 2FA caduca a los 5 min y se destruye a los 5 fallos. La IP es la **más a la derecha** de `X-Forwarded-For` (la que añade nuestro Traefik; lo de su izquierda lo controla el cliente) y el Service de Traefik usa `externalTrafficPolicy: Local` para ver la IP real. Cada fallo queda en la auditoría con la IP.
- **Host fijo** (`ALLOWED_HOSTS=claqueta.solde.cat`, el resto 421; `LEGACY_HOSTS=collado.solde.cat` → 301 al host nuevo con la misma ruta), **HTTP→HTTPS** (301 si `X-Forwarded-Proto: http`), HSTS, cookie `__Host-` HttpOnly/Secure/SameSite=Strict, sesión inactiva 8 h / máx. 72 h, `X-Robots-Tag: noindex`.
- **Roles mínimos**: dar `agent.shell`/`agent.console` solo a quien lo necesite; el resto de usuarios usa la app. La consola es ejecución de código en el pod (sin acceso a clúster/LAN, pero sí a internet): trátala como una cuenta privilegiada.
- Si se pierde el móvil sin códigos: `kubectl -n collado exec deploy/collado -c gateway -- node /opt/gateway/gateway.mjs user:2fa-reset <usuario>`.

## Límites conocidos
- El agente de una persona con `service.manage` puede romper la app; los datos están a salvo en SQLite (copias diarias) y el código en git local (`rollback`, `reset`, tags de actualización).
- Memoria compartida: cada Claude Code consume varios cientos de MB; el máximo de consolas simultáneas es configurable.
- El login de Claude se hace una vez por persona desde su consola (queda en su `/home`, fuera de las copias).
