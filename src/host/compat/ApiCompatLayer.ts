import type { Context } from '@deepseek-ai/cordis';
import type { HostVersionInfo } from './HostVersionDetector.ts';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('host:compat');

export interface ToolNameMapping {
  codegraphStatus: string;
  codegraphGraph: string;
  codegraphQuery: string;
  codegraphFiles: string;
  codegraphImpact: string;
  codegraphInit: string;
  codegraphSync: string;
  codegraphCallers: string;
  codegraphCallees: string;
  codegraphBootstrap: string | null;
  codegraphIncremental: string | null;
  lensAnalyze: string;
  lensImpact: string;
}

const GEN1_MAPPING: ToolNameMapping = {
  codegraphStatus: 'codegraph_status',
  codegraphGraph: 'codegraph_graph',
  codegraphQuery: 'codegraph_query',
  codegraphFiles: 'codegraph_files',
  codegraphImpact: 'codegraph_impact',
  codegraphInit: 'codegraph_init',
  codegraphSync: 'codegraph_sync',
  codegraphCallers: 'codegraph_callers',
  codegraphCallees: 'codegraph_callees',
  codegraphBootstrap: null,
  codegraphIncremental: null,
  lensAnalyze: 'lens_analyze',
  lensImpact: 'lens_impact',
};

const GEN2_MAPPING: ToolNameMapping = {
  ...GEN1_MAPPING,
  codegraphBootstrap: 'codegraph_bootstrap',
  codegraphIncremental: 'codegraph_incremental',
};

export function createToolNameMapping(info: HostVersionInfo): ToolNameMapping {
  if (info.generation === 'gen1') return GEN1_MAPPING;
  return GEN2_MAPPING;
}

export interface ApiCompatLayer {
  versionInfo: HostVersionInfo;
  toolNames: ToolNameMapping;
  resolveToolName(key: keyof ToolNameMapping): string | null;
  isToolAvailable(ctx: Context, key: keyof ToolNameMapping): boolean;
  getAvailableToolName(ctx: Context, key: keyof ToolNameMapping): string | null;
}

export function createApiCompatLayer(info: HostVersionInfo): ApiCompatLayer {
  const toolNames = createToolNameMapping(info);

  const resolveToolName = (key: keyof ToolNameMapping): string | null => {
    return toolNames[key];
  };

  const isToolAvailable = (ctx: Context, key: keyof ToolNameMapping): boolean => {
    const name = resolveToolName(key);
    if (!name) return false;
    try {
      return !!ctx.tools.get(name);
    } catch {
      return false;
    }
  };

  const getAvailableToolName = (ctx: Context, key: keyof ToolNameMapping): string | null => {
    const primary = resolveToolName(key);
    if (primary && isToolAvailable(ctx, key)) return primary;
    const fallbacks = FALLBACK_CHAINS[key] ?? [];
    for (const fb of fallbacks) {
      const fbName = resolveToolName(fb);
      if (fbName) {
        try {
          if (ctx.tools.get(fbName)) {
            log.info('tool name fallback', { key, primary, fallback: fbName });
            return fbName;
          }
        } catch { /* ignore */ }
      }
    }
    return null;
  };

  return { versionInfo: info, toolNames, resolveToolName, isToolAvailable, getAvailableToolName };
}

const FALLBACK_CHAINS: Partial<Record<keyof ToolNameMapping, (keyof ToolNameMapping)[]>> = {
  codegraphStatus: ['codegraphGraph', 'codegraphQuery'],
  codegraphGraph: ['codegraphStatus', 'codegraphQuery'],
  codegraphQuery: ['codegraphStatus', 'codegraphGraph'],
  codegraphBootstrap: ['codegraphInit'],
  codegraphIncremental: ['codegraphSync', 'codegraphInit'],
};