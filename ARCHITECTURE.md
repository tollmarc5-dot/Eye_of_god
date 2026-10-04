# Arquitectura

Estado: Fase 3 (mundo visual). El grafo ocupa toda la pantalla y la interfaz es un HUD flotante con identidad propia. El motor de la Fase 2 no ha cambiado. El sistema de diseño está en [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).

## Flujo de datos

```
Graphify ──► ../graphify-out/graph.json        solo lectura
                    │  (plugin `graphify-source` de vite.config.ts)
                    ▼
              src/data        adaptador: valida, normaliza, deriva
                    ▼
              src/types       modelo interno (GraphModel)
                    ▼
              src/graph       graphology: grafo base con TODOS los nodos
                    ▼
              layout worker   ForceAtlas2 fuera del hilo principal
                    ▼
              posiciones      por id de nodo, con caché en localStorage
                    ▼
              src/renderer    Sigma.js (WebGL) + reducers
                    ▼
              src/state  ◄──► src/ui + src/features
```

Fronteras: el adaptador no conoce Sigma; Sigma no conoce el formato de
Graphify; el worker no conoce React ni ids (solo índices y arrays tipados);
React no interviene en cada frame (hover y cámara viven en el renderer).

Regla: solo `src/data` conoce el formato de Graphify. El resto trabaja con
los tipos de `src/types/graph.ts`. Los tipos crudos (`GraphifyNode`,
`GraphifyLink`, `GraphifyGraph`) no se exportan fuera de `src/data`.

Cómo llega el JSON a la app:

- En desarrollo, el plugin sirve el archivo real en `/data/graph.json`; un grafo
  regenerado aparece al recargar.
- En build, el plugin copia el archivo a `dist/data/graph.json`.
- La app nunca escribe en `graphify-out/`.

## Carpetas

| Carpeta | Responsabilidad |
|---|---|
| `src/data` | Esquema de Graphify (zod), validación, adaptación al modelo interno, carga por `fetch`, detección de terceros |
| `src/types` | Modelo interno: `InternalNode`, `InternalEdge`, `Community`, `Hyperedge`, `GraphMetadata`, `GraphModel`, filtros, cámara |
| `src/graph` | Grafo graphology, índices por id y comunidad, vecinos, camino mínimo, componentes, máscara de visibilidad (filtros + ámbito) |
| `src/search` | Índice de búsqueda en memoria sobre el modelo interno; no conoce ni el renderer ni la interfaz |
| `src/graph/layout` | Semilla determinista, plan de layout, ForceAtlas2, worker, cliente del worker y caché de posiciones |
| `src/renderer` | Interfaz `GraphRenderer` y su implementación con Sigma; reducers; dibujo de etiquetas; niveles de zoom |
| `src/state` | Store único (zustand): datos, posiciones, selección, filtros, ámbito (proyecto, carpeta, comunidad), petición de foco, paneles, nivel de zoom, tiempos. `selectors.ts` deriva la visibilidad; `graph-session.ts` orquesta la carga y el layout |
| `src/features` | Una carpeta por funcionalidad: `world` (grafo y fondo), `hud` (cabecera, controles, lecturas, carga y error), `search`, `explorer`, `inspector` |
| `src/ui` | `AppShell` (composición), primitivas reutilizables e iconos |
| `src/styles` | Tokens, base, layout del HUD, componentes y tema de las capas de canvas |
| `src/utils` | Funciones puras sin dependencias (rutas, color) |
| `tests` | Tests del adaptador, del modelo de grafo y de contrato contra el `graph.json` real |
| `e2e` | Flujos completos con Playwright contra el build de producción |
| `scripts` | Origen del grafo (`graph-source.mjs`), copia versionada (`graph-snapshot.mjs`), verificación de `dist/` |
| `graph-snapshot` | `graph.json` versionado: el grafo que usan la CI y cualquier ordenador sin `graphify-out/` |
| `.github/workflows` | CI (GitHub Actions) |

## Contrato del adaptador

Entrada: `adaptGraphify(raw: unknown, options?)`. Salida: `GraphModel` inmutable.
No modifica la entrada.

Validación (`parseGraphify`):

- Campos obligatorios en nodos: `id`, `label`, `norm_label`, `community`,
  `file_type`, `source_file`.
- Campos obligatorios en relaciones: `source`, `target`, `relation`, `confidence`,
  `confidence_score`, `weight`, `source_file`.
- Raíz: `directed`, `multigraph`, `nodes`, `links`; `hyperedges` es opcional.
- Un campo nuevo que añada Graphify se ignora.
- Un campo declarado que falte o cambie de tipo lanza `GraphifySchemaError`.
- También son error los ids duplicados y las relaciones hacia nodos inexistentes.
- El error agrupa los fallos repetidos: ruta (`nodes[].source_file`), mensaje,
  cuántas veces ocurre y un ejemplo concreto.

Campos copiados: `id`, `label`, `norm_label` → `searchLabel`, `file_type` → `kind`,
`community`, `source_location`, `rationale`, `_origin` → `origin`,
`_callable` → `isCallable`, `external` → `isExternal`, y en relaciones
`source`, `target`, `relation`, `confidence`, `confidence_score`, `weight`,
`context`, `_origin`.

Campos derivados (deterministas):

| Campo | Regla |
|---|---|
| `sourceFile`, `label` | Normalizados a Unicode NFC |
| `project` | Primer segmento de la ruta si el archivo está dentro de una carpeta; si no, `null` |
| `folder`, `fileName` | Directorio y nombre de archivo de `sourceFile` |
| `extension` | En minúsculas y sin punto; `''` si no hay |
| `degree`, `inDegree`, `outDegree` | Contados sobre las relaciones; un auto-bucle suma en ambos |
| `isThirdParty` | La ruta coincide con `DEFAULT_THIRD_PARTY_PATTERNS` (`*.min.*`, `node_modules/`, `vendor/`, `third_party/`, `bower_components/`); configurable con `thirdPartyPatterns` |
| `edge.id` | `source|relation|target`, con sufijo `#n` si se repite |
| `Community.name` | `community_name` de Graphify si existe y no es el marcador; si no, `Community N` (`nameSource: 'placeholder'`). Los nombres semánticos entrarán por ese mismo campo |

Los ids de nodo y la dirección de las relaciones se conservan tal cual.

## Layout y posiciones

- **Semilla determinista.** `seedPositions` coloca las comunidades en una
  espiral, sin aleatoriedad.
- **ForceAtlas2 finito.** `runForceLayout` ejecuta 300 iteraciones dentro del
  worker y termina; no hay física continua. Misma entrada, mismas posiciones.
- **Protocolo del worker.** `LayoutRequest` lleva solo arrays tipados:
  posiciones iniciales, nodos fijados, pares de índices de aristas e
  iteraciones. Los buffers se transfieren, no se copian.
- **Caché por id.** `planLayout` fija los nodos que ya tienen posición y deja
  libres solo los nuevos, que se siembran fuera del área ocupada. Un nodo
  eliminado se ignora. Si no falta ninguna posición, el worker no se ejecuta.
- **Persistencia.** Las posiciones se guardan en `localStorage` bajo
  `eye-of-god:positions:v1`, redondeadas a dos decimales. Hay que subir la
  versión de la clave si cambia el algoritmo de layout.
- **Layout en dos etapas.** Al cargar se calculan solo los nodos visibles con
  los filtros activos (721 por defecto). Al mostrar el código de terceros,
  `ensurePositions` calcula los 2.550 restantes con los anteriores fijados.

## Render e interacción

- **Grafo base completo.** `buildGraph` crea los 3.271 nodos y 9.281
  relaciones. Los filtros son un conjunto de ids visibles que el renderer
  aplica en sus reducers; nada se elimina del grafo.
- **Encuadre por visibles.** El renderer fija la caja de Sigma a los nodos
  visibles, para que los ocultos no encojan la vista.
- **Reducers sin asignaciones.** Sigma entrega a cada reducer una copia de los
  atributos; se rellena esa copia en lugar de crear objetos nuevos.
