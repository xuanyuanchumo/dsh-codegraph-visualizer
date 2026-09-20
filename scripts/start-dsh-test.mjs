#!/usr/bin/env node
/**
 * DSH Web 调试环境启动脚本（Windows）
 *
 * 用法:
 *   node start-dsh-test.mjs start   [--verbose] [--force] [timeout]  启动/复用环境
 *   node start-dsh-test.mjs stop                                     停止并等待端口释放
 *   node start-dsh-test.mjs restart [--verbose] [timeout]            强制重启
 *   node start-dsh-test.mjs status                                   查看运行状态
 *   node start-dsh-test.mjs check                                    仅端口评估，不启动/不杀进程
 *
 * 关键特性:
 *   - start 幂等：环境已就绪时不再重复启动，避免多开 Chrome / DSH
 *   - stop 优雅关闭 Chrome（WM_CLOSE → 超时兜底 /F），等待端口真正释放
 *   - 杀进程前按 PID 文件校验进程名（DSH→node/cmd，Chrome→chrome），避免 PID 复用误杀
 *   - 端口被非本环境进程占用时也校验进程名，防止误杀无关服务
 *   - DSH / Chrome 输出重定向日志文件，父进程退出后子进程不崩
 *   - waitForUrl 不使用 redirect:'manual'（302 不再误判）
 *   - waitForTarget 用 URL 解析精确匹配端口，避免 :30801 误命中 :3080
 *   - findChromeExe 判空 LOCALAPPDATA
 *   - 主流程 try/catch 回滚，任一步失败清理已启动进程
 *   - SIGINT 异步等待清理完成
 */
import { spawn, execSync } from 'node:child_process';
import {
  existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync,
  openSync, closeSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

// ---------- 路径与常量 ----------
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const PID_FILE = join(tmpdir(), 'dsh-codegraph-dsh.pid');
const CHROME_PID_FILE = join(tmpdir(), 'dsh-codegraph-chrome.pid');
const TOKEN_FILE = join(tmpdir(), 'dsh-codegraph-token.txt');
const DSH_LOG = join(tmpdir(), 'dsh-codegraph-dsh.log');
const CHROME_LOG = join(tmpdir(), 'dsh-codegraph-chrome.log');

const DSH_HOSTS = ['127.0.0.1', 'localhost'];
const DSH_PORT = 3080;
const DSH_URL = `http://127.0.0.1:${DSH_PORT}`;
const DSH_URL_ALT = `http://localhost:${DSH_PORT}`;

const CHROME_DEBUG_PORT = 9222;
const CHROME_DEBUG_URL = `http://127.0.0.1:${CHROME_DEBUG_PORT}`;
const USER_DATA_DIR = join(PROJECT_ROOT, 'test-results', 'chrome-debug-profile');

// 进程名允许列表（小写、包含匹配）
const DSH_PROC_NAMES = ['node', 'cmd'];       // .cmd 包装最终监听端口的通常是 node.exe
const CHROME_PROC_NAMES = ['chrome'];

// ---------- 参数解析 ----------
const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('--'));
const action = (positional[0] || 'start').toLowerCase();
const verbose = args.includes('--verbose');
const force = args.includes('--force');
const timeoutArg = positional.find(a => /^\d+$/.test(a));
const timeoutSeconds = timeoutArg ? parseInt(timeoutArg, 10) : 30;

const SERVICE_PORTS = [
  { port: DSH_PORT,          name: 'DSH',        optional: false, pidFile: PID_FILE,        expectNames: DSH_PROC_NAMES },
  { port: CHROME_DEBUG_PORT, name: 'Chrome调试', optional: true,  pidFile: CHROME_PID_FILE, expectNames: CHROME_PROC_NAMES },
];

