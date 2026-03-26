import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

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

createRoot(document.getElementById("root")!).render(<App />);
