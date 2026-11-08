# 自动修复循环报告

## 基本信息
| 字段 | 值 |
|---|---|
| 时间 | 2026-11-08T05:36:24.072Z |
| 循环 | cycle-147 |
| 状态 | FAILED |
| 尝试次数 | 1 |

## 尝试记录

### 尝试 1
- 状态: 失败
- 识别的失败项: 1
  - test-command-timeout: command exceeded 120s budget (killed after 59s) — no verdict, not a test failure
- 修复动作: stopped: command exceeded its time budget (retrying cannot help)

## 熔断
自动修复循环达到重试上限，触发熔断条件 CB1。
需运行 `org-status.mjs --auto-fallback` 回退自主级别。
