import { describe, it, expect } from 'vitest';
import {
  initialBootstrapState,
  advanceBootstrap,
  type BootstrapState,
} from '../../src/host/selfBootstrap.ts';
import {
  isAllowedScript,
  listSkillScripts,
  validateWorkspace,
} from '../../src/host/skillInvoker.ts';

describe('selfBootstrap state machine', () => {
  it('initial state is IDLE with round 0', () => {
    const s = initialBootstrapState();
    expect(s.status).toBe('IDLE');
    expect(s.round).toBe(0);
    expect(s.maxRounds).toBe(3);
    expect(s.history).toEqual([]);
  });

  it('advanceBootstrap: PASS → CONVERGED', () => {
    const s = initialBootstrapState();
    const next = advanceBootstrap(s, 0.95, 'PASS', null);
    expect(next.status).toBe('CONVERGED');
    expect(next.round).toBe(1);
    expect(next.lastEvalScore).toBe(0.95);
    expect(next.history).toHaveLength(1);
  });

  it('advanceBootstrap: approve → CONVERGED', () => {
    const s = initialBootstrapState();
    const next = advanceBootstrap(s, 0.9, 'approve', null);
    expect(next.status).toBe('CONVERGED');
  });

  it('advanceBootstrap: FAIL + round < max → FIXING', () => {
    const s = initialBootstrapState(3);
    const next = advanceBootstrap(s, 0.7, 'FAIL', 'fix-N3');
    expect(next.status).toBe('FIXING');
    expect(next.round).toBe(1);
    expect(next.history[0]?.fixApplied).toBe('fix-N3');
  });

  it('advanceBootstrap: FAIL + round >= max → EXHAUSTED', () => {
    let s: BootstrapState = initialBootstrapState(2);
    s = advanceBootstrap(s, 0.7, 'FAIL', 'fix-1');
    s = advanceBootstrap(s, 0.75, 'FAIL', 'fix-2');
    expect(s.status).toBe('EXHAUSTED');
    expect(s.round).toBe(2);
    expect(s.history).toHaveLength(2);
  });

  it('advanceBootstrap: doubt → FIXING (not CONVERGED)', () => {
    const s = initialBootstrapState();
    const next = advanceBootstrap(s, 0.6, 'doubt', null);
    expect(next.status).toBe('FIXING');
  });
});

describe('skillInvoker', () => {
  it('isAllowedScript accepts known scripts', () => {
    expect(isAllowedScript('eval-runner')).toBe(true);
    expect(isAllowedScript('gate-check')).toBe(true);
    expect(isAllowedScript('init-workflow')).toBe(true);
  });

  it('isAllowedScript rejects unknown scripts', () => {
    expect(isAllowedScript('rm-rf')).toBe(false);
    expect(isAllowedScript('../../../etc/passwd')).toBe(false);
    expect(isAllowedScript('')).toBe(false);
  });

  it('listSkillScripts returns 15 scripts', () => {
    const scripts = listSkillScripts();
    expect(scripts).toHaveLength(15);
    expect(scripts).toContain('eval-runner');
    expect(scripts).toContain('gate-check');
    expect(scripts).toContain('archive-cycle');
  });

  it('validateWorkspace rejects path traversal', () => {
    const r = validateWorkspace('../../../etc');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('traversal');
  });

  it('validateWorkspace rejects non-existent', () => {
    const r = validateWorkspace('/nonexistent/path/xyz');
    expect(r.ok).toBe(false);
  });

  it('validateWorkspace rejects empty', () => {
    const r = validateWorkspace('');
    expect(r.ok).toBe(false);
  });
});
