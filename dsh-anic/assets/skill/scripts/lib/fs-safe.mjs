// fs-safe.mjs — 原子写工具（进化 iteration-1，修 S-6）
// 背景：gate-ledger.mjs:46 / multi-agent-gate.mjs:472,512 / band-detector saveHistory
// 原先都是裸 writeFileSync——进程在写入中途被杀（超时 kill、崩溃、断电）会留下半写文件，
// 对 ledger.json 这类哈希链真相源是致命的（尾条目截断 → chainHead 校验必炸）。
// 策略：先写同目录临时文件，再 renameSync 原子替换。同目录保证 rename 不跨卷。
import { writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';

export function atomicWriteFileSync(filePath, data) {
  const tmpPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    writeFileSync(tmpPath, data);
    renameSync(tmpPath, filePath);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch { /* tmp 可能尚未创建 */ }
    throw err;
  }
}
