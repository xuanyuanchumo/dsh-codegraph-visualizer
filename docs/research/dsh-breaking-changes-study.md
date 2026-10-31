# DSH 官方规范适配研究：cordis-api / dsh-plugin-dev-kb 破坏性变更核对（cycle-120 / T4）

> 任务来源：objective #3「研究 DSH 官方插件开发规范/API/破坏性变更，确保 DSH 宿主下限
> 版本不变定为 dsh-v0.2.0-rc.2，实现多代适配器兼容 dsh 多版本，同时兼容网页端与桌面端」。
> 证据基线：本仓 `docs/research/dsh-0.2.0-插件API权威基线.md`、`docs/research/dsh-round110-规范与破坏性变更.md`、
> `docs/research/dsh-多代API规范差异与兼容矩阵.md`、`src/shared/dshGeneration.ts` 及其契约测试、
> `docs/agents/05-DSH官方规范检索证据.md` §2.2（cycle-110 的 `engines.dsh` 纠偏）。
> 本文不做新的外部检索（既有三篇研究已覆盖），做的是**把「下限不变」的承诺逐条对到当前代码**，
> 确认 cycle-111…119 的七轮改动没有悄悄引入「只有新宿主才有」的调用。

## 一、结论

**DSH 声明下限保持 `>=0.2.0-rc.2 <0.4.0-0` 不变**。七轮改动（112…119）对本承诺的影响
逐条核对为「零破坏」，依据见 §二核对表。gen1（0.1.x）继续维持 LEGACY 容忍不承诺。

## 二、逐条核对表（下限承诺 × 当前代码）

| 承诺条目 | 当前代码证据 | 状态 |
|---|---|---|
| `engines.dsh: ">=0.2.0-rc.2 <0.4.0-0"` 是唯一真实加载门（peer 被忽略） | `package.json` engines 字段未动；`dshGeneration.test.ts` 边界探针（预发布形态）仍绿 | ✅ 未变 |
| 预发布上界写 `<X.Y.Z-0`（防 `0.4.0-rc.1` 放行） | 同上（cycle-110 修正过的范围串原样保留） | ✅ 未变 |
| `ctx.get(key, false)` 存在性探测（strict 探测会杀 loading 服务） | cycle-119 新增代码（skills/registry/topk）零 `ctx.get` 调用；既有四处 strict=false 用法未回退 | ✅ 未新增违规 |
| 可选服务走响应式 `ctx.inject`（skills / commandUi / betterSidebar） | `src/host/skills.ts` 仍为 `ctx.inject(['skills'], …)`；本轮 SKILL_CONTENT 只改**文案**未改注入机制 | ✅ 未变 |
| gen2-only 标记（pluginNavigation / userQuestionPanels）判定不变 | 未触碰 client compat 层 | ✅ 未变 |
| 平台检测惰性求值（DOM 标记 + MutationObserver，不缓存） | 未触碰 `PlatformProbe` | ✅ 未变 |
| 工具注册走 `defineTool`（参数校验 gate 由宿主包一层） | cycle-119 的 truncation 透传在 execute 内读 `a.truncation`，schema 声明在前（`tools.ts` 参数表），宿主 gate 不剥未知键 | ✅ 兼容 |
| `/status` `/health` 能力位四键（`builtin` 已移除） | cycle-118 移除别名时已按 `docs/agents/09` §9.4 判据核销；本轮零触碰 | ✅ 未变 |

## 三、本轮新增代码的宿主 API 面（全部为「既有用法复用」）

| 新增代码 | 用到的宿主 API | 新 API？ |
|---|---|---|
| `EDGE_ROW_COLUMNS` / `parseEdgeConfidence` / weight 产出 | 无（纯函数，不触宿主） | 否 |
| `topK` 排序契约修正 | 无（库内纯函数） | 否 |
| truncation 工具透传 | `defineTool` 既有参数 schema 机制 | 否 |
| KeywordQueryPanel 阈值控件 | React 既有受控 input + i18n `t()` | 否 |
| SKILL_CONTENT 更新 | 无（字符串常量） | 否 |

⇒ **本轮对宿主 API 的依赖面增量为零**——这是「下限不变」承诺成立的直接原因。

## 四、多代适配 × 双端兼容的现状矩阵（复述 + 轮次戳）

| 维度 | gen1（0.1.x） | gen2（0.2.x） | 证据轮次 |
|---|---|---|---|
| 加载门 | peer 宽松容忍（LEGACY） | `engines.dsh` 决定 | cycle-110 §61 |
| 顶部标签 | slots / floating 回退 | `conversation.view` + better-sidebar | cycle-111/115 |
| 能力位 | `graphSource` 缺省 false（旧宿主无权声称） | 四键全量 | cycle-111/118 |
| Skill | 无 skills 服务则静默不贡献 | runtime skill 注册 | cycle-111 |
| 桌面端 | 同一 bundle（`dsh.client.platform === 'web'` 才载 client 半），DOM 标记区分 | 同左 | cycle-115 |
| Web/桌面 profile | 独立 profile、独立安装（link 两次） | 同左 | cycle-115 |

## 五、遗留风险登记（不阻塞本轮）

1. **`dsh-plugin-dev-kb` 是文档镜像不是运行时**：kb 的 `site/reference/**` 描述的是
   「写文档时的宿主」，与 `engines.dsh` 上界的宿主可能再次出现「README 说 A、代码做 B」
   （cycle-110 的 `builtin` 教训）。**下次宿主升级时必须重跑 §二核对表**，不能默认仍成立。
2. **桌面 App UI DOM 标记**仍是 CDP 受限通道（维持 cycle-115 判定）：真机桌面验证依赖
   `start-dsh-test.mjs` 的 Electron 形态，本轮未启动桌面宿主（web 侧已验，见任务清单 T5）。

## 六、复现命令

```bash
# 下限边界探针（预发布形态）
npx vitest run tests/unit/dshGeneration.test.ts
# gen2-only 服务判定
npx vitest run tests/unit/generation/serviceProbeContract.test.ts
# 能力位四键契约（builtin 已移除的防复发守卫）
npx vitest run tests/unit/builtinAliasRemoval.test.ts
```
