import { getTopLevelDir } from '../../shared/pathUtils.ts';
import { HierarchicalAssembler, type HierarchicalAssemblerConfig } from './HierarchicalAssembler.ts';

export class DependencyAssembler extends HierarchicalAssembler {
  protected config: HierarchicalAssemblerConfig = {
    nodePrefix: 'depdir',
    edgeIdPrefix: 'dep-edge',
    isDirProperty: 'isDependencyDir',
    isEdgeProperty: 'isDependencyEdge',
    edgeTypes: new Set(['import', 'dependency']),
    getDirectory: (filePath) => getTopLevelDir(filePath, { simplified: true }),
    getLabel: (dir) => dir === '/' ? 'root' : dir,
  };
}
