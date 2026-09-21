import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  getActivePaletteName,
  setActivePalette,
  type ThemePaletteName,
} from '../constants/theme';
import { storage } from '../i18n/storage';

const STORAGE_KEY = 'safepay.contrastTheme';

interface ContrastThemeValue {
  palette: ThemePaletteName;
  setPalette: (name: ThemePaletteName) => void;
}

const ContrastThemeContext = createContext<ContrastThemeValue>({
  palette: 'soft',
  setPalette: () => undefined,
});

/**
 * Owns the user's contrast choice. Both palettes are WCAG AA audited; the user
 * picks which one their eyes prefer, not which one is legible.
 */
export function ContrastThemeProvider({ children }: { children: ReactNode }) {
  const [palette, setPaletteState] = useState<ThemePaletteName>(getActivePaletteName());

  // Apply during render (idempotent) so the first paint already uses the
  // selected palette rather than flashing the default one.
  setActivePalette(palette);

  useEffect(() => {
    let cancelled = false;
    void storage.getItem(STORAGE_KEY).then((stored) => {
      if (cancelled || (stored !== 'soft' && stored !== 'crisp')) return;
      setActivePalette(stored);
      setPaletteState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPalette = useCallback((next: ThemePaletteName) => {
    setActivePalette(next);
    setPaletteState(next);
    void storage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo(() => ({ palette, setPalette }), [palette, setPalette]);

  return <ContrastThemeContext.Provider value={value}>{children}</ContrastThemeContext.Provider>;
}

export function useContrastTheme(): ContrastThemeValue {
  return useContext(ContrastThemeContext);
}
