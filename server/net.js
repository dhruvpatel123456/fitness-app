// Works out the addresses the app can be reached at, and prints them (with a
// QR code) when the server starts.

import { execFile } from 'node:child_process';
import os from 'node:os';
import qrcode from 'qrcode-terminal';
import { APP_NAME } from './config.js';

function isTailscaleAddress(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

function isPrivateAddress(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** IPv4 addresses of this computer on the local network (home Wi-Fi first). */
export function lanAddresses(interfaces = os.networkInterfaces()) {
  const found = [];
  for (const list of Object.values(interfaces)) {
    for (const info of list || []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (isTailscaleAddress(info.address)) continue;
      found.push(info.address);
    }
  }
  return found.sort((x, y) => Number(isPrivateAddress(y)) - Number(isPrivateAddress(x)));
}

function run(command, args, timeoutMs = 2500) {
  return new Promise((resolve) => {
    try {
      execFile(command, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        resolve(err ? null : String(stdout));
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * From `tailscale serve status --json`: the https address that forwards to
 * this app's port, or null if `tailscale serve` is not set up for it.
 */
export function servedUrl(serveConfig, port) {
  const web = serveConfig && typeof serveConfig === 'object' ? serveConfig.Web : null;
  if (!web || typeof web !== 'object') return null;
  const target = new RegExp(`(^|[:/])${port}(/|$)`);
  for (const [hostPort, site] of Object.entries(web)) {
    for (const handler of Object.values(site?.Handlers || {})) {
      if (target.test(String(handler?.Proxy || ''))) {
        return `https://${hostPort.replace(/:443$/, '')}`;
      }
    }
  }
  return null;
}

function tailscaleCommands() {
  if (process.platform === 'win32') return ['tailscale.exe', 'C:\\Program Files\\Tailscale\\tailscale.exe'];
  if (process.platform === 'darwin') {
    return ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale'];
  }
  return ['tailscale'];
}

/**
 * Ask Tailscale (if installed) for this computer's secure address.
 * Best effort: any problem just means "unknown".
 */
export async function detectTailscale(port) {
  for (const command of tailscaleCommands()) {
    const statusText = await run(command, ['status', '--json']);
    if (!statusText) continue;
    try {
      const status = JSON.parse(statusText);
      const dnsName = String(status?.Self?.DNSName || '').replace(/\.$/, '');
      const running = status?.BackendState === 'Running';
      let serving = null;
      const serveText = await run(command, ['serve', 'status', '--json']);
      if (serveText) {
        try {
          serving = servedUrl(JSON.parse(serveText), port);
        } catch {
          serving = null;
        }
      }
      return { installed: true, running, name: dnsName || null, servingUrl: serving };
    } catch {
      return { installed: true, running: false, name: null, servingUrl: null };
    }
  }
  return null;
}

function qr(text) {
  return new Promise((resolve) => {
    qrcode.generate(text, { small: true }, (code) => resolve(code));
  });
}

/** Decide which addresses to show and which one the QR code should point to. */
export function chooseAddresses({ config, lan, tailscale, httpsEnabled }) {
  const local = `http://localhost:${config.port}`;
  const lanHttp = lan.map((ip) => `http://${ip}:${config.port}`);
  const lanHttps = httpsEnabled ? lan.map((ip) => `https://${ip}:${config.httpsPort}`) : [];
  const secure = config.publicUrl || tailscale?.servingUrl || lanHttps[0] || null;
  return { local, lanHttp, lanHttps, secure, qrTarget: secure || lanHttp[0] || local };
}

export async function printBanner({ config, httpsEnabled, log = console }) {
  const lan = lanAddresses();
  const tailscale = await detectTailscale(config.port);
  const a = chooseAddresses({ config, lan, tailscale, httpsEnabled });
  const lines = ['', `  ${APP_NAME} is running.`, '', `  On this laptop:   ${a.local}`];
  for (const url of a.lanHttp) lines.push(`  On your Wi-Fi:    ${url}`);
  for (const url of a.lanHttps) lines.push(`  Wi-Fi (HTTPS):    ${url}`);
  if (config.publicUrl) lines.push(`  Secure address:   ${config.publicUrl}   (PUBLIC_URL in .env)`);
  else if (tailscale?.servingUrl) lines.push(`  Secure address:   ${tailscale.servingUrl}   (Tailscale)`);
  lines.push('');

  if (!a.secure) {
    lines.push('  Heads up: the barcode camera and "Add to Home Screen" only work over HTTPS.');
    if (tailscale?.running && tailscale.name) {
      lines.push('  Tailscale is installed. For a secure address, run this once in another window:');
      lines.push(`      tailscale serve --bg ${config.port}`);
      lines.push(`  Then open https://${tailscale.name} on your phone.`);
    } else {
      lines.push('  See "Connecting your phone" in README.md (Tailscale takes about five minutes).');
    }
    lines.push('');
  }
  lines.push(`  Scan this with your phone camera to open ${a.qrTarget}`);
  lines.push('');
  log.log(lines.join('\n'));
  log.log(await qr(a.qrTarget));
  log.log('  Leave this window open. Press Ctrl+C to stop the app.\n');
  return a;
}
