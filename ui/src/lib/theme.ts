import { useCallback, useEffect, useState } from 'react';
import { KEY_THEME, readLS, writeLS } from './storage.ts';

export type ThemeMode = 'auto' | 'light' | 'dark';

function readMode(): ThemeMode {
  const v = readLS(KEY_THEME);
  return v === 'light' || v === 'dark' ? v : 'auto';
}

function systemDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(mode: ThemeMode): 'light' | 'dark' {
  const resolved = mode === 'auto' ? (systemDark() ? 'dark' : 'light') : mode;
  document.documentElement.setAttribute('data-theme', resolved);
  return resolved;
}

export function useTheme(): { mode: ThemeMode; resolved: 'light' | 'dark'; cycle: () => void } {
  const [mode, setMode] = useState<ThemeMode>(readMode);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => apply(readMode()));

  useEffect(() => {
    setResolved(apply(mode));
    if (mode !== 'auto' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(apply('auto'));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  const cycle = useCallback(() => {
    setMode((m) => {
      const next: ThemeMode = m === 'auto' ? 'light' : m === 'light' ? 'dark' : 'auto';
      writeLS(KEY_THEME, next);
      return next;
    });
  }, []);

  return { mode, resolved, cycle };
}
