// 发布包装脚本 v6：不依赖 shell/.cmd 解析（detached+ignore 下 npm.cmd 会静默失败），
// 直接用 process.execPath 拉起 npm-cli.js；令牌仍只经环境变量写入临时 .npmrc。
// cycle-104「npm 发布包装脚本（cwd 修正 + Windows shell 形态）」的演进版。
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = process.env.NPM_TOKEN;
const marker = path.join(projectRoot, '.publish-result.log');
const npmrcPath = path.join(projectRoot, '.npmrc');
const npmCli = process.env.NPM_CLI_JS || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
try {
  writeFileSync(marker, 'STARTED v6 npmCli=' + npmCli + '\n');
  writeFileSync(npmrcPath, '//registry.npmjs.org/:_authToken=' + token + '\n');
  const child = spawn(process.execPath, [npmCli, 'publish', '--access', 'public', '--ignore-scripts', '--registry=https://registry.npmjs.org', '--userconfig=' + npmrcPath], {
    cwd: projectRoot,
    env: { ...process.env, NPM_CONFIG_USERCONFIG: npmrcPath },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  child.on('error', (e) => { try { writeFileSync(marker, 'SPAWN_ERROR:' + e.message + '\n', { flag: 'a' }); } catch { /* 忽略 */ } });
  child.on('exit', (code) => { try { writeFileSync(marker, 'EXIT:' + code + '\n', { flag: 'a' }); } catch { /* 忽略 */ } });
  console.log('PUBLISH_STARTED pid=' + child.pid + ' npmCli=' + npmCli);
} catch (err) {
  console.error('WRAPPER_ERROR: ' + (err instanceof Error ? err.message : String(err)));
  try { writeFileSync(marker, 'WRAPPER_ERROR\n'); } catch { /* 忽略 */ }
}
process.exit(0);
