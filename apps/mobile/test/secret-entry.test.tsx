import { act, renderHook } from "@testing-library/react-native";

import { HOLD_MS, holdReached, isSecretAmount, useHoldToOpen } from "@/disguise/secret";
import { calculate, focus, initialVuelto, PinThrottle, pinCandidate, press, type Key, type VueltoState } from "@/disguise/vuelto";
import { parseSoles, soles } from "@/lib/format";
import { DEFAULT_SECRET_CENTS } from "@/state/config";

const type = (s: VueltoState, keys: string) => [...keys].reduce((acc, k) => press(acc, k as Key), s);

describe("Entrada secreta: monto secreto", () => {
  it("por defecto es S/ 18.18", () => {
    expect(DEFAULT_SECRET_CENTS).toBe(1818);
    expect(soles(DEFAULT_SECRET_CENTS)).toBe("S/ 18.18");
  });

  it("reconoce el monto en cualquier forma de escribirlo", () => {
    const cfg = { secretAmountCents: 1818 };
    for (const t of ["18.18", "18,18", "S/ 18.18", " 18.18 "]) expect(isSecretAmount(parseSoles(t), cfg)).toBe(true);
    for (const t of ["18.1", "18.19", "1818", "8.18"]) expect(isSecretAmount(parseSoles(t), cfg)).toBe(false);
  });

  it("apagado no reconoce nada", () => {
    expect(isSecretAmount(1818, { secretAmountCents: null })).toBe(false);
    expect(isSecretAmount(null, { secretAmountCents: 1818 })).toBe(false);
  });
});

describe("Entrada secreta: mantener presionado el título 2 s", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("calcula el umbral", () => {
    expect(HOLD_MS).toBe(2000);
    expect(holdReached(1000, 2999)).toBe(false);
    expect(holdReached(1000, 3000)).toBe(true);
    expect(holdReached(null, 99999)).toBe(false);
  });

  it("abre a los 2 s aunque el dedo siga apoyado", async () => {
    const open = jest.fn();
    const { result } = await renderHook(() => useHoldToOpen(open, true));
    await act(() => result.current.onPressIn());
    await act(() => jest.advanceTimersByTime(1999));
    expect(open).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("soltar antes no hace nada", async () => {
    const open = jest.fn();
    const { result } = await renderHook(() => useHoldToOpen(open, true));
    await act(() => result.current.onPressIn());
    await act(() => jest.advanceTimersByTime(1500));
    await act(() => result.current.onPressOut());
    await act(() => jest.advanceTimersByTime(5000));
    expect(open).not.toHaveBeenCalled();
  });

  it("si la entrada está apagada en Ajustes, no abre", async () => {
    const open = jest.fn();
    const { result } = await renderHook(() => useHoldToOpen(open, false));
    await act(() => result.current.onPressIn());
    await act(() => jest.advanceTimersByTime(5000));
    expect(open).not.toHaveBeenCalled();
  });
});

describe("Calculadora de vuelto (teclado del PIN)", () => {
  it("calcula el vuelto de una venta", () => {
    let s = initialVuelto(1818);
    expect(s.active).toBe("pago");
    s = calculate(type(s, "20"));
    expect(s.result).toBe(182);
  });

  it("si falta pagar, lo dice como resultado negativo", () => {
    const s = calculate(type(initialVuelto(5000), "20"));
    expect(s.result).toBe(-3000);
  });

  it("propone como PIN solo de 4 a 8 dígitos tecleados en el campo activo", () => {
    expect(pinCandidate(type(initialVuelto(1818), "4826"))).toBe("4826");
    expect(pinCandidate(type(initialVuelto(1818), "482"))).toBeNull();
    expect(pinCandidate(type(initialVuelto(1818), "48.26"))).toBeNull();
    expect(pinCandidate(type(initialVuelto(1818), "123456789"))).toBeNull();
    // Borrar corrige lo tecleado
    expect(pinCandidate(press(type(initialVuelto(1818), "48269"), "back"))).toBe("4826");
    // Cambiar de campo reinicia lo tecleado
    const s = focus(type(initialVuelto(null), "48"), "pago");
    expect(pinCandidate(type(s, "26"))).toBeNull();
  });

  it("un PIN equivocado se ve como un cálculo normal", () => {
    const s = calculate(type(initialVuelto(1818), "9999"));
    expect(s.result).toBe(999900 - 1818);
  });

  it("frena en silencio después de 5 fallos", () => {
    const t = new PinThrottle(5, 60_000);
    for (let i = 0; i < 5; i++) {
      expect(t.canTry(0)).toBe(true);
      t.fail(0);
    }
    expect(t.canTry(1000)).toBe(false);
    expect(t.canTry(60_001)).toBe(true);
  });
});
