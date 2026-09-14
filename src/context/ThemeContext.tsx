import React, { createContext, useContext, useEffect, useState } from 'react';
import { safeStorage } from '../utils/storage';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    // For mobile screen (< 640px), default to Dark theme
    if (typeof window !== 'undefined' && window.innerWidth < 640) {
      return 'dark';
    }

    // Check saved local storage theme
    const saved = safeStorage.getItem('plsms_theme');
    if (saved === 'dark' || saved === 'light') {
      return saved;
    }
    // Check system preference if available
    try {
      if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    } catch {
      // ignore
    }
    return 'light';
  });

  // Ensure mobile screen defaults to dark theme on resize or initial load
  useEffect(() => {
    const handleMobileCheck = () => {
      if (typeof window !== 'undefined' && window.innerWidth < 640) {
        const saved = safeStorage.getItem('plsms_theme');
        // If on mobile screen without explicit user override, ensure dark
        if (saved !== 'light') {
          setThemeState('dark');
        }
      }
    };
    handleMobileCheck();
    window.addEventListener('resize', handleMobileCheck);
    return () => window.removeEventListener('resize', handleMobileCheck);
  }, []);

  useEffect(() => {
    try {
      if (typeof document !== 'undefined') {
        const root = document.documentElement;
        const body = document.body;

        if (theme === 'dark') {
          root.classList.add('dark');
          root.classList.remove('light');
          root.setAttribute('data-theme', 'dark');
          root.style.colorScheme = 'dark';
          body?.classList.add('dark-theme');
          body?.classList.remove('light-theme');
        } else {
          root.classList.remove('dark');
          root.classList.add('light');
          root.setAttribute('data-theme', 'light');
          root.style.colorScheme = 'light';
          body?.classList.add('light-theme');
          body?.classList.remove('dark-theme');
        }
      }
    } catch {
      // ignore DOM manipulation errors
    }

    safeStorage.setItem('plsms_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        isDark: theme === 'dark',
        toggleTheme,
        setTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
