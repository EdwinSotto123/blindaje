# Grabaciones de voluntarios

Esta carpeta **no se sube al repo** (está en `.gitignore`, salvo este README). Aquí van las
grabaciones de voluntarios que leen los guiones **ficticios** de `eval/data/guiones.json`, para medir
la huella de voz con compresión real de WhatsApp.

## Estructura

```
eval/audio/raw/
  <hablante>/                 un identificador sin nombre real, por ejemplo v01, v02…
    celular1/<guion>.opus     notas de voz enviadas por WhatsApp desde el celular 1
    celular2/<guion>.opus     las mismas u otras, desde el celular 2 (otro número)
    consentimiento.txt        "Acepto que mi voz se use para la evaluación de Blindaje" + fecha
  demo/                       audios del demo (ver abajo)
```

## Cómo grabar

1. Cada voluntario lee 4 a 6 guiones distintos (uno por nota de voz), con naturalidad, 15 a 25 s.
2. Graba la mitad desde el celular 1 y la otra mitad desde el celular 2, como nota de voz de
   WhatsApp enviada a otro número del equipo. Así queda la compresión real y dos canales distintos.
3. En el celular que recibe: Compartir → Guardar en archivos, y copiar a `celular1/` o `celular2/`.
4. Nada de datos personales en la grabación: solo el texto del guion.

La evaluación de voz con SLR73 (`pnpm eval`) se puede repetir con estas grabaciones: inscribir con
`celular1/` y probar con `celular2/`.

## Demo

Si el equipo graba los audios del demo (`docs/VIDEO.md`, sección 1), van en `demo/` con estos
nombres exactos: `A1.opus`, `A2.opus`, `B1.opus`, `C1.opus`, `victima-A.opus`. Después:

```bash
cd eval/py && uv run python -I -m blindaje_eval.tts_demo --force
```

copia las grabaciones a `eval/demo/audio/` (sin recodificar) en lugar de los respaldos sintéticos.

Borrar las grabaciones cuando termine el hackathon. Los voluntarios pueden pedir que se borren en
cualquier momento.
