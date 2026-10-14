/**
 * 事实基线验证（原生实现，替代技能 fact-base-verify.mjs）。
 * 检查声明（设计文档中的功能项）与实现（源码中的对应物）是否一致。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

export interface FactCheck {
  declaration: string;
  source: string;
  found: boolean;
  evidence?: string;
}

export interface FactBaseResult {
  checks: FactCheck[];
  verified: number;
  missing: number;
  total: number;
}

/** 扫描目录下所有文件（递归），返回相对路径列表。 */
function scanFiles(dir: string, base: string = dir): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanFiles(full, base));
    } else {
      results.push(full.slice(base.length + 1).replace(/\\/g, '/'));
    }
  }
  return results;
}

/** 从文档中提取「功能项」声明（F1/F2/.../N1/.../A1/... 模式）。 */
function extractDeclarations(docPath: string): string[] {
  if (!existsSync(docPath)) return [];
  const content = readFileSync(docPath, 'utf-8');
  const matches = content.matchAll(/\b([FNA]-?\d+[a-z]?)\b/g);
  return [...new Set([...matches].map((m) => m[1] ?? '').filter((s) => s.length > 0))];
}

export function runFactBaseVerify(workspaceRoot: string): FactBaseResult {
  const checks: FactCheck[] = [];

  // 1. 检查 .cycles/config.yml 声明的命令是否存在
  const configPath = join(workspaceRoot, '.cycles', 'config.yml');
  if (existsSync(configPath)) {
    const config = readFileSync(configPath, 'utf-8');
    for (const cmd of [['build_cmd', 'build'], ['test_cmd', 'test'], ['lint_cmd', 'lint']] as const) {
      const m = config.match(new RegExp(`${cmd[0]}:\\s*"([^"]+)"`));
      if (m?.[1]) {
        const scriptName = m[1].split(' ')[0];
        const pkgPath = join(workspaceRoot, 'package.json');
        let found = false;
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
          found = !!pkg.scripts?.[cmd[1]];
        }
        checks.push({ declaration: `${cmd[0]}="${m[1]}"`, source: 'config.yml', found, evidence: found ? `package.json scripts.${cmd[1]}` : undefined });
      }
    }
  }

  // 2. 检查文档中声明的功能项是否有对应源码
  const docsDir = join(workspaceRoot, 'docs', 'anic');
  if (existsSync(docsDir)) {
    const srcFiles = scanFiles(join(workspaceRoot, 'dsh-anic', 'src'));
    for (const doc of readdirSync(docsDir).filter((f) => f.endsWith('.md'))) {
      const declarations = extractDeclarations(join(docsDir, doc));
      for (const decl of declarations.slice(0, 20)) { // 限制扫描量
        // 简化：检查是否有路由/模块名包含该声明
        const found = srcFiles.some((f) => f.includes(decl.toLowerCase().replace(/-/g, '')));
        checks.push({ declaration: decl, source: doc, found });
      }
    }
  }

  const verified = checks.filter((c) => c.found).length;
  return { checks, verified, missing: checks.length - verified, total: checks.length };
}
