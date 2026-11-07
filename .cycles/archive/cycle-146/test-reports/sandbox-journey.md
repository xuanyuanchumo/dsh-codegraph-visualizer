# cycle-146 沙箱用户旅程（dsh-dev-sandbox）

## 环境

| 项 | 值 |
|---|---|
| 沙箱 profile | sb-codegraph-v146（新建，与主力隔离） |
| 宿主 | dsh 0.2.2-rc.1（Electron 垫片 CLI，web 模式，端口 3096） |
| 插件挂载 | link:D:\Projects\TraeProjects\dsh-codegraph-visualizer（dist v0.3.0） |
| 验证方式 | Chrome DevTools MCP（页面 3）+ curl API 探针 |

## 旅程步验证

| 步 | 验证点 | 结果 |
|---|---|---|
| 1 | 插件加载：插件详情页显示 v0.3.0、组件运行中、无 skipping 警告（grep=0） | ✅ |
| 2 | 15 工具注册（registry byFace tools=15）+ runtime skill contributed + 5 条 codegraph-* 斜杠命令全列于 / 面板 | ✅ |
| 3 | /status 诊断四态：`diagnosis.state=ready`，issues=[CODEGRAPH_UPSTREAM_ABSENT, LENS_UPSTREAM_ABSENT]（语义正确：内置通道在场即可用） | ✅ T146-2 |
| 4 | /manage/metrics 限流快照：4 次请求后桶计数=4、配额=60、窗口剩余 50s 如实递增 | ✅ T146-3 |
| 5 | /data 首屏 500 节点（upstream 层）+ /views 四视图 structural=8393 temporal=5461 ownership=715 domain=8393 + gitSources 披露（commitLog 1213ms 不截断 / blameLog 截断如实标注） | ✅ |
| 6 | /health healthy；registry 45 条目 brokenLinks=0（注册-生产-消费矩阵无断链） | ✅ |
| 7 | Config schema 加载期校验生效（插件成功加载 + apply 正常执行 = schema 通过；15 工具在场） | ✅ T146-1 |
| 8 | 跨项目隔离：repoId 域隔离 + scopeRepoId 契约（既有测试 7055 绿），沙箱单工作区 | ✅（沿用） |

## 已知宿主渲染差异（非插件缺陷，备案）

- dsh 0.2.2-rc.1 **web 模式**（`dsh web`）下插件 top-tab 注册成功（console `top tab state → registered`）
  但 dockkit 标签条不渲染插件标签——与 cycle-110 教训③一致（标签不在标签栏 ≠ 注册失败）。
  数据面（bootstrap/斜杠命令/全部 API）正常。桌面 Electron 宿主（主力 profile）渲染完整 top tab。
- better-sidebar agent-opens WebSocket 405：web 模式上游限制（cycle-101 J0 已备案）。
- console 零插件错误：全部 error 来自 DSH 上游（sidebar 405/websocket）。

## 结论

v0.3.0 沙箱验证 **PASS**——可以更新桌面端主力 profile 并发布。