- **Foco.** El nodo activo es el que está bajo el cursor o, si no hay, el
  seleccionado. Se resaltan él, sus vecinos directos y sus relaciones; el resto
  se atenúa.
- **Relaciones.** `RendererViewState` ya admite `showEdges` y
  `visibleRelations`, de modo que los filtros futuros no exigen tocar el
  renderer.
- **Nivel de detalle.** Con más de 4.000 relaciones visibles se ocultan
  mientras la cámara se mueve. Las etiquetas solo se dibujan para nodos grandes
  y nunca se solapan (ver «Funcionalidades cerradas (Fase 11)»).
- **Color.** Ver «Grafo vivo» más abajo.
- **Cámara.** `zoomIn`, `zoomOut`, `resetCamera` y `focusNode(id)`. Las
  transiciones duran 250 ms, o 0 con `prefers-reduced-motion`. El zoom está
  acotado entre 50× más cerca y 4× más lejos que el encuadre inicial
  (`CAMERA_RATIO_LIMITS`), para la rueda, los botones y las cámaras restauradas.
  Desde la Fase 15A todo encuadre se centra en el área que deja libre el HUD
  (ver «Legibilidad del HUD (Fase 15A)»).

## Grafo vivo (refinamiento visual)

Todo es presentación: ni el adaptador, ni el modelo, ni graphology, ni el
layout, ni la búsqueda o los filtros cambian.

| Qué | Dónde |
|---|---|
| Color de nodos y aristas | `src/utils/color.ts`, `src/styles/canvas-theme.ts` |
| Tamaño de nodo (por grado) | `nodeSize` en `src/graph/build-graph.ts` |
| Intensidad, hover, selección | `src/renderer/reducers.ts` |
| Dibujo de nodos (núcleo, halo, anillo) | `src/renderer/programs/glow-node.ts` |
| Dibujo de aristas (línea, pulsos) | `src/renderer/programs/flow-edge.ts` |
| Deriva compartida por ambos programas | `src/renderer/programs/drift.glsl.ts` |
| Nivel de detalle, calidad, valores por frame | `src/renderer/motion.ts` |
| Bucle de render y zoom de cámara | `src/renderer/sigma-renderer.ts` |
| Etiquetas | `src/renderer/draw-labels.ts`, colocación en `src/renderer/label-layout.ts` |

- **Una sola familia de color.** El tono de cada comunidad se reparte por el
  arco 190°–280° (cian, azul eléctrico, índigo, violeta, púrpura) con la razón
  áurea; cinco bandas de luminosidad y tres de saturación mantienen 169 colores
  distintos. El código de terceros usa azules pizarra apagados (214°–244°).
- **Nodo = núcleo + halo + anillo**, en un programa WebGL propio y un triángulo
  por nodo. El reducer añade `glow` (0–1, derivado del tamaño, es decir del
  grado) y `accent` (0, hover, seleccionado). No hay elementos DOM por nodo.
- **Movimiento = posición base + desplazamiento en el shader.** El vértice se
  desplaza unos píxeles alrededor de su posición con dos senos lentos: el 60 %
  lo comparte la comunidad (una fase por comunidad) y el 40 % es propio (fase
  por hash de la posición). Las aristas aplican la misma función a cada
  extremo, así que nunca se separan de sus nodos. Graphology, las posiciones,
  la caché y los índices de Sigma no se tocan: por frame solo cambia un
  uniforme de tiempo y se pide un redibujado (`scheduleRender`). React no
  interviene.
- **Flujo de datos.** Los pulsos se calculan en el fragment shader de la
  arista, sin objetos partícula. Siempre en las relaciones del nodo activo; en
  reposo solo en un 30 % de las aristas y solo desde el nivel Structure.
- **Nivel de detalle** (`resolveEffects`):

  | Nivel | Deriva máx. | Halo | Flujo ambiente |
  |---|---|---|---|
  | Universe | 1,2 px | 0,75 | ninguno |
  | Structure | 1,9 px | 0,9 | tenue |
  | Detail | 3 px | 1 | visible |

- **Calidad adaptativa.** `createFrameMonitor` mide ventanas de 90 frames; si
  la media supera 24 ms baja un escalón: `full` → `calm` (sin flujo ambiente,
  deriva al 60 %) → `still` (sin animación; el bucle se detiene). Nunca vuelve
  a subir, para no oscilar.
- **Movimiento reducido.** Con `prefers-reduced-motion` el renderer arranca en
  `still`: el bucle no llega a empezar. Halos, anillo, hover y selección siguen
  funcionando como estados estáticos.

Decisiones y sus costes:

- **Sin puntas de flecha.** El tipo de arista pasó de `arrow` a una línea
  propia. La dirección se lee en las relaciones del nodo activo: se aclaran
  hacia el destino y los pulsos viajan de origen a destino.
- **Etiquetas y detección de cursor usan la posición base.** La deriva es de
  3 px como máximo, menor que el radio mínimo de un nodo, y el paso de
  selección por GPU sí sigue al nodo.
- **Redibujado continuo.** Mientras la calidad no sea `still`, Sigma dibuja
  cada frame (también las etiquetas). En la medición se mantuvieron 60 FPS con
  3.271 nodos y 9.281 relaciones.

## Interfaz (Fase 3)

- **Mundo a pantalla completa.** El canvas de Sigma cubre todo el viewport
  sobre un fondo estático (degradados, rejilla y órbitas). Los paneles flotan
  encima y se pueden cerrar todos con el control VIEW.
- **React no toca los frames.** Los controles llaman a `GraphCommands`
  (contexto con `zoomIn`, `zoomOut`, `resetCamera`, `focusNode`), que delega en
  el renderer. El nivel de zoom llega al store como mucho cada 120 ms.
- **Una sola selección.** El inspector lee `selectedNodeId` del store, el mismo
  valor que resalta el renderer.
- **Niveles de zoom.** El renderer clasifica la cámara en universe, structure o
  detail y ajusta la densidad de etiquetas al cambiar de nivel.
- **Cabecera.** Wordmark, campo de búsqueda y, a la derecha, estado del sistema
  con las cifras de nodos, relaciones y comunidades.
- **Comunidades como constelaciones.** No se dibujan regiones ni polígonos. Las
  relaciones internas de una comunidad llevan un tinte oscuro de su color
  (`communityEdgeColor`); las que cruzan comunidades quedan neutras.
- **Nombres de comunidad.** Desde que `graph.json` trae `community_name`, la
  interfaz muestra esos nombres sin cambios de código; `Community N` sigue como
  reserva.
- **Explorer y búsqueda.** Ver «Exploración (Fase 4)».
- **Responsive.** Por debajo de 1.100 px los paneles se estrechan y el
  inspector empieza cerrado; por debajo de 720 px los paneles pasan a hojas
  inferiores. Es una base, no una versión móvil terminada.
- **Fuentes empaquetadas.** IBM Plex Sans y Mono vía `@fontsource`, sin CDN.

## Exploración (Fase 4)

Cuatro conceptos, cada uno con un único dueño en el store:

| Concepto | Estado | Qué decide |
|---|---|---|
| Nodo seleccionado | `selectedNodeId` | Qué nodo se inspecciona y resalta. No oculta nada |
| Filtros | `filters` (+ `preferences.showEdges`) | Qué clases de nodo se dibujan: terceros, aislados, relaciones |
| Ámbito | `activeProject`, `activeFolder`, `activeCommunity` | Qué parte del grafo se dibuja |
| Petición de foco | `focusRequest` | A qué nodo debe viajar la cámara cuando ya esté dibujado |

**Una sola regla de visibilidad.** `isNodeVisible(node, filters, scope)` en
`src/graph/filters.ts` es la única que decide si un nodo se dibuja: pasa los
filtros Y está dentro del ámbito. Lo que queda fuera se **oculta** (no se
atenúa), junto con sus aristas. `computeVisibility` devuelve la máscara y los
recuentos de nodos, relaciones y comunidades; `selectVisibility` la memoiza,
de modo que el grafo, la cabecera y el explorer leen el mismo resultado. El
grafo graphology nunca se reconstruye ni se vuelve a calcular el layout.

