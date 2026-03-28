import { createRoot } from "react-dom/client";
import "./index.css";
import { hasRequiredBackendConfig } from "@/lib/backendConfig";

type ThemeMode = "light" | "dark";

const THEME_KEY = "he-theme";
const DEFAULT_THEME: ThemeMode = "light";

const getInitialTheme = (): ThemeMode => {
  try {
    const storedTheme = localStorage.getItem(THEME_KEY);
    if (storedTheme === "light" || storedTheme === "dark") return storedTheme;
    if (storedTheme !== null) localStorage.removeItem(THEME_KEY);
  } catch (error) {
    console.warn("[theme] Failed to read localStorage, using default theme.", error);
  }

  return DEFAULT_THEME;
};

const applyTheme = (theme: ThemeMode) => {
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(theme);
  document.documentElement.style.colorScheme = theme;
};

applyTheme(getInitialTheme());

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

const root = createRoot(rootElement);

const renderBootError = (message: string) => {
  root.render(
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-10 text-foreground">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 shadow-lg">
        <p className="text-sm font-medium text-muted-foreground">Arranque da aplicação</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Não foi possível carregar a app</h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">{message}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    </div>,
  );
};

if (!hasRequiredBackendConfig) {
  renderBootError(
    "A configuração de arranque do backend não está disponível neste build. Publique/atualize o projeto novamente para gerar um novo build com a configuração correta.",
  );
} else {
  import("./App.tsx")
    .then(({ default: App }) => {
      root.render(<App />);
    })
    .catch((error) => {
      console.error("[boot] Failed to load app bundle", error);
      renderBootError("Ocorreu um erro ao iniciar a interface. Atualize a página para tentar novamente.");
    });
}
