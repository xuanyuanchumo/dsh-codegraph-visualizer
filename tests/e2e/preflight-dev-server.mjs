/**
 * webServer 的前置守卫（在 `pnpm run build:client && pnpm run dev` 之前执行）。
 *
 * 为什么必须有它：Playwright 只在「URL 不可用」时才会执行 `webServer.command`。
 * 当 3080 被真机宿主占着并返回 **401** 时，Playwright 认为「不可用」→ 于是来起我们自己的
 * dev-server → dev-server 打不开端口却**不退出**（打完 banner 就挂着）→ Playwright 一直轮询
 * 到 180s 超时，报「Timed out waiting for http://localhost:3080」，把「端口被别的进程占着」
 * 伪装成「环境慢」。
 *
 * 本脚本用同一份判据（`port-identity.mjs`）先看一眼：只要这个端口上答话的东西**不是**
 * dev-server，就以非零退出并把处置办法打出来。Playwright 会立刻报
 * `Process from config.webServer was not able to start. Exit code: 1` 并转发本脚本的输出。
 *
 * 端口上没有任何东西在答话时（CI 首次启动的正常情形）直接放行。
 */
import {
  DEV_SERVER_MARKERS,
  allowForeignServer,
  foreignServerMessage,
  probePortIdentity,
} from './port-identity.mjs';

const BASE_URL = process.env.PW_BASE_URL ?? 'http://localhost:3080';

const id = await probePortIdentity(BASE_URL);

if (id.kind === 'dev-server') {
  // 端口上已经是我们的 dev-server（例如手动起好的），放行；后续 `pnpm run dev` 会自行失败退出，
  // 但那是 Playwright 的 reuseExistingServer 判定范围，不属于本脚本职责。
  process.exit(0);
}

if (id.kind === 'unreachable') {
  process.exit(0); // 端口空闲：正常启动路径
}

const msg = foreignServerMessage(BASE_URL, id);
if (allowForeignServer()) {
  console.warn(msg);
  process.exit(0);
}
console.error(msg);
console.error(`[e2e] dev-server 特征（必须同时出现）：${DEV_SERVER_MARKERS.join(' , ')}`);
process.exit(1);
