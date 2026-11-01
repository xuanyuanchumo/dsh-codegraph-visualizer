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
