# Descargas e instalación

Todas las versiones están en la sección **Versiones** (*Releases*) de este repositorio. Cada una lleva los instaladores para todos los sistemas disponibles y `SHA256SUMS.txt`.

## macOS
1. Descarga `Claqueta-<versión>-mac-arm64.dmg` (Mac con chip Apple) o `…-mac-x64.dmg` (Intel). Elegir mal no funciona: *Menú Apple › Acerca de este Mac* indica el chip.
2. Abre el `.dmg` y arrastra **Claqueta** a *Aplicaciones*.
3. La primera vez: clic derecho sobre la app › *Abrir* (no está firmada). Si macOS dice que está dañada: `xattr -dr com.apple.quarantine /Applications/Claqueta.app`.

## Windows
1. Descarga `Claqueta-<versión>-win-x64-setup.exe` y ejecútalo (o la versión `portable`, que no instala nada).
2. SmartScreen avisará de que no está firmada: *Más información › Ejecutar de todos modos*.

## Linux
1. Descarga `Claqueta-<versión>-linux-x64.AppImage`, `chmod +x` y ejecútalo; o instala el `.deb`.
2. En Ubuntu 24.04+ el sandbox de Chromium puede impedir arrancar el AppImage: `./Claqueta-….AppImage --no-sandbox`.

## Verificar la descarga
```bash
shasum -a 256 -c SHA256SUMS.txt --ignore-missing      # macOS / Linux
```

## Actualizar
*Ayuda › Buscar actualizaciones…* abre la descarga de la versión nueva para tu sistema. Instálala encima: los datos (bases de datos, archivos, ajustes) están fuera de la aplicación y se conservan.
Si el repositorio es privado, la comprobación desde la app no puede entrar: usa *Ayuda › Página de descargas* y descarga a mano con tu sesión.

## Datos
- macOS `~/Library/Application Support/Claqueta` · Windows `%APPDATA%\Claqueta` · Linux `~/.config/Claqueta` (si ya existía una carpeta `Collado`, se sigue usando).
- Desinstalar la app no borra los datos; para borrarlos, elimina esa carpeta.

## Estado
Probado en macOS (Apple Silicon). Windows, Linux y macOS Intel se construyen con el mismo código, pero **no se han ejecutado todavía**: avisa de cualquier problema.
