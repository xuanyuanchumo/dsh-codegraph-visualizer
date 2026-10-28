/**
 * Playwright globalSetup：跑任何 spec 之前，再确认一次「3080 上确实是本仓库的 dev-server」。
 *
 * 判定逻辑与文案在 `tests/e2e/port-identity.ts`（config 阶段也用同一份，避免两处漂移）。
 * 为什么需要第二道：config 阶段到 webServer 就绪之间仍有一次竞态——真机宿主可能在
 * 这期间抢到/释放端口。实测过：一次回归跑到一半，3080 的 owner 从 dev-server 换成了
 * `DeepSeek Harness.exe`，chaos 的 8 条用例全部 `net::ERR_CONNECTION_RESET`。
 */
import {
  allowForeignServer,
  foreignServerMessage,
  probePortIdentity,
  unreachableMessage,
} from './port-identity.mjs';

const BASE_URL = process.env.PW_BASE_URL ?? 'http://localhost:3080';

export default async function globalSetup(): Promise<void> {
  const id = await probePortIdentity(BASE_URL);
  if (id.kind === 'dev-server') return;

  if (id.kind === 'unreachable') {
    if (allowForeignServer()) {
      console.warn(unreachableMessage(BASE_URL, id));
      return;
    }
    throw new Error(unreachableMessage(BASE_URL, id));
  }

  const msg = foreignServerMessage(BASE_URL, id);
  if (allowForeignServer()) {
    console.warn(msg);
    return;
  }
  throw new Error(msg);
}
