#!/usr/bin/env node
// quick-validate.mjs — 自检脚本：验证 skill 包完整性
// 用法: node quick-validate.mjs <skill-dir>

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    args._.push(argv[i]);
  }
  return args;
}

const REQUIRED_FILES = [
  'SKILL.md',
];

const REQUIRED_DIRS = [
  'references',
  'assets',
  'scripts',
  'evals',
];

const EXPECTED_REFERENCES = [
  'playbook.md',
  'principles.md',
  'gates.md',
  'autonomy.md',
  'auto-cycle.md',
  'multi-agent-gate.md',
  'evaluation.md',
  'quality-review.md',
  'state-transition.md',
  'adoption.md',
  'graph.md',
  'project-config.md',
  'scripts-reference.md',
  'troubleshooting.md',
];

const EXPECTED_SCRIPTS = [
  'init-workflow.mjs',
  'init-cycle.mjs',
  'gate-check.mjs',
  'eval-runner.mjs',
  'band-detector.mjs',
  'workflow-state.mjs',
  'gate-ledger.mjs',
  'plan-sync-check.mjs',
  'org-status.mjs',
  'fact-base-verify.mjs',
  'mcp-server.mjs',
  'quick-validate.mjs',
  'archive-cycle.mjs',
  'hitl-audit.mjs',
  'auto-fix-loop.mjs',
  'multi-agent-gate.mjs',
];

const EXPECTED_ASSETS_DIRS = [
  'templates',
  'config',
  'hooks',
];

// ---------- iteration-5：漂移守卫（错误级）----------
// 四轮进化中反复出现的漂移家族——版本三处漂移（1.5.0/1.6.0 曾并存）、配置入口分裂
// （cycle-config.yml vs config.yml）、绕过原子写、B 族旧词表残留——原先只能靠人工 grep
// 逐轮扫（每轮都能扫出新的一层：人读文档 / agent prompt / 机器 schema）。这里把它们变成
// 机器检查。守卫必须是 ERROR（exit 1）：告警级守卫等于没有守卫——没有任何一次构建会红。

// 逐字符清空注释但保留换行，保证报错行号指向真实位置（见 CLAUDE.md 扫描器纪律：
// 直接删除注释会让所有后续行号上移，指向错误的位置）
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

function walkFiles(dir, predicate, out = [], base = dir) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(path, predicate, out, base);
    else if (predicate(path)) out.push({ path, rel: path.slice(base.length + 1) });
  }
  return out;
}

// 守卫自身必须能失败：找不到锚点时不是"跳过"，而是报错（否则守卫会随被守卫物一起消失）
function checkVersionConsistency(skillDir) {
  const errors = [];
  const info = [];
  const anchors = [];

  const readIf = (rel) => {
    const p = join(skillDir, rel);
    return existsSync(p) ? readFileSync(p, 'utf-8') : null;
  };

  const skillMd = readIf('SKILL.md');
  const skillV = skillMd && skillMd.match(/MCP Tools \(v(\d+\.\d+\.\d+)\)/);
  if (skillV) anchors.push({ file: 'SKILL.md (MCP Tools vX)', version: skillV[1] });

  const serverSrc = readIf('scripts/mcp-server.mjs');
  const serverV = serverSrc && serverSrc.match(/name:\s*"ai-native-iteration-cycle",\s*version:\s*"(\d+\.\d+\.\d+)"/);
  if (serverV) anchors.push({ file: 'scripts/mcp-server.mjs (Server version)', version: serverV[1] });

  const changelog = readIf('CHANGELOG.md');
  const clV = changelog && changelog.match(/^##\s+(\d+\.\d+\.\d+)/m);
  if (clV) anchors.push({ file: 'CHANGELOG.md (top entry)', version: clV[1] });

  if (anchors.length < 3) {
    errors.push(`Version guard anchors incomplete (${anchors.length}/3 found: ${anchors.map(a => a.file).join(', ') || 'none'}) — SKILL.md/MCP Tools(vX), mcp-server.mjs version, CHANGELOG.md top entry are all required`);
  } else {
    const versions = new Set(anchors.map(a => a.version));
    if (versions.size > 1) {
      errors.push(`Version drift: ${anchors.map(a => `${a.file}=${a.version}`).join(' | ')}`);
    } else {
      info.push(`Version consistent across ${anchors.length} anchors: ${[...versions][0]}`);
    }
  }
  return { errors, info };
}

function checkConfigEntryUniqueness(scriptsDir) {
  const errors = [];
  // 样例字面量按拼接构造：守卫不得匹配自己的源码（CLAUDE.md：guard 必须自证不误伤）
  const LEGACY_NAME = 'cycle-' + 'config.yml';
  const files = walkFiles(scriptsDir, (p) => p.endsWith('.mjs'));
  for (const { path, rel } of files) {
    if (rel === join('lib', 'config.mjs')) continue; // 兼容层所在，唯一允许处
    const src = stripComments(readFileSync(path, 'utf-8'));
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(LEGACY_NAME)) {
        errors.push(`Config entry split: scripts/${rel}:${i + 1} references the legacy cycle-config filename in code (must go through scripts/lib/config.mjs)`);
      }
    }
  }
  return errors;
}

