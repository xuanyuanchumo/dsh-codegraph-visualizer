/**
 * ANIC 技能域配置唯一 loader（docs/anic/11 §C-2 / INV-25 的 M1 落地切片）。
 *
 * 语义逐条转录自技能 `scripts/lib/config.mjs`（进化 v1.7.0 后的规范语义），
 * 是本插件读取 `.cycles/config.yml` 的**唯一入口** —— 第二个配置文件名读取即
 * 架构违规（INV-25；legacy 名兼容读取是显式例外，必须 loud 告警）。
 *
 * 域分配（12 §3.1 模块化）：本文件只做"读与解析"；开关合并语义在
 * shared/flows.ts；路由层在 host/routes/*。unknown 键只警示不拦截
 * （11 §C-2 与技能侧 strict 的刻意差异 —— 代码注释即契约）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CANONICAL_CONFIG = '.cycles/config.yml';
export const LEGACY_CONFIG = '.cycles/cycle-config.yml';

export interface WorkspaceConfig {
  /** 配置来源：canonical 正常；legacy=兼容读取（必须告警）；missing=未 init */
  source: 'canonical' | 'legacy' | 'missing';
  warnings: string[];
  values: {
    buildCmd: string | null;
    testCmd: string | null;
    lintCmd: string | null;
    autonomyLevel: 'L1' | 'L2' | 'L3' | 'L4';
    /** anic 段的开关覆盖（F 族 workspace 层数据源；键为 flow.* 全量 id） */
    flowOverrides: Record<string, boolean>;
  };
}

/** 行尾注释剥离 + 引号容错（与技能 lib/config.mjs 的 getYamlString 语义一致） */
export function getYamlString(content: string, key: string): string | null {
  const re = new RegExp(`^\\s*${key}:\\s*(.*)$`, 'm');
  const m = content.match(re);
  if (!m || m[1] === undefined) return null;
  let v = m[1].trim();
  const hashIdx = v.indexOf(' #');
  if (hashIdx >= 0) v = v.slice(0, hashIdx).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v.length > 0 ? v : null;
}

export function getYamlInt(content: string, key: string): number | null {
  const raw = getYamlString(content, key);
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function getAutonomyLevel(content: string, fallback: 'L1' | 'L2' | 'L3' | 'L4' = 'L1'): 'L1' | 'L2' | 'L3' | 'L4' {
  const m = content.match(/autonomy_level:\s*(L[1-4])\b/i);
  const v = m?.[1];
  return v ? (v.toUpperCase() as 'L1' | 'L2' | 'L3' | 'L4') : fallback;
}

/** anic 段解析：只接受布尔 flow.* 键；其余键 warning（刻意不拦截） */
function parseAnicSection(content: string, warnings: string[]): Record<string, boolean> {
  const overrides: Record<string, boolean> = {};
  const lines = content.split(/\r?\n/);
  let inSection = false;
  for (const line of lines) {
    if (/^anic:\s*$/.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (/^\S/.test(line)) inSection = false; // 顶层键 = 段结束
      const m = line.match(/^\s+(flow\.[A-Za-z]+):\s*(true|false)\s*(?:#.*)?$/);
      if (m && m[1] !== undefined && m[2] !== undefined) overrides[m[1]] = m[2] === 'true';
      else if (/^\s+[A-Za-z]/.test(line) && line.trim().length > 0) {
        warnings.push(`config anic section: unrecognized key '${line.trim().split(':')[0]}' (warn-only, ignored)`);
      }
    }
  }
  return overrides;
}

/**
 * 读取工作区技能域配置（唯一入口）。
 * @param cyclesDir 工作区 `.cycles/` 目录绝对路径
 */
export function loadWorkspaceConfig(cyclesDir: string): WorkspaceConfig {
  const warnings: string[] = [];
  const canonicalPath = join(cyclesDir, 'config.yml');
  const legacyPath = join(cyclesDir, 'cycle-config.yml');
  const canonicalExists = existsSync(canonicalPath);
  const legacyExists = existsSync(legacyPath);

  if (!canonicalExists && !legacyExists) {
    return {
      source: 'missing',
      warnings: [`workspace config not found (expected ${CANONICAL_CONFIG}); run skill init-workflow first`],
      values: { buildCmd: null, testCmd: null, lintCmd: null, autonomyLevel: 'L2', flowOverrides: {} },
    };
  }

  let source: 'canonical' | 'legacy';
  let content: string;
  if (canonicalExists) {
    source = 'canonical';
    content = readFileSync(canonicalPath, 'utf-8');
    if (legacyExists) warnings.push(`legacy ${LEGACY_CONFIG} present alongside canonical config — legacy ignored (delete it)`);
  } else {
    source = 'legacy';
    content = readFileSync(legacyPath, 'utf-8');
    warnings.push(
      `DEPRECATED: reading legacy ${LEGACY_CONFIG} — canonical name is ${CANONICAL_CONFIG} (INV-25 compat exception, loud by design)`,
    );
  }

  const autonomy = getAutonomyLevel(content, 'L2');
  return {
    source,
    warnings,
    values: {
      buildCmd: getYamlString(content, 'build_cmd'),
      testCmd: getYamlString(content, 'test_cmd'),
      lintCmd: getYamlString(content, 'lint_cmd'),
      autonomyLevel: autonomy,
      flowOverrides: parseAnicSection(content, warnings),
    },
  };
}
