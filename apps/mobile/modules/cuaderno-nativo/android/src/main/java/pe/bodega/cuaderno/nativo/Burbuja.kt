package pe.bodega.cuaderno.nativo

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.content.Context
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.ContextThemeWrapper
import android.view.Display
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.ImageView
import android.widget.TextView
import org.json.JSONObject
import kotlin.math.abs

/**
 * La burbuja del cuaderno sobre la llamada (opcional). La persona la enciende en sus notas privadas y
 * le permite a Cuaderno "mostrarse sobre otras apps". FiltroLlamadas la pone solo en llamadas de
 * números que no están en los contactos y que suenan.
 *
 * - Cerrada es el ícono de Cuaderno y se puede arrastrar. Abierta ofrece "Anotar esta llamada" y
 *   recuerda tocar Grabar en el teléfono del celular: ninguna app puede grabar la voz de una llamada.
 * - No dice el nombre del proyecto ni "extorsión": quien mire la pantalla ve un cuaderno de ventas que
 *   ofrece anotar una llamada.
 * - Se quita sola cuando termina la llamada (AudioManager vuelve a MODE_NORMAL; no hace falta el
 *   permiso de estado del teléfono), si nadie contesta o, como mucho, a las 3 horas.
 * - Mientras se ve, Android trata a la app como visible para la persona y no congela el proceso.
 */
internal object Burbuja {
  private const val CADA_MS = 1_000L
  /** Con el celular en vibración el modo de audio no cambia mientras suena: si nadie contesta, se va. */
  private const val SIN_CONTESTAR_MS = 60_000L
  private const val MAXIMO_MS = 3L * 60 * 60 * 1000
  /** Lecturas seguidas en MODE_NORMAL para dar la llamada por terminada (al contestar hay un salto breve). */
  private const val NORMALES_PARA_TERMINAR = 3

  private val main = Handler(Looper.getMainLooper())
  private var actual: Vista? = null

  /** Android 10+ y no Android Go: ahí ninguna app puede mostrarse sobre otras. */
  fun disponible(ctx: Context): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && ctx.getSystemService(ActivityManager::class.java)?.isLowRamDevice != true

  fun permitida(ctx: Context): Boolean = Settings.canDrawOverlays(ctx)

  fun mostrar(ctx: Context, llamada: JSONObject) {
    main.post {
      actual?.quitar()
      actual =
        try {
          Vista(ctx.applicationContext, llamada).also { it.poner() }
        } catch (e: Exception) {
          null
        }
    }
  }

  fun quitar() {
    main.post { actual?.quitar() }
  }

  /** Igual que mostrarNumero() en src/private/llamadas.ts. */
  private fun legible(raw: String): String {
    val n = Registro.normalizar(raw)
    return when {
      n != null && n.length == 9 && n.startsWith("9") -> "${n.substring(0, 3)} ${n.substring(3, 6)} ${n.substring(6)}"
      n != null && n.length == 8 && n.startsWith("1") -> "(01) ${n.substring(1, 4)} ${n.substring(4)}"
      else -> raw.trim()
    }
  }

