# Operación de Claqueta

## Despliegue (lo ejecuta David: construye la imagen con buildctl → root)
```bash
sudo -E /home/claude/collado/deploy/deploy.sh vNN      # tags nunca reutilizados
/home/claude/collado/deploy/post-deploy.sh             # comprobaciones, cuenta xcollado, vecinos, copias (sin sudo)
```
`deploy.sh` crea namespace (PSA **baseline**: el contenedor `workbench` corre como root con capacidades mínimas), el Secret `collado-internal` (clave compartida gateway↔agentd↔app), políticas de red, imagen, PVCs, Deployment, Ingress en el **Traefik público**, DNS, certificado Let's Encrypt y la cuenta de administrador `xcollado` con contraseña temporal. La imagen incluye LibreOffice (`--build-arg WITH_OFFICE=0` en el Dockerfile para una más pequeña).

Primer acceso: https://claqueta.solde.cat → contraseña temporal → cambiarla → activar el 2FA (guardar los 8 códigos) → **Consola**: Claude Code pide iniciar sesión *en esa persona* (cada usuario, una vez).

## Organizaciones (varias empresas) y super-admin
- Cada **organización** tiene su propia base de datos SQLite, sus adjuntos y sus subclaves de cifrado (HKDF de `data.key` + el identificador), y sus propios roles. La anterior a esta versión es la organización `principal`: sus datos siguen en `appdata/collado.db` y `appdata/files`; las nuevas viven en `appdata/orgs/<id>/`.
- Solo el **super-admin** (flag de la cuenta, mostrado como rol «super-admin») crea y desactiva organizaciones (pestaña **Organizaciones**), salta entre ellas (selector de la barra), crea usuarios en cualquiera (pestaña Usuarios, selector de organización) y es el único con **Servicio** (el agente de su consola puede modificar el código común a todas las empresas). Estos permisos de plataforma (`service.manage`, `platform.admin`) no se pueden dar a roles de una organización.
- Una persona (una cuenta, una contraseña, un 2FA) puede estar en **una o varias** organizaciones, con roles distintos en cada una. Un administrador de organización (`admin`) gestiona los roles y usuarios de la suya; nombre, contraseña, 2FA y desactivación de quien también está en otras organizaciones los gestiona un super-admin.
- La sesión recuerda la organización activa; al cambiarla la página se recarga y el **token de la consola de esa persona pasa a la nueva organización** (el agente solo ve datos de la que tiene abierta; su memoria de la anterior no se borra: ver las pautas del agente).
- Migración desde la versión de una sola empresa: automática al arrancar. Todo lo existente es la organización `principal` y los usuarios con rol `admin` pasan a **super-admin** (antes ya controlaban todo el servicio).
- CLI: `org:list`, `org:create <id> <nombre>`, `user:create <u> --roles admin --org <id> [--super]` (el primer usuario que se crea es super-admin), `user:super <u> [on|off]`, `user:list`.
- Límites: el código de la app y las pautas son comunes a todas las organizaciones; el `/home` de una persona es único aunque esté en varias (no mezclar datos de empresas en sus archivos); una organización no se borra desde la interfaz (se desactiva).

## Usuarios, roles y accesos
- Pestaña **Usuarios** (crear, roles, desactivar, restablecer contraseña, auditoría). Roles de fábrica: `admin`, `ejecutivo`, `productor`, `contabilidad`, `juridico`, `rrhh`, `externo`, `editor`, `analista`, `lector` (editables; los nuevos aparecen solos tras una actualización sin tocar los existentes).
- Permisos de organización: `app.view/edit`, `fin.view/edit/approve`, `legal.view/edit`, `people.view/edit` (DNI, IBAN, tarifas), `external`, `agent.jobs/console/shell`, `users.manage`. De plataforma (solo super-admin): `service.manage`, `platform.admin`.
- **Externos** (rol `externo`): ven solo los programas donde son *miembro* (app → programa → Equipo y riesgos → Accesos externos: usuario del login) y lo que se comparte con ellos (documentos «compartido», sus tareas, aprobaciones asignadas, entregas/QC). Pueden comentar y decidir sus aprobaciones.
- 2FA perdido: `kubectl -n collado exec deploy/collado -c gateway -- node /opt/gateway/gateway.mjs user:2fa-reset <usuario>`. Contraseña: `user:passwd <usuario> --out /gw/reset.txt`; `user:list` lista usuarios.

