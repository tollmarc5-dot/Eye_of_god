# Design system

## Dirección visual

Eye of God es un mundo que se explora, no un panel de administración. El grafo
ocupa toda la pantalla y es el núcleo; la interfaz es un HUD que flota encima.
El tono es instrumental: oscuro, preciso, con luz contenida.

Dos reglas separan el mundo de la interfaz:

- **El grafo es un solo sistema.** Todas las comunidades viven en una misma
  familia: cian → azul eléctrico → índigo → violeta → púrpura. El tono
  distingue comunidades; no hay rojos, amarillos, verdes, naranjas ni rosas.
- **El cian pertenece a la interacción.** Selección, foco, controles activos.

La información usa blanco frío y azules apagados. Nada más lleva color.

### Lenguaje del grafo

| Elemento | Reposo | Hover | Seleccionado |
|---|---|---|---|
| Núcleo | Color de comunidad, centro más claro; más brillo cuanto mayor el grado | Más grande (×1,22) y a pleno brillo | Más grande (×1,35) y a pleno brillo |
| Halo | Pequeño, del color del nodo, proporcional al grado | Más intenso, teñido de cian | Más intenso, teñido de cian |
| Anillo | — | — | Fino, cian, a distancia fija del núcleo, con un pulso lento |
| Vecinos | — | Algo más grandes y luminosos | Igual |
| Resto | — | Azul noche, sin halo, sin etiqueta | Igual |
| Relaciones | Muy oscuras; tinte de comunidad si son internas | Cian, más gruesas | Igual |

**El ojo.** El grafo completo se lee como un ojo, dibujado a partir de él en
la capa de universo (estático): párpados en almendra alrededor del anillo de
nodos, limbo con escala fina, anillos del iris donde están de verdad un cuarto,
la mitad y tres cuartos de los nodos, conexiones radiales hacia el centro de
cada comunidad grande, y la pupila blanco-cian en el centro del grafo
encuadrado. Se desvanece al acercarse (ratio 0,7 → 0,3); la pupila queda. El
margen de Sigma es proporcional a la vista (14,5 % del lado menor) para que el
ojo entero entre en el primer encuadre.

**Universo.** Detrás del grafo, en la capa de universo del renderer: dos capas
de estrellas con parallax (3 % y 8 % del movimiento del grafo), una nebulosa
tenue por comunidad grande (sus nodos reales, su extensión real). A escala Universe, los nombres de las comunidades mayores aparecen en
mayúsculas espaciadas (Plex Mono 11 px, blanco al 72 %) sobre su centro; la
comunidad seleccionada se nombra a cualquier escala. Sin órbitas ni marcas de
mira: nada decorativo en espacio de pantalla.

**Color de comunidad.** Se mantiene el arco azul→violeta por comunidad. Una
paleta por proyecto se validó con el script de dataviz y falla en todas sus
variantes (azul y violeta son indistinguibles con protanopía/deuteranopía, ΔE
1–2): la identidad de una comunidad va por nombre, posición y nebulosa, nunca
solo por color. La leyenda lo explica.

**Agregado de comunidad.** Una comunidad colapsada es un disco translúcido
con borde brillante y punto central, del color de la comunidad y de tamaño
según sus miembros. No debe confundirse con un nodo grande: los nodos son
macizos. Seleccionada lleva el anillo cian; al pasar el cursor, halo cian y
sus relaciones en cian.

El código de terceros es azul pizarra con menos de la mitad de halo: estructura
de fondo. Las relaciones internas de la comunidad activa suben un punto de luz.

## Tokens

Todos los valores viven en `src/styles/tokens.css` con el prefijo `--eog-`.
Ningún componente escribe un color, tamaño o duración directamente.

Las capas de canvas no pueden leer variables CSS. Sus colores están en
`src/styles/canvas-theme.ts`, que es el único lugar que duplica tokens: si se
cambia uno, hay que cambiar el otro.

| Grupo | Tokens | Uso |
|---|---|---|
| Mundo | `--eog-bg`, `--eog-bg-deep`, `--eog-bg-glow`, `--eog-grid`, `--eog-orbit` | Fondo, rejilla, órbitas |
| Superficies | `--eog-surface`, `--eog-surface-raised`, `--eog-surface-solid`, `--eog-surface-hover` | Paneles translúcidos (`--eog-surface` al 90 %: el texto se lee sobre cualquier cosa que haya debajo) |
| Interacción | `--eog-cyan`, `--eog-cyan-soft`, `--eog-cyan-line`, `--eog-blue` | Estados activos y foco |
| Texto | `--eog-text`, `--eog-text-muted`, `--eog-text-faint` | Tres niveles de jerarquía |
| Estado | `--eog-ok`, `--eog-warn`, `--eog-danger` | Siempre junto a un texto |
| Líneas | `--eog-border`, `--eog-border-strong`, `--eog-hairline` | Bordes de 1 px |
| Luz | `--eog-glow`, `--eog-shadow-panel` | Resplandor y profundidad |

