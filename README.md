# Eye-of-god UI

**En producción: https://tollmarc5-dot.github.io/Eye_of_god/**

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
límite, etiquetas sin solapes y uso solo con teclado (`edge-cases.spec.ts`),
cada flujo principal a 1440×900, 1024×768 y 390×780 (`responsive.spec.ts`), y
la legibilidad con el HUD abierto: etiquetas fuera de los paneles, nodo
seleccionado visible y movimiento reducido (`legibility.spec.ts`).

Navegador de los e2e: en local se usa el Google Chrome instalado, sin descargar
nada. En CI se usa el Chromium de Playwright (`npx playwright install chromium`
y la variable `EOG_E2E_CHANNEL` vacía); lo mismo sirve en local si no hay Chrome.

## Despliegue

**Producción: GitHub Pages, https://tollmarc5-dot.github.io/Eye_of_god/**,
desplegado por GitHub Actions desde `main` (ver «Integración continua y
despliegue»). Cada push a `main` que pasa la validación se publica solo.

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

Se eligió GitHub Pages porque despliega desde la propia CI sin otra cuenta
ni secretos, y publica exactamente el `dist/` que ha pasado los e2e. Su único
límite para este proyecto es que no permite fijar cabeceras por archivo (ver
«Política de caché»). `dist/` funciona sin cambios en cualquier otro hosting
estático (Cloudflare Pages, Netlify, nginx…) si algún día hace falta.

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

**En GitHub Pages (medido en producción):** todos los archivos se sirven con
`Cache-Control: max-age=600` y `ETag`, comprimidos (`graph.json` transfiere
unos 150 KB de 5,8 MB). No se puede cambiar. En la práctica:

- `graph.json`: la aplicación lo pide con revalidación obligatoria, así que
  siempre comprueba la versión publicada (304 si no ha cambiado).
- `index.html` y `assets/`: un navegador puede seguir usando la versión
  anterior hasta 10 minutos después de un despliegue. Durante ese margen puede
  combinar la aplicación anterior con el grafo nuevo; funciona mientras el
  formato de `graph.json` no cambie.

Política recomendada para un hosting que sí permita fijar cabeceras:

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

1. Generar el grafo con Graphify en el Mac donde están las carpetas de
   contenido (manual; este proyecto nunca ejecuta Graphify).
2. `npm run graph:sync`: actualiza la copia versionada.
3. `npm run verify`: construye y valida con el grafo nuevo.
4. Commit de `graph-snapshot/graph.json` y `git push origin main`.
5. La CI valida de nuevo y, si todo pasa, despliega en GitHub Pages. Nada más
   que hacer a mano.

Sin el paso 2, `npm run verify` falla en su primer paso: la copia versionada ya
no coincide con la de Graphify.

### Integración continua y despliegue

`.github/workflows/ci.yml` (GitHub Actions) se ejecuta en cada push a `main`,
en cada pull request y a mano (`workflow_dispatch`):

| Job | Cuándo | Qué hace |
|---|---|---|
| `verify` | Siempre | `npm ci`, Chromium de Playwright, grafo → tipos → tests → build → `check:dist` → e2e contra ese build (`CI=true`: 180 s por test, 1 reintento). Guarda `dist/` como artefacto (14 días) y las trazas e2e si falla (7 días) |
| `deploy` | Solo en `main` (push o a mano), solo si `verify` pasa | Publica en GitHub Pages el mismo `dist/` que probó `verify` |

Los pull requests se validan pero nunca despliegan. El despliegue usa las
credenciales temporales de GitHub (`pages: write`, `id-token: write` solo en
ese job): no hay secretos ni tokens en el repositorio. Nunca ejecuta Graphify.

### Verificar la publicación

- La ejecución en la pestaña *Actions* del repositorio: `verify` y `deploy`
  en verde; el job `deploy` enlaza la URL publicada.
- La misma suite e2e contra producción, sin servidor local:

  ```bash
  EOG_E2E_BASE_URL=https://tollmarc5-dot.github.io/Eye_of_god/ npx playwright test
  ```

### Qué sigue siendo manual

Ejecutar Graphify, `npm run graph:sync`, el commit y el push. La
automatización de esa parte (capa 5 en ARCHITECTURE.md) no está implementada.
