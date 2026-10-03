#!/usr/bin/env node
/**
 * DSH Web 调试环境启动脚本（Windows）
 *
 * 用法:
 *   node start-dsh-test.mjs start   [--verbose] [--force] [--fresh-profile] [timeout]
 *   node start-dsh-test.mjs stop
 *   node start-dsh-test.mjs restart [--verbose] [timeout]
 *   node start-dsh-test.mjs status
 *   node start-dsh-test.mjs check
 *
 * 本版修复（针对"浏览器无法正常启动"）:
 *   - Chrome 不再使用 windowsHide（避免主窗口被隐藏）
 *   - 回滚 / 超时时按"端口 PID"杀，而不是按 spawn PID（Chrome 是 multi-process）
 *   - 去掉 --disable-logging，崩溃时能拿到日志
 *   - 增加 --remote-allow-origins=*（Chrome 111+ 必需）
 *   - 增加 --disable-session-crashed-bubble / --hide-crash-restore-bubble（避免恢复气泡卡启动）
 *   - 增加 --new-window
 *   - spawn 后校验 chromeProc.exitCode，早退立刻报错并回显日志尾部
 *   - 等待 DevTools 超时 / 失败时回显 CHROME_LOG 尾部
 *   - 提供 --fresh-profile：启动失败自动清空 profile 重试
 *   - 幂等复用时若拿不到 DSH target 会告警而不是静默成功
 *   - exit 前 sleep 300ms 让 detached 子进程稳定
 */
import { spawn, execSync } from 'node:child_process';
import {
  existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync,
  openSync, closeSync, rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';

// ---------- 路径与常量 ----------
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const PID_FILE = join(tmpdir(), 'dsh-codegraph-dsh.pid');
const CHROME_PID_FILE = join(tmpdir(), 'dsh-codegraph-chrome.pid');
const DSH_LOG = join(tmpdir(), 'dsh-codegraph-dsh.log');
const CHROME_LOG = join(tmpdir(), 'dsh-codegraph-chrome.log');

const DSH_HOSTS = ['127.0.0.1', 'localhost'];
const DSH_PORT = 3080;
const DSH_URL = `http://127.0.0.1:${DSH_PORT}`;
const DSH_URL_ALT = `http://localhost:${DSH_PORT}`;

const CHROME_DEBUG_PORT = 9222;
const CHROME_DEBUG_URL = `http://127.0.0.1:${CHROME_DEBUG_PORT}`;
const USER_DATA_DIR = join(PROJECT_ROOT, 'test-results', 'chrome-debug-profile');

const DSH_PROC_NAMES = ['node', 'cmd'];
const CHROME_PROC_NAMES = ['chrome'];

// ---------- 参数解析 ----------
const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('--'));
const action = (positional[0] || 'start').toLowerCase();
const verbose = args.includes('--verbose');
const force = args.includes('--force');
const freshProfile = args.includes('--fresh-profile');
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

/** 读取日志文件末尾若干字符，用于失败诊断。 */
function readLogTail(logFile, maxBytes = 4000) {
  try {
    if (!existsSync(logFile)) return null;
    const buf = readFileSync(logFile);
    const tail = buf.length > maxBytes ? buf.subarray(buf.length - maxBytes) : buf;
    return tail.toString('utf8').trim();
  } catch { return null; }
}

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

