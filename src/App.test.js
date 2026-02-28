import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { onAuthStateChanged, signOut, getRedirectResult } from "firebase/auth";
import { auth } from "./firebase/config";

jest.mock("firebase/auth", () => ({
  onAuthStateChanged: jest.fn(),
  signOut: jest.fn(),
  getRedirectResult: jest.fn(),
}));

jest.mock("./firebase/config", () => ({
  auth: { _mock: "auth" },
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

jest.mock("./components/PlanDay", () => function PlanDayMock() {
  return <div>PlanDay Mock</div>;
});

jest.mock("./components/DangerZone", () => function DangerZoneMock() {
  return <div>DangerZone Mock</div>;
});

const setupAuth = (user) => {
  onAuthStateChanged.mockImplementation((_firebaseAuth, callback) => {
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
    setupAuth({ uid: "u1", displayName: "Jesus" });

    render(<App />);

    expect(await screen.findByText("ExerciseForm Mock")).toBeInTheDocument();
    expect(screen.getByText(/Bienvenido/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cerrar sesión/i })).toBeInTheDocument();
  });

  test("permite cambiar entre vistas desde navegación", async () => {
    setupAuth({ uid: "u1", displayName: "Jesus" });

    render(<App />);
    await screen.findByText("ExerciseForm Mock");

    await userEvent.click(screen.getByRole("button", { name: /Progresión/i }));
    expect(screen.getByText("ExerciseChart Mock")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Diario/i }));
    expect(screen.getByText("HistoryViewer Mock")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Registro/i }));
    expect(screen.getByText("ExerciseForm Mock")).toBeInTheDocument();
  });

  test("cierra sesión al pulsar el botón", async () => {
    setupAuth({ uid: "u1", displayName: "Jesus" });

    render(<App />);
    await screen.findByText("ExerciseForm Mock");

    await userEvent.click(screen.getByRole("button", { name: /Cerrar sesión/i }));
    expect(signOut).toHaveBeenCalledWith(auth);
  });
});