## Tipografía

- **IBM Plex Sans**: texto y nombres.
- **IBM Plex Mono**: rótulos del HUD, cifras, rutas, identificadores.

Las dos fuentes van empaquetadas con la app (`@fontsource`), sin CDN.

| Papel | Estilo |
|---|---|
| Wordmark | Mono, mayúsculas, espaciado `--eog-tracking-display` |
| Rótulo (`.eog-label`) | Mono 11 px, mayúsculas, espaciado `--eog-tracking-label` (0,12 em) |
| Encabezado de sección (`.eog-heading`) | Sans 600 13 px, sin mayúsculas forzadas |
| Cuerpo | Sans 13 px |
| Valor técnico (`.eog-mono`) | Mono 12 px, cifras tabulares |
| Nombre de nodo o comunidad | Sans 600 20 px (`--eog-text-title`), tracking −0,01 em |
| Cifras (`.eog-figure`) | Mono 500 15 px tabulares, con su nombre debajo, sin cajas |
| Nombre de constelación | Mono 500 11 px, mayúsculas, 2 px de tracking, en el canvas |

## Espaciado y forma

- Escala de espacio: 4, 8, 12, 16, 24, 32 px (`--eog-space-1` a `-6`).
- Radios pequeños: 3 px en controles, 6 px en paneles.
- Controles de 40 px en escritorio y 44 px (`--eog-touch-size`) en tableta y móvil.
- Los paneles llevan corchetes de esquina en cian tenue, no sombras de tarjeta.
- Bordes de 1 px en tres intensidades: `--eog-border-soft` (10 %), `--eog-border`
  (16 %), `--eog-border-strong` (28 %).
- Toda agrupación de texto del HUD va sobre una placa de cristal (marca,
  métricas, orientación, leyenda): los nodos que pasan por debajo nunca compiten
  con las cifras. Lo que flota sobre otra superficie (la leyenda abierta) usa
  `--eog-surface-elevated` y `--eog-shadow-float`, teñida de azul marino.

### Disposición del HUD

| Zona | Pieza |
|---|---|
| Arriba a la izquierda | Identidad y estado del sistema |
| Arriba al centro | Búsqueda (`/`, ⌘K o Ctrl K) |
| Arriba a la derecha | Métricas y enlace |
| Izquierda | Explorer; plegado, un rail de 44 px (Explorer, proyectos, comunidades, nodos clave, filtros) |
| Derecha | Inspector |
| Abajo a la izquierda | Leyenda (plegada en un botón; oculta en móvil) |
| Abajo al centro | Dock de navegación y cámara |
| Abajo a la derecha | Orientación: escala y zoom, con las tres escalas marcadas |

## Componentes

En `src/ui/primitives.tsx`:

| Componente | Función |
|---|---|
| `Panel` | Superficie HUD flotante, con título y acciones; se oculta con `inert` |
| `Section` | Grupo plegable dentro de un panel |
| `HudButton` | Control pequeño con nombre accesible y tooltip |
| `Switch` | Interruptor con posición, color y texto ON/OFF |
| `EmptyState` | Estado vacío con título, pista y marca opcional |
| `Stat` | Rótulo más cifra para las lecturas del HUD |
| `StatusIndicator` | Estado del sistema: texto más punto |

Patrones añadidos en la Fase 4 (clases en `components.css`):

| Patrón | Uso |
|---|---|
| `eog-results` / `eog-result` | Lista de resultados de búsqueda; la opción activa lleva barra cian y fondo, igual que una fila activa |
| `eog-scope` / `eog-chip` | Bloque «Active scope» fijo arriba del explorer, con una ficha por parte del ámbito |
| `eog-link` | Acción de texto en cian y mayúsculas (Clear scope, Show all, Reset) |
| `eog-row[data-holds-selection]` | Anillo hueco: aquí vive el nodo seleccionado. Distinto de la barra de fila activa |
| `eog-metrics` / `eog-metric` | Rejilla 2×2 de métricas del nodo en el Inspector |
| `eog-relgroup` / `eog-relbar` | Tipos de relación por dirección, con una barra proporcional azul→cian |
| `eog-connection` | Fila de nodo conectado: icono de dirección, nombre, tipo, relación y comunidad |
| `eog-segmented` | Selector de tres opciones: orden de la lista, profundidad de expansión |
| `eog-path` | Bloque del camino en el Inspector: ruta numerada con la relación de cada salto |
| `eog-mode` | Banda de modo bajo la cabecera (camino, expansión, vista de comunidades); ámbar si no hay camino |
| `eog-row-pair` / `eog-row-action` | Fila con dos controles: el nombre selecciona, el embudo filtra |

