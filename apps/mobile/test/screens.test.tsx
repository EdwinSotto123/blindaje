/**
 * Render de humo de todas las pantallas privadas y del onboarding, con los módulos nativos
 * simulados y el servidor simulado detrás del cliente real. Sustituye a correr la app mientras el
 * emulador no está disponible: atrapa errores de render, textos faltantes y reglas de producto.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true, canDismiss: () => true, dismissAll: jest.fn() };
let mockParams: Record<string, string> = {};
/** Conexión del servidor simulado: en false, cada petición falla como sin internet. */
let mockOnline = true;

jest.mock("expo-router", () => {
  const React = require("react") as typeof import("react");
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]),
    useLocalSearchParams: () => mockParams,
    Redirect: () => null,
  };
});

jest.mock("@/services", () => {
  const { BlindajeApi, caseRequestFrom } = require("@/api/client") as typeof import("@/api/client");
  const { createMockServer } = require("@/api/mock") as typeof import("@/api/mock");
  const { EvidenceQueue, MemoryBlobStore, MemoryQueueRepo } = require("@/sync/queue") as typeof import("@/sync/queue");
  const server = createMockServer({ processMs: 0, isOnline: () => mockOnline });
  let auth: import("@/api/client").AuthState | null = null;
  const authStore = { get: async () => auth, set: async (a: typeof auth) => void (auth = a), clear: async () => void (auth = null) };
  // Como en la app: sin sesión, la primera llamada registra el celular (sin código).
  const api = new BlindajeApi({
    baseUrl: "https://mock.local",
    fetcher: server.fetcher,
    auth: authStore as never,
    sign: async () => "firma",
    device: async () => ({ publicKey: { kty: "EC", crv: "P-256", x: "x", y: "y" }, platform: "android" }),
    autoRegister: () => (require("@/state/config") as typeof import("@/state/config")).configStore.get().onboarded,
  });
  let caseId: string | null = null;
  const key = new Uint8Array(32).fill(7);
  // Como ensureCase de src/services.ts: consentimiento, rubro e id del distrito de la configuración.
  const ensureCase = async () => {
    const { configStore } = require("@/state/config") as typeof import("@/state/config");
    if (!caseId) caseId = (await api.createCase(caseRequestFrom(configStore.get()))).id;
    return caseId;
  };
  const queue = new EvidenceQueue({
    repo: new MemoryQueueRepo(),
    blobs: new MemoryBlobStore(),
    key: async () => key,
    uploader: {
      upload: async (i, body) =>
        api.uploadEvidence(await ensureCase(), body, { tipo: i.tipo, mime: i.mime, sha256: i.sha256, source: i.source, durationMs: i.duration_ms }),
    },
  });
  return {
    api,
    queue,
    authStore,
    mockServer: server,
    platform: "android",
    isOnline: async () => true,
    ensureCase,
    currentCaseId: async () => caseId,
    forgetCase: async () => void (caseId = null),
  };
});

jest.mock("@/storage/db", () => {
  const rows: { id: number; tipo: string; preview: string | null; duration_ms: number | null; created_at: number }[] = [];
  const db = {
    getAllAsync: async () => [...rows],
    runAsync: async (_sql: string, tipo: string, preview: string | null, duration_ms: number | null, created_at: number) => {
      rows.push({ id: rows.length + 1, tipo, preview, duration_ms, created_at });
      return { changes: 1, lastInsertRowId: rows.length };
    },
  };
  return { privateDb: async () => db, deletePrivateDb: async () => undefined, getMeta: async () => null, setMeta: async () => undefined };
});

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
      return new Uint8Array([1, 2, 3]);
    }
    delete() {}
    create() {}
    async write() {}
  },
}));

jest.mock("expo-audio", () => ({
  RecordingPresets: { HIGH_QUALITY: {} },
  useAudioRecorder: () => ({ isRecording: false, uri: null, getStatus: () => ({ durationMillis: 0 }), stop: async () => undefined, prepareToRecordAsync: async () => undefined, record: () => undefined }),
  useAudioRecorderState: () => ({ isRecording: false, durationMillis: 0, metering: -60 }),
  requestRecordingPermissionsAsync: async () => ({ granted: true }),
  getRecordingPermissionsAsync: async () => ({ granted: true }),
  setAudioModeAsync: async () => undefined,
}));