// ---------- 基础工具 ----------
function log(msg)  { console.log(`>>> ${msg}`); }
function warn(msg) { console.warn(`!!! ${msg}`); }
function dbg(msg)  { if (verbose) console.log(`    [debug] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------- 进程 / 端口工具 ----------
function findPidByPort(port) {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const re = new RegExp(`TCP\\s+\\S*:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`);
    for (const line of out.split('\n')) {
      const m = line.match(re);
      if (m) return parseInt(m[1], 10);
    }
  } catch { /* ignore */ }
  return null;
}

function isPortInUse(port) { return findPidByPort(port) !== null; }

/** 通过 tasklist 获取进程名（小写，如 chrome.exe）。不存在返回 null。 */
function getProcessName(pid) {
  const n = typeof pid === 'string' ? parseInt(pid, 10) : pid;
  if (!Number.isInteger(n) || n <= 0) return null;
  try {
    const out = execSync(`tasklist /FI "PID eq ${n}" /FO CSV /NH`, {
      encoding: 'utf8', timeout: 3000, windowsHide: true,
    });
    const m = out.trim().match(/^"([^"]+)"/);
    return m ? m[1].toLowerCase() : null;
  } catch { return null; }
}

/** 判断 PID 是否是期望进程名之一；进程不存在返回 false。 */
function processNameMatches(pid, expectedNames) {
  const name = getProcessName(pid);
  if (!name) return false;
  if (!expectedNames || expectedNames.length === 0) return true;
  return expectedNames.some(e => name.includes(e.toLowerCase()));
}

/**
 * 按 PID 杀进程。
 * @param {number|string} pid
 * @param {{ expectNames?: string[], force?: boolean }} [opts]
 *   - expectNames: 若提供，进程名不匹配则拒绝
 *   - force: 是否加 /F（false 时仅发 WM_CLOSE 等优雅关闭）
 */
function killProcess(pid, opts = {}) {
  const { expectNames = null, force = true } = opts;
  const n = typeof pid === 'string' ? parseInt(pid, 10) : pid;
  if (!Number.isInteger(n) || n <= 0) return false;

  if (expectNames && expectNames.length > 0) {
    const name = getProcessName(n);
    if (name && !expectNames.some(e => name.includes(e.toLowerCase()))) {
      warn(`PID ${n} 实际进程是 ${name}，不在预期 [${expectNames.join(',')}] 内，拒绝终止`);
      return false;
    }
  }

  const tail = force ? '/T /F' : '/T';
  try {
    execSync(`taskkill /PID ${n} ${tail}`, { stdio: 'ignore', windowsHide: true });
    return true;
  } catch { return false; }
}

function readPid(pidFile) {
  if (!existsSync(pidFile)) return null;
  let s = '';
  try { s = readFileSync(pidFile, 'utf8').trim(); } catch { return null; }
  if (!/^\d+$/.test(s)) return null;
  const pid = parseInt(s, 10);
  return pid > 0 ? pid : null;
}

function writePidFile(file, pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    warn(`PID 无效 (${pid})，跳过写入 ${file}`);
    return false;
  }
  try { writeFileSync(file, String(pid)); return true; }
  catch (e) { warn(`写入 PID 文件失败 ${file}: ${e.message}`); return false; }
}

function removePidFile(file) {
  try { unlinkSync(file); } catch { /* ignore */ }
}

/**
 * 按 PID 文件停止进程。三重校验:
 *  1. PID 文件格式
 *  2. 进程是否还存在（不存在直接清 PID 文件）
 *  3. 进程名是否匹配预期（不匹配视为陈旧 PID，清文件不杀）
 */
function killByPidFile(pidFile, label, expectNames) {
  const pid = readPid(pidFile);
  if (pid === null) {
    removePidFile(pidFile);
    return;
  }

  const procName = getProcessName(pid);
  if (!procName) {
    log(`${label} 进程 (PID: ${pid}) 已不存在，清理 PID 文件`);
    removePidFile(pidFile);
    return;
  }

  if (expectNames && expectNames.length > 0 &&
      !expectNames.some(e => procName.includes(e.toLowerCase()))) {
    warn(`${label} PID 文件指向 ${procName} (PID: ${pid})，不是本环境进程，忽略并清理`);
    removePidFile(pidFile);
    return;
  }

  if (killProcess(pid)) {
    log(`已停止 ${label} 进程 (PID: ${pid}, ${procName})`);
    removePidFile(pidFile);
  } else {
    warn(`${label} 进程 (PID: ${pid}) 无法终止，保留 PID 文件: ${pidFile}`);
  }
}

/**
 * spawn 并把 stdout/stderr 重定向到日志文件。
 * 父进程退出后子进程继续持有 fd，不会因为父进程 pipe 关闭而崩溃。
 */
function spawnWithLog(command, argv, options, logFile) {
  mkdirSync(dirname(logFile), { recursive: true });
  let fd = -1;
  try {
    fd = openSync(logFile, 'a');
    return spawn(command, argv, { ...options, stdio: ['ignore', fd, fd] });
  } finally {
    if (fd >= 0) { try { closeSync(fd); } catch { /* ignore */ } }
  }
}

// ---------- 等待 ----------
async function waitForUrl(urls, timeoutMs, proc = null) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    warn(`waitForUrl 收到无效超时值: ${timeoutMs}，回退为 30 秒`);
    timeoutMs = 30000;
  }
  const list = Array.isArray(urls) ? urls : [urls];
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (proc && proc.exitCode !== null) {
      warn(`进程已退出 (exitCode: ${proc.exitCode})，停止等待`);
      return null;
    }
    for (const url of list) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (res.status > 0) return url;
      } catch { /* keep waiting */ }
    }
    await sleep(500);
  }
  return null;
}

async function waitForPortFree(port, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isPortInUse(port)) return true;
    await sleep(200);
  }
  return false;
}

async function waitForChromeDebug(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${CHROME_DEBUG_URL}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        const data = await res.json();
        if (data['Browser'] && data['webSocketDebuggerUrl']) {
          dbg(`Chrome DevTools 就绪: ${data['Browser']}`);
          return true;
        }
      }
    } catch { /* keep waiting */ }
    await sleep(300);
  }
  return false;
}

/** 用 URL 解析精确匹配 DSH 目标，避免 :30801 误命中 :3080。 */
function isDshUrl(url) {
  try {
    const u = new URL(url);
    return DSH_HOSTS.includes(u.hostname) && String(u.port || '80') === String(DSH_PORT);
  } catch { return false; }
}

async function waitForTarget(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${CHROME_DEBUG_URL}/json`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        const targets = await res.json();
        const dshTarget = targets.find(t => t.type === 'page' && t.url && isDshUrl(t.url));
        if (dshTarget) {
          dbg(`找到 DSH 页面目标: ${dshTarget.title || '(无标题)'}`);
          return dshTarget;
        }
      }
    } catch { /* keep waiting */ }
    await sleep(500);
  }
  return null;
}

