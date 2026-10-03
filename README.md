# Eye-of-god UI

Interfaz de exploración del grafo de conocimiento generado por Graphify.
Lee el grafo en modo solo lectura; nunca lo modifica ni ejecuta Graphify.

Requisitos: Node 24+ (versión en `.nvmrc`).

```bash
npm ci           # instala exactamente las dependencias de package-lock.json
npm run dev      # servidor de desarrollo (lee el grafo en cada recarga)
npm run build    # comprueba tipos y genera dist/ con una copia del grafo
npm run preview  # sirve dist/ en local
```

### Qué grafo se usa

Una sola regla (`scripts/graph-source.mjs`) para el servidor de desarrollo, el
build, `check:dist` y los tests:

1. `EOG_GRAPH_JSON`, si está definida;
2. `../graphify-out/graph.json`, si existe (el Mac donde se ejecuta Graphify);
3. `graph-snapshot/graph.json`, la copia versionada con la aplicación (cualquier
   otro ordenador y la CI).

| Comando | Qué hace |
|---|---|
| `npm run graph:status` | Compara la copia versionada con `../graphify-out/graph.json`. Falla si son distintas; si no hay `graphify-out/` (otro ordenador, CI), solo informa |
| `npm run graph:sync` | Copia `../graphify-out/graph.json` sobre `graph-snapshot/graph.json`. Solo lee `graphify-out/` |

`graph-snapshot/graph.json` se guarda en Git como binario (sin conversión de
fin de línea ni diff textual): el grafo publicado es byte a byte el que
produjo Graphify.

### En otro ordenador

```bash
git clone <repositorio> eye-of-god-ui && cd eye-of-god-ui
npm ci
npx playwright install chromium   # solo si no hay Google Chrome, para los e2e
EOG_E2E_CHANNEL= npm run verify   # o `npm run verify` con Google Chrome instalado
```

Sin `graphify-out/` al lado, todo usa la copia versionada del grafo.

## Qué se puede hacer

- **Explorar**: zoom, arrastre, búsqueda (`/`), filtros y ámbito por proyecto,
  carpeta o comunidad desde el Explorer. El zoom va de 4× más lejos a 50× más
  cerca que el encuadre inicial. Las etiquetas no se solapan nunca: tienen
  prioridad el nodo seleccionado, el que está bajo el cursor, los nodos de un
  camino y los nodos más conectados; la que no cabe se omite hasta acercarse.
- **Inspeccionar un nodo**: identidad, métricas, relaciones entrantes y
  salientes por tipo, y nodos conectados navegables.
- **Navegar**: atrás y adelante (`[` y `]`), expansión del vecindario a 1, 2 o
  3 saltos y camino entre dos nodos («Path to»).
- **Comunidades**: seleccionar una comunidad desde el Explorer o el Inspector,
  ver sus cifras, proyectos, nodos clave y comunidades conectadas; colapsarla
  en un agregado o expandirla; y «Community view», que colapsa todas a la vez.
  El embudo de cada fila muestra solo esa comunidad.
- `Esc` sale del modo activo: camino, expansión o comunidad inspeccionada.
  Dentro del buscador, primero borra la búsqueda y después sale del campo.
- **En el móvil** (menos de 720 px) Explorer e Inspector comparten la hoja
  inferior: al abrir uno se cierra el otro.
- **Compartir**: la dirección del navegador describe la vista (selección,
  filtros, ámbito, comunidades, camino, expansión y cámara). Se puede recargar,
  guardar en favoritos o copiar con el botón de enlace de la cabecera. Ejemplo:
  `?node=<id>&thirdParty=1&cam=0.5,0.4,0.2`.

La arquitectura, el contrato del adaptador y los riesgos están en
[ARCHITECTURE.md](ARCHITECTURE.md); el lenguaje visual, en
[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).

## Validación

| Comando | Qué hace |
|---|---|
| `npm run graph:status` | La copia versionada del grafo coincide con la de Graphify |
| `npm run typecheck` | Tipos (TypeScript) |
| `npm test` | Tests unitarios y de componentes (Vitest) |
| `npm run check:dist` | Comprueba que `dist/` es publicable (ver Despliegue) |
| `npm run e2e` | Flujos críticos en un navegador real contra el `dist/` existente |
| `npm run test:e2e` | `build` + `e2e` |
| `npm run verify` | Todo, en orden: grafo → tipos → tests → build → `check:dist` → e2e |

`npm run verify` es lo mismo que ejecuta la integración continua. Si un paso
falla, se detiene y devuelve error.

Los e2e (`e2e/`) recorren carga, búsqueda, Explorer, navegación, comunidades,
URL, compartir, combinaciones de funciones (`interactions.spec.ts`), casos
límite, etiquetas sin solapes y uso solo con teclado (`edge-cases.spec.ts`), y
cada flujo principal a 1440×900, 1024×768 y 390×780 (`responsive.spec.ts`).