**Transiciones.**

| Acción | Efecto |
|---|---|
| `selectNode(id)` | Selecciona, abre el inspector, apila en el historial |
| `setActiveProject(p)` | Fija el proyecto y descarta la carpeta |
| `setActiveFolder(f)` | Solo con un proyecto activo |
| `setActiveCommunity(c)`, `setFilters(…)` | Cambian la máscara |
| cualquier cambio de filtros o ámbito | Si el nodo seleccionado deja de dibujarse, se deselecciona |
| `clearScope()` | Quita proyecto, carpeta y comunidad |
| `resetExploration()` | Ámbito vacío, filtros por defecto, relaciones visibles |
| `revealNode(id)` | Selecciona, relaja solo los filtros y partes del ámbito que ocultaban el nodo, y pide foco |

Flujo: explorer o búsqueda → store → `GraphWorld` (máscara y selección al
renderer; reencuadre al cambiar de ámbito; foco cuando el nodo ya tiene
posición) → inspector. Clic en el grafo → `selectNode` → inspector y marca en
el explorer del proyecto y la comunidad que contienen el nodo.

**Búsqueda.** `buildSearchIndex(model)` se construye una vez al cargar. Cada
nodo guarda sus campos normalizados (NFKD, sin diacríticos, minúsculas):
etiqueta y `norm_label`, nombre de archivo, ruta (incluye proyecto y carpeta),
nombre de comunidad, tipo y extensión. Todas las palabras de la consulta deben
coincidir; la puntuación prima etiqueta sobre archivo, ruta, comunidad y tipo,
y desempata por grado y por id, así que el orden es determinista. Una consulta
que alarga la anterior solo revisa las coincidencias previas. La búsqueda
recorre todos los nodos, también los ocultos: esos resultados llevan la marca
«Outside view» y al elegirlos se revelan con `revealNode`.

**Explorer.** Cada lista cuenta los nodos que se dibujarían al pulsar esa fila
(filtros más el resto del ámbito). Las filas alternan el ámbito; solo la lista
«Key nodes» selecciona un nodo. El bloque «Active scope» muestra lo activo,
permite quitar cada parte y limpiar todo.

**Encuadre.** Al cambiar de ámbito la cámara vuelve al encuadre general;
`framingRatio` aleja lo justo para que el grafo no quede bajo los paneles
laterales en pantallas anchas.

**Teclado.** `/` lleva el foco a la búsqueda; flechas recorren resultados,
Enter elige, Escape cancela. En el explorer, Tab entra en cada fila y las
flechas recorren la lista.

## Inspector avanzado (Fase 5)

Flujo: `graph.json` → adaptador → modelo → graphology e índices → store →
Inspector. El Inspector no lee nunca el JSON de Graphify.

**Modelo real de relaciones.** Cada enlace de Graphify tiene `source`,
`target` y `relation`, y conserva su dirección real aunque el archivo declare
`directed: false`. Hay 15 tipos: `calls`, `contains`, `indirect_call`,
`method`, `references`, `conceptually_related_to`, `imports`, `inherits`,
`imports_from`, `rationale_for`, `semantically_similar_to`,
`shares_data_with`, `implements`, `cites` y `defines`. Ningún tipo está
escrito en el código: se listan los que aparezcan. Cada enlace lleva además
`confidence` (`EXTRACTED`, `INFERRED`, `AMBIGUOUS`).

**Capa de análisis** (`src/graph/node-relations.ts`). `analyzeNode(graph,
index, id)` recorre solo las aristas del nodo con la adyacencia de graphology
y devuelve sus conexiones (arista, dirección, nodo del otro extremo), los
recuentos por tipo y dirección, los vecinos distintos y el número de
relaciones. Una autorreferencia es una relación, no un vecino, y cuenta una
vez de entrada y otra de salida en el grado; el Inspector lo explica.
`sortConnections` y `filterConnections` son funciones puras.

**Panel** (`src/features/inspector`): `InspectorPanel` (estados y acciones),
`NodeSummary` (identidad, ubicación, métricas) y `NodeRelations` (relaciones y
nodos conectados). Estado local solo para lo que es del panel: filtro por
relación, orden y páginas de 25 filas; se reinicia al cambiar de nodo.

| Estado | Qué muestra |
|---|---|
| Sin selección | «No node selected» |
| Nodo seleccionado | Identidad, ubicación, métricas, relaciones, conectados, acciones |
| Esperando posición | «Positioning node in the graph…» mientras hay una petición de foco pendiente |
| Sin relaciones | «No relationships»; EXPAND deshabilitado |
| Muchas relaciones | 25 filas y «Show more»; orden por relación, nombre o grado a partir de 8 filas |
| Selección inexistente | «Node not available» con CLEAR |

**Navegación.** Pulsar un nodo conectado llama a `revealNode`, el mismo camino
que la búsqueda: selecciona, pide foco y el renderer y el Inspector siguen al
store. No existe una segunda selección.

**Filtros.** Las relaciones se listan todas; no se quitan del modelo. Un
vecino que los filtros o el ámbito no dibujan lleva la marca «Outside view» y
se cuenta en la nota de métricas. Al abrirlo, `revealNode` relaja solo lo
necesario para dibujarlo.

**EXPAND.** Encuadra el nodo con sus vecinos dibujados
(`GraphRenderer.frameNeighborhood`, sobre la misma cámara que FOCUS). No
cambia qué se dibuja: no revela vecinos ocultos ni expande por profundidad.
Eso, el camino entre nodos y el historial quedan para la Fase 6; el punto de
extensión es el comando `expandNode` de `GraphCommands`.

**Limitaciones de los datos.** No hay métricas de centralidad en el modelo, así
que no se muestran. El campo `context` de las aristas existe pero solo repite
el tipo de llamada; no se enseña.

## Navegación avanzada (Fase 6)

Tres piezas, todas sobre lo que ya existía: `history` del store, el comando
`expandNode` y `findShortestPath`. El store guarda solo ids; los conjuntos de
nodos se derivan.

| Estado en el store | Contenido | Derivado (en `src/state/selectors.ts`) |
|---|---|---|
| `history`, `historyIndex` | Ids visitados, máx. 100 | — |
| `expansion` | `{ rootId, depth }` o `null` | `useExpansion` → nodos del vecindario |
| `path` | `idle` · `picking { fromId }` · `set { fromId, toId }` | `usePathView` → ruta, o por qué no hay |

**Historial.** Solo lo escribe la navegación entre nodos (`selectNode`,
`revealNode`): clic en el grafo, búsqueda, listas del Inspector y del Explorer.
No lo tocan cámara, filtros, ámbito, paneles ni limpiar la selección. Nunca
repite el mismo nodo dos veces seguidas, y navegar después de retroceder
elimina la rama de avance. `goBack` y `goForward` mueven el índice sin apilar,
seleccionan el nodo, lo hacen visible si un filtro lo ocultaba y piden foco.

**Expansión por profundidad** (`expandNeighborhood` en
`src/graph/navigation.ts`). Recorrido en anchura desde el nodo seleccionado,
1, 2 o 3 saltos, con la adyacencia de graphology y sin salir de los nodos que
la vista dibuja. La expansión no cambia qué se dibuja: ilumina el vecindario,
atenúa el resto y lo encuadra. Los vecinos que los filtros ocultan no se
recorren; se cuentan y se informan. Si cambian los filtros, el vecindario se
recalcula solo.

Límite de seguridad: 300 nodos. En el grafo real, con el código de terceros
oculto, el mayor vecindario a 3 saltos tiene 57 nodos; con terceros visibles
llega a 1.277. Al alcanzar el límite el recorrido se detiene en un orden
determinista y la interfaz lo indica.

