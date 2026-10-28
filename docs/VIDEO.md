# Video demo (3 minutos)

Guion base: sección 18 del documento de diseño. Todo el contenido es **ficticio** y la consola lo
muestra con la marca "Datos ficticios". Grabar en inglés o con subtítulos en inglés; la interfaz
queda en español.

## 1. Audios del demo (para grabar)

Los audios con voz humana real hacen que el momento "cambiaron de número, pero no de voz" sea
creíble. Si no se graban, `pnpm demo:seed` usa respaldos sintéticos (MMS-TTS de Meta) y el
README lo dice.

**Quiénes:** la persona 1 hace la voz que extorsiona en A y B. La persona 2 (otra voz) graba C1
y la muestra de voz de una víctima.

**Cómo:**
1. La persona 1 graba A1 y A2 **desde el celular 1** como nota de voz de WhatsApp, y B1 **desde
   el celular 2** (otro número), también por WhatsApp. Así tienen la compresión real de WhatsApp
   y dos canales distintos.
2. Exporta cada nota de voz (Compartir → Guardar en archivos) y cópiala a
   `eval/audio/raw/demo/` con estos nombres: `A1.opus`, `A2.opus`, `B1.opus`, `C1.opus` y
   `victima-A.opus`. Esa carpeta no se sube al repo.
3. Habla con naturalidad, sin actuar de más. Unos 15 a 25 segundos por audio.

**A1** (persona 1, celular 1)
> Oye, escúchame bien. Sabemos que tienes tu bodeguita ahí en la esquina. Nosotros somos de Los X
> y aquí todos pagan su colaboración. Son dos mil soles. Te vamos a mandar el número para que
> yapees. Tienes cuarenta y ocho horas. Y no llames a la policía, porque nos vamos a enterar.

**A2** (persona 1, celular 1, "un día después")
> Ya pasó un día y no veo nada. Habla con el jefe si quieres arreglar, pero el plazo sigue
> corriendo. Cuarenta y ocho horas te dije. No te hagas el loco, que sabemos dónde estás.

**B1** (persona 1, **celular 2**)
> Mototaxista, escucha. Aquí mandamos nosotros, Los X. Para que sigas trabajando tranquilo pagas
> tu cupo, mil quinientos soles. Habla con el jefe para que te pase el Yape. Y no llames a la
> policía, que tenemos gente en todos lados.

**C1** (persona 2, opcional)
> Comerciante, tu cupo es de ochocientos soles a la semana. Ya te mandamos el número para que
> yapees. Tienes hasta el viernes, no lo dejes pasar.

**victima-A** (persona 2, 10 segundos, voz tranquila)
> Hola, soy la dueña de la bodega. Estoy grabando esta muestra para que el sistema reconozca mi
> voz y la separe de la de quien me llama.

Mensajes de texto del demo (los carga el seed; los números son ficticios, rango `900 000 xxx`):
- A: "Si no yapeas S/ 2,000 en 48 horas al 900 000 101 ya sabes lo que pasa. Los X."
- B: "Yapea al 900 000 202. Habla con el jefe."
- C: "Tu cupo es S/ 800 semanal. Yapea al 900 000 202. Tienes hasta el viernes."

## 2. Lista de tomas

| Tiempo | Toma | Pantalla | Qué se dice (inglés) |
|---|---|---|---|
| 0:00–0:20 | Cifras con su fuente y un audio ficticio sonando | Landing, sección "El problema" | "Thousands of extortion reports in Peru, but each victim faces a network alone. What if the community could put the pieces together?" |
| 0:20–0:35 | El cuaderno de ventas; mantener presionado el título; teclado de vuelto; PIN | App, emulador | "To anyone looking at her phone, it's a sales notebook." |
| 0:35–0:50 | Notas privadas: compartir el audio desde WhatsApp, grabar, foto; "Lo que encontramos" se llena | App | "Muse Voice Transcribe separates speakers, Muse Spark builds the case file, SAM 3.1 finds the bullet and blurs faces." |
| 0:50–1:30 | Llega el caso B desde otro número; en la consola aparece el vínculo A–B con su explicación y los dos audios lado a lado | Consola, cola de vínculos | "They changed the number, not the voice." Reproducir los dos fragmentos. |
| 1:30–2:00 | Llega el caso C con la misma cuenta de Yape; el revisor confirma; el grafo crece a 3 casos | Consola, Redes | "Same Yape account. A human confirms every link before it exists." |
| 2:00–2:30 | El Cartógrafo genera el perfil: hechos e hipótesis con citas; el Vigía redacta la alerta, el gremio la aprueba y aparece en la app como "Avisos del proveedor" | Consola y app | "Facts and hypotheses, every claim cited. The guild approves the alert." |
| 2:30–2:50 | Expediente PDF con cadena de custodia; verificación de la auditoría; métricas de la evaluación | Consola y landing | Mostrar los resultados reales de `eval/REPORT.md`. |
| 2:50–3:00 | Arquitectura con las tecnologías de Meta y el llamado a pilotos | README o landing | "Blindaje: united, the community knows more than extortion." |

## 3. Antes de grabar

1. `pnpm demo:reset && pnpm demo:seed` contra la API desplegada (ver README).
2. App: build de Android con `EXPO_PUBLIC_ALLOW_SCREENSHOTS=1` **solo para grabar** (desactiva la
   prevención de capturas). Nunca para uso real.
3. Consola: entrar con el usuario analista de demo; verificar la marca "Datos ficticios".
4. Calentar el contenedor ML (una petición a `/v1/health` del API con `?ml=1`) para evitar el
   arranque en frío durante la toma.
5. Revisar que el gasto acumulado en la consola de costos esté lejos del 80% del presupuesto.
