# Devlog: Negocios (API)

Horas en hora de Lima (UTC−5). Las entradas más nuevas van abajo. Frente: portal de negocios (rol
`business`), agente Asesor y consejos para la víctima, del lado de `services/api`. El portal web, la
vista de la consola y la app los hace otro frente.

## 2026-10-28 05:25 · Decisiones de base

- **Migración `0002_business.sql` solo con tablas nuevas**: `business_accounts`,
  `business_refresh_tokens` y `business_recommendations`. No se reconstruyó `users` ni
  `refresh_tokens` (sus `CHECK` siguen igual): reconstruir una tabla en producción con claves foráneas
  apuntándole es el camino con más riesgo, y una tabla aparte para las sesiones de negocio además
  impide que un refresh de negocio sirva en la consola o al revés. `auth/tokens.ts` elige la tabla
  según el tipo de sujeto.
- Rol `business`: `POST /v1/auth/business/login` y `/refresh` (PBKDF2 de 100k, JWT con
  `role: "business"`). Las rutas de consola y de víctima ya exigían su rol: `business` recibe `403`.
- **Qué casos cuentan**: consentimiento `comunitario`, con ficha y del mismo mundo que quien pregunta
  (los casos del demo solo cuentan para cuentas del demo; sin esto, la cuenta real de un bodeguero de
  Lima Este vería los casos ficticios A a G). Zona = distrito (`zoneAt(…, "distrito")`, sin tildes ni
  mayúsculas); periodo de 28 días.

## 2026-10-28 05:40 · Panorama de riesgo, Asesor y consejos

- **Umbral en todo** (`canShowTerritorialStats`): cifra de la zona, tendencia por semana, cifra por
  rubro y cada rasgo de una modalidad. Un rasgo (grupo que dice ser, canal, frase, plazo, tipo de
  amenaza) solo aparece si él mismo está en 5 casos de 3 víctimas: una frase de un solo caso le diría
  a un extorsionador infiltrado quién denunció. Por lo mismo, `sectores_afectados` solo nombra rubros
  que llegan al umbral; el resto va en "Otros rubros (agregado)" (o "Varios rubros" si ninguno llega).
- Si el rubro de la cuenta no llega al umbral pero la zona sí, las cifras son de toda la zona,
  `sector: null` y `aviso_umbral` lo explica. Bajo el umbral de la zona: `sin_datos`, todo `null`,
  sin rubros, sin escalamiento y modalidades solo de alertas que el gremio ya aprobó.
- **Nivel de riesgo** (regla fija en `business/risk.ts`): un punto por 8 o más casos, otro por 15 o
  más, uno por intimidación física y uno por una modalidad activa (alerta aprobada o rasgo común en los
  últimos 14 días). 0 = bajo, 1–2 = medio, 3+ = alto.
- Modalidades: alertas aprobadas de la organización para la zona más rasgos comunes de las fichas,
  agrupados como en el Vigía; si una alerta ya cubre esos casos, se usa su texto y se suman las señales.
- **Sin números**: todo texto que sale hacia un negocio pasa por `sanitizePublicText` (quita citas
  internas, `ID-…` y cualquier secuencia de 6 dígitos o más, también separados por espacios, puntos,
  comas o guiones; las fechas ISO se pasan a "12 de octubre"). Las frases con números nunca son señal.
  `businessJson` además aplica las claves prohibidas de víctima.
- **Asesor** (`agents/asesor.ts`): Muse Spark 1.3 con `ASESOR_SYSTEM`, cuatro herramientas
  (`panorama_riesgo`, `modalidades_activas`, `escalamiento`, `alertas_aprobadas`) que solo responden
  por la zona pedida y nunca devuelven números ni `ID-…`; `finalSchema: AsesorOutput` con
  `runCheckedAgent` (citas FICHA/VIN/R validadas; una modalidad sin cita marca el validador). Post-proceso
  determinista: zona, rubro y nivel los fija el servidor; se descarta toda recomendación, paso u oración
  que aconseje pagar, negociar o actuar contra personas (`isUnsafeAdvice`: verbo sin negación, con
  excepciones como "si te exigen pagar…"; prefiere falsos positivos) y siempre quedan "No pagues ni
  negocies", la evidencia, 1818, 105 y el gremio; siempre la advertencia de sesgo. Nace en borrador, se
  audita la corrida (`agent.asesor.run/result`) y la decisión (`recommendation.decision`), y no se
  aprueba si no pasó el validador (`409`). Al aprobar se vuelve a revisar que no haya números ni
  consejos inseguros.
- Sin zona ni rubro, `/v1/console/asesor/run` corre una vez por cada zona y rubro de las cuentas de
  negocio de la organización (máximo 5). `AsesorRunRequest.org_id` es opcional (aditivo).
- **Consejos de la víctima** (`business/consejos.ts`): reglas fijas sobre su propia ficha, sin modelo
  y sin datos de nadie más: siempre "no pagues ni negocies", 1818, evidencia, gremio y redes; 105 "de
  inmediato" si su caso tiene intimidación física; aviso si el guion dice "no llames a la policía";
  rutas y horarios para mototaxi y transporte; protocolo con el personal para bodega, mercado y
  restaurante. `GET /v1/recommendations` (víctima): aprobadas de su organización.
- Ojo con el detector: "Pagar no detiene la extorsión" se marca (verbo sin negación al inicio de la
  cláusula); los textos fijos dicen "un pago no detiene…".

## 2026-10-28 05:50 · Tests y prueba real

- `test/business.test.ts`, 17 tests (Meta simulado): guardas de rol en las dos direcciones, sesiones
  separadas, umbral (4 casos → `sin_datos` y `null`; 5 casos de 3 víctimas → cifras; 5 de 2 → no),
  solo comunitarios y nada del demo, rubro que cae a la zona, ninguna respuesta de negocio con 6
  dígitos o `ID-` (alerta y recomendación sembradas con números a propósito), Asesor con una salida
  simulada que aconseja pagar y negociar, sin datos bajo el umbral, aprobación por el gremio (la víctima
  y el negocio solo ven aprobadas de su organización), validador de citas que bloquea la aprobación,
  consejos sin otros casos y demo. Suite completa: 20 archivos, 123 tests en verde.
- Migración aplicada en local (tests y `wrangler dev`) y **en remoto** (`wrangler d1 migrations apply
  blindaje --remote`, solo `CREATE TABLE`/`CREATE INDEX`; antes se verificó que no existieran tablas
  con esos nombres). El Worker no se desplegó (lo hace el orquestador).
- **Prueba real** en `wrangler dev` local (estado propio en un directorio temporal, sin contenedores):
  demo sembrado por la API más los casos ficticios A a G por SQL (fichas de `eval/demo/demo.json`, A
  con la foto de la bala un día después del plazo), 6 vínculos confirmados, la red R-001 y una alerta
  aprobada de "Los X" en Lima Este. Panorama de Bodega Don Lucho: 6 casos en Lima Este, nivel `medio`,
  rubro bodega bajo el umbral (cifras de toda la zona), tendencia `null` (3 casos por semana),
  escalamiento "al día siguiente de vencido el plazo". Asesor con Muse Spark 1.3: 16.7 s, 2 llamadas,
  citas ok (FICHA-A…G, VIN-3…6, R-001), 6 recomendaciones (la de "No pagues ni negocies" la agregó el
  post-proceso), 5 pasos y 3 advertencias; ningún consejo descartado. Aprobada por la revisora, el
  portal la ve sin citas ni números. **Gasto: 0.012 USD.**