**Camino entre dos nodos** (`findPath`, sobre `findShortestPath`). Menor número
de saltos, ignorando la dirección de las relaciones; cada salto conserva sus
relaciones reales y si se recorre a favor o en contra. Solo pasa por nodos
dibujados. Flujo: seleccionar A → «Path to» → la siguiente selección, por
cualquier medio, es el destino y pasa a ser el nodo seleccionado.

| Caso | Comportamiento |
|---|---|
| A → A | Camino de un nodo, sin saltos; se explica |
| Sin camino | «No path found»; la selección sigue funcionando |
| Solo por nodos ocultos | «No path found», indicando que existe fuera de la vista; aparece al mostrarlos |
| Cambian filtros o ámbito | El camino se recalcula |
| Camino largo | La lista se desplaza dentro del panel |

**Renderer.** `RendererViewState.highlight` (`expansion` o `path`) sustituye a
«vecinos del nodo activo» como conjunto iluminado. En un camino solo se
encienden sus relaciones, en cian y con flujo. El hover sigue respondiendo.
`frameNodes` encuadra el conjunto con la misma cámara que FOCUS, sin acercar
más allá de un límite. Expansión y camino se excluyen entre sí.

**Teclado.** `[` y `]` recorren el historial. Escape sale del modo temporal
activo: primero el camino, después la expansión. Si un componente ya usó la
tecla (búsqueda, filtro de relaciones), no se propaga.

**Aviso de modo** (`NavigationStatus`). Con cualquier modo activo, una banda
bajo la cabecera dice cuál es y ofrece salir, también con los paneles cerrados.

## Comunidades (Fase 7)

**Qué hay en los datos.** Graphify da a cada nodo un `community` (número, no
necesariamente consecutivo) y un `community_name`. Nada más: tamaño, cifras y
relaciones entre comunidades se derivan del grafo. Entre nodos propios no hay
ninguna relación que cruce comunidades; con el código de terceros dibujado hay
3.156, entre 184 pares de comunidades.

**Modelo derivado** (`src/graph/communities.ts`).

| Función | Qué devuelve | Cuándo se calcula |
|---|---|---|
| `summarizeCommunities` | Por comunidad: nodos dibujados, relaciones internas y externas dibujadas, comunidades vecinas | Una pasada por nodos y otra por aristas, solo al cambiar la visibilidad |
| `describeCommunity` | Miembros, proyectos, carpetas, nodos clave y comunidades conectadas de UNA comunidad | Al seleccionarla; cuesta su tamaño |
| `computeAggregates` | Un agregado por comunidad colapsada con miembros dibujados | Al colapsar, expandir o cambiar la visibilidad |

Total y visible son cifras distintas: una comunidad de 119 nodos de terceros
tiene 0 visibles mientras ese código esté oculto, y así se muestra.

**Estado** (solo ids, en el store):

| Estado | Significado |
|---|---|
| `selectedCommunityId` | Comunidad inspeccionada. Se inspecciona un nodo O una comunidad |
| `aggregation` | `{ mode, exceptions }`: en `nodes` las excepciones son las colapsadas; en `communities`, las expandidas |
| `activeCommunity` | El filtro de siempre: dibuja solo esa comunidad. No es la selección |

**Agregación sin tocar el grafo.** No se añaden nodos ni aristas a graphology
y ningún nodo cambia de posición. Al colapsar una comunidad:

- su miembro mejor conectado entre los dibujados (desempate por id) se dibuja
  como agregado, en su propia posición, con tamaño según el número de miembros
  y la etiqueta «nombre · n»;
- los demás miembros se reducen a un tamaño invisible y quedan anclados al
  representante; no se ocultan, porque Sigma dejaría de dibujar sus relaciones.
  Qué extremo se dibuja dónde lo decide `src/renderer/anchoring.ts`, que usan
  los reducers y el programa de aristas;
- las relaciones internas no se dibujan; las que salen de la comunidad se
  dibujan terminando en el agregado (el programa de aristas usa la posición
  del ancla). Varias relaciones hacia el mismo destino se superponen en una
  línea: no se crea ninguna arista artificial.

Sigma descarta las posiciones que devuelve un reducer al reindexar, por eso el
agregado no se coloca en el centro geométrico de la comunidad sino sobre un
nodo real.

**Interacciones.**

| Gesto | Efecto |
|---|---|
| Fila de comunidad en el Explorer | Selecciona y encuadra la comunidad; no oculta nada |
| Embudo de la fila, o «Only this» | Filtro: dibuja solo esa comunidad (reversible) |
| Clic en un agregado | Selecciona la comunidad |
| FOCUS | Encuadra el agregado o todos los nodos de la comunidad |
| COLLAPSE / EXPAND | Agregado ↔ nodos, sin layout ni reconstrucción |
| «Community view» | Colapsa todas; «Back to nodes» vuelve |
| Nodo clave en el Inspector de comunidad | Comunidad → nodos: selecciona el nodo y expande su comunidad |
| «Open community» en el Inspector de nodo | Nodos → comunidad |
| Comunidad conectada | Navega a esa comunidad |
| Escape | Camino → expansión → comunidad inspeccionada, en ese orden |

No hay doble clic: todas las acciones son explícitas.

**Convivencia con la Fase 6.**

| Caso | Decisión |
|---|---|
| A. «Path to» con comunidades colapsadas | Funciona. El destino es un nodo; un agregado no es destino. Las comunidades por las que pasa el camino se dibujan expandidas mientras se muestra |
| B. Colapsar con una expansión activa | Colapsar es un cambio de estructura: termina la expansión y el camino. Si la comunidad contenía el nodo seleccionado, la selección pasa a la comunidad |
| C. Cambiar de comunidad con un camino mostrado | El camino se mantiene; el filtro «solo esta» lo recalcula |
| D. Seleccionar un nodo de una comunidad colapsada | La comunidad se expande; el nodo queda seleccionado |
| E. Seleccionar una comunidad con un nodo seleccionado | El nodo se deselecciona y su expansión termina |

El historial sigue siendo de nodos: seleccionar, colapsar o expandir
comunidades no registra nada. Retroceder a un nodo de una comunidad colapsada
la expande.

**Limitaciones.** El agregado no está en el centro de la comunidad sino sobre
su nodo representante. Desde la Fase 8 la vista de comunidades sí se guarda en
la URL, y desde la Fase 11 las etiquetas de agregados vecinos ya no se solapan.

## Persistencia y enlaces (Fase 8)

La URL guarda la vista, no el grafo: ids e interruptores. Todo lo demás se
recalcula a partir de `graph.json`.

**Una sola capa** (`src/state/url-state.ts`): `encodeViewState(view)` y
`decodeViewState(search, { model, index })`. Ningún componente lee la URL.

**Contrato.** Un parámetro por dato; solo se escribe si difiere del valor por
defecto, así que la vista inicial es una URL sin parámetros. El orden es fijo.

| Parámetro | Valor | Significado |
|---|---|---|
| `node` | id de nodo | Nodo seleccionado |
| `community` | número | Comunidad inspeccionada (se ignora si hay `node`) |
| `project`, `folder` | clave | Ámbito; `folder` necesita `project` |
| `only` | número | Filtro «solo esta comunidad» |
| `thirdParty` | `1` | Código de terceros visible |
| `isolated` | `0` | Nodos aislados ocultos |
| `relations` | `0` | Relaciones ocultas |
| `view` | `communities` | Vista de comunidades |
| `collapsed` / `expanded` | lista `1,5` | Excepciones: colapsadas en vista de nodos, expandidas en vista de comunidades |
| `from`, `to` | ids de nodo | Extremos del camino; la ruta se recalcula |
| `expand` | `1`–`3` | Profundidad de expansión de `node` |
| `cam` | `x,y,ratio` | Cámara de Sigma, tres decimales |

No se guardan: búsqueda, paneles, hover, historial interno, modo «eligiendo
destino», posiciones de nodos ni nada derivable.

