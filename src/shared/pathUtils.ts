/**
 * 判断两个仓库标识是否指向同一个工作区。
 *
 * `repoId` 在链路里可能来自三个地方：watcher 监听的绝对路径、`/api/v1/codegraph/data` 里
 * `lastGraphData.metadata.repoId`、以及客户端 store 的 `repoId`。它们的分隔符与大小写不保证一致
 * （Windows 上 `D:\a\b` 与 `D:/a/b` 是同一个目录，盘符也可能大小写不同），所以比较前必须归一：
 * 反斜杠统一成正斜杠、去掉尾部斜杠；只有两侧都是 Windows 盘符绝对路径时才忽略大小写（POSIX 文件
 * 系统区分大小写，无条件转小写会把 `/Home/A` 与 `/home/a` 误判为同源）。任一为空
 * （null/undefined/空串）一律视为"不同源"——宁可退化成一次全量拉取，也不能让一个空标识误判为同源。
 *
 * 这里刻意不读 `process.platform`：本文件同时被打进浏览器端 bundle（`tsconfig.client.json` 含
 * `src/shared/**`），浏览器里没有 `process`，用盘符形状判断既等效又不会在客户端抛错。
 */
export function sameRepoId(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '');
  const left = normalize(a);
  const right = normalize(b);
  if (left === right) return true;
  const isWindowsDrive = /^[a-zA-Z]:\//;
  return isWindowsDrive.test(left) && isWindowsDrive.test(right) && left.toLowerCase() === right.toLowerCase();
}

export function getTopLevelDir(filePath: string, options?: { simplified?: boolean }): string {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');

  if (options?.simplified) {
    if (parts.length <= 2) return '/';
    return parts.slice(0, 2).join('/');
  }

  if (parts.length <= 2) return filePath;

  let startIdx = 0;
  if (/^[A-Za-z]:$/.test(parts[0]!)) startIdx = 1;

  if (parts[0] === 'crates' && parts.length >= 2) {
    return `crates/${parts[1]}`;
  }

  if (parts[startIdx] === 'src' || parts[startIdx] === 'lib' || parts[startIdx] === 'app') {
    return parts.slice(startIdx, startIdx + 2).join('/');
  }

  return parts.slice(startIdx, startIdx + 2).join('/');
}