function checkAtomicWrites(scriptsDir) {
  const errors = [];
  const warnings = [];
  const CALL = 'writeFile' + 'Sync(';
  const IMPORT_RE = new RegExp('import\\s*\\{[^}]*\\b' + 'writeFile' + 'Sync' + '\\b[^}]*\\}');
  const files = walkFiles(scriptsDir, (p) => p.endsWith('.mjs'));
  for (const { path, rel } of files) {
    const raw = readFileSync(path, 'utf-8');
    const src = stripComments(raw);
    if (rel !== join('lib', 'fs-safe.mjs') && src.includes(CALL)) {
      const line = src.split('\n').findIndex(l => l.includes(CALL)) + 1;
      errors.push(`Non-atomic write: scripts/${rel}:${line} calls ${CALL.slice(0, -1)} directly (use lib/fs-safe.mjs atomicWriteFileSync)`);
    }
    // 死 import：引了 writeFileSync 却没有调用点（v1.8.3 改造后的遗留）
    if (IMPORT_RE.test(src) && !src.includes(CALL)) {
      warnings.push(`Unused import: scripts/${rel} imports ${CALL.slice(0, -1)} but never calls it`);
    }
  }
  return { errors, warnings };
}

// B 族（已废弃）维度名不得再作为维度名出现。"技术债务/功能覆盖"等词在别处是正常概念
// （.cycles/tech-debt/ 台账、复盘里的"减少技术债务"），所以只在**与维度编号绑定**的
// 上下文里判罚：同一行出现 E1-E8/Q1-Q8，或形如 name: "…" 的维度名绑定。
// 过宽的规则会把概念词误判成漂移——那正是"守卫变成噪音后被忽略"的路径。
const RETIRED_DIMENSION_NAMES = ['功能覆盖', '架构健康', '技术债务', '测试成熟度', '性能与稳定', '安全与可访问', '创新差异化', '多源对照增强'];
const VOCAB_EXEMPT = [join('references', 'evaluation.md'), 'CHANGELOG.md', join('scripts', 'quick-validate.mjs')];

function isDimensionNameContext(line) {
  const boundToId = /\b[EQ][1-8]\b/.test(line);
  const boundByName = /name\s*[:：]\s*["']?/.test(line);
  return boundToId || boundByName;
}

function checkDimensionVocabulary(skillDir) {
  const errors = [];
  const files = walkFiles(skillDir, (p) => /\.(md|yml|yaml|json)$/.test(p));
  for (const { path, rel } of files) {
    if (VOCAB_EXEMPT.includes(rel)) continue;
    const src = readFileSync(path, 'utf-8');
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!isDimensionNameContext(lines[i])) continue;
      for (const name of RETIRED_DIMENSION_NAMES) {
        if (lines[i].includes(name)) {
          errors.push(`Retired dimension vocabulary: ${rel}:${i + 1} uses "${name}" as a dimension name (B family retired; scripts/lib/dimensions.mjs is the only source)`);
        }
      }
    }
  }
  return errors;
}

