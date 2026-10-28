/**
 * 端口身份判定（E2E 门禁的前置条件）——**单一事实源**。
 *
 * 三个消费者，全部 import 本文件，禁止各自抄一份标记字符串：
 *   1. `playwright.config.ts`      —— 配置加载阶段（`webServer` 启动之前）
 *   2. `tests/e2e/global-setup.ts` —— 跑任何 spec 之前（第二道，防两阶段之间的抢占）
 *   3. `tests/e2e/preflight-dev-server.mjs` —— webServer command 的第一段（Playwright 决定
 *      要自己起 dev-server 时执行；此时正是「端口被别的东西占着」的那个分支）
 *
 * ── 为什么需要它（cycle-110 实测，不是推测）─────────────────────────────────
 * `webServer.reuseExistingServer: true` + 固定 `baseURL: http://localhost:3080` 意味着
 * **本机 3080 上的任何东西都会被当成被测站点**。实测到的占用者不是残留 dev-server，
 * 而是真机验证用的桌面端 DSH 宿主（进程名 `DeepSeek Harness.exe`，
 * 由 `node scripts/start-dsh-test.mjs start` 拉起）。实测的两种假象：
 *
 *  · 宿主返回 **401**（`dsh web authentication required; reopen the URL printed by dsh web.`）
 *    ⇒ Playwright 的可用性判定只认 2xx ⇒ 它仍去 spawn dev-server ⇒ dev-server 打不开端口
 *    却**不会退出**（它把 banner 打完就挂着）⇒ 最终以「webServer 180s 超时」收场，
 *    看起来像环境慢。
 *  · 宿主返回 **200**（带 token 的页面被复用）⇒ Playwright 直接复用 ⇒ 20 个 spec 全落到宿主页面上
 *    ⇒ 以 `TimeoutError: locator('.cg-graph-panel')` 收场，与 docs/测试体系.md §2.7 记载的
 *    「超时是症状不是诊断」形态完全一致。
 *
 * 两种情形下**失败都不是产品缺陷；而「通过」同样不能作为回归证据**。
 * 所以判定必须发生在跑 spec 之前，且靠页面特征，不靠端口号、标题或进程名。
 *
 * ── 判据（字符串来自 `scripts/dev-server.mjs` 的真实产物）────────────────────
 * dev-server 的页面必然同时包含下面两条标记；真机宿主页面必然包含 `authentication required`。
 */

/** dev-server 页面必须同时出现的标记（缺一即判为「不是 dev-server」） */
export const DEV_SERVER_MARKERS = [
  "localStorage.setItem('__cg_debug', '1')", // dev-server 注入的调试句柄开关
  '/dist/client/index.esm.js', // 页面加载的构建产物入口
];

/** 真机宿主（dsh web / 桌面端）的认证拦截页特征 */
export const HOST_AUTH_MARKERS = ['authentication required'];

/**
 * 探测一次站点身份。
 * @param {string} baseUrl
 * @returns {Promise<{kind:'dev-server'} | {kind:'unreachable', detail:string} | {kind:'foreign', status:number, detail:string, looksHostAuth:boolean}>}
 */
export async function probePortIdentity(baseUrl) {
  let res;
  try {
    res = await fetch(baseUrl, { signal: AbortSignal.timeout(3000), redirect: 'manual' });
  } catch (err) {
    return { kind: 'unreachable', detail: err instanceof Error ? err.message : String(err) };
  }
  let body = '';
  try {
    body = await res.text();
  } catch {
    /* 读不出 body 时按状态码与特征缺失处理 */
  }
  if (DEV_SERVER_MARKERS.every((m) => body.includes(m))) return { kind: 'dev-server' };
  const looksHostAuth = HOST_AUTH_MARKERS.some((m) => body.includes(m));
  const detail = looksHostAuth
    ? '页面是真机宿主的「authentication required」拦截页（`dsh web` / 桌面端），不是 dev-server'
    : `页面缺少 dev-server 特征（应含 ${DEV_SERVER_MARKERS.map((m) => `\`${m}\``).join(' 与 ')}）`;
  return { kind: 'foreign', status: res.status, detail, looksHostAuth };
}

/**
 * 统一的处置文案（三个消费者共用，避免措辞漂移）。
 * @param {string} baseUrl
 * @param {{status:number, detail:string}} id
 * @returns {string}
 */
export function foreignServerMessage(baseUrl, id) {
  return [
    '',
    '════════════════════════════════════════════════════════════════════',
    `[e2e] 端口身份校验失败：${baseUrl} 上跑的不是本仓库的 dev-server`,
    '',
    `  · 原因：${id.detail}`,
    `  · HTTP：${id.status}`,
    '',
    '  本轮所有 spec 的失败**都不是产品缺陷**，而是在错误的站点上执行；',
    '  反之，一个「通过」的结果同样不能作为回归证据。',
    '',
    '  常见占用者：真机验证用的桌面端 DSH 宿主（进程名 `DeepSeek Harness.exe`）。',
    '',
    '  处理办法（按优先级）：',
    '    1) 结束真机会话释放端口：`node scripts/start-dsh-test.mjs stop`',
    '    2) `netstat -ano | findstr :3080` 找到 PID，确认不是自己的进程后再停',
    '    3) 重新执行：`pnpm run test:e2e --project=regression`',
    '',
    '  仅在明确知道风险时跳过本守卫：PW_ALLOW_FOREIGN_SERVER=1（结果不得作为回归证据）。',
    '════════════════════════════════════════════════════════════════════',
    '',
  ].join('\n');
}

/**
 * @param {string} baseUrl
 * @param {{detail:string}} id
 * @returns {string}
 */
export function unreachableMessage(baseUrl, id) {
  return [
    '',
    '════════════════════════════════════════════════════════════════════',
    `[e2e] ${baseUrl} 无响应：${id.detail}`,
    '',
    '  配置阶段出现这种情况是**正常**的——那正是 webServer 要启动 dev-server 的场景；',
    '  但 webServer 就绪之后仍无响应，说明 `pnpm run dev` 没起来，请先看它的输出。',
    '════════════════════════════════════════════════════════════════════',
    '',
  ].join('\n');
}

export const allowForeignServer = () => process.env.PW_ALLOW_FOREIGN_SERVER === '1';
