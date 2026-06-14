'use strict';
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
try { require('dotenv').config(); } catch (_) {}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-troque-isto';
const INTERNAL_KEY = process.env.INTERNAL_KEY || 'chave-interna-troque';
const ROLE = process.env.INSTANCE_ROLE === 'replica' ? 'replica' : 'primary';
const PORT = parseInt(process.env.INSTANCE_PORT || (ROLE === 'replica' ? '5012' : '5002'), 10);
const SCHEME = process.env.USE_TLS === 'true' ? 'https' : 'http';
if (process.env.USE_TLS === 'true') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const REPLICA_URL = process.env.REPLICA_URL || `${SCHEME}://localhost:5012`;
const RECONCILE_MS = parseInt(process.env.RECONCILE_MS || '5000', 10);

const DATA_FILE = path.join(__dirname, 'data', `products_${PORT}.json`);

function loadData(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function saveData(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function seed() {
  if (fs.existsSync(DATA_FILE)) return;
  if (ROLE === 'primary') {
    const now = new Date().toISOString();
    saveData(DATA_FILE, [
      { id: 'p-1001', name: 'Teclado Mecânico', price: 299.9, stock: 50, description: 'Teclado mecânico RGB', updatedAt: now },
      { id: 'p-1002', name: 'Mouse Gamer', price: 149.9, stock: 80, description: 'Mouse óptico 16000 DPI', updatedAt: now },
      { id: 'p-1003', name: 'Monitor 27" 144Hz', price: 1599.0, stock: 20, description: 'Monitor IPS Full HD', updatedAt: now },
    ]);
  } else {
    saveData(DATA_FILE, []);
  }
}
seed();

function auth(requiredRole) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Token JWT ausente' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = payload;
      if (requiredRole && payload.role !== requiredRole) {
        return res.status(403).json({ error: 'Apenas administradores podem executar esta operação' });
      }
      return next();
    } catch (_) {
      return res.status(401).json({ error: 'Token inválido ou expirado' });
    }
  };
}

function internalAuth(req, res, next) {
  if (req.headers['x-internal-key'] !== INTERNAL_KEY) {
    return res.status(401).json({ error: 'Chave interna inválida' });
  }
  return next();
}

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'products', role: ROLE, port: PORT }));

app.get('/products', (req, res) => res.json(loadData(DATA_FILE, [])));

app.get('/products/:id', (req, res) => {
  const product = loadData(DATA_FILE, []).find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Produto não encontrado' });
  return res.json(product);
});

let pendingSync = false;
let replicaWasDown = true;

app.post('/products', auth('admin'), async (req, res) => {
  if (ROLE !== 'primary') {
    return res.status(403).json({ error: 'Esta instância é réplica; escritas externas só no primário' });
  }
  const { name, price, stock, description } = req.body || {};
  if (!name || price == null) return res.status(400).json({ error: 'name e price são obrigatórios' });

  const product = {
    id: 'p-' + crypto.randomUUID().slice(0, 8),
    name,
    price: Number(price),
    stock: stock != null ? Number(stock) : 0,
    description: description || '',
    updatedAt: new Date().toISOString(),
  };

  const products = loadData(DATA_FILE, []);
  products.push(product);
  saveData(DATA_FILE, products);

  let replicated = false;
  try {
    const r = await fetch(REPLICA_URL + '/internal/replicate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': INTERNAL_KEY },
      body: JSON.stringify(product),
    });
    replicated = r.ok;
  } catch (_) {
    replicated = false;
  }

  if (!replicated) {
    pendingSync = true;
    console.warn(`[products:${ROLE}] réplica indisponível — escrita aceita e marcada para reconciliação`);
    return res.status(201).json({ ...product, replication: 'pending' });
  }
  return res.status(201).json({ ...product, replication: 'confirmed' });
});

app.post('/internal/replicate', internalAuth, (req, res) => {
  const product = req.body;
  if (!product || !product.id) return res.status(400).json({ error: 'produto inválido' });
  const products = loadData(DATA_FILE, []);
  const idx = products.findIndex((p) => p.id === product.id);
  if (idx >= 0) products[idx] = product; else products.push(product);
  saveData(DATA_FILE, products);
  return res.json({ status: 'ok' });
});

app.post('/internal/sync', internalAuth, (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'esperado um array de produtos' });
  saveData(DATA_FILE, req.body);
  return res.json({ status: 'ok', count: req.body.length });
});

async function reconcile() {
  if (ROLE !== 'primary') return;
  try {
    const h = await fetch(REPLICA_URL + '/health');
    const up = h.ok;
    if (up && (pendingSync || replicaWasDown)) {
      const products = loadData(DATA_FILE, []);
      const r = await fetch(REPLICA_URL + '/internal/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': INTERNAL_KEY },
        body: JSON.stringify(products),
      });
      if (r.ok) {
        console.log(`[products:primary] réplica reconciliada (${products.length} produtos) em ${new Date().toISOString()}`);
        pendingSync = false;
        replicaWasDown = false;
      }
    }
    if (!up) replicaWasDown = true;
  } catch (_) {
    replicaWasDown = true;
  }
}
if (ROLE === 'primary') setInterval(reconcile, RECONCILE_MS);

function startServer(app, port, name) {
  if (process.env.USE_TLS === 'true') {
    const certDir = path.join(__dirname, '..', 'certs');
    const options = {
      key: fs.readFileSync(path.join(certDir, 'key.pem')),
      cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
    };
    https.createServer(options, app).listen(port, () => console.log(`[${name}:${ROLE}] HTTPS ouvindo na porta ${port}`));
  } else {
    http.createServer(app).listen(port, () => console.log(`[${name}:${ROLE}] HTTP ouvindo na porta ${port}`));
  }
}
startServer(app, PORT, 'products');
