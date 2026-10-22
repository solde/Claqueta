# Entorno: Claqueta (aplicación de escritorio)

_En las demás pautas «Collado» es el nombre genérico de la plataforma; en este equipo la aplicación se llama **Claqueta**._

Estas notas **prevalecen** sobre lo de `AGENT.md` que suponga un servidor. Trabajas para **una sola persona**, en **su ordenador** (macOS, Windows o Linux), dentro de la aplicación de escritorio Claqueta. Todo es local.

## Dónde estás y dónde guardas las cosas
- **Carpeta de trabajo** (el directorio actual de tu consola): variable `COLLADO_WORK`. Tu **espacio de archivos** (lo que ve la persona en *Archivos*): `COLLADO_WORKSPACE`. Las herramientas del equipo (`collado-api`, `collado-doc`, `collado-app`) ya están en tu `PATH`; sus módulos de apoyo, en `COLLADO_TOOLS`.
- El `HOME` es el **real** de la persona (necesario para que Claude Code guarde su sesión en el llavero del sistema). **No escribas ahí** ni en otras carpetas personales: tus ficheros van a tu carpeta de trabajo o a la carpeta del proyecto.
- No uses rutas de servidor (`/data/…`, `/opt/…`, `~/work`) ni comandos de Linux sin comprobarlo: pregunta qué sistema es (`process.platform`/`uname`) y usa comandos que existan en él (en Windows, PowerShell).
- **Sin servidor y casi sin red**: la app funciona sin conexión; tú solo sales a internet para tu propio modelo y, si te lo piden, `WebSearch`/`WebFetch` (con las reglas de confidencialidad de siempre).

## Cada proyecto tiene (o puede tener) su carpeta
La ficha de un programa tiene el campo **Carpeta local** (`collado-api get programs ID` → `folder`). Cuando trabajes en un proyecto:
1. Lee su ficha y lo ya existente en Claqueta (como dice `AGENT.md` §2).
2. Si tiene `folder`: es **la carpeta del proyecto**. Ve a ella, lee su `CLAUDE.md` (si existe: son las reglas de ese proyecto y prevalecen) y **guarda ahí** lo que generes (p. ej. en `Documentos/`, `Presupuestos/`, `Entregas/`), con nombres claros y fecha o versión. Aparece también en *Archivos › Proyectos*.
3. Si no la tiene, trabaja en tu carpeta de trabajo, y si es un proyecto con varios entregables propón a la persona elegir una carpeta (campo **Carpeta local** de la ficha).
4. **Comprueba la caja de herramientas** (siguiente sección) antes de crear el primer documento.
5. No borres ni muevas lo que ya hay en esa carpeta sin que te lo pidan; no la sincronices por tu cuenta con nada externo.

## Caja de herramientas: comprueba que puedes hacer documentos de la máxima calidad
**Al empezar a trabajar en cada proyecto** (y cuando un documento salga peor de lo esperado, o falle una herramienta) ejecuta:

```
collado-doc check --program ID          # añade --json si quieres leerlo con un script
```
Te dice qué hay y qué falta, **qué pierde la calidad de los documentos** si falta, y el **comando exacto de instalación para este sistema**. Resumen de lo que importa:

| Qué | Para qué | Si falta |
|---|---|---|
| Motor de PDF y de gráficos (vienen en la app) | PDF con la marca, gráficos en Word | Avisa: la app no está sana; usa HTML/Word y díselo a la persona |
| `pdftoppm` (poppler) | `collado-doc preview`: ver las páginas como imagen y corregirlas | No podrás revisar visualmente: dilo, y revisa con `lint` y el HTML |
| LibreOffice (`soffice`) | Convertir Word/Excel/PowerPoint a PDF para **comprobar cómo se ven** | Los `.docx`/`.pptx` no se podrán verificar: avisa |
| Python 3 + `python-pptx`, `python-docx`, `openpyxl`, `pillow`, `lxml` | PowerPoint (`collado-doc deck`) y documentos Word/Excel a medida | No hay `.pptx` ni plantillas a medida: propón alternativa (PDF, Word) |
| Fuentes de la marca instaladas | Que Word y la vista previa respeten la tipografía de la marca (en PDF/HTML se incrustan) | Se sustituyen: avisa o usa una fuente instalada |
| `pandoc` (opcional) | Conversiones de formato | — |

Reglas:
- **No instales software del sistema por tu cuenta.** Si falta algo que mejora la calidad, di *qué falta, qué mejora y el comando exacto*, y espera a que la persona diga que sí (o lo instale ella). Instalar librerías de Python en tu carpeta de trabajo con su permiso es aceptable; cambiar el sistema, no.
- Si la persona prefiere no instalar nada, sigue con lo que hay y **dile con claridad qué no has podido comprobar** (p. ej. «el Word no lo he visto renderizado»). Nunca entregues como «revisado» lo que no has podido ver.
- Repite `collado-doc check` tras instalar algo, y deja constancia del resultado en el resumen de cierre cuando afecte a un entregable.

## Lo que cambia respecto al servicio web
- **PDF**: lo genera el motor de Chromium de la app (no WeasyPrint). Sin PDF/A y sin números de página en el índice (`:::toc` sale sin ellos). Si el índice con páginas es imprescindible, dilo y propón alternativa.
- **`collado-app`**: solo `status`, `logs`, `restart`. El código de la app es **de solo lectura** (viene dentro del programa): **no uses la skill `collado-servicio`**, no hay `rollback` ni `reset`. Si piden cambiar el comportamiento de la app, explica que eso se hace en el repositorio de Claqueta y se publica como versión nueva.
- **Usuarios y permisos**: la persona es la única usuaria y tiene todos los permisos; sigue aplicando la prudencia de `AGENT.md` con dinero, contratos y datos personales.
- **Varias empresas** (organizaciones) siguen existiendo: no mezcles datos entre ellas.
- **Sincronización en la nube** (si está conectada): no toques `sync/` ni los ficheros de la nube; los datos de la app se suben cifrados por la propia app.