**Validación.** La URL es entrada no fiable. Cada valor se comprueba por tipo,
rango, longitud y existencia en el grafo cargado; lo que no cumple se ignora y
se usa el valor por defecto. `decodeViewState` nunca lanza y nunca devuelve un
estado contradictorio (nodo y comunidad a la vez, expansión sin nodo, carpeta
sin proyecto). Los valores solo se usan como ids y números: nunca como HTML.

**Restauración.** `loadGraphSession` aplica la URL en el mismo paso en que el
grafo pasa a «ready», de modo que el grafo se monta ya con la vista enlazada.
`restoreView` reutiliza el camino normal de selección: si los filtros del
enlace ocultarían su propio nodo, se revela. Con `cam`, la cámara se coloca
cuando todos los nodos dibujados tienen posición (también tras el layout de
terceros) y sustituye al foco automático; sin `cam`, se hace foco como siempre.

**Sincronización** (`src/state/url-sync.ts`). Un sentido cada vez: el store
escribe la URL; solo Atrás/Adelante del navegador escriben el store, con la
escritura suspendida mientras tanto. No hay bucle posible.

| Cambio | Historial del navegador |
|---|---|
| Nodo, comunidad, ámbito, vista de comunidades, camino | `pushState`: una entrada nueva |
| Interruptores, colapsar, expansión | `replaceState` |
| Cámara | `replaceState`, 400 ms después de que se detenga |
| Paneles, búsqueda, hover, animación | Nada |

**Dos historiales distintos.** El del navegador recorre vistas (URL). El
interno (`history` del store, botones y `[` `]`) recorre nodos visitados. No
comparten estructura: ir atrás en el navegador restaura la vista y, como
cualquier selección, añade ese nodo al interno; ir atrás con el interno es una
navegación más para el navegador.

**Compartir.** El botón de enlace de la cabecera copia `currentViewUrl()`. Si
el portapapeles no está disponible o se deniega, muestra el enlace en un campo
ya seleccionado para copiarlo a mano. El resultado se comunica con texto.

**Limitaciones.** La cámara es relativa al conjunto de nodos dibujados: un
enlace con `cam` encuadra igual mientras el grafo y los filtros sean los
mismos; si `graph.json` se regenera, puede quedar desplazada (la selección y
los filtros siguen siendo válidos si los ids existen). Los ids de comunidad
pueden cambiar al regenerar el grafo. No hay acortador de enlaces.

## Robustez y entrega (Fase 9)

**Suite e2e** (`e2e/`, `playwright.config.ts`, `npm run test:e2e`). Corre
contra el build de producción servido como archivos estáticos y contra el
`graph.json` real. No usa ningún gancho de desarrollo: maneja la interfaz como
un usuario y lee el resultado en el DOM y en la URL. Cada test falla si la
página registra un error o un aviso en consola.

| Archivo | Cubre |
|---|---|
| `load.spec.ts` | Carga, grafo dibujado, `graph.json` junto a la página, ningún recurso fallido ni externo, sin gancho de desarrollo |
| `search.spec.ts` | Búsqueda, teclado, selección, Inspector, foco de cámara, sin resultados |
| `explorer.spec.ts` | Proyecto, carpeta, «solo esta comunidad», interruptores, reset |
| `navigation.spec.ts` | Historial interno, expansión 1/2/3, camino, sin camino |
| `communities.spec.ts` | Vista de comunidades, expandir, colapsar, foco, comunidad ↔ nodos |
| `url.spec.ts` | Recarga de selección, cámara, filtros, comunidades y camino; Atrás/Adelante; sin bucles; enlace directo; enlace roto |
| `share.spec.ts` | Copiar enlace y abrirlo en otra página; alternativa sin portapapeles |
| `responsive.spec.ts` | 1440×900, 1024×768 y 390×780: flujo completo sin overflow |

Los tests no dependen de nodos concretos: eligen lo que la propia interfaz
ofrece (primer resultado, primera comunidad), así que siguen valiendo si el
grafo se regenera, salvo que cambie su forma (por ejemplo, que dejen de existir
comunidades sin relación entre sí).

**Bundle.** Todo el JavaScript es necesario para el primer render: react-dom
(211 kB), sigma (90), zod (84, valida `graph.json` al cargar), graphology (61)
y unos 125 kB de la aplicación. No hay nada secundario de peso que cargar más
tarde, así que no se añadió carga diferida: complicaría el arranque para
ahorrar pocos kB. Lo que sí se hizo es separar el código de terceros en dos
archivos (`vendor-react`, `vendor-graph`) que solo cambian al actualizar una
dependencia: quien vuelve tras una versión nueva de la app no los descarga de
nuevo. El total no baja; el aviso de 500 kB desaparece porque ningún archivo
lo supera.

**Sitio estático.** `base: './'` hace relativas todas las rutas, y la carga de
`graph.json` y la capa de URL ya usaban la ruta de la página. `dist/` funciona
en la raíz de un dominio y en una subcarpeta, sin reglas de servidor.

## Publicación y CI (Fase 10)

**Estado de partida.** El directorio no es un repositorio Git y no había
configuración de CI ni de ningún servicio de despliegue.

**Pipeline** (`npm run verify`, y los mismos pasos en el workflow de CI; desde
la Fase 12 en `.github/workflows/ci.yml`, con un paso previo de comprobación
del grafo):

```
typecheck → tests unitarios → vite build → check:dist → e2e contra ese dist/
```

Un solo build: `verify` llama a `vite build` (los tipos ya se han comprobado)
y a `e2e`, que prueba el `dist/` existente. `test:e2e` sigue existiendo para
uso suelto y sí construye antes.

| | Local | CI |
|---|---|---|
| Dependencias | `npm install` | `npm ci` |
| Navegador e2e | Google Chrome instalado | Chromium de Playwright, instalado en el workflow |
| `EOG_E2E_CHANNEL` | sin definir (`chrome`) | vacía (sin canal) |
| Reintentos e2e | 0 | 1 |

En la Fase 10 el workflow vivía en `ci/`, inactivo, porque no había
repositorio. En la Fase 12 pasó a `.github/workflows/ci.yml` del repositorio
(ver «Infraestructura (Fase 12)»).

**`scripts/check-dist.mjs`.** Falla si falta `index.html`, `data/graph.json`
o los `assets/`; si el grafo publicado no es byte a byte el de origen; si
`index.html` usa una ruta no relativa o nombra un archivo que no existe; si un
asset no lleva hash; o si algún JS, CSS o HTML contiene una dirección de
desarrollo, `__EOG__`, un log de depuración, una referencia a mapas de código
o un patrón de credencial.

**Consola en e2e.** Los tests fallan con cualquier error o aviso de consola,
con una única excepción: las notas de rendimiento del controlador gráfico del
navegador («GL Driver Message … Performance … GPU stall due to ReadPixels»),
que aparecen cuando WebGL corre sin GPU real y describen la máquina, no la
aplicación.

**Caché.** `assets/*` inmutables (nombre con hash); `index.html` y
`data/graph.json` con revalidación. La aplicación pide el grafo con
`cache: 'no-cache'`, de modo que la política se cumple aunque el servidor no
envíe cabeceras. Detalle y ejemplos en el README.

## Funcionalidades cerradas (Fase 11)

**Etiquetas.** Sigma sigue eligiendo las candidatas (rejilla de etiquetas,
umbral de tamaño, límites de pantalla) y las entrega una a una entre
`beforeRender` y `afterRender`. La capa de etiquetas (`createLabelLayer`) las
recoge y, al terminar el fotograma, las coloca juntas con `placeLabels`:

| Orden | Etiqueta | Regla |
|---|---|---|
| 1 | Nodo seleccionado | Placa dibujada por Sigma; reserva la placa y el nodo con su anillo; nunca se omite |
| 2 | Nodo bajo el cursor | Igual que la seleccionada |
| 3 | Forzadas (nodos de un camino) | A la derecha, o a la izquierda si no cabe; se dibujan siempre |
| 4 | Agregados de comunidad | A la derecha o a la izquierda; si no caben, se omiten |
| 5 | Resto | Por tamaño del nodo (grado) y después por id |

