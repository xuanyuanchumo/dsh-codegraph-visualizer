import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = 3080;

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

async function main() {
  // Kill any existing process on port 3080
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8', timeout: 5000 });
    const re = new RegExp(`TCP\\s+\\S+:${PORT}\\s+\\S+\\s+LISTENING\\s+(\\d+)`);
    for (const line of out.split('\n')) {
      const m = line.match(re);
      if (m) {
        execSync(`taskkill /PID ${m[1]} /F /T`, { stdio: 'ignore' });
        console.log(`Killed process on port ${PORT} (PID: ${m[1]})`);
      }
    }
  } catch { /* */ }

  await sleep(1000);

  // Start dev server
  console.log('Starting dev server...');
  const serverProc = spawn('node', ['scripts/dev-server.mjs'], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  serverProc.unref();
  console.log(`Dev server PID: ${serverProc.pid}`);

  // Wait for server to be ready
  console.log('Waiting for server to be ready...');
  const ready = await waitForUrl(`http://localhost:${PORT}`, 30000);
  if (!ready) {
    console.error('Dev server failed to start within 30s');
    process.exit(1);
  }
  console.log('Dev server is ready!');

  // Run Playwright tests
  console.log('Running Playwright tests...');
  const testProc = spawn('npx', ['playwright', 'test', '--config=playwright.test.config.ts', ...process.argv.slice(2)], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });

  testProc.on('close', (code) => {
    console.log(`Playwright tests exited with code ${code}`);
    // Kill dev server
    try { execSync(`taskkill /PID ${serverProc.pid} /F /T`, { stdio: 'ignore' }); } catch { /* */ }
    process.exit(code ?? 1);
  });
}

main().catch(err => { console.error(err); process.exit(1); });