function killByPidFile(pidFile, label, expectNames) {
  const pid = readPid(pidFile);
  if (pid === null) { removePidFile(pidFile); return; }

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

/**
 * 把 `dsh.cmd` 垫片解析成它真正执行的 Node 入口。
 *
 * 必须绕过 .cmd：`cmd.exe /c dsh.cmd` 以 detached（无控制台）方式启动时，
 * 垫片里 `endLocal & goto … & title %COMSPEC% & node …` 这条链会把子进程的
 * stdout 丢掉（实测 `dsh.cmd --version` 重定向到文件后是 0 字节，直接
 * `node bin.js --version` 则有输出）。而 DSH 的认证 URL 只从 stdout 打印，
 * 所以拿不到它就等于 J0 无法鉴权。
 */
function resolveDshEntry(dshCmd) {
  const guess = join(dirname(dshCmd), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  return existsSync(guess) ? guess : null;
}

function findChromeExe() {
  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const paths = [
    join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    localAppData ? join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
  ].filter(Boolean);
  for (const p of paths) { if (existsSync(p)) return p; }
  return null;
}

function cleanChromeLockFiles() {
  const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'];
  for (const f of lockFiles) {
    const p = join(USER_DATA_DIR, f);
    if (existsSync(p)) {
      try { unlinkSync(p); dbg(`已清理锁文件: ${f}`); } catch { /* ignore */ }
    }
  }
}

function wipeChromeProfile() {
  try {
    if (existsSync(USER_DATA_DIR)) {
      rmSync(USER_DATA_DIR, { recursive: true, force: true });
      log(`已清空 Chrome profile: ${USER_DATA_DIR}`);
    }
  } catch (e) {
    warn(`清空 profile 失败: ${e.message}`);
  }
}

// ---------- 认证 URL 管理 ----------
// DSH 的启动令牌是每进程随机、只存在于内存与它自己打印的 URL 中的（查询参数名是
// `token`，没有 `web_token` 语义，也没有任何环境变量入口 —— 见
// @deepseek-ai/dsh-client-connection 的 PROCESS_LAUNCH_TOKENS WeakMap）。
// 因此唯一可行的获取方式就是捕获 `dsh web` 写到 stdout 的那一行。
const DSH_URL_LINE_RE = /dsh web:\s*(https?:\/\/\S+)/;

function extractTokenUrlFromLog(logFile) {
  try {
    if (!existsSync(logFile)) return null;
    const content = readFileSync(logFile, 'utf8');
    const direct = DSH_URL_LINE_RE.exec(content);
    if (direct) return direct[1];
    const matches = [...content.matchAll(/https?:\/\/127\.0\.0\.1:\d+\/\?token=\S+/g)];
    if (matches.length === 0) return null;
    return matches[matches.length - 1][0];
  } catch { return null; }
}

/** 轮询 DSH 日志等待 `dsh web:` 认证 URL（它紧随服务就绪打印）。 */
async function waitForTokenUrlFromLog(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const url = extractTokenUrlFromLog(DSH_LOG);
    if (url) return url;
    if (Date.now() >= deadline) return null;
    await sleep(250);
  }
}

// ---------- 启动前端口评估 ----------
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

// ---------- 停止 ----------
async function stopChromeGracefully() {
  const pidFromFile = readPid(CHROME_PID_FILE);
  const pidFromPort = findPidByPort(CHROME_DEBUG_PORT);
  const pid = pidFromFile || pidFromPort;
  if (!pid) { removePidFile(CHROME_PID_FILE); return; }

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
  killProcess(pid, { expectNames: CHROME_PROC_NAMES, force: false });

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

  // 端口兜底：multi-process Chrome 可能由子进程持有 9222
  const leftover = findPidByPort(CHROME_DEBUG_PORT);
  if (leftover && leftover !== pid) {
    const lname = getProcessName(leftover) || '?';
    if (CHROME_PROC_NAMES.some(e => lname.includes(e))) {
      warn(`Chrome 调试端口仍被 PID ${leftover} (${lname}) 占用，强制终止`);
      killProcess(leftover, { expectNames: CHROME_PROC_NAMES, force: true });
    }
  }

  await waitForPortFree(CHROME_DEBUG_PORT, 3000);
  removePidFile(CHROME_PID_FILE);
}

async function stopEnvironment() {
  log('开始清理环境...');
  await stopChromeGracefully();

  killByPidFile(PID_FILE, 'DSH', DSH_PROC_NAMES);
  const dshPidLeft = findPidByPort(DSH_PORT);
  if (dshPidLeft) {
    const pname = getProcessName(dshPidLeft) || '?';
    warn(`DSH 端口 ${DSH_PORT} 仍被 PID ${dshPidLeft} (${pname}) 占用，强制终止`);
    killProcess(dshPidLeft, { force: true });
  }

  const freed = await waitForPortFree(DSH_PORT, 5000);
  if (!freed) warn(`DSH 端口 ${DSH_PORT} 在 5s 内仍未释放`);

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
  console.log(`DSH 日志:         ${DSH_LOG}`);
  console.log(`Chrome 日志:      ${CHROME_LOG}`);
  console.log(`Chrome profile:   ${USER_DATA_DIR}`);
}

// ---------- 启动 DSH ----------
async function startDsh() {
  const dshCmd = findDshCmd();
  if (!dshCmd) throw new Error('找不到 dsh.cmd');
  log(`使用 DSH: ${dshCmd}`);

  try { unlinkSync(DSH_LOG); } catch { /* ignore */ }

  log(`启动 DSH Web 服务（超时 ${timeoutSeconds}s）...`);
  const dshEntry = resolveDshEntry(dshCmd);
  const dshProc = dshEntry
    ? spawnWithLog(process.execPath, [dshEntry, 'web', '--no-open'], {
        cwd: PROJECT_ROOT, detached: true, windowsHide: true,
      }, DSH_LOG)
    : spawnWithLog('cmd.exe', ['/c', dshCmd, 'web', '--no-open'], {
        cwd: PROJECT_ROOT, detached: true, windowsHide: true,
      }, DSH_LOG);
  if (!dshEntry) warn(`未能从 ${dshCmd} 解析出 Node 入口，回退 cmd.exe 垫片（可能捕获不到认证 URL）`);

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
    const tail = readLogTail(DSH_LOG);
    if (tail) warn(`DSH 日志尾部:\n${tail}`);
    const pid = findPidByPort(DSH_PORT);
    if (pid) killProcess(pid, { force: true });
    else if (dshProc.pid) killProcess(dshProc.pid, { force: true });
    throw new Error('DSH 未就绪');
  }
  log(`DSH Web 服务已就绪 (${readyUrl})`);

  const realPid = findPidByPort(DSH_PORT);
  const finalDshPid = realPid || dshProc.pid;
  if (realPid) log(`DSH 实际 PID: ${realPid}`);
  else warn(`无法通过端口查找 PID，使用 spawn PID: ${dshProc.pid}`);
  writePidFile(PID_FILE, finalDshPid);

  const dshTokenUrl = await waitForTokenUrlFromLog(5000);
  if (dshTokenUrl) log(`认证 URL 已捕获: ${dshTokenUrl}`);
  else warn(`未能从 ${DSH_LOG} 捕获 DSH 认证 URL —— 新开的 Chrome 会停在被拒绝访问页面；请检查日志`);

  return { dshProc, finalDshPid, dshTokenUrl };
}

