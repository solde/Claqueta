# Claqueta

Aplicación de escritorio (macOS · Windows · Linux) para la gestión de producción de televisión, radio y podcast. Funciona **en el propio equipo y sin conexión**: programas y episodios, planificación, finanzas,
contratos y derechos, documentos (HTML/PDF/Word/Excel), archivos de proyecto y un agente Claude Code opcional. Estilo Neumorfismo 2.0, claro y oscuro.

## Descargar e instalar
**→ [Última versión (todas las plataformas)](../../releases/latest)** · [todas las versiones](../../releases)

| Sistema | Archivo | Notas |
|---|---|---|
| macOS (Apple Silicon) | `Claqueta-<versión>-mac-arm64.dmg` | Abre el `.dmg` y arrastra Claqueta a Aplicaciones |
| macOS (Intel) | `Claqueta-<versión>-mac-x64.dmg` | ídem |
| Windows 10/11 (64 bits) | `Claqueta-<versión>-win-x64-setup.exe` (instalador) o `…-portable.exe` | |
| Linux (64 bits) | `Claqueta-<versión>-linux-x64.AppImage` o `.deb` | `chmod +x` y ejecutar; si falla por el sandbox: `--no-sandbox` |

Las versiones **no están firmadas**: macOS → clic derecho › Abrir la primera vez (o `xattr -dr com.apple.quarantine /Applications/Claqueta.app`); Windows → SmartScreen › Más información › Ejecutar de todos modos.
`SHA256SUMS.txt` (adjunto a cada versión) permite verificar las descargas. Instrucciones detalladas: [docs/DESCARGAS.md](docs/DESCARGAS.md).

## Actualizar
*Ayuda › Buscar actualizaciones…* consulta esta página de versiones (solo cuando tú lo pides; la app nunca se conecta sola) y te lleva a la descarga del instalador de tu sistema. Instálalo encima de la versión
anterior: **tus datos no se tocan** (viven en la carpeta de usuario del sistema, fuera de la aplicación).

## Desarrollo
```bash
npm ci
npm run desktop          # abre la app en modo desarrollo
npm run desktop:smoke    # arranca todo y hace comprobaciones reales dentro de la ventana (Electron)
npm test                 # pruebas unitarias
npm run dist:mac | dist:win | dist:linux     # instaladores en dist/ (cada uno en su propio sistema operativo)
```
Diseño, sincronización en la nube, carpetas de proyecto, límites y lo no verificado: [docs/DESKTOP.md](docs/DESKTOP.md).

## Publicar una versión
1. Sube la versión en `package.json` y haz commit.
2. `git tag vX.Y.Z && git push origin vX.Y.Z` → el flujo `.gitea/workflows/release.yml` construye los instaladores en cada sistema (necesita runners de Gitea Actions con esas etiquetas) y los adjunta a la versión.
3. Sin runners: construye en cada máquina y ejecuta `GITEA_TOKEN=… npm run release -- --tag vX.Y.Z` (crea la versión si no existe y sube todo lo de `dist/` más `SHA256SUMS.txt`).

El token necesita permiso de escritura sobre el repositorio (Gitea › Configuración › Aplicaciones). Como alternativa a la variable, se lee de `~/.config/claqueta/gitea-token`. **Sin token**: `npm run release -- --tag vX.Y.Z --ssh-key ~/.ssh/gitea` firma las peticiones de la API con una clave SSH registrada en tu cuenta de Gitea (clave RSA o Ed25519 sin passphrase; se usa una copia temporal para leerla).
