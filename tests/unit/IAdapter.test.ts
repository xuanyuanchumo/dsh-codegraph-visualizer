import { describe, it, expect } from 'vitest';
import { CodeGraphAdapter } from '../../src/adapters/CodeGraphAdapter.ts';
import { LensAdapter } from '../../src/adapters/LensAdapter.ts';

import { TreeSitterAdapter } from '../../src/adapters/TreeSitterAdapter.ts';
import type { IDataAdapter, IAnalysisAdapter } from '../../src/adapters/IAdapter.ts';

describe('IAdapter 统一抽象接口', () => {
  describe('IDataAdapter — CodeGraphAdapter', () => {
    it('应实现 IDataAdapter 接口', () => {
      const adapter = new CodeGraphAdapter();
      expect(adapter.source).toBe('codegraph');
      expect(typeof adapter.fetchData).toBe('function');
    });

    it('fetchData 应返回 AdapterResult 结构', async () => {
      const adapter = new CodeGraphAdapter();
      const invoke = async () => null;
      const result = await adapter.fetchData('/nonexistent', invoke);
      expect(result).toHaveProperty('nodes');
      expect(result).toHaveProperty('edges');
      expect(result).toHaveProperty('source');
      expect(result).toHaveProperty('timestamp');
      expect(result.source).toBe('codegraph');
    });
  });

  describe('IDataAdapter — LensAdapter', () => {
    it('应实现 IDataAdapter 接口', () => {
      const adapter = new LensAdapter();
      expect(adapter.source).toBe('lens');
      expect(typeof adapter.fetchData).toBe('function');
    });

    it('fetchData 应返回 AdapterResult 结构', async () => {
      const adapter = new LensAdapter();
      const invoke = async () => null;
      const result = await adapter.fetchData('test-repo', invoke);
      expect(result).toHaveProperty('nodes');
      expect(result).toHaveProperty('edges');
      expect(result).toHaveProperty('source');
      expect(result).toHaveProperty('timestamp');
      expect(result.source).toBe('lens');
    });
  });


  describe('IAnalysisAdapter — TreeSitterAdapter', () => {
    it('应实现 IAnalysisAdapter 接口', () => {
      const adapter = new TreeSitterAdapter();
      expect(adapter.source).toBe('tree-sitter');
      expect(typeof adapter.init).toBe('function');
      expect(typeof adapter.isAvailable).toBe('function');
      expect(typeof adapter.parseFile).toBe('function');
      expect(typeof adapter.destroy).toBe('function');
    });

    it('isAvailable 在 init 前应返回 false', () => {
      const adapter = new TreeSitterAdapter();
      expect(adapter.isAvailable()).toBe(false);
    });

    it('parseFile 在未显式 init 时会懒初始化并解析出符号', async () => {
      const adapter = new TreeSitterAdapter();
      const result = await adapter.parseFile('test.ts', 'const x = 1;');
      // Round 9：这里原本断言 nodes 为空，只是因为旧的平坦类型表恰好匹配不到 TypeScript 的
      // `lexical_declaration` 包装节点；适配器实际会懒初始化。契约按真实行为锁定。
      expect(result.source).toBe('tree-sitter');
      expect(result.edges).toEqual([]);
      expect(result.nodes.map((n) => n.label)).toContain('x');
      adapter.destroy();
    });
  });

  describe('接口类型兼容性', () => {
    it('CodeGraphAdapter 可赋值给 IDataAdapter', () => {
      const adapter: IDataAdapter = new CodeGraphAdapter();
      expect(adapter.source).toBe('codegraph');
    });

    it('LensAdapter 可赋值给 IDataAdapter', () => {
      const adapter: IDataAdapter = new LensAdapter();
      expect(adapter.source).toBe('lens');
    });


    it('TreeSitterAdapter 可赋值给 IAnalysisAdapter', () => {
      const adapter: IAnalysisAdapter = new TreeSitterAdapter();
      expect(adapter.source).toBe('tree-sitter');
    });
  });
});