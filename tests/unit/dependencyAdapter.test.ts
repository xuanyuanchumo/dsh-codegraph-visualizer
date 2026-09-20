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

    it('should skip comment lines in require block', () => {
      const content = `
module github.com/example/myapp

require (
  // github.com/commented/dep v1.0.0
  github.com/real/dep v1.0.0
  // another comment
)
`;
      const result = parseGoMod(content);
      expect(result.nodes.some((n) => n.name === 'github.com/real/dep')).toBe(true);
      expect(result.nodes.some((n) => n.name === 'github.com/commented/dep')).toBe(false);
    });

    it('should skip block comment lines in require block', () => {
      const content = `
module github.com/example/myapp

require (
  /* github.com/block/dep v1.0.0 */
  github.com/real/dep v1.0.0
)
`;
      const result = parseGoMod(content);
      expect(result.nodes.some((n) => n.name === 'github.com/real/dep')).toBe(true);
      expect(result.nodes.some((n) => n.name === 'github.com/block/dep')).toBe(false);
    });

    it('should strip inline comments from dependency lines', () => {
      const content = `
module github.com/example/myapp

require (
  github.com/foo/bar v1.0.0 // indirect
)
`;
      const result = parseGoMod(content);
      expect(result.nodes.some((n) => n.name === 'github.com/foo/bar')).toBe(true);
      const dep = result.nodes.find((n) => n.name === 'github.com/foo/bar');
      expect(dep?.version).toBe('v1.0.0');
    });

    it('should skip commented-out single-line require', () => {
      const content = `
module github.com/example/myapp

// require github.com/commented/dep v1.0.0
require github.com/real/dep v1.0.0
`;
      const result = parseGoMod(content);
      expect(result.nodes.some((n) => n.name === 'github.com/real/dep')).toBe(true);
      expect(result.nodes.some((n) => n.name === 'github.com/commented/dep')).toBe(false);
    });
  });

  describe('parsePackageJson - additional scopes', () => {
    it('should parse peerDependencies', () => {
      const content = JSON.stringify({
        name: 'test-pkg',
        peerDependencies: { react: '18.0.0' },
      });
      const result = parsePackageJson(content);
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[1]!.name).toBe('react');
      expect(result.edges[0]!.scope).toBe('peer');
    });

    it('should parse optionalDependencies', () => {
      const content = JSON.stringify({
        name: 'test-pkg',
        optionalDependencies: { fsevents: '2.3.0' },
      });
      const result = parsePackageJson(content);
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[1]!.name).toBe('fsevents');
      expect(result.edges[0]!.scope).toBe('optional');
    });

    it('should parse all four dependency sections simultaneously', () => {
      const content = JSON.stringify({
        name: 'full-pkg',
        version: '2.0.0',
        dependencies: { react: '18.0.0' },
        devDependencies: { vitest: '1.0.0' },
        peerDependencies: { typescript: '5.0.0' },
        optionalDependencies: { fsevents: '2.3.0' },
      });
      const result = parsePackageJson(content);
      expect(result.nodes).toHaveLength(5);
      expect(result.edges).toHaveLength(4);
      const scopes = result.edges.map((e) => e.scope);
      expect(scopes).toContain('prod');
      expect(scopes).toContain('dev');
      expect(scopes).toContain('peer');
      expect(scopes).toContain('optional');
    });

    it('should skip non-object dependency sections', () => {
      const content = JSON.stringify({
        name: 'test-pkg',
        dependencies: 'not-an-object',
        devDependencies: 123,
      });
      const result = parsePackageJson(content);
      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(0);
    });

    it('should use default version 0.0.0 when version is missing', () => {
      const content = JSON.stringify({
        name: 'no-version-pkg',
        dependencies: { lodash: '4.17.0' },
      });
      const result = parsePackageJson(content);
      expect(result.nodes[0]!.version).toBe('0.0.0');
    });

    it('should use root name when name is missing', () => {
      const content = JSON.stringify({
        dependencies: { lodash: '4.17.0' },
      });
      const result = parsePackageJson(content);
      expect(result.nodes[0]!.name).toBe('root');
    });
  });

  describe('parseCargoToml - table dependencies', () => {
    it('should parse inline table dependency (single line)', () => {
      const content = `
name = "my-crate"

[dependencies]
serde = { version = "1.0" }
`;
      const result = parseCargoToml(content);
      expect(result.nodes.some((n) => n.name === 'serde')).toBe(true);
      const serdeNode = result.nodes.find((n) => n.name === 'serde');
      expect(serdeNode?.version).toBe('1.0');
    });

    it('should parse multi-line table dependency', () => {
      const content = `
name = "my-crate"

[dependencies]
tokio = {
  version = "1.0",
  features = ["full"]
}
`;
      const result = parseCargoToml(content);
      expect(result.nodes.some((n) => n.name === 'tokio')).toBe(true);
      const tokioNode = result.nodes.find((n) => n.name === 'tokio');
      expect(tokioNode?.version).toBe('1.0');
    });

    it('should handle table dependency without version field', () => {
      const content = `
name = "my-crate"

[dependencies]
some_dep = {
  path = "../local"
}
`;
      const result = parseCargoToml(content);
      expect(result.nodes.some((n) => n.name === 'some_dep')).toBe(false);
    });

    it('should handle mixed simple and table dependencies', () => {
      const content = `
name = "my-crate"

[dependencies]
serde = "1.0"
tokio = { version = "1.0" }
log = "0.4"
`;
      const result = parseCargoToml(content);
      expect(result.nodes.some((n) => n.name === 'serde')).toBe(true);
      expect(result.nodes.some((n) => n.name === 'tokio')).toBe(true);
      expect(result.nodes.some((n) => n.name === 'log')).toBe(true);
    });

    it('should stop parsing deps when another section starts', () => {
      const content = `
name = "my-crate"

[dependencies]
serde = "1.0"

[dev-dependencies]
vitest = "1.0"
`;
      const result = parseCargoToml(content);
      expect(result.nodes.some((n) => n.name === 'serde')).toBe(true);
      expect(result.nodes.some((n) => n.name === 'vitest')).toBe(false);
    });

    it('should deduplicate dependencies', () => {
      const content = `
name = "my-crate"

[dependencies]
serde = "1.0"
serde = "2.0"
`;
      const result = parseCargoToml(content);
      const serdeNodes = result.nodes.filter((n) => n.name === 'serde');
      expect(serdeNodes).toHaveLength(1);
    });

    it('should handle invalid Cargo.toml gracefully', () => {
      const result = parseCargoToml(null as unknown as string);
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });
  });

  describe('parseGoMod - additional cases', () => {
    it('should handle go.mod with no require block', () => {
      const content = `
module github.com/example/myapp

go 1.21
`;
      const result = parseGoMod(content);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]!.name).toBe('github.com/example/myapp');
      expect(result.edges).toHaveLength(0);
    });

    it('should handle empty go.mod', () => {
      const result = parseGoMod('');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]!.name).toBe('root');
    });

    it('should handle go.mod with only comments', () => {
      const content = `
// This is a comment
/* Block comment */
module github.com/example/myapp
`;
      const result = parseGoMod(content);
      expect(result.nodes[0]!.name).toBe('github.com/example/myapp');
    });

    it('should handle multiple require blocks', () => {
      const content = `
module github.com/example/myapp

require (
  github.com/foo/bar v1.0.0
)

require github.com/baz/qux v2.0.0
`;
      const result = parseGoMod(content);
      expect(result.nodes.some((n) => n.name === 'github.com/foo/bar')).toBe(true);
      expect(result.nodes.some((n) => n.name === 'github.com/baz/qux')).toBe(true);
    });

    it('should deduplicate dependencies in go.mod', () => {
      const content = `
module github.com/example/myapp

require (
  github.com/foo/bar v1.0.0
  github.com/foo/bar v2.0.0
)
`;
      const result = parseGoMod(content);
      const fooNodes = result.nodes.filter((n) => n.name === 'github.com/foo/bar');
      expect(fooNodes).toHaveLength(1);
    });

    it('should handle invalid go.mod gracefully', () => {
      const result = parseGoMod(null as unknown as string);
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });
  });

  describe('dependencyGraphToGraphData', () => {
    it('should convert dependency nodes to GraphNode format', () => {
      const depGraph = {
        nodes: [
          { id: 'dep:react', name: 'react', version: '18.0.0', type: 'npm' as const },
        ],
        edges: [{ source: 'dep:root', target: 'dep:react', type: 'depends' as const, scope: 'prod' as const }],
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

    it('should set filePath to package.json for npm root node', () => {
      const depGraph = {
        nodes: [
          { id: 'dep:root', name: 'root', version: '1.0.0', type: 'npm' as const },
        ],
        edges: [{ source: 'dep:root', target: 'dep:react', type: 'depends' as const, scope: 'prod' as const }],
      };
      const result = dependencyGraphToGraphData(depGraph);
      expect(result.nodes[0]!.filePath).toBe('package.json');
    });

    it('should set filePath to node_modules for npm non-root node', () => {
      const depGraph = {
        nodes: [
          { id: 'dep:react', name: 'react', version: '18.0.0', type: 'npm' as const },
        ],
        edges: [],
      };
      const result = dependencyGraphToGraphData(depGraph);
      expect(result.nodes[0]!.filePath).toBe('node_modules/react');
    });

    it('should set filePath to Cargo.toml for cargo root node', () => {
      const depGraph = {
        nodes: [
          { id: 'dep:my-crate', name: 'my-crate', version: '0.1.0', type: 'cargo' as const },
        ],
        edges: [{ source: 'dep:my-crate', target: 'dep:serde', type: 'depends' as const, scope: 'prod' as const }],
      };
      const result = dependencyGraphToGraphData(depGraph);
      expect(result.nodes[0]!.filePath).toBe('Cargo.toml');
    });

    it('should set filePath to cargo/ for cargo non-root node', () => {
      const depGraph = {
        nodes: [
          { id: 'dep:serde', name: 'serde', version: '1.0', type: 'cargo' as const },
        ],
        edges: [],
      };
      const result = dependencyGraphToGraphData(depGraph);
      expect(result.nodes[0]!.filePath).toBe('cargo/serde');
    });

    it('should set filePath to go.mod for gomod root node', () => {
      const depGraph = {
        nodes: [
          { id: 'dep:myapp', name: 'myapp', version: 'v1.0.0', type: 'gomod' as const },
        ],
        edges: [{ source: 'dep:myapp', target: 'dep:gin', type: 'depends' as const, scope: 'prod' as const }],
      };
      const result = dependencyGraphToGraphData(depGraph);
      expect(result.nodes[0]!.filePath).toBe('go.mod');
    });

    it('should set filePath to go/ for gomod non-root node', () => {
      const depGraph = {
        nodes: [
          { id: 'dep:gin', name: 'gin', version: 'v1.9.0', type: 'gomod' as const },
        ],
        edges: [],
      };
      const result = dependencyGraphToGraphData(depGraph);
      expect(result.nodes[0]!.filePath).toBe('go/gin');
    });

    it('should set filePath to name for pip type node', () => {
      const depGraph = {
        nodes: [
          { id: 'dep:flask', name: 'flask', version: '2.0.0', type: 'pip' as const },
        ],
        edges: [],
      };
      const result = dependencyGraphToGraphData(depGraph);
      expect(result.nodes[0]!.filePath).toBe('flask');
    });

    it('should include scope in edge properties', () => {
      const depGraph = {
        nodes: [
          { id: 'dep:root', name: 'root', version: '1.0.0', type: 'npm' as const },
          { id: 'dep:devtool', name: 'devtool', version: '1.0.0', type: 'npm' as const },
        ],
        edges: [{ source: 'dep:root', target: 'dep:devtool', type: 'depends' as const, scope: 'dev' as const }],
      };
      const result = dependencyGraphToGraphData(depGraph);
      expect(result.edges[0]!.properties.scope).toBe('dev');
    });
  });
});