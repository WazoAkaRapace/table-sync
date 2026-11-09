/**
 * Allows a page to override the app Nav header's title and back action.
 * Pages call useHeaderOverride(title, onBack) to set a custom header;
 * the Nav component reads it via useHeaderState().
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

interface HeaderAction {
  label: string; // desktop label
  short: ReactNode; // mobile label (usually an icon)
  to: string;
}

interface HeaderOverride {
  title: string;
  onBack: (() => void) | null; // null = use default nav back; function = custom back
  action?: HeaderAction | null; // extra link rendered in the header's right side
}

interface HeaderState {
  override: HeaderOverride | null;
  setOverride: (override: HeaderOverride | null) => void;
}

const HeaderContext = createContext<HeaderState>({
  override: null,
  setOverride: () => {},
});

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [override, setOverride] = useState<HeaderOverride | null>(null);
  const setOverrideStable = useCallback((o: HeaderOverride | null) => setOverride(o), []);
  return (
    <HeaderContext.Provider value={{ override, setOverride: setOverrideStable }}>
      {children}
    </HeaderContext.Provider>
  );
}

/** Read the current header override (used by Nav). */
export function useHeaderState(): HeaderState {
  return useContext(HeaderContext);
}

/**
 * Set a header override while the component is mounted (or while title/onBack change).
 * Clears the override on unmount.
 */
export function useHeaderOverride(
  title: string,
  onBack: (() => void) | null,
  action?: HeaderAction | null,
) {
  const { setOverride } = useContext(HeaderContext);
  useEffect(() => {
    setOverride({ title, onBack, action });
    return () => setOverride(null);
  }, [setOverride, title, onBack, action]);
}
