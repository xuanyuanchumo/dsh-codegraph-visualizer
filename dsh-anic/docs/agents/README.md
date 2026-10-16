# dsh-anic 开发文档（docs/agents）

> 本目录是 `dsh-anic` 插件的开发文档族。所有事实均从源码读出并标注 `文件:行号`；无法从源码验证的写「未验证」。
>
> 读取本文件的时机：第一次接触本工程，或需要判断某个问题该查哪一册时。

## 文档地图

| 文件 | 覆盖 | 什么时候读 |
| --- | --- | --- |
| [架构总览.md](架构总览.md) | 真实模块布局（`src/host` / `src/client` / `src/shared` / `src/adapters`）、单向依赖方向、host/client 编译隔离 | 新增模块、判断一段代码该放哪半边、理解依赖边界时 |
| [开发规范.md](开发规范.md) | 规范总览表 + §0–§3：单文件 ≤250 行、一域一文件、路由按端点拆 | 新增文件或新增路由时；想知道「哪条规范真的会拦我」 |
| [开发规范-守卫与约束.md](开发规范-守卫与约束.md) | §4–§9：日志、i18n、CSS 前缀、ESM 扩展名、G-IND 独立性、DSH 清单 + 新增文件清单 | 新增日志/文本/样式/import，或判断跨工程引用是否越界时 |
| [API参考.md](API参考.md) | HTTP 面**索引与公共约定**：注册机制、请求/响应形状、状态码语义、无工作区解析链、磁盘形状、47 端点总索引 | 需要知道端点属于哪一册，或公共形状/状态码语义时 |
| [API参考-数据面.md](API参考-数据面.md) | data 域 4 端点：snapshot / step-trace / self-check / self-init | 调用或修改数据面端点时 |
| [API参考-周期面.md](API参考-周期面.md) | cycle 域 13 端点：cycle / ledger / stack-probe / seg-ledger | 调用或修改周期状态机、账本、技术栈探测时 |
| [API参考-评审进化与治理.md](API参考-评审进化与治理.md) | review + evolution + governance + native，16 端点 | 调用或修改评审、自治、治理、原生脚本面时 |
| [API参考-自举与技能.md](API参考-自举与技能.md) | self（自举 / skill / install）+ dual + truth-audit，14 端点 | 调用或修改自举、技能网关、安装、双自举时 |
| [测试指南.md](测试指南.md) | 四层金字塔的实际配置、每层能看/看不到什么、守卫测试三条纪律、变更探针纪律 | 新增测试、判断缺陷该由哪层拦、写守卫测试时 |
| [设计令牌与主题.md](设计令牌与主题.md) | `src/shared/tokens.ts` 的 PALETTE→SEMANTIC 两层模型、`token()`、`tokenCssBlock()`、注入点、守卫与**当前落地程度** | 新增颜色、新增内联样式、暗色适配时 |

## 三条必读前提

1. **这是独立工程**（`dsh-anic/CLAUDE.md:3`）：源码零依赖父项目 `src/`（G-IND 守卫），当前借用父工程 `node_modules` 是过渡态 TD-A1。**但 G-IND 目前没有机械守卫**，只有散文注释 —— 详见 [开发规范-守卫与约束.md](开发规范-守卫与约束.md) §8。
2. **`dist/` 惰性**：第 1 层（`validate-dsh.mjs`）与第 3 层（`offline-smoke.mjs`）都读 `dist/`，改了 `src/` 必须**先 build** 才能观察到变化。
3. **文档与代码的落差是记录项，不是缺陷声明**：本族文档如实标注了若干「规范写了但实践未完全遵守」之处（i18n、CSS 前缀、令牌迁移范围、G-IND）。每处都给出了具体证据与行号，**不代为辩解**。

## 快速上手

```bash
pnpm run build       # client bundle + host bundle（tsdown）
pnpm run typecheck   # tsconfig.client + tsconfig.host（向上查父工程 tsc）
pnpm run test        # 第 1–3 层：validate + vitest + smoke
pnpm run lint        # = validate-dsh.mjs（DSH 规范符合性门）
pnpm run j0          # 第 4 层：真实宿主 J0 探针（需先 test:dsh:start）
```

完整命令与每层的边界见 [测试指南.md](测试指南.md) §6。

## 相关文档（本目录之外）

- `dsh-anic/CLAUDE.md` —— 工程约定与「Things the agent gets wrong」清单
- `dsh-anic/assets/skill/references/` —— ANIC 方法论参考（脚本接口、质量评审、playbook、状态流转、评估维度等）
