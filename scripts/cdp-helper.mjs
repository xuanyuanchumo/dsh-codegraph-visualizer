import puppeteer from 'puppeteer-core';

const CDP_URL = 'http://127.0.0.1:9222';
const SCREENSHOT_DIR = 'screenshots';

async function main() {
  const browser = await puppeteer.connect({
    browserURL: CDP_URL,
    defaultViewport: null
  });

  const pages = await browser.pages();
  let page = pages.find(p => p.url().includes('127.0.0.1:3080'));
  
  if (!page) {
    console.error('DSH page not found');
    await browser.disconnect();
    process.exit(1);
  }

  const cmd = process.argv[2] || 'snapshot';

  try {
    if (cmd === 'click') {
      const selector = process.argv[3];
      await page.waitForSelector(selector, { timeout: 5000 });
      await page.click(selector);
      console.log(`Clicked: ${selector}`);
    } else if (cmd === 'clickByText') {
      const text = process.argv[3];
      const handle = await page.evaluateHandle((t) => {
        const elements = [...document.querySelectorAll('button, a, [role="button"]')];
        const found = elements.find(el => el.textContent && el.textContent.trim().includes(t));
        return found || null;
      }, text);
      const element = handle.asElement();
      if (element) {
        await element.click();
        console.log(`Clicked element with text: ${text}`);
      } else {
        console.log(`Element not found with text: ${text}`);
      }
    } else if (cmd === 'eval') {
      const expr = process.argv[3];
      const result = await page.evaluate(expr);
      console.log(JSON.stringify(result, null, 2));
    } else if (cmd === 'screenshot') {
      const filename = process.argv[3] || `screenshot-${Date.now()}.png`;
      const fullPage = process.argv[4] === 'full';
      await page.screenshot({ path: `${SCREENSHOT_DIR}/${filename}`, fullPage });
      console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${filename}`);
    } else if (cmd === 'snapshot') {
      const result = await page.evaluate(() => {
        function describe(el, depth = 0) {
          if (depth > 5) return '';
          let result = '';
          const tag = el.tagName ? el.tagName.toLowerCase() : '#text';
          const text = el.textContent ? el.textContent.trim().substring(0, 60) : '';
          const cls = el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).join('.') : '';
          const id = el.id ? '#' + el.id : '';
          const role = el.getAttribute ? el.getAttribute('role') : '';
          const ariaLabel = el.getAttribute ? el.getAttribute('aria-label') : '';
          const visible = el.offsetParent !== null;
          if (visible || depth < 2) {
            const info = [tag, id, cls, role ? `[role=${role}]` : '', ariaLabel ? `[aria-label="${ariaLabel}"]` : '', text ? `="${text}"` : ''].filter(Boolean).join('');
            result += '  '.repeat(depth) + info + '\n';
            if (el.children) {
              for (const child of el.children) {
                result += describe(child, depth + 1);
              }
            }
          }
          return result;
        }
        return describe(document.body);
      });
      console.log(result);
    } else if (cmd === 'press') {
      const key = process.argv[3];
      await page.keyboard.press(key);
      console.log(`Pressed: ${key}`);
    } else if (cmd === 'type') {
      const text = process.argv[3];
      await page.keyboard.type(text);
      console.log(`Typed: ${text}`);
    } else if (cmd === 'fill') {
      const selector = process.argv[3];
      const value = process.argv[4];
      await page.waitForSelector(selector, { timeout: 5000 });
      await page.type(selector, value);
      console.log(`Filled ${selector} with ${value}`);
    } else if (cmd === 'wait') {
      const ms = parseInt(process.argv[3] || '1000');
      await new Promise(r => setTimeout(r, ms));
      console.log(`Waited ${ms}ms`);
    } else if (cmd === 'url') {
      console.log(await page.url());
    } else if (cmd === 'console') {
      const messages = await page.evaluate(() => {
        return window.__consoleMessages || [];
      });
      console.log(JSON.stringify(messages, null, 2));
    } else if (cmd === 'hover') {
      const selector = process.argv[3];
      await page.waitForSelector(selector, { timeout: 5000 });
      await page.hover(selector);
      console.log(`Hovered: ${selector}`);
    } else {
      console.log(`Unknown command: ${cmd}`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
  } finally {
    await browser.disconnect();
  }
}

main().catch(console.error);