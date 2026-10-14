#!/usr/bin/env bash
# plan-sync-check.sh — 计划同步检查 Hook：在 commit 前验证计划文档与代码库一致
# 用法：作为 pre-commit hook 使用，或在手动 commit 前调用
# 配置：将此脚本链接到 .git/hooks/pre-commit

set -euo pipefail

PROJECT_DIR="${1:-$(pwd)}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

echo "=== Plan-Sync Check ==="

# 检查是否有计划文档
INTENT_DIR="$PROJECT_DIR/.cycles/intent"
CYCLES_DIR="$PROJECT_DIR/.cycles/cycles"

HAS_PLANS=false
if [ -d "$INTENT_DIR" ] && [ -n "$(ls "$INTENT_DIR"/*.md 2>/dev/null)" ]; then
  HAS_PLANS=true
fi
if [ -d "$CYCLES_DIR" ] && [ -n "$(find "$CYCLES_DIR" -name "当前循环总规划.md" -o -name "任务清单.md" 2>/dev/null)" ]; then
  HAS_PLANS=true
fi

if [ "$HAS_PLANS" = false ]; then
  echo "[SKIP] No plan documents found. Skipping sync check."
  exit 0
fi

# 执行计划同步检查
node "$SKILL_ROOT/scripts/plan-sync-check.mjs" "$PROJECT_DIR"
SYNC_RESULT=$?

if [ $SYNC_RESULT -ne 0 ]; then
  echo ""
  echo "[FAIL] Plan-sync check FAILED."
  echo "Plan documents reference files/commands that don't exist in the codebase."
  echo "Either update the plan documents or create the missing files."
  exit 1
fi

echo "[PASS] Plan-sync check passed."