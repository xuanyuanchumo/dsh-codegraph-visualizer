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
 * Usage: node scripts/wrap-client-bundle.mjs <input.cjs> <output.js> <id>
 */
import { readFileSync, writeFileSync } from 'node:fs';

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

const wrapped = `window.__ModuleLoader__.load({
	id: ${JSON.stringify(id)},
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
${body}
		return module.exports;
	}
});
`;

writeFileSync(outputPath, wrapped);
console.log(`[wrap-client-bundle] ${inputPath} -> ${outputPath} (${wrapped.length} bytes)`);