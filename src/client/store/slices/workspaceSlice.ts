import type { GraphState } from '../types.ts';
import { UI } from '../../../shared/constants.ts';
import { internals } from '../internals.ts';

type SetFn = (partial: Partial<GraphState>) => void;
type GetFn = () => GraphState;

export function createWorkspaceSlice(_set: SetFn, _get: GetFn): Partial<GraphState> {
  return {
    currentWorkspace: '.',
    workspaceList: [],
    setCurrentWorkspace: (path) => {
      internals.incrementalClusterCtx = null;
      // 校验值是按工作区身份定域的（`computeGraphEtag(repoId, revision, resource)`），切换工作区后
      // 旧值描述的是另一个身份。留着它，下一次 `/data` 请求就可能被服务端判成 304：那时画布上
      // 还是旧工作区的图，而"没有新数据"的结论被静默接受，正是跨工作区污染换了一条路径。
      // 置 null 让下一次取数必然回 200，由身份守卫决定是否落库。
      //
      // `diffResult` 同理作废（cycle-104）：它索引的是**上一个工作区**那张图里的元素 id，
      // 换工作区后这些 id 要么不存在、要么指向语义完全不同的元素。留着它，用户会看到
      // 一堆在新画布上毫无意义的彩色边框，而面板里还显示着旧工作区的变更计数。
      _set({ currentWorkspace: path, graphEtag: null, diffResult: null });
    },
    addWorkspace: (path, name) => {
      const s = _get();
      const wsName = name ?? path.split(/[\\/]/).pop() ?? path;
      const existing = s.workspaceList.filter((w) => w.path !== path);
      internals.incrementalClusterCtx = null;
      _set({
        currentWorkspace: path,
        graphEtag: null,
        // 与 setCurrentWorkspace 同一条理由：换工作区即换图，diff 索引必须一起作废。
        diffResult: null,
        workspaceList: [{ path, name: wsName, lastUsed: Date.now() }, ...existing].slice(0, UI.WORKSPACE_LIST_MAX),
      });
    },
    removeWorkspace: (path) => {
      const s = _get();
      const removingActive = s.currentWorkspace === path;
      if (removingActive) internals.incrementalClusterCtx = null;
      _set({
        workspaceList: s.workspaceList.filter((w) => w.path !== path),
        currentWorkspace: removingActive ? '.' : s.currentWorkspace,
        // 只有"当前工作区变了"才需要作废校验值；删掉一个非当前工作区不影响画布对应的身份。
        // diff 同理：只有删掉的是当前工作区时才作废。
        ...(removingActive ? { graphEtag: null, diffResult: null } : {}),
      });
    },
  };
}