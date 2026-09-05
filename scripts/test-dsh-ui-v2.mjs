import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const DSH_URL = 'http://127.0.0.1:3080/';
const SCREENSHOT_DIR = join(process.cwd(), 'docs', 'anchor', 'cycles', '.cycles', 'cycle-19', 'screenshots');

mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  // Collect console messages
  const consoleMessages = [];
  page.on('console', msg => consoleMessages.push({ type: msg.type(), text: msg.text() }));

  console.log('[1] Navigating to DSH web UI...');
  await page.goto(DSH_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Step 1: Click "稍后配置" to dismiss API config dialog
  console.log('[2] Dismissing API config dialog...');
  const laterBtn = page.locator('button:has-text("稍后配置")');
  if (await laterBtn.count() > 0) {
    await laterBtn.click();
    console.log('[2] Clicked "稍后配置" button');
  } else {
    console.log('[2] No "稍后配置" button found, continuing...');
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '01-after-dialog.png') });

  // Step 2: Click "Code Graph" panel card in bottom panel
  console.log('[3] Looking for "Code Graph" panel card...');
  const codeGraphBtn = page.locator('button:has-text("Code Graph")');
  if (await codeGraphBtn.count() > 0) {
    console.log('[3] Found Code Graph button, clicking...');
    await codeGraphBtn.first().click();
    await page.waitForTimeout(3000);
    console.log('[3] Clicked Code Graph button');
  } else {
    console.log('[3] Code Graph button not found. Searching for alternatives...');
    // Try to find it by class
    const altBtn = page.locator('[class*="paneCard"]:has-text("Code Graph")');
    if (await altBtn.count() > 0) {
      await altBtn.first().click();
      await page.waitForTimeout(3000);
      console.log('[3] Clicked Code Graph via paneCard class');
    } else {
      console.log('[3] Could not find Code Graph button');
    }
  }
  await page.screenshot({ path: join(SCREENSHOT_DIR, '02-codegraph-panel.png') });

  // Step 3: Analyze what appeared after clicking Code Graph
  console.log('[4] Analyzing Code Graph panel content...');
  const panelContent = await page.evaluate(() => {
    // Look for any new elements that appeared
    const allElements = Array.from(document.querySelectorAll('*'));
    const graphRelated = [];
    for (const el of allElements) {
      const className = el.className?.toString() || '';
      const id = el.id || '';
      const text = el.textContent?.trim().substring(0, 100) || '';
      const tagName = el.tagName;
      
      // Check for codegraph-related elements
      if (className.toLowerCase().includes('graph') || 
          id.toLowerCase().includes('graph') ||
          className.toLowerCase().includes('codegraph') ||
          id.toLowerCase().includes('codegraph') ||
          className.toLowerCase().includes('cytoscape') ||
          className.toLowerCase().includes('panel') && text.toLowerCase().includes('graph')) {
        if (el.offsetParent !== null) {
          graphRelated.push({
            tag: tagName,
            id,
            className: className.substring(0, 150),
            text: text.substring(0, 80),
            rect: el.getBoundingClientRect ? {
              x: Math.round(el.getBoundingClientRect().x),
              y: Math.round(el.getBoundingClientRect().y),
              w: Math.round(el.getBoundingClientRect().width),
              h: Math.round(el.getBoundingClientRect().height),
            } : null,
          });
        }
      }
    }
    return graphRelated.slice(0, 30);
  });
  console.log('[4] Graph-related elements:', JSON.stringify(panelContent, null, 2));

  // Step 4: Get the full page text to see what's visible now
  const fullText = await page.evaluate(() => document.body.innerText);
  console.log('[4] Full page text (first 3000 chars):\n', fullText.substring(0, 3000));

  // Step 5: Check for the bottom panel - it might need to be expanded
  console.log('[5] Checking bottom panel state...');
  const bottomPanel = await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll('[class*="bottomPanel"]'));
    return panels.map(el => ({
      className: el.className?.toString(),
      visible: el.offsetParent !== null,
      rect: {
        x: Math.round(el.getBoundingClientRect().x),
        y: Math.round(el.getBoundingClientRect().y),
        w: Math.round(el.getBoundingClientRect().width),
        h: Math.round(el.getBoundingClientRect().height),
      },
      childCount: el.children.length,
      text: el.textContent?.trim().substring(0, 200),
    }));
  });
  console.log('[5] Bottom panels:', JSON.stringify(bottomPanel, null, 2));

  // Step 6: Try to expand the bottom panel if it's hidden
  console.log('[6] Trying to expand bottom panel...');
  const expandResult = await page.evaluate(() => {
    // Look for toggle buttons that might expand the bottom panel
    const toggleButtons = Array.from(document.querySelectorAll('[class*="toggleButton"], [class*="bottomClose"]'));
    const visibleButtons = toggleButtons.filter(el => el.offsetParent !== null);
    if (visibleButtons.length > 0) {
      // Click the first visible toggle button
      visibleButtons[0].click();
      return { clicked: true, className: visibleButtons[0].className };
    }
    return { clicked: false };
  });
  console.log('[6] Expand result:', JSON.stringify(expandResult));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '03-after-toggle.png') });

  // Step 7: Now try clicking Code Graph again after expanding
  console.log('[7] Trying Code Graph button again...');
  const codeGraphBtn2 = page.locator('button:has-text("Code Graph")');
  if (await codeGraphBtn2.count() > 0) {
    await codeGraphBtn2.first().click();
    await page.waitForTimeout(3000);
    console.log('[7] Clicked Code Graph button');
  }
  await page.screenshot({ path: join(SCREENSHOT_DIR, '04-codegraph-opened.png') });

  // Step 8: Detailed analysis of what's visible now
  console.log('[8] Detailed analysis of Code Graph panel...');
  const detailedAnalysis = await page.evaluate(() => {
    const result = {
      // Check for Cytoscape canvas
      cytoscapeCanvas: null,
      // Check for graph panel container
      graphPanel: null,
      // Check for toolbar/buttons
      toolbarButtons: [],
      // Check for any SVG or canvas elements
      canvasElements: [],
      svgElements: [],
      // Check for loading indicators
      loadingIndicators: [],
      // Check for error messages
      errorMessages: [],
      // Get all visible text in the bottom panel area
      bottomPanelText: '',
    };

    // Look for canvas elements (Cytoscape uses canvas)
    const canvases = Array.from(document.querySelectorAll('canvas'));
    result.canvasElements = canvases.map(c => ({
      className: c.className?.toString(),
      width: c.width,
      height: c.height,
      rect: {
        x: Math.round(c.getBoundingClientRect().x),
        y: Math.round(c.getBoundingClientRect().y),
        w: Math.round(c.getBoundingClientRect().width),
        h: Math.round(c.getBoundingClientRect().height),
      },
    }));

    // Look for SVG elements
    const svgs = Array.from(document.querySelectorAll('svg'));
    result.svgElements = svgs.filter(s => s.offsetParent !== null).map(s => ({
      className: s.className?.toString()?.substring(0, 80),
      rect: {
        x: Math.round(s.getBoundingClientRect().x),
        y: Math.round(s.getBoundingClientRect().y),
        w: Math.round(s.getBoundingClientRect().width),
        h: Math.round(s.getBoundingClientRect().height),
      },
    })).slice(0, 10);

    // Look for graph panel container
    const graphPanels = Array.from(document.querySelectorAll('[class*="graph"], [id*="graph"]'));
    result.graphPanel = graphPanels.filter(el => el.offsetParent !== null).map(el => ({
      tag: el.tagName,
      className: el.className?.toString()?.substring(0, 100),
      id: el.id,
      rect: {
        x: Math.round(el.getBoundingClientRect().x),
        y: Math.round(el.getBoundingClientRect().y),
        w: Math.round(el.getBoundingClientRect().width),
        h: Math.round(el.getBoundingClientRect().height),
      },
      text: el.textContent?.trim().substring(0, 100),
    })).slice(0, 10);

    // Look for toolbar buttons in the graph area
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
    result.toolbarButtons = buttons.filter(el => {
      if (el.offsetParent === null) return false;
      const rect = el.getBoundingClientRect();
      // Only look at buttons in the bottom half of the screen (where the panel should be)
      return rect.y > 400;
    }).map(el => ({
      text: el.textContent?.trim().substring(0, 50),
      className: el.className?.toString()?.substring(0, 80),
      ariaLabel: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      rect: {
        x: Math.round(el.getBoundingClientRect().x),
        y: Math.round(el.getBoundingClientRect().y),
      },
    }));

    // Look for loading indicators
    const loaders = Array.from(document.querySelectorAll('[class*="loading"], [class*="spinner"], [class*="progress"]'));
    result.loadingIndicators = loaders.filter(el => el.offsetParent !== null).map(el => ({
      tag: el.tagName,
      className: el.className?.toString()?.substring(0, 80),
    }));

    // Look for error messages
    const errors = Array.from(document.querySelectorAll('[class*="error"], [class*="warning"], [class*="alert"]'));
    result.errorMessages = errors.filter(el => el.offsetParent !== null).map(el => ({
      tag: el.tagName,
      className: el.className?.toString()?.substring(0, 80),
      text: el.textContent?.trim().substring(0, 100),
    }));

    // Get bottom panel text
    const bottomPanels = Array.from(document.querySelectorAll('[class*="bottomPanel"]'));
    if (bottomPanels.length > 0) {
      result.bottomPanelText = bottomPanels[0].textContent?.trim().substring(0, 500);
    }

    return result;
  });
  console.log('[8] Detailed analysis:', JSON.stringify(detailedAnalysis, null, 2));

  // Step 9: Take a full page screenshot
  await page.screenshot({ path: join(SCREENSHOT_DIR, '05-full-page.png'), fullPage: true });
  console.log('[9] Full page screenshot saved');

  // Step 10: Try to interact with the graph - look for zoom controls, layout selectors, etc.
  console.log('[10] Looking for graph interaction controls...');
  
  // Get all interactive elements in the bottom panel area
  const interactiveElements = await page.evaluate(() => {
    const allInteractive = Array.from(document.querySelectorAll('button, select, input, [role="button"], [role="combobox"], [role="slider"]'));
    return allInteractive.filter(el => {
      if (el.offsetParent === null) return false;
      const rect = el.getBoundingClientRect();
      return rect.y > 300; // Bottom panel area
    }).map(el => ({
      tag: el.tagName,
      type: el.getAttribute('type'),
      text: el.textContent?.trim().substring(0, 50),
      className: el.className?.toString()?.substring(0, 80),
      ariaLabel: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      placeholder: el.getAttribute('placeholder'),
      value: el.getAttribute('value'),
      rect: {
        x: Math.round(el.getBoundingClientRect().x),
        y: Math.round(el.getBoundingClientRect().y),
        w: Math.round(el.getBoundingClientRect().width),
        h: Math.round(el.getBoundingClientRect().height),
      },
    }));
  });
  console.log('[10] Interactive elements in bottom panel:', JSON.stringify(interactiveElements, null, 2));

  // Step 11: Check console messages for codegraph plugin
  console.log('[11] Console messages related to codegraph:');
  const codegraphMessages = consoleMessages.filter(m => 
    m.text.toLowerCase().includes('codegraph') || 
    m.text.toLowerCase().includes('graph') ||
    m.text.toLowerCase().includes('cytoscape') ||
    m.text.toLowerCase().includes('plugin')
  );
  console.log(JSON.stringify(codegraphMessages, null, 2));

  // Step 12: Try to find and click on the project workspace to trigger codegraph
  console.log('[12] Trying to select project and trigger codegraph...');
  
  // First, let's check if we need to select the dsh-codegraph-visualizer project
  const projectRow = page.locator('text=dsh-codegraph-visualizer').first();
  if (await projectRow.count() > 0) {
    console.log('[12] Found project row, clicking...');
    await projectRow.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '06-after-project-select.png') });
    
    // Check what changed
    const afterProjectSelect = await page.evaluate(() => document.body.innerText);
    console.log('[12] Text after project select (first 2000 chars):\n', afterProjectSelect.substring(0, 2000));
  }

  // Step 13: Try clicking Code Graph panel card again
  console.log('[13] Clicking Code Graph panel card after project selection...');
  const codeGraphBtn3 = page.locator('button:has-text("Code Graph")');
  if (await codeGraphBtn3.count() > 0) {
    await codeGraphBtn3.first().click();
    await page.waitForTimeout(5000);
    console.log('[13] Clicked Code Graph button');
  }
  await page.screenshot({ path: join(SCREENSHOT_DIR, '07-codegraph-after-project.png') });

  // Step 14: Final detailed analysis
  console.log('[14] Final analysis after all interactions...');
  const finalAnalysis = await page.evaluate(() => {
    return {
      canvasElements: Array.from(document.querySelectorAll('canvas')).map(c => ({
        className: c.className?.toString(),
        width: c.width,
        height: c.height,
        visible: c.offsetParent !== null,
      })),
      visibleText: document.body.innerText.substring(0, 3000),
      // Check for any iframe that might contain the graph
      iframes: Array.from(document.querySelectorAll('iframe')).map(f => ({
        src: f.src,
        className: f.className,
        visible: f.offsetParent !== null,
      })),
      // Check for shadow DOM hosts
      shadowHosts: Array.from(document.querySelectorAll('*')).filter(el => el.shadowRoot).map(el => ({
        tag: el.tagName,
        className: el.className?.toString()?.substring(0, 80),
      })),
    };
  });
  console.log('[14] Final analysis:', JSON.stringify(finalAnalysis, null, 2));

  // Step 15: Get all console messages
  console.log('[15] All console messages:');
  console.log(JSON.stringify(consoleMessages.slice(-30), null, 2));

  await page.screenshot({ path: join(SCREENSHOT_DIR, '08-final-state.png'), fullPage: true });

  await browser.close();
  console.log('\n[DONE] All tests complete. Screenshots saved to:', SCREENSHOT_DIR);
}

main().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});