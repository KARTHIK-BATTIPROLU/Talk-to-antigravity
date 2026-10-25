import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as http from 'http';
import { BrowserManager } from '../browserManager';

describe('BrowserManager Tests', () => {
  it('sniffs terminal output for localhost and loopback ports', () => {
    const manager = new BrowserManager();
    manager.feedTerminalOutput('Local: http://localhost:5173\nNetwork: http://192.168.1.5:5173');
    manager.feedTerminalOutput('Backend running at http://127.0.0.1:8080');

    // Known ports set should include 5173 and 8080
    assert.ok(manager['knownPorts'].has(5173));
    assert.ok(manager['knownPorts'].has(8080));
  });

  it('scans running local dev server via loopback probe', async () => {
    // Spin up a mock local HTTP dev server on dynamic port
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head><title>My Test App</title></head><body><h1>Hello</h1></body></html>');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as any;
    const testPort = address.port;

    try {
      const manager = new BrowserManager();
      manager.feedTerminalOutput(`Server ready at http://localhost:${testPort}`);

      const results = await manager.scanDevServers();
      const detected = results.find((s) => s.port === testPort);

      assert.ok(detected, 'Should detect running test HTTP server');
      assert.strictEqual(detected.port, testPort);
      assert.strictEqual(detected.status, 'running');
      assert.strictEqual(detected.title, 'My Test App');

      // Test URL inspection
      const inspection = await manager.inspectUrl(`http://localhost:${testPort}`);
      assert.strictEqual(inspection.title, 'My Test App');
      assert.strictEqual(inspection.errors.length, 0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects external non-loopback URLs for security', async () => {
    const manager = new BrowserManager();
    const res = await manager.inspectUrl('http://google.com/test');
    assert.ok(res.errors.some((e) => e.includes('Only localhost')));
  });
});
