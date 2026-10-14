#!/usr/bin/env node
// band-detector.mjs — 控制带检测器：基于 Western Electric 规则的统计过程控制
// 用法: node band-detector.mjs <project-dir> [--threshold 0.15] [--history <N>]
// Western Electric Rules:
//   Rule 1: 单点超出 3σ 控制带
//   Rule 2: 连续 2/3 点在同侧 2σ 外
//   Rule 3: 连续 4/5 点在同侧 1σ 外
//   Rule 4: 连续 8 点在中心线同侧
//   Rule 5: 连续 6 点持续递增或递减
//   Rule 6: 连续 14 点交替上下
//   Rule 7: 连续 15 点在 1σ 内（变异过小）
//   Rule 8: 连续 8 点在 1σ 外（变异过大）

import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { loadProjectConfig, getYamlInt } from './lib/config.mjs';
import { atomicWriteFileSync } from './lib/fs-safe.mjs';

function parseArgs(argv) {
  const args = { _: [], threshold: 0.15, history: 10 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--threshold') args.threshold = parseFloat(argv[++i]);
    else if (argv[i] === '--history') args.history = parseInt(argv[++i], 10);
    else args._.push(argv[i]);
  }
  return args;
}

// 修 S-1：唯一 config 入口（原先读从未被 init-workflow 创建的 .cycles/cycle-config.yml，
// 缺文件静默 return null → 预算静默落回默认值 100，控制带全部失真且无人知晓）。
// 缺配置 = 响亮失败；配置存在但未设 complexity_budget = 显式告知用了默认值，不静默。
function loadConfig(projectDir) {
  try {
    return loadProjectConfig(projectDir);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

function getComplexityBudget(configContent) {
  const budget = getYamlInt(configContent, 'complexity_budget', null);
  if (budget === null) {
    console.error('[band-detector] complexity_budget not set in .cycles/config.yml; using default 100 (set it explicitly to silence this notice)');
    return 100;
  }
  return budget;
}

function measureFileComplexity(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').length;
    const branches = (content.match(/\b(if|else|for|while|switch|case|catch|&&|\|\|)\b/g) || []).length;
    const functions = (content.match(/\b(function|def|fn|func|method)\b/g) || []).length;
    return { lines, branches, functions, score: branches + functions * 2 };
  } catch {
    return { lines: 0, branches: 0, functions: 0, score: 0 };
  }
}

function measureProjectComplexity(projectDir) {
  const sourceDirs = ['src', 'lib', 'app', 'pages', 'components'];
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java'];
  const results = [];

  for (const dir of sourceDirs) {
    const fullPath = join(projectDir, dir);
    if (!existsSync(fullPath)) continue;

    const walk = (d) => {
      const entries = readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        const path = join(d, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          walk(path);
        } else if (extensions.some(ext => entry.name.endsWith(ext))) {
          const m = measureFileComplexity(path);
          if (m.score > 0) {
            results.push({ file: path.replace(projectDir + '/', ''), ...m });
          }
        }
      }
    };
    walk(fullPath);
  }

  return results;
}

function loadHistory(projectDir) {
  const historyPath = join(projectDir, '.cycles', 'band-history.json');
  if (!existsSync(historyPath)) return [];
  try {
    return JSON.parse(readFileSync(historyPath, 'utf-8'));
  } catch {
    return [];
  }
}

function saveHistory(projectDir, history) {
  const cyclesDir = join(projectDir, '.cycles');
  if (!existsSync(cyclesDir)) mkdirSync(cyclesDir, { recursive: true });
  // 修 S-6：原子写（裸 writeFileSync 中断会留下半写 JSON，下次 loadHistory 静默吞掉整个历史）
  atomicWriteFileSync(join(cyclesDir, 'band-history.json'), JSON.stringify(history, null, 2));
}

function computeStats(values) {
  if (values.length === 0) return { mean: 0, stdDev: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);
  return { mean, stdDev };
}