/** 探测环境当前健康状态（不杀进程）。 */
async function checkEnvironmentHealth() {
  const result = { dsh: false, chrome: false, chromeBrowser: null };
  try {
    const res = await fetch(DSH_URL, { signal: AbortSignal.timeout(2000) });
    result.dsh = res.status > 0;
  } catch { /* ignore */ }
  try {
    const res = await fetch(`${CHROME_DEBUG_URL}/json/version`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const data = await res.json();
      if (data['Browser']) {
        result.chrome = true;
        result.chromeBrowser = data['Browser'];
      }
    }
  } catch { /* ignore */ }
  return result;
}

// ---------- DSH / Chrome 定位 ----------
function findDshCmd() {
  const candidates = [
    'D:\\JetBrains\\nvm\\node_global\\dsh.cmd',
    join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', '.bin', 'dsh.cmd'),
  ];
  for (const p of candidates) { if (existsSync(p)) return p; }
  try {
    const out = execSync('where dsh.cmd', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }).trim().split('\n')[0];
    if (out && existsSync(out)) return out;
  } catch { /* ignore */ }
  return null;
}

function findChromeExe() {
  const localAppData = process.env.LOCALAPPDATA;
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    localAppData ? `${localAppData}\\Google\\Chrome\\Application\\chrome.exe` : null,
  ].filter(Boolean);
  for (const p of paths) { if (existsSync(p)) return p; }
  return null;
}