// ---------- 启动 Chrome ----------
async function startChrome(chromeUrl) {
  const chromeExe = findChromeExe();
  if (!chromeExe) throw new Error('找不到 Chrome 可执行文件');
  log(`使用 Chrome: ${chromeExe}`);

  if (!existsSync(USER_DATA_DIR)) mkdirSync(USER_DATA_DIR, { recursive: true });
  cleanChromeLockFiles();

  try { unlinkSync(CHROME_LOG); } catch { /* ignore */ }

  log(`启动 Chrome 调试实例 (端口 ${CHROME_DEBUG_PORT})...`);
  log(`Chrome 将打开: ${chromeUrl}`);

  // 关键参数说明：
  //   --remote-debugging-port      暴露 DevTools 协议
  //   --remote-allow-origins=*     Chrome 111+ 必需，否则 WS 握手被拒
  //   --user-data-dir              独立 profile
  //   --new-window                 新开窗口，避免复用已有窗口
  //   --disable-session-crashed-bubble / --hide-crash-restore-bubble
  //                                避免"恢复会话"气泡阻塞启动
  //   --no-first-run / --no-default-browser-check
  //                                跳过首启流程
  const chromeArgs = [
    `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${USER_DATA_DIR}`,
    '--window-size=1440,900',
    '--new-window',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-client-side-phishing-detection',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--no-pings',
    '--disable-features=TranslateUI,Translate',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    chromeUrl,
  ];

  dbg(`Chrome 参数:\n  ${chromeArgs.join('\n  ')}`);

  // 注意：Chrome 是 GUI 应用，不要用 windowsHide（会隐藏主窗口）
  const chromeProc = spawnWithLog(chromeExe, chromeArgs, {
    detached: true,
    // windowsHide: false —— 显式不写，保持默认 false
  }, CHROME_LOG);

  let spawnFailed = false;
  let spawnErr = null;
  chromeProc.once('error', e => { spawnFailed = true; spawnErr = e; warn(`Chrome spawn 失败: ${e.message}`); });

  chromeProc.unref();
  await sleep(1500);

  if (spawnFailed) {
    throw new Error(`Chrome spawn 失败: ${spawnErr?.message || 'unknown'}`);
  }

  // 检测 Chrome 是否立即退出（例如 profile 损坏、被策略阻止）
  if (chromeProc.exitCode !== null && chromeProc.exitCode !== 0) {
    const tail = readLogTail(CHROME_LOG);
    warn(`Chrome 启动后立即退出 (exitCode=${chromeProc.exitCode})`);
    if (tail) warn(`Chrome 日志尾部:\n${tail}`);
    throw new Error(`Chrome 异常退出 (code=${chromeProc.exitCode})`);
  }

  log('等待 Chrome DevTools 协议就绪...');
  const debugReady = await waitForChromeDebug(20000);
  if (!debugReady) {
    const tail = readLogTail(CHROME_LOG);
    warn(`Chrome 调试端口未能在 20 秒内就绪，请查看日志: ${CHROME_LOG}`);
    if (tail) warn(`Chrome 日志尾部:\n${tail}`);

    // 回滚：优先用端口 PID（multi-process Chrome 的实际监听者）
    const pid = findPidByPort(CHROME_DEBUG_PORT);
    if (pid) {
      warn(`强制终止占用 ${CHROME_DEBUG_PORT} 的进程 PID ${pid}`);
      killProcess(pid, { force: true });
    } else if (chromeProc.pid) {
      killProcess(chromeProc.pid, { force: true });
    }
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
  } else {
    console.log('DSH 页面 WebSocket: (未找到 DSH 页面，请手动在 Chrome 中打开)');
  }
  console.log(`DSH Web 服务: ${DSH_URL}`);
  if (dsh?.dshTokenUrl || dsh?.tokenUrl) {
    console.log(`DSH 认证 URL: ${dsh.dshTokenUrl || dsh.tokenUrl}`);
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
  // 0) 幂等检查
  if (!force) {
    const health = await checkEnvironmentHealth();
    if (health.dsh && health.chrome) {
      log('检测到 DSH 与 Chrome 均已在运行，跳过启动（幂等复用）');
      log(`Chrome: ${health.chromeBrowser}`);
      const dshTarget = await waitForTarget(8000);
      if (dshTarget) {
        log(`DSH 页面目标已就绪: ${dshTarget.title || '(无标题)'}`);
      } else {
        warn('已运行的 Chrome 中未找到 DSH 页面目标，请手动刷新或使用 --force 重启');
      }
      const reusedUrl = extractTokenUrlFromLog(DSH_LOG);
      if (!reusedUrl) warn(`无法从 ${DSH_LOG} 恢复认证 URL；如需新开 Chrome 请用 --force 重启 DSH`);
      printConnectionInfo(
        { dshTokenUrl: reusedUrl, finalDshPid: findPidByPort(DSH_PORT) },
        { finalChromePid: findPidByPort(CHROME_DEBUG_PORT) },
        dshTarget,
      );
      await sleep(300);
      process.exit(0);
    }
    if (health.dsh && !health.chrome) {
      log('检测到 DSH 已在运行但 Chrome 未启动，将只启动 Chrome');
      const tokenUrl = extractTokenUrlFromLog(DSH_LOG);
      if (!tokenUrl) {
        warn(`无法从 ${DSH_LOG} 恢复 DSH 认证 URL，将走完整重启流程`);
      } else {
        let chrome;
        try {
          chrome = await startChrome(tokenUrl);
        } catch (e) {
          warn(`Chrome 启动失败: ${e.message}`);
          // 只启动 Chrome 失败 → 清理并整体重启
          warn('尝试完整重启环境...');
          await stopEnvironment();
          await sleep(1000);
          return await startEnvironment();
        }
        log('等待 DSH 页面成为有效调试目标...');
        const dshTarget = await waitForTarget(20000);
        if (!dshTarget) warn('未能在 20 秒内找到 DSH 页面目标，MCP 可能需要手动附加');
        else log(`DSH 页面目标已就绪: ${dshTarget.title || '(无标题)'}`);
        printConnectionInfo(
          { dshTokenUrl: tokenUrl, finalDshPid: findPidByPort(DSH_PORT) },
          chrome, dshTarget,
        );
        await sleep(300);
        process.exit(0);
      }
    }
  } else {
    log('--force 指定，强制完整重启流程');
  }

  // 1) 端口评估
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

  // 3) 启动 Chrome（失败时可选 fresh-profile 重试一次）
  const chromeUrl = dsh.dshTokenUrl || DSH_URL;
  if (!dsh.dshTokenUrl) {
    warn('没有认证 URL，Chrome 只会打开未鉴权首页（会显示 authentication required）');
  }
  let chrome;
  try {
    chrome = await startChrome(chromeUrl);
  } catch (e) {
    warn(`Chrome 启动失败: ${e.message}`);
    if (freshProfile) {
      warn('--fresh-profile：清空 profile 后重试一次');
      try { await stopChromeGracefully(); } catch {}
      wipeChromeProfile();
      try {
        chrome = await startChrome(chromeUrl);
        log('fresh-profile 重试成功');
      } catch (e2) {
        warn(`Chrome 重试仍失败: ${e2.message}，回滚 DSH`);
        await stopEnvironment();
        process.exit(4);
      }
    } else {
      warn('提示：若怀疑 profile 损坏，可加 --fresh-profile 重试');
      await stopEnvironment();
      process.exit(4);
    }
  }

  // 4) 等待 DSH 页面成为调试目标
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
  await sleep(300); // 让 detached 子进程稳定
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