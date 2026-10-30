package pe.bodega.cuaderno.nativo

import android.annotation.SuppressLint
import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.json.JSONObject

internal class AjustesLlamadas : Record {
  @Field var activo: Boolean = false
  @Field var modo: String = Registro.MODO_DESCONOCIDOS
  @Field var accion: String = Registro.ACCION_SONAR
  @Field var marcados: List<String> = emptyList()
  @Field var burbuja: Boolean = false
}

/**
 * Puente de la app (src/native/cuaderno.ts) con el filtro de llamadas, la burbuja y el widget. Solo Android.
 * RoleManager es de Android 10: roleManager() devuelve null antes, y todo lo demás pasa por ahí.
 */
@SuppressLint("NewApi")
class CuadernoNativoModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private var pedidoRol: Promise? = null
  private var pedidoBurbuja: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("CuadernoNativo")

    /** El filtro de llamadas existe desde Android 10 (ROLE_CALL_SCREENING). */
    Function("llamadasDisponible") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && roleManager()?.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING) == true
    }

    /** Cuaderno es la app de identificación de llamadas (la persona lo puede quitar en Ajustes del teléfono). */
    Function("rolActivo") {
      rolActivo()
    }

    /** Muestra el diálogo de Android para elegir a Cuaderno como app de identificación de llamadas. */
    AsyncFunction("pedirRol") { promise: Promise ->
      val rm = roleManager()
      val activity = appContext.currentActivity
      if (rm == null || activity == null || !rm.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) {
        promise.resolve(false)
      } else if (rm.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) {
        promise.resolve(true)
      } else {
        pedidoRol?.resolve(false)
        pedidoRol = promise
        activity.startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING), PEDIR_ROL)
      }
    }.runOnQueue(Queues.MAIN)

    /** La burbuja necesita "mostrar sobre otras apps"; Android Go no lo permite. */
    Function("burbujaDisponible") {
      Burbuja.disponible(context)
    }

    Function("burbujaPermitida") {
      Burbuja.permitida(context)
    }

    /** Abre el ajuste de Android "Mostrar sobre otras apps" de Cuaderno y responde si quedó permitido. */
    AsyncFunction("pedirPermisoBurbuja") { promise: Promise ->
      val activity = appContext.currentActivity
      if (Burbuja.permitida(context)) {
        promise.resolve(true)
      } else if (activity == null || !Burbuja.disponible(context)) {
        promise.resolve(false)
      } else {
        pedidoBurbuja?.resolve(false)
        pedidoBurbuja = promise
        try {
          val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
          activity.startActivityForResult(intent, PEDIR_BURBUJA)
        } catch (e: Exception) {
          pedidoBurbuja = null
          promise.resolve(false)
        }
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, (requestCode, _, _) ->
      if (requestCode == PEDIR_ROL) {
        pedidoRol?.resolve(rolActivo())
        pedidoRol = null
      } else if (requestCode == PEDIR_BURBUJA) {
        pedidoBurbuja?.resolve(Burbuja.permitida(context))
        pedidoBurbuja = null
      }
    }

    Function("leerAjustes") {
      mapOf(
        "activo" to Registro.activo(context),
        "modo" to Registro.modo(context),
        "accion" to Registro.accion(context),
        "marcados" to Registro.marcados(context),
        "burbuja" to Registro.burbuja(context)
      )
    }

    Function("guardarAjustes") { ajustes: AjustesLlamadas ->
      Registro.guardarAjustes(context, ajustes.activo, ajustes.modo, ajustes.accion, ajustes.marcados, ajustes.burbuja)
      if (!ajustes.activo || !ajustes.burbuja) Burbuja.quitar()
    }

    /** Llamadas anotadas de los últimos 30 días, la más reciente primero. */
    Function("listarLlamadas") {
      Registro.listar(context).map { aMapa(it) }
    }

    Function("borrarLlamadas") { ids: List<String> ->
      Registro.borrar(context, ids.toSet())
    }

    Function("borrarTodo") {
      Burbuja.quitar()
      Registro.borrarTodo(context)
    }

    /** Ajustes del teléfono > Apps predeterminadas, para quitar a Cuaderno como identificador de llamadas. */
    Function("abrirAjustesDelTelefono") {
      val intent = Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        context.startActivity(intent)
      } catch (e: Exception) {
        context.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }

    Function("actualizarWidget") { disfraz: String ->
      WidgetCuaderno.actualizar(context, disfraz)
    }
  }

  private fun roleManager(): RoleManager? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) context.getSystemService(RoleManager::class.java) else null

  private fun rolActivo(): Boolean = roleManager()?.isRoleHeld(RoleManager.ROLE_CALL_SCREENING) == true

  private fun aMapa(o: JSONObject): Map<String, Any?> =
    mapOf(
      "id" to o.optString("id"),
      "numero" to if (o.isNull("numero")) null else o.optString("numero"),
      "recibida" to o.optLong("recibida"),
      "marcado" to o.optBoolean("marcado"),
      "accion" to o.optString("accion", Registro.ACCION_SONAR),
      "durante" to o.optBoolean("durante")
    )

  private companion object {
    const val PEDIR_ROL = 18_18
    const val PEDIR_BURBUJA = 18_19
  }
}
