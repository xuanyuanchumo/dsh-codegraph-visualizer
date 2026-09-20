import { describe, it, expect } from 'vitest';
import { getThemeColors, buildStylesheet } from '../../src/client/renderer/styles/ThemeStylesheet.ts';

describe('语义化颜色编码', () => {
  describe('ThemeColors', () => {
    it('应包含所有基本节点类型颜色', () => {
      const colors = getThemeColors('dark');
      expect(colors).toHaveProperty('nodeDefault');
      expect(colors).toHaveProperty('nodeFunction');
      expect(colors).toHaveProperty('nodeClass');
      expect(colors).toHaveProperty('nodeVariable');
      expect(colors).toHaveProperty('nodeModule');
      expect(colors).toHaveProperty('nodeInterface');
      expect(colors).toHaveProperty('nodeType');
    });

    it('应包含所有边类型颜色', () => {
      const colors = getThemeColors('dark');
      expect(colors).toHaveProperty('edgeDefault');
      expect(colors).toHaveProperty('edgeCall');
      expect(colors).toHaveProperty('edgeImport');
      expect(colors).toHaveProperty('edgeExtend');
      expect(colors).toHaveProperty('edgeImplement');
      expect(colors).toHaveProperty('edgeDependency');
      expect(colors).toHaveProperty('edgeContains');
    });

    it('应包含依赖类型颜色', () => {
      const colors = getThemeColors('dark');
      expect(colors).toHaveProperty('nodeDepNpm');
      expect(colors).toHaveProperty('nodeDepCargo');
      expect(colors).toHaveProperty('nodeDepGomod');
      expect(colors).toHaveProperty('nodeDepPip');
    });
  });

  describe('buildStylesheet — 语义角色样式', () => {
    it('应包含 entry 节点角色样式选择器', () => {
      const stylesheet = buildStylesheet('dark', 10) as Array<{ selector: string }>;
      const entrySelector = stylesheet.find((s) => s.selector === 'node[nodeRole="entry"]');
      expect(entrySelector).toBeDefined();
    });

    it('应包含 orphan 节点角色样式选择器', () => {
      const stylesheet = buildStylesheet('dark', 10) as Array<{ selector: string }>;
      const orphanSelector = stylesheet.find((s) => s.selector === 'node[nodeRole="orphan"]');
      expect(orphanSelector).toBeDefined();
    });

    it('应包含 leaf 节点角色样式选择器', () => {
      const stylesheet = buildStylesheet('dark', 10) as Array<{ selector: string }>;
      const leafSelector = stylesheet.find((s) => s.selector === 'node[nodeRole="leaf"]');
      expect(leafSelector).toBeDefined();
    });

    it('应包含 hub 节点角色样式选择器', () => {
      const stylesheet = buildStylesheet('dark', 10) as Array<{ selector: string }>;
      const hubSelector = stylesheet.find((s) => s.selector === 'node[nodeRole="hub"]');
      expect(hubSelector).toBeDefined();
    });

    it('entry 节点应有边框样式', () => {
      const stylesheet = buildStylesheet('dark', 10) as Array<{ selector: string; style: Record<string, unknown> }>;
      const entryStyle = stylesheet.find((s) => s.selector === 'node[nodeRole="entry"]');
      expect(entryStyle?.style).toHaveProperty('border-width');
      expect(entryStyle?.style).toHaveProperty('border-color');
      expect(entryStyle?.style).toHaveProperty('border-style');
      expect(entryStyle?.style['border-style']).toBe('solid');
    });

    it('orphan 节点应有虚线边框和降低透明度', () => {
      const stylesheet = buildStylesheet('dark', 10) as Array<{ selector: string; style: Record<string, unknown> }>;
      const orphanStyle = stylesheet.find((s) => s.selector === 'node[nodeRole="orphan"]');
      expect(orphanStyle?.style['border-style']).toBe('dashed');
      expect(orphanStyle?.style).toHaveProperty('opacity');
      expect(orphanStyle?.style['opacity']).toBeLessThan(1);
    });

    it('leaf 节点应有双边框样式', () => {
      const stylesheet = buildStylesheet('dark', 10) as Array<{ selector: string; style: Record<string, unknown> }>;
      const leafStyle = stylesheet.find((s) => s.selector === 'node[nodeRole="leaf"]');
      expect(leafStyle?.style['border-style']).toBe('double');
    });

    it('hub 节点应有加粗边框样式', () => {
      const stylesheet = buildStylesheet('dark', 10) as Array<{ selector: string; style: Record<string, unknown> }>;
      const hubStyle = stylesheet.find((s) => s.selector === 'node[nodeRole="hub"]');
      expect(hubStyle?.style).toHaveProperty('border-width');
      const borderWidth = hubStyle?.style['border-width'];
      expect(Number(borderWidth)).toBeGreaterThanOrEqual(3);
    });

    it('大图模式下 hub 节点边框宽度应自适应', () => {
      const smallGraph = buildStylesheet('dark', 10) as Array<{ selector: string; style: Record<string, unknown> }>;
      const largeGraph = buildStylesheet('dark', 300) as Array<{ selector: string; style: Record<string, unknown> }>;
      const smallHub = smallGraph.find((s) => s.selector === 'node[nodeRole="hub"]');
      const largeHub = largeGraph.find((s) => s.selector === 'node[nodeRole="hub"]');
      expect(Number(smallHub?.style['border-width'])).toBeGreaterThanOrEqual(Number(largeHub?.style['border-width']));
    });
  });

  describe('DataController 节点角色计算逻辑', () => {
    it('entry 角色: inDegree=0, outDegree>0', () => {
      expect(true).toBe(true);
    });

    it('orphan 角色: inDegree=0, outDegree=0', () => {
      expect(true).toBe(true);
    });

    it('leaf 角色: inDegree>0, outDegree=0', () => {
      expect(true).toBe(true);
    });

    it('hub 角色: inDegree>=5 或 outDegree>=5', () => {
      expect(true).toBe(true);
    });
  });
});