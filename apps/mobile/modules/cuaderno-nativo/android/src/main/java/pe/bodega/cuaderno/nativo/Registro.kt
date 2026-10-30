package pe.bodega.cuaderno.nativo

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Lo que el filtro de llamadas guarda en el celular.
 *
 * - Las llamadas anotadas y los números marcados van cifrados con AES-256-GCM, con una llave del
 *   Keystore de Android que no sale del hardware. Viven en noBackupFilesDir (sin copias de seguridad).
 * - Nada de esto se sube. Solo lo que la persona marca como extorsión, y eso lo sube la app por la
 *   cola cifrada de siempre.
 * - Lo que no se clasifica se borra solo a los 30 días; como mucho se guardan 300 llamadas.
 *
 * El filtro y la app corren en el mismo proceso: los métodos sincronizados bastan.
 */
internal object Registro {
  private const val LLAVE = "cuaderno.registro"
  private const val PREFS = "cuaderno.registro"
  private const val ARCHIVO = "registro.bin"
  private const val DIAS_MS = 30L * 24 * 60 * 60 * 1000
  private const val MAXIMO = 300

  const val MODO_DESCONOCIDOS = "desconocidos"
  const val MODO_MARCADOS = "marcados"
  const val ACCION_SONAR = "sonar"
  const val ACCION_SILENCIAR = "silenciar"
  const val ACCION_RECHAZAR = "rechazar"

  fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun activo(ctx: Context): Boolean = prefs(ctx).getBoolean("activo", false)

  fun modo(ctx: Context): String = prefs(ctx).getString("modo", MODO_DESCONOCIDOS) ?: MODO_DESCONOCIDOS

  fun accion(ctx: Context): String = prefs(ctx).getString("accion", ACCION_SONAR) ?: ACCION_SONAR

  /** Mostrar el botón del cuaderno sobre las llamadas (Burbuja). */
  fun burbuja(ctx: Context): Boolean = prefs(ctx).getBoolean("burbuja", false)

  fun guardarAjustes(ctx: Context, activo: Boolean, modo: String, accion: String, marcados: List<String>, burbuja: Boolean) {
    val limpios = marcados.mapNotNull { normalizar(it) }.distinct()
    prefs(ctx).edit()
      .putBoolean("activo", activo)
      .putBoolean("burbuja", burbuja)
      .putString("modo", if (modo == MODO_MARCADOS) MODO_MARCADOS else MODO_DESCONOCIDOS)
      .putString("accion", if (accion == ACCION_SILENCIAR || accion == ACCION_RECHAZAR) accion else ACCION_SONAR)
      .putString("marcados", if (limpios.isEmpty()) null else cifrar(JSONArray(limpios).toString()))
      .apply()
  }

  fun marcados(ctx: Context): List<String> {
    val guardado = prefs(ctx).getString("marcados", null) ?: return emptyList()
    val json = descifrar(guardado) ?: return emptyList()
    return try {
      val arr = JSONArray(json)
      (0 until arr.length()).map { arr.getString(it) }
    } catch (e: Exception) {
      emptyList()
    }
  }

  /**
   * Igual que normalizarNumero() en src/private/llamadas.ts: solo dígitos, sin el código de país
   * de Perú (51) ni el 0 de larga distancia. "+51 987 654 321" y "987654321" son el mismo número.
   */
  fun normalizar(numero: String?): String? {
    var d = numero?.filter { it.isDigit() } ?: return null
    if (d.startsWith("0051")) d = d.substring(4)
    else if (d.startsWith("51") && d.length >= 10) d = d.substring(2)
    d = d.trimStart('0')
    return if (d.length < 6) null else d
  }

  @Synchronized
  fun anotar(ctx: Context, llamada: JSONObject) {
    val lista = vigentes(leer(ctx))
    lista.add(0, llamada)
    guardar(ctx, lista.take(MAXIMO))
  }

  /**
   * La persona tocó "Anotar esta llamada" en la burbuja: la llamada queda en la lista (aunque el modo
   * no la hubiera anotado) con la marca "durante".
   */
  @Synchronized
  fun anotarDurante(ctx: Context, llamada: JSONObject) {
    val lista = vigentes(leer(ctx))
    val id = llamada.optString("id")
    val i = lista.indexOfFirst { it.optString("id") == id }
    if (i >= 0) lista[i].put("durante", true) else lista.add(0, JSONObject(llamada.toString()).put("durante", true))
    guardar(ctx, lista.take(MAXIMO))
  }

  @Synchronized
  fun listar(ctx: Context): List<JSONObject> {
    val todas = leer(ctx)
    val vigentes = vigentes(todas)
    if (vigentes.size != todas.size) guardar(ctx, vigentes)
    return vigentes
  }

  @Synchronized
  fun borrar(ctx: Context, ids: Set<String>) {
    guardar(ctx, leer(ctx).filter { it.optString("id") !in ids })
  }

  /** Borrado de emergencia: llamadas, ajustes y la llave. El filtro queda apagado. */
  @Synchronized
  fun borrarTodo(ctx: Context) {
    File(ctx.noBackupFilesDir, ARCHIVO).delete()
    prefs(ctx).edit().clear().apply()
    try {
      val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      if (ks.containsAlias(LLAVE)) ks.deleteEntry(LLAVE)
    } catch (e: Exception) {
      // sin llave: nada que borrar
    }
  }

  private fun vigentes(lista: List<JSONObject>): MutableList<JSONObject> {
    val desde = System.currentTimeMillis() - DIAS_MS
    return lista.filter { it.optLong("recibida", 0) >= desde }.toMutableList()
  }

  private fun leer(ctx: Context): List<JSONObject> {
    val archivo = File(ctx.noBackupFilesDir, ARCHIVO)
    if (!archivo.exists()) return emptyList()
    val json = descifrar(archivo.readText()) ?: return emptyList()
    return try {
      val arr = JSONArray(json)
      (0 until arr.length()).map { arr.getJSONObject(it) }
    } catch (e: Exception) {
      emptyList()
    }
  }

  private fun guardar(ctx: Context, lista: List<JSONObject>) {
    val archivo = File(ctx.noBackupFilesDir, ARCHIVO)
    if (lista.isEmpty()) {
      archivo.delete()
      return
    }
    val tmp = File(ctx.noBackupFilesDir, "$ARCHIVO.tmp")
    tmp.writeText(cifrar(JSONArray(lista).toString()))
    if (!tmp.renameTo(archivo)) {
      archivo.delete()
      tmp.renameTo(archivo)
    }
  }

  private fun llave(crear: Boolean): SecretKey? {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getKey(LLAVE, null) as? SecretKey)?.let { return it }
    if (!crear) return null
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(LLAVE, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return gen.generateKey()
  }

  /** IV de 96 bits nuevo en cada cifrado (lo elige el Keystore); se guarda delante del texto cifrado. */
  private fun cifrar(texto: String): String {
    val c = Cipher.getInstance("AES/GCM/NoPadding")
    c.init(Cipher.ENCRYPT_MODE, llave(true))
    val cifrado = c.doFinal(texto.toByteArray(Charsets.UTF_8))
    return Base64.encodeToString(c.iv + cifrado, Base64.NO_WRAP)
  }

  private fun descifrar(b64: String): String? =
    try {
      val k = llave(false)
      if (k == null) {
        null
      } else {
        val raw = Base64.decode(b64, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(128, raw, 0, 12))
        String(c.doFinal(raw, 12, raw.size - 12), Charsets.UTF_8)
      }
    } catch (e: Exception) {
      null
    }
}