Navegador de los e2e: en local se usa el Google Chrome instalado, sin descargar
nada. En CI se usa el Chromium de Playwright (`npx playwright install chromium`
y la variable `EOG_E2E_CHANNEL` vacía); lo mismo sirve en local si no hay Chrome.

## Despliegue

Eye of God es un **sitio estático**. No tiene backend, base de datos ni servidor
de aplicación: cualquier servicio que sirva archivos lo puede alojar (GitHub
Pages, Netlify, Cloudflare Pages, un bucket con CDN, nginx…).

`npm run build` genera `dist/`, que es todo lo que hay que publicar:

```
dist/
├── index.html          la página
├── assets/             JS, CSS y fuentes; cada archivo lleva un hash en el nombre
└── data/graph.json     copia del grafo, tomada al hacer el build
```

- Todas las rutas son relativas: funciona en la raíz de un dominio y en
  cualquier subcarpeta (`https://ejemplo.com/apps/eog/`).
- No hacen falta reglas de reescritura. Los enlaces compartidos son la misma
  página con parámetros (`/?node=…`).
- `npm run check:dist` verifica antes de publicar que están `index.html`,
  `assets/` y `data/graph.json`, que el grafo es idéntico al de origen, que
  las rutas son relativas y que no hay restos de desarrollo ni credenciales.

Prueba local: `npm run preview`, o cualquier servidor de archivos
(`cd dist && python3 -m http.server`), también desde una subcarpeta.

Todavía no hay un destino elegido ni nada publicado. Lo único que distingue a
un servicio de otro para este proyecto es si permite fijar las cabeceras de
caché de abajo: Netlify, Cloudflare Pages y nginx lo permiten; GitHub Pages no
(aplica una caché corta a todo, lo cual es correcto pero menos eficiente).

Lo que pide cualquier servicio de hosting estático:

| Ajuste | Valor |
|---|---|
| Versión de Node | 24 (`.nvmrc`) |
| Comando de build | `npm ci && npm run build` |
| Directorio a publicar | `dist` |
| Reglas de reescritura / SPA fallback | Ninguna |
| Variables de entorno | Ninguna obligatoria. `EOG_GRAPH_JSON` (opcional, solo al construir) elige otro grafo; `EOG_E2E_CHANNEL` y `CI` solo afectan a los tests |
| Grafo | Sale de `graph-snapshot/graph.json` (el servicio no tiene `graphify-out/`) |
| Secretos | Ninguno: la aplicación no llama a ningún servicio |

Alternativa sin construir en el servicio: publicar el artefacto
`eye-of-god-dist` que deja cada ejecución de la CI.

El sitio no tiene control de acceso: quien tenga la URL ve el grafo completo.

### Política de caché

| Archivo | Cabecera recomendada | Por qué |
|---|---|---|
| `assets/*` | `Cache-Control: public, max-age=31536000, immutable` | El nombre incluye el hash del contenido: si el archivo cambia, cambia el nombre. Nunca queda obsoleto |
| `index.html` | `Cache-Control: no-cache` | Es quien apunta a los `assets/` actuales. Con caché larga, un visitante seguiría cargando la versión anterior |
| `data/graph.json` | `Cache-Control: no-cache` | Conserva siempre el mismo nombre y cambia cada vez que se publica un grafo nuevo |

`no-cache` no significa «no guardar»: el navegador guarda el archivo y pregunta
al servidor si ha cambiado; si no, recibe un 304 sin volver a descargar los
5,8 MB. Además, la aplicación pide `graph.json` con revalidación obligatoria,
así que un servidor sin cabeceras configuradas tampoco deja a nadie con un
grafo antiguo.

Ejemplo para servicios que leen un archivo `_headers` (Netlify, Cloudflare Pages):

```
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/index.html
  Cache-Control: no-cache
/data/graph.json
  Cache-Control: no-cache
```

### Publicar una versión nueva del grafo

1. Generar el grafo con Graphify (fuera de este proyecto; aquí nunca se ejecuta).
2. `npm run graph:sync`: actualiza la copia versionada.
3. `npm run verify`: construye y valida con el grafo nuevo.
4. Hacer commit de `graph-snapshot/graph.json` y subirlo: la CI repite la
   validación sobre esa copia.
5. Publicar el `dist/` verificado.

Sin el paso 2, `npm run verify` falla en su primer paso: la copia versionada ya
no coincide con la de Graphify.

### Integración continua

`.github/workflows/ci.yml` (GitHub Actions) se ejecuta en cada push a `main`,
en cada pull request y a mano. Instala con `npm ci` y el Chromium de
Playwright, y ejecuta grafo → tipos → tests → build → `check:dist` → e2e
contra ese build, con `CI=true` (180 s por test, 1 reintento). Cualquier paso
que falle hace fallar la ejecución. Guarda el `dist/` verificado como
artefacto (14 días) y, si falla, las trazas de los e2e (7 días). No despliega
nada ni ejecuta Graphify.

Se activará cuando el repositorio esté en GitHub: el repositorio Git local
existe (raíz en esta carpeta) pero todavía no tiene remoto.
