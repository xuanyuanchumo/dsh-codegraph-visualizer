import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const DSH_URL = 'http://127.0.0.1:3080/';
const SCREENSHOT_DIR = join(process.cwd(), 'docs', 'anchor', 'cycles', '.cycles', 'cycle-19', 'screenshots');

mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function main() {
  const browser = await chromium.launch({
    headless: false,
    executablePath: undefined,
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  console.log('[1] Navigating to DSH web UI...');
  await page.goto(DSH_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Take initial screenshot
  await page.screenshot({ path: join(SCREENSHOT_DIR, '01-initial.png'), fullPage: false });
  console.log('[1] Screenshot saved: 01-initial.png');

  // Get page title and URL
  const title = await page.title();
  const url = page.url();
  console.log(`[1] Page title: "${title}", URL: ${url}`);

  // Get all visible text content for analysis
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('[1] Page text content (first 2000 chars):\n', bodyText.substring(0, 2000));

  // Check for API config dialog/modal
  console.log('\n[2] Looking for API config dialog...');
  const dialogButtons = await page.evaluate(() => {
    const allElements = Array.from(document.querySelectorAll('button, [role="button"], .btn, [class*="button"]'));
    return allElements.map(el => ({
      text: el.textContent?.trim().substring(0, 50),
      className: el.className?.substring(0, 100),
      id: el.id,
      visible: el.offsetParent !== null,
    })).filter(el => el.visible);
  });
  console.log('[2] All visible buttons:', JSON.stringify(dialogButtons, null, 2));

  // Look for "稍后配置" or "later" or "skip" or "configure" buttons
  const skipButtons = await page.evaluate(() => {
    const allElements = Array.from(document.querySelectorAll('button, [role="button"], a'));
    return allElements.filter(el => {
      const text = el.textContent?.trim().toLowerCase() || '';
      return text.includes('稍后') || text.includes('later') || text.includes('skip') || 
             text.includes('配置') || text.includes('config') || text.includes('close') ||
             text.includes('关闭') || text.includes('取消') || text.includes('cancel') ||
             text.includes('x') && el.textContent?.trim().length < 5;
    }).map(el => ({
      text: el.textContent?.trim().substring(0, 50),
      tag: el.tagName,
      className: el.className?.substring(0, 100),
      id: el.id,
    }));
  });
  console.log('[2] Skip/config buttons found:', JSON.stringify(skipButtons, null, 2));

  // Take screenshot of dialog state
  await page.screenshot({ path: join(SCREENSHOT_DIR, '02-dialog.png'), fullPage: false });
  console.log('[2] Screenshot saved: 02-dialog.png');

  // Try to find and click "稍后配置" button
  const laterBtn = await page.evaluate(() => {
    const allElements = Array.from(document.querySelectorAll('button, [role="button"], a, span'));
    for (const el of allElements) {
      const text = el.textContent?.trim() || '';
      if (text === '稍后配置' || text === '稍后' || text.includes('稍后配置')) {
        el.click();
        return { found: true, text, tag: el.tagName };
      }
    }
    // Also try clicking any close/dismiss button on a modal
    const closeBtns = Array.from(document.querySelectorAll('[class*="close"], [class*="dismiss"], [aria-label*="close"], [aria-label*="Close"]'));
    for (const btn of closeBtns) {
      if (btn.offsetParent !== null) {
        btn.click();
        return { found: true, text: 'close button', tag: btn.tagName, className: btn.className };
      }
    }
    return { found: false };
  });
  console.log('[2] Click result:', JSON.stringify(laterBtn));

  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '03-after-dialog.png'), fullPage: false });
  console.log('[3] Screenshot saved: 03-after-dialog.png');

  // Get updated page content
  const bodyText2 = await page.evaluate(() => document.body.innerText);
  console.log('[3] Page text after dialog (first 2000 chars):\n', bodyText2.substring(0, 2000));

  // Look for codegraph visualizer plugin entry
  console.log('\n[4] Looking for codegraph visualizer plugin entry...');
  const pluginEntries = await page.evaluate(() => {
    const allElements = Array.from(document.querySelectorAll('*'));
    const results = [];
    for (const el of allElements) {
      const text = el.textContent?.trim() || '';
      const className = el.className?.toString() || '';
      const id = el.id || '';
      if (text.toLowerCase().includes('codegraph') || 
          text.toLowerCase().includes('code graph') ||
          text.toLowerCase().includes('graph') ||
          className.toLowerCase().includes('codegraph') ||
          className.toLowerCase().includes('graph') ||
          id.toLowerCase().includes('codegraph') ||
          id.toLowerCase().includes('graph')) {
        if (el.offsetParent !== null && text.length < 200) {
          results.push({
            tag: el.tagName,
            text: text.substring(0, 100),
            className: className.substring(0, 100),
            id,
          });
        }
      }
    }
    return results.slice(0, 30);
  });
  console.log('[4] Plugin entries found:', JSON.stringify(pluginEntries, null, 2));

  // Look for sidebar items / tool buttons / panel tabs
  const sidebarItems = await page.evaluate(() => {
    const selectors = [
      '[class*="sidebar"]', '[class*="tool"]', '[class*="panel"]', 
      '[class*="tab"]', '[class*="icon"]', '[class*="menu"]',
      '[class*="nav"]', '[role="tab"]', '[role="menuitem"]',
      '[role="button"]', 'nav', 'aside'
    ];
    const results = [];
    for (const sel of selectors) {
      const els = Array.from(document.querySelectorAll(sel));
      for (const el of els) {
        if (el.offsetParent !== null) {
          const text = el.textContent?.trim().substring(0, 80) || '';
          const className = el.className?.toString().substring(0, 80) || '';
          if (text || className) {
            results.push({ selector: sel, tag: el.tagName, text, className });
          }
        }
      }
    }
    return results.slice(0, 40);
  });
  console.log('[4] Sidebar/tool items:', JSON.stringify(sidebarItems, null, 2));

  // Take screenshot of main UI
  await page.screenshot({ path: join(SCREENSHOT_DIR, '04-main-ui.png'), fullPage: true });
  console.log('[4] Screenshot saved: 04-main-ui.png');

  // Get full page structure (all elements with classes)
  const pageStructure = await page.evaluate(() => {
    const body = document.body;
    const structure = [];
    function walk(node, depth) {
      if (depth > 4) return;
      if (node.nodeType === 1) {
        const el = node;
        const text = el.textContent?.trim().substring(0, 50) || '';
        const className = el.className?.toString().substring(0, 80) || '';
        const id = el.id || '';
        const visible = el.offsetParent !== null || el === document.body;
        if (visible && (className || id || text)) {
          structure.push({
            depth,
            tag: el.tagName,
            id,
            className,
            text: text.substring(0, 30),
          });
        }
      }
      for (const child of node.childNodes) {
        walk(child, depth + 1);
      }
    }
    walk(body, 0);
    return structure.slice(0, 100);
  });
  console.log('[4] Page structure (first 100 elements):', JSON.stringify(pageStructure, null, 2));

  // Try clicking on any graph-related element
  console.log('\n[5] Attempting to interact with codegraph plugin...');
  
  // First, let's check if there's an icon or button that opens the graph panel
  const graphTrigger = await page.evaluate(() => {
    // Look for SVG icons, buttons with graph-related attributes
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], svg, [class*="icon"]'));
    for (const el of candidates) {
      const className = el.className?.toString().toLowerCase() || '';
      const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
      const title = el.getAttribute('title')?.toLowerCase() || '';
      const dataTestId = el.getAttribute('data-testid')?.toLowerCase() || '';
      if (className.includes('graph') || ariaLabel.includes('graph') || 
          title.includes('graph') || dataTestId.includes('graph') ||
          className.includes('codegraph') || ariaLabel.includes('codegraph')) {
        return { found: true, tag: el.tagName, className, ariaLabel, title, dataTestId };
      }
    }
    return { found: false };
  });
  console.log('[5] Graph trigger:', JSON.stringify(graphTrigger));

  // Let's also look for the better-sidebar plugin elements
  const sidebarElements = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('[class*="sidebar"], [class*="better-sidebar"]'));
    return candidates.filter(el => el.offsetParent !== null).map(el => ({
      tag: el.tagName,
      className: el.className?.toString().substring(0, 100),
      text: el.textContent?.trim().substring(0, 80),
      childCount: el.children.length,
    }));
  });
  console.log('[5] Sidebar elements:', JSON.stringify(sidebarElements, null, 2));

  // Get all console messages
  const consoleMessages = [];
  page.on('console', msg => consoleMessages.push({ type: msg.type(), text: msg.text() }));
  
  await page.waitForTimeout(2000);
  console.log('[5] Console messages:', JSON.stringify(consoleMessages.slice(0, 20), null, 2));

  // Final full page screenshot
  await page.screenshot({ path: join(SCREENSHOT_DIR, '05-final.png'), fullPage: true });
  console.log('[5] Final screenshot saved');

  // Get the full HTML structure for analysis
  const htmlStructure = await page.evaluate(() => {
    return document.documentElement.outerHTML.substring(0, 5000);
  });
  console.log('\n[6] HTML structure (first 5000 chars):\n', htmlStructure);

  await browser.close();
  console.log('\n[DONE] Browser closed. All screenshots saved to:', SCREENSHOT_DIR);
}

main().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});