  /** Android 11+ pide un contexto de ventana propio para las ventanas sobre otras apps. */
  private fun ventana(app: Context): Context =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val pantalla = app.getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
      app.createDisplayContext(pantalla).createWindowContext(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, null)
    } else {
      app
    }

  private class Vista(private val app: Context, private val llamada: JSONObject) {
    private val ctx = ContextThemeWrapper(ventana(app), android.R.style.Theme_DeviceDefault_Light_NoActionBar)
    private val wm = ctx.getSystemService(WindowManager::class.java)
    private val audio = ctx.getSystemService(AudioManager::class.java)
    private val raiz: View = LayoutInflater.from(ctx).inflate(R.layout.cuaderno_burbuja, null)
    private val icono: ImageView = raiz.findViewById(R.id.cuaderno_burbuja_icono)
    private val tarjeta: View = raiz.findViewById(R.id.cuaderno_burbuja_tarjeta)
    private val anotar: TextView = raiz.findViewById(R.id.cuaderno_burbuja_anotar)
    private val params =
      WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
        PixelFormat.TRANSLUCENT
      ).apply {
        gravity = Gravity.TOP or Gravity.END
        x = dp(12)
        y = dp(160)
      }
    private val inicio = SystemClock.elapsedRealtime()
    private var sono = false
    private var normales = 0
    private var puesta = false

    private val vigilar =
      object : Runnable {
        override fun run() {
          if (audio.mode != AudioManager.MODE_NORMAL) {
            sono = true
            normales = 0
          } else {
            normales++
          }
          val pasado = SystemClock.elapsedRealtime() - inicio
          val termino = (sono && normales >= NORMALES_PARA_TERMINAR) || (!sono && pasado > SIN_CONTESTAR_MS) || pasado > MAXIMO_MS
          if (termino) quitar() else main.postDelayed(this, CADA_MS)
        }
      }

    @SuppressLint("ClickableViewAccessibility")
    fun poner() {
      icono.setImageDrawable(app.packageManager.getApplicationIcon(app.packageName))
      raiz.findViewById<TextView>(R.id.cuaderno_burbuja_titulo).text = titulo()
      icono.setOnClickListener { abrir(true) }
      icono.setOnTouchListener(Arrastre())
      anotar.setOnClickListener { anotarla() }
      raiz.findViewById<View>(R.id.cuaderno_burbuja_minimizar).setOnClickListener { abrir(false) }
      raiz.findViewById<View>(R.id.cuaderno_burbuja_quitar).setOnClickListener { quitar() }
      wm.addView(raiz, params)
      puesta = true
      main.postDelayed(vigilar, CADA_MS)
    }

    fun quitar() {
      main.removeCallbacks(vigilar)
      if (puesta) {
        puesta = false
        try {
          wm.removeView(raiz)
        } catch (e: Exception) {
          // la ventana ya no estaba
        }
      }
      if (actual === this) actual = null
    }

    private fun abrir(si: Boolean) {
      icono.visibility = if (si) View.GONE else View.VISIBLE
      tarjeta.visibility = if (si) View.VISIBLE else View.GONE
    }

    private fun anotarla() {
      try {
        Registro.anotarDurante(app, llamada)
        anotar.isClickable = false
        anotar.setBackgroundResource(R.drawable.cuaderno_widget_boton2)
        anotar.setText(R.string.cuaderno_burbuja_anotada)
      } catch (e: Exception) {
        anotar.setText(R.string.cuaderno_burbuja_error)
      }
    }

    private fun titulo(): String {
      val numero = if (llamada.isNull("numero")) null else llamada.optString("numero")
      return ctx.getString(R.string.cuaderno_burbuja_titulo, numero?.let { legible(it) } ?: ctx.getString(R.string.cuaderno_burbuja_oculto))
    }

    private fun dp(v: Int): Int = (v * ctx.resources.displayMetrics.density).toInt()

    /** Arrastrar la burbuja cerrada; un toque sin moverla la abre. */
    private inner class Arrastre : View.OnTouchListener {
      private val umbral = ViewConfiguration.get(ctx).scaledTouchSlop
      private var x0 = 0
      private var y0 = 0
      private var rx = 0f
      private var ry = 0f
      private var movida = false

      override fun onTouch(v: View, e: MotionEvent): Boolean {
        when (e.actionMasked) {
          MotionEvent.ACTION_DOWN -> {
            x0 = params.x
            y0 = params.y
            rx = e.rawX
            ry = e.rawY
            movida = false
          }
          MotionEvent.ACTION_MOVE -> {
            val dx = e.rawX - rx
            val dy = e.rawY - ry
            if (!movida && (abs(dx) > umbral || abs(dy) > umbral)) movida = true
            if (movida && puesta) {
              // Con gravedad END, x se cuenta desde el borde derecho.
              params.x = (x0 - dx).toInt().coerceAtLeast(0)
              params.y = (y0 + dy).toInt().coerceAtLeast(0)
              wm.updateViewLayout(raiz, params)
            }
          }
          MotionEvent.ACTION_UP -> if (!movida) v.performClick()
        }
        return true
      }
    }
  }
}
