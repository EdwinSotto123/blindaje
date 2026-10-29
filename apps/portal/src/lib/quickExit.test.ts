import { describe, expect, it, vi } from "vitest";
import { QUICK_EXIT_URL } from "../config";
import { quickExit } from "./quickExit";

describe("Salir rápido", () => {
  it("abre una página neutra sin referer y reemplaza esta entrada del historial, sin esperar a la red", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const win = { open: vi.fn(), location: { replace: vi.fn() } };
    quickExit(win as unknown as Parameters<typeof quickExit>[0]);
    expect(win.open).toHaveBeenCalledWith(QUICK_EXIT_URL, "_blank", "noopener,noreferrer");
    expect(win.location.replace).toHaveBeenCalledWith(QUICK_EXIT_URL);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
