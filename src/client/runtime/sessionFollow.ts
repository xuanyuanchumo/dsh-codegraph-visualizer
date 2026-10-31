/**
 * 会话工作区跟随（session-follow）—— 图谱画布的默认工作区 = 当前对话会话的工作区。
 *
 * ## 缺陷现场（用户实测）
 *
 * 当前对话在 `dsh-codegraph-visualizer`，代码图谱面板却加载 `dsh-anic` 的图。
 * 根因有三层，修在客户端这一层（宿主侧 `/workspace` 返回 registry 首条是**服务端
 * 语义**，多会话宿主里它本来就不等于「当前对话」；客户端才是唯一知道「我现在渲染
 * 在哪个会话里」的地方）：
 *
 * 1. **`/workspace` 宿主路由**回落 `findWorkspacePath` = `workspaceRegistry[0]`
 *    （`src/host/prerequisites.ts:228`）——注册序，非会话序；
 * 2. **`WorkspaceBootstrap` 轮询**把该值强制 `setCurrentWorkspace` 覆盖用户选择；
 * 3. **面板组件从不消费会话身份**：宿主对 `conversation.view` 槽位组件注入的
 *    `sessionId` / `useSessions`（asar 实测 `ConversationContent` 解构两者；官方
 *    侧边栏文件树用 `useSessions(s => s.byId[sessionId]?.cwd)` 读当前会话工作区）
 *    被本插件完全忽略。
 *
 * ## 宿主证据（app.asar 0.2.1-rc.2 实测，dsh-client-ui-renderer/lib/client.js）
 *
 * - `standardProps(scope, …)`：会话 scope 组件自动收到 `sessionId` +
 *   `useSession` + `useProjection`；root 级另有 `useSessions` / `useWorkspaces`
 *   （`materializeStandardBinding` 把 binding.hooks/props 展平进 props）；
 * - `ui-session` 的 `BUILTIN_SOURCE`：`props: ['sessionId']`、
 *   `hooks: { session, projection }`；
 * - `useSessions` 的行对象含 `cwd`（官方 `FilesBody.tsx` 用法）；
 * - 宿主 `ConversationContent` 已在用同一条链读 cwd 渲染工作区徽标。
 *
 * ## 状态机（三态，显式优于隐式）
 *
 * - `following`：默认态。会话 cwd 变化 ⇒ 跟随切换（透明，不打扰用户）；
 * - `pinned`：用户在面板里手动切换过工作区 ⇒ 停止跟随（**用户意图是粘性状态**，
 *   cycle-85 教训：显式意图不能被一次性参数覆盖）。UI 出「回到会话工作区」入口；
 * - 刷新恢复：pin 不持久化（persist 里不写 pinnedWorkspace）——刷新后回到
 *   following，天然恢复「对话工作区」，满足「支持切换但刷新后仍恢复对话工作区」。
 *   （会话 cwd 本身由宿主持久化，刷新后 sessionId 变化由新会话的 cwd 决定。）
 *
 * ## 安全边界
 *
 * 会话 cwd 只作为 `?workspace=` 请求参数的默认值，服务端仍走同一条
 * `isPathAllowed + validatePathRealpath` 双校验（`resolveWorkspaceFromRequest`）。
 * cwd 不可用（桌面 / 旧代宿主 / sessionless 渲染）⇒ 保持现状值，绝不猜。
 */
import { useEffect } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('client:session-follow');

/** 会话工作区行（useSessions byId 行的只读子集；cwd 可缺 = 桌面/旧代宿主）。 */
export interface SessionRow {
  cwd?: string;
}

/** 从插槽 props 提取的会话身份面（结构化子集，不引宿主类型）。 */
export interface SessionScopeProps {
  sessionId?: string;
  useSessions?: (selector: (s: { byId: Record<string, SessionRow | undefined> }) => unknown) => unknown;
}

/** 宿主 scope 缺失时（dev-server / 测试 / 旧代）读不到会话 ⇒ null，调用方维持现状。 */
export function readSessionCwd(props: SessionScopeProps | undefined | null): string | null {
  const sessionId = props?.sessionId;
  const useSessions = props?.useSessions;
  if (!sessionId || typeof useSessions !== 'function') return null;
  try {
    const row = useSessions((s) => s.byId[sessionId]) as SessionRow | undefined;
    return typeof row?.cwd === 'string' && row.cwd !== '' ? row.cwd : null;
  } catch {
    return null;
  }
}

/**
 * 会话跟随副作用（在面板组件体内调用一次）。
 *
 * 行为（全部经由 store 动作，无旁路写）：
 * 1. 把会话 cwd 写进 `sessionWorkspace` 真相源（可观测性：UI/诊断可见）；
 * 2. `pinnedWorkspace === null` 且会话 cwd ≠ 当前工作区 ⇒ `pinWorkspace(cwd)`
 *    ——等等，不对：pin 是**用户**语义。这里走 `setCurrentWorkspace(cwd)`，
 *    它不改 pin；pin 只由用户的 `pinWorkspace(path)` 写入。
 * 3. cwd 不可知（null）⇒ 不动 currentWorkspace（宁缺勿猜）。
 *
 * 为什么走 `setCurrentWorkspace` 而不是新动作：切换语义（etag/diff 作废 +
 * 集群上下文清空 + DOM 事件）必须只有一份实现；跟随切换与用户切换的差异只在
 * 「是否写 pin」，由调用方决定。
 *
 * 依赖收敛：`useSessions` 是宿主注入的稳定引用（observableHook 缓存），
 * `sessionId` 变化即会话切换；selector 返回行对象，zustand 浅比较不适用——
 * 用 cwd 字符串做依赖，避免行对象每次渲染新引用导致的死循环。
 */
export function useSessionWorkspaceFollow(props: SessionScopeProps | undefined | null): string | null {
  const sessionId = props?.sessionId;
  const useSessions = props?.useSessions;
  // hook 顺序稳定：无论 props 形态如何，两条 hook 都必须被调用。
  const sessionRow = (typeof useSessions === 'function' && sessionId
    ? useSessions((s) => s.byId[sessionId])
    : undefined) as SessionRow | undefined;
  const cwd = typeof sessionRow?.cwd === 'string' && sessionRow.cwd !== '' ? sessionRow.cwd : null;

  useEffect(() => {
    const s = useGraphStore.getState();
    s.setSessionWorkspace(cwd);
    if (cwd === null) return; // 不可知 ⇒ 维持现状（不猜）
    if (s.pinnedWorkspace !== null) return; // 用户 pin ⇒ 不覆盖
    if (s.currentWorkspace === cwd) return; // 已对齐
    log.info('following session workspace', { from: s.currentWorkspace, to: cwd });
    s.setCurrentWorkspace(cwd);
  }, [cwd]);

  return cwd;
}
