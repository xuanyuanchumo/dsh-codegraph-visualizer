#!/usr/bin/env node
// setup-mocks.mjs - Setup mock modules for development
// This script creates symlinks or copies for private dependencies

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

console.log('[setup-mocks] Setting up development mocks...');

// Create node_modules if it doesn't exist
const nodeModules = path.join(projectRoot, 'node_modules');
if (!fs.existsSync(nodeModules)) {
  fs.mkdirSync(nodeModules, { recursive: true });
  console.log('[setup-mocks] Created node_modules directory');
}

// Create mock for @deepseek-cordis/plugin
const cordisPath = path.join(nodeModules, '@deepseek-cordis', 'plugin');
if (!fs.existsSync(cordisPath)) {
  fs.mkdirSync(cordisPath, { recursive: true });
  
  // Create index.js
  fs.writeFileSync(
    path.join(cordisPath, 'index.js'),
    `// Mock for @deepseek-cordis/plugin\nexport * from '${path.relative(cordisPath, path.join(projectRoot, 'src/__mocks__/cordis.ts'))}';\n`
  );
  
  // Create package.json
  fs.writeFileSync(
    path.join(cordisPath, 'package.json'),
    JSON.stringify({
      name: '@deepseek-cordis/plugin',
      version: '0.1.1-rc.2',
      main: 'index.js',
      module: 'index.js',
      types: 'index.d.ts',
      private: true
    }, null, 2)
  );
  
  console.log('[setup-mocks] Created mock for @deepseek-cordis/plugin');
} else {
  console.log('[setup-mocks] @deepseek-cordis/plugin mock already exists');
}

// Create mock for dsh-codegraph
const codegraphPath = path.join(nodeModules, 'dsh-codegraph');
if (!fs.existsSync(codegraphPath)) {
  fs.mkdirSync(codegraphPath, { recursive: true });
  
  fs.writeFileSync(
    path.join(codegraphPath, 'package.json'),
    JSON.stringify({
      name: 'dsh-codegraph',
      version: '0.1.1-rc.2',
      private: true,
      main: 'index.js',
      module: 'index.js'
    }, null, 2)
  );
  
  fs.writeFileSync(
    path.join(codegraphPath, 'index.js'),
    `// Mock for dsh-codegraph\nexport const codegraph_status = async () => ({ status: 'ready', nodeCount: 0, edgeCount: 0 });\nexport const codegraph_graph = async () => ({ nodes: [], edges: [] });\nexport const codegraph_symbol = async () => null;\n`
  );
  
  console.log('[setup-mocks] Created mock for dsh-codegraph');
} else {
  console.log('[setup-mocks] dsh-codegraph mock already exists');
}

// Create mock for dsh-tool-lens
const lensPath = path.join(nodeModules, 'dsh-tool-lens');
if (!fs.existsSync(lensPath)) {
  fs.mkdirSync(lensPath, { recursive: true });
  
  fs.writeFileSync(
    path.join(lensPath, 'package.json'),
    JSON.stringify({
      name: 'dsh-tool-lens',
      version: '0.1.1-rc.2',
      private: true,
      main: 'index.js',
      module: 'index.js'
    }, null, 2)
  );
  
  fs.writeFileSync(
    path.join(lensPath, 'index.js'),
    `// Mock for dsh-tool-lens\nexport const lens_analyze = async () => ({ symbols: [], references: [] });\nexport const lens_impact = async () => ({ affected: [], depth: 0 });\n`
  );
  
  console.log('[setup-mocks] Created mock for dsh-tool-lens');
} else {
  console.log('[setup-mocks] dsh-tool-lens mock already exists');
}

console.log('[setup-mocks] Done!');