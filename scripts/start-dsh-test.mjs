import { spawn, execSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const PID_FILE = join(tmpdir(), 'dsh-codegraph-dsh.pid');
const CHROME_PID_FILE = join(tmpdir(), 'dsh-codegraph-chrome.pid');
const DSH_URL = 'http://localhost:3080';
const CHROME_DEBUG_URL = 'http://127.0.0.1:9222';
const USER_DATA_DIR = join(__dirname, '..', 'test-results', 'chrome-debug-profile');

const action = process.argv[2] || 'start';
const timeoutSeconds = parseInt(process.argv[3] || '30', 10);

function log(msg) { console.log(`>>> ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForUrl(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch { /* keep waiting */ }
    await sleep(500);
  }
  return false;
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
  log('清理完成。');
}

async function startEnvironment() {
  stopEnvironment();

  const dshCmd = findDshCmd();
  if (!dshCmd) { console.error('找不到 dsh.cmd'); process.exit(1); }
  log(`使用 DSH: ${dshCmd}`);

  log('启动 DSH Web 服务 (无窗口)...');
  const dshProc = spawn('cmd.exe', ['/c', dshCmd, 'web', '--no-open'], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });

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
  const ready = await waitForUrl(DSH_URL, timeoutSeconds * 1000);
  if (!ready) {
    console.error(`DSH Web 服务未能在 ${timeoutSeconds} 秒内就绪`);
    if (dshProc.pid) killProcess(dshProc.pid);
    process.exit(2);
  }
  log(`DSH Web 服务已就绪 (${DSH_URL})`);

  const realPid = findPidByPort(3080);
  const finalDshPid = realPid || dshProc.pid;
  if (realPid) {
    log(`DSH 实际 PID: ${realPid} (通过端口 3080 查找)`);
  } else {
    log(`警告: 无法通过端口查找 PID，使用 spawn PID: ${dshProc.pid}`);
  }
  writeFileSync(PID_FILE, String(finalDshPid));

  const chromeExe = findChromeExe();
  if (!chromeExe) {
    console.error('找不到 Chrome 可执行文件');
    process.exit(3);
  }
  log(`使用 Chrome: ${chromeExe}`);

  log('启动 Chrome 调试实例 (端口 9222)...');
  const chromeProc = spawn(chromeExe, [
    '--remote-debugging-port=9222',
    `--user-data-dir=${USER_DATA_DIR}`,
    DSH_URL,
  ], { detached: true, stdio: 'ignore' });
  chromeProc.unref();

  await sleep(2000);
  const chromeRealPid = findPidByPort(9222);
  const finalChromePid = chromeRealPid || chromeProc.pid;
  if (chromeRealPid) {
    log(`Chrome 实际 PID: ${chromeRealPid} (通过端口 9222 查找)`);
  } else {
    log(`Chrome spawn PID: ${chromeProc.pid}`);
  }
  writeFileSync(CHROME_PID_FILE, String(finalChromePid));

  log('环境启动完成！');
  log(`MCP 可通过 ${CHROME_DEBUG_URL} 连接 Chrome`);
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
