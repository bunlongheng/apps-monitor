const express = require('express');
const net = require('net');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const QRCode = require('qrcode');

const app = express();
const PORT = 9876;
const CONFIG_FILE = path.join(__dirname, 'apps.config.json');
const CHECK_INTERVAL = 10000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

function getLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'N/A';
}
const LAN_IP = getLanIp();

// --- State ---
const state = {};
function getState(id) {
  if (!state[id]) state[id] = { status: 'unknown', lastChecked: null };
  return state[id];
}

// --- HTTP health check (GET, accept any 1xx-4xx response as "up") ---
const http = require('http');
const https = require('https');
function tcpCheck(url) {
  return new Promise(resolve => {
    try {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.get(url, { timeout: 3000, headers: { 'User-Agent': 'apps-monitor' } }, res => {
        res.destroy();
        // 5xx = app crashed/broken → down; anything else = port is alive
        resolve(res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    } catch { resolve(false); }
  });
}

// --- Process name check ---
function processCheck(name) {
  try {
    const out = execSync(`pgrep -f "${name}" 2>/dev/null`).toString().trim();
    return out.length > 0;
  } catch { return false; }
}

// --- SSE clients ---
const sseClients = new Set();
function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(msg);
}

// --- Health check loop ---
async function checkAll() {
  const config = loadConfig();
  for (const appCfg of config) {
    const s = getState(appCfg.id);
    s.lastChecked = new Date().toISOString();

    let up = false;
    if (appCfg.healthUrl) {
      up = await tcpCheck(appCfg.healthUrl);
    } else if (appCfg.processCheck) {
      up = processCheck(appCfg.processCheck);
    }

    const newStatus = up ? 'up' : 'down';
    if (s.status !== newStatus) {
      s.status = newStatus;
      broadcast({ type: 'update', id: appCfg.id, status: newStatus });
      if (newStatus === 'down') broadcast({ type: 'alert', id: appCfg.id, name: appCfg.name });
    }
  }
}

// --- Routes ---
app.get('/api/status', (req, res) => {
  const config = loadConfig();
  const apps = config.map(a => {
    const s = getState(a.id);
    return {
      id: a.id,
      name: a.name,
      localUrl: a.localUrl,
      lanUrl: a.localUrl ? a.localUrl.replace('localhost', LAN_IP) : null,
      status: s.status,
      lastChecked: s.lastChecked,
      caddyUrl: a.caddyUrl || null,
      launchAgent: a.launchAgent || null,
      launchAgentPath: a.launchAgentPath || null,
      repo: a.repo || null,
      localPath: a.localPath || null,
      logPath: a.logPath || null,
      hostname: os.hostname(),
    };
  });
  res.json({ apps, lanIp: LAN_IP, monitorUrl: `http://${LAN_IP}:${PORT}` });
});

app.get('/api/qr', async (req, res) => {
  const url = `http://${LAN_IP}:${PORT}`;
  const dataUrl = await QRCode.toDataURL(url, { width: 200, margin: 1, color: { dark: '#e2e8f0', light: '#1a1d27' } });
  res.json({ url, dataUrl });
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.add(res);
  res.on('close', () => sseClients.delete(res));
});

app.get('/api/log/:id', (req, res) => {
  const config = loadConfig();
  const appCfg = config.find(a => a.id === req.params.id);
  if (!appCfg || !appCfg.logPath) return res.json({ lines: [] });
  try {
    const out = execSync(`tail -30 "${appCfg.logPath}" 2>/dev/null || true`).toString();
    res.json({ lines: out.trim().split('\n').filter(Boolean) });
  } catch { res.json({ lines: [] }); }
});

app.post('/api/start/:id', (req, res) => {
  const config = loadConfig();
  const app = config.find(a => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: 'not found' });
  try {
    if (app.launchAgentPath) {
      execSync(`launchctl load -w "${app.launchAgentPath}" 2>/dev/null || launchctl start "${app.launchAgent}" 2>/dev/null || true`);
    } else if (app.launchAgent) {
      execSync(`launchctl start "${app.launchAgent}" 2>/dev/null || true`);
    } else {
      return res.status(400).json({ error: 'no launchAgent configured' });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- File watcher ---
let reloadTimer = null;
[path.join(__dirname, 'public'), CONFIG_FILE].forEach(p => {
  fs.watch(p, { recursive: true }, () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => broadcast({ type: 'reload' }), 200);
  });
});

// --- Boot ---
checkAll();
setInterval(checkAll, CHECK_INTERVAL);

app.listen(PORT, () => {
  console.log(`\n  Apps Monitor running at:`);
  console.log(`  Local:  http://localhost:${PORT}`);
  console.log(`  LAN:    http://${LAN_IP}:${PORT}\n`);
});