function cleanChromeLockFiles() {
  const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
  for (const f of lockFiles) {
    const p = join(USER_DATA_DIR, f);
    if (existsSync(p)) {
      try { unlinkSync(p); dbg(`已清理锁文件: ${f}`); } catch { /* ignore */ }
    }
  }
}

// ---------- 令牌管理 ----------
function getOrCreateFixedToken() {
  try {
    if (existsSync(TOKEN_FILE)) {
      const saved = readFileSync(TOKEN_FILE, 'utf8').trim();
      if (saved) {
        dbg(`从 ${TOKEN_FILE} 复用固定令牌`);
        return saved;
      }
    }
  } catch (e) {
    warn(`读取令牌文件失败: ${e.message}，将重新生成`);
  }
  const token = randomBytes(24).toString('hex');
  try {
    writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
    log(`生成新的固定令牌并保存到 ${TOKEN_FILE}`);
  } catch (e) {
    warn(`写入令牌文件失败: ${e.message}，本次使用内存令牌`);
  }
  return token;
}

function buildTokenUrl(token, host = '127.0.0.1') {
  return `http://${host}:${DSH_PORT}/?web_token=${encodeURIComponent(token)}`;
}

function extractTokenUrlFromLog(logFile) {
  try {
    if (!existsSync(logFile)) return null;
    const content = readFileSync(logFile, 'utf8');
    const re = /https?:\/\/[^\s"'<>\[\]()]+[?](?:web_)?token=[^\s"'<>\[\]()]+/g;
    const matches = [...content.matchAll(re)];
    if (matches.length === 0) return null;
    return matches[matches.length - 1][0];
  } catch { return null; }
}

// ---------- 启动前端口评估 ----------
/**
 * 扫描业务端口，占用则清理旧进程。
 * 杀进程前会校验进程名（防止误杀无关服务）。
 */
async function preflightPortCheck({ autoKill = true } = {}) {
  log('=== 启动前端口评估 ===');
  const conflicts = [];

  for (const s of SERVICE_PORTS) {
    const pid = findPidByPort(s.port);
    if (pid) {
      const pname = getProcessName(pid) || '?';
      console.log(`  [占用] ${s.name} 端口 ${s.port}  PID ${pid} (${pname})${s.optional ? '  (可选)' : ''}`);
      conflicts.push({ ...s, pid, procName: pname });
    } else {
      console.log(`  [空闲] ${s.name} 端口 ${s.port}`);
    }
  }

  if (conflicts.length === 0) {
    log('评估结果: 所有业务端口空闲');
    return { ok: true, conflicts };
  }

  if (!autoKill) {
    warn(`评估结果: ${conflicts.length} 个业务端口被占用`);
    return { ok: false, conflicts };
  }

  log(`评估结果: ${conflicts.length} 个业务端口被占用，开始清理旧进程...`);
  for (const c of conflicts) {
    // 校验进程名：避免误杀无关进程
    const expected = c.expectNames || [];
    const matches = expected.length === 0 || expected.some(e => c.procName.includes(e));
    if (!matches) {
      warn(`  端口 ${c.port} 被无关进程 ${c.procName} (PID ${c.pid}) 占用，跳过（如需强杀请手动处理）`);
      continue;
    }
    if (killProcess(c.pid, { expectNames: expected })) {
      log(`  已终止 ${c.name} (PID ${c.pid}, ${c.procName})`);
      removePidFile(c.pidFile);
    } else {
      warn(`  终止失败 ${c.name} (PID ${c.pid})，保留 PID 文件`);
    }
  }

  let allFreed = true;
  for (const c of conflicts) {
    const freed = await waitForPortFree(c.port, 5000);
    if (!freed) {
      warn(`  端口 ${c.port} 在 5s 内未释放`);
      allFreed = false;
    }
  }
  return { ok: allFreed, conflicts };
}

// ---------- 停止 / 状态 ----------
/**
 * 优雅关闭 Chrome：
 *  1. taskkill（不带 /F，发 WM_CLOSE）
 *  2. 等待最多 5s
 *  3. 未退出则 /F 强制
 */
async function stopChromeGracefully() {
  const pidFromFile = readPid(CHROME_PID_FILE);
  const pidFromPort = findPidByPort(CHROME_DEBUG_PORT);
  const pid = pidFromFile || pidFromPort;
  if (!pid) {
    removePidFile(CHROME_PID_FILE);
    return;
  }

  const name = getProcessName(pid);
  if (!name) {
    log(`Chrome 进程 (PID: ${pid}) 已不存在`);
    removePidFile(CHROME_PID_FILE);
    return;
  }
  if (!CHROME_PROC_NAMES.some(e => name.includes(e))) {
    warn(`PID 文件指向 ${name} (PID: ${pid})，不是 Chrome，忽略并清理`);
    removePidFile(CHROME_PID_FILE);
    return;
  }

  log(`优雅关闭 Chrome (PID: ${pid})...`);
  // 先发 WM_CLOSE，让 Chrome 正常退出（保存 profile、释放锁文件）
  killProcess(pid, { expectNames: CHROME_PROC_NAMES, force: false });

  // 等待退出（最多 5 秒）
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await sleep(400);
    if (!getProcessName(pid) && !isPortInUse(CHROME_DEBUG_PORT)) {
      log('Chrome 已优雅退出');
      removePidFile(CHROME_PID_FILE);
      return;
    }
  }

  warn(`Chrome 未在 5 秒内退出，强制终止 (PID: ${pid})`);
  killProcess(pid, { expectNames: CHROME_PROC_NAMES, force: true });

  // 再等 2 秒确保端口释放
  await waitForPortFree(CHROME_DEBUG_PORT, 2000);
  removePidFile(CHROME_PID_FILE);
}