function validateSkillPackage(skillDir) {
  const errors = [];
  const warnings = [];
  const info = [];

  for (const f of REQUIRED_FILES) {
    const path = join(skillDir, f);
    if (!existsSync(path)) {
      errors.push(`Missing required file: ${f}`);
    } else {
      info.push(`Found: ${f}`);
    }
  }

  for (const d of REQUIRED_DIRS) {
    const path = join(skillDir, d);
    if (!existsSync(path)) {
      errors.push(`Missing required directory: ${d}/`);
    } else {
      info.push(`Found: ${d}/`);
    }
  }

  const refsDir = join(skillDir, 'references');
  if (existsSync(refsDir)) {
    for (const ref of EXPECTED_REFERENCES) {
      const path = join(refsDir, ref);
      if (!existsSync(path)) {
        warnings.push(`Missing reference: references/${ref}`);
      }
    }
  }

  const scriptsDir = join(skillDir, 'scripts');
  if (existsSync(scriptsDir)) {
    for (const script of EXPECTED_SCRIPTS) {
      const path = join(scriptsDir, script);
      if (!existsSync(path)) {
        warnings.push(`Missing script: scripts/${script}`);
      } else {
        try {
          const content = readFileSync(path, 'utf-8');
          if (!content.startsWith('#!/usr/bin/env node')) {
            warnings.push(`Script ${script} missing shebang line`);
          }
          if (!content.includes('// ') && !content.includes('import ')) {
            warnings.push(`Script ${script} appears empty or malformed`);
          }
        } catch {
          warnings.push(`Cannot read script: scripts/${script}`);
        }
      }
    }
  }

  const assetsDir = join(skillDir, 'assets');
  if (existsSync(assetsDir)) {
    for (const d of EXPECTED_ASSETS_DIRS) {
      const path = join(assetsDir, d);
      if (!existsSync(path)) {
        warnings.push(`Missing assets directory: assets/${d}/`);
      }
    }
  }

  const evalsDir = join(skillDir, 'evals');
  if (existsSync(evalsDir)) {
    const evalFiles = readdirSync(evalsDir).filter(f => f.endsWith('.json'));
    if (evalFiles.length === 0) {
      warnings.push('No eval JSON files found in evals/');
    } else {
      for (const ef of evalFiles) {
        try {
          JSON.parse(readFileSync(join(evalsDir, ef), 'utf-8'));
          info.push(`Valid eval: evals/${ef}`);
        } catch {
          errors.push(`Invalid JSON in evals/${ef}`);
        }
      }
    }
  }

  if (existsSync(join(skillDir, 'SKILL.md'))) {
    const skillContent = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8');
    if (skillContent.length < 500) {
      warnings.push('SKILL.md seems too short (< 500 chars)');
    }
    if (!skillContent.includes('## ') && !skillContent.includes('# ')) {
      warnings.push('SKILL.md missing markdown headers');
    }
  }

  // ---------- iteration-5：漂移守卫（错误级，见文件头说明）----------
  const versionCheck = checkVersionConsistency(skillDir);
  errors.push(...versionCheck.errors);
  info.push(...versionCheck.info);

  errors.push(...checkConfigEntryUniqueness(join(skillDir, 'scripts')));
  errors.push(...checkDimensionVocabulary(skillDir));

  const atomicCheck = checkAtomicWrites(join(skillDir, 'scripts'));
  errors.push(...atomicCheck.errors);
  warnings.push(...atomicCheck.warnings);

  let totalSize = 0;
  const countFiles = (dir) => {
    if (!existsSync(dir)) return 0;
    let count = 0;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        count += countFiles(path);
      } else {
        totalSize += statSync(path).size;
        count++;
      }
    }
    return count;
  };

  const fileCount = countFiles(skillDir);

  return { errors, warnings, info, fileCount, totalSize };
}

const args = parseArgs(process.argv);
if (args._.length === 0) {
  console.error('Usage: node quick-validate.mjs <skill-dir>');
  process.exit(1);
}

const skillDir = resolve(args._[0]);

if (!existsSync(skillDir)) {
  console.error(`Skill directory not found: ${skillDir}`);
  process.exit(1);
}

const result = validateSkillPackage(skillDir);

console.log(`=== Skill Package Validation ===`);
console.log(`Directory: ${skillDir}`);
console.log(`Total files: ${result.fileCount}`);
console.log(`Total size: ${(result.totalSize / 1024).toFixed(1)} KB`);
console.log(``);

if (result.errors.length > 0) {
  console.log(`ERRORS (${result.errors.length}):`);
  for (const e of result.errors) {
    console.log(`  [ERROR] ${e}`);
  }
  console.log(``);
}

if (result.warnings.length > 0) {
  console.log(`WARNINGS (${result.warnings.length}):`);
  for (const w of result.warnings) {
    console.log(`  [WARN] ${w}`);
  }
  console.log(``);
}

console.log(`INFO (${result.info.length}):`);
for (const i of result.info) {
  console.log(`  [OK] ${i}`);
}

console.log(``);
if (result.errors.length > 0) {
  console.error(`VALIDATION FAILED: ${result.errors.length} error(s) found.`);
  process.exit(1);
} else if (result.warnings.length > 0) {
  console.log(`VALIDATION PASSED with ${result.warnings.length} warning(s).`);
} else {
  console.log(`VALIDATION PASSED. All checks OK.`);
}