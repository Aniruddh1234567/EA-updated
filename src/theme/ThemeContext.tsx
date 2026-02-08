/**
 * Application-wide theme context.
 *
 * Provides a `useAppTheme()` hook and a `<ThemeProvider>` wrapper that:
 *  - stores user preference in localStorage
 *  - sets `data-theme` on <html> for CSS selectors
 *  - wraps children in Ant Design <ConfigProvider> with the correct theme algorithm
 */
import React from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import { runtimeEnv } from '@/runtime/runtimeEnv';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type AppTheme = 'light' | 'dark';

interface ThemeContextValue {
  /** Current active theme. */
  theme: AppTheme;
  /** Convenience boolean. */
  isDark: boolean;
  /** Toggle between light ↔ dark. */
  toggleTheme: () => void;
  /** Set a specific theme. */
  setTheme: (t: AppTheme) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STORAGE_KEY = 'ea.theme';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
const ThemeContext = React.createContext<ThemeContextValue>({
  theme: 'light',
  isDark: false,
  toggleTheme: () => {},
  setTheme: () => {},
});

/** Consume the current theme anywhere in the tree. */
export const useAppTheme = () => React.useContext(ThemeContext);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeRaw] = React.useState<AppTheme>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'dark' || stored === 'light') return stored;
    } catch {
      /* SSR / restricted storage */
    }
    return 'light';
  });

  const setTheme = React.useCallback((t: AppTheme) => {
    setThemeRaw(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* best-effort */
    }
  }, []);

  const toggleTheme = React.useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  // Keep data-theme attribute in sync with React state.
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const isDark = theme === 'dark';

  // Compose Ant Design theme algorithms.
  // compactAlgorithm is always active in the desktop (Electron) shell.
  // darkAlgorithm is added when the user picks dark mode.
  const antdThemeConfig = React.useMemo(() => {
    const algorithms: (typeof antdTheme.defaultAlgorithm)[] = [];
    if (runtimeEnv.isDesktop) algorithms.push(antdTheme.compactAlgorithm);
    if (isDark) algorithms.push(antdTheme.darkAlgorithm);
    return { algorithm: algorithms.length > 0 ? algorithms : undefined };
  }, [isDark]);

  const ctxValue = React.useMemo<ThemeContextValue>(
    () => ({ theme, isDark, toggleTheme, setTheme }),
    [theme, isDark, toggleTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={ctxValue}>
      <ConfigProvider theme={antdThemeConfig}>{children}</ConfigProvider>
    </ThemeContext.Provider>
  );
};
