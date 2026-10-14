import { describe, it, expect } from 'vitest';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runTruthAudit,
  auditTruthfulness,
  auditAccuracy,
  auditStructure,
  auditLogic,
} from '../../src/host/evolution/truthAudit.ts';

const PLUGIN_DIR = resolve(join(fileURLToPath(import.meta.url), '../../..'));

describe('truthAudit', () => {
  it('T1 truthfulness: all required dirs and files exist', () => {
    const result = auditTruthfulness(PLUGIN_DIR);
    expect(result.dimension).toBe('T1_truthfulness');
    expect(result.findings.length).toBeGreaterThan(15);
    const missing = result.findings.filter((f) => f.status === 'fail');
    expect(missing).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('T2 accuracy: agent cards = 15, version is real', () => {
    const result = auditAccuracy(PLUGIN_DIR);
    expect(result.dimension).toBe('T2_accuracy');
    const agentFinding = result.findings.find((f) => f.check === 'agent card count');
    expect(agentFinding?.detail).toContain('15');
    const versionFinding = result.findings.find((f) => f.check === 'package version');
    expect(versionFinding?.detail).not.toContain('0.0.0');
    expect(versionFinding?.detail).not.toContain('unknown');
  });

  it('T3 structure: no file exceeds 250-line modular limit', () => {
    const result = auditStructure(PLUGIN_DIR);
    expect(result.dimension).toBe('T3_structure');
    const oversized = result.findings.filter((f) => f.status === 'fail' && f.check.startsWith('file:'));
    expect(oversized).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('T4 logic: routes have registration, index has imports, tools >= 9', () => {
    const result = auditLogic(PLUGIN_DIR);
    expect(result.dimension).toBe('T4_logic');
    const toolFinding = result.findings.find((f) => f.check === 'DSH tool count');
    expect(toolFinding?.status).toBe('pass');
  });

  it('runTruthAudit: returns summary with 4 dimensions', () => {
    const summary = runTruthAudit(PLUGIN_DIR);
    expect(summary.results).toHaveLength(4);
    expect(summary.results.map((r) => r.dimension)).toEqual([
      'T1_truthfulness',
      'T2_accuracy',
      'T3_structure',
      'T4_logic',
    ]);
    expect(summary.totalFindings).toBeGreaterThan(20);
    expect(summary.overallScore).toBeGreaterThanOrEqual(0);
    expect(summary.overallScore).toBeLessThanOrEqual(100);
  });

  it('runTruthAudit: allPassed is true for this plugin', () => {
    const summary = runTruthAudit(PLUGIN_DIR);
    expect(summary.allPassed).toBe(true);
    expect(summary.failCount).toBe(0);
  });
});
