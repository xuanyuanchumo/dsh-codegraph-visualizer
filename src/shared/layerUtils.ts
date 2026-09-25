const LAYER_PATTERNS: Array<{ pattern: RegExp; layer: string }> = [
  { pattern: /\/(controller|controllers|api|routes|endpoints?|handlers?)\//i, layer: 'controller' },
  { pattern: /\/(service|services|business|domain|logic|usecase|usecases)\//i, layer: 'service' },
  { pattern: /\/(model|models|entity|entities|repository|repositories|dao|data|store|stores)\//i, layer: 'data' },
  { pattern: /\/(view|views|component|components|ui|page|pages|screen|screens|template|templates|widget|widgets)\//i, layer: 'presentation' },
  { pattern: /\/(util|utils|helper|helpers|common|shared|lib|libs)\//i, layer: 'utility' },
  { pattern: /\/(config|configs|conf|settings)\//i, layer: 'config' },
  { pattern: /\/(test|tests|spec|specs|__tests__)\//i, layer: 'test' },
  { pattern: /\/(middleware|middlewares|interceptor|interceptors|filter|filters)\//i, layer: 'middleware' },
  { pattern: /\/(adapter|adapters|gateway|gateways)\//i, layer: 'adapter' },
  { pattern: /\/(hook|hooks|plugin|plugins)\//i, layer: 'extension' },
  { pattern: /\/(type|types|interface|interfaces|typedef|typedefs)\//i, layer: 'type' },
  { pattern: /\/(style|styles|css|asset|assets|static|public)\//i, layer: 'asset' },
  { pattern: /\/(auth|security|permission|permissions)\//i, layer: 'security' },
  { pattern: /\/(db|database|migration|migrations|schema|schemas)\//i, layer: 'database' },
];

export function inferLayerFromPath(filePath: string): string {
  for (const { pattern, layer } of LAYER_PATTERNS) {
    if (pattern.test(filePath)) return layer;
  }
  const segments = filePath.split(/[\\/]/).filter(Boolean);
  if (segments.length >= 2) {
    const topDir = (segments[0] === 'src' || segments[0] === 'app' || segments[0] === 'lib')
      ? (segments[1] ?? segments[0] ?? 'core')
      : (segments[0] ?? 'core');
    return topDir.toLowerCase();
  }
  return 'core';
}

export const LAYER_COLORS: Record<string, { dark: string; light: string }> = {
  controller: { dark: '#60a5fa', light: '#3b82f6' },
  service: { dark: '#10b981', light: '#059669' },
  data: { dark: '#f59e0b', light: '#d97706' },
  presentation: { dark: '#ec4899', light: '#db2777' },
  utility: { dark: '#818cf8', light: '#6366f1' },
  config: { dark: '#a78bfa', light: '#7c3aed' },
  test: { dark: '#34d399', light: '#14b8a6' },
  middleware: { dark: '#fbbf24', light: '#eab308' },
  adapter: { dark: '#22d3ee', light: '#06b6d4' },
  extension: { dark: '#f472b6', light: '#ec4899' },
  type: { dark: '#a78bfa', light: '#7c3aed' },
  asset: { dark: '#fb7185', light: '#f43f5e' },
  security: { dark: '#ef4444', light: '#dc2626' },
  database: { dark: '#84cc16', light: '#65a30d' },
  core: { dark: '#6366f1', light: '#4f46e5' },
};

export function getLayerColor(layer: string, isDark: boolean): string {
  const colors = LAYER_COLORS[layer];
  if (colors) return isDark ? colors.dark : colors.light;
  const fallbackLayers = Object.values(LAYER_COLORS);
  const idx = layer.charCodeAt(0) % fallbackLayers.length;
  const fallback = fallbackLayers[idx] ?? { dark: '#6366f1', light: '#4f46e5' };
  return fallback[isDark ? 'dark' : 'light'];
}