async function stopEnvironment() {
  log('开始清理环境...');

  // 1) Chrome 优雅关闭（异步等待）
  await stopChromeGracefully();

  // 2) DSH：先按 PID 文件杀，再按端口兜底
  killByPidFile(PID_FILE, 'DSH', DSH_PROC_NAMES);
  const dshPidLeft = findPidByPort(DSH_PORT);
  if (dshPidLeft) {
    const pname = getProcessName(dshPidLeft) || '?';
    warn(`DSH 端口 ${DSH_PORT} 仍被 PID ${dshPidLeft} (${pname}) 占用，强制终止`);
    killProcess(dshPidLeft, { force: true });
  }

  // 3) 等待 DSH 端口释放
  const freed = await waitForPortFree(DSH_PORT, 5000);
  if (!freed) warn(`DSH 端口 ${DSH_PORT} 在 5s 内仍未释放`);

  // 保留 TOKEN_FILE，重启后复用同一令牌
  log('清理完成。');
}

function statusEnvironment() {
  log('=== 环境状态 ===');
  const dshPid = findPidByPort(DSH_PORT);
  const chromePid = findPidByPort(CHROME_DEBUG_PORT);
  const dshName = dshPid ? (getProcessName(dshPid) || '?') : '-';
  const chromeName = chromePid ? (getProcessName(chromePid) || '?') : '-';
  console.log(`DSH (${DSH_PORT}):        ${dshPid ? `运行中 (PID: ${dshPid}, ${dshName})` : '未运行'}`);
  console.log(`Chrome (${CHROME_DEBUG_PORT}):    ${chromePid ? `运行中 (PID: ${chromePid}, ${chromeName})` : '未运行'}`);
  console.log('');
  console.log(`DSH PID 文件:     ${PID_FILE}`);
  console.log(`Chrome PID 文件:  ${CHROME_PID_FILE}`);
  console.log(`令牌文件:         ${TOKEN_FILE}`);
  console.log(`DSH 日志:         ${DSH_LOG}`);
  console.log(`Chrome 日志:      ${CHROME_LOG}`);
}

