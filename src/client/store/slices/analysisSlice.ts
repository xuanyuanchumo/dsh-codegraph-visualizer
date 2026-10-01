import type { HealthScore, RuleDefinition, RuleViolation } from '../../../types/index.ts';
import type { DeadCodeResult } from '../../../shared/analysis/DeadCodeAnalyzer.ts';
import type { GraphState } from '../types.ts';
import { UI } from '../../../shared/constants.ts';
import { t } from '../../i18n/index.ts';
import { fetchWithTimeout } from '../../api/index.ts';
import { assembleMicroDiagram } from '../../diagram/index.ts';
import { computeClusteredGraph } from '../cluster/index.ts';
import { callChainAggregator, internals, log, measureSync } from '../internals.ts';

type SetFn = (partial: Partial<GraphState>) => void;
type GetFn = () => GraphState;

export function createAnalysisSlice(_set: SetFn, _get: GetFn): Partial<GraphState> {
  return {
    healthScore: null,
    rules: [],
    ruleViolations: [],
    deadCodeResult: null,
    deadCodeModeActive: false,
    selectedFunction: null,
    setHealthScore: (score: HealthScore | null) => _set({ healthScore: score }),
    setRules: (rules: RuleDefinition[]) => _set({ rules }),
    setRuleViolations: (violations: RuleViolation[]) => _set({ ruleViolations: violations }),
    setDeadCodeResult: (result: DeadCodeResult | null) => _set({ deadCodeResult: result }),
    setDeadCodeModeActive: (active: boolean) => _set({ deadCodeModeActive: active }),
    setSelectedFunction: (fn: { nodeId: string; filePath: string; functionName: string } | null) => _set({ selectedFunction: fn }),
    assembleMultiFunction: async (entryNodeId: string) => {
      const { rawNodes, rawEdges, callChainDepth, clusterDepth, expandedNodeIds } = _get();
      const gen = ++internals.multiAssemblyGeneration;
      const astFetcher = async (filePath: string) => {
        try {
          const response = await fetchWithTimeout('/api/v1/codegraph/ast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath }),
          });
          if (!response.ok) return null;
          return await response.json();
        } catch (e) {
          log.warn('AST fetch failed', e);
          return null;
        }
      };
      try {
        const result = await callChainAggregator.aggregate(
          entryNodeId, rawNodes, rawEdges, astFetcher,
          { depth: callChainDepth, maxFunctions: UI.MAX_FUNCTIONS_PER_CLUSTER },
        );
        if (gen !== internals.multiAssemblyGeneration) return;
        if (result && result.diagram.nodes.length > 0) {
          const clustered = measureSync('diagram', () => computeClusteredGraph(result.diagram.nodes, result.diagram.edges, 'progressive', expandedNodeIds, clusterDepth, _get().panelWidth ?? undefined));
          _set({
            diagramData: null,
            nodes: clustered.nodes,
            edges: clustered.edges,
            viewMode: 'cfg',
            error: null,
          });
        } else {
          _set({ error: t('error.callChainEmpty'), isLoading: false });
        }
      } catch (e) {
        log.warn('assembleMultiFunction failed', e);
        _set({ error: t('error.callChainFailed'), isLoading: false });
      }
    },
    assembleMicro: async (viewMode: 'cfg' | 'flowchart' | 'sequence', selectedFunctionOverride?: { nodeId: string; filePath: string; functionName: string } | null) => {
      const selectedFunction = selectedFunctionOverride ?? _get().selectedFunction;
      if (!selectedFunction) return;
      const gen = ++internals.microAssemblyGeneration;
      _set({ isLoading: true, error: null });
      try {
        const diagram = await assembleMicroDiagram(viewMode, selectedFunction.filePath, selectedFunction.functionName);
        if (gen !== internals.microAssemblyGeneration) return;
        _set({ diagramData: null, nodes: diagram.nodes, edges: diagram.edges, isLoading: false });
      } catch (e) {
        if (gen !== internals.microAssemblyGeneration) return;
        const msg = e instanceof Error ? e.message : String(e);
        _set({ isLoading: false, error: `${msg} — ${selectedFunction.functionName}` });
      }
    },
  };
}