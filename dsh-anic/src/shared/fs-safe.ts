/**
 * 原子写（M2-a 雏形，M2-b 升级为分段）。
 *
 * write-then-rename 模式：先写临时文件，再 rename 覆盖。
 * 防止并发读看到半写文件（INV-7 head/seg 一致性守卫的前置）。
 */
import { writeFileSync, renameSync, existsSync, readFileSync } from 'node:fs';

/** 原子写文件：写临时文件 → rename 覆盖。 */
export function atomicWriteFileSync(filePath: string, content: string): void {
  const tmp = filePath + '.tmp-' + process.pid;
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, filePath);
}

/** 安全读（不存在返回 fallback）。 */
export function safeReadFileSync(filePath: string, fallback = ''): string {
  if (!existsSync(filePath)) return fallback;
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return fallback;
  }
}
