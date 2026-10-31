# graphify 关键词检索产品化方案（cycle-120 / T2 实施记录）

> 任务来源：objective #2「按 docs/research/ 的研究文档（graphify 研究）将研究原生落地，
> 界面设计与功能域提前合理规划」。
> 前置研究：`docs/research/graphify-研究.md`（§「把图查询当成一等输出」、P0-2 token 标定、
> 「截断必须显式」纪律）；本仓已落地部分：KeywordQueryPanel（cycle-111）、
> `graph_query` 工具（cycle-110）、CJK token 标定（1 token/字）。
> 本文是**本轮增量的实施记录**：把「预算写死 800/深度写死 2」产品化为可调控件，
> 并把 graphify 借鉴的边界写清楚（哪些抄了、哪些刻意不抄）。

## 一、本轮落地：阈值可调（「预算必须可调」是「截断必须显式」的另一半）

**问题**：面板把 `depth=2 / tokenBudget=800` 写死在 store 默认值里。用户看到
「已按 token 预算截断」时，**没有任何手段**扩大预算重试——截断成了死路。
graphify 的原文纪律是「截断必须显式**到不可能被误读**」；只提示不给手段是半截显式。

**落地**（`src/client/components/KeywordQueryPanel.tsx`）：

| 项 | 实现 |
|---|---|
| 控件 | form 内第二行两个 number input（`#cg-keywordquery-depth` / `#cg-keywordquery-budget`），a11y 完整（label + aria-label + id，`a11yFormSemantics` 守卫口径） |
| 边界单一来源 | `src/shared/constants.ts` 新增 `KEYWORD_QUERY_LIMITS`（MAX_DEPTH=5 / MIN_TOKEN_BUDGET=50 / MAX_TOKEN_BUDGET=4000 / DEFAULT_*），与宿主 `QUERY`（queryRoute.ts）同值——客户端夹紧是 UX，宿主 400 是契约 |
| 夹紧时机 | **提交时**（`clampInt`），不在 onChange 逐键夹紧——用户可能想先打完整数字再退格修正；中间态允许任意文本 |
| 调用统一 | `queryWithThresholds(raw)` 一个函数承载「按当前阈值发查询」：submit、error retry、timeout retry 三个入口共用——「两个按钮各写一份调用、retry 悄悄退回默认」正是 cycle-119「参数加了、没人传」的 UI 对应形态 |
| i18n | +3 键（tuningLabel/depthLabel/budgetLabel）× zh/en，键集对称 30/30 |
| CSS | `keyword-query-panel.css` 新增 `.cg-keywordquery-tuning` 段（token 全复用，flex-wrap 天然窄屏换行，无断点） |

**测试**（`KeywordQueryPanel.test.tsx` 20→23 例）：
1. 自定义 depth=4/budget=2000 透传到 `runKeywordQuery` 第二参；
2. 越界值**逐键不夹紧**（中间态保留）+ **提交时夹紧**（99→5、10→50）；
3. error 后 retry **沿用**用户调过的阈值（不静默回落默认）；
4. 既有 2 处提交断言同步为带默认 options 的三参形状。

### jsdom 约束校验的坑（写进用例注释）

越界值（99 > max=5）下 `fireEvent.click(submit)` 会**取消隐式提交**——jsdom（与真实浏览器
一致）对 number input 的 min/max 约束校验在 click 隐式提交路径上生效。组件自己的
onSubmit 夹紧路径要用 `fireEvent.submit(form)` 或 Enter 键（显式路径绕过约束校验）到达。
这不是组件缺陷，是夹紧设计（提交时夹紧）与浏览器原生校验的交界，两条路径都真实存在。

## 二、graphify 借鉴的边界（抄了什么、刻意不抄什么）

| graphify 原文 | 本仓取舍 | 理由 |
|---|---|---|
| 「图查询当一等输出」+ token 预算内截断 | ✅ 已抄（`graph_query` + `/query` + 面板，cycle-110/111） | 与本仓「预算内子图」完全同构 |
| 「截断必须显式」 | ✅ 已抄并扩展（本轮补「可调」——只提示不给手段是半截显式） | 显式的目的可达成 |
| CJK token `len/3` 估算 | ❌ 不抄，独立标定 1 token/字（cycle-110） | graphify 系数按英文校准，中文少算 2-3 倍（研究 §14.3-3 推断，已按本项目口径标定） |
| `confidence_score` 参与种子排序 | ⚠️ 部分对应（本仓 confidence 进 `GraphEdge.weight` → top-k-weight 路径截断，cycle-119） | 种子排序本仓用**标签匹配分**（精确>前缀>子串>路径），confidence 是**边**的置信不是节点的——语义不同，不混 |
| 六级 dedup 管道 / Leiden 社区 / minhash | ❌ 不抄 | 本仓图谱来自上游索引（无自产重复问题）；社区发现已有 `progressiveCluster`（Barnes-Hut 路线），引入 Leiden 是第二个社区实现——违反「两个数据路径共享一个实现」教训 |
| watch 的 debounce + 防缩水 | ✅ 已对应（`INCREMENTAL_WORK_BUDGET` + `SHRINK_FLOOR` 缩水守卫，cycle-109/110） | 研究落地时已完成 |

## 三、后续可选方向（登记，不实施）

- **阈值持久化**：当前 depthDraft/budgetDraft 是组件本地 state，面板关闭即回落默认。
  若要跨会话记住偏好，走 `graphStore` 的 persist 白名单（与主题/语言同通道）——
  **待消费信号**（用户反馈「每次都要调」）再实施，YAGNI。
- **预算即视**：把 `KEYWORD_QUERY_LIMITS.MAX_TOKEN_BUDGET` 的 4000 显示在控件旁
  （「≤4000」），减少试错。低成本，待 i18n 文案评审一起做。

## 四、复现命令

```bash
npx vitest run tests/component/KeywordQueryPanel.test.tsx   # 23 例（含 3 例阈值控件）
npx vitest run tests/unit/keywordQueryApi.test.ts tests/unit/queryRoute.test.ts  # 55 例（store/route 兼容）
pnpm run typecheck   # KEYWORD_QUERY_LIMITS 单一来源的两端引用
```