// ---------- 启动 DSH ----------
async function startDsh() {
  const dshCmd = findDshCmd();
  if (!dshCmd) throw new Error('找不到 dsh.cmd');
  log(`使用 DSH: ${dshCmd}`);

  const fixedToken = getOrCreateFixedToken();
  const tokenUrl = buildTokenUrl(fixedToken);
  log(`固定令牌已就绪 (${fixedToken.slice(0, 8)}...)`);
  log(`认证 URL: ${tokenUrl}`);

  // 每次启动前清空日志，便于 ready 后精确提取 token URL
  try { unlinkSync(DSH_LOG); } catch { /* ignore */ }

  log(`启动 DSH Web 服务（注入固定令牌，超时 ${timeoutSeconds}s）...`);
  const dshProc = spawnWithLog('cmd.exe', ['/c', dshCmd, 'web', '--no-open'], {
    cwd: PROJECT_ROOT,
    detached: true,
    windowsHide: true,
    env: { ...process.env, DSH_WEB_TOKEN: fixedToken },
  }, DSH_LOG);

  let spawnFailed = false;
  dshProc.once('error', e => { spawnFailed = true; warn(`DSH spawn 失败: ${e.message}`); });

  await sleep(1000);
  if (spawnFailed) throw new Error('DSH spawn 失败');

  dshProc.unref();
  log(`DSH spawn PID: ${dshProc.pid} (日志: ${DSH_LOG})`);

  log(`等待服务就绪 (超时 ${timeoutSeconds}s)...`);
  const readyUrl = await waitForUrl([DSH_URL, DSH_URL_ALT], timeoutSeconds * 1000, dshProc);
  if (!readyUrl) {
    warn(`DSH Web 服务未能在 ${timeoutSeconds} 秒内就绪，请查看日志: ${DSH_LOG}`);
    if (dshProc.pid) killProcess(dshProc.pid, { force: true });
    throw new Error('DSH 未就绪');
  }
  log(`DSH Web 服务已就绪 (${readyUrl})`);

  const realPid = findPidByPort(DSH_PORT);
  const finalDshPid = realPid || dshProc.pid;
  if (realPid) log(`DSH 实际 PID: ${realPid}`);
  else warn(`无法通过端口查找 PID，使用 spawn PID: ${dshProc.pid}`);
  writePidFile(PID_FILE, finalDshPid);

  // ready 后从日志中提取 token URL
  let dshTokenUrl = tokenUrl;
  await sleep(300);
  const fromLog = extractTokenUrlFromLog(DSH_LOG);
  if (fromLog) {
    dshTokenUrl = fromLog;
    dbg(`从日志捕获 token URL: ${dshTokenUrl}`);
  } else {
    dbg('日志中未找到 token URL，使用构造的认证 URL');
  }

  return { dshProc, finalDshPid, fixedToken, tokenUrl, dshTokenUrl };
}

