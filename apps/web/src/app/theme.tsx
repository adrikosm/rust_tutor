import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export const THEME_STORAGE_KEY = "rust-tutor:theme:v2";

const LIGHT_THEME_COLOR = "#f4efe2";
const DARK_THEME_COLOR = "#101813";

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function isThemePreference(value: string | null | undefined): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolvedTheme = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolvedTheme;

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  themeColor?.setAttribute(
    "content",
    resolvedTheme === "dark" ? DARK_THEME_COLOR : LIGHT_THEME_COLOR,
  );
  return resolvedTheme;
}

function readBootstrappedPreference(): ThemePreference {
  const fromDocument = document.documentElement.dataset.themePreference;
  if (isThemePreference(fromDocument)) return fromDocument;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "light";
  } catch {
    return "light";
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("light");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const initialPreference = readBootstrappedPreference();
    setPreferenceState(initialPreference);
    setResolvedTheme(applyTheme(initialPreference));
    setInitialized(true);
  }, []);

  useEffect(() => {
    if (!initialized) return;

    setResolvedTheme(applyTheme(preference));
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // The theme still works for this session when storage is unavailable.
    }

    if (preference !== "system") return;
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = () => setResolvedTheme(applyTheme("system"));
    colorScheme.addEventListener("change", handleSystemChange);
    return () => colorScheme.removeEventListener("change", handleSystemChange);
  }, [initialized, preference]);

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    setPreferenceState(nextPreference);
  }, []);

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("useTheme must be used inside ThemeProvider.");
  return theme;
}

export function ThemeControl({ compact = false }: { compact?: boolean }) {
  const { preference, setPreference } = useTheme();
  return (
    <fieldset
      className="theme-control"
      data-compact={compact || undefined}
      aria-label="Color theme"
    >
      {(["light", "dark", "system"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={preference === option}
          data-theme-option={option}
          onClick={() => setPreference(option)}
        >
          {option[0]?.toUpperCase()}
          {option.slice(1)}
        </button>
      ))}
    </fieldset>
  );
}

export const themeBootstrapScript = `(() => {
  const key = "${THEME_STORAGE_KEY}";
  const valid = new Set(["light", "dark", "system"]);
  let preference = "light";
  try {
    const stored = localStorage.getItem(key);
    if (valid.has(stored)) preference = stored;
  } catch {}
  const systemDark = matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = preference === "system" ? (systemDark ? "dark" : "light") : preference;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = resolved === "dark" ? "${DARK_THEME_COLOR}" : "${LIGHT_THEME_COLOR}";
})();`;
