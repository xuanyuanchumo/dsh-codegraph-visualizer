import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyScopedGraphPayload } from '../../../src/client/runtime/repoScope.ts';
import { logger } from '../../../src/shared/Logger.ts';
import type { GraphData } from '../../../src/types/index.ts';

/**
 * `applyScopedGraphPayload` 是运行时**唯一**的图负载落库通道（P0-R16-01 结构性收口）。
 * 这些用例把"什么负载会被写进画布"钉死在通道内部，避免以后再出现"某个新增监听器忘了判身份"
 * 而漏网（Round 15 的 SSE `graph-updated` 就是这样漏的）。
 */
function payload(repoId: string, nodeCount = 1): GraphData {
  return {
    nodes: Array.from({ length: nodeCount }, (_, i) => ({
      id: `n${i}`,
      label: 'A',
      type: 'function',
      filePath: 'a.ts',
      lineNumber: 1,
      properties: {},
    })),
    edges: [],
    metadata: { repoId, timestamp: 1, nodeCount, edgeCount: 0 },
  } as unknown as GraphData;
}

describe('applyScopedGraphPayload', () => {
  const sink = { setGraphData: vi.fn() };

  beforeEach(() => {
    sink.setGraphData.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies a payload from the scoped workspace', () => {
    const data = payload('/repo/a');
    expect(applyScopedGraphPayload(sink, data, '/repo/a', 'test')).toBe(true);
    expect(sink.setGraphData).toHaveBeenCalledWith(data.nodes, data.edges, '/repo/a', data.metadata);
  });

  it('drops a payload from another workspace and logs why', () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    expect(applyScopedGraphPayload(sink, payload('/repo/b'), '/repo/a', 'test source')).toBe(false);
    expect(sink.setGraphData).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith('client', 'test source ignored for another workspace', {
      repoId: '/repo/b',
      activeRepoId: '/repo/a',
    });
  });

  it('drops a null payload', () => {
    expect(applyScopedGraphPayload(sink, null, '/repo/a', 'test')).toBe(false);
    expect(sink.setGraphData).not.toHaveBeenCalled();
  });

  it('drops a payload with no nodes', () => {
    expect(applyScopedGraphPayload(sink, payload('/repo/a', 0), '/repo/a', 'test')).toBe(false);
    expect(sink.setGraphData).not.toHaveBeenCalled();
  });

  it('applies when the scope has no identity yet', () => {
    expect(applyScopedGraphPayload(sink, payload('/repo/b'), null, 'test')).toBe(true);
    expect(sink.setGraphData).toHaveBeenCalled();
  });

  it('applies when the payload carries no repoId', () => {
    expect(applyScopedGraphPayload(sink, payload(''), '/repo/a', 'test')).toBe(true);
    expect(sink.setGraphData).toHaveBeenCalled();
  });

  // P0-R16-02：校验值必须与负载**同一次**落库。分开写会出现"画布已是新版、校验值还是旧版"
  // 的窗口，下一次请求就被判成 304，真实更新被静默吞掉。
  it('folds the etag into the same setGraphData call as the payload', () => {
    const data = payload('/repo/a');
    expect(applyScopedGraphPayload(sink, data, '/repo/a', 'test', 'W/"1-new"')).toBe(true);
    expect(sink.setGraphData).toHaveBeenCalledWith(data.nodes, data.edges, '/repo/a', {
      ...data.metadata,
      etag: 'W/"1-new"',
    });
  });

  // 没有校验值的通道（`graph-data` 直推）必须保留原 `metadata` 对象引用不变：调用方
  // （`SSEEvents`）按引用传的是同一个对象，多造一个浅拷贝会让断言与下游比较都漂移。
  it('leaves the metadata object untouched when there is no etag', () => {
    const data = payload('/repo/a');
    expect(applyScopedGraphPayload(sink, data, '/repo/a', 'test', undefined)).toBe(true);
    expect(sink.setGraphData).toHaveBeenCalledWith(data.nodes, data.edges, '/repo/a', data.metadata);
  });

  // `null` 与 `undefined` 语义不同：`null` 表示"这次响应确实没有校验值"，必须写进 metadata
  // 把旧值抹掉；`undefined` 表示"这条通道不谈校验值"，保持原样。
  it('clears a stale etag when the response carries null', () => {
    const data = payload('/repo/a');
    expect(applyScopedGraphPayload(sink, data, '/repo/a', 'test', null)).toBe(true);
    expect(sink.setGraphData).toHaveBeenCalledWith(data.nodes, data.edges, '/repo/a', {
      ...data.metadata,
      etag: null,
    });
  });
});
