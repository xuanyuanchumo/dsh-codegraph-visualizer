#!/usr/bin/env node
/**
 * 沙箱启动器（cycle-141 验证安装）
 *
 * 用法: node scripts/sandbox-launch.mjs <profile-name> <port>
 *
 * 解析 Electron 垫片形态的 dsh.cmd，直接用 exe + ELECTRON_RUN_AS_NODE=1 拉起
 * 指定 profile 的 dsh web 服务。捕获日志中的 token URL 并打印。
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

const DSH_CMD = 'D:/DSH/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd';
const profile = process.argv[2] || 'sb-codegraph-v110';
const port = process.argv[3] || '3085';

// 解析 Electron 垫片
let text;
try { text = readFileSync(DSH_CMD, 'utf8'); } catch (e) {
  console.error('Cannot read dsh.cmd:', e.message);
  process.exit(1);
}
if (!/ELECTRON_RUN_AS_NODE/.test(text)) {
  console.error('dsh.cmd is not an Electron shim');
  process.exit(1);
}
const tokens = [...text.matchAll(/"([^"]+)"/g)].map(m => m[1]);
const exeToken = tokens.find(t => /\.exe$/i.test(t));
const cliToken = tokens.find(t => /app\.asar/i.test(t) && /\.js$/i.test(t));
if (!exeToken || !cliToken) {
  console.error('Cannot parse exe/cli from dsh.cmd');
  process.exit(1);
}
const base = dirname(DSH_CMD);
const resolveRel = (t) => resolve(t.replace(/%~dp0/gi, `${base}\\`));
const exe = resolveRel(exeToken);
const cli = resolveRel(cliToken);

console.log(`[sandbox] exe: ${exe}`);
console.log(`[sandbox] cli: ${cli}`);
console.log(`[sandbox] profile: ${profile} port: ${port}`);

const cwd = join(homedir(), '.dsh', 'profiles', profile);
const proc = spawn(exe, [
  '--expose-internals', cli,
  'web',
  '--no-open',
  '--port', port,
], {
  cwd,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: false,
});

let out = '';
const collect = (chunk) => {
  out += chunk.toString();
  const lines = out.split('\n');
  for (const line of lines) {
    if (line.includes('token') || line.includes('http://') || line.includes('dsh web:') || line.includes('skipping') || line.includes('error') || line.includes('Error')) {
      console.log('[sandbox] ' + line.trim());
    }
  }
};
proc.stdout.on('data', collect);
proc.stderr.on('data', collect);

proc.on('exit', (code) => {
  console.log(`[sandbox] exited with code ${code}`);
});

process.on('SIGINT', () => { proc.kill(); process.exit(0); });
process.on('SIGTERM', () => { proc.kill(); process.exit(0); });
