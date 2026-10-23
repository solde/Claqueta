---
name: collado-servicio
description: Modificar el propio servicio Claqueta (código de la app en /data/app) — añadir campos, entidades, informes, vistas y reglas de negocio, probar, reiniciar y volver atrás. Solo para personas con el permiso service.manage; úsala cuando te pidan cambiar cómo funciona Claqueta, no para trabajo de producción.
---
# Cambiar Claqueta (solo con permiso `service.manage`)

> **En la app de escritorio (Claqueta) esta habilidad NO se aplica:** el código de la app viene dentro del programa y es de solo lectura (no hay `/data/app`, ni `git`, ni `rollback`). Si te piden cambiar cómo funciona la app, explica que se hace en el repositorio de la aplicación y se publica como versión nueva; ofrécete a redactar la petición con todo el detalle.

Si tu persona no tiene el permiso, el código es de solo lectura para ti: explica que lo gestiona una persona administradora. Si lo tiene, puedes cambiar el servicio **dentro de este pod**; el supervisor reinicia la app ~1 s después de guardar y, si no arranca, la pantalla de servicio muestra el error y puedes volver atrás.

## Dónde está cada cosa (`/data/app`, repo git local)
- `lib/schema/*.mjs` — **modelo de datos declarativo**. Añadir un campo = una línea; las columnas se crean solas al arrancar (solo se **añade**, nunca se borra ni cambia nada). Tipos en `lib/schema/dsl.mjs`. Una entidad nueva = un objeto en el fichero de su módulo (`module`, `title`, `list`, `fields`, `program`, `board`, `calendar`, `ext`…) y sale en `/api/schema`, en la API `/api/e/<entidad>`, en la lista/formulario/detalle genéricos y en la búsqueda.
- `lib/logic.mjs` — reglas (`hook(entidad, "before"|"after", fn)`): importes calculados, numeración, aprobaciones, notificaciones.
- `lib/reports.mjs`, `lib/alerts.mjs` — informes y alertas; `lib/docs/datasets.mjs` — orígenes de datos para documentos (un informe nuevo se ofrece como bloque `:::data`).
- `lib/docs/*` — motor de documentos; `lib/docs/seed.mjs` — marcas y plantillas de fábrica.
- `lib/i18n/*` — etiquetas es/ca/en: **añade siempre las tres** (`tests` comprueban que no falte ninguna).
- `public/js/*` — interfaz (módulos ES sin compilar): `views/*` vistas, `lists.js`, `forms.js`, `detail.js`; estilos en `public/app.css` y `nb.css` (neobrutalismo: bordes 3 px, sombras duras, sin degradados ni blur).
- Datos reales: `/data/appdata/collado.db` (SQLite) y `files/` cifrados. **Nunca los borres ni los toques con SQL directo**; no leas `data.key`.

## Método
1. `git -C /data/app status` y entiende el estado; trabaja en cambios pequeños.
2. Edita; espera el reinicio; `collado-app status` y `collado-app logs 40`; `curl -s http://127.0.0.1:3000/healthz` (la API exige tu token: usa `collado-api` para probarla).
3. Prueba la interfaz de verdad (la app se ve en la pestaña «Proyectos»; revisa consola del navegador si puedes) y la API con datos.
4. Commit con mensaje claro: `git -C /data/app commit -am "…"`. Si rompes algo: `collado-app rollback` (vuelve al último estado sano) y reintenta.
5. Las **actualizaciones de la imagen** se fusionan con tus cambios (merge git; ante conflicto gana la versión nueva y tu código previo queda en una etiqueta `pre-upgrade-…`): mantén los cambios acotados y documentados.

## Reglas
- Compatibilidad: no renombres ni borres campos con datos; añade y deja de usar. Migraciones de datos, explícitas y reversibles, con copia previa (`cp collado.db collado.db.bak-$(date +%s)` desde un script, nunca editando la base a mano).
- Seguridad: no cambies la autenticación de `lib/access.mjs`, los permisos por entidad ni el cifrado sin que la persona lo pida expresamente y lo entienda; no añadas endpoints públicos; no escribas secretos en el código.
- Frontend: **URLs relativas** (`api/…`, `js/…`); sin CDN (CSP: solo recursos del propio origen); accesibilidad (foco visible, objetivos táctiles ≥ 44 px, texto en todo estado); respeta el sistema de diseño.
- El **gateway** (login, roles, consola, proxy) corre en otro contenedor y no es editable desde aquí: indícalo si piden cambios de usuarios, roles o 2FA (pestaña Usuarios, solo administradores).
