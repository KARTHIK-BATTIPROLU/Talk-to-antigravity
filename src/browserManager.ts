import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import { DevServerInfo } from './types';

export class BrowserManager {
  private knownPorts: Set<number> = new Set([3000, 5173, 8080, 8000, 4200, 8081, 9222]);
  private serverCache: Map<number, DevServerInfo> = new Map();

  /**
   * Sniffs terminal output for URLs matching localhost, 127.0.0.1, or 0.0.0.0 with ports.
   */
  public feedTerminalOutput(text: string): void {
    const regex = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const port = parseInt(match[1], 10);
      if (port > 0 && port < 65536) {
        this.knownPorts.add(port);
      }
    }
  }

  /**
   * Scans localhost ports using safe loopback HTTP probes.
   */
  public async scanDevServers(): Promise<DevServerInfo[]> {
    const ports = Array.from(this.knownPorts);
    const probePromises = ports.map((port) => this.probePort(port));
    const results = await Promise.all(probePromises);

    const activeServers = results.filter((s): s is DevServerInfo => s !== null);
    for (const server of activeServers) {
      this.serverCache.set(server.port, server);
    }

    return activeServers;
  }

  private probePort(port: number): Promise<DevServerInfo | null> {
    return new Promise((resolve) => {
      const req = http.get(
        {
          host: '127.0.0.1',
          port: port,
          path: '/',
          timeout: 400
        },
        (res) => {
          let rawData = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            if (rawData.length < 2048) {
              rawData += chunk;
            }
          });
          res.on('end', () => {
            let title = `Dev Server (Port ${port})`;
            const titleMatch = rawData.match(/<title>([^<]*)<\/title>/i);
            if (titleMatch && titleMatch[1]) {
              title = titleMatch[1].trim();
            }

            resolve({
              port,
              url: `http://localhost:${port}`,
              status: 'running',
              title
            });
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.on('error', () => {
        resolve(null);
      });
    });
  }

  /**
   * Inspects a localhost dev server URL for title and web error banners.
   */
  public inspectUrl(targetUrl: string): Promise<{ title: string; errors: string[] }> {
    return new Promise((resolve) => {
      const parsed = url.parse(targetUrl);
      const isLoopback =
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '0.0.0.0';

      if (!isLoopback) {
        resolve({
          title: 'Remote URL Inspection Disallowed',
          errors: ['Security: Only localhost / loopback URLs can be inspected.']
        });
        return;
      }

      const isHttps = parsed.protocol === 'https:';
      const client = isHttps ? https : http;
      const defaultPort = isHttps ? 443 : 80;
      const port = parsed.port ? parseInt(parsed.port, 10) : defaultPort;

      const req = client.get(
        {
          host: parsed.hostname || '127.0.0.1',
          port: port,
          path: parsed.path || '/',
          timeout: 2000,
          rejectUnauthorized: false
        } as any,
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            if (body.length < 16384) {
              body += chunk;
            }
          });

          res.on('end', () => {
            let title = targetUrl;
            const titleMatch = body.match(/<title>([^<]*)<\/title>/i);
            if (titleMatch && titleMatch[1]) {
              title = titleMatch[1].trim();
            }

            const errors: string[] = [];

            if (res.statusCode && res.statusCode >= 400) {
              errors.push(`HTTP status error code: ${res.statusCode} ${res.statusMessage || ''}`);
            }

            if (body.includes('webpack-dev-server-client-overlay') || body.includes('webpack Hot Dev Client')) {
              errors.push('Webpack dev overlay error detected.');
            }
            if (body.includes('vite-error-overlay') || body.includes('plugin:vite:')) {
              errors.push('Vite build/compilation error overlay detected.');
            }
            if (body.includes('nextjs-portal') || body.includes('Next.js error')) {
              errors.push('Next.js runtime/compilation error detected.');
            }

            resolve({
              title,
              errors
            });
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolve({
          title: targetUrl,
          errors: ['Request timed out connecting to dev server.']
        });
      });

      req.on('error', (err) => {
        resolve({
          title: targetUrl,
          errors: [`Failed to connect: ${err.message}`]
        });
      });
    });
  }
}
