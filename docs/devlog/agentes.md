# Devlog: agentes de red (`services/api`, M4)

Grafo de redes, Cartógrafo, Vigía y Redactor de expedientes. Horas en hora de Lima (UTC−5). Las
entradas más nuevas van abajo.

## 2026-10-28 02:30 · Grafo de redes

- `src/networks/graph.ts`: nodos de los cinco tipos (caso, huella de voz `V-n`, identificador
  `ID-xxxxxx`, frase firma normalizada sin tildes ni puntuación, imagen `IMG-n`), aristas caso–señal
  y una arista caso–caso por cada vínculo **confirmado**. `GET /v1/console/networks/:id` ahora sale
  de aquí: nodos con `degree`, `centrality`, `community` y `analysis` (`ml` o `worker`), aristas,
  línea de tiempo y vínculos.
- Comunidades y centralidad: `POST /graph/analyze` del contenedor ML con tiempo máximo (8 s en la
  vista, 30 s en los agentes) y caché en KV por hash del grafo (`graph:v1:…`, 1 día). Si el ML no
  responde: componentes conexos sobre la proyección en casos, grado e intermediación de Brandes
  normalizada como networkx (verificada contra un camino a–b–c).
- Línea de tiempo: primer contacto, **vencimiento del plazo calculado** (primer contacto +
  `plazo_horas`), intimidaciones de la ficha, evidencia con fecha de captura y confirmación de cada
  vínculo. Con eso el Cartógrafo mide "días entre el plazo vencido y la intimidación".
- Umbral territorial (12.2): vacío si la red tiene menos de 5 casos o menos de 3 víctimas distintas
  (dispositivos distintos). Además cada zona listada cumple el mismo umbral; el resto se suma en
  "Otras zonas (agregado)". Nivel `distrito` = la parte antes de " - " de `zona_cuadricula`.

## 2026-10-28 02:50 · Cartógrafo

- `runAgent` con `CARTOGRAFO_SYSTEM`, `finalSchema: PerfilRed`, `reasoningEffort: "low"`, 12 turnos
  y herramientas en paralelo. Muse Wonder es opción no esencial: la ruta lo bloquea al 80 % del
  presupuesto (402 `budget_exceeded`, una fila `blocked`, sin llamar a Meta).
- Las 7 herramientas de la tabla 10.3 viven en `src/agents/tools/network.ts` (`NetworkToolbox`):
  solo responden por la red analizada (otra red o un caso ajeno devuelven error al modelo), nunca
  devuelven seudónimos, dispositivos, organizaciones ni zonas por caso, y una guarda final bloquea
  cualquier salida que contenga un `device_id` u `org_id` de la red.
- `known` dinámico: etiquetas que aparecieron en salidas de herramientas **e** existen en la red
  (una etiqueta inventada dentro de una ficha no se vuelve citable).
- `registrar_hipotesis` rechaza evidencia que el agente no vio (el error vuelve al modelo) y reserva
  `HIP-n`. El perfil final une las hipótesis registradas con las de la salida.
- Defensa en profundidad al terminar: red, casos y sectores salen de la base; territorio = cálculo
  del servidor si cumple el umbral, vacío si no (aunque el modelo lo haya llenado); números de 7 o
  más dígitos se reemplazan (las fechas ISO se respetan).
- Estados: perfil `borrador` o `invalido`; hipótesis en `borrador`. Nueva ruta
  `POST /v1/console/profiles/:id/decision` (analyst). Aprobar una hipótesis o un perfil `invalido`
  responde 409. Auditoría: `agent.cartografo.result` (o `.error`), `profile.decision`.

## 2026-10-28 03:05 · Vigía

- Casos con consentimiento comunitario y ficha, de los últimos 30 días (`lookback_days` en la ruta
  manual). Rasgos: grupo que dice ser, canal de pago (sin "otro"), frase firma, identificador
  compartido. Se agrupa por **zona exacta** (`cases.zona_cuadricula`) y rasgo, y se busca la ventana
  de 14 días con más casos que cumpla ≥ 5 casos y ≥ 3 víctimas. Rasgos de la misma zona que
  comparten la mitad o más de sus casos forman una sola alerta; el rasgo principal (grupo >
  identificador > frase > canal) define el `pattern_key`.
