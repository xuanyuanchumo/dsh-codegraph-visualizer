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