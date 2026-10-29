# Rediseño del 28 de octubre: recolectar, hacer inteligencia, saber dónde pasa

## Por qué

El dueño, después de ver la landing: "tu propuesta es demasiado idealista, los gremios solo se
encargarían de ayudar a recopilar datos, es más, ni siquiera gremios creo que es lo ideal. Lo ideal
sería simplemente recolectar, hacer inteligencia, saber dónde sucede, o sea zona, ni siquiera vivienda".

Decisiones que tomó en una pregunta estructurada:

| Pregunta | Respuesta |
| --- | --- |
| ¿Quién entrega los datos? | La víctima directo, sin código de gremio. Gremios, iglesias o municipios solo difunden la app |
| ¿Quién usa la inteligencia? | Analistas y policía; un mapa por zona para la comunidad; alertas y consejos a negocios por zona, sin estar afiliados |
| ¿Hasta dónde se cambia? | Rediseño completo: roles, API, app, consola, portal y landing |

## La idea nueva, en tres pasos

1. **Recolectar.** Cualquier víctima instala la app disfrazada y guarda audios, fotos, videos y
   mensajes. No necesita código ni pertenecer a nada. Elige su distrito de una lista fija.
2. **Hacer inteligencia.** El pipeline no cambia: modelos de Meta, señales (voz, identificadores con
   HMAC, imágenes, modus operandi), vinculación calibrada, agentes. Lo revisa un **equipo central** de
   Blindaje, no un gremio.
3. **Saber dónde pasa.** Todo se agrega por **distrito** (los 50 de Lima Metropolitana y el Callao,
   `packages/shared/src/zones.ts`), nunca por dirección ni vivienda. Los analistas ven la vista de
   zonas en la consola; la comunidad y los negocios ven un mapa público por distrito y las alertas y
   consejos aprobados para su zona y rubro.

## Roles

| Rol | Quién es | Qué hace |
| --- | --- | --- |
| Víctima | Cualquier persona, anónima (seudónimo V-XXXX) | Guarda evidencia, arma su denuncia, recibe avisos de su zona |
| Revisor (`reviewer`) | Equipo central | Confirma o descarta vínculos; aprueba alertas y consejos de cualquier zona |
| Analista (`analyst`) | Equipo central | Lo del revisor, más: Cartógrafo, Vigía, Asesor, expedientes, vista de zonas |
| Administración (`admin`) | Equipo central | Usuarios, canales de difusión, auditoría, costos, rastreo de filtraciones |
| Policía y fiscalía | Fuera del sistema | Reciben el expediente por un canal formal. No hay cuenta de autoridad (fuera de alcance) |
| Comunidad y negocios | Público | Portal sin cuenta: mapa por distrito, riesgo por zona y rubro, alertas y consejos aprobados |

Los roles en la base no cambian (`reviewer | analyst | admin`): cambia a quién se le dan y su alcance.
Ningún texto vuelve a decir "revisora del gremio", "tu gremio aprueba" ni "pídela a tu dirigente".

## Organizaciones

- Hay una organización central, `CENTRAL_ORG_ID = "org-central"` (`kind = 'alianza'`), creada por la
  migración `0004`. Las víctimas sin código, los usuarios del equipo, las alertas y los consejos van ahí.
- Las demás organizaciones quedan como **canales de difusión**: su código de invitación sigue
  funcionando (los APK instalados lo envían), pero ya no filtra lo que ve un revisor ni quién aprueba.
- Se quitan los filtros por organización de los revisores (vínculos, casos, alertas, consejos).

## Zonas

- La zona de un caso es un id de distrito (`DistrictId`). La API normaliza con `districtOfZone`
  (acepta id, nombre con o sin tildes y "Distrito - Celda"). Texto que no es distrito se guarda como
  llegó, pero no cuenta en el mapa.
- La consola puede seguir usando celdas internas ("Distrito - Celda"); fuera de la consola, solo distrito.

## Privacidad de lo público (no negociable)