function applyWesternElectricRules(dataPoints, mean, stdDev) {
  const violations = [];
  if (stdDev === 0 || dataPoints.length === 0) return violations;

  const sigma1 = mean + stdDev;
  const sigma1Low = mean - stdDev;
  const sigma2 = mean + 2 * stdDev;
  const sigma2Low = mean - 2 * stdDev;
  const sigma3 = mean + 3 * stdDev;
  const sigma3Low = mean - 3 * stdDev;

  for (let i = 0; i < dataPoints.length; i++) {
    const v = dataPoints[i];

    if (v > sigma3 || v < sigma3Low) {
      violations.push({ rule: 1, index: i, value: v, desc: '单点超出 3σ 控制带' });
    }
  }

  for (let i = 2; i < dataPoints.length; i++) {
    const recent3 = [dataPoints[i - 2], dataPoints[i - 1], dataPoints[i]];
    const above2 = recent3.filter(v => v > sigma2).length;
    const below2 = recent3.filter(v => v < sigma2Low).length;
    if (above2 >= 2 || below2 >= 2) {
      violations.push({ rule: 2, index: i, value: v, desc: '连续 2/3 点在同侧 2σ 外' });
    }
  }

  for (let i = 4; i < dataPoints.length; i++) {
    const recent5 = dataPoints.slice(i - 4, i + 1);
    const above1 = recent5.filter(v => v > sigma1).length;
    const below1 = recent5.filter(v => v < sigma1Low).length;
    if (above1 >= 4 || below1 >= 4) {
      violations.push({ rule: 3, index: i, value: dataPoints[i], desc: '连续 4/5 点在同侧 1σ 外' });
    }
  }

  for (let i = 7; i < dataPoints.length; i++) {
    const recent8 = dataPoints.slice(i - 7, i + 1);
    if (recent8.every(v => v > mean) || recent8.every(v => v < mean)) {
      violations.push({ rule: 4, index: i, value: dataPoints[i], desc: '连续 8 点在中心线同侧' });
    }
  }

  for (let i = 5; i < dataPoints.length; i++) {
    const recent6 = dataPoints.slice(i - 5, i + 1);
    let increasing = true;
    let decreasing = true;
    for (let j = 1; j < recent6.length; j++) {
      if (recent6[j] <= recent6[j - 1]) increasing = false;
      if (recent6[j] >= recent6[j - 1]) decreasing = false;
    }
    if (increasing || decreasing) {
      violations.push({ rule: 5, index: i, value: dataPoints[i], desc: '连续 6 点持续递增或递减' });
    }
  }

  for (let i = 13; i < dataPoints.length; i++) {
    const recent14 = dataPoints.slice(i - 13, i + 1);
    let alternating = true;
    for (let j = 1; j < recent14.length; j++) {
      if ((recent14[j] > mean) === (recent14[j - 1] > mean)) {
        alternating = false;
        break;
      }
    }
    if (alternating) {
      violations.push({ rule: 6, index: i, value: dataPoints[i], desc: '连续 14 点交替上下' });
    }
  }

  for (let i = 14; i < dataPoints.length; i++) {
    const recent15 = dataPoints.slice(i - 14, i + 1);
    if (recent15.every(v => Math.abs(v - mean) < stdDev)) {
      violations.push({ rule: 7, index: i, value: dataPoints[i], desc: '连续 15 点在 1σ 内（变异过小）' });
    }
  }

  for (let i = 7; i < dataPoints.length; i++) {
    const recent8 = dataPoints.slice(i - 7, i + 1);
    if (recent8.every(v => Math.abs(v - mean) > stdDev)) {
      violations.push({ rule: 8, index: i, value: dataPoints[i], desc: '连续 8 点在 1σ 外（变异过大）' });
    }
  }

  return violations;
}

function detectBands(measurements, budget, threshold) {
  const totalScore = measurements.reduce((sum, m) => sum + m.score, 0);
  const avgScore = measurements.length > 0 ? totalScore / measurements.length : 0;
  const upperBand = budget * (1 + threshold);
  const lowerBand = budget * (1 - threshold);

  const hotspots = measurements
    .filter(m => m.score > avgScore * 2)
    .sort((a, b) => b.score - a.score);

  const overBudget = measurements.filter(m => m.score > upperBand);

  return {
    totalScore,
    avgScore,
    budget,
    upperBand,
    lowerBand,
    hotspots: hotspots.slice(0, 10),
    overBudget,
    status: overBudget.length > 0 ? 'OVER_BUDGET' : (hotspots.length > 5 ? 'WARNING' : 'OK'),
  };
}

