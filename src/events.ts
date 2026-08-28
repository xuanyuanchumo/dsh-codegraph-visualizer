// DSH Event type definitions
// These are the event types for the codegraph plugin

export interface CodegraphRepoImportedEvent {
  repoId: string;
  path: string;
  timestamp: number;
}

export interface CodegraphRepoScannedEvent {
  repoId: string;
  fileCount: number;
  timestamp: number;
}

export interface CodegraphGraphUpdatedEvent {
  repoId: string;
  nodeCount: number;
  edgeCount: number;
  delta: {
    addedNodes: number;
    removedNodes: number;
    addedEdges: number;
    removedEdges: number;
  };
}

export interface CodegraphSearchResultEvent {
  query: string;
  results: Array<{
    nodeId: string;
    label: string;
    filePath: string;
    score: number;
  }>;
}

export interface CodegraphNavJumpEvent {
  symbolId: string;
  filePath: string;
  lineNumber: number;
}

export type CodegraphEvent = 
  | CodegraphRepoImportedEvent
  | CodegraphRepoScannedEvent
  | CodegraphGraphUpdatedEvent
  | CodegraphSearchResultEvent
  | CodegraphNavJumpEvent;
