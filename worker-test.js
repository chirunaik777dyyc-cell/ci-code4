'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

(async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  const appScript = scripts[scripts.length - 1];
  const match = appScript.match(/const workerBlob = new Blob\(\[`([\s\S]*?)`\], \{ type: "application\/javascript" \}\)/);
  assert.ok(match, 'timed JavaScript worker must be present');
  const workerSource = match[1];

  async function run(code) {
    let result;
    const self = { postMessage: value => { result = value; } };
    vm.runInNewContext(workerSource, { self }, { timeout: 1000 });
    await self.onmessage({ data: { code } });
    return result;
  }

  const normal = await run('console.log("hello", 42); console.warn("careful"); console.log({ok:true});');
  assert.equal(normal.ok, true);
  assert.match(normal.output, /hello 42/);
  assert.match(normal.output, /\[WARN\] careful/);
  assert.match(normal.output, /"ok": true/);

  const failed = await run('throw new Error("expected worker error");');
  assert.equal(failed.ok, false);
  assert.match(failed.output, /expected worker error/);

  console.log('CI Codes worker tests passed: JavaScript worker console output, object formatting, warnings, and exception reporting.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
