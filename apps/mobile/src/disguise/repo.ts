import { dayKey } from "@/lib/format";

/** Datos del disfraz: funcionan de verdad y se guardan en el celular. */
export type Venta = { id: number; descripcion: string; cents: number; dia: string; created_at: number };
export type Fiado = { id: number; nombre: string; descripcion: string; cents: number; pagado: number; created_at: number };
export type Compra = { id: number; nombre: string; cents: number | null; hecho: number; created_at: number };
export type Vuelto = { id: number; total_cents: number; pago_cents: number; created_at: number };

export interface DisguiseRepo {
  ventasDelDia(dia?: string): Promise<Venta[]>;
  addVenta(descripcion: string, cents: number): Promise<void>;
  deleteVenta(id: number): Promise<void>;
  fiados(): Promise<Fiado[]>;
  addFiado(nombre: string, descripcion: string, cents: number): Promise<void>;
  setFiadoPagado(id: number, pagado: boolean): Promise<void>;
  compras(): Promise<Compra[]>;
  addCompra(nombre: string, cents: number | null): Promise<void>;
  toggleCompra(id: number): Promise<void>;
  deleteCompra(id: number): Promise<void>;
  limpiarCompradas(): Promise<void>;
  vueltos(): Promise<Vuelto[]>;
  addVuelto(totalCents: number, pagoCents: number): Promise<void>;
}

/** Datos ficticios para el demo (EXPO_PUBLIC_DEMO_SEED=1), iguales al diseño. */
export const DEMO_VENTAS: [string, number][] = [
  ["2 leches", 900],
  ["Pan, 10 unidades", 300],
  ["Gaseosa 1.5 L", 750],
  ["Arroz 5 kg", 2200],
  ["Aceite 1 L", 1150],
  ["Recarga de celular", 1000],
  ["Huevos, medio kilo", 550],
  ["Detergente", 600],
  ["Azúcar 1 kg", 450],
  ["Fideos y atún", 950],
  ["Galletas y caramelos", 3000],
];
export const DEMO_FIADOS: [string, string, number][] = [
  ["Sra. Rosa", "2 leches, 1 pan", 1200],
  ["Don Julio", "Aceite y arroz", 2600],
  ["Vecina del 3", "Gaseosa", 800],
];
export const DEMO_COMPRAS: [string, number | null][] = [
  ["Leche evaporada, 1 caja", 9600],
  ["Pan del día", null],
  ["Gaseosas surtidas", 4500],
  ["Bolsas chicas", 800],
];

export class MemoryDisguiseRepo implements DisguiseRepo {
  private seq = 1;
  v: Venta[] = [];
  f: Fiado[] = [];
  c: Compra[] = [];
  vu: Vuelto[] = [];
  async ventasDelDia(dia = dayKey()) {
    return this.v.filter((x) => x.dia === dia).sort((a, b) => b.created_at - a.created_at);
  }
  async addVenta(descripcion: string, cents: number) {
    this.v.push({ id: this.seq++, descripcion, cents, dia: dayKey(), created_at: Date.now() + this.seq });
  }
  async deleteVenta(id: number) {
    this.v = this.v.filter((x) => x.id !== id);
  }
  async fiados() {
    return [...this.f].sort((a, b) => a.pagado - b.pagado || b.created_at - a.created_at);
  }
  async addFiado(nombre: string, descripcion: string, cents: number) {
    this.f.push({ id: this.seq++, nombre, descripcion, cents, pagado: 0, created_at: Date.now() + this.seq });
  }
  async setFiadoPagado(id: number, pagado: boolean) {
    this.f = this.f.map((x) => (x.id === id ? { ...x, pagado: pagado ? 1 : 0 } : x));
  }
  async compras() {
    return [...this.c].sort((a, b) => a.hecho - b.hecho || a.created_at - b.created_at);
  }
  async addCompra(nombre: string, cents: number | null) {
    this.c.push({ id: this.seq++, nombre, cents, hecho: 0, created_at: Date.now() + this.seq });
  }
  async toggleCompra(id: number) {
    this.c = this.c.map((x) => (x.id === id ? { ...x, hecho: x.hecho ? 0 : 1 } : x));
  }
  async deleteCompra(id: number) {
    this.c = this.c.filter((x) => x.id !== id);
  }
  async limpiarCompradas() {
    this.c = this.c.filter((x) => !x.hecho);
  }
  async vueltos() {
    return [...this.vu].sort((a, b) => b.created_at - a.created_at).slice(0, 10);
  }
  async addVuelto(totalCents: number, pagoCents: number) {
    this.vu.push({ id: this.seq++, total_cents: totalCents, pago_cents: pagoCents, created_at: Date.now() + this.seq });
  }
}