## Consolas por persona (usuarios de sistema)
- La primera vez que alguien abre su consola, agentd crea su usuario de sistema (uid desde 20000, `/home/<usuario>` en el volumen, registro en `/data/state/users.json`, `/etc/passwd` se recrea en cada arranque). Los nombres reservados (`root`, `node`, `admin`…) no pueden tener consola.
- Límite de consolas simultáneas `MAX_CONSOLE_USERS` (6) y reaper por inactividad `CONSOLE_IDLE_HOURS` (12; el tmux se detiene, la conversación se reanuda con `--continue`). Cada Claude Code consume varios cientos de MB: límite del contenedor 4 Gi.
- Quien tiene `service.manage` entra en el grupo `collado-dev` (puede **editar el código de la app**); el resto no ve `/data/app` ni `/data/appdata`.
- Login de Claude por persona (en su consola). Opción compartida: Secret `collado-claude` (`oauth-token` / `api-key`) → todos usan la misma cuenta.
- Instrucciones del agente: gestionadas en `/data/shared/agent/` (se sobrescriben con cada imagen); notas del equipo en `/data/shared/TEAM.md` (no se sobrescribe; editable por `service.manage`). Cada persona tiene su `~/CLAUDE.md` para preferencias propias.

## Servicio
`kubectl -n collado get pods`, `logs deploy/collado -c gateway|workbench`. La pestaña **Servicio**: estado, registro, reiniciar, volver a la última versión buena, restaurar la original. Dentro del pod: `kubectl -n collado exec -it deploy/collado -c workbench -- bash` (root).

### Actualizar la app con una imagen nueva
La semilla de la imagen se fusiona (git, `-X theirs`) con el código del volumen: se conservan los cambios del agente que no chocan; si hay conflicto gana la semilla nueva y el código anterior queda en el tag `pre-upgrade-<fecha>-<hash>` (y `UPGRADE-NOTES.md`). La base de datos se migra sola (añadir columnas/tablas; los datos de la v1 se copian a `programs`, etc., y las tablas viejas quedan como `v1_*`).

## Cifrado de datos
Los campos sensibles (DNI, IBAN, datos privados) y todos los adjuntos (contratos, facturas…) se cifran con AES-256-GCM. La clave es `appdata/data.key` (o `COLLADO_DATA_KEY`) y **no está en las copias**. **Guárdala aparte ahora** (un gestor de contraseñas):
```bash
kubectl -n collado exec deploy/collado -c workbench -- cat /data/appdata/data.key
```
Sin ella, una restauración no puede leer los campos ni los archivos cifrados. Protege copias y volcados; **no** protege frente al agente de un administrador con `service.manage` (ejecuta código en el pod).

## Copias de seguridad
`deploy/backup/install-cron.sh` (04:15) → `~/backups/collado/daily/`: `collado-work-*.tgz` (una BD por organización —copia consistente `VACUUM INTO`—, adjuntos cifrados, código, pautas, registro de usuarios), `collado-homes-*.tgz` (cada `/home` sin credenciales de Claude), `collado-gw-*.tgz` (usuarios/roles/auditoría). Restaurar: `deploy/backup/collado-restore.sh <work.tgz> [<gw.tgz>] [--homes <homes.tgz>] [--key <data.key>]`. Copiar los backups fuera del disco sigue siendo tarea de David.

## Pruebas
`npm test` (unitarias), `tests/run-e2e.sh` (stack completo, agente falso), `tests/run-e2e-app.sh` (interfaz de la app). Variables: `PY` (python con playwright), `TMUX_BIN`, `LD_LIBRARY_PATH`; para PDF, WeasyPrint en el PATH.

## No verificado hasta el primer despliegue
Construcción de la imagen (apt/pip/LibreOffice), el arranque de agentd como root con `setpriv` y los usuarios de sistema reales (probado: generación de comandos y modo sin root), el Claude Code real, la fidelidad de los `.docx`/`.pptx` abiertos en Word/PowerPoint (validados estructuralmente con python-docx/python-pptx y openpyxl), y el efecto del PSA `baseline`.