- Umbral de siempre: nada por distrito, rubro, semana o modalidad con menos de 5 casos de 3 víctimas.
- **Rangos, no cifras exactas** (`countBand`: 5-9, 10-19, 20-49, 50+), y **sin totales** de ciudad ni
  de zona junto a cifras por partes. Esto cierra la fuga por resta que existía en
  `GET /v1/business/risk` ("Otros rubros" = total − rubros visibles; semanas ocultas = periodo − visibles).
- Ningún cubo "Otras zonas" por debajo del umbral en lo público (`graph.ts:617` no se reutiliza tal cual).
- Un distrito bajo el umbral se ve igual que uno sin casos: "sin datos".
- La nota de sesgo va en cada respuesta y en cada pantalla: más casos puede significar que ahí se
  denuncia más, no que sea más peligroso.
- Solo casos reales con modo comunitario; los de demo solo en modo demo (`is_demo`).
- Nunca una dirección, coordenadas, nombres, números ni cuentas. Sin mapa base: el mapa es una grilla
  esquemática de distritos (`DISTRICTS[].col/row`).

## API (`services/api`)

- Migración `0004`: inserta `org-central`. Sin cambios de columnas.
- `POST /v1/auth/device/register`: `invite_code` opcional; sin código, `org-central`. Mantener el
  límite por IP.
- Revisores y analistas del equipo central ven todos los casos y vínculos; `reviewer`, `analyst` y
  `admin` aprueban alertas y consejos.
- Vigía: una alerta por modalidad y distrito (no una por organización), en `org-central`, con su `zona`.
  Asesor: destinos por distrito y rubro, no por las cuentas de negocio de un gremio.
- Víctima: avisos y consejos aprobados de su distrito, no de su organización.
- Públicos nuevos, con límite por IP y `Cache-Control` corto:
  - `GET /v1/public/zones` → `PublicZoneMap`
  - `GET /v1/public/risk?zona=&sector=` → `RiskOverview` con rangos en vez de cifras exactas
  - `GET /v1/public/alerts?zona=` y `GET /v1/public/recommendations?zona=&sector=`
- Consola: `GET /v1/console/zones` → `ConsoleZones` (cifras exactas para el equipo, mismo umbral para
  el detalle).
- Semilla de demo: organización central, equipo (revisora, analista, administración) y casos ficticios
  repartidos en distritos reales para que el mapa tenga distritos sobre y bajo el umbral.

## App de la víctima (`apps/mobile`)

- Sin pantalla de código: el registro pasa al botón "Empezar" (y se reintenta en la primera subida).
- El distrito se elige de la lista fija (con búsqueda), no texto libre; se puede cambiar en Ajustes.
- Textos: el equipo de Blindaje revisa; los avisos son "de tu zona"; nada promete visitas del gremio.

## Consola (`apps/console`)

- Sin revisores de gremio: permisos, menú, login de demo y textos para el equipo central.
- Alertas y consejos: por distrito y rubro; aprueba el equipo.
- Vista nueva **Zonas** (`/zonas`): grilla de distritos con cifras del periodo, tendencia, redes y
  modalidades; tabla accesible; nota de sesgo; distritos bajo el umbral sin detalle.
- Administración: las organizaciones pasan a ser "canales de difusión"; sin cuentas de negocio.

## Portal (`apps/portal`)

- Público, sin cuenta. Elige distrito y rubro (en la URL).
- Vistas: **Mapa** (grilla de distritos con niveles y rangos), **Mi zona** (riesgo, modalidades,
  alertas y consejos aprobados), **Si te pasa**, **Datos** (cómo se calcula, umbral, sesgo).
- Mismas reglas de privacidad que la API, también en el modo simulado.

## Landing (`apps/landing`)

- El relato pasa a tres pasos: recolectar, hacer inteligencia, saber dónde pasa.
- Acciones: "Ver el mapa" (portal) y "Solicitar acceso" para instituciones (policía, fiscalía,
  municipios, ONG). Se reescriben beneficios, cómo funciona, límites y preguntas.

## Fuera de alcance

- Cuentas de autoridad y un portal para la policía.
- Mapas con fondo geográfico, coordenadas o polígonos.
- Atestación del dispositivo (Play Integrity) o Turnstile en la app. Sin código de gremio, el freno a
  los reportes falsos es el límite por IP, la revisión humana y la columna `devices.flagged`.
