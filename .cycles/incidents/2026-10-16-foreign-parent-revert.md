# 事件：父工程工作树被整体回滚到 ~cycle-76 时代（外来写入，非本会话所为）

- **发现时间**：2026-10-16 09:30 左右（cycle-95 第 4 轮，git 提交前例行检查发现）
- **影响范围**：`src/`（29 文件）、`tests/`（4 文件）、`package.json`、`playwright.config.ts`、`docs/用户旅程.md`、`.cycles/workflow-state.json` —— 共 37 文件，852 insertions / 2372 deletions
- **处置**：已保存完整 diff 到 `foreign-parent-revert-2026-10-16.patch`（408,483 字节），并 `git stash push`（stash@{0}，带说明），工作树恢复到 HEAD（2038836）绿色基线；typecheck 复验 exit 0

## 事实清单（全部实测，非推断）

1. **写入时刻单一**：全部 37 个文件的 LastWriteTime 均为 `2026-10-16 08:55:39`——同一秒的批量写入事件。该时刻落在 cycle-95 第 4 轮本会话的变异探针执行窗口内，但本会话所有写操作（edit/write/Copy-Item）均只触及 `dsh-anic/**` 路径，且每一笔都有压缩记录可查；本会话从未编辑过父工程任何源文件。
2. **内容形态 = 定向回滚**：diff 不是随机损坏，而是把父工程特性**成批移除**——`runtime` ViewMode（e3f18e5, 2026-10-11 加）、图热更新载荷（P2-21）、节点右键菜单转发、graphEtag 工作区定域失效、node-detail.css（-205 行）、`package.json` 的 `engines.dsh: ">=0.2.0-rc.2 <0.4.0"` 与 repository/icon 元数据、playwright 配置回退、`用户旅程.md` -264 行。`.cycles/workflow-state.json` 的 `currentCycle` 从 `cycle-92` 改回 `cycle-76` 并删掉了 cycle-77…cycle-92 的全部 phaseHistory 条目。
3. **不匹配任何单一提交**：对最近 30 个提交逐一比对（`git diff <rev> -- 3 个代表文件`），无一为零——这不是 `git checkout <commit> -- .` 的干净回放，更像按目录清单回写旧内容。
4. **与本会话目标直接冲突**：目标 #3 明文要求「确保DSH宿主下限版本不变定为dsh-v0.2.0」，而回滚把 `engines.dsh` 整个删掉了。若照单提交，等于以本会话之名销毁 cycle-78…cycle-94 十八轮已验证的工作叙事。
5. **git 历史完好**：HEAD 仍为 2038836，reflog 无 reset/checkout 记录，stash 为空（处置前）。损失仅限工作树层面，且已被本处置完整保全。

## 可能来源（按可能性排序，均未定论）

- 桌面端 DSH 宿主上**另一个并行会话/代理**执行了目录级回写（storages/session_projcache 里 09:12:11 仍有第三方会话心跳；本会话的请求落在 09:25:56/09:26:17 两个文件上）
- 用户在另一个窗口/IDE 中手动回滚
- 某个外部工具/脚本的批量恢复动作

## 为什么不直接 `git checkout` 丢弃

- 未提交的工作树改动**没有任何 git 历史可恢复**——一旦 checkout 即永久丢失。若这是用户或并行会话的故意行为，静默销毁不可接受。
- 因此选择了可逆性最强的组合：patch 落盘（事件档案内）+ stash（`git stash pop` 可完整取回）+ 事件记录。

## 恢复方式（如确认需要取回）

```
git stash pop          # 或 git stash apply stash@{0}
# 或从事件档案重放：
git apply .cycles/incidents/foreign-parent-revert-2026-10-16.patch
```
