import { spawn, execSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const PID_FILE = join(tmpdir(), 'dsh-codegraph-dsh.pid');
const CHROME_PID_FILE = join(tmpdir(), 'dsh-codegraph-chrome.pid');
const TOKEN_FILE = join(tmpdir(), 'dsh-codegraph-token.txt');

const DSH_HOSTS = ['127.0.0.1', 'localhost'];
const DSH_PORT = 3080;
const DSH_URL = `http://127.0.0.1:${DSH_PORT}`;
const DSH_URL_ALT = `http://localhost:${DSH_PORT}`;

const CHROME_DEBUG_URL = 'http://127.0.0.1:9222';
const USER_DATA_DIR = join(__dirname, '..', 'test-results', 'chrome-debug-profile');

// ============ 参数解析（修复 NaN bug） ============
const args = process.argv.slice(2);
const action = args[0] || 'start';
const verbose = args.includes('--verbose');
// 只把纯数字参数当作超时秒数，避免把 --verbose 等标志误解析为 NaN
const timeoutArg = args.find(a => /^\d+$/.test(a));
const timeoutSeconds = timeoutArg ? parseInt(timeoutArg, 10) : 30;
// =================================================

function log(msg) { console.log(`>>> ${msg}`); }
function dbg(msg) { if (verbose) console.log(`    [debug] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============ 固定令牌管理 ============
function getOrCreateFixedToken() {
  if (existsSync(TOKEN_FILE)) {
    const saved = readFileSync(TOKEN_FILE, 'utf8').trim();
    if (saved) {
      dbg(`从 ${TOKEN_FILE} 复用固定令牌`);
      return saved;
    }
  }
  const token = randomBytes(24).toString('hex');
  writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  log(`生成新的固定令牌并保存到 ${TOKEN_FILE}`);
  return token;
}

function buildTokenUrl(token, host = '127.0.0.1') {
  return `http://${host}:${DSH_PORT}/?web_token=${encodeURIComponent(token)}`;
}
// =====================================

// ============ 等待服务就绪（含 NaN 保护 + 进程存活检查） ============
async function waitForUrl(urls, timeoutMs, proc = null) {
  // 防御：无效超时值回退为 30 秒
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    console.error(`waitForUrl 收到无效超时值: ${timeoutMs}，回退为 30 秒`);
    timeoutMs = 30000;
  }
  const list = Array.isArray(urls) ? urls : [urls];
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // 若子进程已退出，立即停止等待
    if (proc && proc.exitCode !== null) {
      console.error(`DSH 进程已退出 (exitCode: ${proc.exitCode})，停止等待`);
      return null;
    }
    for (const url of list) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(2000),
          redirect: 'manual',
        });
        if (res.status > 0) return url;
      } catch { /* keep waiting */ }
    }
    await sleep(500);
  }
  return null;
}
// ==================================================================

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

