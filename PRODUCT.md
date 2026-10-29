# Product

<!-- impeccable:product-schema 1 -->

> Escrito con `impeccable init` el 28/10/2026 a partir de `docs/`, `design/cuaderno/` y `PLAN.md`.
> Lo marcado como **[inferido]** debe confirmarlo el equipo.

## Platform

web

Blindaje tiene cuatro superficies: la landing pública (`apps/landing`, Astro estática), la consola del
equipo de análisis (`apps/console`, React + Vite), el portal público por zona (`apps/portal`, React +
Vite) y la app de la víctima (`apps/mobile`, Expo / React Native, Android primero). Este archivo de la raíz declara `web` porque lo heredan las dos
superficies web. **La app móvil es nativa**: al usar Impeccable en `apps/mobile`, carga
`reference/android.md` (o crea un `apps/mobile/PRODUCT.md` con `android`).

## Users

- **Víctima** (bodegueros, mototaxistas, transportistas, comerciantes de mercado en el Perú). Recibe
  amenazas por audio de WhatsApp, mensajes, fotos y videos. Está sola y con miedo; su celular puede
  ser revisado por el extorsionador. Su trabajo: guardar la evidencia sin que se note y armar una
  denuncia sólida.
  Reporta directo, sin código ni pertenecer a nada (rediseño del 28/10, `docs/rediseno.md`).
- **Equipo de análisis de Blindaje** (revisores y analistas centrales). Confirma o descarta vínculos,
  aprueba alertas y consejos por distrito, ve redes y zonas, corre el análisis de red y genera
  expedientes para la autoridad.
- **Administrador.** Gestiona el equipo, los canales de difusión, la auditoría y los costos.
- **Policía y fiscalía.** Reciben el expediente de una red por un canal formal.
- **Comunidad y negocios.** Ven, sin cuenta, el mapa por distrito y el riesgo, las alertas y los
  consejos aprobados para su zona y rubro.
- **Audiencias de la landing:** instituciones que podrían usarlo (policía, fiscalía, municipios, ONG),
  quien difunde la app (gremios, iglesias, juntas) y los jueces del Meta Global AI Developer Hackathon
  (leen en inglés).

## Product Purpose

Tres pasos: **recolectar** la evidencia que guardan las víctimas, **hacer inteligencia** con ella y
**saber dónde pasa**. Convierte audios, fotos, videos y mensajes en señales comparables (huella de voz,
ficha del modus operandi, identificadores cifrados con HMAC, recortes de imagen), vincula casos con
revisión humana obligatoria y devuelve valor en tres formas: expedientes de red para policía y
fiscalía, un mapa por distrito para la comunidad (nunca una vivienda) y alertas y consejos por zona y
rubro. La víctima recibe, desde el primer día, una denuncia mejor armada.

