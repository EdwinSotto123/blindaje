# PLAN: Blindaje

Entrega: miércoles 4 de noviembre de 2026, 21:00 (hora de Lima = hora del Este de EE. UU. ese día).
Meta interna: demo de punta a punta grabable el **lunes 2 de noviembre**, para que el martes 3 y el
miércoles 4 queden para pulido, video y envío.

Fuente de verdad funcional: `docs/blindaje-inteligencia-comunitaria.md`. Contratos: `packages/shared`,
`docs/API.md`, `docs/ML_API.md`, `infra/migrations/`.

## Decisiones

| # | Decisión | Por qué |
|---|---|---|
| D1 | **Todo vive en la nube** (pedido del equipo el 28/10): la evidencia se sube a Cloudflare al capturarla, cifrada en R2, y se procesa al llegar. Sin conexión, cola cifrada en el celular que se vacía al confirmar la subida. | Accesible para todos los actores autorizados, procesamiento inmediato ("Lo que encontramos" en vivo) y menos evidencia en un celular que el extorsionador puede revisar. Acceso por roles, nada público. |
| D2 | Monorepo pnpm; `apps/mobile` fuera del workspace de pnpm (proyecto npm propio). | Expo y Metro con symlinks de pnpm dan problemas en Windows; la app copia los tipos de `packages/shared` con un script. |
| D3 | Contenedor ML en Cloudflare Containers (la cuenta ya tiene Workers Paid). | Huella de voz, DINOv2, FAISS, grafo y PDF no caben en un Worker. |
| D4 | D1 guarda los vectores; FAISS es el motor de búsqueda y se reconstruye desde D1 o desde el snapshot en R2. | Los contenedores no tienen disco persistente. Para el volumen del demo, reconstruir es instantáneo. |
| D5 | `multilingual-e5-small` en vez de BGE-M3 para texto; `dinov2-small` para imagen. | CPU, arranque en frío del contenedor y tamaño de imagen. Documentado en DEVLOG. |
| D6 | **Muse Glimmer no corre en el celular**: es un modelo denso de 30B (≈17 GB a 4 bits). | Evaluado con la documentación oficial; queda detrás de un flag y documentado. La ficha se arma en el servidor con consentimiento explícito. |
| D7 | Agentes con la Responses API (`previous_response_id`, `store: true`), tool calling con `tool_choice: "auto"` (único valor admitido) y salida final en `text.format` strict. | Verificado en la documentación y con una llamada real. |
| D8 | Desarrollo local de Android con `expo run:android` (JDK 21 de Android Studio + emulador `Medium_Phone_2`). EAS opcional. | No hay sesión de Expo; no bloquea. |
| D9 | Landing en Astro, estática, servida por Workers Static Assets. Consola en React + Vite, también en Workers Static Assets. | Lighthouse ≥ 95 y un solo proveedor. |
| D10 | Evaluación de voz con OpenSLR SLR73 (español de Perú, CC BY-SA 4.0), descarga automática. | Voces reales de Perú con licencia que permite este uso. Las grabaciones de voluntarios se suman en `eval/audio/raw/`. |

## Milestones

| M | Contenido | Estado |
|---|---|---|
| M0 | Docs leídos, herramientas verificadas, contratos compartidos, migración D1, PLAN, DEVLOG, CI | en curso |
| M1 | Worker: auth, casos, evidencia cifrada en R2, auditoría encadenada, costos, rate limiting | |
| M2 | Ingesta y Workflow: Voice Transcribe, ficha con Muse Spark, SAM 3.1, contenedor ML, FAISS | |
| M3 | Motor de vinculación, Vinculador, cola de revisión en la consola | |
| M4 | Grafo, Cartógrafo, Vigía (cron), Redactor y PDF | |
| M5 | App Expo: disfraces, entrada secreta, PIN y PIN señuelo, notas privadas, captura, compartir desde WhatsApp, denuncia, sincronización | |
| M6 | Evaluación (`eval/`), calibración en KV, `demo:seed` y `demo:reset` | |
| M7 | Landing con Impeccable, bilingüe, desplegada | |
| M8 | Tests de seguridad, pulido, README, SECURITY, PRIVACY, VIDEO, informe final | |

## Frentes en paralelo (subagentes)

1. **API**: `services/api` + `packages/meta-client`.
2. **ML**: `services/ml`.
3. **Móvil**: `apps/mobile`.
4. **Consola**: `apps/console`.
5. **Landing**: `apps/landing` con Impeccable.
6. **Evaluación**: `eval/` (datos ficticios, voces SLR73, runner, reporte).

Cada frente trabaja solo en su carpeta y hace commits acotados a ella.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| La huella de voz no separa bien voces por WhatsApp | Medir pronto con SLR73 comprimido a Opus; calibrar; la voz nunca vincula sola |
| Arranque en frío del contenedor (modelos pesados) | Modelos horneados en la imagen, carga perezosa, `sleepAfter` largo durante el demo |
| SAM 3.1 sin respuesta útil para algún prompt | Cero coincidencias es válido; el pipeline sigue sin recortes |
| Build nativo de Android en Windows | Probar temprano; si falla, Expo Go para la mayoría de pantallas y build en EAS |
| Presupuesto de 150 USD | Registro de costos, bloqueo de no esenciales al 80 %, caché por hash, muestreo de video |
| Audios del demo | Pedir al equipo 4 grabaciones ficticias (guiones en `docs/VIDEO.md`); respaldo con voces SLR73 |