Es determinista: las mismas candidatas, en cualquier orden, dan la misma
imagen. Los anchos de texto se miden una vez por etiqueta, y mientras la
cámara está quieta (el grafo vivo redibuja cada fotograma) se reutiliza la
colocación anterior. Coste medido: 0,07 ms con 150 candidatas, 0,45 ms con
1.000, 0,002 ms si el fotograma no cambia.

**Aristas y agregados.** `anchoring.ts` define, como funciones puras, si una
relación se dibuja (`isEdgeDrawn`) y entre qué dos nodos (`drawnEdgeEnds`):
cada extremo dentro de una comunidad colapsada va al representante del
agregado; dentro de un mismo agregado no se dibuja. El reducer de nodos fija
`anchor` con la misma función y el programa WebGL la lee con
`anchoredDisplay`. Los tests comprueban sobre el grafo real que las parejas de
comunidades unidas en la vista de comunidades son exactamente las que
comparten relaciones reales, que expandir y volver a colapsar devuelve la misma
imagen y que selección y hover no cambian ningún extremo.

**Coherencia de estado.** Comprobado de punta a punta (`e2e/interactions.spec.ts`):

| Situación | Comportamiento |
|---|---|
| Un filtro o ámbito oculta el nodo seleccionado | Se deselecciona y su expansión termina (ya era así) |
| Un filtro deja sin nodos visibles la comunidad inspeccionada | Sigue inspeccionada y lo dice: «None of its nodes is drawn» |
| Reset de filtros y ámbito | Quita ámbito y filtros; lo inspeccionado se mantiene si sigue dibujado |
| Reset de cámara | Solo mueve la cámara; la selección se mantiene |
| Atrás del navegador tras entrar en un nodo desde una comunidad expandida | Vuelve a la comunidad, con la expansión |
| Zoom extremo | Se detiene en los límites; la cámara alcanzada se restaura igual al recargar |

**Móvil.** Por debajo de 720 px Explorer e Inspector son la misma hoja
inferior: al abrir uno se cierra el otro (`keepOneSheetOnPhones`). Antes el
Inspector se abría encima del Explorer y lo tapaba entero.

**Tests añadidos.** Unitarios: `labels.test.ts` (colocación, prioridad,
determinismo, memoria entre fotogramas, capa de etiquetas, geometría de la
placa), `anchoring.test.ts` (invariantes sobre el grafo real y entrada del
programa de aristas), límites de cámara y capa de etiquetas en
`renderer.test.ts`, hojas en móvil en `ui.test.tsx`. E2E:
`interactions.spec.ts` (combinaciones A–F), `edge-cases.spec.ts` (zoom extremo,
filtros que dejan cero nodos, Escape, etiquetas sin solapes medidas en el
canvas, uso solo con teclado) y una prueba funcional por tamaño de pantalla en
`responsive.spec.ts`.

## Infraestructura (Fase 12)

Cinco capas, separadas a propósito (estado actualizado en la Fase 14):

| Capa | Qué es | Dónde | Estado |
|---|---|---|---|
| 1. Código | Git y repositorio remoto | https://github.com/tollmarc5-dot/Eye_of_god (público), raíz `eye-of-god-ui/`, rama `main` | Activo |
| 2. Validación | Tipos, tests, build, `check:dist`, e2e | `npm run verify` y job `verify` de `.github/workflows/ci.yml` | Activo en cada push y pull request |
| 3. Aplicación | Sitio estático | GitHub Pages, https://tollmarc5-dot.github.io/Eye_of_god/, job `deploy` | Activo desde la Fase 14 |
| 4. Datos | El grafo publicado | `graph-snapshot/graph.json`, versionado | Idéntico al `graph.json` validado |
| 5. Automatización | Graphify, regeneración del grafo | Fuera de este repositorio | Manual; el despliegue ya es automático |

**Raíz del repositorio en `eye-of-god-ui/`, no en el espacio de trabajo.**
Graphify 0.9.73 lee `.gitignore` y `.git/info/exclude` además de
`.graphifyignore`, toma la raíz del repositorio Git como límite al buscar esas
reglas y consulta `git ls-files` cuando hay `.gitignore`. Un repositorio en la
raíz del espacio de trabajo con un `.gitignore` que excluya las carpetas de
contenido (`mhd-apliación`, `skills-main`…) haría que la próxima ejecución de
Graphify las dejara fuera del grafo. `eye-of-god-ui/` ya está en
`.graphifyignore`, así que su `.git` y su `.gitignore` no cambian lo que
Graphify analiza. Además, las carpetas de contenido (339 MB en
`mhd-apliación`, con un repositorio Git propio dentro) no acaban en el remoto
por accidente.

**Datos versionados.** `graphify-out/` no forma parte del repositorio. La
aplicación versiona solo lo que publica: `graph-snapshot/graph.json`, copia
exacta (`.gitattributes`: binario, sin conversión de fin de línea).
`scripts/graph-source.mjs` decide de dónde se lee el grafo, con la misma regla
para el servidor de desarrollo, el build, `check:dist` y los tests de contrato:
`EOG_GRAPH_JSON` → `../graphify-out/graph.json` si existe → la copia
versionada. `npm run graph:status` (primer paso de `verify` y de la CI) falla
si la copia y la salida de Graphify difieren; `npm run graph:sync` las iguala
leyendo solo `graphify-out/`.

**Automatización futura (capa 5), sin implementar.** El flujo previsto:

1. Graphify se ejecuta donde están las carpetas de contenido (hoy, este Mac).
   La CI no lo ejecuta: no tiene ni el contenido ni la configuración.
2. `npm run graph:sync` actualiza la copia versionada; commit y push en una
   rama.
3. La CI valida esa rama con el grafo nuevo (tests de contrato, e2e).
4. Al llegar a `main`, el job `deploy` publica en GitHub Pages (existe desde
   la Fase 14: los pasos 3 y 4 ya son automáticos).

Lo que falta automatizar son los pasos 1 y 2. Ejecutarlos a distancia exigiría
una máquina con el contenido y Graphify (un runner propio, o este Mac con una
tarea programada) y credenciales para hacer push: decisiones que no se han
tomado.

## Despliegue (Fase 14)

**Hosting: GitHub Pages**, publicado desde GitHub Actions (fuente «GitHub
Actions» en la configuración de Pages del repositorio). URL:
https://tollmarc5-dot.github.io/Eye_of_god/

```
push a main → job verify (npm ci → grafo → tipos → tests → build → check:dist → e2e)
            → mismo dist/ empaquetado (actions/upload-pages-artifact)
            → job deploy (actions/deploy-pages, entorno github-pages) → producción
```

- `deploy` depende de `verify`: si falla cualquier paso, no se publica nada.
- Los pull requests se validan pero nunca despliegan.
- Solo `deploy` tiene `pages: write` e `id-token: write`; el resto del
  workflow, `contents: read`. No hay secretos en el repositorio.
- Lo publicado es el `dist/` que pasó los e2e, no un build nuevo.
- `base: './'` se mantiene: el sitio vive en la subcarpeta `/Eye_of_god/` y
  todas las rutas son relativas.

**Por qué GitHub Pages.** Comparado con Cloudflare Pages y Netlify, es el único
que despliega desde la CI existente sin cuenta externa ni tokens, y es
gratuito para repositorios públicos. Su límite: cabeceras fijas
(`Cache-Control: max-age=600` + `ETag` para todo, medido en producción); ver
la política de caché en el README.

**Verificación de producción.** `EOG_E2E_BASE_URL` hace que Playwright pruebe
una URL desplegada en lugar del build local (sin servidor). Primera
publicación: los 43 e2e pasan contra la URL pública.

## Legibilidad del HUD (Fase 15A)

Solo presentación: ni el adaptador, ni el modelo, ni graphology, ni el
contrato de la URL, ni la CI cambian, y no hay dependencias nuevas.

