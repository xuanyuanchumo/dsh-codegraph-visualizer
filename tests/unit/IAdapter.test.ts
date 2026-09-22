import { describe, it, expect } from 'vitest';
import { CodeGraphAdapter } from '../../src/adapters/CodeGraphAdapter.ts';
import { LensAdapter } from '../../src/adapters/LensAdapter.ts';
import { DependencyDataAdapter } from '../../src/adapters/DependencyAdapter.ts';
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

  describe('IDataAdapter — DependencyDataAdapter', () => {
    it('应实现 IDataAdapter 接口', () => {
      const adapter = new DependencyDataAdapter();
      expect(adapter.source).toBe('dependency');
      expect(typeof adapter.fetchData).toBe('function');
    });

    it('fetchData 应返回 AdapterResult 结构', async () => {
      const adapter = new DependencyDataAdapter();
      const result = await adapter.fetchData('/nonexistent');
      expect(result).toHaveProperty('nodes');
      expect(result).toHaveProperty('edges');
      expect(result).toHaveProperty('source');
      expect(result).toHaveProperty('timestamp');
    });

    it('fetchData 不需要 invoke 参数', async () => {
      const adapter = new DependencyDataAdapter();
      const result = await adapter.fetchData('/nonexistent');
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
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

    it('parseFile 在未初始化时应返回空结果带错误信息', async () => {
      const adapter = new TreeSitterAdapter();
      const result = await adapter.parseFile('test.ts', 'const x = 1;');
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
      expect(result.source).toBe('tree-sitter');
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

    it('DependencyDataAdapter 可赋值给 IDataAdapter', () => {
      const adapter: IDataAdapter = new DependencyDataAdapter();
      expect(adapter.source).toBe('dependency');
    });

    it('TreeSitterAdapter 可赋值给 IAnalysisAdapter', () => {
      const adapter: IAnalysisAdapter = new TreeSitterAdapter();
      expect(adapter.source).toBe('tree-sitter');
    });
  });
});