# Seguridad de Blindaje

> Prototipo de hackathon. Antes de manejar datos reales hace falta una auditoría de seguridad
> independiente y revisión legal (ver `PRIVACY.md`). Todo el contenido del demo es ficticio.

## Lo primero, con honestidad

**Blindaje no es cifrado de extremo a extremo.** El servidor necesita leer la evidencia para
transcribirla, armar la ficha, buscar vínculos y preparar la denuncia. Eso significa que quien
controle el backend (o sus claves) podría leerla. Lo que sí hacemos es reducir quién, cuándo y
cómo se puede acceder, y dejar rastro verificable de cada acceso.

## Qué protege cada capa

| Capa | Qué hace | Protege contra | No protege contra |
|---|---|---|---|
| **Disfraz de la app** | Se ve como un cuaderno de ventas, lista de compras o calculadora (la persona elige). Entrada secreta y PIN. | Alguien que mira el celular por encima | Un análisis forense del teléfono o alguien que conoce el proyecto y busca la app |
| **PIN señuelo** | Un segundo PIN abre notas privadas vacías y creíbles | Coerción para abrir la app | Quien sepa que existe el PIN señuelo y la presione más |
| **Salir rápido y bloqueo automático** | Vuelve al disfraz, limpia la navegación y bloquea; pantalla neutra en el selector de apps; prevención de capturas | Miradas de terceros y capturas de pantalla | Una cámara externa apuntando al teléfono |
| **Evidencia fuera del celular** | La evidencia se sube a la nube y se borra del celular al confirmarse; sin conexión espera en una cola cifrada (AES-GCM, llave en el almacenamiento seguro del sistema) | Que el extorsionador encuentre audios o fotos al revisar el teléfono | Un teléfono comprometido con malware que lee la pantalla |
| **Borrado de emergencia** | Elimina llaves, base local y archivos y cierra la sesión | Revisión posterior del teléfono | Copias que la persona haya hecho fuera de la app (por ejemplo en WhatsApp) |
| **Transporte** | HTTPS (TLS) hasta Cloudflare | Intercepción en la red | Un punto final comprometido |
| **Cifrado en reposo** | Originales en R2 cifrados con AES-256-GCM a nivel de aplicación (IV aleatorio, AAD = id de evidencia), además del cifrado de la plataforma | Acceso directo al bucket sin la clave | Quien tenga la clave `EVIDENCE_ENCRYPTION_KEY` |
| **Integridad y custodia** | SHA-256 calculado en el servidor y comparado con el del dispositivo; auditoría encadenada (cada entrada guarda el hash de la anterior) con endpoint de verificación | Alteración silenciosa de evidencia o del registro | Un atacante con acceso de escritura que reescriba toda la cadena desde el inicio sin que nadie haya guardado un hash de referencia |
| **Identificadores con HMAC** | Teléfonos, cuentas y placas se comparan como HMAC-SHA256 con la clave de la alianza; la consola muestra solo los últimos 3 dígitos | Lectura de números en claro desde la base de comparación | Fuerza bruta **si se filtra la clave**: los teléfonos tienen pocas combinaciones |
| **Roles mínimos** | Víctima, revisor, analista y administrador, cada uno con su alcance | Accesos fuera de rol | Un usuario legítimo que abusa de su rol (lo mitiga la auditoría) |
| **Aislamiento de la víctima** | Ninguna respuesta para víctimas incluye vínculos, redes, coincidencias ni datos de otros casos; un caso ajeno responde 404 | El infiltrado que se registra como víctima para saber si su número está marcado | Un infiltrado que además consigue una cuenta de revisor |
| **Agentes con citas** | Toda afirmación cita evidencia existente; sin cita, la salida es inválida. Búsqueda web desactivada. Nunca nombres de personas | Alucinaciones presentadas como hechos y OSINT sobre individuos | Errores de una persona revisora que aprueba sin leer |
| **Revisión humana** | Ningún vínculo, perfil, alerta o expediente existe sin aprobación | Falsos positivos automáticos | Sesgo del revisor |
| **Límites de uso** | Rate limiting por dispositivo, usuario e IP | Abuso de la API y enumeración | Ataques distribuidos a gran escala |
| **Presupuesto** | Registro de costos y bloqueo de llamadas no esenciales al 80% | Gasto descontrolado | |

## Modelo de amenazas y pruebas

La tabla de la sección 12.3 del documento de diseño se convierte en pruebas donde se puede:

| Amenaza | Prueba |
|---|---|
| Infiltración del extorsionador | `services/api`: un dispositivo registrado como víctima sube un audio de su voz, existe un vínculo en la base y ninguna respuesta de víctima lo revela; casos ajenos dan 404. Lo repite la evaluación contra el despliegue (`eval/`). |
| Acceso al celular de la víctima | `apps/mobile`: tests de cifrado local, salir rápido, PIN señuelo, cola que se borra tras confirmar y palabras prohibidas en el disfraz |
| Evidencia falsa o alterada | SHA-256 en servidor (422 si no coincide) y verificación de la auditoría |
| Voces sintéticas | La voz nunca vincula sola (probabilidad máxima calibrada por debajo del umbral) |
| Falsos positivos | Umbrales calibrados con la evaluación, mínimo de segmentos de voz y revisión humana obligatoria |
| Estadísticas que delatan | Ninguna estadística territorial con menos de 5 casos o 3 víctimas (test en `packages/shared` y en el Cartógrafo) |

## Secretos

`MODEL_API_KEY`, `HMAC_ALLIANCE_KEY`, `EVIDENCE_ENCRYPTION_KEY`, `JWT_SECRET`, `TURNSTILE_SECRET` y
`DEMO_SECRET` viven en `wrangler secret` (producción) y en `services/api/.dev.vars` (local, ignorado
por git). Nunca en el repositorio. Rotar `HMAC_ALLIANCE_KEY` obliga a recalcular todos los HMAC.

## Datos y modelos de terceros

- La Meta Model API se usa en **modo estándar** (el contenido no se usa para entrenar). Nunca
  usamos las variantes `-contributor` con datos de la app.
- Huella de voz, embeddings de texto, DINOv2 y FAISS corren en nuestro contenedor; esos datos no
  salen a terceros.

## Reportar un problema

Abre un issue sin datos sensibles o escribe a las personas del equipo listadas en el README.
