/**
 * M10-c 模块引擎接入测试。
 *
 * 验证 analyzeBootstrapWithEngines 将编排器输出馈入 evolution/governance 引擎：
 * - eval 结果 → patchEngine 产 tech-debt
 * - gate 结果 → hitlAudit 产审计发现
 * - fact-base 验证
 * - 风险评分计算
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { autoInstallSkill } from '../../src/host/skillInvoker.ts';
import { runSelfBootstrapCycle } from '../../src/host/runtime/bootstrapOrchestrator.ts';
import {
  analyzeBootstrapWithEngines,
  runBootstrapWithEngines,
} from '../../src/host/runtime/bootstrapEngineIntegration.ts';

let tempDir: string;
let workspace: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'engine-int-'));
  workspace = join(tempDir, 'project');
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('analyzeBootstrapWithEngines', () => {
  it('返回引擎洞察（techDebt + hitlChecks + factBase + riskScore）', () => {
    autoInstallSkill(workspace);
    const cycle = runSelfBootstrapCycle(workspace, 1, 30000);
    const insights = analyzeBootstrapWithEngines(cycle, workspace);

    expect(insights).toHaveProperty('techDebt');
    expect(insights).toHaveProperty('hitlChecks');
    expect(insights).toHaveProperty('factBase');
    expect(insights).toHaveProperty('riskScore');
    expect(Array.isArray(insights.techDebt)).toBe(true);
    expect(Array.isArray(insights.hitlChecks)).toBe(true);
    expect(typeof insights.riskScore).toBe('number');
    expect(insights.riskScore).toBeGreaterThanOrEqual(0);
    expect(insights.riskScore).toBeLessThanOrEqual(1);
  });

  it('HITL 检查包含 H1-H4 四项', () => {
    autoInstallSkill(workspace);
    const cycle = runSelfBootstrapCycle(workspace, 1, 30000);
    const insights = analyzeBootstrapWithEngines(cycle, workspace);

    expect(insights.hitlChecks.length).toBe(4);
    expect(insights.hitlChecks.map((c) => c.check)).toEqual(['H1', 'H2', 'H3', 'H4']);
  });

  it('gate 未通过时产 tech-debt 条目', () => {
    autoInstallSkill(workspace);
    const cycle = runSelfBootstrapCycle(workspace, 1, 30000);
    const insights = analyzeBootstrapWithEngines(cycle, workspace);

    // 如果编排器未收敛，应有 tech-debt
    if (!cycle.converged) {
      expect(insights.techDebt.length).toBeGreaterThan(0);
    }
  });
});

describe('runBootstrapWithEngines', () => {
  it('返回 cycle + insights 完整结构', () => {
    autoInstallSkill(workspace);
    const result = runBootstrapWithEngines(workspace, 1, 30000);

    expect(result.cycle).toHaveProperty('state');
    expect(result.cycle).toHaveProperty('rounds');
    expect(result.cycle).toHaveProperty('converged');
    expect(result.insights).toHaveProperty('techDebt');
    expect(result.insights).toHaveProperty('riskScore');
  });

  it('多次调用风险评分稳定（幂等性）', () => {
    autoInstallSkill(workspace);
    const r1 = runBootstrapWithEngines(workspace, 1, 30000);
    const r2 = runBootstrapWithEngines(workspace, 1, 30000);

    // 风险评分应稳定（不因随机因素变化）
    expect(r1.insights.riskScore).toBe(r2.insights.riskScore);
  });
});
