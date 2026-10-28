import * as SQLite from "expo-sqlite";

import { toHex } from "@/lib/bytes";
import { getDbKey } from "@/security/keys";

/**
 * Dos bases locales:
 * - cuaderno.db: datos del disfraz (ventas, fiados, compras, vueltos). Inofensivos por diseño.
 * - notas.db: cifrada con SQLCipher (llave de 256 bits en el almacenamiento seguro). Guarda la
 *   cola de subida, los archivos retenidos y las notas del modo señuelo. Nada de la evidencia
 *   ya confirmada por el servidor.
 */
export const DISGUISE_DB = "cuaderno.db";
export const PRIVATE_DB = "notas.db";

let disguise: Promise<SQLite.SQLiteDatabase> | null = null;
let priv: Promise<SQLite.SQLiteDatabase> | null = null;

export function disguiseDb(): Promise<SQLite.SQLiteDatabase> {
  if (!disguise) {
    disguise = (async () => {
      const db = await SQLite.openDatabaseAsync(DISGUISE_DB);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS ventas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          descripcion TEXT NOT NULL,
          cents INTEGER NOT NULL,
          dia TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ventas_dia ON ventas(dia);
        CREATE TABLE IF NOT EXISTS fiados (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nombre TEXT NOT NULL,
          descripcion TEXT NOT NULL,
          cents INTEGER NOT NULL,
          pagado INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS compras (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nombre TEXT NOT NULL,
          cents INTEGER,
          hecho INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS vueltos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          total_cents INTEGER NOT NULL,
          pago_cents INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
      return db;
    })();
  }
  return disguise;
}

export function privateDb(): Promise<SQLite.SQLiteDatabase> {
  if (!priv) {
    priv = (async () => {
      const key = await getDbKey();
      const db = await SQLite.openDatabaseAsync(PRIVATE_DB);
      // La llave es hexadecimal (64 caracteres), así que interpolarla en el PRAGMA es seguro.
      await db.execAsync(`PRAGMA key = "x'${toHex(key)}'";`);
      await db.execAsync(`
        PRAGMA journal_mode = DELETE;
        PRAGMA secure_delete = ON;
        CREATE TABLE IF NOT EXISTS cola (
          id TEXT PRIMARY KEY NOT NULL,
          tipo TEXT NOT NULL,
          mime TEXT NOT NULL,
          source TEXT NOT NULL,
          captured_at TEXT,
          duration_ms INTEGER,
          size INTEGER NOT NULL,
          sha256 TEXT NOT NULL,
          blob TEXT NOT NULL,
          status TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_at INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          evidence_id TEXT,
          label TEXT,
          preview TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS senuelo (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tipo TEXT NOT NULL,
          preview TEXT,
          duration_ms INTEGER,
          created_at INTEGER NOT NULL
        );
      `);
      return db;
    })().catch((e: unknown) => {
      priv = null;
      throw e;
    });
  }
  return priv;
}

/** Borrado de emergencia: cierra y elimina la base cifrada. */
export async function deletePrivateDb(): Promise<void> {
  const p = priv;
  priv = null;
  if (p) {
    try {
      const db = await p;
      await db.closeAsync();
    } catch {
      // ya cerrada o nunca abrió
    }
  }
  try {
    await SQLite.deleteDatabaseAsync(PRIVATE_DB);
  } catch {
    // no existía
  }
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await privateDb();
  const row = await db.getFirstAsync<{ v: string }>("SELECT v FROM meta WHERE k = ?", key);
  return row?.v ?? null;
}

export async function setMeta(key: string, value: string | null): Promise<void> {
  const db = await privateDb();
  if (value === null) await db.runAsync("DELETE FROM meta WHERE k = ?", key);
  else await db.runAsync("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", key, value);
}
