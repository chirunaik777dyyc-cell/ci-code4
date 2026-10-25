'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'public', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
assert.ok(scripts.length >= 2, 'main page should include its JSON-LD and application scripts');
const appScript = scripts[scripts.length - 1];
new vm.Script(appScript, { filename: 'public/index.html:inline-app-script' });

const jsWorker = appScript.match(/const workerBlob = new Blob\(\[`([\s\S]*?)`\], \{ type: "application\/javascript" \}\)/);
assert.ok(jsWorker, 'JavaScript worker source should exist');
new vm.Script(jsWorker[1], { filename: 'javascript-worker.js' });
const pythonWorker = appScript.match(/const workerSource = `([\s\S]*?)`;\s*const workerUrl/);
assert.ok(pythonWorker, 'Python worker source should exist');
new vm.Script(pythonWorker[1], { filename: 'python-worker.js' });

const functions = new Set([...appScript.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(match => match[1]));
const handlers = new Set();
for (const attr of ['onclick', 'onchange', 'oninput', 'onscroll', 'onkeydown']) {
  for (const value of html.matchAll(new RegExp(`\\b${attr}="([^"]*)"`, 'g'))) {
    for (const fn of value[1].matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (!['if', 'Date', 'getElementById', 'toLocaleTimeString'].includes(fn[1])) handlers.add(fn[1]);
    }
  }
}
for (const name of handlers) assert.ok(functions.has(name), `UI handler ${name} must be declared`);
const staticIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
for (const match of appScript.matchAll(/getElementById\("([^"]+)"\)/g)) {
  assert.ok(staticIds.has(match[1]), `DOM reference #${match[1]} must exist in the page`);
}
assert.match(appScript, /SQLite WASM is still loading or unavailable/);
assert.match(appScript, /PISTON_API_URL|\/api\/execute/);

assert.match(server, /\/api\/execute/);
assert.match(server, /ALLOWED_LANGUAGES/);
assert.match(server, /MAX_BODY_BYTES/);
assert.match(appScript, /runTestCases\(\)/);
assert.match(appScript, /const verdict = missing\.length === 0 \? "PASSED" : "FAILED"/);
assert.doesNotMatch(appScript, /Memory Usage: 12\.4 MB \| Status: ACCEPTED/);
assert.match(appScript, /runPythonInWorker/);
assert.match(appScript, /Execution stopped after/);
assert.ok(fs.existsSync(path.join(root, 'public', 'privacy.html')));
assert.ok(fs.existsSync(path.join(root, 'public', 'terms.html')));
assert.ok(fs.existsSync(path.join(root, 'public', 'manifest.json')));
assert.ok(fs.existsSync(path.join(root, 'public', 'robots.txt')));
assert.ok(fs.existsSync(path.join(root, 'public', 'sitemap.xml')));

console.log(`CI Codes smoke tests passed: inline script syntax, 2 worker scripts, ${handlers.size} UI handlers, compiler endpoint guards, judge logic, and required public files.`);
