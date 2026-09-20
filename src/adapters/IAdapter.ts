import type { AdapterResult, DataSourceType } from '../types/index.ts';

export type UpstreamInvoker = (tool: string, args: Record<string, unknown>) => Promise<unknown | null>;

export interface IAdapter {
  readonly source: DataSourceType;
}

export interface IDataAdapter extends IAdapter {
  fetchData(repoId: string, invoke?: UpstreamInvoker): Promise<AdapterResult>;
}

export interface IAnalysisAdapter extends IAdapter {
  init(): Promise<void>;
  isAvailable(): boolean;
  parseFile(filePath: string, content: string): Promise<AdapterResult>;
  destroy(): void;
}