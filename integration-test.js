'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

function request(port, route, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path: route, method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function waitForServer(port, child) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Application server exited early with code ${child.exitCode}`);
    try {
      const response = await request(port, '/healthz');
      if (response.status === 200) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error('Application server did not become ready in time');
}

(async () => {
  let receivedAuthorization = false;
  let receivedPayload = null;
  const mockCompiler = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      receivedAuthorization = req.headers.authorization === 'Bearer integration-test-token';
      try { receivedPayload = JSON.parse(body); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ language: 'javascript', version: '18.15.0', run: { stdout: 'integration-ok\n', stderr: '', code: 0, signal: null } }));
    });
  });

  let app = null;
  try {
    const compilerPort = await listen(mockCompiler);
    const appPort = await (async () => {
      const probe = http.createServer();
      const port = await listen(probe);
      await new Promise(resolve => probe.close(resolve));
      return port;
    })();
    app = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, PORT: String(appPort), PISTON_API_URL: `http://127.0.0.1:${compilerPort}/execute`, PISTON_API_TOKEN: 'integration-test-token' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    app.stdout.on('data', chunk => { logs += chunk; });
    app.stderr.on('data', chunk => { logs += chunk; });
    await waitForServer(appPort, app);

    const health = await request(appPort, '/healthz');
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).status, 'ok');
    assert.equal(health.headers['x-content-type-options'], 'nosniff');

    for (const route of ['/', '/privacy.html', '/terms.html', '/manifest.json', '/robots.txt', '/sitemap.xml']) {
      const response = await request(appPort, route);
      assert.equal(response.status, 200, `${route} should load`);
      assert.ok(response.body.length > 0, `${route} should not be empty`);
    }
    assert.equal((await request(appPort, '/missing.js')).status, 404);
    assert.equal((await request(appPort, '/..%2fserver.js')).status, 400, 'encoded path traversal must be rejected');
    assert.equal((await request(appPort, '/api/not-real')).status, 404);
    assert.equal((await request(appPort, '/api/execute')).status, 405);
    assert.equal((await request(appPort, '/api/execute', { method: 'POST', body: '{bad json' })).status, 400);
    assert.equal((await request(appPort, '/api/execute', { method: 'POST', body: JSON.stringify({ language: 'not-a-language', version: '1', files: [{ name: 'main.txt', content: 'x' }] }) })).status, 400);
    assert.equal((await request(appPort, '/api/execute', { method: 'POST', body: JSON.stringify({ language: 'javascript', version: '18.15.0', files: [{ name: '../main.js', content: 'x' }] }) })).status, 400, 'unsafe compiler filenames must be rejected');
    assert.equal((await request(appPort, '/api/execute', { method: 'POST', headers: { 'Content-Length': String(1024 * 1024 + 1) }, body: 'x'.repeat(1024 * 1024 + 1) })).status, 413, 'oversized requests must be rejected');

    const payload = { language: 'javascript', version: '18.15.0', files: [{ name: 'main.js', content: 'console.log("integration-ok")' }], stdin: '' };
    const execute = await request(appPort, '/api/execute', { method: 'POST', body: JSON.stringify(payload) });
    assert.equal(execute.status, 200, `compiler proxy should succeed; server logs: ${logs}`);
    assert.equal(JSON.parse(execute.body).run.stdout, 'integration-ok\n');
    assert.equal(receivedAuthorization, true, 'compiler proxy must forward configured Bearer token');
    assert.deepEqual(receivedPayload, payload, 'compiler proxy must forward validated payload');

    // Exercise the request limiter last so it cannot affect the other assertions.
    let last = null;
    for (let i = 0; i < 22; i++) {
      last = await request(appPort, '/api/execute', { method: 'POST', body: JSON.stringify({ language: 'invalid', version: '1', files: [{ name: 'main.txt', content: '' }] }) });
      if (last.status === 429) break;
    }
    assert.equal(last.status, 429, 'execution endpoint should enforce a per-IP rate limit');

    console.log('CI Codes integration tests passed: HTTP routes, security headers, missing routes, JSON/language validation, compiler proxy, Bearer token forwarding, and rate limiting.');
  } finally {
    if (app && app.exitCode === null) {
      app.kill('SIGTERM');
      await new Promise(resolve => app.once('exit', resolve));
    }
    await new Promise(resolve => mockCompiler.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
