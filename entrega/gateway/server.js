'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
try { require('dotenv').config(); } catch (_) {}

const PORT = parseInt(process.env.GATEWAY_PORT || '8080', 10);
const SCHEME = process.env.USE_TLS === 'true' ? 'https' : 'http';
if (process.env.USE_TLS === 'true') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const HEARTBEAT_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL_MS || '5000', 10);
const HEARTBEAT_TIMEOUT = parseInt(process.env.HEARTBEAT_TIMEOUT_MS || '2000', 10);
const HEARTBEAT_RETRIES = parseInt(process.env.HEARTBEAT_MAX_RETRIES || '2', 10);

const services = {
  users: { label: 'Usuários', url: process.env.USERS_URL || `${SCHEME}://localhost:5001`, status: 'unknown', fails: 0, since: new Date().toISOString() },
  products: { label: 'Produtos (primário)', url: process.env.PRODUCTS_URL || `${SCHEME}://localhost:5002`, status: 'unknown', fails: 0, since: new Date().toISOString() },
  productsReplica: { label: 'Produtos (réplica)', url: process.env.PRODUCTS_REPLICA_URL || `${SCHEME}://localhost:5012`, status: 'unknown', fails: 0, since: new Date().toISOString() },
  orders: { label: 'Pedidos', url: process.env.ORDERS_URL || `${SCHEME}://localhost:5003`, status: 'unknown', fails: 0, since: new Date().toISOString() },
};

const LOG_FILE = path.join(__dirname, 'logs', 'gateway.log');
function logEvent(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) {}
}

async function pingOnce(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HEARTBEAT_TIMEOUT);
  try {
    const r = await fetch(url + '/health', { signal: ctrl.signal });
    return r.ok;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
async function checkService(key) {
  const svc = services[key];
  let ok = false;
  for (let i = 0; i < HEARTBEAT_RETRIES; i++) {
    if (await pingOnce(svc.url)) { ok = true; break; }
  }
  const prev = svc.status;
  if (ok) {
    if (prev === 'down' && svc.alerted) {
      logEvent(`RECUPERAÇÃO: serviço '${svc.label}' (${svc.url}) voltou a responder.`);
      svc.alerted = false;
    }
    svc.status = 'up';
    svc.fails = 0;
    if (prev !== 'up') svc.since = new Date().toISOString();
  } else {
    svc.fails += 1;
    if (prev === 'up') {
      logEvent(`FALHA: serviço '${svc.label}' (${svc.url}) não respondeu ao heartbeat após ${HEARTBEAT_RETRIES} tentativas.`);
      svc.alerted = true;
    }
    if (prev !== 'down') svc.since = new Date().toISOString();
    svc.status = 'down';
  }
}
async function heartbeat() {
  await Promise.all(Object.keys(services).map(checkService));
}
setInterval(heartbeat, HEARTBEAT_INTERVAL);
heartbeat();

async function forward(req, res, baseUrl) {
  const target = baseUrl + req.originalUrl;
  const headers = { 'content-type': 'application/json' };
  if (req.headers.authorization) headers.authorization = req.headers.authorization;
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  try {
    const r = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? JSON.stringify(req.body || {}) : undefined,
    });
    const text = await r.text();
    res.status(r.status);
    res.set('content-type', r.headers.get('content-type') || 'application/json');
    return res.send(text);
  } catch (e) {
    logEvent(`ERRO ao encaminhar ${req.method} ${target}: ${e.message}`);
    return res.status(503).json({ error: 'Serviço indisponível (503)', target: baseUrl });
  }
}

function gate(key) {
  return (req, res) => {
    if (services[key].status === 'down') {
      logEvent(`503 ${req.method} ${req.originalUrl} -> '${services[key].label}' está DOWN`);
      return res.status(503).json({ error: `Serviço '${services[key].label}' indisponível (503)` });
    }
    return forward(req, res, services[key].url);
  };
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  if (req.path !== '/status') logEvent(`REQ ${req.method} ${req.originalUrl}`);
  next();
});

app.all(/^\/users(\/.*)?$/, gate('users'));

let rr = 0;
function productReadInstance() {
  const healthy = ['products', 'productsReplica'].filter((k) => services[k].status !== 'down');
  if (healthy.length === 0) return null;
  const key = healthy[rr++ % healthy.length];
  return services[key];
}
function productRead(req, res) {
  const inst = productReadInstance();
  if (!inst) {
    logEvent(`503 ${req.method} ${req.originalUrl} -> nenhuma instância de Produtos disponível`);
    return res.status(503).json({ error: 'Serviço de Produtos indisponível (503)' });
  }
  res.set('X-Served-By', inst.url);
  return forward(req, res, inst.url);
}
app.get('/products', productRead);
app.get(/^\/products\/.+$/, productRead);

app.post('/products', (req, res) => {
  if (services.products.status === 'down') {
    logEvent('503 POST /products -> primário de Produtos está DOWN');
    return res.status(503).json({ error: 'Serviço de Produtos (primário) indisponível para escrita (503)' });
  }
  return forward(req, res, services.products.url);
});

app.all(/^\/orders(\/.*)?$/, gate('orders'));

app.get('/status', (req, res) => res.json({ gateway: 'up', time: new Date().toISOString(), services }));
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'gateway' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

function startServer(app, port, name) {
  if (process.env.USE_TLS === 'true') {
    const certDir = path.join(__dirname, '..', 'certs');
    const options = {
      key: fs.readFileSync(path.join(certDir, 'key.pem')),
      cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
    };
    https.createServer(options, app).listen(port, () => {
      console.log(`[${name}] HTTPS ouvindo na porta ${port} — dashboard em https://localhost:${port}/`);
    });
  } else {
    http.createServer(app).listen(port, () => {
      console.log(`[${name}] HTTP ouvindo na porta ${port} — dashboard em http://localhost:${port}/`);
    });
  }
}
startServer(app, PORT, 'gateway');
