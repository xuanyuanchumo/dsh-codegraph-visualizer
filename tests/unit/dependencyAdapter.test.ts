import { describe, it, expect } from 'vitest';
import {
  parsePackageJson,
  parseCargoToml,
  parseGoMod,
  dependencyGraphToGraphData,
} from '../../src/adapters/DependencyAdapter.ts';

describe('DependencyAdapter (FR-21)', () => {
  describe('parsePackageJson', () => {
    it('should parse dependencies', () => {
      const content = JSON.stringify({
        name: 'test-pkg',
        version: '1.0.0',
        dependencies: { react: '18.0.0', lodash: '4.17.0' },
      });
      const result = parsePackageJson(content);
      expect(result.nodes).toHaveLength(3);
      expect(result.nodes[0]!.name).toBe('test-pkg');
      expect(result.nodes[1]!.name).toBe('react');
      expect(result.nodes[2]!.name).toBe('lodash');
      expect(result.edges).toHaveLength(2);
      expect(result.edges[0]!.source).toBe('dep:test-pkg');
      expect(result.edges[0]!.target).toBe('dep:react');
    });

    it('should parse devDependencies', () => {
      const content = JSON.stringify({
        name: 'test-pkg',
        devDependencies: { vitest: '1.0.0' },
      });
      const result = parsePackageJson(content);
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[1]!.name).toBe('vitest');
    });

    it('should handle empty package.json', () => {
      const result = parsePackageJson('{}');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]!.name).toBe('root');
    });

    it('should handle invalid JSON gracefully', () => {
      const result = parsePackageJson('not json');
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it('should deduplicate dependencies across sections', () => {
      const content = JSON.stringify({
        name: 'test-pkg',
        dependencies: { react: '18.0.0' },
        devDependencies: { react: '18.0.0' },
      });
      const result = parsePackageJson(content);
      expect(result.nodes.filter((n) => n.name === 'react')).toHaveLength(1);
    });
  });

  describe('parseCargoToml', () => {
    it('should parse Cargo.toml dependencies', () => {
      const content = `
name = "my-crate"
version = "0.1.0"

[dependencies]
serde = "1.0"
tokio = "1.0"
`;
      const result = parseCargoToml(content);
      expect(result.nodes.length).toBeGreaterThanOrEqual(3);
      expect(result.nodes[0]!.name).toBe('my-crate');
      expect(result.nodes.some((n) => n.name === 'serde')).toBe(true);
      expect(result.nodes.some((n) => n.name === 'tokio')).toBe(true);
    });

    it('should handle empty Cargo.toml', () => {
      const result = parseCargoToml('');
      expect(result.nodes).toHaveLength(1);
    });
  });

  describe('parseGoMod', () => {
    it('should parse go.mod dependencies', () => {
      const content = `
module github.com/example/myapp

require (
  github.com/gin-gonic/gin v1.9.0
  github.com/stretchr/testify v1.8.0
)
`;
      const result = parseGoMod(content);
      expect(result.nodes.length).toBeGreaterThanOrEqual(3);
      expect(result.nodes[0]!.name).toBe('github.com/example/myapp');
      expect(result.nodes.some((n) => n.name === 'github.com/gin-gonic/gin')).toBe(true);
    });

    it('should handle single-line require', () => {
      const content = `
module github.com/example/myapp

require github.com/foo/bar v1.0.0
`;
      const result = parseGoMod(content);
      expect(result.nodes.some((n) => n.name === 'github.com/foo/bar')).toBe(true);
    });
  });

  describe('dependencyGraphToGraphData', () => {
    it('should convert dependency nodes to GraphNode format', () => {
      const depGraph = {
        nodes: [
          { id: 'dep:react', name: 'react', version: '18.0.0', type: 'npm' as const },
        ],
        edges: [{ source: 'dep:root', target: 'dep:react', type: 'depends' as const }],
      };
      const result = dependencyGraphToGraphData(depGraph);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]!.type).toBe('module');
      expect(result.nodes[0]!.properties.version).toBe('18.0.0');
      expect(result.nodes[0]!.properties.depType).toBe('npm');
      expect(result.nodes[0]!.properties.isExternal).toBe(true);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.type).toBe('dependency');
    });
  });
});