Composición en `src/features`: `SearchBox`, `TopBar`, `ExplorerPanel`, `InspectorPanel`,
`GraphControls`, `GraphStats`, `ViewReadout`, `LoadingScreen`, `ErrorScreen`,
`WorldBackdrop` y `GraphWorld`. El símbolo del wordmark es `EyeSymbol` en
`src/ui/icons.tsx`; se sustituye ahí por el logo definitivo.

## Estados

| Estado | Tratamiento |
|---|---|
| Hover | Fondo `--eog-surface-hover`, texto más claro |
| Pulsado | Escala 0,96 y borde cian |
| Activo / seleccionado | Marca cian a la izquierda, fondo `--eog-cyan-soft`, `aria-pressed` |
| Foco de teclado | Contorno cian de 2 px |
| Deshabilitado | Opacidad 0,45 y cursor `not-allowed` |
| Cargando | Pantalla "System initializing" con la etapa en curso |
| Vacío | `EmptyState` con el mismo lenguaje de rótulos |
| Error | "Graph core error" con mensaje legible, sin trazas |

Las comunidades se leen como constelaciones: color en los nodos y un tinte
oscuro del mismo tono en sus relaciones internas. No hay polígonos ni regiones.

En el grafo, ver «Lenguaje del grafo» arriba.

## Niveles de zoom

| Nivel | Ratio de cámara | Etiquetas | Movimiento y luz |
|---|---|---|---|
| Universe | ≥ 0,7 | Solo los nodos más grandes | Deriva mínima, halo contenido, sin flujo |
| Structure | 0,25 – 0,7 | Nodos relevantes | Deriva ligera, flujo tenue en algunas relaciones |
| Detail | < 0,25 | Casi todas | Deriva y flujo más visibles, halo completo |

Definidos en `src/renderer/zoom-level.ts`.

## Motion

- Duraciones: 120, 180 y 280 ms, con una sola curva (`--eog-ease`); cerrar
  dura el 70 % de abrir (`--eog-dur-exit`). Los paneles aparecen con opacidad y
  8 px de desplazamiento.
- Solo se animan `transform`, `opacity`, colores y sombras; nunca `transition: all`.
- En la interfaz nada se anima de forma permanente, salvo la barra de la
  pantalla de carga.
- **Quieto en reposo.** Sin entrada del usuario no se dibuja nada: ni deriva,
  ni pulsos, ni partículas, ni cámara automática. Solo se mueven el hover, la
  selección, los paneles y las transiciones de cámara. La deriva del grafo vivo
  (Fase 3) queda disponible tras la opción `living` del renderer, apagada.
- Un nodo fuera de pantalla se alcanza con un vuelo: la cámara sube un poco,
  cruza y baja sobre él. Cualquier entrada interrumpe el vuelo.
- Con `prefers-reduced-motion`, las duraciones pasan a 0 y la cámara salta sin
  transición. Halos, anillo, ojo, nebulosas y cambios de estado siguen visibles.

## Accesibilidad

- Todo control tiene nombre accesible; los tooltips repiten ese nombre.
- Ningún estado depende solo del color: hay texto, posición o marca.
- Los paneles cerrados quedan fuera del orden de tabulación.
- La selección se anuncia en una región `role="status"`.
- Los tres niveles de texto (`--eog-text`, `--eog-text-muted`,
  `--eog-text-faint`) superan 4,5:1 sobre el fondo y sobre un panel puesto
  encima de blanco puro, el peor caso; `tests/tokens-contrast.test.ts` lo
  comprueba leyendo `tokens.css`.
- Ninguna etiqueta del grafo se dibuja bajo el HUD, y el nodo seleccionado y su
  placa quedan siempre en el área libre.
- Enlaces de salto («Skip to search», «Skip to the inspector»), lo primero del
  orden de tabulación.
- Colores forzados (`forced-colors: active`): paneles, dock, rail y leyenda con
  bordes del sistema; estados activos con `Highlight`.
- En el Inspector, el tipo y el nombre del nodo quedan fijos arriba al hacer
  scroll.

## Reglas para mantener la estética

1. El grafo manda. Nada se coloca sobre el centro del mundo.
2. Un panel nuevo flota y es translúcido; no se añaden barras opacas.
3. El cian solo marca interacción. Si todo es cian, nada lo es.
4. Resplandor solo en lo activo o seleccionado.
5. Rótulos en mono y mayúsculas; contenido en sans.
6. Antes de añadir un color, añadir un token.
7. Fondo estático: sin partículas ni animaciones continuas.
