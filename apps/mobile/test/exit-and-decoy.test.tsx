import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const mockRouter = {
  canDismiss: jest.fn(() => true),
  dismissAll: jest.fn(),
  replace: jest.fn(),
  push: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};

jest.mock("expo-router", () => {
  const React = require("react") as typeof import("react");
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]),
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
  };
});

import { setDisguiseRepo } from "@/disguise/provider";
import { MemoryDisguiseRepo } from "@/disguise/repo";
import { VueltoCalculator } from "@/disguise/VueltoCalculator";
import { PrivateScreen } from "@/private/PrivateScreen";
import { savePins, tryAccess } from "@/security/access";
import { quickExit } from "@/security/quickExit";
import { configStore, DEFAULT_CONFIG } from "@/state/config";
import { expectExternal, lock, sessionStore, shouldLockOnBackground, unlock } from "@/state/session";
import { Text } from "react-native";

beforeEach(() => {
  jest.clearAllMocks();
  lock();
  setDisguiseRepo(new MemoryDisguiseRepo());
});

describe("Salir rápido", () => {
  it("bloquea, limpia la pila y vuelve al disfraz", () => {
    unlock("real");
    quickExit(mockRouter);
    expect(sessionStore.get().mode).toBe("locked");
    expect(mockRouter.dismissAll).toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith("/");
  });

  it("está en las pantallas privadas y al tocarlo el contenido desaparece", async () => {
    unlock("real");
    await render(
      <PrivateScreen title="Notas privadas">
        <Text>contenido privado</Text>
      </PrivateScreen>,
    );
    expect(screen.getByText("contenido privado")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Salir rápido"));
    expect(sessionStore.get().mode).toBe("locked");
    expect(mockRouter.replace).toHaveBeenCalledWith("/");
    expect(screen.queryByText("contenido privado")).toBeNull();
  });

  it("queda fijo arriba: no se va con el desplazamiento del contenido", async () => {
    unlock("real");
    await render(
      <PrivateScreen title="Denuncia lista">
        <Text>contenido largo</Text>
      </PrivateScreen>,
    );
    const insideScroll = (el: { type: unknown; parent: unknown } | null): boolean => {
      for (let n = el; n; n = n.parent as typeof el) {
        if (typeof n.type === "string" && /ScrollView/.test(n.type)) return true;
      }
      return false;
    };
    expect(insideScroll(screen.getByText("contenido largo") as never)).toBe(true);
    expect(insideScroll(screen.getByTestId("salir-rapido") as never)).toBe(false);
  });

  it("si se llega a una pantalla privada sin sesión, no muestra nada y vuelve al disfraz", async () => {
    await render(
      <PrivateScreen title="Notas privadas">
        <Text>contenido privado</Text>
      </PrivateScreen>,
    );
    expect(screen.queryByText("contenido privado")).toBeNull();
    expect(mockRouter.replace).toHaveBeenCalledWith("/");
  });

  it("al pasar a segundo plano bloquea, salvo cuando la app abrió el selector de fotos", () => {
    unlock("real");
    expect(shouldLockOnBackground()).toBe(true);
    expectExternal(60_000);
    expect(shouldLockOnBackground()).toBe(false);
    expect(shouldLockOnBackground(Date.now() + 61_000)).toBe(true);
    lock();
    expect(shouldLockOnBackground()).toBe(false);
  });
});

describe("PIN y PIN señuelo en la calculadora", () => {
  beforeAll(async () => {
    configStore.reset({ ...DEFAULT_CONFIG, onboarded: true });
    await savePins("4826", "1357");
  });

  it("tryAccess distingue real, señuelo y error", async () => {
    expect(await tryAccess("4826")).toBe("real");
    expect(await tryAccess("1357")).toBe("decoy");
    expect(await tryAccess("0000")).toBeNull();
  });

  it("sin configurar, cualquier código abre la configuración", async () => {
    configStore.reset({ ...DEFAULT_CONFIG, onboarded: false });
    expect(await tryAccess("1234")).toBe("onboarding");
    configStore.reset({ ...DEFAULT_CONFIG, onboarded: true });
  });

  const typeDigits = async (d: string) => {
    for (const k of d) await fireEvent.press(screen.getByTestId(`tecla-${k}`));
  };

  it("el PIN señuelo abre las notas señuelo", async () => {
    const onAccess = jest.fn();
    await render(<VueltoCalculator initialTotalCents={1818} armed tryAccess={tryAccess} onAccess={onAccess} />);
    await typeDigits("1357");
    await fireEvent.press(screen.getByTestId("tecla-calcular"));
    await waitFor(() => expect(onAccess).toHaveBeenCalledWith("decoy"));
  });

  it("el PIN real abre las notas reales", async () => {
    const onAccess = jest.fn();
    await render(<VueltoCalculator initialTotalCents={1818} armed tryAccess={tryAccess} onAccess={onAccess} />);
    await typeDigits("4826");
    await fireEvent.press(screen.getByTestId("tecla-calcular"));
    await waitFor(() => expect(onAccess).toHaveBeenCalledWith("real"));
  });

  it("un intento fallido no muestra nada raro: solo el vuelto", async () => {
    const onAccess = jest.fn();
    await render(<VueltoCalculator initialTotalCents={1818} armed tryAccess={tryAccess} onAccess={onAccess} />);
    await typeDigits("2000");
    await fireEvent.press(screen.getByTestId("tecla-calcular"));
    await waitFor(() => expect(screen.getByTestId("resultado")).toBeTruthy());
    expect(screen.getByTestId("resultado").props.children).toBe("S/ 1,981.82");
    expect(onAccess).not.toHaveBeenCalled();
    expect(screen.queryByText(/PIN|incorrecto|error/i)).toBeNull();
  });

  it("un PIN tecleado tras la entrada secreta nunca queda en el historial de vueltos", async () => {
    const repo = new MemoryDisguiseRepo();
    setDisguiseRepo(repo);
    const onAccess = jest.fn();
    await render(<VueltoCalculator initialTotalCents={1818} armed tryAccess={async () => null} onAccess={onAccess} />);
    await typeDigits("4826");
    await fireEvent.press(screen.getByTestId("tecla-calcular"));
    await waitFor(() => expect(screen.getByTestId("resultado")).toBeTruthy());
    expect(await repo.vueltos()).toHaveLength(0);
  });

  it("la calculadora común sí guarda sus vueltos", async () => {
    const repo = new MemoryDisguiseRepo();
    setDisguiseRepo(repo);
    await render(<VueltoCalculator initialTotalCents={1250} armed={false} tryAccess={tryAccess} onAccess={jest.fn()} />);
    await typeDigits("20");
    await fireEvent.press(screen.getByTestId("tecla-calcular"));
    await waitFor(() => expect(screen.getByTestId("resultado")).toBeTruthy());
    expect(await repo.vueltos()).toHaveLength(1);
  });

  it("sin entrada secreta (calculadora abierta desde el menú) el PIN no abre nada", async () => {
    const onAccess = jest.fn();
    const spy = jest.fn(tryAccess);
    await render(<VueltoCalculator initialTotalCents={1818} armed={false} tryAccess={spy} onAccess={onAccess} />);
    await typeDigits("4826");
    await fireEvent.press(screen.getByTestId("tecla-calcular"));
    await waitFor(() => expect(screen.getByTestId("resultado")).toBeTruthy());
    expect(spy).not.toHaveBeenCalled();
    expect(onAccess).not.toHaveBeenCalled();
  });
});
