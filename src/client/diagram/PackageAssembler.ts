import { HierarchicalAssembler, type HierarchicalAssemblerConfig } from './HierarchicalAssembler.ts';

function getDirectory(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) return '/';
  return normalized.substring(0, lastSlash);
}

function getPackageLabel(dir: string): string {
  if (dir === '/') return 'root';
  const parts = dir.split('/');
  return parts[parts.length - 1] ?? dir;
}

export class PackageAssembler extends HierarchicalAssembler {
  protected config: HierarchicalAssemblerConfig = {
    nodePrefix: 'pkg',
    edgeIdPrefix: 'pkg-edge',
    isDirProperty: 'isPackage',
    isEdgeProperty: 'isPackageEdge',
    edgeTypes: new Set(['import', 'dependency']),
    excludeTypesFromDist: new Set(['module']),
    getDirectory,
    getLabel: getPackageLabel,
  };
}
