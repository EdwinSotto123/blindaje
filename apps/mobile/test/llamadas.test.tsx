/**
 * Llamadas: el filtro nativo (simulado) anota llamadas de números desconocidos y la persona decide.
 * Lo que marca como extorsión entra a su denuncia por la cola; lo demás nunca sale del celular.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true, canDismiss: () => true, dismissAll: jest.fn() };

jest.mock("expo-router", () => {
  const React = require("react") as typeof import("react");
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]),
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
  };
});

jest.mock("@/services", () => {
  const { BlindajeApi } = require("@/api/client") as typeof import("@/api/client");
  const { createMockServer } = require("@/api/mock") as typeof import("@/api/mock");
  const { EvidenceQueue, MemoryBlobStore, MemoryQueueRepo } = require("@/sync/queue") as typeof import("@/sync/queue");
  const server = createMockServer({ processMs: 0 });
  let auth: import("@/api/client").AuthState | null = null;
  const authStore = { get: async () => auth, set: async (a: typeof auth) => void (auth = a), clear: async () => void (auth = null) };
  const api = new BlindajeApi({
    baseUrl: "https://mock.local",
    fetcher: server.fetcher,
    auth: authStore as never,
    sign: async () => "firma",
    device: async () => ({ publicKey: { kty: "EC", crv: "P-256", x: "x", y: "y" }, platform: "android" }),
  });
  let caseId: string | null = null;
  const ensureCase = async () => {
    if (!caseId) caseId = (await api.createCase({ consent_mode: "solo_denuncia", sector: null, zona: null } as never)).id;
    return caseId;
  };
  const key = new Uint8Array(32).fill(7);
  const queue = new EvidenceQueue({
    repo: new MemoryQueueRepo(),
    blobs: new MemoryBlobStore(),
    key: async () => key,
    uploader: {
      upload: async (i, body) =>
        api.uploadEvidence(await ensureCase(), body, { tipo: i.tipo, mime: i.mime, sha256: i.sha256, source: i.source, durationMs: i.duration_ms }),
    },
  });
  return { api, queue, authStore, mockServer: server, platform: "android", isOnline: async () => false, ensureCase, currentCaseId: async () => caseId, forgetCase: async () => void (caseId = null) };
});

jest.mock("@/storage/db", () => ({ privateDb: async () => ({ getAllAsync: async () => [], runAsync: async () => ({ changes: 1 }) }), deletePrivateDb: async () => undefined }));
jest.mock("@/storage/queueStorage", () => ({ deleteQueueFiles: () => undefined }));
jest.mock("expo-file-system", () => ({
  Paths: { cache: { list: () => [] }, document: {} },
  Directory: class {},
  File: class {
    exists = false;
    uri: string;
    constructor(u: string) {
      this.uri = u;
    }
    async bytes() {
      return new Uint8Array([1, 2, 3, 4]);
    }
    delete() {}
  },
}));
jest.mock("expo-document-picker", () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: "file:///cache/llamada.m4a", name: "llamada.m4a", mimeType: "audio/mp4", lastModified: 0 }] })),
}));

import Llamadas from "@/app/privado/llamadas";
import NotasPrivadas from "@/app/privado/index";
import { type AjustesLlamadas, type CuadernoNativo, type LlamadaAnotada, setCuadernoNativoForTests } from "@/native/cuaderno";
import { activarBurbuja, leerEstado, mostrarNumero, normalizarNumero, textoDeLlamada } from "@/private/llamadas";
import { titleFor } from "@/private/rows";
import { emergencyWipe } from "@/security/wipe";
import { queue } from "@/services";
import { configStore, DEFAULT_CONFIG } from "@/state/config";
import { lock, sessionStore, unlock } from "@/state/session";

jest.setTimeout(30_000);

const AJUSTES_VACIOS: AjustesLlamadas = { activo: false, modo: "desconocidos", accion: "sonar", marcados: [], burbuja: false };

/** Módulo nativo falso: guarda en memoria lo que guardaría el Kotlin. */
function fakeNativo(
  init: {
    rol?: boolean;
    disponible?: boolean;
    ajustes?: Partial<AjustesLlamadas>;
    llamadas?: LlamadaAnotada[];
    burbujaDisponible?: boolean;
    permisoBurbuja?: boolean;
    /** Lo que hace la persona en el ajuste de Android "Mostrar sobre otras apps". */
    daPermisoBurbuja?: boolean;
  } = {},
) {
  const state = {
    rol: init.rol ?? false,
    ajustes: { ...AJUSTES_VACIOS, ...init.ajustes } as AjustesLlamadas,
    llamadas: [...(init.llamadas ?? [])],
    permisoBurbuja: init.permisoBurbuja ?? false,
  };
  const n: CuadernoNativo = {
    llamadasDisponible: jest.fn(() => init.disponible ?? true),
    rolActivo: jest.fn(() => state.rol),
    pedirRol: jest.fn(async () => {
      // Durante el diálogo de Android la app pasa a segundo plano: no debe bloquear.
      expect(sessionStore.get().externalUntil).toBeGreaterThan(Date.now());
      state.rol = true;
      return true;
    }),
    leerAjustes: jest.fn(() => ({ ...state.ajustes, marcados: [...state.ajustes.marcados] })),
    guardarAjustes: jest.fn((a: AjustesLlamadas) => void (state.ajustes = { ...a })),
    listarLlamadas: jest.fn(() => [...state.llamadas]),
    borrarLlamadas: jest.fn((ids: string[]) => void (state.llamadas = state.llamadas.filter((l) => !ids.includes(l.id)))),
    borrarTodo: jest.fn(() => {
      state.llamadas = [];
      state.ajustes = { ...AJUSTES_VACIOS };
    }),
    abrirAjustesDelTelefono: jest.fn(),
    burbujaDisponible: jest.fn(() => init.burbujaDisponible ?? true),
    burbujaPermitida: jest.fn(() => state.permisoBurbuja),
    pedirPermisoBurbuja: jest.fn(async () => {
      // El ajuste de Android también pasa la app a segundo plano.
      expect(sessionStore.get().externalUntil).toBeGreaterThan(Date.now());
      state.permisoBurbuja = init.daPermisoBurbuja ?? true;
      return state.permisoBurbuja;
    }),
    actualizarWidget: jest.fn(),
  };
  return { n, state };
}

