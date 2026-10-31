import type { GraphState } from '../types.ts';
import { UI } from '../../../shared/constants.ts';
import { internals } from '../internals.ts';

type SetFn = (partial: Partial<GraphState>) => void;
type GetFn = () => GraphState;

export function createWorkspaceSlice(_set: SetFn, _get: GetFn): Partial<GraphState> {
  return {
    currentWorkspace: '.',
    workspaceList: [],
    // 会话跟随态：null = 不可知（宿主未注入会话 scope）；见 types.ts 字段注释。
    sessionWorkspace: null,
    // 用户 pin 覆盖：仅驻内存（partialize 不含它），刷新后自然回到跟随态。
    pinnedWorkspace: null,
    pinWorkspace: (path) => {
      if (path === null) {
        // 解除 pin：回到跟随态。立即对齐到当前已知会话工作区（若有），
        // 让「回到会话工作区」按钮的语义一次性完成，不等下一次轮询。
        const s = _get();
        const target = s.sessionWorkspace;
        internals.incrementalClusterCtx = null;
        _set({
          pinnedWorkspace: null,
          graphEtag: null,
          diffResult: null,
          ...(target !== null && target !== s.currentWorkspace ? { currentWorkspace: target } : {}),
        });
        return;
      }
      // 手动切换 = 粘性覆盖（cycle-85：显式用户意图是粘性状态）。
      // 复用 setCurrentWorkspace 的身份失效语义（etag/diff 作废 + 集群上下文清空）。
      _get().setCurrentWorkspace(path);
      _set({ pinnedWorkspace: path });
    },
    setSessionWorkspace: (path) => {
      // 真相源写入：只在值变化时落（轮询每 15s 一次，同值写会触发无谓订阅通知）。
      if (_get().sessionWorkspace === path) return;
      _set({ sessionWorkspace: path });
    },
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