#!/usr/bin/env bash
# test-protection.sh — 测试保护 Hook：防止在测试失败时提交代码
# 用法：作为 pre-commit 或 pre-push hook 使用
# 配置：将此脚本链接到 .git/hooks/pre-push

set -euo pipefail

PROJECT_DIR="${1:-$(pwd)}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

echo "=== Test Protection Check ==="

# 检查 .cycles/config.yml 是否存在
CONFIG_PATH="$PROJECT_DIR/.cycles/config.yml"
if [ ! -f "$CONFIG_PATH" ]; then
  echo "[SKIP] No .cycles/config.yml found. Skipping test protection."
  exit 0
fi

# 从配置中提取测试命令
TEST_CMD=$(grep -oP 'test_cmd:\s*"\K[^"]+' "$CONFIG_PATH" 2>/dev/null || echo "")
if [ -z "$TEST_CMD" ]; then
  echo "[SKIP] No test_cmd configured in .cycles/config.yml. Skipping test protection."
  exit 0
fi

echo "Running tests: $TEST_CMD"

# 执行测试
eval "$TEST_CMD"
TEST_RESULT=$?

if [ $TEST_RESULT -ne 0 ]; then
  echo ""
  echo "[FAIL] Tests FAILED. Commit/push blocked."
  echo "Fix all test failures before committing."
  exit 1
fi

# 从配置中提取 lint 命令（可选）
LINT_CMD=$(grep -oP 'lint_cmd:\s*"\K[^"]+' "$CONFIG_PATH" 2>/dev/null || echo "")
if [ -n "$LINT_CMD" ]; then
  echo "Running lint: $LINT_CMD"
  eval "$LINT_CMD"
  LINT_RESULT=$?

  if [ $LINT_RESULT -ne 0 ]; then
    echo ""
    echo "[FAIL] Lint FAILED. Commit/push blocked."
    echo "Fix all lint errors before committing."
    exit 1
  fi
fi

echo "[PASS] All tests and lint checks passed."