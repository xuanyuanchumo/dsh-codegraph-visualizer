import type { HealthScore, RuleDefinition, RuleViolation } from '../../../types/index.ts';
import type { DeadCodeResult } from '../../../shared/analysis/DeadCodeAnalyzer.ts';
import type { GraphState, DiffState } from '../types.ts';
import { UI } from '../../../shared/constants.ts';
import { t } from '../../i18n/index.ts';
import { fetchAst } from '../../api/index.ts';
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
    diffResult: null,
    selectedFunction: null,
    setHealthScore: (score: HealthScore | null) => _set({ healthScore: score }),
    setRules: (rules: RuleDefinition[]) => _set({ rules }),
    setRuleViolations: (violations: RuleViolation[]) => _set({ ruleViolations: violations }),
    setDeadCodeResult: (result: DeadCodeResult | null) => _set({ deadCodeResult: result }),
    setDeadCodeModeActive: (active: boolean) => _set({ deadCodeModeActive: active }),
    /**
     * 保存一次成功的版本对比（研究报告 §六 #13）。
     *
     * 刻意**不**在这里重算 `index`：调用方拿到的是同一份 `nodes`/`edges`，若这里再算一遍
     * 就是两个真源。`DiffState.index` 由 `useDiffComparison` 用 `buildDiffIndex` 一次算好传入。
     */
    setDiffResult: (result: DiffState | null) => _set({ diffResult: result }),
    /**
     * 清空版本对比。
     *
     * 与 `diffResult` 的写入**成对**存在，且被三处调用：面板关闭、工作区切换、整图替换。
     * 第三处最容易被漏掉——`setGraphData` 会重置 `rawNodes`，而 diff 索引里的 id 是相对
     * 「发起对比时那张图」的；不清空的话，换图后标记会指向一批已经不存在（或语义已变）的元素。
     */
    clearDiffResult: () => {
      if (_get().diffResult === null) return;
      _set({ diffResult: null });
    },
    setSelectedFunction: (fn: { nodeId: string; filePath: string; functionName: string } | null) => _set({ selectedFunction: fn }),
    assembleMultiFunction: async (entryNodeId: string) => {
      const { rawNodes, rawEdges, callChainDepth, clusterDepth, expandedNodeIds } = _get();
      const gen = ++internals.multiAssemblyGeneration;
      const astFetcher = async (filePath: string) => {
        // Carries the selected workspace: the AST route resolves `filePath` against it
        // (§31.7 — otherwise the host picks whichever workspace it lists first).
        return await fetchAst(filePath, undefined, _get().currentWorkspace);
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
        const diagram = await assembleMicroDiagram(viewMode, selectedFunction.filePath, selectedFunction.functionName, _get().currentWorkspace);
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