import type { TreeSitterNode } from './TreeSitterAdapter.ts';

/**
 * import 语句节点类型（cycle-129 · T1）：四类覆盖 TS/JS/Python/Rust/Java 的
 * import 语法形态。walk 拦截这些节点后调 {@link extractImportSources}。
 */
export const IMPORT_STATEMENT_TYPES: ReadonlySet<string> = new Set([
  'import_statement', 'import_declaration', 'import_from_statement', 'use_declaration',
]);

/**
 * 从一个 import 语法节点提取模块名（模块级纯函数，复杂度独立记账）。
 * 语法形态与降级规则见 walk 内注释（TreeSitterAdapter.ts cycle-129 T1 段）。
 */
export function extractImportSources(node: TreeSitterNode): string[] {
  const out: string[] = [];
  const push = (raw: string | undefined): void => {
    if (!raw) return;
    // TS/JS string 节点带引号；统一剥引号后按长度过滤（空/过短跳过）。
    const cleaned = raw.replace(/^['"`]|['"`]$/g, '').trim();
    if (cleaned.length > 1) out.push(cleaned);
  };
  const sourceNode = node.childForFieldName?.('source');
  if (sourceNode) {
    push(sourceNode.text);
    return out;
  }
  const moduleName = node.childForFieldName?.('module_name')
    ?? node.childForFieldName?.('name')
    ?? node.childForFieldName?.('argument');
  if (moduleName) {
    // Python relative_import 的 module_name 有点前缀（`.stlib`）——剥点后
    // 为空则跳过（纯相对导入 `from . import x` 无名字可记）。
    const text = moduleName.text.replace(/^\.+/, '').trim();
    if (text.length > 1) out.push(text);
  }
  return out;
}

export function collectHeritageTargets(
  declaration: TreeSitterNode,
): Array<{ clauseKind: 'extends' | 'implements'; targetName: string }> {
  const out: Array<{ clauseKind: 'extends' | 'implements'; targetName: string }> = [];
  const childByType = (t: string) => declaration.children?.find((c: TreeSitterNode) => c.type === t);

  // 形态一：interface 的 extends_type_clause
  const extendsClause = childByType('extends_type_clause');
  if (extendsClause) {
    for (const c of extendsClause.children ?? []) {
      if (c.type === 'type_identifier' && c.text) {
        out.push({ clauseKind: 'extends', targetName: c.text });
      }
    }
  }

  // 形态二：class 的 class_heritage（extends_clause + implements_clause）
  const heritage = childByType('class_heritage');
  if (heritage) {
    for (const clause of heritage.children ?? []) {
      const kind = clause.type === 'extends_clause' ? 'extends'
        : clause.type === 'implements_clause' ? 'implements' : null;
      if (!kind) continue;
      for (const c of clause.children ?? []) {
        if ((c.type === 'type_identifier' || c.type === 'identifier') && c.text) {
          out.push({ clauseKind: kind, targetName: c.text });
        }
      }
    }
  }

  // 形态三：Python 的 class_definition（superclasses 字段）
  const superclasses = declaration.childForFieldName?.('superclasses');
  if (superclasses) {
    for (const c of superclasses.children ?? []) {
      if ((c.type === 'identifier' || c.type === 'attribute') && c.text) {
        out.push({ clauseKind: 'extends', targetName: c.text });
      }
    }
  }
  return out;
};

/**
 * tsconfig paths 别名解析（cycle-130 · T1：现代 TS 项目的 import 图缺口）。
 *
 * `@/utils/helper` 形态的 import 依赖 tsconfig 的 `compilerOptions.paths`
 * 才能解析到真实文件——否则原生依赖图在这些项目上是半空的（cycle-129 登记缺口）。
 *
 * 解析器是**纯函数**（别名表进、映射决策出），tsconfig 的读取与缓存由
 * FileSystemAdapter 负责——本文件不碰 fs，复杂度独立记账。
 *
 * paths 形态（tsconfig 实测）：`"@/*": ["./src/*"]`——key 是模式（单 `*`），
 * value 是候选列表（首个命中胜出）。value 相对 baseUrl（缺省 = tsconfig 所在
 * 目录）。本实现覆盖单星模式；多星/多候选按序试（宁缺勿造）。
 */
export interface TsconfigPathsMapping {
  /** 别名模式 → 候选目标模式列表（均含至多一个 `*`）。 */
  readonly entries: ReadonlyArray<readonly [string, readonly string[]]>;
  /** baseUrl（相对 tsconfig 所在目录，posix；无尾斜杠；'.' = 同目录）。 */
  readonly baseUrl: string;
}

/** 从 tsconfig JSON 文本提取 paths 映射（宽松解析：JSONC 注释/尾逗号容错）。 */
export function parseTsconfigPaths(jsonText: string): TsconfigPathsMapping | null {
  // JSONC 容错：剥块注释与行注释、尾逗号（tsconfig 常带注释与尾逗号）。
  const cleaned = jsonText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .replace(/,(\s*[}\]])/g, '$1');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return null;
  }
  const compilerOptions = parsed.compilerOptions as Record<string, unknown> | undefined;
  if (!compilerOptions || typeof compilerOptions !== 'object') return null;
  const paths = compilerOptions.paths as Record<string, unknown> | undefined;
  if (!paths || typeof paths !== 'object') return null;
  const baseUrlRaw = typeof compilerOptions.baseUrl === 'string' ? compilerOptions.baseUrl : '.';
  const baseUrl = baseUrlRaw.replace(/\\/g, '/').replace(/\/+$/, '') || '.';
  const entries: Array<readonly [string, readonly string[]]> = [];
  for (const [key, value] of Object.entries(paths)) {
    if (typeof key !== 'string' || !key.includes('*')) continue; // 单星模式才有通配语义
    const targets = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    if (targets.length === 0) continue;
    entries.push([key, targets]);
  }
  if (entries.length === 0) return null;
  return { entries, baseUrl };
}

/**
 * 用别名表解析一个模块名 → workspace 内相对路径（不含扩展名，`*` 已替换）。
 * 返回 null = 该模块名不匹配任何别名模式（调用方继续走相对/bare 逻辑）。
 */
export function resolveAliasModule(mapping: TsconfigPathsMapping, moduleName: string): string | null {
  for (const [pattern, targets] of mapping.entries) {
    const starIdx = pattern.indexOf('*');
    const prefix = pattern.slice(0, starIdx);
    const suffix = pattern.slice(starIdx + 1);
    if (!moduleName.startsWith(prefix) || !moduleName.endsWith(suffix)) continue;
    const wildcard = moduleName.slice(prefix.length, moduleName.length - suffix.length);
    if (wildcard.includes('*')) continue;
    for (const target of targets) {
      // 目标相对 baseUrl（tsconfig 惯例）；`./` 前缀归一。
      const t = target.replace(/^\.\//, '');
      const base = mapping.baseUrl === '.' ? '' : `${mapping.baseUrl}/`;
      const resolved = `${base}${t.replace(/\*/g, wildcard)}`;
      return resolved.replace(/\/+/g, '/');
    }
  }
  return null;
}
