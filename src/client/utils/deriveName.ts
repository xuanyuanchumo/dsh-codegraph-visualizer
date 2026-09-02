export function deriveWorkspaceName(path: string): string {
  if (!path || path === '.') return '';
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || path;
}