# M0-① Spike 报告 — conversation.view 标签渲染真实工作流图

**状态：机制级 PASS（冒烟 19/19，含热更新断言），已安装 web profile，真实宿主 J0 待用户重启验证** ｜ 日期：2026-10-13 ｜ 工程落点：[`dsh-anic/`](../../../dsh-anic/)（独立插件工程，非宿主项目内切片）

## 0. 结论先行

| 问题 | 判定 | 依据 |
|---|---|---|
| `conversation.view` 能否承载 ANIC 工作流图？ | **机制级 GO** | stub 宿主复现加载契约全链；真实宿主六步 J0 协议已交付（[dsh-anic/README.md](../../../dsh-anic/README.md)） |
| 76-cycle 量级（138 节点/164 边）能否渲染？ | **是**（SVG 零依赖） | 机制冒烟 138 circle/164 line 精确计数；布局引擎留待 M3 读路径再评估 |
| 插件该放哪？ | **独立工程 `dsh-anic/`** | 用户裁决（m02766/m02788/m02810）：技能插件不放项目插件里；命名符合 DSH 规范（包名=目录名=`dsh-anic`） |
| 失败动作（01 §8 ①）是否触发？ | **否** | 标签可见性/交互的最终判定仍需真实宿主，但机制层无阻断点 |

## 1. 形态（用户三次方向纠正后的终态）

1. ~~宿主项目 `src/client/` 临时 spike~~ → 用户：**技能插件不应放项目插件里**（src/ 零变更，已删）。
2. ~~`.anic-skill-evo/` 临时独立包~~ → 该目录定性为**评测产物区**（契约套件/基准/技能快照）。
3. **终态：`dsh-anic/` 独立工程**（自持 package.json/tsconfig/scripts/dist；typecheck 客户端-宿主分立；不 import 父项目源码）。

## 2. 机制验证（offline-smoke.mjs，17 断言全过）

stub 复现 DSH web 加载契约：`window.__ModuleLoader__.load({id:'dsh-anic', factory(require)})`，
`require('react')` 由 stub 提供，`ctx.slots` 用记录器实现 `inject/register`（register 返回 disposer）：

- exports 形状：`name='dsh-anic-client'`、`inject=['slots']`、`apply`；
- 注册路径：`ctx.slots.inject('conversation.view', cb)` 回调内 `register` **恰一次**；
  def = `{name:'conversation.view', id:'anic-workflow-tab', order:101, label:()=>'ANIC'}`；
- 渲染量级：**138 circle + 164 line**（= 快照 counts，数据驱动断言）；
- dispose 语义：`unregister()` → disposer 调用 + `registered=false`；`reregister()` → 第二次注册；
- kill-switch：`localStorage['anic-workflow-tab']='off'` → `skipped='flag-off'` 零注册；
- 遥测：`window.__ANIC_TAB_SPIKE__` 的 nodes/edges/autonomy 与快照一致。

## 3. 两个真缺陷（调试中修复，均为冒烟器问题非插件缺陷）

1. **函数组件不展开** → circle/line 计 0：元素树遍历必须调用 `node.type(node.props)` 再遍历。
2. **数组参数嵌套** → stub `createElement(type, props, ...children)` 把数组子元素记成
   `children: [[...]]`，不展开数组层则深层节点永远不可见。两条都已修进
   `dsh-anic/scripts/offline-smoke.mjs` 的 `countType`/红圈 walker。

## 4. 真实宿主 J0 协议（已安装 web profile，待用户重启验证）

**安装已完成（2026-10-13）**：按用户要求（「先像 dsh-codegraph-visualizer 一样网页端安装测试，
后续我再重启桌面端」）以父插件同款 `link:` 形态装入 `%USERPROFILE%\.dsh\profiles\web\`：
`dependencies["dsh-anic"]="link:D:/Projects/TraeProjects/dsh-codegraph-visualizer/dsh-anic"`
+ `dsh.profile.bundles` 追加 `dsh-anic` + `pnpm install`。验证：Junction 指向本工程、
`node_modules/dsh-anic/{dist/client.js,dist/host.js,package.json,locale/icon}` 经链接可达、
served bundle `node --check` 通过、父插件链接未受影响（`-2` 包为 pnpm 剪枝非破坏）。

**热加载与热更新三层**（用户要求「技能插件要有热加载和热更新等功能」，全部落地）：

1. **bundle 热更新**：`link:` 安装下宿主加载的就是 `dist/client.js` 本体；
   `pnpm --dir dsh-anic run build:watch`（tsdown `--watch` + fs.watch 自动重 wrap）——
   保存源码 → 浏览器刷新即生效，无需重装/重启宿主。
2. **数据热更新**：宿主路由 `GET /anic/api/workflow-snapshot` 每次请求现场读当前工区
   `.cycles/`（`src/shared/snapshotCore.ts` 与生成器唯一实现共享）；面板挂载即拉 live +
   「刷新」按钮；路由缺失/404/5xx/无 fetch → 回退嵌入快照且底行如实标注来源（fail-open
   家族教训：回退不得伪装成 live）。宿主入口 `inject=['webServer','sessions']`，
   路由经 `ctx.effect` 注册（disposer 不丢弃）。
3. **运行时热卸载**：`__ANIC_TAB_SPIKE__.unregister()/reregister()` +
   kill-switch `localStorage['anic-workflow-tab']='off'`。

机制冒烟升级 17→**19/19 PASS**（新增工具栏刷新按钮 `data-anic-refresh` 与 svg 根断言；
面板升级为取数组件后 stub 增最小 hooks 桩——useState 初值/useRef/useCallback 透传/
useEffect 不触发，故树计数仍走嵌入快照路径）。typecheck client/host 0 错误。

**未验证不判定**（J0 待用户重启宿主）：标签可见性/席位共存/卸载无残留/`register` 抛重复 id/
`inject` 回调时机/标签 CSS 尺寸/live 路由在真实宿主的端到端行为。清单见
[dsh-anic/README.md §J0](../../../dsh-anic/README.md)。

## 5. 与文档族的联动

- 04 §1 M0-① 行改为「机制级已完成，真实宿主 J0 待验证」；
- 10 §9.12 记录本切片；
- README 文档地图新增本报告行；
- 03 §3 的 client 模块表从 M3 起按此形态展开（WorkflowGraphPanel = `projections/` 的第一张脸）。
