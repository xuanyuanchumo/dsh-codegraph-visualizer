/**
 * 把本插件的 11 个 `graph_*` 工具注册成一条**运行时 Skill**（`ctx.skills.register`）。
 *
 * ## 为什么需要这条 Skill（而工具描述不够）
 *
 * 工具描述只回答「这个工具做什么」，回答不了「什么时候该用它」。DSH 的模型侧工具目录
 * 每条只给 name + description，模型在「我要在代码库里找某段逻辑」时并不知道仓库里还有一个
 * 可查询的图 —— 除非有人在指令层告诉它。这正是 Skill 的定位：**可选的指令，不是会话事件**
 * （kb `site/reference/subsystems/skills.md:9`）。
 *
 * 本仓的 11 个工具全部带 `presentCall` / `presentResult`（`src/tools.ts`），所以「轨迹里
 * 能看到本插件的调用」在**契约层**已经成立；缺的是**触发**：模型不知道何时挑它们。
 * 用户 objective #3 的「DSH 大模型使用时 dsh 的轨迹要有本技能插件的调用」因此是两件事：
 * 可见性（已有）+ 可发现性（本文件）。
 *
 * ## 契约依据（逐条核验自 dsh-plugin-dev-kb 知识库）
 *
 * - `ctx.skills.register(skill: SkillRegistration): () => void`
 *   —— kb `site/reference/subsystems/skills.md:299`。JSDoc 原文：
 *   「Register a borrowed readonly runtime skill into the calling context's layer...
 *    Same-name runtime entries in one layer are first-wins; a duplicate logs a warning
 *    and receives a no-op disposer so it cannot remove the winner.」
 *   因此**重复注册不会抛错**，也不会顶掉别人 —— 这让注入失败时的降级是安全的。
 * - `SkillRegistration` 的必填字段只有 `name` / `description` / `content`
 *   （`SkillDefinition` 去掉 `invocation` 与 `provider` 两项可选后，
 *   kb 同文件 :183-190）。`invocation` 省略 = 模型与用户两侧都可见（`:132`）。
 * - 「Project entries outrank runtime entries, which outrank user entries, within one layer」
 *   —— 运行时条目在**同一层内**排最后。所以用户在 `.dsh/skills/` 里放同名 skill
 *   会胜出，本条目不会与之冲突。这是刻意的：插件提供的是默认指令，项目可以覆盖。
 *
 * ## 为什么用响应式 `ctx.inject(['skills'], …)` 而不是在 apply 里 `ctx.get`
 *
 * 与 `src/client/integrations/CommandUiIntegration.ts` 同一条教训（cycle-83 结构性修复）：
 * `ctx.get(name, strict = true)` 只返回**提供者 fiber 当前 active** 的实现
 * （`cordis/lib/index.js` 的 `_getImpl`，`reflect.d.ts:16`）。宿主侧 `skills` 由
 * `dsh-skill` bundle 行提供，它的 fiber 在本插件 `apply()` 的那一瞬间可能仍在 loading
 * （state 1），一次性探测会把「稍后可用」判成「不存在」，整条 Skill 贡献永久丢失，
 * 而且**不报错**。`ctx.inject` 的回调在依赖到齐后才跑，服务被替换时会先卸载旧 scope
 * 再重跑，依赖永不出现时回调永不执行且不阻塞父插件 apply。
 *
 * 注意：这里**不**把 `skills` 写进静态 `inject`。静态 inject 必须全部满足，否则整个插件
 * 被置为 INACTIVE —— 拿「一条可选 Skill」换「插件不加载」是不可接受的取舍
 * （与 `src/client/index.ts:36` 对 `betterSidebar`/`commandUi` 的处置同源）。
 *
 * 零第三方依赖，只依赖一个可选的宿主服务。
 *
 * @module host/skills
 */

import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../shared/Logger.ts';

const log = scoped('host');

/** 运行时 Skill 的名字（kebab-case，与工具前缀一致，便于模型联想）。 */
export const GRAPH_SKILL_NAME = 'codegraph-visualizer';

/**
 * Skill 正文。
 *
 * 写作原则（照 `agent-experience` 的做法）：**先给触发条件，再给选择表，最后给禁忌**。
 * 模型读这段是为了「决定要不要调用」，不是为了「学习 API」；API 细节留在工具描述里，
 * 重复一遍只会挤占上下文。
 */