const AYER_14_32 = new Date(2026, 9, 28, 14, 32).getTime();
const llamada = (id: string, numero: string | null, extra: Partial<LlamadaAnotada> = {}): LlamadaAnotada => ({
  id,
  numero,
  recibida: AYER_14_32,
  marcado: false,
  accion: "sonar",
  durante: false,
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  configStore.reset({ ...DEFAULT_CONFIG, onboarded: true });
  unlock("real");
});

afterAll(() => setCuadernoNativoForTests(null));

describe("números", () => {
  it("normaliza sin código de país ni ceros, igual que el Kotlin", () => {
    expect(normalizarNumero("+51 987 654 321")).toBe("987654321");
    expect(normalizarNumero("987654321")).toBe("987654321");
    expect(normalizarNumero("0051987654321")).toBe("987654321");
    expect(normalizarNumero("(01) 234-5678")).toBe("12345678");
    expect(normalizarNumero("+5112345678")).toBe("12345678");
    expect(normalizarNumero("123")).toBeNull();
    expect(normalizarNumero(null)).toBeNull();
  });

  it("se muestra como se lee en Perú y el oculto dice que es oculto", () => {
    expect(mostrarNumero("+51987654321")).toBe("987 654 321");
    expect(mostrarNumero("012345678")).toBe("(01) 234 5678");
    expect(mostrarNumero(null)).toBe("Número oculto");
  });

  it("la nota de la denuncia lleva la hora, el número con +51 y lo que la persona escribió", () => {
    const t = textoDeLlamada(llamada("a", "+51987654321", { accion: "silenciar" }), "  Pidieron S/ 500 por Yape (ficticio) ");
    expect(t).toContain("28 oct 2026, 2:32 p. m.");
    expect(t).toContain("+51 987 654 321");
    expect(t).toContain("La marqué como extorsión.");
    expect(t).toContain("entró en silencio");
    expect(t).toContain("Lo que me dijeron: Pidieron S/ 500 por Yape (ficticio)");
    expect(textoDeLlamada(llamada("b", null), "")).toContain("desde un número oculto");
  });

  it("si la anotó con la burbuja, la nota lo dice", () => {
    expect(textoDeLlamada(llamada("a", "+51987654321", { durante: true }), "")).toContain("La anoté en el momento, durante la llamada.");
    expect(textoDeLlamada(llamada("b", "+51987654321"), "")).not.toContain("durante la llamada");
  });

  it("en la lista, las notas de llamadas se llaman así", () => {
    expect(titleFor("texto", null, "llamada")).toBe("Llamada");
    expect(titleFor("audio", 65_000, "llamada")).toBe("Grabación de llamada de 1:05");
    expect(titleFor("texto", null, "pegado")).toBe("Mensaje de texto");
  });
});