jest.mock("expo-camera", () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true }, async () => ({ granted: true })],
}));
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: async () => ({ canceled: true, assets: [] }) }));
jest.mock("expo-clipboard", () => ({ getStringAsync: async () => "Si no yapeas S/ 2,000 en 48 horas (ficticio)", setStringAsync: async () => undefined }));
jest.mock("expo-sharing", () => ({ shareAsync: async () => undefined }));

import Ajustes from "@/app/privado/ajustes";
import Avisos from "@/app/privado/avisos";
import Denuncia from "@/app/privado/denuncia";
import Foto from "@/app/privado/foto";
import Grabar from "@/app/privado/grabar";
import NotasPrivadas from "@/app/privado/index";
import DenunciaLista from "@/app/privado/lista";
import Nota from "@/app/privado/nota";
import Pegar from "@/app/privado/pegar";
import Recibido from "@/app/privado/recibido";
import Bienvenida from "@/app/bienvenida/index";
import Pin from "@/app/bienvenida/pin";
import Senuelo from "@/app/bienvenida/senuelo";
import Disfraz from "@/app/bienvenida/disfraz";
import Voz from "@/app/bienvenida/voz";
import Consentimiento from "@/app/bienvenida/consentimiento";
import Listo from "@/app/bienvenida/listo";
import { StyleSheet } from "react-native";

import { ApiError } from "@/api/http";
import type { createMockServer } from "@/api/mock";
import { utf8 } from "@/lib/bytes";
import { draftStore, finishOnboarding } from "@/onboarding/draft";
import { privateStore, refreshReport, saveBytes } from "@/private/data";
import * as services from "@/services";
import { api, authStore, currentCaseId, forgetCase, queue } from "@/services";
import { CENTRAL_ORG_ID } from "@/shared";
import { configStore, DEFAULT_CONFIG } from "@/state/config";
import { lock, unlock } from "@/state/session";
import { colors } from "@/theme/tokens";

jest.setTimeout(30_000);

/** El servidor simulado que está detrás del cliente de @/services (ver el mock de arriba). */
const server = (services as unknown as { mockServer: ReturnType<typeof createMockServer> }).mockServer;

beforeAll(async () => {
  configStore.reset({ ...DEFAULT_CONFIG, onboarded: true });
  await api.registerDevice({ kty: "EC", crv: "P-256", x: "x", y: "y" }, "android");
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
});

