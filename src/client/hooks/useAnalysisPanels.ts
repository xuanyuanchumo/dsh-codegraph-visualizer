import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { HealthScorer } from '../../shared/analysis/HealthScorer.ts';
import { RuleEngine, getPresetRules } from '../../shared/analysis/RuleEngine.ts';
import { HotspotAnalyzer, GodModuleDetector } from '../../shared/analysis/HotspotAnalyzer.ts';
import { CoreFunctionAnalyzer } from '../../shared/analysis/CoreFunctionAnalyzer.ts';
import type { CoreFunction } from '../../shared/analysis/CoreFunctionAnalyzer.ts';
import { DeadCodeAnalyzer } from '../../shared/analysis/DeadCodeAnalyzer.ts';
import type { DeadCodeResult } from '../../shared/analysis/DeadCodeAnalyzer.ts';
import type { ChurnResult } from '../../shared/churn.ts';
import { fetchHotspotChurn } from '../api/index.ts';

export interface HotspotNode {
  nodeId: string;
  label: string;
  filePath: string;
  indegree: number;
  churn: number;
  hotspotScore: number;
  level: string;
}
export interface GodModule { modulePath: string; nodeCount: number; edgeCount: number; suggestion: string; }
export interface ImpactStats { d1: number; d2: number; d3: number; total: number; }

/**
 * 热点面板的「变更频率数据状态」。
 *
 * 刻意把四种状态分开暴露，而不是只给一个 `churnByFile`：
 * - `idle`：还没请求（面板没打开）；
 * - `loading`：请求进行中——此时面板**不能**说「未获取到变更频率」，那是在报一个还没发生的结果；
 * - `unavailable`：宿主答复了但没有 git 数据（不是仓库 / git 未安装 / 超时），面板据此提示；
 * - `ready`：拿到了真实数据（`truncated` 另行说明覆盖范围）。
 */
export interface ChurnStatus {
  state: 'idle' | 'loading' | 'unavailable' | 'ready';
  /** 数据来源的提交（`ready` 时可能有值）。 */
  revision: string | null;
  /** 覆盖的提交数。 */
  commitCount: number;
  /** 是否只覆盖了最近 `CHURN.MAX_COMMITS` 个提交。 */
  truncated: boolean;
  /** 失败原因（`unavailable` 时）。 */
  error: string | null;
}

const IDLE_CHURN: ChurnStatus = { state: 'idle', revision: null, commitCount: 0, truncated: false, error: null };

function toStatus(result: ChurnResult | null): ChurnStatus {
  // `null` = 请求本身失败（网络 / 非 2xx），与「宿主说它也没拿到 git 数据」同样是不可用，
  // 但原因不同，所以 error 文案分开写，便于用户区分「插件没连上宿主」与「这个目录不是 git 仓库」。
  if (result === null) {
    return { state: 'unavailable', revision: null, commitCount: 0, truncated: false, error: 'request failed' };
  }
  if (!result.available) {
    return { state: 'unavailable', revision: result.revision, commitCount: 0, truncated: false, error: result.error };
  }
  return {
    state: 'ready',
    revision: result.revision,
    commitCount: result.commitCount,
    truncated: result.truncated,
    error: null,
  };
}

