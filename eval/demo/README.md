# Datos del demo (ficticios)

Historia de los casos A, B y C (sección 3 del documento de diseño, textos de `docs/VIDEO.md`).
Todo es **ficticio**: personas, negocios, números (`+51 900 000 xxx`), la cuenta de Yape y el grupo
"Los X".

| Caso | Evidencia | Qué debe detectar Blindaje |
|---|---|---|
| A, bodega, Lima Este | `A1.ogg` y `A2.ogg` (voz 1, celular 1), mensaje "Si no yapeas S/ 2,000 en 48 horas al 900 000 101…", `foto-A.jpg` (bala sobre el mostrador y nota "LOS X. 48 HORAS"), muestra de voz `victima-A.ogg` | Ficha, huella de voz, identificadores, bala y nota en la imagen |
| B, mototaxi, otro distrito | `B1.ogg` (la **misma voz 1**, desde el **celular 2** y otro número), mensaje "Yapea al 900 000 202. Habla con el jefe." | Vínculo A–B por voz con números distintos; "habla con el jefe" y "no llames a la policía" |
| C, mercado | `C1.ogg` (otra voz), mensaje "Tu cupo es S/ 800 semanal. Yapea al 900 000 202…" | Vínculo B–C por la misma cuenta de Yape |

Números de contacto (en el relato de cada caso): A `+51 900 000 111`, B `+51 900 000 222`,
C `+51 900 000 333`.

## Archivos

- `demo.json`: lo que carga `pnpm demo:seed` (casos, evidencia, fechas, relatos).
- `guiones-audio.json`: textos de los audios (los mismos de `docs/VIDEO.md`).
- `audio/*.ogg`: notas de voz Opus. `audio/manifest.json` dice el origen de cada una
  (`grabado` o `sintetico`), su SHA-256 y la verificación de la huella de voz.
- `foto-A.jpg`: la foto del caso A. `foto-alternativa.jpg`: otra toma parecida que la evaluación usa
  como imagen distinta. `foto-A.meta.json`: modelo y prompt.

## Los audios son sintéticos

Mientras el equipo no grabe los audios, **son respaldos sintéticos** generados con MMS-TTS de Meta
(`facebook/mms-tts-spa`, licencia CC-BY-NC-4.0, no comercial) y pasados por la simulación de
WhatsApp: A1, A2 y la muestra de la víctima por el canal 1; B1, C1 y el infiltrado por el canal 2.
La voz 1 es la de MMS-TTS; la voz de C1 y la de la víctima son la misma síntesis con otro tono y
timbre, para que la huella de voz las trate como personas distintas (ver `verificacion_voz` en el
manifiesto). La sección 1 de `docs/VIDEO.md` explica cómo grabarlos; con las grabaciones en
`eval/audio/raw/demo/`, `uv run python -I -m blindaje_eval.tts_demo --force` las usa en su lugar.

## Comandos

```bash
pnpm demo:reset   # borra todo lo is_demo en la API
pnpm demo:seed    # organización, usuarios, dispositivos P-256, casos A → B → C y su procesamiento
```

`API_URL` (por defecto la del README de `services/api`), `DEMO_SECRET` (o `services/api/.dev.vars`)
y `DEMO_WAIT_SECONDS` (espera por caso, 240 por defecto). Son idempotentes: reutilizan los
dispositivos guardados en `eval/data/cache/demo-devices.json`, no duplican casos y la API ignora
evidencia repetida.
