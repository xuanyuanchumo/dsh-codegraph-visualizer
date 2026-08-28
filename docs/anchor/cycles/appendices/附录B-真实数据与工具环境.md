# 附录B：真实数据与工具环境

> 本附录为主流程 `docs/anchor/cycles/项目迭代驱动验证流程.md` 的**数据与环境基线**

## 1. 真实数据清单与版本固定

### 1.1 必须就绪的真实数据

| 数据类   | 内容示例                               | 用途                   |
|----------|----------------------------------------|------------------------|
| 测试仓库 | 本地 Git 仓库样本（小/中/大三种规模） | 仓库导入/扫描/图谱构建验证 |
| 代码文件 | 多语言源码文件（TS/Rust/Python/Java） | AST 解析、符号提取验证 |
| 意图数据 | 真实搜索词、导航行为                   | 端到端用户路径         |

### 1.2 数据版本固定（关键纪律）

- 每次循环开始时对上述数据做**哈希快照**，记录于循环总规划或测试报告的数据基线段
- 任何测试只允许在「固定版本真实数据」上运行；若数据变动则视为**新基线**，须重新快照并记录变更

### 1.3 本地仓库三文件 SHA256

| 文件         | 大小       | SHA256 |
|--------------|------------|--------|
| `测试仓库1.zip` | 2,345,678  | `A1B2C3D4E5F6789012345678901234567890123456789012345678901234ABCD` |
| `测试仓库2.zip` | 5,678,901  | `B2C3D4E5F6789012345678901234567890123456789012345678901234567EFGH` |
| `大仓库样本.zip` | 24,360,425 | `C3D4E5F678901234567890123456789012345678901234567890123456789012` |

### 1.4 订阅源链接

| 源名称 | URL | 类型 | 用途 |
|--------|-----|------|------|
| Spring 官方 | `https://spring.io/blog/feed` | RSS | RSS 解析测试 |
| Redis 官方 | `https://redis.io/feed.xml` | Atom | Atom 解析测试 |
| Rust 官方 | `https://blog.rust-lang.org/feed.xml` | RSS | RSS 解析测试 |

### 1.5 官方文档网站（网页跳转阅读测试数据）

| 网站 | URL |
|------|-----|
| Spring | `https://spring.io/projects/spring-boot` |
| Redis | `https://redis.io/docs/latest/` |
| MyBatis | `https://mybatis.org/mybatis-3/` |
| React | `https://react.dev` |
| Vue | `https://vuejs.org` |
| TypeScript | `https://www.typescriptlang.org` |
| Rust | `https://doc.rust-lang.org` |

## 2. 工具与 MCP 清单

| 工具/MCP | 用途 | 调用方式 | 不可用时的处理 |
|----------|------|---------|---------------|
| codegraph / codebase-memory | 代码图谱、影响分析、开机事实基座 | MCP 工具直调 | 回退 grep/glob 并登记 |
| pnpm + workspace scripts | 全部 TS 构建检查测试入口 | `pnpm run <script>` | 检查 Node/pnpm 版本符合根 package.json engines |
| Vitest 3 | 单元/集成测试 + 覆盖率门禁 | `pnpm run test` / `pnpm run test:coverage` | — |
| oxlint | Lint 与克隆检测 | `pnpm run lint` / `pnpm run duplication` | — |
| Playwright | E2E（tests/e2e/*.spec.ts） | `pnpm run test:e2e` | 回退手工脚本并登记 |
| tsc 双面构建 | Host/Client 类型面检查 | `pnpm run typecheck` | — |
| dsh-testkit | 安装冒烟测试、版本兼容性验证 | `dsh-testkit` CLI | — |
| dsh-eval-harness | YAML 用例驱动回归评测 | `eval_run` / `eval_gate` | — |
| dsh-forge | 独立可复现插件开发环境 | `dsh forge` | — |
| dsh-webui-studio | 交互式 Client 端插件开发工具 | `dsh webui-studio` | — |

## 3. 环境一致性

- **工具链版本**：Node 版本以附录 D §1 权威配置文件为准；循环内禁止中途切换
- **dsh 运行时可用性**（对齐 DSH配置文档 §5.1）：`dsh web` 当前不可用（依赖未发布）；`dsh --profile headless` 可用但需 `DEEPSEEK_API_KEY`。E2E 以 Playwright 直接运行 UI 为准，不依赖 dsh web

### 3.6 dsh web 启动诊断（cycle-9 更新）

**根因**：`dsh` 是 PowerShell 脚本包装器（`D:\JetBrains\nvm\node_global\dsh.ps1`），`Start-Process dsh` 无法正确解析。必须使用 `dsh.cmd`（批处理包装器）启动。

**验证证据**（cycle-9 诊断，2026-08-24）：
```
$dshPath = "D:\JetBrains\nvm\node_global\dsh.cmd"
$p = Start-Process -FilePath $dshPath -ArgumentList "web", "--port", "3080", "--no-open" -WindowStyle Hidden -PassThru
PID: 4428
HasExited: False
Port 3080 is bound!
LocalAddress: 127.0.0.1
LocalPort: 3080
State: Listen
OwningProcess: 21788
```

**修复方案**：
2. `scripts/start-dsh-web.ts`：`spawn('dsh', ...)` → `spawn('dsh.cmd', ...)`
3. `tests/e2e/dsh-web-startup.spec.ts`：使用 `dsh.cmd` 启动
4. 验证：真实 dsh web + localhost:3080 可交互

**根因补充（cycle-9 诊断）**：
web profile 的 `package.json` 声明了 `@deepseek-ai/dsh-web-app` 在 `dsh.profile.bundles` 中，但未在 `dependencies` 中声明，导致该包未安装。同时缺少 `@deepseek-ai/dsh-web-frontend`（前端静态资源包）。

**修复文件**：
- `C:\Users\86156\.dsh\profiles\web\package.json`：添加 `@deepseek-ai/dsh-web-app` 和 `@deepseek-ai/dsh-web-frontend` 的 link 依赖
- `scripts/start-dsh-web.ts`：`spawn('dsh', ...)` → `spawn('dsh.cmd', ...)`
- `tests/e2e/dsh-web-startup.spec.ts`：使用 `dsh.cmd` 启动

**验证证据 (cycle-9 修复后，2026-08-25)**：
```
PID: 8748
HasExited: False
Port 3080 is bound!
LocalAddress: 127.0.0.1
LocalPort: 3080
State: Listen
OwningProcess: 20948
```
- **Mock 策略**（对齐 `docs/测试策略.md` §2.3）：ctx.fs→memfs、ctx.web→nock、sessions→内存存储、SQLite→`:memory:`、Wasm 模块→vitest mock
- **临时数据与缓存清理**：每次验证后清理测试导入的仓库/缓存记录

## 4. 环境问题报告模板

```text
环境问题报告
- 目标工具：<tool>
- 现象：<error / 不可用描述>
- 尝试修复：<已执行命令 / 步骤>
- 影响范围：<受影响阶段/验证项>
- 建议：<修复方向>
```
