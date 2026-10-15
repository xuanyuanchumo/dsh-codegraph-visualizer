/**
 * M10-d 技能优先面呈现契约测试。
 *
 * 守卫：
 * 1. 所有 anic_* 工具的 presentCall 返回合法 ToolCallView（card 标签存在）
 * 2. terminalCall 视图含 title + cwd（DSH UI 终端卡片必需字段）
 * 3. terminalResult 视图含 exitCode + output（completed 状态）
 * 4. presentCall 纯函数无副作用（相同输入→相同输出）
 * 5. 反向自检：presentCall 对未知字段安全降级
 */
import { describe, it, expect } from 'vitest';
import {
  terminalCall,
  terminalResult,
  genericCall,
  genericResult,
  skillPresentCall,
  skillPresentResult,
  evaluatePresentCall,
  iteratePresentCall,
  bootstrapCyclePresentCall,
  bootstrapAnalyzePresentCall,
  statusPresentCall,
} from '../../src/host/presentation.ts';

describe('M10-d presentation helpers', () => {
  describe('terminalCall', () => {
    it('返回终端卡片视图含 title + cwd', () => {
      const view = terminalCall('anic_skill: eval-runner', '/tmp/proj', '评估');
      expect(view.card).toBe('terminal');
      expect(view.title).toBe('anic_skill: eval-runner');
      expect(view.cwd).toBe('/tmp/proj');
      expect(view.summary).toBe('评估');
    });

    it('summary 可选', () => {
      const view = terminalCall('test', '/tmp');
      expect(view.card).toBe('terminal');
      expect(view.summary).toBeUndefined();
    });
  });

  describe('terminalResult', () => {
    it('映射 exitCode + stdout + stderr', () => {
      const view = terminalResult({ exitCode: 0, stdout: 'done', stderr: '' });
      expect(view.card).toBe('terminal');
      expect(view.exitCode).toBe(0);
      expect(view.output).toBe('done');
    });

    it('stderr 非空时合并输出', () => {
      const view = terminalResult({ exitCode: 1, stdout: 'out', stderr: 'err' });
      expect(view.output).toContain('out');
      expect(view.output).toContain('err');
      expect(view.output).toContain('stderr');
    });

    it('空输出时 output 为 undefined', () => {
      const view = terminalResult({ exitCode: 0, stdout: '', stderr: '' });
      expect(view.output).toBeUndefined();
    });

    it('非字符串 stdout 安全降级', () => {
      const view = terminalResult({ exitCode: 0, stdout: 123 });
      expect(view.exitCode).toBe(0);
      // 空字符串经 `output || undefined` 规范化为 undefined
      expect(view.output).toBeUndefined();
    });
  });

  describe('genericCall / genericResult', () => {
    it('genericCall 默认 kind=other', () => {
      const view = genericCall('test');
      expect(view.card).toBe('generic');
      expect(view.kind).toBe('other');
    });

    it('genericResult 仅含 card + title', () => {
      const view = genericResult('done');
      expect(view.card).toBe('generic');
      expect(view.title).toBe('done');
    });
  });

  describe('工具专用 presentCall 函数', () => {
    it('skillPresentCall 含脚本名 + 工作目录', () => {
      const view = skillPresentCall({ script: 'eval-runner', workspace: '/proj' });
      expect(view.card).toBe('terminal');
      expect(view.title).toContain('eval-runner');
      expect(view.cwd).toBe('/proj');
    });

    it('skillPresentCall 缺失字段安全降级', () => {
      const view = skillPresentCall({});
      expect(view.title).toContain('?');
      expect(view.cwd).toBe('.');
    });

    it('skillPresentResult 含脚本名 + 退出码', () => {
      const view = skillPresentResult({ script: 'gate-check' }, { exitCode: 0, stdout: 'pass' });
      expect(view.card).toBe('terminal');
      expect(view.title).toContain('gate-check');
      expect(view.exitCode).toBe(0);
    });

    it('evaluatePresentCall 含维度信息', () => {
      const view = evaluatePresentCall({ dimensions: 'E1,E2', workspace: '/p' });
      expect(view.title).toContain('E1,E2');
    });

    it('evaluatePresentCall 无维度时显示 all', () => {
      const view = evaluatePresentCall({});
      expect(view.title).toContain('all');
    });

    it('iteratePresentCall 含迭代描述', () => {
      const view = iteratePresentCall({ workspace: '/p' });
      expect(view.summary).toContain('迭代');
    });

    it('bootstrapCyclePresentCall 含轮次', () => {
      const view = bootstrapCyclePresentCall({ maxRounds: 5, workspace: '/p' });
      expect(view.title).toContain('5');
    });

    it('bootstrapAnalyzePresentCall 含分析描述', () => {
      const view = bootstrapAnalyzePresentCall({ workspace: '/p' });
      expect(view.summary).toContain('分析');
    });

    it('statusPresentCall 返回通用卡片 kind=read', () => {
      const view = statusPresentCall({ workspace: '/p' });
      expect(view.card).toBe('generic');
      expect(view.kind).toBe('read');
    });
  });

  describe('纯函数性（相同输入→相同输出）', () => {
    it('skillPresentCall 幂等', () => {
      const a = skillPresentCall({ script: 'eval-runner', workspace: '/p' });
      const b = skillPresentCall({ script: 'eval-runner', workspace: '/p' });
      expect(a).toEqual(b);
    });

    it('terminalResult 幂等', () => {
      const r = { exitCode: 0, stdout: 'ok', stderr: '' };
      expect(terminalResult(r)).toEqual(terminalResult(r));
    });
  });
});
