#!/usr/bin/env node
// multi-agent-gate.mjs — L4 多 Agent 门禁评估：不同 AI agent 从不同角度多次评估人工门禁
// 用法: node scripts/multi-agent-gate.mjs <project-dir> [--gate intent|spec|plan|pr|release|all] [--auto-approve]

import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { loadProjectConfig } from './lib/config.mjs';
import { getLatestCycleDir } from './lib/cycle.mjs';
import { verifyLedger } from './lib/ledger.mjs';
import { atomicWriteFileSync } from './lib/fs-safe.mjs';

function parseArgs(argv) {
  const args = { _: [], gate: 'all', autoApprove: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--gate') args.gate = argv[++i];
    else if (argv[i] === '--auto-approve') args.autoApprove = true;
    else args._.push(argv[i]);
  }
  return args;
}

// 修 S-1：唯一 config 入口（原先缺文件静默 return ''）
function loadConfig(projectDir) {
  try {
    return loadProjectConfig(projectDir);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

// 修字典序缺陷：数值序取最新 cycle（原 .sort().pop() 在 cycle-10 之后选错目录）
const getLatestCycle = getLatestCycleDir;

function getGitChangedFiles(projectDir) {
  try {
    const output = execSync('git diff --name-only HEAD~1', {
      cwd: projectDir, timeout: 5000, stdio: 'pipe', encoding: 'utf-8',
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    try {
      const output = execSync('git status --porcelain', {
        cwd: projectDir, timeout: 5000, stdio: 'pipe', encoding: 'utf-8',
      });
      return output.trim().split('\n').filter(Boolean).map(line => line.substring(3));
    } catch {
      return [];
    }
  }
}

function countMarkdownSections(content) {
  return (content.match(/^#{1,3}\s/gm) || []).length;
}

function hasCodeBlocks(content) {
  return content.includes('```');
}

function countWords(content) {
  // 修 N-3（v1.8.0）：原按 \s+ 切词，纯中文文档 200 字只算 1 个"词"，
  // 字数门槛（intent≥50/spec≥100/plan/arch≥30）对中文系统性失真。
  // 改为：中文按字计数 + 非中文按词计数。
  const cjk = (content.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []).length;
  const words = content
    .replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return cjk + words;
}

function extractChecklistItems(content) {
  const items = content.match(/^[-*]\s+\[[ x]\]/gm) || [];
  return items.length;
}

function getGateLedgerEntries(projectDir) {
  const ledgerPath = join(projectDir, '.cycles', 'gates', 'ledger.json');
  if (!existsSync(ledgerPath)) return [];
  try {
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf-8'));
    return ledger.entries || [];
  } catch {
    return [];
  }
}

function getPassedGates(projectDir) {
  const entries = getGateLedgerEntries(projectDir);
  const latestByGate = {};
  for (const entry of entries) {
    if (entry.gate && (!latestByGate[entry.gate] || entry.timestamp > latestByGate[entry.gate].timestamp)) {
      latestByGate[entry.gate] = entry;
    }
  }
  return Object.values(latestByGate).filter(e => e.result === 'PASS').map(e => e.gate);
}

const GATE_AGENTS = {
  intent: {
    name: '意图接受门 → Design',
    agents: [
      { role: 'product-manager', name: '产品经理Agent', dimension: '业务价值评估' },
      { role: 'architect', name: '架构师Agent', dimension: '技术可行性评估' },
      { role: 'evaluator', name: '评估者Agent', dimension: '需求完整性评估' },
    ],
    threshold: 2,
    description: '2/3 Agent 通过则推荐接受意图',
  },
  spec: {
    name: '规格批准门 → Build',
    agents: [
      { role: 'architect', name: '架构师Agent', dimension: '设计合理性评估' },
      { role: 'security-reviewer', name: '安全审查Agent', dimension: '安全合规评估' },
      { role: 'evaluator', name: '评估者Agent', dimension: '规格完整性评估' },
    ],
    threshold: 2,
    description: '2/3 Agent 通过则推荐批准规格',
  },
  plan: {
    name: '计划批准门 → 代码实现',
    agents: [
      { role: 'engineer', name: '工程师Agent', dimension: '实现可行性评估' },
      { role: 'evaluator', name: '评估者Agent', dimension: '测试覆盖评估' },
      { role: 'reviewer', name: '审查者Agent', dimension: '代码规范评估' },
    ],
    threshold: 2,
    description: '2/3 Agent 通过则推荐批准计划',
  },
  pr: {
    name: 'PR合并门 → Deploy',
    agents: [
      { role: 'reviewer', name: '审查者Agent', dimension: '代码质量评估' },
      { role: 'security-reviewer', name: '安全审查Agent', dimension: '安全扫描评估' },
      { role: 'gatekeeper', name: '门禁守卫Agent', dimension: 'G0-G3门禁评估' },
    ],
    threshold: 3,
    description: '3/3 Agent 全部通过则推荐合并PR',
  },
  release: {
    name: '发布授权门 → 生产部署',
    agents: [
      { role: 'gatekeeper', name: '门禁守卫Agent', dimension: '全门禁评估' },
      { role: 'security-reviewer', name: '安全审查Agent', dimension: '合规评估' },
      { role: 'evaluator', name: '评估者Agent', dimension: '性能基线评估' },
    ],
    threshold: 3,
    description: '3/3 Agent 全部通过则推荐授权发布',
  },
};

function evaluateIntentGate(projectDir) {
  const intentPath = join(projectDir, '.cycles', 'intent', 'intent.md');
  if (!existsSync(intentPath)) {
    return {
      gate: 'intent', pass: false, passCount: 0, threshold: GATE_AGENTS.intent.threshold,
      reason: 'intent.md not found', agentResults: [], recommendation: '不建议接受意图（intent.md 不存在）', trustScore: 0,
    };
  }
  const content = readFileSync(intentPath, 'utf-8');
  const wordCount = countWords(content);
  const sections = countMarkdownSections(content);
  const hasChecklist = extractChecklistItems(content) > 0;

  const agentResults = [];

  // Agent 1: 产品经理 — 业务价值评估（深度评估）
  const pmKeywords = ['问题', '目标', '意图', '用户', '需求', '价值', '影响'];
  const pmScore = pmKeywords.filter(k => content.includes(k)).length;
  const hasProblemStatement = content.includes('问题') || content.includes('Problem');
  const hasAffectedUsers = content.includes('用户') || content.includes('受影响');
  const hasExpectedOutcome = content.includes('结果') || content.includes('outcome') || content.includes('目标');
  const pmDetailChecks = [hasProblemStatement, hasAffectedUsers, hasExpectedOutcome].filter(Boolean).length;
  const pmCheck = {
    agent: 'product-manager', dimension: '业务价值评估',
    pass: pmScore >= 3 && wordCount >= 50 && pmDetailChecks >= 2,
    detail: pmScore >= 3 && pmDetailChecks >= 2
      ? `业务描述充分（${pmScore}/${pmKeywords.length} 关键要素，${pmDetailChecks}/3 核心要素）`
      : `业务描述不足（${pmScore}/${pmKeywords.length} 关键要素，${pmDetailChecks}/3 核心要素）`,
    confidence: Math.min((pmScore / pmKeywords.length + pmDetailChecks / 3) / 2, 1.0),
  };
  agentResults.push(pmCheck);

  // Agent 2: 架构师 — 技术可行性评估（深度评估）
  const barrierKeywords = ['不可能', '无法实现', '技术障碍', '不可行'];
  const hasBarrier = barrierKeywords.some(k => content.includes(k));
  const techStackMatch = content.match(/技术栈|框架|平台|工具/g);
  const hasConstraints = content.includes('约束') || content.includes('constraint');
  const hasDependencies = content.includes('依赖') || content.includes('dependency');
  const archDetailChecks = [!hasBarrier, !!techStackMatch, hasConstraints].filter(Boolean).length;
  const archCheck = {
    agent: 'architect', dimension: '技术可行性评估',
    pass: !hasBarrier && wordCount >= 30 && archDetailChecks >= 2,
    detail: hasBarrier
      ? '存在明确技术障碍声明'
      : `技术可行性充分（${archDetailChecks}/3 核心要素${techStackMatch ? '，技术栈上下文充分' : ''}${hasConstraints ? '，约束条件明确' : ''}）`,
    confidence: hasBarrier ? 0.1 : Math.min((0.5 + archDetailChecks / 3) / 1.5, 1.0),
  };
  agentResults.push(archCheck);

  // Agent 3: 评估者 — 需求完整性评估（深度评估）
  const completenessKeywords = ['约束', '范围外', '范围', '开放问题', '假设', '依赖'];
  const completenessScore = completenessKeywords.filter(k => content.includes(k)).length;
  const hasOutOfScope = content.includes('范围外') || content.includes('Out of scope');
  const hasOpenQuestions = content.includes('开放问题') || content.includes('Open question');
  const hasConstraints2 = content.includes('约束') || content.includes('Constraint');
  const evalDetailChecks = [hasOutOfScope, hasOpenQuestions, hasConstraints2].filter(Boolean).length;
  const evalCheck = {
    agent: 'evaluator', dimension: '需求完整性评估',
    pass: completenessScore >= 2 && sections >= 2 && evalDetailChecks >= 2,
    detail: completenessScore >= 2 && evalDetailChecks >= 2
      ? `需求要素完整（${completenessScore}/${completenessKeywords.length} 关键词，${evalDetailChecks}/3 核心要素）`
      : `需求要素不足（${completenessScore}/${completenessKeywords.length} 关键词，${evalDetailChecks}/3 核心要素）`,
    confidence: Math.min((completenessScore / completenessKeywords.length + evalDetailChecks / 3) / 2, 1.0),
  };
  agentResults.push(evalCheck);

  const passCount = agentResults.filter(r => r.pass).length;
  const avgConfidence = agentResults.reduce((s, r) => s + (r.confidence || 0), 0) / agentResults.length;
  const trustScore = Math.round(avgConfidence * 100);
  return {
    gate: 'intent',
    pass: passCount >= GATE_AGENTS.intent.threshold,
    passCount,
    threshold: GATE_AGENTS.intent.threshold,
    agentResults,
    recommendation: passCount >= GATE_AGENTS.intent.threshold ? '推荐接受意图' : '不建议接受意图',
    trustScore,
  };
}

function evaluateSpecGate(projectDir) {
  const specPath = join(projectDir, '.cycles', 'intent', 'spec.md');
  if (!existsSync(specPath)) {
    return {
      gate: 'spec', pass: false, passCount: 0, threshold: GATE_AGENTS.spec.threshold,
      reason: 'spec.md not found', agentResults: [], recommendation: '不建议批准规格（spec.md 不存在）', trustScore: 0,
    };
  }
  const content = readFileSync(specPath, 'utf-8');
  const intentPath = join(projectDir, '.cycles', 'intent', 'intent.md');
  const intentContent = existsSync(intentPath) ? readFileSync(intentPath, 'utf-8') : '';
  const wordCount = countWords(content);
  const sections = countMarkdownSections(content);
  const hasCodeBlocksInSpec = hasCodeBlocks(content);

  const agentResults = [];

  const archKeywords = ['架构', '设计', '接口', '模块', '组件', '分层', '数据流'];
  const archScore = archKeywords.filter(k => content.includes(k)).length;
  const archCheck = {
    agent: 'architect', dimension: '设计合理性评估',
    pass: archScore >= 3 && sections >= 3,
    detail: archScore >= 3 ? `设计描述充分（${archScore}/${archKeywords.length}）` : `设计描述不足（仅 ${archScore}/${archKeywords.length}）`,
    confidence: Math.min(archScore / archKeywords.length, 1.0),
  };
  agentResults.push(archCheck);

  const secRiskKeywords = ['明文', '硬编码', '密码', '凭据', 'token', 'api_key'];
  const hasSecRisk = secRiskKeywords.some(k => content.includes(k));
  const secMitigationKeywords = ['加密', '隔离', '脱敏', '权限', '认证', '授权'];
  const hasSecMitigation = secMitigationKeywords.some(k => content.includes(k));
  const secCheck = {
    agent: 'security-reviewer', dimension: '安全合规评估',
    pass: !hasSecRisk || (hasSecRisk && hasSecMitigation),
    detail: !hasSecRisk ? '无安全敏感操作' : (hasSecMitigation ? '安全风险已有缓解方案' : '安全风险未提供缓解方案'),
    confidence: !hasSecRisk ? 0.9 : (hasSecMitigation ? 0.7 : 0.2),
  };
  agentResults.push(secCheck);

  const intentIssues = intentContent.match(/开放问题|待定|TODO/g) || [];
  const specResolutions = content.match(/解决|方案|回答|确定/g) || [];
  const evalCheck = {
    agent: 'evaluator', dimension: '规格完整性评估',
    pass: wordCount >= 100 && sections >= 3,
    detail: wordCount >= 100 ? `规格内容充分（${wordCount} 字，${sections} 节）` : `规格内容不足（${wordCount} 字）`,
    confidence: Math.min((wordCount / 200 + sections / 5) / 2, 1.0),
  };
  agentResults.push(evalCheck);

  const passCount = agentResults.filter(r => r.pass).length;
  const avgConfidence = agentResults.reduce((s, r) => s + (r.confidence || 0), 0) / agentResults.length;
  const trustScore = Math.round(avgConfidence * 100);
  return {
    gate: 'spec',
    pass: passCount >= GATE_AGENTS.spec.threshold,
    passCount,
    threshold: GATE_AGENTS.spec.threshold,
    agentResults,
    recommendation: passCount >= GATE_AGENTS.spec.threshold ? '推荐批准规格' : '不建议批准规格',
    trustScore,
  };
}

function evaluatePlanGate(projectDir) {
  const planPath = join(projectDir, 'plan.md');
  const legacyPlanPath = join(projectDir, '.cycles', 'intent', 'plan.md');
  const cycleDir = getLatestCycle(projectDir);
  const cyclePlanPath = cycleDir ? join(projectDir, '.cycles', 'cycles', cycleDir, '当前循环总规划.md') : null;

  let content = '';
  if (existsSync(planPath)) content = readFileSync(planPath, 'utf-8');
  else if (existsSync(legacyPlanPath)) content = readFileSync(legacyPlanPath, 'utf-8');
  else if (cyclePlanPath && existsSync(cyclePlanPath)) content = readFileSync(cyclePlanPath, 'utf-8');
  else {
    return {
      gate: 'plan', pass: false, passCount: 0, threshold: GATE_AGENTS.plan.threshold,
      reason: 'plan.md not found', agentResults: [], recommendation: '不建议批准计划（plan.md 不存在）', trustScore: 0,
    };
  }

  const wordCount = countWords(content);
  const sections = countMarkdownSections(content);
  const checklistItems = extractChecklistItems(content);

  const agentResults = [];

  const implKeywords = ['文件', '步骤', '任务', '修改', '创建', '删除', '变更'];
  const implScore = implKeywords.filter(k => content.includes(k)).length;
  const hasFileList = /\b(src|test|docs|config)\b/.test(content);
  const engCheck = {
    agent: 'engineer', dimension: '实现可行性评估',
    pass: implScore >= 3 && hasFileList,
    detail: implScore >= 3 && hasFileList ? `实现细节充分（${implScore}/${implKeywords.length}，含文件路径）` : `实现细节不足`,
    confidence: Math.min((implScore / implKeywords.length + (hasFileList ? 0.5 : 0)) / 1.5, 1.0),
  };
  agentResults.push(engCheck);

  const testKeywords = ['测试', '验证', '回归', '单元测试', '集成测试', '覆盖率'];
  const testScore = testKeywords.filter(k => content.includes(k)).length;
  const evalCheck = {
    agent: 'evaluator', dimension: '测试覆盖评估',
    pass: testScore >= 2,
    detail: testScore >= 2 ? `测试策略充分（${testScore}/${testKeywords.length}）` : `测试策略不足（仅 ${testScore}/${testKeywords.length}）`,
    confidence: Math.min(testScore / testKeywords.length, 1.0),
  };
  agentResults.push(evalCheck);

  const stdKeywords = ['规范', '约定', '标准', 'lint', '格式', '命名'];
  const stdScore = stdKeywords.filter(k => content.includes(k)).length;
  const revCheck = {
    agent: 'reviewer', dimension: '代码规范评估',
    pass: stdScore >= 1 || checklistItems > 0,
    detail: stdScore >= 1 ? `规范引用充分（${stdScore}/${stdKeywords.length}）` : (checklistItems > 0 ? `有 ${checklistItems} 个检查项` : '缺少规范引用'),
    confidence: Math.min((stdScore / stdKeywords.length + (checklistItems > 0 ? 0.3 : 0)) / 1.3, 1.0),
  };
  agentResults.push(revCheck);

  const passCount = agentResults.filter(r => r.pass).length;
  const avgConfidence = agentResults.reduce((s, r) => s + (r.confidence || 0), 0) / agentResults.length;
  const trustScore = Math.round(avgConfidence * 100);
  return {
    gate: 'plan',
    pass: passCount >= GATE_AGENTS.plan.threshold,
    passCount,
    threshold: GATE_AGENTS.plan.threshold,
    agentResults,
    recommendation: passCount >= GATE_AGENTS.plan.threshold ? '推荐批准计划' : '不建议批准计划',
    trustScore,
  };
}

function evaluatePRGate(projectDir) {
  const changedFiles = getGitChangedFiles(projectDir);
  const passedGates = getPassedGates(projectDir);

  const agentResults = [];

  const hasChanges = changedFiles.length > 0;
  const hasTests = changedFiles.some(f => f.includes('test') || f.includes('spec'));
  const hasDocs = changedFiles.some(f => f.includes('docs') || f.includes('README'));
  const revCheck = {
    agent: 'reviewer', dimension: '代码质量评估',
    pass: hasChanges,
    detail: hasChanges ? `${changedFiles.length} files changed${hasTests ? ' (含测试)' : ''}${hasDocs ? ' (含文档)' : ''}` : 'No changes to review',
    confidence: hasChanges ? (hasTests ? 0.8 : 0.5) : 0.1,
  };
  agentResults.push(revCheck);

  const sensitivePatterns = ['.env', 'credentials', 'secret', 'password', 'token', 'api_key'];
  const hasSensitive = changedFiles.some(f => sensitivePatterns.some(p => f.toLowerCase().includes(p)));
  const gitignorePath = join(projectDir, '.gitignore');
  const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';
  const sensitiveProtected = hasSensitive && sensitivePatterns.every(p => gitignore.includes(p));
  const secCheck = {
    agent: 'security-reviewer', dimension: '安全扫描评估',
    pass: !hasSensitive || sensitiveProtected,
    detail: !hasSensitive ? 'No security-sensitive changes' : (sensitiveProtected ? 'Sensitive files protected by .gitignore' : 'Sensitive files NOT in .gitignore'),
    confidence: !hasSensitive ? 0.9 : (sensitiveProtected ? 0.8 : 0.1),
  };
  agentResults.push(secCheck);

  const allGatesPassed = ['G0', 'G1', 'G2', 'G3'].every(g => passedGates.includes(g));
  const gateCheck = {
    agent: 'gatekeeper', dimension: 'G0-G3门禁评估',
    pass: allGatesPassed,
    detail: allGatesPassed ? 'All G0-G3 gates passed' : `Missing: ${['G0', 'G1', 'G2', 'G3'].filter(g => !passedGates.includes(g)).join(', ')}`,
    confidence: allGatesPassed ? 0.9 : 0.2,
  };
  agentResults.push(gateCheck);

  const passCount = agentResults.filter(r => r.pass).length;
  const avgConfidence = agentResults.reduce((s, r) => s + (r.confidence || 0), 0) / agentResults.length;
  const trustScore = Math.round(avgConfidence * 100);
  return {
    gate: 'pr',
    pass: passCount >= GATE_AGENTS.pr.threshold,
    passCount,
    threshold: GATE_AGENTS.pr.threshold,
    agentResults,
    recommendation: passCount >= GATE_AGENTS.pr.threshold ? '推荐合并PR' : '不建议合并PR',
    trustScore,
  };
}

function evaluateReleaseGate(projectDir) {
  const passedGates = getPassedGates(projectDir);
  const cycleDir = getLatestCycle(projectDir);
  const auditLogPath = cycleDir ? join(projectDir, '.cycles', 'cycles', cycleDir, '审计日志.md') : null;
  const deliveryPath = cycleDir ? join(projectDir, '.cycles', 'cycles', cycleDir, '交付清单.md') : null;
  const nonFuncPath = cycleDir ? join(projectDir, '.cycles', 'cycles', cycleDir, '非功能验证报告.md') : null;

  const agentResults = [];

  const allGatesPassed = ['G0', 'G1', 'G2', 'G3'].every(g => passedGates.includes(g));
  // 修 S-5：gatekeeper 的"verified"必须来自真实哈希链校验，不得用 existsSync 充数
  // （原先文件存在即判 'All gates green, ledger verified'——账本被篡改也照样通过）。
  // confidence 来源说明：0.9 = 链校验通过且 G0-G3 全绿；0.2 = 任一不满足。来源写入 detail。
  const ledgerCheck = verifyLedger(projectDir);
  const ledgerVerified = ledgerCheck.valid;
  const gatekeeperPass = allGatesPassed && ledgerVerified;
  const gateCheck = {
    agent: 'gatekeeper', dimension: '全门禁评估', source: 'deterministic-chain-verify',
    pass: gatekeeperPass,
    detail: gatekeeperPass
      ? `All gates green; ledger chain verified (${ledgerCheck.totalEntries} entries)`
      : `Missing: ${!allGatesPassed ? 'gates' : ''} ${!ledgerVerified ? (ledgerCheck.totalEntries === 0 ? 'ledger(empty)' : `ledger-chain-broken(${ledgerCheck.issues.map(i => i.type).join(',')})`) : ''}`.trim(),
    confidence: gatekeeperPass ? 0.9 : 0.2,
  };
  agentResults.push(gateCheck);

  const nonFuncExists = nonFuncPath && existsSync(nonFuncPath);
  const secCheck = {
    agent: 'security-reviewer', dimension: '合规评估',
    pass: allGatesPassed && nonFuncExists,
    detail: allGatesPassed && nonFuncExists ? 'Security compliance verified, non-functional report present' : 'Security compliance pending or non-functional report missing',
    confidence: allGatesPassed && nonFuncExists ? 0.8 : 0.3,
  };
  agentResults.push(secCheck);

  const auditExists = auditLogPath && existsSync(auditLogPath);
  const deliveryExists = deliveryPath && existsSync(deliveryPath);
  const evalCheck = {
    agent: 'evaluator', dimension: '性能基线评估',
    pass: allGatesPassed && auditExists && deliveryExists,
    detail: allGatesPassed && auditExists && deliveryExists ? 'Performance baseline verified, audit & delivery complete' : 'Performance baseline not fully verified',
    confidence: allGatesPassed && auditExists && deliveryExists ? 0.8 : 0.3,
  };
  agentResults.push(evalCheck);

  const passCount = agentResults.filter(r => r.pass).length;
  const avgConfidence = agentResults.reduce((s, r) => s + (r.confidence || 0), 0) / agentResults.length;
  const trustScore = Math.round(avgConfidence * 100);
  return {
    gate: 'release',
    pass: passCount >= GATE_AGENTS.release.threshold,
    passCount,
    threshold: GATE_AGENTS.release.threshold,
    agentResults,
    recommendation: passCount >= GATE_AGENTS.release.threshold ? '推荐授权发布' : '不建议授权发布',
    trustScore,
  };
}

function recordMultiAgentResult(projectDir, gate, result) {
  const cycleDir = getLatestCycle(projectDir);
  if (!cycleDir) return;

  const auditLogPath = join(projectDir, '.cycles', 'cycles', cycleDir, '审计日志.md');
  const timestamp = new Date().toISOString();
  const agentSummary = result.agentResults.map(r => `${r.agent}:${r.pass ? 'PASS' : 'FAIL'}(${Math.round((r.confidence || 0) * 100)}%)`).join(', ');
  const entry = `\n| ${timestamp} | 多Agent门禁-${gate} | ${result.pass ? 'PASS' : 'FAIL'} | ${agentSummary} → ${result.recommendation} | 信任度=${result.trustScore}% |\n`;

  if (existsSync(auditLogPath)) {
    const content = readFileSync(auditLogPath, 'utf-8');
    if (content.includes('| 时间 | 检查点 | 结果 | 详情 | 状态 |')) {
      // 修 S-6：审计日志追加改原子写（裸 writeFileSync 中断会截断既有审计记录）
      atomicWriteFileSync(auditLogPath, content + entry);
    } else {
      const header = `\n## 多Agent门禁评估记录\n\n| 时间 | 检查点 | 结果 | 详情 | 状态 |\n|---|---|---|---|---|\n`;
      atomicWriteFileSync(auditLogPath, content + header + entry);
    }
  }
}

function generateMultiAgentReport(projectDir, allResults) {
  const cycleDir = getLatestCycle(projectDir);
  const reportDir = cycleDir ? join(projectDir, '.cycles', 'cycles', cycleDir, 'test-reports') : join(projectDir, '.cycles', 'cycles');
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });

  const reportPath = join(reportDir, 'multi-agent-gate-report.md');
  const timestamp = new Date().toISOString();

  let content = `# 多Agent门禁评估报告\n\n## 基本信息\n| 字段 | 值 |\n|---|---|\n| 时间 | ${timestamp} |\n| 循环 | ${cycleDir || 'N/A'} |\n\n## 评估结果总览\n`;

  for (const result of allResults) {
    const gateInfo = GATE_AGENTS[result.gate];
    content += `\n### ${gateInfo.name}\n`;
    content += `| 字段 | 值 |\n|---|---|\n`;
    content += `| 综合判定 | ${result.pass ? 'PASS' : 'FAIL'} |\n`;
    content += `| 通过数 | ${result.passCount}/${result.threshold} |\n`;
    content += `| 信任度 | ${result.trustScore}% |\n`;
    content += `| 推荐 | ${result.recommendation} |\n\n`;
    content += `| Agent | 维度 | 结果 | 详情 | 置信度 |\n|---|---|---|---|---|\n`;
    for (const r of result.agentResults) {
      content += `| ${r.agent} | ${r.dimension} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.detail} | ${Math.round((r.confidence || 0) * 100)}% |\n`;
    }
  }

  const allPass = allResults.every(r => r.pass);
  const avgTrustScore = Math.round(allResults.reduce((s, r) => s + r.trustScore, 0) / allResults.length);
  content += `\n## 综合结论\n`;
  content += `| 字段 | 值 |\n|---|---|\n`;
  content += `| 全部门禁通过 | ${allPass ? 'YES' : 'NO'} |\n`;
  content += `| 平均信任度 | ${avgTrustScore}% |\n`;
  content += `| 推荐执行 | ${allPass && avgTrustScore >= 70 ? 'YES — 根据多Agent推荐默认执行' : 'NO — 需人工审查'} |\n`;

  // 修 S-6：报告写盘改原子写
  atomicWriteFileSync(reportPath, content);
  return reportPath;
}

const args = parseArgs(process.argv);
if (args._.length === 0) {
  console.error('Usage: node multi-agent-gate.mjs <project-dir> [--gate intent|spec|plan|pr|release|all] [--auto-approve]');
  process.exit(1);
}

const projectDir = resolve(args._[0]);

const gateEvaluators = {
  intent: () => evaluateIntentGate(projectDir),
  spec: () => evaluateSpecGate(projectDir),
  plan: () => evaluatePlanGate(projectDir),
  pr: () => evaluatePRGate(projectDir),
  release: () => evaluateReleaseGate(projectDir),
};

const gatesToCheck = args.gate === 'all' ? ['intent', 'spec', 'plan', 'pr', 'release'] : [args.gate];
const allResults = [];
let allPass = true;

console.log(`=== Multi-Agent Gate Evaluation ===`);
console.log(`Project: ${projectDir}`);
console.log(`Gates: ${gatesToCheck.join(', ')}`);
console.log(``);

for (const g of gatesToCheck) {
  if (!GATE_AGENTS[g]) {
    // 修 S-11（实际比 09 记载更严重）：原先 continue 后 allResults=[] →
    // avgTrustScore=Math.round(0/0)=NaN、allPass=true、process.exit(0)——未知门静默全绿。
    // 契约：未知标识符必须响亮失败。
    console.error(`Unknown gate: ${g}. Valid gates: ${Object.keys(GATE_AGENTS).join(', ')}`);
    process.exit(1);
  }

  const result = gateEvaluators[g]();
  allResults.push(result);

  const gateInfo = GATE_AGENTS[g];
  console.log(`--- ${gateInfo.name} ---`);
  // 修 N-11（v1.8.0）：原 "PASS (3/2)" 语义歧义（3=通过 agent 数，2=门限），
  // 改为显式 "3/3 agents, threshold 2"。
  console.log(`Result: ${result.pass ? 'PASS' : 'FAIL'} (${result.passCount}/${(result.agentResults || []).length} agents, threshold ${result.threshold}) | Trust: ${result.trustScore}%`);
  console.log(`Recommendation: ${result.recommendation}`);
  for (const r of result.agentResults) {
    console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] ${r.agent} (${r.dimension}): ${r.detail} [${Math.round((r.confidence || 0) * 100)}%]`);
  }
  console.log(``);

  if (!result.pass) allPass = false;
  recordMultiAgentResult(projectDir, g, result);
}

const reportPath = generateMultiAgentReport(projectDir, allResults);
console.log(`Report: ${reportPath}`);

const avgTrustScore = Math.round(allResults.reduce((s, r) => s + r.trustScore, 0) / allResults.length);

if (allPass) {
  console.log(`\nAll multi-agent gate evaluations PASSED.`);
  console.log(`Average trust score: ${avgTrustScore}%`);
  if (args.autoApprove && avgTrustScore >= 70) {
    console.log(`Auto-approve: YES — Proceeding based on multi-agent recommendation.`);
    console.log(`  (Trust score ${avgTrustScore}% >= 70% threshold, all gates passed)`);
    // In L4 autonomous mode, AI should proceed to the next phase based on the recommendation
    console.log(`  Next action: Advance to next phase via workflow-state.mjs advance`);
  } else if (avgTrustScore >= 70) {
    console.log(`Recommendation: Proceed (use --auto-approve to auto-execute).`);
    console.log(`  (Trust score ${avgTrustScore}% >= 70% threshold, but --auto-approve not set)`);
  } else {
    console.log(`Recommendation: Proceed with caution (trust score below 70%).`);
    console.log(`  (Trust score ${avgTrustScore}% < 70% threshold, human review recommended)`);
  }
  process.exit(0);
} else {
  console.error(`\nSome gate evaluations FAILED. Review recommended.`);
  console.error(`Average trust score: ${avgTrustScore}%`);
  if (args.autoApprove && avgTrustScore >= 70) {
    console.error(`Auto-approve: NO — Some gates failed despite trust score >= 70%.`);
    console.error(`  (Failed gates require human review regardless of trust score)`);
  } else if (avgTrustScore >= 70) {
    console.error(`Recommendation: Review failed gates before proceeding.`);
  } else {
    console.error(`Recommendation: Human review required (trust score below 70%).`);
  }
  process.exit(1);
}
