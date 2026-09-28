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

export interface HotspotNode { nodeId: string; label: string; indegree: number; level: string; }
export interface GodModule { modulePath: string; nodeCount: number; edgeCount: number; suggestion: string; }
export interface ImpactStats { d1: number; d2: number; d3: number; total: number; }

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
      setHotspotNodes(hotspotAnalyzer.analyze(rawNodes, rawEdges));
    }
  }, [showHotspot, rawNodes, rawEdges, hotspotAnalyzer]);

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

  return { handleHealthCheck, handleRulesCheck, hotspotNodes, godModules, impactStats, coreFunctions, deadCodeResult };
}