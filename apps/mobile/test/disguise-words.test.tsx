import { render, screen } from "@testing-library/react-native";
import type { ReactTestInstance } from "react-test-renderer";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true, canDismiss: () => true, dismissAll: jest.fn() };
jest.mock("expo-router", () => {
  const React = require("react") as typeof import("react");
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]),
    useLocalSearchParams: () => ({ tipo: "venta", e: "1", venta: "1818" }),
    Redirect: () => null,
  };
});

import appConfig from "../app.config";
import Anotar from "@/app/anotar";
import Calculadora from "@/app/calculadora";
import { allStrings, disguiseCopy } from "@/disguise/copy";
import { CuadernoHome } from "@/disguise/CuadernoHome";
import { ListaHome } from "@/disguise/ListaHome";
import { setDisguiseRepo } from "@/disguise/provider";
import { DEMO_COMPRAS, DEMO_FIADOS, DEMO_VENTAS, MemoryDisguiseRepo } from "@/disguise/repo";
import { VueltosHome } from "@/disguise/VueltosHome";
import { DISGUISE_FORBIDDEN_WORDS, disguiseTextIsSafe } from "@/shared";

async function seededRepo() {
  const r = new MemoryDisguiseRepo();
  for (const [d, c] of DEMO_VENTAS) await r.addVenta(d, c);
  for (const [n, d, c] of DEMO_FIADOS) await r.addFiado(n, d, c);
  for (const [n, c] of DEMO_COMPRAS) await r.addCompra(n, c);
  await r.addVuelto(1818, 2000);
  return r;
}

/** Junta todo el texto visible y las etiquetas de accesibilidad de lo renderizado. */
function visibleText(root: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === "string" || typeof node === "number") {
      out.push(String(node));
      return;
    }
    if (Array.isArray(node)) return node.forEach(walk);
    const n = node as { props?: Record<string, unknown>; children?: unknown[] };
    for (const k of ["accessibilityLabel", "accessibilityHint", "placeholder", "aria-label"]) {
      const v = n.props?.[k];
      if (typeof v === "string") out.push(v);
    }
    n.children?.forEach(walk);
  };
  walk(root);
  return out;
}

function expectSafe(texts: string[]) {
  const bad = texts.filter((t) => !disguiseTextIsSafe(t));
  expect(bad).toEqual([]);
}

describe("El disfraz no delata nada", () => {
  it("la lista de palabras prohibidas viene del contrato compartido", () => {
    expect(DISGUISE_FORBIDDEN_WORDS).toEqual(expect.arrayContaining(["extorsión", "denuncia", "policía"]));
  });

  it("ningún texto del disfraz contiene palabras prohibidas", () => {
    const texts = allStrings(disguiseCopy);
    expect(texts.length).toBeGreaterThan(50);
    expectSafe(texts);
  });

  it("los datos ficticios del cuaderno tampoco", () => {
    expectSafe([...DEMO_VENTAS.map((v) => v[0]), ...DEMO_FIADOS.flatMap((f) => [f[0], f[1]]), ...DEMO_COMPRAS.map((c) => c[0])]);
  });

  it("el nombre, el esquema y el paquete de la app son neutrales", () => {
    const cfg = appConfig({ config: {} } as never);
    expectSafe([cfg.name, cfg.slug, String(cfg.scheme), String(cfg.android?.package), String(cfg.ios?.bundleIdentifier)]);
  });

  const screens: [string, () => React.ReactElement][] = [
    ["Cuaderno de ventas", () => <CuadernoHome />],
    ["Lista de compras", () => <ListaHome />],
    ["Calculadora de vueltos", () => <VueltosHome />],
    ["Anotar venta", () => <Anotar />],
    ["Calculadora de vuelto (teclado del PIN)", () => <Calculadora />],
  ];

  it.each(screens)("pantalla renderizada: %s", async (_name, el) => {
    setDisguiseRepo(await seededRepo());
    await render(el());
    // Espera a que cargue la lista
    await screen.findAllByText(/S\/|Vuelto|Total|Anotar/);
    const texts = visibleText(screen.toJSON() as unknown as ReactTestInstance);
    expect(texts.length).toBeGreaterThan(3);
    expectSafe(texts);
  }, 30_000);
});
