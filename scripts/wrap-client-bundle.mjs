/**
 * Wrap the CJS client bundle in the DSH __ModuleLoader__.load signature.
 *
 * DSH web loads /plugins/<name>/client.js via a classic <script> tag and
 * expects:
 *
 *   window.__ModuleLoader__.load({
 *     id: "<package-name>",
 *     factory: (require) => {
 *       var module = { exports: {} };
 *       var exports = module.exports;
 *       // ...CJS bundle body...
 *       return module.exports;
 *     }
 *   });
 *
 * The factory's `require` parameter resolves platform externals (react,
 * react-dom, cordis, etc.) through the DSH module loader.
 *
 * CSS injection: DSH does not load plugin CSS files automatically. We inline
 * the CSS content into the JS bundle and inject it at runtime via a <style>
 * tag. This ensures styles are available regardless of the loading mechanism.
 *
 * Usage: node scripts/wrap-client-bundle.mjs <input.cjs> <output.js> <id>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [, , inputPath, outputPath, id] = process.argv;
if (!inputPath || !outputPath || !id) {
  console.error('Usage: node scripts/wrap-client-bundle.mjs <input.cjs> <output.js> <id>');
  process.exit(1);
}

let body = readFileSync(inputPath, 'utf8');

// Strip "use strict"; — the factory closure inherits strict mode from the
// outer ESM module scope.
body = body.replace(/^"use strict";\s*\n?/, '');

// Strip sourceMappingURL comment if present.
body = body.replace(/\/\/# sourceMappingURL=.*$/m, '');

// ── CSS injection ──────────────────────────────────────────────────────
// Read the CSS file produced by the CJS build and inline it into the JS
// bundle. At runtime, a <style> element is created and appended to <head>.
const cssPath0 = join(dirname(inputPath), 'index.css');
const cssPath1 = join(dirname(inputPath), '..', 'client', 'index.css');
let cssContent = '';
let cssSource = '';
if (existsSync(cssPath0)) {
  cssContent = readFileSync(cssPath0, 'utf8');
  cssSource = cssPath0;
} else if (existsSync(cssPath1)) {
  cssContent = readFileSync(cssPath1, 'utf8');
  cssSource = cssPath1;
}

// Escape backticks and ${} in CSS for safe embedding in a JS template literal.
function escapeForTemplateLiteral(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

let cssInjectCode = '';
if (cssContent) {
  const escapedCss = escapeForTemplateLiteral(cssContent);
  cssInjectCode = [
    '',
    '\t\t// ── Inject plugin CSS (inlined by wrap-client-bundle.mjs) ──',
    '\t\t(function() {',
    "\t\t\tvar styleId = 'dsh-codegraph-visualizer-styles';",
    '\t\t\tif (document.getElementById(styleId)) return;',
    '\t\t\tvar style = document.createElement("style");',
    '\t\t\tstyle.id = styleId;',
    '\t\t\tstyle.textContent = `' + escapedCss + '`;',
    '\t\t\tdocument.head.appendChild(style);',
    '\t\t})();',
    '',
  ].join('\n');
} else {
  console.warn('[wrap-client-bundle] WARNING: No CSS file found — plugin styles will not be loaded. Checked:', cssPath0, 'and', cssPath1);
}

const wrapped = [
  'window.__ModuleLoader__.load({',
  '\tid: ' + JSON.stringify(id) + ',',
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  cssInjectCode,
  body,
  '\t\treturn module.exports;',
  '\t}',
  '});',
  '',
].join('\n');

writeFileSync(outputPath, wrapped);
const cssInfo = cssContent ? `, CSS inlined from ${cssSource}` : ', no CSS found';
console.log(`[wrap-client-bundle] ${inputPath} -> ${outputPath} (${wrapped.length} bytes${cssInfo})`);