**Zonas del HUD.** `useHudOcclusion` (`src/ui/occlusion.ts`) mide lo que tapa
cada pieza del HUD (marca, búsqueda, cabecera derecha, paneles abiertos,
pestañas, dock, lectura de zoom, banda de modo; la lista de resultados de la
búsqueda no cuenta) con `ResizeObserver`, `MutationObserver`, `resize` y
`transitionend`, como mucho una vez por fotograma, redondeado hacia fuera a
8 px, y solo avisa si algo cambió. Se entrega al renderer con
`GraphRenderer.setOccludedRects`; no pasa por el store ni por la URL. Además,
`setOcclusionSource` permite al renderer volver a medir en el momento de
encuadrar, para que un panel que cambia en la misma actualización (el
Inspector que se llena al seleccionar) ya cuente.

**Área libre.** `src/renderer/free-area.ts` convierte las zonas en márgenes
(`freeInsets`): un panel alto (≥ 40 % de la altura) empuja su lado, una pieza
ancha (≥ 60 % del ancho) o una barra fina junto al borde superior o inferior
empuja ese borde, y el resto (un Inspector vacío y corto en una esquina) no
mueve el encuadre, pero las etiquetas lo evitan y cuenta para la visibilidad
del seleccionado. Siempre queda al menos un 30 % del ancho y un 25 % del alto.

| Qué | Comportamiento |
|---|---|
| Etiquetas | Nunca dentro de una zona del HUD ni cortadas por el borde: se prueba el otro lado y, si tampoco cabe, se omite. Las placas (seleccionado, hover) no se omiten nunca |
| FOCUS, búsqueda, navegación | El nodo queda en el centro del área libre (cámara = 2P − Q con `viewportToFramedGraph`) |
| `frameNodes`, RESET | Encajan en el área libre, con márgenes de 32 px |
| HUD que cambia | Si tapa el nodo seleccionado o el final de su placa, la cámara lo devuelve al área libre (nodo y placa juntos), cuando termina la transición en curso |
| Cámara restaurada (enlace, recarga) | Se respeta tal cual hasta que el usuario actúa (puntero, rueda, zoom, otra selección o encuadre) |
| Vista de comunidades | Al activarla se encuadra; si la vista viene de un enlace con cámara, gana la cámara |

Consecuencia visible: como el HUD (barra superior, dock y paneles) ocupa parte
de la pantalla, RESET suele dejar una cámara distinta de la inicial y la URL
guarda `cam=`. El formato de la URL no cambia. La vista inicial de un enlace
sin `cam` sigue siendo la cámara por defecto de Sigma.

**Inspector.** La identidad del nodo (tipo, etiquetas y nombre,
`NodeIdentity`) es fija arriba del panel (`position: sticky`) y el scroll
vuelve a 0 al cambiar de selección. `.eog-node__name` y los nombres
accesibles no cambian.

**Contraste.** `--eog-surface` pasa a opacidad 0,90 y `--eog-text-faint` a
`#8195b2`: los tres niveles de texto superan 4,5:1 incluso con el panel sobre
blanco puro (peor caso, `tests/tokens-contrast.test.ts`, que lee
`tokens.css`).

**Movimiento reducido.** La cámara salta sin transición y en reposo no hay
ninguna llamada a `requestAnimationFrame` (comprobado en
`e2e/legibility.spec.ts`).

**Tests añadidos.** Unitarios: `free-area.test.ts`, `occlusion.test.tsx`,
`tokens-contrast.test.ts`, «labels and the HUD» en `labels.test.ts`,
«HUD occlusion» en `renderer.test.ts`, refit de la vista de comunidades en
`communities.test.tsx`, identidad fija y scroll en `inspector.test.tsx`. E2E:
`legibility.spec.ts` (etiquetas fuera del HUD medidas en el canvas a 1440,
nodo y placa seleccionados libres a 1440, 1024 y 390, identidad del Inspector,
refit de comunidades, búsqueda/FOCUS/zoom/RESET, movimiento reducido). Dos e2e
existentes se ajustaron a la nueva semántica: el clic de `search.spec.ts` va
al centro del área libre y `explorer.spec.ts` admite `cam=` tras limpiar el
ámbito.

**Coste medido** (build de producción, Chrome con interfaz, DPR 2, 5 ejecuciones
por medición, tres mediciones intercaladas con la versión anterior): primer
render listo con 3.271 nodos 3.726 ms de mediana frente a 3.638 ms (+2,4 %);
con 721 nodos 719 frente a 703 ms; CPU por fotograma 0,6–0,7 ms de mediana y
1,3–1,6 ms en p95; JS +2,0 kB comprimido; DOM sin cambios (683 nodos).

## Observatorio (Fase 15B)

Presentación y HUD. Ni el adaptador, ni el modelo, ni graphology, ni la
búsqueda, ni el contrato de la URL, ni la CI cambian; no hay dependencias
nuevas (solo el peso 600 de IBM Plex Sans, ya en `@fontsource`).

| Qué | Dónde |
|---|---|
| Capa de universo: estrellas, nebulosas, el ojo (párpados, limbo, iris, pupila) | `src/renderer/universe.ts` (canvas 2D detrás de Sigma) |
| Constelaciones (centroide, dispersión, tamaño por comunidad dibujada) | `computeConstellations` en `universe.ts`, función pura |
| Nombres de constelación | `draw-labels.ts` (`NamedPoint`), colocados por `label-layout.ts` con rango `constellation` |
| Anillos del iris (cuantiles de distancia de los nodos) | `irisRings` en `universe.ts`, función pura |
| Margen de encuadre proporcional a la vista | `stagePaddingFor` en `sigma-renderer.ts` |
| Halo corto de los agregados | `glow-node.ts` |
| Vuelo de cámara a un nodo fuera de pantalla | `travelTo` en `sigma-renderer.ts` |
| Leyenda, rail del Explorer | `src/features/hud/Legend.tsx`, `ExplorerRail.tsx` |
| Estilos del HUD nuevo, colores forzados | `src/styles/hud.css` |

**Quieto en reposo.** El bucle del grafo vivo (Fase 3) solo arranca con la
opción `living` del renderer, que la app no activa: sin entrada no se ejecuta
nada por fotograma. La capa de universo se dibuja desde `afterRender`, solo
cuando cambian la cámara, el tamaño o lo dibujado.

**Universo.** Las constelaciones se recalculan solo cuando cambia lo que se
dibuja o llegan posiciones (eventos de graphology); las estrellas se pintan una
vez en dos tiles de 512 px y se copian; las nebulosas son un sprite por color.
El ojo se centra en el grafo encuadrado (0,5; 0,5) con radio de iris 0,5.

**HUD.** Rail del Explorer plegado (cada botón abre su sección, desplegada y
enfocada), leyenda abajo a la izquierda, escala de zoom en la orientación,
estado junto a la identidad, placas de cristal tras todo texto del HUD, ⌘K /
Ctrl K, enlaces de salto. La marca y la leyenda (botón y tarjeta abierta)
forman parte de las zonas del HUD de 15A.

**Inspector.** Cabecera fija: tipo, nombre (Sans 600, 20 px) y ruta abreviada.
Grado, entradas, salidas y vecinos en una línea de cifras al empezar el
resumen. Vacío, una tarjeta compacta con la pista de la búsqueda.

**Tests añadidos.** Unitarios: `universe.test.ts`, `hud.test.tsx`, nombres de
constelación en `labels.test.ts`, vuelo de cámara, quietud por defecto y margen
proporcional en `renderer.test.ts`. E2E: `observatorio.spec.ts`. Ajustes de selector por el
rediseño: `.eog-figure` en `communities.spec.ts` y la marca en
`legibility.spec.ts`.

## Mediciones

Tomadas con el grafo real en Chromium sin interfaz (Playwright), servidor de
desarrollo, una sola ejecución. Los tiempos son de la Fase 2; tras la Fase 3 se
repitieron con valores equivalentes (layout 464 ms, primer render 41 ms, 60 FPS
con paneles translúcidos encima):

