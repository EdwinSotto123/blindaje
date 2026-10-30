package pe.bodega.cuaderno.nativo

import android.os.Build
import android.telecom.Call
import android.telecom.CallScreeningService
import android.telecom.TelecomManager
import org.json.JSONObject
import java.util.UUID

/**
 * Filtro de llamadas. Android solo lo llama para números que NO están en los contactos (la app no
 * pide permiso de contactos), y solo si la persona eligió a Cuaderno como app de identificación de
 * llamadas.
 *
 * - Apagado en los ajustes de la persona: deja pasar la llamada y no anota nada.
 * - Anota la hora y el número (o "oculto") en el registro cifrado del celular.
 * - Con un número que la persona marcó como extorsión hace lo que ella eligió: dejar sonar
 *   (por defecto), silenciar o rechazar. Nunca bloquea nada por su cuenta.
 * - No graba ni escucha la llamada: Android no lo permite a ninguna app.
 * - Si la persona lo encendió, pone la burbuja del cuaderno sobre las llamadas que suenan.
 *
 * Tiene 5 segundos para responder; ante cualquier error, la llamada entra normal.
 */
class FiltroLlamadas : CallScreeningService() {
  override fun onScreenCall(details: Call.Details) {
    var respuesta = CallResponse.Builder().build()
    var burbuja: JSONObject? = null
    try {
      if (entrante(details) && Registro.activo(this)) {
        val numero = details.handle?.schemeSpecificPart?.takeIf { it.isNotBlank() }
        val oculto = numero == null || details.handlePresentation != TelecomManager.PRESENTATION_ALLOWED
        val normalizado = if (oculto) null else Registro.normalizar(numero)
        val marcado = normalizado != null && normalizado in Registro.marcados(this)
        val accion = if (marcado) Registro.accion(this) else Registro.ACCION_SONAR

        val llamada = JSONObject()
          .put("id", UUID.randomUUID().toString())
          .put("numero", if (oculto) JSONObject.NULL else numero)
          .put("recibida", System.currentTimeMillis())
          .put("marcado", marcado)
          .put("accion", accion)
        if (marcado || Registro.modo(this) == Registro.MODO_DESCONOCIDOS) Registro.anotar(this, llamada)
        // Solo sobre llamadas que suenan: nunca sobre las que la persona eligió silenciar o rechazar.
        if (accion == Registro.ACCION_SONAR && Registro.burbuja(this) && Burbuja.permitida(this)) burbuja = llamada

        respuesta = when (accion) {
          Registro.ACCION_RECHAZAR -> CallResponse.Builder().setDisallowCall(true).setRejectCall(true).build()
          Registro.ACCION_SILENCIAR ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) CallResponse.Builder().setSilenceCall(true).build() else respuesta
          else -> respuesta
        }
      }
    } catch (e: Exception) {
      respuesta = CallResponse.Builder().build()
      burbuja = null
    }
    respondToCall(details, respuesta)
    burbuja?.let { Burbuja.mostrar(applicationContext, it) }
  }

  private fun entrante(details: Call.Details): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || details.callDirection == Call.Details.DIRECTION_INCOMING
}
