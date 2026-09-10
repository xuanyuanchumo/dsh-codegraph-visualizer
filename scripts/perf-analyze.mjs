import http from 'http';

function cdpEval(expression) {
  return new Promise((resolve) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const targets = JSON.parse(data);
        const page = targets.find(t => t.type === 'page');
        if (!page) { resolve({ error: 'No page' }); return; }
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        ws.addEventListener('open', () => {
          ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
        });
        ws.addEventListener('message', (event) => {
          const resp = JSON.parse(event.data);
          if (resp.id === 1) {
            const value = resp.result && resp.result.result && resp.result.result.value;
            resolve(value ? JSON.parse(value) : { error: 'No value', result: resp.result });
            ws.close();
          }
        });
        ws.addEventListener('error', (e) => resolve({ error: String(e) }));
      });
    });
  });
}

const perfResult = await cdpEval(`(() => {
  const results = {};
  const statusText = document.querySelector('.status-bar')?.textContent || '';
  results.statusText = statusText.substring(0, 200);
  results.domNodeCount = document.querySelectorAll('*').length;
  const panel = document.querySelector('.graph-panel');
  const rect = panel.getBoundingClientRect();
  results.panelRect = { w: rect.width, h: rect.height };
  if (performance.memory) {
    results.memoryUsedMB = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
    results.memoryTotalMB = Math.round(performance.memory.totalJSHeapSize / 1024 / 1024);
  }
  let transitionCount = 0;
  let animationCount = 0;
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    const style = getComputedStyle(el);
    if (style.transitionProperty && style.transitionProperty !== 'none') transitionCount++;
    if (style.animationName && style.animationName !== 'none') animationCount++;
  }
  results.transitionCount = transitionCount;
  results.animationCount = animationCount;
  results.totalDomElements = allElements.length;
  const canvas = document.querySelector('canvas');
  results.canvasWidth = canvas ? canvas.width : 0;
  results.canvasHeight = canvas ? canvas.height : 0;
  return JSON.stringify(results);
})()`);
console.log(JSON.stringify(perfResult, null, 2));