- Una alerta por organización con casos en el patrón (cada gremio aprueba la suya). Deduplicación:
  no se repite si ya hubo una del mismo `pattern_key` para esa organización en los 14 días previos
  al caso más reciente.
- Redacción con `responses.parse` (`store: false`, sin herramientas) y `VIGIA_SYSTEM`; el modelo no
  recibe dígitos de identificadores. Citas validadas con un reintento; si fallan, la alerta no se
  crea y el próximo ciclo lo vuelve a intentar. Limpieza determinística: números completos →
  "[número omitido]", sin citas ni fechas ISO en el texto público, zona a nivel distrito, y se
  agregan la Línea 1818 y el 105 si faltan.
- Tarjeta con Muse Image (no esencial): una por patrón, guardada para cada alerta en
  `alerts/<id>.png`; si el presupuesto la bloquea, la alerta sale sin imagen.
- Errores: manual → error claro; cron → se registra y sigue con el siguiente patrón.

## 2026-10-28 03:15 · Redactor de expedientes

- Herramientas: red, perfil aprobado (sin sus hipótesis), hipótesis aprobadas, línea de tiempo y
  vínculos confirmados. El servidor fija la red, una fila por vínculo confirmado (si el modelo omite
  uno, se explica con el Vinculador o las señales) y **solo las hipótesis aprobadas**.
- PDF (`/pdf/render` `expediente`): perfil, cronología ordenada, vínculos con puntaje y casos, hechos,
  hipótesis, brechas, evidencia con SHA-256 y cadena de custodia (filas de `audit_log` de casos,
  evidencias, vínculos, red, perfil e hipótesis, con `prev_hash` y `hash`; consultas en bloques de
  90 por el límite de parámetros de D1). `aprobado: false` ("Borrador para revisión") y marca de
  datos ficticios. Cifrado en R2 `expedientes/<id>.pdf` (AAD = id) con su SHA-256.
- Errores: citas inválidas tras el reintento → 502 con el detalle y expediente en `error`; sin ML →
  503 claro y el contenido queda guardado.

## 2026-10-28 03:25 · Pedidos de la consola y de evaluación

- `AlertView.org_name` (opcional en `packages/shared`), `GET /v1/console/networks/:id/expedientes`
  (analyst, admin) y `data.evidencia` en los nodos `voz` e `imagen`.
- Test con la forma del seed del demo: A, C, D, E, F y G en "Lima Este", B en "Lima Norte" y un caso
  en "Lima Este - E12": una sola alerta (Los X + Yape) con 6 casos de 6 víctimas, sin B.

## 2026-10-28 03:40 · Prueba real

`wrangler dev` local con estado propio (`--persist-to` en un directorio temporal), ML local en
`:8080` y una red ficticia sembrada por SQL: 6 casos, 4 víctimas, 6 vínculos confirmados, 3
identificadores, 5 huellas y 3 recortes.

- `/graph/analyze` real: `analysis: ml`, una comunidad; la frase "habla con el jefe" y la cuenta
  `ID-649484` son las señales con más casos.
- Cartógrafo con Muse Spark 1.3: la primera corrida falló en el turno 4 con un 400 repetido tres
  veces (el cliente reintenta 2 veces con 1 y 2 s), el patrón del retraso de `previous_response_id`.
  La segunda corrida terminó en 5 turnos y 17 llamadas a herramientas: perfil `borrador`, citas ok,
  10 hechos y 4 hipótesis (cuenta recaudadora con confianza alta; seguimiento físico por la placa,
  quien llama y guion común con confianza media), escalamiento de 3.5 a 8.5 días tras el plazo
  vencido, territorio "Lima Este: 6" (nivel distrito, 4 víctimas). Desde entonces el Cartógrafo y el
  Redactor se reinician una vez desde cero ante ese error (`restartOnChainLag`).
- Redactor real tras aprobar 2 hipótesis y el perfil: PDF de 5 páginas y 30 KB; el SHA-256 de la
  descarga coincide con el guardado.
- Gasto: 0.087 USD del Cartógrafo (las dos corridas) + 0.022 USD del Redactor = **0.109 USD**.

## Cómo correr

```bash
pnpm --filter @blindaje/api test -- agents networks-graph   # Meta y ML simulados
```
