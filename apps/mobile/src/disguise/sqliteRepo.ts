import { DEMO_SEED } from "@/config";
import { DEMO_COMPRAS, DEMO_FIADOS, DEMO_VENTAS, type Compra, type DisguiseRepo, type Fiado, type Venta, type Vuelto } from "@/disguise/repo";
import { dayKey } from "@/lib/format";
import { disguiseDb } from "@/storage/db";

export class SqliteDisguiseRepo implements DisguiseRepo {
  private seeded: Promise<void> | null = null;

  private async db() {
    const db = await disguiseDb();
    if (DEMO_SEED && !this.seeded) this.seeded = this.seed();
    if (this.seeded) await this.seeded;
    return db;
  }

  /** Solo en builds de demo: llena el cuaderno con datos ficticios si está vacío. */
  private async seed() {
    const db = await disguiseDb();
    const n = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM ventas WHERE dia = ?", dayKey());
    if ((n?.n ?? 0) > 0) return;
    const base = Date.now() - DEMO_VENTAS.length * 600_000;
    for (const [i, [d, c]] of DEMO_VENTAS.entries()) {
      await db.runAsync("INSERT INTO ventas (descripcion, cents, dia, created_at) VALUES (?, ?, ?, ?)", d, c, dayKey(), base + i * 600_000);
    }
    const f = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM fiados");
    if ((f?.n ?? 0) === 0) {
      for (const [i, [nombre, d, c]] of DEMO_FIADOS.entries()) {
        await db.runAsync("INSERT INTO fiados (nombre, descripcion, cents, pagado, created_at) VALUES (?, ?, ?, 0, ?)", nombre, d, c, base + i);
      }
    }
    const k = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM compras");
    if ((k?.n ?? 0) === 0) {
      for (const [i, [nombre, c]] of DEMO_COMPRAS.entries()) {
        await db.runAsync("INSERT INTO compras (nombre, cents, hecho, created_at) VALUES (?, ?, 0, ?)", nombre, c, base + i);
      }
    }
  }

  async ventasDelDia(dia = dayKey()) {
    const db = await this.db();
    return db.getAllAsync<Venta>("SELECT * FROM ventas WHERE dia = ? ORDER BY created_at DESC", dia);
  }
  async addVenta(descripcion: string, cents: number) {
    const db = await this.db();
    await db.runAsync("INSERT INTO ventas (descripcion, cents, dia, created_at) VALUES (?, ?, ?, ?)", descripcion, cents, dayKey(), Date.now());
  }
  async deleteVenta(id: number) {
    const db = await this.db();
    await db.runAsync("DELETE FROM ventas WHERE id = ?", id);
  }
  async fiados() {
    const db = await this.db();
    return db.getAllAsync<Fiado>("SELECT * FROM fiados ORDER BY pagado ASC, created_at DESC");
  }
  async addFiado(nombre: string, descripcion: string, cents: number) {
    const db = await this.db();
    await db.runAsync("INSERT INTO fiados (nombre, descripcion, cents, pagado, created_at) VALUES (?, ?, ?, 0, ?)", nombre, descripcion, cents, Date.now());
  }
  async setFiadoPagado(id: number, pagado: boolean) {
    const db = await this.db();
    await db.runAsync("UPDATE fiados SET pagado = ? WHERE id = ?", pagado ? 1 : 0, id);
  }
  async compras() {
    const db = await this.db();
    return db.getAllAsync<Compra>("SELECT * FROM compras ORDER BY hecho ASC, created_at ASC");
  }
  async addCompra(nombre: string, cents: number | null) {
    const db = await this.db();
    await db.runAsync("INSERT INTO compras (nombre, cents, hecho, created_at) VALUES (?, ?, 0, ?)", nombre, cents, Date.now());
  }
  async toggleCompra(id: number) {
    const db = await this.db();
    await db.runAsync("UPDATE compras SET hecho = 1 - hecho WHERE id = ?", id);
  }
  async deleteCompra(id: number) {
    const db = await this.db();
    await db.runAsync("DELETE FROM compras WHERE id = ?", id);
  }
  async limpiarCompradas() {
    const db = await this.db();
    await db.runAsync("DELETE FROM compras WHERE hecho = 1");
  }
  async vueltos() {
    const db = await this.db();
    return db.getAllAsync<Vuelto>("SELECT * FROM vueltos ORDER BY created_at DESC LIMIT 10");
  }
  async addVuelto(totalCents: number, pagoCents: number) {
    const db = await this.db();
    await db.runAsync("INSERT INTO vueltos (total_cents, pago_cents, created_at) VALUES (?, ?, ?)", totalCents, pagoCents, Date.now());
  }
}