async function waitForTarget(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${CHROME_DEBUG_URL}/json`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        const targets = await res.json();
        const dshTarget = targets.find(t => {
          if (!t.url) return false;
          const u = t.url;
          return DSH_HOSTS.some(h => u.includes(`${h}:${DSH_PORT}`));
        });
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

function findDshCmd() {
  const candidates = [
    'D:\\JetBrains\\nvm\\node_global\\dsh.cmd',
    join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', '.bin', 'dsh.cmd'),
  ];
  for (const p of candidates) { if (existsSync(p)) return p; }
  try {
    const out = execSync('where dsh.cmd', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim().split('\n')[0];
    if (out && existsSync(out)) return out;
  } catch { /* */ }
  return null;
}

function findChromeExe() {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  ];
  for (const p of paths) { if (existsSync(p)) return p; }
  return null;
}

function findPidByPort(port) {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8', timeout: 5000 });
    const re = new RegExp(`TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`);
    for (const line of out.split('\n')) {
      const m = line.match(re);
      if (m) return parseInt(m[1], 10);
    }
  } catch { /* */ }
  return null;
}

function isPortInUse(port) { return findPidByPort(port) !== null; }

function killProcess(pid) {
  try { execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function killChromeByPidFile() {
  if (!existsSync(CHROME_PID_FILE)) return;
  const pid = readFileSync(CHROME_PID_FILE, 'utf8').trim();
  if (/^\d+$/.test(pid)) {
    if (killProcess(pid)) log(`已停止 Chrome 进程 (PID: ${pid})`);
    else log(`Chrome 进程 (PID: ${pid}) 已不存在`);
  }
  try { unlinkSync(CHROME_PID_FILE); } catch { /* */ }
}

function cleanChromeLockFiles() {
  const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
  for (const f of lockFiles) {
    const p = join(USER_DATA_DIR, f);
    if (existsSync(p)) {
      try { unlinkSync(p); dbg(`已清理锁文件: ${f}`); } catch { /* */ }
    }
  }
}

function stopEnvironment() {
  log('开始清理环境...');
  if (existsSync(PID_FILE)) {
    const pid = readFileSync(PID_FILE, 'utf8').trim();
    if (/^\d+$/.test(pid)) {
      if (killProcess(pid)) log(`已停止 DSH 进程 (PID: ${pid})`);
      else log(`DSH 进程 (PID: ${pid}) 已不存在`);
    }
    try { unlinkSync(PID_FILE); } catch { /* */ }
  }
  killChromeByPidFile();
  // 保留 TOKEN_FILE，重启后复用同一令牌
  log('清理完成。');
}

async function startEnvironment() {
  stopEnvironment();

  if (isPortInUse(DSH_PORT)) {
    const pid = findPidByPort(DSH_PORT);
    console.error(`端口 ${DSH_PORT} 已被占用 (PID: ${pid})，请先释放该端口`);
    process.exit(5);
  }
  if (isPortInUse(9222)) {
    const pid = findPidByPort(9222);
    console.error(`端口 9222 已被占用 (PID: ${pid})，请先释放该端口`);
    process.exit(5);
  }

  const dshCmd = findDshCmd();
  if (!dshCmd) { console.error('找不到 dsh.cmd'); process.exit(1); }
  log(`使用 DSH: ${dshCmd}`);

  const fixedToken = getOrCreateFixedToken();
  const tokenUrl = buildTokenUrl(fixedToken);
  log(`固定令牌已就绪 (${fixedToken.slice(0, 8)}...)`);
  log(`认证 URL: ${tokenUrl}`);

  log(`启动 DSH Web 服务（注入固定令牌，超时 ${timeoutSeconds}s）...`);
  let dshTokenUrl = tokenUrl;
  let lastLoggedLine = '';

  const dshProc = spawn('cmd.exe', ['/c', dshCmd, 'web', '--no-open'], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      DSH_WEB_TOKEN: fixedToken,
    },
  });

  const handleOutput = (chunk) => {
    const text = chunk.toString().trim();
    if (!text) return;
    // 捕获 DSH 打印的 token URL（兼容 ?token= 和 ?web_token=），排除尾随标点
    const tokenMatch = text.match(/https?:\/\/[^\s"'<>\[\]()]+[?](?:web_)?token=[^\s"'<>\[\]()]+/);
    if (tokenMatch) {
      dshTokenUrl = tokenMatch[0];
      dbg(`捕获到 DSH 打印的 token URL: ${dshTokenUrl}`);
    }
    if (verbose && text !== lastLoggedLine) {
      lastLoggedLine = text;
      dbg(`[dsh] ${text.substring(0, 300)}`);
    }
  };
  dshProc.stdout?.on('data', handleOutput);
  dshProc.stderr?.on('data', handleOutput);

  let spawnFailed = false;
  dshProc.once('error', () => { spawnFailed = true; });

  await sleep(1000);
  if (spawnFailed) {
    console.error('DSH spawn 失败');
    process.exit(1);
  }

  dshProc.unref();
  log(`DSH spawn PID: ${dshProc.pid}`);

  log(`等待服务就绪 (超时 ${timeoutSeconds}s)...`);
  const readyUrl = await waitForUrl([DSH_URL, DSH_URL_ALT], timeoutSeconds * 1000, dshProc);
  if (!readyUrl) {
    console.error(`DSH Web 服务未能在 ${timeoutSeconds} 秒内就绪`);
    if (dshProc.pid) killProcess(dshProc.pid);
    process.exit(2);
  }
  log(`DSH Web 服务已就绪 (${readyUrl})`);

  const realPid = findPidByPort(DSH_PORT);
  const finalDshPid = realPid || dshProc.pid;
  if (realPid) log(`DSH 实际 PID: ${realPid}`);
  else log(`警告: 无法通过端口查找 PID，使用 spawn PID: ${dshProc.pid}`);
  writeFileSync(PID_FILE, String(finalDshPid));

  const chromeExe = findChromeExe();
  if (!chromeExe) {
    console.error('找不到 Chrome 可执行文件');
    process.exit(3);
  }
  log(`使用 Chrome: ${chromeExe}`);

  if (!existsSync(USER_DATA_DIR)) {
    mkdirSync(USER_DATA_DIR, { recursive: true });
  }
  cleanChromeLockFiles();

  log('启动 Chrome 调试实例 (端口 9222)...');
  const chromeUrl = dshTokenUrl || tokenUrl;
  log(`Chrome 将打开: ${chromeUrl}`);

  const chromeProc = spawn(chromeExe, [
    '--remote-debugging-port=9222',
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
  ], { detached: true, stdio: 'ignore' });
  chromeProc.unref();

  log('等待 Chrome DevTools 协议就绪...');
  const debugReady = await waitForChromeDebug(15000);
  if (!debugReady) {
    console.error('Chrome 调试端口未能在 15 秒内就绪');
    if (chromeProc.pid) killProcess(chromeProc.pid);
    process.exit(4);
  }
  log('Chrome DevTools 协议已就绪');

  const chromeRealPid = findPidByPort(9222);
  const finalChromePid = chromeRealPid || chromeProc.pid;
  if (chromeRealPid) log(`Chrome 实际 PID: ${chromeRealPid}`);
  else log(`Chrome spawn PID: ${chromeProc.pid}`);
  writeFileSync(CHROME_PID_FILE, String(finalChromePid));

  log('等待 DSH 页面成为有效调试目标...');
  const dshTarget = await waitForTarget(20000);
  if (!dshTarget) {
    log('警告: 未能在 20 秒内找到 DSH 页面目标，MCP 可能需要手动附加');
  } else {
    log(`DSH 页面目标已就绪: ${dshTarget.title || '(无标题)'}`);
    dbg(`目标 URL: ${dshTarget.url}`);
    dbg(`WebSocket: ${dshTarget.webSocketDebuggerUrl}`);
  }

  log('环境启动完成！');
  console.log('');
  console.log('=== MCP 连接信息 ===');
  console.log(`Chrome DevTools: ${CHROME_DEBUG_URL}`);
  if (dshTarget) {
    console.log(`DSH 页面 WebSocket: ${dshTarget.webSocketDebuggerUrl}`);
  }
  console.log(`DSH Web 服务: ${readyUrl}`);
  console.log(`DSH 固定令牌: ${fixedToken}`);
  console.log(`DSH 认证 URL: ${tokenUrl}`);
  console.log('');
  console.log('chrome-devtools MCP 可直接使用，无需额外配置。');
  console.log('');
  log(`DSH PID: ${finalDshPid} (保存在 ${PID_FILE})`);
  log(`Chrome PID: ${finalChromePid} (保存在 ${CHROME_PID_FILE})`);
  process.exit(0);
}

process.on('SIGINT', () => {
  log('收到 SIGINT，正在清理...');
  stopEnvironment();
  process.exit(0);
});

try {
  if (action.toLowerCase() === 'stop') {
    stopEnvironment();
    process.exit(0);
  } else {
    await startEnvironment();
  }
} catch (e) {
  console.error(`脚本执行异常: ${e}`);
  process.exit(100);
}