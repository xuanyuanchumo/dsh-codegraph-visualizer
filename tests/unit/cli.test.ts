import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import type { GraphData } from '../../src/types/index.ts';
import { makeNode, makeEdge, makeGraphData } from '../helpers.ts';

vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

vi.mock('../../src/tools.ts', () => ({
  fetchMergedGraph: vi.fn(),
}));

const { runCli } = await import('../../src/host/cli.ts');
const { fetchMergedGraph } = await import('../../src/tools.ts');
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedFetchMergedGraph = vi.mocked(fetchMergedGraph);

describe('runCli', () => {
  const originalExit = process.exit;
  const originalCwd = process.cwd;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exit = vi.fn((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as unknown as typeof process.exit;
    console.error = vi.fn();
    console.log = vi.fn();
  });

  afterEach(() => {
    process.exit = originalExit;
    process.cwd = originalCwd;
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
  });

  const sampleGraph: GraphData = makeGraphData(
    [
      makeNode('n1', 'funcA', 'function', 'src/a.ts', 1),
      makeNode('n2', 'funcB', 'function', 'src/b.ts', 5),
      makeNode('n3', 'MyClass', 'class', 'src/c.ts', 10),
    ],
    [
      makeEdge('e1', 'n1', 'n2', 'call'),
      makeEdge('e2', 'n3', 'n1', 'extend'),
    ],
  );

  it('generates JSON report by default', async () => {
    mockedFetchMergedGraph.mockResolvedValue(sampleGraph);
    await runCli([]);
    expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);
    const [path, content] = mockedWriteFileSync.mock.calls[0]!;
    expect(String(path)).toContain('codegraph-report.json');
    const report = JSON.parse(String(content));
    expect(report.summary.totalNodes).toBe(3);
    expect(report.summary.totalEdges).toBe(2);
    expect(report.summary.nodeTypes.function).toBe(2);
    expect(report.summary.nodeTypes.class).toBe(1);
    expect(report.summary.edgeTypes.call).toBe(1);
    expect(report.summary.edgeTypes.extend).toBe(1);
  });

  it('generates HTML report with --format html', async () => {
    mockedFetchMergedGraph.mockResolvedValue(sampleGraph);
    await runCli(['--format', 'html']);
    expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);
    const [path, content] = mockedWriteFileSync.mock.calls[0]!;
    expect(String(path)).toContain('codegraph-report.html');
    const html = String(content);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('CodeGraph Architecture Report');
    expect(html).toContain('Total Nodes');
    expect(html).toContain('funcA');
  });

  it('respects --output flag', async () => {
    mockedFetchMergedGraph.mockResolvedValue(sampleGraph);
    await runCli(['--output', 'my-report', '--format', 'json']);
    const [path] = mockedWriteFileSync.mock.calls[0]!;
    expect(String(path)).toContain('my-report.json');
  });

  it('respects -o short flag', async () => {
    mockedFetchMergedGraph.mockResolvedValue(sampleGraph);
    await runCli(['-o', 'short-report']);
    const [path] = mockedWriteFileSync.mock.calls[0]!;
    expect(String(path)).toContain('short-report.json');
  });

  it('respects --workspace flag', async () => {
    mockedFetchMergedGraph.mockResolvedValue(sampleGraph);
    await runCli(['--workspace', '/my/workspace']);
    expect(mockedFetchMergedGraph).toHaveBeenCalledWith(expect.any(Function), '/my/workspace', 'both');
  });

  it('respects -w short flag', async () => {
    mockedFetchMergedGraph.mockResolvedValue(sampleGraph);
    await runCli(['-w', '/ws']);
    expect(mockedFetchMergedGraph).toHaveBeenCalledWith(expect.any(Function), '/ws', 'both');
  });

  it('respects -f short flag for html', async () => {
    mockedFetchMergedGraph.mockResolvedValue(sampleGraph);
    await runCli(['-f', 'html']);
    const [path] = mockedWriteFileSync.mock.calls[0]!;
    expect(String(path)).toContain('.html');
  });

  it('ignores invalid format value', async () => {
    mockedFetchMergedGraph.mockResolvedValue(sampleGraph);
    await runCli(['--format', 'xml']);
    const [path] = mockedWriteFileSync.mock.calls[0]!;
    expect(String(path)).toContain('.json');
  });

  it('exits with code 1 when no graph data', async () => {
    mockedFetchMergedGraph.mockResolvedValue(makeGraphData([], []));
    await expect(runCli([])).rejects.toThrow('process.exit(1)');
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });

  it('generates report when edges exist but no nodes', async () => {
    mockedFetchMergedGraph.mockResolvedValue(makeGraphData([], [makeEdge('e1', 'n1', 'n2', 'call')]));
    await runCli([]);
    expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);
  });

  it('HTML report escapes HTML special characters in repoId', async () => {
    const graph = makeGraphData(
      [makeNode('n1', '<script>', 'function', 'a.ts', 1)],
      [],
      'repo<>"\'',
    );
    mockedFetchMergedGraph.mockResolvedValue(graph);
    await runCli(['--format', 'html']);
    const [, content] = mockedWriteFileSync.mock.calls[0]!;
    const html = String(content);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('JSON report includes top connected nodes', async () => {
    const nodes = [
      makeNode('n1', 'hub', 'function', 'a.ts', 1),
      makeNode('n2', 'spoke1', 'function', 'b.ts', 2),
      makeNode('n3', 'spoke2', 'function', 'c.ts', 3),
    ];
    const edges = [
      makeEdge('e1', 'n1', 'n2', 'call'),
      makeEdge('e2', 'n1', 'n3', 'call'),
    ];
    mockedFetchMergedGraph.mockResolvedValue(makeGraphData(nodes, edges));
    await runCli([]);
    const [, content] = mockedWriteFileSync.mock.calls[0]!;
    const report = JSON.parse(String(content));
    expect(report.summary.topConnectedNodes[0].label).toBe('hub');
    expect(report.summary.topConnectedNodes[0].connections).toBe(2);
  });
});