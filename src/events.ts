// DSH Event declarations with declaration merging
import type { CordisEventMap } from '@deepseek-cordis/plugin';

declare module '@deepseek-cordis/plugin' {
  interface CordisEventMap {
    'codegraph/repo/imported': {
      repoId: string;
      path: string;
      timestamp: number;
    };
    'codegraph/repo/scanned': {
      repoId: string;
      fileCount: number;
      timestamp: number;
    };
    'codegraph/graph/updated': {
      repoId: string;
      nodeCount: number;
      edgeCount: number;
      delta: {
        addedNodes: number;
        removedNodes: number;
        addedEdges: number;
        removedEdges: number;
      };
    };
    'codegraph/search/result': {
      query: string;
      results: Array<{
        nodeId: string;
        label: string;
        filePath: string;
        score: number;
      }>;
    };
    'codegraph/nav/jump': {
      symbolId: string;
      filePath: string;
      lineNumber: number;
    };
  }
}

export type CodegraphEvent = CordisEventMap['codegraph/repo/imported'] | 
  CordisEventMap['codegraph/repo/scanned'] | 
  CordisEventMap['codegraph/graph/updated'] | 
  CordisEventMap['codegraph/search/result'] | 
  CordisEventMap['codegraph/nav/jump'];