describe("pantalla Llamadas", () => {
  it("sin el módulo (iOS o build viejo) dice que el celular no lo permite y enseña a grabar", async () => {
    setCuadernoNativoForTests(null);
    await render(<Llamadas />);
    expect(screen.getByText("Tu celular no permite anotar llamadas")).toBeTruthy();
    expect(screen.getByText("Para grabar la voz")).toBeTruthy();
    expect(screen.queryByTestId("activar-llamadas")).toBeNull();
  });

  it("apagado: explica lo que hace y lo que no antes de pedir el permiso de Android", async () => {
    const { n, state } = fakeNativo();
    setCuadernoNativoForTests(n);
    await render(<Llamadas />);
    expect(screen.getByText("Anota las llamadas de números que no conoces")).toBeTruthy();
    expect(screen.getByText(/No graba la voz/)).toBeTruthy();
    expect(screen.getByText(/Ese nombre se verá en los ajustes del teléfono/)).toBeTruthy();
    expect(screen.getByText(/se borran solas a los 30 días/)).toBeTruthy();
    expect(n.pedirRol).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId("activar-llamadas"));
    await waitFor(() => expect(screen.getByTestId("chip-llamadas")).toBeTruthy());
    expect(n.pedirRol).toHaveBeenCalledTimes(1);
    expect(state.ajustes.activo).toBe(true);
    // Arranca sin silenciar ni rechazar nada.
    expect(state.ajustes.accion).toBe("sonar");
    expect(screen.getByTestId("llamadas-vacio")).toBeTruthy();
  });

  it("si la persona quitó a Cuaderno en los ajustes del teléfono, lo dice y deja activarlo otra vez", async () => {
    const { n } = fakeNativo({ rol: false, ajustes: { activo: true } });
    setCuadernoNativoForTests(n);
    await render(<Llamadas />);
    expect(screen.getByTestId("rol-perdido")).toBeTruthy();
    expect(screen.getByTestId("activar-llamadas")).toBeTruthy();
  });

  it("'No era' borra la llamada del celular sin subir nada", async () => {
    const { n, state } = fakeNativo({ rol: true, ajustes: { activo: true }, llamadas: [llamada("a", "+51987654321"), llamada("b", null)] });
    setCuadernoNativoForTests(n);
    const antes = (await queue.list()).length;
    await render(<Llamadas />);
    expect(screen.getByText("987 654 321")).toBeTruthy();
    expect(screen.getByText("Número oculto")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText("Número oculto: no era extorsión, borrar"));
    await waitFor(() => expect(screen.queryByText("Número oculto")).toBeNull());
    expect(state.llamadas.map((l) => l.id)).toEqual(["a"]);
    expect((await queue.list()).length).toBe(antes);
  });

  it("'Fue extorsión' guarda la nota y la grabación en la denuncia y marca el número", async () => {
    const { n, state } = fakeNativo({ rol: true, ajustes: { activo: true }, llamadas: [llamada("a", "+51987654321")] });
    setCuadernoNativoForTests(n);
    await render(<Llamadas />);

    await fireEvent.press(screen.getByLabelText("987 654 321: fue extorsión"));
    await fireEvent.changeText(screen.getByTestId("comentario"), "Dijeron que eran de Los X (ficticio)");
    await fireEvent.press(screen.getByTestId("adjuntar-grabacion"));
    await waitFor(() => expect(screen.getByText("Grabación: llamada.m4a")).toBeTruthy());
    await fireEvent.press(screen.getByTestId("guardar-llamada"));
    await waitFor(() => expect(screen.getByText("Guardada en tu denuncia. El número quedó marcado.")).toBeTruthy());

    const items = (await queue.list()).filter((q) => q.source === "llamada");
    expect(items.map((q) => q.tipo).sort()).toEqual(["audio", "texto"]);
    // La hora de la llamada, no la de ahora.
    for (const q of items) expect(q.captured_at).toBe(new Date(AYER_14_32).toISOString());
    expect(items.find((q) => q.tipo === "texto")!.preview).toContain("+51 987 654 321");
    expect(state.ajustes.marcados).toEqual(["987654321"]);
    expect(state.llamadas).toEqual([]);
    await act(async () => undefined);
    expect(screen.getByText("987 654 321")).toBeTruthy(); // ahora en "Números que marcaste"
  });

  it("la persona elige qué anotar, qué hacer con los marcados y marca números a mano", async () => {
    const { n, state } = fakeNativo({ rol: true, ajustes: { activo: true } });
    setCuadernoNativoForTests(n);
    await render(<Llamadas />);

    await fireEvent.press(screen.getByLabelText("Solo las marcadas"));
    expect(state.ajustes.modo).toBe("marcados");
    await fireEvent.press(screen.getByLabelText("Silenciar"));
    expect(state.ajustes.accion).toBe("silenciar");
    await waitFor(() => expect(screen.getByText("Entra sin sonar y queda en tus llamadas perdidas.")).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId("nuevo-numero"), "12");
    await fireEvent.press(screen.getByTestId("marcar-numero"));
    await waitFor(() => expect(screen.getByText(/Escribe el número completo/)).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId("nuevo-numero"), "+51 912 345 678");
    await fireEvent.press(screen.getByTestId("marcar-numero"));
    await waitFor(() => expect(state.ajustes.marcados).toEqual(["912345678"]));

    await fireEvent.press(screen.getByLabelText("Quitar 912 345 678"));
    await waitFor(() => expect(state.ajustes.marcados).toEqual([]));
  });
});

