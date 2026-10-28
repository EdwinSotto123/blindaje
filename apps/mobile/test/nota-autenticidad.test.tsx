/**
 * Detalle de una nota: muestra el texto corto de autenticidad que manda el servidor (y nada si no
 * se analizó). La víctima nunca ve señales técnicas: el reporte solo trae ese texto.
 */
import { render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { textoAutenticidadVictima, VictimReport } from "@/shared";

let mockReport: VictimReport | null = null;

jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ id: "ev-1" }) }));
jest.mock("@/private/data", () => ({
  usePrivate: <T,>(sel: (s: { report: VictimReport | null }) => T) => sel({ report: mockReport }),
}));
jest.mock("@/private/PrivateScreen", () => {
  const { View } = require("react-native") as typeof import("react-native");
  return { PrivateScreen: ({ children }: { children: ReactNode }) => <View>{children}</View> };
});

import Nota from "@/app/privado/nota";

function report(autenticidad: string | null | undefined): VictimReport {
  // Pasa por el esquema: así se prueba también que una respuesta sin el campo se lee como null.
  return VictimReport.parse({
    case_id: "c-1",
    code: "K7Q2",
    status: "listo",
    consent_mode: "solo_denuncia",
    hallazgos: [],
    ficha: null,
    cronologia: [],
    evidencia: [
      {
        id: "ev-1",
        label: "EV-K7Q2-1",
        tipo: "audio",
        mime: "audio/ogg",
        size_bytes: 1000,
        sha256: "a".repeat(64),
        received_utc: "2026-10-28T10:00:00Z",
        captured_at: null,
        duration_ms: 12000,
        status: "procesado",
        transcripcion: null,
        nota: null,
        ...(autenticidad === undefined ? {} : { autenticidad }),
      },
    ],
    updated_at: "2026-10-28T10:00:00Z",
  });
}

describe("autenticidad en el detalle de la nota", () => {
  it("muestra el texto corto del servidor", async () => {
    const texto = textoAutenticidadVictima("indicios_fuertes");
    mockReport = report(texto);
    await render(<Nota />);
    expect(screen.getByText("¿Fue hecho con IA?")).toBeTruthy();
    expect(screen.getByTestId("nota-autenticidad").props.children).toBe(texto);
  });

  it("no muestra nada si no se analizó o si la respuesta es antigua", async () => {
    mockReport = report(null);
    await render(<Nota />);
    expect(screen.queryByTestId("nota-autenticidad")).toBeNull();
    mockReport = report(undefined);
    expect(mockReport.evidencia[0]!.autenticidad).toBeNull();
    await render(<Nota />);
    expect(screen.queryByText("¿Fue hecho con IA?")).toBeNull();
  });
});