| Etapa | Tiempo |
|---|---|
| Carga y `JSON.parse` de graph.json | 26 ms |
| Adaptación y validación | 34 ms |
| Construcción de graphology e índices | 10 ms |
| Layout inicial (721 nodos, worker) | 469 ms |
| Layout inicial con caché | 5 ms |
| Layout incremental (2.550 nodos de terceros, worker) | 2.778 ms |
| Primer render de Sigma | 33–87 ms |

Tras la Fase 4, misma máquina y método, sin caché de posiciones: carga 24 ms,
adaptación 31 ms, graphology 9 ms, layout 474 ms, primer render 44 ms, 60 FPS
con 721 y con 3.271 nodos. Lo nuevo: índice de búsqueda 5 ms (una vez),
consulta 0,01–1,1 ms, pulsación de tecla hasta resultados pintados 3–14 ms en
modo desarrollo, cambio de ámbito 0,01 ms en el store más un refresco de Sigma.

Tras la Fase 5: primer render 42 ms; análisis del nodo más conectado (517
aristas) 0,05 ms; de seleccionar a siguiente frame 22 ms de media (34 ms máx.)
con 721 nodos y 52 ms para el nodo de 517 relaciones con los 3.271 dibujados,
en modo desarrollo; 60 FPS con el Inspector abierto.

Tras la Fase 6: primer render 44 ms; expansión a 3 saltos hasta el límite de
300 nodos 0,14 ms; camino por anchura sobre el grafo completo (1.299 nodos
visitados) 0,6 ms; de pulsar la expansión mayor al siguiente frame 38 ms;
60 FPS con un camino o una expansión de 300 nodos en pantalla.

Tras la Fase 7: resumen de las 169 comunidades 1,6 ms; colapsar o expandir una
comunidad 0,3–0,4 ms en el store y 20–22 ms hasta el siguiente frame; entrar en
la vista de comunidades 46 ms hasta el siguiente frame; 60 FPS en la vista de
comunidades con 721 y con 3.271 nodos. Modo desarrollo, Chromium sin interfaz.

Tras la Fase 8: codificar la vista en la URL tarda menos de 0,001 ms; la URL no
se toca por frame ni en reposo. El primer render medido en desarrollo es de
45 ms en la primera carga y de unos 150 ms al recargar varias veces la misma
pestaña; ocurre igual con la capa de URL desactivada, así que no es de esta
fase. Con el build de producción el grafo está en pantalla unos 250 ms después
de iniciar la navegación.

Tras la Fase 9 (build de producción, contexto de navegador nuevo y sin caché de
posiciones, mediana de 6 cargas): grafo en pantalla 848 ms antes y unos 790 ms
después de separar los archivos de terceros; la diferencia entra en el ruido de
la medida. JavaScript inicial: 572 kB en 1 archivo antes, 572 kB en 4 después.

Tras la Fase 11 (modo desarrollo, contexto nuevo sin caché de posiciones,
mediana de 3 cargas, antes → después): carga 31 → 28 ms, adaptación 33 → 33 ms,
graphology 10,5 → 10,9 ms, layout 607 → 609 ms, primer render 53 → 53 ms,
layout incremental de terceros 3.515 → 3.519 ms, filtro de aislados hasta el
siguiente fotograma 44 → 45 ms. CPU por fotograma (mediana / p95, callbacks de
`requestAnimationFrame`): zoom y arrastre con 721 nodos 0,6 / 2,2 → 0,9 / 5,9 ms,
con 3.271 nodos 1,1 / 10 → 1,1 / 9,7 ms; en reposo a zoom cercano 0,6 / 1,0 →
0,7 / 1,1 ms (721) y 1,2 / 2,0 → 1,0 / 1,5 ms (3.271). El p95 de zoom con 721
nodos varía entre ejecuciones en los dos casos (1,6–5,3 ms antes, 5,6–6 ms
después); la colocación de etiquetas cuesta menos de 0,1 ms por fotograma.
Pares de etiquetas solapadas en 16 encuadres fijos: 39 → 0 (289 → 270
etiquetas dibujadas).

FPS durante zoom animado: 60 con 721 nodos y 60 con los 3.271, que es el tope
de `requestAnimationFrame`. La cifra viene de un navegador sin interfaz y no
representa hardware concreto. El heap de JS informado por `performance.memory`
fue de 37–38 MB; es un valor aproximado y exclusivo de Chromium.

## Decisiones técnicas

- **Grafo dirigido y múltiple.** `graph.json` declara `directed: false`, pero
  conserva el origen y destino reales de cada relación. Se usa un grafo
  dirigido para no perder esa dirección, y múltiple para que dos relaciones
  entre el mismo par de nodos no rompan la construcción.
- **Atributos mínimos en graphology.** El grafo solo guarda lo que necesitan
  layout y Sigma; los datos completos se consultan en `GraphIndex`.
- **Renderer tras una interfaz.** La app usa `GraphRenderer`, no Sigma
  directamente.
- **Camino mínimo propio.** BFS sin pesos que ignora la dirección por defecto y
  acepta un conjunto de nodos permitidos, para respetar los filtros activos.
- **Dependencias empaquetadas.** Sin CDN: la app funciona sin conexión.
- **Acceso de depuración.** En desarrollo, `window.__EOG__` expone el renderer
  y el store para las pruebas en navegador; no existe en el build.

## Riesgos conocidos

- **Números de comunidad inestables.** Graphify puede renumerar las comunidades
  al regenerar. No se deben persistir filtros por número de comunidad sin
  comprobarlos contra el grafo cargado.
- **Detección de terceros heurística.** Se basa solo en la ruta. Código de
  terceros sin `.min.` ni carpeta reconocible no se detecta.
- **Caché de posiciones sin invalidación automática.** Si el grafo cambia
  mucho, los nodos nuevos se añaden alrededor de un layout antiguo. No hay
  todavía un control para recalcular desde cero; hoy se hace borrando la clave
  de `localStorage`.
- **Sigma solo probado con un doble en los tests unitarios.** WebGL no existe
  en Node; el comportamiento real se comprobó a mano con Playwright, sin una
  suite e2e guardada.
- **Hover al salir del canvas (corregido en Fase 4).** Sigma no limpia su nodo
  bajo el cursor al salir del canvas; el renderer lo hace escribiendo en el
  campo interno `hoveredNode`. Hay que revisarlo al actualizar Sigma.
- **Ámbito sin persistencia.** Filtros, ámbito y selección se pierden al
  recargar; no hay URL ni historial de navegación.
- **Búsqueda lineal.** Con 3.271 nodos cada consulta tarda menos de 1,5 ms.
  Para grafos de decenas de miles de nodos haría falta un índice invertido.
- **Etiquetas que se omiten.** Desde la Fase 11 las etiquetas no se solapan;
  la que no cabe a ningún lado de su nodo se omite en ese fotograma (salvo las
  de un camino). Con muchos vecinos de nombre largo, algunos nombres solo se
  leen acercándose o en el Inspector.
- **Móvil.** Una sola hoja inferior a la vez (Fase 11); abierta, cubre casi la
  mitad del grafo.
- **`backdrop-filter` sobre WebGL.** No bajó los FPS en la medición, pero el
  coste depende de la GPU; los paneles son pequeños a propósito.
- **Requiere servidor.** La app carga el JSON con `fetch`, así que no funciona
  abriendo `index.html` con `file://`.
- **El contenido del grafo no es de confianza.** Etiquetas y `rationale` vienen
  de un modelo de lenguaje leyendo documentos: deben mostrarse siempre como
  texto, nunca como HTML.

## Siguiente fase

Eye of God está publicado. La siguiente fase prevista es «Final product design
+ future extensibility». Sigue siendo manual la regeneración del grafo
(Graphify, `graph:sync`, commit y push); el despliegue a partir de ahí es
automático.
