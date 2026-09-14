import { useEffect } from 'react';
import { useGraphStore, type ThemeType } from '../store/graphStore.ts';
import { invalidateCssVarCache } from '../renderer/styles/ThemeStylesheet.ts';

export function useThemeSync(updateRendererTheme: (theme: ThemeType) => void): void {
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const isDark = document.body.hasAttribute('data-ds-dark-theme');
      const newTheme: ThemeType = isDark ? 'dark' : 'light';
      const current = useGraphStore.getState().theme;
      if (current !== newTheme) {
        invalidateCssVarCache();
        useGraphStore.getState().setTheme(newTheme);
        updateRendererTheme(newTheme);
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
    return () => observer.disconnect();
  }, [updateRendererTheme]);
}