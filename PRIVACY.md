# Privacidad en Blindaje

> **Aviso:** esto es un prototipo construido para un hackathon. Todos los datos del demo son
> ficticios. Antes de cualquier piloto con personas reales, el proyecto necesita **revisión legal**
> de un abogado especializado en la **Ley 29733, Ley de Protección de Datos Personales del Perú**, y
> su reglamento. En particular sobre la voz como dato biométrico (dato sensible), el tratamiento de
> la voz de quien extorsiona como evidencia y la base legal para compartir información con
> autoridades. Este documento no es asesoría legal.

## En pocas palabras

- Tú decides. Hay dos niveles de permiso y el más reservado viene marcado por defecto.
- Lo que guardas se sube **cifrado** a nuestros servidores en Cloudflare y se borra de tu
  celular, para que nadie lo encuentre si revisa tu teléfono.
- Nadie más ve tu caso, salvo las personas autorizadas de tu organización (por ejemplo tu gremio)
  y analistas autorizados, según lo que permitas.
- Nunca te mostramos información de otras personas, ni le mostramos tu caso a otras víctimas.
- Puedes borrar tu caso cuando quieras.

## Qué datos usamos

| Dato | Para qué | Dónde vive |
|---|---|---|
| Código de invitación de tu organización | Verificar que tu gremio te conoce | Servidor |
| Un seudónimo (por ejemplo V-7F3K) | Identificarte sin tu nombre | Servidor |
| Audios, fotos, videos y mensajes que guardas | Armar tu denuncia | Servidor, cifrados |
| Lo que cuentas en "Cuéntanos qué pasó" | Armar tu denuncia | Servidor, cifrado |
| Una muestra de tu voz de 10 segundos | Separar tu voz de la de quien te llama | Solo guardamos una huella numérica cifrada; el audio se borra |
| Tus ventas y fiados del cuaderno | Que el cuaderno funcione de verdad | Solo en tu celular |

No pedimos tu nombre, tu DNI ni tu dirección. La ficha de tu caso no guarda datos tuyos.

## Los dos niveles de permiso

**Solo mi denuncia (por defecto).** Blindaje ordena tu evidencia y arma tu denuncia. Nada de tu
caso se compara con otros.

**Sumar mi caso a la red de mi gremio (apagado por defecto).** Además, se comparan señales
cifradas de tu caso con las de otros casos: una huella numérica de la voz de quien te llamó,
números y cuentas convertidos en códigos que no se pueden leer, y un resumen de cómo opera, sin
datos tuyos. Si aparece una coincidencia, solo la ven analistas autorizados, y una persona la
revisa antes de que cuente. **A ti no se te avisa por el celular** (nadie que revise tu teléfono
podrá verlo); si tu caso ayuda a un expediente, tu gremio te lo comunica en persona.

Puedes apagar este permiso cuando quieras: tu caso sale de las comparaciones.

## Quién puede ver qué

| Quién | Qué ve |
|---|---|
| Tú | Tu caso, tu denuncia, tu evidencia y las alertas aprobadas de tu gremio |
| Revisor de tu gremio | Posibles vínculos para confirmar o descartar, y alertas para aprobar |
| Analista autorizado | Redes de casos confirmados, perfiles y expedientes para la autoridad |
| Administrador | Organizaciones, accesos, auditoría y costos |
| Público | Nada. No publicamos mapas ni datos abiertos |

Cada acceso queda en un registro encadenado que no se puede alterar sin que se note.

## Borrado

- **Borrar mi caso:** elimina la evidencia, la ficha, las huellas, los códigos de tus números y
  tu caso de cualquier red o comparación.
- **Borrado de emergencia (en el celular):** borra todo lo que hay en el teléfono al instante.
- Plazos de retención: por definir con asesoría legal antes de un piloto.

## Ayuda

Si estás en peligro ahora, llama al **105**. Para denunciar una extorsión, llama a la **Línea
1818** o acude a la comisaría más cercana. Blindaje no reemplaza a la policía ni a la fiscalía, y
nunca te aconsejará pagar ni negociar.
