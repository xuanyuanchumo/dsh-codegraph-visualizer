// 探针：直接向真实 DSH 宿主的 /diff 发请求，验证 P0-C/D/E 三个修复。
// 用 JSON 文件承载参数，避免 shell 转义把 Windows 反斜杠吃掉。
import { readFileSync } from 'node:fs';

const base = 'http://127.0.0.1:3080/api/v1/codegraph';
const workspace = 'D:\\Projects\\TraeProjects\\dsh-codegraph-visualizer';

async function diff(label, payload) {
  const res = await fetch(`${base}/diff`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => null);
  console.log(`\n=== ${label} ===`);
  console.log('http', res.status);
  if (!json) return;
  if (json.success === false) {
    console.log('error', json.error, '|', json.message);
    return;
  }
  console.log('repoId', JSON.stringify(json.metadata?.repoId));
  console.log('nodes', (json.nodes ?? []).length, 'edges', (json.edges ?? []).length);
  console.log('granularity', json.granularity, 'truncated', json.truncated, 'from', json.from, 'to', json.to);
  console.log('sample', JSON.stringify((json.nodes ?? []).slice(0, 4).map((n) => ({ id: n.id, status: n.properties?.diffStatus }))));
}

await diff('P0-C: 相对引用 HEAD~1..HEAD', { workspace, from: 'HEAD~1', to: 'HEAD' });
await diff('P0-C: HEAD^ 引用', { workspace, from: 'HEAD^', to: 'HEAD' });
await diff('P0-D: 两个真实 SHA（应给出文件级节点）', {
  workspace,
  from: 'dc18a17d4155a25d4f6290f989bc22028a25e799',
  to: '828de2098d39d6fc4f62c2c40ff7b8083c526a96',
});
await diff('P0-C 反例: 注入型引用应 400', { workspace, from: 'HEAD; rm -rf /', to: 'HEAD' });
await diff('P0-C 反例: 不存在引用应 500', { workspace, from: 'nosuchref123', to: 'HEAD' });
await diff('P0-E: 不带 workspace 时回落到宿主默认', { from: 'HEAD~1', to: 'HEAD' });