const args = parseArgs(process.argv);
if (args._.length === 0) {
  console.error('Usage: node band-detector.mjs <project-dir> [--threshold 0.15] [--history <N>]');
  process.exit(1);
}

const projectDir = resolve(args._[0]);
const configContent = loadConfig(projectDir);
const budget = getComplexityBudget(configContent);

const measurements = measureProjectComplexity(projectDir);
if (measurements.length === 0) {
  console.log('No source files found to analyze.');
  process.exit(0);
}

const bands = detectBands(measurements, budget, args.threshold);

const history = loadHistory(projectDir);
const currentSnapshot = {
  timestamp: new Date().toISOString(),
  totalScore: bands.totalScore,
  avgScore: bands.avgScore,
  fileCount: measurements.length,
  overBudgetCount: bands.overBudget.length,
};
history.push(currentSnapshot);
if (history.length > 50) history.shift();
saveHistory(projectDir, history);

const historyValues = history.map(h => h.avgScore);
const stats = computeStats(historyValues);
const weViolations = historyValues.length >= 3
  ? applyWesternElectricRules(historyValues, stats.mean, stats.stdDev)
  : [];

console.log(`Complexity Band Detection Report`);
console.log(`  Total complexity score: ${bands.totalScore}`);
console.log(`  Average per file: ${bands.avgScore.toFixed(1)}`);
console.log(`  Budget: ${bands.budget} | Upper band: ${bands.upperBand.toFixed(0)} | Lower band: ${bands.lowerBand.toFixed(0)}`);
console.log(`  Status: ${bands.status}`);
console.log(`  History snapshots: ${history.length}`);
console.log(`  Statistical Control:`);
console.log(`    Mean: ${stats.mean.toFixed(2)} | StdDev: ${stats.stdDev.toFixed(2)}`);
console.log(`    1σ: [${(stats.mean - stats.stdDev).toFixed(1)}, ${(stats.mean + stats.stdDev).toFixed(1)}]`);
console.log(`    2σ: [${(stats.mean - 2 * stats.stdDev).toFixed(1)}, ${(stats.mean + 2 * stats.stdDev).toFixed(1)}]`);
console.log(`    3σ: [${(stats.mean - 3 * stats.stdDev).toFixed(1)}, ${(stats.mean + 3 * stats.stdDev).toFixed(1)}]`);
console.log(``);

if (weViolations.length > 0) {
  console.log(`WESTERN ELECTRIC RULE VIOLATIONS (${weViolations.length}):`);
  for (const v of weViolations) {
    console.log(`  Rule ${v.rule}: ${v.desc} (at snapshot #${v.index}, value=${v.value.toFixed(2)})`);
  }
  console.log(``);
}

if (bands.overBudget.length > 0) {
  console.log(`OVER BUDGET (${bands.overBudget.length} files):`);
  for (const f of bands.overBudget) {
    console.log(`  [${f.score}] ${f.file} (branches: ${f.branches}, functions: ${f.functions})`);
  }
  console.log(``);
}

if (bands.hotspots.length > 0) {
  console.log(`COMPLEXITY HOTSPOTS (top ${bands.hotspots.length}):`);
  for (const f of bands.hotspots) {
    console.log(`  [${f.score}] ${f.file} (branches: ${f.branches}, functions: ${f.functions})`);
  }
}

let exitCode = 0;
if (bands.status === 'OVER_BUDGET') {
  console.log(`\n${bands.overBudget.length} file(s) over complexity budget. Refactor before proceeding.`);
  exitCode = 1;
} else if (bands.status === 'WARNING') {
  console.log(`\nWarning: ${bands.hotspots.length} complexity hotspots detected. Consider refactoring.`);
}

if (weViolations.length > 0) {
  console.log(`\n${weViolations.length} Western Electric rule violation(s) detected. Process may be out of statistical control.`);
  if (exitCode === 0) exitCode = 1;
}

if (exitCode === 0) {
  console.log(`\nComplexity within acceptable bands. No statistical control violations.`);
}

process.exit(exitCode);