describe("burbuja durante la llamada", () => {
  it("se enciende solo si la persona da el permiso de Android, y se puede quitar", async () => {
    const { n, state } = fakeNativo({ rol: true, ajustes: { activo: true } });
    setCuadernoNativoForTests(n);
    await render(<Llamadas />);
    expect(screen.getByText("Durante la llamada")).toBeTruthy();
    expect(screen.getByText(/ese permiso se ve en los ajustes del teléfono/)).toBeTruthy();
    expect(screen.getByText(/El botón no graba la voz/)).toBeTruthy();
    expect(n.pedirPermisoBurbuja).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId("activar-burbuja"));
    await waitFor(() => expect(screen.getByTestId("apagar-burbuja")).toBeTruthy());
    expect(n.pedirPermisoBurbuja).toHaveBeenCalledTimes(1);
    expect(state.ajustes.burbuja).toBe(true);
    expect(screen.getByText(/Verás el botón del cuaderno/)).toBeTruthy();

    await fireEvent.press(screen.getByTestId("apagar-burbuja"));
    await waitFor(() => expect(screen.getByTestId("activar-burbuja")).toBeTruthy());
    expect(state.ajustes.burbuja).toBe(false);
    // El filtro sigue encendido: solo se quitó el botón.
    expect(state.ajustes.activo).toBe(true);
  });

  it("si la persona no da el permiso, no se enciende", async () => {
    const { n, state } = fakeNativo({ rol: true, ajustes: { activo: true }, daPermisoBurbuja: false });
    setCuadernoNativoForTests(n);
    await render(<Llamadas />);
    await fireEvent.press(screen.getByTestId("activar-burbuja"));
    await waitFor(() => expect(screen.getByText(/No se dio el permiso/)).toBeTruthy());
    expect(state.ajustes.burbuja).toBe(false);
  });

  it("si ya tenía el permiso, no vuelve a abrir los ajustes de Android", async () => {
    const { n, state } = fakeNativo({ rol: true, ajustes: { activo: true }, permisoBurbuja: true });
    setCuadernoNativoForTests(n);
    await render(<Llamadas />);
    await fireEvent.press(screen.getByTestId("activar-burbuja"));
    await waitFor(() => expect(state.ajustes.burbuja).toBe(true));
    expect(n.pedirPermisoBurbuja).not.toHaveBeenCalled();
  });

  it("si la persona quitó el permiso en Ajustes, lo dice y deja darlo otra vez", async () => {
    const { n } = fakeNativo({ rol: true, ajustes: { activo: true, burbuja: true }, permisoBurbuja: false });
    setCuadernoNativoForTests(n);
    await render(<Llamadas />);
    expect(screen.getByTestId("burbuja-sin-permiso")).toBeTruthy();
    expect(screen.getByText("Dar el permiso otra vez")).toBeTruthy();
  });

  it("en un celular que no lo permite (Android Go) no se ofrece", async () => {
    const { n } = fakeNativo({ rol: true, ajustes: { activo: true }, burbujaDisponible: false });
    setCuadernoNativoForTests(n);
    await render(<Llamadas />);
    expect(screen.queryByTestId("burbuja")).toBeNull();
  });

  it("la llamada anotada con la burbuja se reconoce en la lista", async () => {
    const { n } = fakeNativo({ rol: true, ajustes: { activo: true }, llamadas: [llamada("a", "+51987654321", { durante: true }), llamada("b", null)] });
    setCuadernoNativoForTests(n);
    await render(<Llamadas />);
    expect(screen.getAllByTestId("anotada-durante")).toHaveLength(1);
    expect(within(screen.getByTestId("llamada-a")).getByText("La anotaste durante la llamada")).toBeTruthy();
  });

  it("en modo señuelo no se ofrece ni se pide nada", async () => {
    const { n } = fakeNativo({ rol: true, ajustes: { activo: true, burbuja: true }, permisoBurbuja: true });
    setCuadernoNativoForTests(n);
    lock();
    unlock("decoy");
    expect(leerEstado().burbuja).toEqual({ disponible: false, permitida: false });
    expect(await activarBurbuja()).toBe(false);
    expect(n.burbujaPermitida).not.toHaveBeenCalled();
  });
});