// ---------- 启动 Chrome ----------
async function startChrome(chromeUrl) {
  const chromeExe = findChromeExe();
  if (!chromeExe) throw new Error('找不到 Chrome 可执行文件');
  log(`使用 Chrome: ${chromeExe}`);

  if (!existsSync(USER_DATA_DIR)) mkdirSync(USER_DATA_DIR, { recursive: true });
  cleanChromeLockFiles();

  // 每次启动前清空 Chrome 日志（与 DSH 一致）
  try { unlinkSync(CHROME_LOG); } catch { /* ignore */ }

  log(`启动 Chrome 调试实例 (端口 ${CHROME_DEBUG_PORT})...`);
  log(`Chrome 将打开: ${chromeUrl}`);

  const chromeProc = spawnWithLog(chromeExe, [
    `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    '--window-size=1440,900',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-plugins',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-client-side-phishing-detection',
    '--disable-crash-reporter',
    '--disable-logging',
    '--disable-breakpad',
    '--no-pings',
    '--disable-features=TranslateUI',
    chromeUrl,
  ], {
    detached: true,
    windowsHide: true,
  }, CHROME_LOG);

  let spawnFailed = false;
  chromeProc.once('error', e => { spawnFailed = true; warn(`Chrome spawn 失败: ${e.message}`); });
  chromeProc.unref();
  await sleep(500);
  if (spawnFailed) throw new Error('Chrome spawn 失败');

  log('等待 Chrome DevTools 协议就绪...');
  const debugReady = await waitForChromeDebug(15000);
  if (!debugReady) {
    warn(`Chrome 调试端口未能在 15 秒内就绪，请查看日志: ${CHROME_LOG}`);
    if (chromeProc.pid) killProcess(chromeProc.pid, { force: true });
    throw new Error('Chrome DevTools 未就绪');
  }
  log('Chrome DevTools 协议已就绪');

  const chromeRealPid = findPidByPort(CHROME_DEBUG_PORT);
  const finalChromePid = chromeRealPid || chromeProc.pid;
  if (chromeRealPid) log(`Chrome 实际 PID: ${chromeRealPid}`);
  else log(`Chrome spawn PID: ${chromeProc.pid}`);
  writePidFile(CHROME_PID_FILE, finalChromePid);

  return { chromeProc, finalChromePid };
}

// ---------- 打印连接信息 ----------
function printConnectionInfo(dsh, chrome, dshTarget) {
  log('环境启动完成！');
  console.log('');
  console.log('=== MCP 连接信息 ===');
  console.log(`Chrome DevTools: ${CHROME_DEBUG_URL}`);
  if (dshTarget) {
    console.log(`DSH 页面 WebSocket: ${dshTarget.webSocketDebuggerUrl}`);
  }
  console.log(`DSH Web 服务: ${DSH_URL}`);
  if (dsh) {
    console.log(`DSH 固定令牌: ${dsh.fixedToken}`);
    console.log(`DSH 认证 URL: ${dsh.tokenUrl}`);
  }
  console.log('');
  console.log('chrome-devtools MCP 可直接使用，无需额外配置。');
  console.log('');
  if (dsh) log(`DSH PID: ${dsh.finalDshPid} (保存在 ${PID_FILE})`);
  if (chrome) log(`Chrome PID: ${chrome.finalChromePid} (保存在 ${CHROME_PID_FILE})`);
  log(`DSH 日志: ${DSH_LOG}`);
  log(`Chrome 日志: ${CHROME_LOG}`);
}

// ---------- 主流程 ----------
async function startEnvironment() {
  // 0) 幂等检查：环境已就绪时不再重复启动（除非 --force）
  if (!force) {
    const health = await checkEnvironmentHealth();
    if (health.dsh && health.chrome) {
      log('检测到 DSH 与 Chrome 均已在运行，跳过启动（幂等复用）');
      log(`Chrome: ${health.chromeBrowser}`);
      const dshTarget = await waitForTarget(5000);
      if (dshTarget) {
        log(`DSH 页面目标已就绪: ${dshTarget.title || '(无标题)'}`);
      } else {
        warn('已运行的 Chrome 中未找到 DSH 页面目标，可能需要手动刷新或重启');
      }
      // 复用场景下不重读令牌，从 TOKEN_FILE 读取用于打印
      let token = null;
      try { token = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() : null; } catch {}
      printConnectionInfo(
        token ? { fixedToken: token, tokenUrl: buildTokenUrl(token), finalDshPid: findPidByPort(DSH_PORT) } : null,
        { finalChromePid: findPidByPort(CHROME_DEBUG_PORT) },
        dshTarget,
      );
      process.exit(0);
    }
    if (health.dsh && !health.chrome) {
      log('检测到 DSH 已在运行但 Chrome 未启动，将只启动 Chrome');
      const token = (() => { try { return readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { return null; } })();
      if (!token) {
        warn('未找到令牌文件，无法复用 DSH 会话，将走完整重启流程');
      } else {
        const tokenUrl = buildTokenUrl(token);
        let chrome;
        try {
          chrome = await startChrome(tokenUrl);
        } catch (e) {
          warn(`Chrome 启动失败: ${e.message}`);
          process.exit(4);
        }
        log('等待 DSH 页面成为有效调试目标...');
        const dshTarget = await waitForTarget(20000);
        if (!dshTarget) warn('未能在 20 秒内找到 DSH 页面目标，MCP 可能需要手动附加');
        else log(`DSH 页面目标已就绪: ${dshTarget.title || '(无标题)'}`);
        printConnectionInfo(
          { fixedToken: token, tokenUrl, finalDshPid: findPidByPort(DSH_PORT) },
          chrome, dshTarget,
        );
        process.exit(0);
      }
    }
    // 其余情况（DSH 未运行）→ 走完整启动流程
  } else {
    log('--force 指定，强制完整重启流程');
  }

  // 1) 启动前端口评估（自动清理旧进程；端口未释放则终止）
  const { ok } = await preflightPortCheck({ autoKill: true });
  if (!ok) {
    warn('端口评估未通过，终止启动');
    process.exit(5);
  }

  // 2) 启动 DSH
  let dsh;
  try {
    dsh = await startDsh();
  } catch (e) {
    warn(`DSH 启动失败: ${e.message}`);
    await stopEnvironment();
    process.exit(1);
  }

  // 3) 启动 Chrome
  let chrome;
  try {
    chrome = await startChrome(dsh.dshTokenUrl || dsh.tokenUrl);
  } catch (e) {
    warn(`Chrome 启动失败: ${e.message}，回滚 DSH`);
    await stopEnvironment();
    process.exit(4);
  }

  // 4) 等待 DSH 页面成为有效调试目标
  log('等待 DSH 页面成为有效调试目标...');
  const dshTarget = await waitForTarget(20000);
  if (!dshTarget) {
    warn('未能在 20 秒内找到 DSH 页面目标，MCP 可能需要手动附加');
  } else {
    log(`DSH 页面目标已就绪: ${dshTarget.title || '(无标题)'}`);
    dbg(`目标 URL: ${dshTarget.url}`);
    dbg(`WebSocket: ${dshTarget.webSocketDebuggerUrl}`);
  }

  printConnectionInfo(dsh, chrome, dshTarget);
  process.exit(0);
}

// ---------- 信号处理 ----------
let shuttingDown = false;
async function handleShutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`收到 ${sig}，正在清理...`);
  try { await stopEnvironment(); } catch (e) { warn(`清理异常: ${e.message}`); }
  process.exit(0);
}
process.on('SIGINT',  () => { handleShutdown('SIGINT'); });
process.on('SIGTERM', () => { handleShutdown('SIGTERM'); });

// ---------- 入口 ----------
try {
  if (action === 'stop') {
    await stopEnvironment();
    process.exit(0);
  } else if (action === 'status') {
    statusEnvironment();
    process.exit(0);
  } else if (action === 'check') {
    const { ok } = await preflightPortCheck({ autoKill: false });
    process.exit(ok ? 0 : 1);
  } else if (action === 'restart') {
    await stopEnvironment();
    await sleep(1000);
    await startEnvironment();
  } else {
    await startEnvironment();
  }
} catch (e) {
  console.error(`脚本执行异常: ${e.stack || e}`);
  process.exit(100);
}