export function useAnalysisPanels(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  showHealthScore: boolean,
  showRules: boolean,
  showHotspot: boolean,
  showGodModule: boolean,
  showImpact: boolean,
  selectedNodeId: string | null,
  getImpactStats: () => ImpactStats | null,
  showCoreFunction: boolean = false,
  showDeadCode: boolean = false,
  /** 当前工作区；`/churn` 按它寻址（与其它按工作区寻址的接口同形）。 */
  currentWorkspace: string = '.',
) {
  const healthScorer = useMemo(() => new HealthScorer(), []);
  const ruleEngine = useMemo(() => new RuleEngine(), []);
  const hotspotAnalyzer = useMemo(() => new HotspotAnalyzer(), []);
  const godModuleDetector = useMemo(() => new GodModuleDetector(), []);
  const coreFunctionAnalyzer = useMemo(() => new CoreFunctionAnalyzer(), []);
  const deadCodeAnalyzer = useMemo(() => new DeadCodeAnalyzer(), []);

  const setHealthScore = useGraphStore((s) => s.setHealthScore);
  const setRules = useGraphStore((s) => s.setRules);
  const setRuleViolations = useGraphStore((s) => s.setRuleViolations);
  const rules = useGraphStore((s) => s.rules);


  const [hotspotNodes, setHotspotNodes] = useState<HotspotNode[]>([]);
  const [godModules, setGodModules] = useState<GodModule[]>([]);
  const [impactStats, setImpactStats] = useState<ImpactStats | null>(null);
  const [coreFunctions, setCoreFunctions] = useState<CoreFunction[]>([]);
  const [deadCodeResult, setDeadCodeResult] = useState<DeadCodeResult | null>(null);

  /**
   * 变更频率（研究报告 §六 #11）。
   *
   * 只在面板打开时请求：`git log` 在宿主侧是子进程，用户没打开热点面板就不该付出这个成本。
   * 请求本身在宿主侧还有一层短 TTL 缓存，所以「关掉再打开」不会连发 git。
   */
  const [churnByFile, setChurnByFile] = useState<Record<string, number>>({});
  const [churnStatus, setChurnStatus] = useState<ChurnStatus>(IDLE_CHURN);

  useEffect(() => {
    if (!showHotspot) {
      // 面板关闭时回到 idle 并清掉数据：留着会让下次打开先闪一帧上一轮的排序结果。
      setChurnByFile({});
      setChurnStatus(IDLE_CHURN);
      return;
    }
    const controller = new AbortController();
    setChurnStatus((prev) => ({ ...prev, state: 'loading' }));
    fetchHotspotChurn(controller.signal, currentWorkspace)
      .then((result) => {
        if (controller.signal.aborted) return;
        setChurnByFile(result?.available ? result.byFile : {});
        setChurnStatus(toStatus(result));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setChurnByFile({});
        setChurnStatus(toStatus(null));
      });
    return () => controller.abort();
  }, [showHotspot, currentWorkspace]);

  const handleHealthCheck = useCallback(() => {
    const score = healthScorer.calculate(rawNodes, rawEdges);
    setHealthScore(score);
  }, [rawNodes, rawEdges, setHealthScore, healthScorer]);

  const handleRulesCheck = useCallback(() => {
    const violations = ruleEngine.check(rules, rawNodes, rawEdges);
    setRuleViolations(violations);
  }, [rules, rawNodes, rawEdges, setRuleViolations, ruleEngine]);

  useEffect(() => {
    if (showHealthScore && rawNodes.length > 0) {
      handleHealthCheck();
    }
  }, [showHealthScore, rawNodes.length, rawEdges.length, handleHealthCheck]);

  useEffect(() => {
    if (showRules && rules.length === 0) {
      setRules(getPresetRules());
    }
  }, [showRules, rules.length, setRules]);

  useEffect(() => {
    if (showHotspot && rawNodes.length > 0) {
      // 把 churn 传给分析器：churn 缺失（空对象）时 `hotspotScore === indegree`，
      // 排序与升级前逐位相同——「采集失败不能悄悄改变既有行为」。
      setHotspotNodes(hotspotAnalyzer.analyze(rawNodes, rawEdges, churnByFile));
    }
  }, [showHotspot, rawNodes, rawEdges, hotspotAnalyzer, churnByFile]);

  useEffect(() => {
    if (showGodModule && rawNodes.length > 0) {
      setGodModules(godModuleDetector.detect(rawNodes, rawEdges));
    }
  }, [showGodModule, rawNodes, rawEdges, godModuleDetector]);

  useEffect(() => {
    if (showImpact && selectedNodeId) {
      const stats = getImpactStats();
      setImpactStats(stats ?? null);
    } else {
      setImpactStats(null);
    }
  }, [showImpact, selectedNodeId, getImpactStats]);

  useEffect(() => {
    if (showCoreFunction && rawNodes.length > 0) {
      setCoreFunctions(coreFunctionAnalyzer.analyze(rawNodes, rawEdges));
    }
  }, [showCoreFunction, rawNodes, rawEdges, coreFunctionAnalyzer]);

  useEffect(() => {
    if (showDeadCode && rawNodes.length > 0) {
      setDeadCodeResult(deadCodeAnalyzer.analyze(rawNodes, rawEdges));
    } else {
      setDeadCodeResult(null);
    }
  }, [showDeadCode, rawNodes, rawEdges, deadCodeAnalyzer]);

  return {
    handleHealthCheck, handleRulesCheck, hotspotNodes, godModules, impactStats,
    coreFunctions, deadCodeResult, churnStatus,
  };
}