describe("notas privadas y seguridad", () => {
  it("las notas avisan cuántas llamadas esperan revisión", async () => {
    const { n } = fakeNativo({ rol: true, ajustes: { activo: true }, llamadas: [llamada("a", "+51987654321"), llamada("b", null)] });
    setCuadernoNativoForTests(n);
    await render(<NotasPrivadas />);
    await waitFor(() => expect(screen.getByText("2 llamadas por revisar")).toBeTruthy());
    expect(screen.getByTestId("ir-llamadas")).toBeTruthy();
  });

  it("en modo señuelo no hay llamadas: ni el botón, ni el aviso, ni se lee el registro", async () => {
    const { n } = fakeNativo({ rol: true, ajustes: { activo: true }, llamadas: [llamada("a", "+51987654321")] });
    setCuadernoNativoForTests(n);
    lock();
    unlock("decoy");
    await render(<NotasPrivadas />);
    expect(screen.queryByTestId("ir-llamadas")).toBeNull();
    expect(screen.queryByTestId("aviso-llamadas")).toBeNull();
    expect(leerEstado().llamadas).toEqual([]);
    expect(n.listarLlamadas).not.toHaveBeenCalled();
  });

  it("el borrado de emergencia apaga el filtro y la burbuja y borra las llamadas y los números marcados", async () => {
    const { n, state } = fakeNativo({
      rol: true,
      ajustes: { activo: true, burbuja: true, marcados: ["987654321"] },
      llamadas: [llamada("a", "+51987654321")],
      permisoBurbuja: true,
    });
    setCuadernoNativoForTests(n);
    await emergencyWipe();
    expect(n.borrarTodo).toHaveBeenCalledTimes(1);
    expect(state.ajustes.activo).toBe(false);
    expect(state.ajustes.burbuja).toBe(false);
    expect(state.ajustes.marcados).toEqual([]);
    expect(state.llamadas).toEqual([]);
  });

  it("el widget sigue al disfraz elegido", async () => {
    const { n } = fakeNativo();
    setCuadernoNativoForTests(n);
    const { updateConfig } = require("@/state/config") as typeof import("@/state/config");
    await updateConfig({ disguise: "lista" });
    expect(n.actualizarWidget).toHaveBeenCalledWith("lista");
  });
});
