import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { onIdTokenChanged, signOut, getRedirectResult } from "firebase/auth";
import { auth } from "./firebase/config";
import { LOGIN_REDIRECT_FLAG } from "./utils/loginRedirectState";

jest.mock("firebase/auth", () => ({
  onIdTokenChanged: jest.fn(),
  signOut: jest.fn(),
  getRedirectResult: jest.fn(),
}));

jest.mock("./firebase/config", () => ({
  auth: { _mock: "auth" },
  environmentLabel: "PRODUCCION",
  isLocalTestMode: false,
}));

jest.mock("./components/Login", () => function LoginMock() {
  return <div>Login Mock</div>;
});

jest.mock("./components/ExerciseForm", () => function ExerciseFormMock() {
  return <div>ExerciseForm Mock</div>;
});

jest.mock("./components/ExerciseChart", () => function ExerciseChartMock() {
  return <div>ExerciseChart Mock</div>;
});

jest.mock("./components/HistoryViewer", () => function HistoryViewerMock() {
  return <div>HistoryViewer Mock</div>;
});

jest.mock("./components/KpiViewer", () => function KpiViewerMock() {
  return <div>KpiViewer Mock</div>;
});

jest.mock("./components/PlanDay", () => function PlanDayMock() {
  return <div>PlanDay Mock</div>;
});

jest.mock("./components/DangerZone", () => function DangerZoneMock() {
  return <div>DangerZone Mock</div>;
});

const setupAuth = (user) => {
  onIdTokenChanged.mockImplementation((_firebaseAuth, callback) => {
    callback(user);
    return () => {};
  });
};

describe("App", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    getRedirectResult.mockResolvedValue(null);
  });

  test("muestra login cuando no hay sesión", async () => {
    setupAuth(null);

    render(<App />);

    expect(await screen.findByText("Login Mock")).toBeInTheDocument();
  });

  test("muestra la vista principal para usuario autenticado", async () => {
    setupAuth({ uid: "u1", displayName: "Jesus", getIdTokenResult: jest.fn().mockResolvedValue({ claims: {} }) });

    render(<App />);

    expect(await screen.findByText("ExerciseForm Mock")).toBeInTheDocument();
    expect(screen.getByText(/¡Vamos/i)).toBeInTheDocument();
    expect(screen.getByText("Jesus")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cerrar sesión/i })).toBeInTheDocument();
  });

  test("usa un nombre corto derivado del email cuando no hay displayName", async () => {
    setupAuth({ uid: "u1", email: "jesus.rodriguez@gmail.com", getIdTokenResult: jest.fn().mockResolvedValue({ claims: {} }) });

    render(<App />);

    expect(await screen.findByText("ExerciseForm Mock")).toBeInTheDocument();
    expect(screen.getByText("jesus")).toBeInTheDocument();
  });

  test("permite cambiar entre vistas desde navegación", async () => {
    setupAuth({ uid: "u1", displayName: "Jesus", getIdTokenResult: jest.fn().mockResolvedValue({ claims: {} }) });

    render(<App />);
    await screen.findByText("ExerciseForm Mock");

    await userEvent.click(screen.getByRole("button", { name: /Progresión/i }));
    expect(screen.getByText("ExerciseChart Mock")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Diario/i }));
    expect(screen.getByText("HistoryViewer Mock")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /KPIs/i }));
    expect(screen.getByText("KpiViewer Mock")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Registro/i }));
    expect(screen.getByText("ExerciseForm Mock")).toBeInTheDocument();
  });

  test("cierra sesión al pulsar el botón", async () => {
    setupAuth({ uid: "u1", displayName: "Jesus", getIdTokenResult: jest.fn().mockResolvedValue({ claims: {} }) });

    render(<App />);
    await screen.findByText("ExerciseForm Mock");

    await userEvent.click(screen.getByRole("button", { name: /Cerrar sesión/i }));
    expect(signOut).toHaveBeenCalledWith(auth);
  });

  test("mantiene la carga mientras procesa un redirect reciente y limpia el flag", async () => {
    let authCallback;
    onIdTokenChanged.mockImplementation((_firebaseAuth, callback) => {
      authCallback = callback;
      return () => {};
    });
    localStorage.setItem(LOGIN_REDIRECT_FLAG, JSON.stringify({ ts: Date.now() }));

    render(<App />);

    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(getRedirectResult).toHaveBeenCalledWith(auth);

    await act(async () => {
      authCallback({ uid: "u1", displayName: "Jesus", getIdTokenResult: jest.fn().mockResolvedValue({ claims: {} }) });
      await Promise.resolve();
    });

    expect(await screen.findByText("ExerciseForm Mock")).toBeInTheDocument();
    expect(localStorage.getItem(LOGIN_REDIRECT_FLAG)).toBeNull();
  });
});
