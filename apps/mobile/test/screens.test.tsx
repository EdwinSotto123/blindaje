/**
 * Render de humo de todas las pantallas privadas y del onboarding, con los módulos nativos
 * simulados y el servidor simulado detrás del cliente real. Sustituye a correr la app mientras el
 * emulador no está disponible: atrapa errores de render, textos faltantes y reglas de producto.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true, canDismiss: () => true, dismissAll: jest.fn() };
let mockParams: Record<string, string> = {};

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
  const { BlindajeApi } = require("@/api/client") as typeof import("@/api/client");
  const { createMockServer } = require("@/api/mock") as typeof import("@/api/mock");
  const { EvidenceQueue, MemoryBlobStore, MemoryQueueRepo } = require("@/sync/queue") as typeof import("@/sync/queue");
  const server = createMockServer({ processMs: 0 });
  let auth: import("@/api/client").AuthState | null = null;
  const authStore = { get: async () => auth, set: async (a: typeof auth) => void (auth = a), clear: async () => void (auth = null) };
  const api = new BlindajeApi({ baseUrl: "https://mock.local", fetcher: server.fetcher, auth: authStore as never, sign: async () => "firma" });
  let caseId: string | null = null;
  const key = new Uint8Array(32).fill(7);
  const ensureCase = async () => {
    if (!caseId) caseId = (await api.createCase({ consent_mode: "solo_denuncia" })).id;
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
import Codigo from "@/app/bienvenida/codigo";
import Pin from "@/app/bienvenida/pin";
import Senuelo from "@/app/bienvenida/senuelo";
import Disfraz from "@/app/bienvenida/disfraz";
import Voz from "@/app/bienvenida/voz";
import Consentimiento from "@/app/bienvenida/consentimiento";
import Listo from "@/app/bienvenida/listo";
import { utf8 } from "@/lib/bytes";
import { privateStore, refreshReport, saveBytes } from "@/private/data";
import { api, currentCaseId } from "@/services";
import { configStore, DEFAULT_CONFIG } from "@/state/config";
import { lock, unlock } from "@/state/session";

jest.setTimeout(30_000);

beforeAll(async () => {
  configStore.reset({ ...DEFAULT_CONFIG, onboarded: true });
  await api.registerDevice("BODEGA-2026", { kty: "EC", crv: "P-256", x: "x", y: "y" }, "android");
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
    expect(screen.getByText("Sumar mi caso a la red de mi gremio")).toBeTruthy();
    expect(screen.getByTestId("consentimiento").props.value).toBe(false);
    expect(screen.getByText("Cronología")).toBeTruthy();
    expect(screen.getAllByText(/^SHA-256 [0-9a-f]{64}$/).length).toBeGreaterThan(0);
    expect(await currentCaseId()).toBeTruthy();
  });

  it("Avisos del proveedor: solo las alertas aprobadas, dentro de la app", async () => {
    await render(<Avisos />);
    await waitFor(() => expect(screen.getByText("Audios que dicen ser de “Los X”")).toBeTruthy());
    expect(screen.getByText(/Nunca te llegará como notificación/)).toBeTruthy();
  });

  it("Ajustes: disfraz, entradas, PIN, consentimiento y borrado", async () => {
    await render(<Ajustes />);
    for (const t of ["Cómo se ve la app", "Cómo entras aquí", "Cambiar PIN", "Tu consentimiento", "Borrar todo de este celular", "Borrar mi caso de la nube"]) {
      expect(screen.getAllByText(t).length).toBeGreaterThan(0);
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

  it("Ajustes no muestra el PIN ni el caso", async () => {
    await render(<Ajustes />);
    expect(screen.queryByText("Cambiar PIN")).toBeNull();
    expect(screen.queryByText("Borrar mi caso de la nube")).toBeNull();
  });
});

describe("Onboarding", () => {
  beforeAll(() => {
    lock();
    configStore.reset({ ...DEFAULT_CONFIG, onboarded: false });
  });

  it.each([
    ["Bienvenida", Bienvenida, "Un lugar seguro para guardar lo que recibes"],
    ["Código", Codigo, "Tu código de invitación"],
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

  it("un código inválido muestra un error claro", async () => {
    await render(<Codigo />);
    await fireEvent.changeText(screen.getByTestId("campo-codigo"), "NOVALE-1");
    await fireEvent.press(screen.getByTestId("continuar"));
    await waitFor(() => expect(screen.getByText(/no es válido o ya venció/)).toBeTruthy());
  });
});
