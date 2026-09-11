import { exec } from 'child_process';
import fs from 'fs';
import http from 'http';

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const dir = 'C:\\temp\\chrome-test';
fs.mkdirSync(dir, { recursive: true });

const child = exec(`"${chrome}" --remote-debugging-port=9222 --user-data-dir="${dir}" --no-first-run --no-default-browser-check http://localhost:3080`, { timeout: 30000 });

child.on('error', (e) => console.log('exec error:', e.message));

setTimeout(() => {
  http.get('http://127.0.0.1:9222/json/version', (r) => {
    let d = '';
    r.on('data', (c) => d += c);
    r.on('end', () => {
      console.log('Chrome debug ready!');
      console.log(d.substring(0, 300));
      process.exit(0);
    });
  }).on('error', (e) => {
    console.log('Chrome debug not ready:', e.message);
    process.exit(1);
  });
}, 10000);
