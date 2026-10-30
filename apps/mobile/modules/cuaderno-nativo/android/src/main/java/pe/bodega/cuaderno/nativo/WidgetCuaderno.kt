package pe.bodega.cuaderno.nativo

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews

/**
 * Widget de la pantalla de inicio. Es parte del disfraz: solo abre el cuaderno (anotar una venta o
 * un fiado), la lista o la calculadora de vuelto. Nunca muestra ni abre nada privado; a las notas se
 * llega como siempre, con la entrada secreta y el PIN.
 */
class WidgetCuaderno : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    manager.updateAppWidget(ids, vista(context))
  }

  companion object {
    private const val PREFS = "cuaderno.widget"

    /** Guarda el disfraz elegido y redibuja los widgets que haya en la pantalla de inicio. */
    fun actualizar(context: Context, disfraz: String) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("disfraz", disfraz).apply()
      val manager = AppWidgetManager.getInstance(context) ?: return
      val ids = manager.getAppWidgetIds(ComponentName(context, WidgetCuaderno::class.java))
      if (ids.isNotEmpty()) manager.updateAppWidget(ids, vista(context))
    }

    private fun vista(context: Context): RemoteViews {
      val disfraz = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("disfraz", "cuaderno")
      val v = RemoteViews(context.packageName, R.layout.cuaderno_widget)
      v.setOnClickPendingIntent(R.id.cuaderno_widget_raiz, abrir(context, "cuaderno://", 0))
      when (disfraz) {
        "lista" -> {
          v.setTextViewText(R.id.cuaderno_widget_titulo, context.getString(R.string.cuaderno_widget_lista))
          v.setTextViewText(R.id.cuaderno_widget_accion, context.getString(R.string.cuaderno_widget_agregar))
          v.setViewVisibility(R.id.cuaderno_widget_accion2, View.GONE)
          v.setOnClickPendingIntent(R.id.cuaderno_widget_accion, abrir(context, "cuaderno://", 1))
        }
        "vueltos" -> {
          v.setTextViewText(R.id.cuaderno_widget_titulo, context.getString(R.string.cuaderno_widget_vuelto))
          v.setTextViewText(R.id.cuaderno_widget_accion, context.getString(R.string.cuaderno_widget_calcular))
          v.setViewVisibility(R.id.cuaderno_widget_accion2, View.GONE)
          v.setOnClickPendingIntent(R.id.cuaderno_widget_accion, abrir(context, "cuaderno://", 1))
        }
        else -> {
          v.setTextViewText(R.id.cuaderno_widget_titulo, context.getString(R.string.cuaderno_widget_nombre))
          v.setTextViewText(R.id.cuaderno_widget_accion, context.getString(R.string.cuaderno_widget_venta))
          v.setTextViewText(R.id.cuaderno_widget_accion2, context.getString(R.string.cuaderno_widget_fiado))
          v.setViewVisibility(R.id.cuaderno_widget_accion2, View.VISIBLE)
          v.setOnClickPendingIntent(R.id.cuaderno_widget_accion, abrir(context, "cuaderno://anotar", 1))
          v.setOnClickPendingIntent(R.id.cuaderno_widget_accion2, abrir(context, "cuaderno://anotar?tipo=fiado", 2))
        }
      }
      return v
    }

    private fun abrir(context: Context, uri: String, codigo: Int): PendingIntent {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri))
        .setPackage(context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      return PendingIntent.getActivity(context, codigo, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
  }
}
