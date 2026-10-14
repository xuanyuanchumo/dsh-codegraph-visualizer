#!/usr/bin/env bash
# production-gate.sh — 生产门禁 Hook：在部署前强制执行 G0-G3 全部门禁检查
# 用法：在 CI/CD pipeline 的 deploy 阶段前调用此脚本
# 配置：将此脚本链接或复制到项目的 .git/hooks/ 或 CI pipeline 中

set -euo pipefail

PROJECT_DIR="${1:-$(pwd)}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

echo "=== Production Gate Check ==="
echo "Project: $PROJECT_DIR"
echo ""

# 检查 .cycles/config.yml 是否存在
if [ ! -f "$PROJECT_DIR/.cycles/config.yml" ]; then
  echo "[FAIL] No .cycles/config.yml found. Run init-workflow first."
  exit 1
fi

# 执行 G0-G3 全部门禁检查
# v1.8.2 修：set -e 下裸命令失败会立即终止脚本，`GATE_RESULT=$?` 永远不会执行
# （FAIL 分支的定制提示是死代码）。用 `|| GATE_RESULT=$?` 显式捕获退出码。
GATE_RESULT=0
node "$SKILL_ROOT/scripts/gate-check.mjs" "$PROJECT_DIR" --gate all || GATE_RESULT=$?

if [ $GATE_RESULT -ne 0 ]; then
  echo ""
  echo "[FAIL] Production gate FAILED. Deployment blocked."
  echo "All G0-G3 gates must pass before deployment."
  exit 1
fi

# 检查交付检查清单是否存在
CYCLES_DIR="$PROJECT_DIR/.cycles"
# v1.8.2 修：`sort` 字典序在 cycle-10 与 cycle-9 并存时会选错最新循环（与 gate-check 字典序缺陷同族），
# 改 `sort -V`；检查清单名对齐 init-cycle 实际复制名 `交付清单.md`（原 `交付检查清单.md` 是第三种拼法）。
LATEST_CYCLE=$(ls -d "$CYCLES_DIR"/cycles/cycle-* 2>/dev/null | sort -V | tail -1)
if [ -n "$LATEST_CYCLE" ]; then
  CHECKLIST="$LATEST_CYCLE/交付清单.md"
  if [ ! -f "$CHECKLIST" ]; then
    echo "[WARN] No delivery checklist (交付清单.md) found in $LATEST_CYCLE"
    echo "Creating checklist from template..."
    cp "$SKILL_ROOT/assets/templates/delivery-checklist.md" "$CHECKLIST"
  fi

  # 检查清单中是否有未完成项
  if grep -q '\[ \]' "$CHECKLIST" 2>/dev/null; then
    UNFINISHED=$(grep -c '\[ \]' "$CHECKLIST")
    echo "[FAIL] Delivery checklist has $UNFINISHED unfinished item(s)."
    echo "Complete all items in $CHECKLIST before deployment."
    exit 1
  fi
fi

# 检查是否有未解决的 incidents
INCIDENT_DIR="$PROJECT_DIR/.cycles/incidents"
if [ -d "$INCIDENT_DIR" ]; then
  OPEN_INCIDENTS=$(find "$INCIDENT_DIR" -name "*.md" -exec grep -l "OPEN\|未解决" {} \; 2>/dev/null | wc -l)
  if [ "$OPEN_INCIDENTS" -gt 0 ]; then
    echo "[FAIL] $OPEN_INCIDENTS open incident(s) found. Resolve before deployment."
    exit 1
  fi
fi

echo ""
echo "[PASS] Production gate PASSED. All checks passed."
echo "Deployment approved."