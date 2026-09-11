import { spawn } from 'child_process';
import http from 'http';

const child = spawn('dsh', ['web', '--port', '3080', '--no-open'], {
  stdio: 'pipe',
  shell: true,
  env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }
});

child.stdout.on('data', (d) => process.stdout.write(`[dsh] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[dsh-err] ${d}`));

function checkReady(attempt = 0) {
  if (attempt > 30) {
    console.log('DSH failed to start in 60s');
    process.exit(1);
  }
  http.get('http://localhost:3080', (r) => {
    console.log(`DSH ready! Status: ${r.statusCode}`);
    // Keep process alive
    setInterval(() => {}, 1000);
  }).on('error', () => {
    setTimeout(() => checkReady(attempt + 1), 2000);
  });
}

setTimeout(() => checkReady(), 3000);