Éxito: que una víctima documente en minutos sin exponerse, que una institución pida acceso, y que el
caso B se vincule con el A por la voz, la cuenta o las fotos aunque el número sea distinto ("otro
número, la misma voz").

## Positioning

Inteligencia contra la extorsión hecha con lo que las víctimas ya tienen en el celular: muchas
víctimas juntas saben más que cualquiera por separado, siempre que puedan compartir sin exponerse.
Blindaje es la pieza que permite ese compartir: consentimiento por niveles, señales seudonimizadas en
vez de datos crudos, un equipo central que revisa cada vínculo antes de que exista y lo público solo
por distrito, en rangos y con mínimos. La app de la víctima se
disfraza de una app común de su negocio (la persona elige cuál).

## Operating Context

- La app se usa en un celular que puede revisar un tercero: disfraz configurable, entrada secreta,
  PIN y PIN señuelo, salir rápido, bloqueo automático, cero notificaciones push.
- La evidencia se sube cifrada a la nube al capturarla y solo la ven los roles autorizados (PLAN D1).
- Cualquier víctima puede instalar la app y reportar. Gremios, iglesias, juntas o municipios solo la
  difunden (canales de difusión); ya no revisan ni aprueban. Sin el filtro del gremio, los frenos a los
  reportes falsos son el límite por IP, la revisión humana y la marca de dispositivos sospechosos.
- Canales oficiales: Línea 1818 (Central Única de Denuncias del Mininter) y 105 (Policía,
  emergencias).
- Español de Perú, tuteo. Los jueces del hackathon leen en inglés.

## Capabilities and Constraints

- Modelos y librerías de Meta: Muse Spark 1.3 (fichas y cuatro agentes con tool calling), Muse Spark
  1.2 (audio directo), Muse Voice Transcribe (transcripción con hablantes), SAM 3.1 (segmentación en
  imagen y video), FAISS y DINOv2 (índices y vectores de imagen). Opcionales: Muse Wonder (redes
  grandes) y Muse Image (tarjetas de alerta). Muse Glimmer fue evaluado y **no** corre en el celular
  (modelo denso de 30B; PLAN D6).
- Cuatro agentes con puertas de revisión humana: Vinculador, Cartógrafo, Vigía, Redactor de
  expedientes.
- Lo que Blindaje **no** hace (límite de diseño, no nota al pie): no identifica personas por nombre,
  no hace OSINT, no muestra a una víctima datos de otras, no decide culpabilidad, no reemplaza a la
  policía, no aconseja pagar ni negociar, no publica direcciones, viviendas, cifras exactas ni datos
  abiertos, no tiene contenido político. El mapa público es por distrito, en rangos (5-9, 10-19,
  20-49, 50+), sin totales y solo donde hay al menos 5 casos de 3 víctimas.
- El servidor procesa la evidencia: **no** es cifrado de extremo a extremo; no decirlo nunca.
- Reglas del hackathon: repositorio público, todo construido entre el 26/10 y el 4/11/2026, nada de
  contenido político ni consejo médico, solo datos ficticios.

## Brand Commitments

- Nombre: **Blindaje**.
- Sistema visual **Cuaderno** (`design/cuaderno/`, PROMPT 6.5), fijado por el equipo: papel
  cuadriculado, tinta azul, línea de margen roja, resaltador. Ver DESIGN.md.
- Voz: español de Perú, tuteo, frases cortas, verbos claros. Sin emojis en ninguna interfaz.
- En las superficies del disfraz no aparecen "extorsión", "denuncia" ni "policía".
- Nunca mostrar el nombre o el ícono de un disfraz como si fuera el único: la app "se ve como una app
  común de tu negocio y tú eliges cuál".
- Lema: "Otro número. La misma voz." Recolectar, hacer inteligencia, saber dónde pasa.

## Evidence on Hand

- Cifras con fuente: sección 2 y referencias de la sección 20 del documento de diseño (Exitosa con
  datos del Ministerio Público, La República, América TV, El Comercio). Ninguna cifra sin fuente.
- Ejemplo guía de los casos A, B y C (sección 3 del documento de diseño). Ficticio.
- Resultados de la evaluación: `eval/report.json` y `eval/results/watermark.json`. No inventar métricas.
- Capturas de la consola y del portal en modo simulado: `docs/screenshots/`. Las del celular todavía no
  existen; no inventar maquetas.
- Sin testimonios, clientes, pilotos ni prensa. No inventarlos.

## Product Principles

1. **La víctima primero, y a salvo.** Nada se diseña si puede exponerla: ni en su celular, ni ante
   otras víctimas, ni ante un infiltrado.
2. **Una persona decide.** Todo vínculo, hipótesis, alerta y expediente es un borrador hasta que una
   persona autorizada lo aprueba.
3. **Probar, no prometer.** Cifras con fuente, evidencia citada, métricas reales de la evaluación sean
   cuales sean, y honestidad sobre lo que el sistema no protege.
4. **Lo público, solo por zona.** Distrito, nunca vivienda; rangos, nunca cifras exactas; nada bajo el
   umbral de 5 casos de 3 víctimas, y siempre la nota de sesgo.
5. **Lo comunitario se gana con consentimiento.** "Solo mi denuncia" es el valor por defecto; el modo
   comunitario se activa a propósito y se puede retirar.
6. **Siempre hacia los canales oficiales.** Blindaje ordena y conecta; la policía y la fiscalía
   actúan.

## Accessibility & Inclusion

- Contraste mínimo 4.5:1, toques de al menos 44 px, soporte para tamaño de letra del sistema, foco
  visible y movimiento reducido respetado.
- Etiquetas de lector de pantalla en español.
- Atkinson Hyperlegible como letra de trabajo por legibilidad para baja visión. **[inferido]** Parte
  de los usuarios tiene poca práctica con apps: lenguaje llano, una acción principal por pantalla.
- Landing: Lighthouse móvil de 95 o más en rendimiento y accesibilidad.
