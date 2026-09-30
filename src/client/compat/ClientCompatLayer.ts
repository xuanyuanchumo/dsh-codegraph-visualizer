import type { Context } from '@deepseek-ai/cordis';


export type SidebarIntegrationMode = 'sidebar-right' | 'better-sidebar' | 'slot' | 'floating';

export interface ClientCompatLayer {
  detectMode(ctx: Context): SidebarIntegrationMode;
}

export function createClientCompatLayer(): ClientCompatLayer {
  const detectMode = (ctx: Context): SidebarIntegrationMode => {
    try {
      if (typeof ctx.inject === 'function') {
        return 'sidebar-right';
      }
    } catch { /* ignore */ }
    try {
      const bs = ctx.get('betterSidebar');
      if (bs) return 'better-sidebar';
    } catch { /* ignore */ }
    try {
      if (ctx.slots) return 'slot';
    } catch { /* ignore */ }
    return 'floating';
  };

  return { detectMode };
}