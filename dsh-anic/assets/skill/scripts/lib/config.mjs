// config.mjs — .cycles 配置唯一读取入口（进化 iteration-1，修 S-1 / S-8 / S-7 根因）
// 背景（docs/anic/09 §2 S-1）：init-workflow.mjs:56 只生成 .cycles/config.yml，而
// eval-runner.mjs:52 / gate-check.mjs:20 / band-detector.mjs:29 读的是从未被创建的
// .cycles/cycle-config.yml——三个核心脚本在本仓库真实环境下全部命中"缺文件"路径。
// 此后所有脚本一律经由本模块读配置；文件名只在这一处出现。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CANONICAL_CONFIG = '.cycles/config.yml';
export const LEGACY_CONFIG = '.cycles/cycle-config.yml';

export function configMissingError(projectDir) {
  const err = new Error(
    `No ${CANONICAL_CONFIG} found in ${projectDir}. ` +
    `Run "node scripts/init-workflow.mjs <project-dir>" first, then edit ${CANONICAL_CONFIG} with your project's build/test commands.`
  );
  err.code = 'CONFIG_MISSING';
  return err;
}

export function loadProjectConfig(projectDir) {
  const canonicalPath = join(projectDir, CANONICAL_CONFIG);
  if (existsSync(canonicalPath)) return readFileSync(canonicalPath, 'utf-8');
  const legacyPath = join(projectDir, LEGACY_CONFIG);
  if (existsSync(legacyPath)) {
    // 兼容既有手工创建的旧文件名，但必须大声说出来（静默兼容正是 S-1 的成因）
    console.error(`[config] DEPRECATED: found ${LEGACY_CONFIG}; the canonical config path is ${CANONICAL_CONFIG}. Rename the file to silence this warning.`);
    return readFileSync(legacyPath, 'utf-8');
  }
  throw configMissingError(projectDir);
}

// 修 S-8（docs/anic/09 §2）：原先每个脚本各写一份正则（且都要求值必须带双引号），
// autonomy_level: "L4"（带引号）在 org-status.mjs:594 的降级正则里不匹配 → 写后不回读。
// 这里统一为：引号可选、容忍行尾注释。
export function getYamlString(configContent, key) {
  if (!configContent) return null;
  const m = configContent.match(new RegExp(`^\\s*${key}:\\s*(.*)$`, 'm'));
  if (!m) return null;
  let v = m[1].trim();
  const commentIdx = v.indexOf(' #');
  if (commentIdx >= 0) v = v.slice(0, commentIdx).trim();
  if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
      (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) {
    v = v.slice(1, -1);
  }
  return v.length > 0 ? v : null;
}

export function getYamlInt(configContent, key, fallback = null) {
  const v = getYamlString(configContent, key);
  if (v === null) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function getAutonomyLevel(configContent, fallback = 'L1') {
  const v = getYamlString(configContent, 'autonomy_level');
  if (v === null) return fallback;
  const m = v.match(/^(L[1-4])\b/i);
  return m ? m[1].toUpperCase() : fallback;
}