describe("Pantallas privadas (modo real)", () => {
  beforeEach(() => unlock("real"));

  it("Notas privadas: chip honesto, acciones, Salir rápido y lo que encontramos", async () => {
    await saveBytes(utf8("Si no yapeas S/ 2,000 en 48 horas, somos de Los X. (ficticio)"), { tipo: "texto", mime: "text/plain", source: "pegado", preview: "Si no yapeas" });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    await refreshReport();
    await render(<NotasPrivadas />);
    expect(screen.getByText("Notas privadas")).toBeTruthy();
    expect(screen.getByLabelText("Salir rápido")).toBeTruthy();
    for (const a of ["Grabar", "Foto", "Pegar mensaje", "Preparar mi denuncia", "Avisos del proveedor"]) expect(screen.getAllByText(a).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText("Pide pago por Yape")).toBeTruthy());
    expect(screen.getByText("Guardado cifrado, fuera de este celular")).toBeTruthy();
    expect(screen.getByText("Mensaje de texto")).toBeTruthy();
    // Nunca dice "solo en este celular": D1, todo vive en la nube.
    expect(screen.queryByText(/solo en este celular/i)).toBeNull();
    // 105 y 1818 a mano desde las notas, no solo después de preparar la denuncia.
    expect(screen.getByLabelText("Llamar al 105, emergencias")).toBeTruthy();
    expect(screen.getByLabelText("Llamar a la Línea 1818, denuncias")).toBeTruthy();
  });

  it("Nota: transcripción y huella SHA-256", async () => {
    const r = privateStore.get().report!;
    mockParams = { id: r.evidencia[0]!.id };
    await render(<Nota />);
    expect(screen.getByText("Huella de integridad (SHA-256)")).toBeTruthy();
    expect(screen.getByText(r.evidencia[0]!.sha256)).toBeTruthy();
  });

  it("Grabar: botón grande de mantener presionado", async () => {
    await render(<Grabar />);
    expect(screen.getByLabelText("Grabar")).toBeTruthy();
    expect(screen.getByText("Mantén presionado")).toBeTruthy();
    expect(screen.getByText("0:00")).toBeTruthy();
  });

  it("Foto: cámara de la app y aviso de que no va a la galería", async () => {
    await render(<Foto />);
    expect(screen.getByLabelText("Tomar foto")).toBeTruthy();
    expect(screen.getByText("La foto no se guarda en tu galería.")).toBeTruthy();
  });

  it("Pegar mensaje: pega del portapapeles y guarda cifrado", async () => {
    await render(<Pegar />);
    await fireEvent.press(screen.getByText("Pegar lo que copiaste"));
    await waitFor(() => expect(screen.getByDisplayValue(/yapeas/)).toBeTruthy());
    await fireEvent.press(screen.getByText("Guardar mensaje"));
    await waitFor(() => expect(screen.getByTestId("estado-subida")).toBeTruthy());
  });

  it("Recibido: archivos compartidos retenidos hasta aceptarlos", async () => {
    await saveBytes(utf8("audio compartido ficticio"), { tipo: "audio", mime: "audio/ogg", source: "compartido", hold: true, durationMs: 18000 });
    await render(<Recibido />);
    await waitFor(() => expect(screen.getByText("Guardar en mis notas")).toBeTruthy());
    expect(screen.getByText("Audio de 0:18")).toBeTruthy();
  });

  it("Preparar mi denuncia: 4 pasos hasta enviar", async () => {
    await render(<Denuncia />);
    expect(screen.getByText("Paso 1 de 4")).toBeTruthy();
    expect(screen.getByText("Guarda lo que recibiste")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("siguiente"));
    expect(screen.getByText("Cuéntanos qué pasó")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("relato"), "Me escribieron el 3 de octubre. (ficticio)");
    await fireEvent.press(screen.getByTestId("siguiente"));
    expect(screen.getByText("Revisa tu denuncia")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("enviar"));
    await waitFor(() => expect(screen.getByText("Decide a dónde llevarla")).toBeTruthy());
    expect(screen.getByText("Si estás en peligro ahora, llama al 105")).toBeTruthy();
  });

  it("Denuncia lista: resumen, 105 siempre visible, comunitario apagado, PDF y 1818", async () => {
    await new Promise((r) => setTimeout(r, 1600));
    await refreshReport();
    await render(<DenunciaLista />);
    await waitFor(() => expect(screen.getByText(/Lista · caso/)).toBeTruthy());
    expect(screen.getByText("Si estás en peligro ahora, llama al 105")).toBeTruthy();
    expect(screen.getByText("Llamar a la Línea 1818")).toBeTruthy();
    expect(screen.getByText("Descargar para la comisaría")).toBeTruthy();
    expect(screen.getByText("Sumar mi caso al modo comunitario")).toBeTruthy();
    // Nada promete visitas ni menciona gremios.
    expect(screen.queryByText(/gremio|asociación|en persona/i)).toBeNull();
    // Honesto: en modo comunitario una persona autorizada puede escuchar partes de los audios.
    expect(screen.getByText(/puede escuchar partes de tus audios/)).toBeTruthy();
    expect(screen.queryByText(/Nadie ve tus audios/)).toBeNull();
    expect(screen.getByTestId("consentimiento").props.value).toBe(false);
    expect(screen.getByText("Cronología")).toBeTruthy();
    expect(screen.getAllByText(/^SHA-256 [0-9a-f]{64}$/).length).toBeGreaterThan(0);
    expect(await currentCaseId()).toBeTruthy();
    // Consejos de prevención según su propio caso, sin ocultar lo demás.
    expect(screen.getByText("Consejos para ti")).toBeTruthy();
    expect(screen.getByText(/No hagas ningún pago por Yape/)).toBeTruthy();
    expect(screen.getByText(/El plazo de 48 horas es para presionarte/)).toBeTruthy();
    expect(screen.getByText("Resumen")).toBeTruthy();
  });

  it("Denuncia lista: sin consejos (API actual) no muestra la sección ni se rompe", async () => {
    const real = api.getReport.bind(api);
    // Sin el campo, el cliente lo lee como [].
    const spy = jest.spyOn(api, "getReport").mockImplementation(async (id) => ({ ...(await real(id)), consejos: [] }));
    try {
      await render(<DenunciaLista />);
      await waitFor(() => expect(screen.queryByText("Consejos para ti")).toBeNull());
      expect(screen.getByText(/Lista · caso/)).toBeTruthy();
      expect(screen.getByText("Resumen")).toBeTruthy();
    } finally {
      spy.mockRestore();
      // Deja el reporte completo (con consejos) para las pruebas que siguen.
      await act(async () => {
        await refreshReport();
      });
    }
  });

  it("Avisos del proveedor: alertas y recomendaciones aprobadas, dentro de la app", async () => {
    await render(<Avisos />);
    await waitFor(() => expect(screen.getByText("Audios que dicen ser de “Los X”")).toBeTruthy());
    expect(screen.getByText(/Nunca te llegará nada como notificación/)).toBeTruthy();
    // Sin distrito elegido, invita a elegirlo. La zona del aviso va con su nombre, no con el id.
    expect(screen.getByText(/Elige tu distrito en Ajustes para ver los avisos de tu zona/)).toBeTruthy();
    expect(screen.getAllByText(/^San Juan de Lurigancho · /).length).toBeGreaterThan(0);
    expect(screen.queryByText(/gremio|asociación/i)).toBeNull();

    // Recomendaciones de la zona, en su propia sección.
    await waitFor(() => expect(screen.getByText("Guarda todo sin responder")).toBeTruthy());
    expect(screen.getByText("Recomendaciones para tu zona")).toBeTruthy();
    expect(screen.getByText("Bodegas · San Juan de Lurigancho")).toBeTruthy();
    expect(screen.getByText(/varias bodegas de San Juan de Lurigancho/)).toBeTruthy();
    expect(screen.getByText(/^Revisada por nuestro equipo el /)).toBeTruthy();
    // Ordenadas por prioridad: alta, media, baja.
    const titulos = screen
      .getAllByText(/^(Guarda todo sin responder|Acuerda con tu personal que nadie negocia ni paga|Cuéntale a alguien de confianza|Reconoce el guion|Cuida lo que publicas)$/)
      .map((t) => t.props.children);
    expect(titulos).toEqual([
      "Guarda todo sin responder",
      "Acuerda con tu personal que nadie negocia ni paga",
      "Cuéntale a alguien de confianza",
      "Reconoce el guion",
      "Cuida lo que publicas",
    ]);
    expect(screen.getByText("Si te pasa")).toBeTruthy();
    expect(screen.getByText("— No respondas, no pagues y no negocies.")).toBeTruthy();
    expect(screen.getByText("Más casos en una zona puede significar que ahí se denuncia más, no que sea más peligrosa.")).toBeTruthy();
    // El riesgo va en palabras y en texto secundario, nunca como alarma roja.
    const riesgo = screen.getByText("Riesgo en tu zona: medio");
    expect(StyleSheet.flatten(riesgo.props.style).color).toBe(colors.lapiz);
    expect(screen.queryByText(/^(alto|medio|bajo|sin_datos)$/)).toBeNull();
    // Siempre a la vista: no pagues ni negocies, 105 y Línea 1818.
    expect(screen.getByText("No pagues ni negocies. Si estás en peligro, llama.")).toBeTruthy();
    expect(screen.getByLabelText("Llamar al 105, emergencias")).toBeTruthy();
    expect(screen.getByLabelText("Llamar a la Línea 1818, denuncias")).toBeTruthy();
  });

  it("Avisos del proveedor: sin recomendaciones (por ejemplo, la ruta da 404) muestra un estado vacío claro", async () => {
    privateStore.set({ recommendations: null, recommendationsState: "idle" });
    const spy = jest.spyOn(api, "recommendations").mockResolvedValueOnce([]);
    try {
      await render(<Avisos />);
      await waitFor(() => expect(screen.getByText(/Todavía no hay recomendaciones para tu zona/)).toBeTruthy());
      expect(screen.queryByText("Guarda todo sin responder")).toBeNull();
      expect(screen.getByText("No pagues ni negocies. Si estás en peligro, llama.")).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it("Avisos del proveedor: si falla, lo dice y deja volver a intentar", async () => {
    privateStore.set({ recommendations: null, recommendationsState: "idle" });
    const spy = jest.spyOn(api, "recommendations").mockRejectedValueOnce(new ApiError(500, "internal", "falló"));
    try {
      await render(<Avisos />);
      await waitFor(() => expect(screen.getByText(/No pudimos cargar las recomendaciones/)).toBeTruthy());
      expect(screen.getByLabelText("Llamar al 105, emergencias")).toBeTruthy();
      await fireEvent.press(screen.getByText("Volver a intentar"));
      await waitFor(() => expect(screen.getByText("Guarda todo sin responder")).toBeTruthy());
    } finally {
      spy.mockRestore();
    }
  });

  it("Avisos del proveedor: con distrito elegido, solo los de su zona", async () => {
    configStore.set({ zona: "san-juan-de-miraflores" });
    privateStore.set({ alerts: null, recommendations: null });
    const spy = jest.spyOn(api, "alerts");
    try {
      await render(<Avisos />);
      await waitFor(() => expect(screen.getByText("Fotos del local enviadas por WhatsApp")).toBeTruthy());
      expect(spy).toHaveBeenCalledWith("san-juan-de-miraflores");
      expect(screen.getByText(/Avisos de San Juan de Miraflores, tu zona\./)).toBeTruthy();
      expect(screen.queryByText(/Audios que dicen ser de/)).toBeNull();
      await waitFor(() => expect(screen.getByText(/Todavía no hay recomendaciones para tu zona/)).toBeTruthy());
    } finally {
      spy.mockRestore();
      configStore.set({ zona: null });
      privateStore.set({ alerts: null, recommendations: null });
    }
  });

  it("Ajustes: disfraz, entradas, PIN, distrito, consentimiento y borrado", async () => {
    await render(<Ajustes />);
    for (const t of ["Cómo se ve la app", "Cómo entras aquí", "Cambiar PIN", "Tu distrito", "Tu consentimiento", "Borrar todo de este celular", "Borrar mi caso de la nube"]) {
      expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    }
    // Solo el seudónimo: ninguna organización ni gremio.
    await waitFor(() => expect(screen.getByText(/^Tu código: V-[0-9A-F]{4}$/)).toBeTruthy());
    expect(screen.queryByText(/gremio|asociación|ficticia|ficticio/i)).toBeNull();
  });

  it("Ajustes: cambiar el distrito vale para los casos nuevos", async () => {
    const antes = await currentCaseId();
    await render(<Ajustes />);
    expect(screen.getByLabelText("Tu distrito: Sin elegir")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("ajustes-distrito"));
    await fireEvent.changeText(screen.getByTestId("ajustes-distrito-buscar"), "comas");
    await fireEvent.press(screen.getByLabelText("Comas"));
    await waitFor(() => expect(configStore.get().zona).toBe("comas"));
    expect(screen.getByLabelText("Tu distrito: Comas")).toBeTruthy();
    expect(screen.getByText("Distrito guardado: Comas.")).toBeTruthy();
    // El caso actual conserva su zona: no hay ruta para cambiarla.
    expect(await currentCaseId()).toBe(antes);
    if (antes) expect(server.debug.cases.get(antes)?.zona).toBeNull();

    await fireEvent.press(screen.getByTestId("ajustes-distrito"));
    await fireEvent.press(screen.getByLabelText("Prefiero no decirlo"));
    await waitFor(() => expect(configStore.get().zona).toBeNull());
    expect(screen.getByLabelText("Tu distrito: Prefiero no decirlo")).toBeTruthy();
  });

  it("al crear un caso nuevo se manda el id del distrito elegido", async () => {
    configStore.set({ zona: "ate", sector: "bodega" });
    await forgetCase();
    const create = jest.spyOn(api, "createCase");
    try {
      await saveBytes(utf8("Mensaje ficticio para el caso nuevo"), { tipo: "texto", mime: "text/plain", source: "pegado" });
      await waitFor(async () => expect(await currentCaseId()).toBeTruthy());
      expect(create).toHaveBeenCalledWith({ consent_mode: "solo_denuncia", sector: "bodega", zona: "ate" });
      expect(server.debug.cases.get((await currentCaseId())!)?.zona).toBe("ate");
    } finally {
      create.mockRestore();
      configStore.set({ zona: null, sector: null });
    }
  });
});

describe("Modo señuelo", () => {
  beforeEach(() => unlock("decoy"));
  afterAll(() => lock());

  it("las notas se ven vacías y creíbles, sin nada del caso real", async () => {
    await render(<NotasPrivadas />);
    expect(screen.getByText("Notas privadas")).toBeTruthy();
    expect(screen.queryByText("Pide pago por Yape")).toBeNull();
    expect(screen.queryByText("Mensaje de texto")).toBeNull();
    expect(screen.getByText("Guardado cifrado, fuera de este celular")).toBeTruthy();
  });

  it("los avisos no piden nada al servidor y se ven vacíos", async () => {
    const spy = jest.spyOn(api, "recommendations");
    configStore.set({ zona: "comas" });
    try {
      await render(<Avisos />);
      // Tampoco muestran el distrito real.
      expect(screen.queryByText(/Comas/)).toBeNull();
      expect(screen.getByText(/^Avisos de tu zona\./)).toBeTruthy();
      await waitFor(() => expect(screen.getByText(/Todavía no hay recomendaciones para tu zona/)).toBeTruthy());
      expect(screen.queryByText("Guarda todo sin responder")).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      configStore.set({ zona: null });
    }
  });

  it("Ajustes no muestra el PIN, el caso ni el distrito", async () => {
    await render(<Ajustes />);
    expect(screen.queryByText("Cambiar PIN")).toBeNull();
    expect(screen.queryByText("Borrar mi caso de la nube")).toBeNull();
    expect(screen.queryByTestId("ajustes-distrito")).toBeNull();
  });
});

describe("Onboarding", () => {
  beforeAll(() => {
    lock();
    configStore.reset({ ...DEFAULT_CONFIG, onboarded: false });
  });

  it.each([
    ["Bienvenida", Bienvenida, "Un lugar seguro para guardar lo que recibes"],
    ["PIN", Pin, "Crea tu PIN"],
    ["Señuelo", Senuelo, "Un PIN señuelo"],
    ["Disfraz", Disfraz, "Cómo se verá la app"],
    ["Voz", Voz, "Una muestra de tu voz"],
    ["Consentimiento", Consentimiento, "Tú decides qué se comparte"],
    ["Listo", Listo, "Listo. Así entras a tus notas"],
  ])("%s", async (_n, Screen, title) => {
    await render(<Screen />);
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByLabelText("Salir rápido")).toBeTruthy();
  });

  it("el modo comunitario arranca apagado", async () => {
    await render(<Consentimiento />);
    expect(screen.getByTestId("modo-comunitario").props.value).toBe(false);
  });

  it("el consentimiento dice quién puede escuchar partes de los audios", async () => {
    await render(<Consentimiento />);
    expect(screen.getByText(/una persona autorizada revisa los casos y puede escuchar partes de tus audios/)).toBeTruthy();
    expect(screen.queryByText(/Nadie ve tus audios/)).toBeNull();
  });

  it("la bienvenida no presenta un solo disfraz como si fuera el único", async () => {
    await render(<Bienvenida />);
    expect(screen.getByText(/una app común de tu negocio, y tú eliges cuál/)).toBeTruthy();
    expect(screen.queryByText(/cuaderno/i)).toBeNull();
  });

  it("seis pasos después de la bienvenida: del PIN a Listo", async () => {
    await render(<Pin />);
    expect(screen.getByLabelText("Paso 1 de 6")).toBeTruthy();
    await render(<Listo />);
    expect(screen.getByLabelText("Paso 6 de 6")).toBeTruthy();
  });

  it("Empezar registra el celular sin código y sigue al PIN", async () => {
    await authStore.clear();
    draftStore.set({ registered: false, pseudonym: null });
    await render(<Bienvenida />);
    // Ya no pide código ni menciona gremios.
    expect(screen.queryByText(/código de invitación|gremio|asociación/i)).toBeNull();
    await fireEvent.press(screen.getByTestId("empezar"));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith("/bienvenida/pin"));
    const auth = await authStore.get();
    expect(auth?.pseudonym).toMatch(/^V-/);
    expect(server.debug.devices.get(auth!.device_id)?.org).toBe(CENTRAL_ORG_ID);
    expect(draftStore.get()).toMatchObject({ registered: true, pseudonym: auth!.pseudonym });

    // Listo muestra solo el seudónimo.
    await render(<Listo />);
    await waitFor(() => expect(screen.getByText(`Tu código: ${auth!.pseudonym}`)).toBeTruthy());
  });

  it("sin internet, Empezar no bloquea y la primera subida registra el celular", async () => {
    await authStore.clear();
    draftStore.set({ registered: false, pseudonym: null });
    mockOnline = false;
    try {
      await render(<Bienvenida />);
      await fireEvent.press(screen.getByTestId("empezar"));
      await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith("/bienvenida/pin"));
      expect(await authStore.get()).toBeNull();
      expect(draftStore.get().registered).toBe(false);

      await render(<Listo />);
      await waitFor(() => expect(screen.getByText(/Todavía no hay conexión/)).toBeTruthy());

      // Termina la configuración. Lo guardado espera conexión: la cola lo deja pendiente.
      configStore.set({ onboarded: true });
      await forgetCase();
      await queue.add({ bytes: utf8("Nota ficticia sin conexión"), tipo: "texto", mime: "text/plain", source: "pegado" });
      expect((await queue.flush()).pending).toBeGreaterThan(0);
      expect(await authStore.get()).toBeNull();
    } finally {
      mockOnline = true;
    }
    try {
      // Vuelve el internet: la primera subida registra el celular, crea el caso y sube.
      const r = await queue.flush(true);
      expect(r.uploaded).toBeGreaterThan(0);
      expect((await authStore.get())?.pseudonym).toMatch(/^V-/);
      expect(await currentCaseId()).toBeTruthy();
    } finally {
      configStore.reset({ ...DEFAULT_CONFIG, onboarded: false });
    }
  });

  it("después de un borrado, una subida que quedó en curso no registra el celular", async () => {
    await authStore.clear();
    configStore.reset({ ...DEFAULT_CONFIG, onboarded: false, wiped: true });
    await forgetCase();
    await queue.add({ bytes: utf8("Nota ficticia en curso"), tipo: "texto", mime: "text/plain", source: "pegado" });
    expect((await queue.flush(true)).uploaded).toBe(0);
    expect(await authStore.get()).toBeNull();
    configStore.reset({ ...DEFAULT_CONFIG, onboarded: false });
  });

  it("el distrito se elige de la lista, con búsqueda, y se guarda como id", async () => {
    draftStore.set({ zona: null });
    await render(<Consentimiento />);
    expect(screen.getByLabelText("Tu distrito (opcional): Sin elegir")).toBeTruthy();
    // Ya no hay texto libre para el distrito.
    expect(screen.queryByPlaceholderText(/San Juan de Miraflores/)).toBeNull();
    await fireEvent.press(screen.getByTestId("distrito"));
    await fireEvent.changeText(screen.getByTestId("distrito-buscar"), "SJL");
    expect(screen.getByText("1 distrito")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("San Juan de Lurigancho"));
    expect(draftStore.get().zona).toBe("san-juan-de-lurigancho");
    expect(screen.getByLabelText("Tu distrito (opcional): San Juan de Lurigancho")).toBeTruthy();

    // Se puede volver atrás: "Prefiero no decirlo" deja la zona vacía.
    await fireEvent.press(screen.getByTestId("distrito"));
    await fireEvent.press(screen.getByLabelText("Prefiero no decirlo"));
    expect(draftStore.get().zona).toBeNull();
    expect(screen.getByLabelText("Tu distrito (opcional): Prefiero no decirlo")).toBeTruthy();
  });

  it("al terminar, el id del distrito queda en la configuración", async () => {
    draftStore.set({ pin: "2580", decoy: null, zona: "villa-el-salvador" });
    await finishOnboarding();
    expect(configStore.get()).toMatchObject({ onboarded: true, zona: "villa-el-salvador" });
    configStore.reset({ ...DEFAULT_CONFIG, onboarded: false });
  });
});