const SKILL_CONTENT = `# 代码图谱（dsh-codegraph-visualizer）

本仓库的代码关系图可以通过 \`graph_*\` 系列工具**查询**，而不是先 grep 再逐个读文件。
图由三部分合成：上游 codegraph 索引（SQLite edges 表）、上游 lens 分析、以及内置的
manifest 依赖解析。三者都没有时插件仍可提供 AST 解析（\`/ast\`、\`/outline\`），
但**没有**图数据 —— 此时这些工具会返回"没有图"，那不是错误，是能力位如实上报。

## 什么时候用

按优先级从高到低：

1. **"谁调用了 X" / "X 调用了谁" / "改这个函数会影响什么"**
   → \`graph_impact\`（影响面）或 \`graph_path_find\`（两点间最短调用路径）。
   这比 grep 函数名可靠，因为 grep 会命中注释、字符串、同名不同作用域。
2. **"这个仓库是怎么组织的" / "模块之间怎么依赖"**
   → \`graph_data\` 取合并图，再 \`graph_query\` 用关键词定位到具体子图。
3. **"有没有循环依赖" / "死代码" / "哪些函数是核心"**
   → \`graph_cycles\` / \`graph_health\` / \`graph_rules_check\`。
4. **"用几个关键词找一段逻辑"**（不确定符号名）
   → \`graph_query\`。它做的是：关键词 → 种子（精确 > 前缀 > 子串 > 文件路径）→
   有界子图 → **token 预算内**的文本摘要。中文关键词同样支持。
   结果里的 \`truncated: true\` 表示摘要被截断了 —— 那是预算限制，不是"没有更多内容"，
   要更多就提高 \`tokenBudget\` 或缩小 \`depth\`。
5. **"这个节点到底是什么"** → \`graph_symbol\`（按 id 取详情）。
6. **"只看这一个节点附近，别把整张图铺开"** → \`graph_focus\`（焦点 + 深度上下文）。
   它是"在图上做一次局部放大"，不是筛选 —— 筛选请用界面，查询请用 \`graph_query\`。

## 用法纪律

- **先 \`graph_status\` 再别的**：它告诉你这个仓库有没有图。没有就别继续，改用读文件。
- \`repoId\` 通常是工作区路径。用 \`graph_status\` 的返回确认。
- 大图不要一次要全部：\`graph_data\` 是合并图，可能很大；优先 \`graph_query\` 的
  预算内子图，再按需 \`graph_path_find\` 取精确路径。
- 路径读法（\`graph_path_enumerate\` / \`graph_cycles\`）返回的是**路径规则**的结果，
  \`lMin\`/\`lMax\` 是边数而非节点数，且受 \`maxPaths\` 的 **DFS 序**截断
  （不是"最相关的 N 条"）。要权重排序需显式声明，当前不支持。

## 不要做

- 不要用 \`graph_*\` 替代读源码：图回答"关系"，不回答"实现细节"。
- 不要在没确认 \`graph_status\` 时说"图里没有 X" —— 没有图时所有查询都是空的，
  那与"X 不存在"是两件事。
- 不要把这里的节点 id 当成文件路径；用它去 \`graph_symbol\` 取 \`filePath\`。
`;

/** 注册结果，供调用方与测试断言（不注册也要给出可诊断的原因）。 */
export interface SkillContribution {
  /** 是否真的调用到了 `ctx.skills.register`。 */
  readonly registered: boolean;
  /** 未注册时的原因（仅在 `registered === false` 时有值）。 */
  readonly reason?: string;
}

/**
 * 贡献运行时 Skill。
 *
 * 返回 `SkillContribution` 是给测试与调用方看的**判定证据**：拿不到注册就等于模型侧
 * 没有这条指令，而那种失败是完全静默的（`ctx.inject` 的回调永不执行）。
 */
export function contributeGraphSkill(ctx: Context): SkillContribution {
  let outcome: SkillContribution = { registered: false, reason: 'ctx.inject 尚未执行（依赖未到齐）' };

  try {
    ctx.inject(['skills'], (scope) => {
      const skills = (scope as unknown as {
        skills?: { register?: (skill: unknown) => unknown };
      }).skills;
      // 服务在但形状不对：这属于宿主换代导致的契约变化，必须响亮而不是静默跳过。
      if (!skills || typeof skills.register !== 'function') {
        outcome = { registered: false, reason: 'skills 服务存在但没有 register 方法' };
        log.warn('codegraph skill not contributed: ctx.skills.register is missing');
        return;
      }
      try {
        const disposer = skills.register({
          name: GRAPH_SKILL_NAME,
          description:
            'Query the repository code graph (callers, callees, impact, cycles, dead code, keyword subgraph) instead of grepping. Use when asked about code relationships, dependency structure, or "what breaks if I change X".',
          content: SKILL_CONTENT,
          // 刻意不传 invocation：省略 = 模型与用户两侧都可见（kb skills.md:132）。
          // 只给模型侧会让人在 `/` 面板里找不到它，而这条指令对人同样有用。
        });
        // `register` 在「同层同名」时返回 **no-op disposer** 而不是抛错
        // （kb skills.md:299-303），所以拿到 disposer ≠ 一定是首次注册成功。
        // 我们无法从返回值区分这两者，如实记一条日志即可 —— 不要为此编造一个
        // 「已注册」的更强断言。
        if (typeof disposer === 'function') {
          scope.effect(() => disposer as () => void, 'codegraph: runtime skill');
        }
        outcome = { registered: true };
        log.info('codegraph runtime skill contributed', { name: GRAPH_SKILL_NAME });
      } catch (e) {
        outcome = { registered: false, reason: `skills.register 抛错: ${errorText(e)}` };
        log.warn('codegraph skill registration failed', { reason: outcome.reason });
      }
    });
  } catch (e) {
    outcome = { registered: false, reason: `ctx.inject 抛错: ${errorText(e)}` };
    log.warn('codegraph skill injection failed', { reason: outcome.reason });
  }

  return outcome;
}

/** 把未知异常压成一行文本（日志里不放 Error 对象，避免序列化噪音）。 */
function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return String(e);
  } catch {
    return 'unknown error';
  }
}
