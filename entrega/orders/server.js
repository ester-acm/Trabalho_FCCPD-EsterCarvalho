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
const PORT = parseInt(process.env.ORDERS_PORT || '5003', 10);
const SCHEME = process.env.USE_TLS === 'true' ? 'https' : 'http';
if (process.env.USE_TLS === 'true') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const PRODUCTS_URL = process.env.PRODUCTS_URL || `${SCHEME}://localhost:5002`;
const PRODUCTS_REPLICA_URL = process.env.PRODUCTS_REPLICA_URL || `${SCHEME}://localhost:5012`;
const DATA_FILE = path.join(__dirname, 'data', 'orders.json');

function loadData(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function saveData(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
if (!fs.existsSync(DATA_FILE)) saveData(DATA_FILE, []);

function auth(requiredRole) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Token JWT ausente' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = payload;
      if (requiredRole && payload.role !== requiredRole) {
        return res.status(403).json({ error: 'Permissão insuficiente' });
      }
      return next();
    } catch (_) {
      return res.status(401).json({ error: 'Token inválido ou expirado' });
    }
  };
}

async function getProduct(id) {
  for (const base of [PRODUCTS_URL, PRODUCTS_REPLICA_URL]) {
    try {
      const r = await fetch(base + '/products/' + id);
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch (_) {}
  }
  throw new Error('products-unavailable');
}

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'orders' }));

app.post('/orders', auth(), async (req, res) => {
  const { productId, quantity } = req.body || {};
  if (!productId) return res.status(400).json({ error: 'productId é obrigatório' });
  const qty = quantity != null ? Number(quantity) : 1;

  let product;
  try {
    product = await getProduct(productId);
  } catch (_) {
    return res.status(503).json({ error: 'Serviço de Produtos indisponível para validar o pedido (503)' });
  }
  if (!product) return res.status(404).json({ error: 'Produto não encontrado' });

  const order = {
    id: 'o-' + crypto.randomUUID().slice(0, 8),
    userId: req.user.userId,
    productId,
    productName: product.name,
    quantity: qty,
    unitPrice: product.price,
    total: Number((product.price * qty).toFixed(2)),
    status: 'created',
    createdAt: new Date().toISOString(),
  };
  const orders = loadData(DATA_FILE, []);
  orders.push(order);
  saveData(DATA_FILE, orders);
  return res.status(201).json(order);
});

app.get('/orders/:userId', auth(), (req, res) => {
  if (req.user.userId !== req.params.userId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  const orders = loadData(DATA_FILE, []).filter((o) => o.userId === req.params.userId);
  return res.json(orders);
});

function startServer(app, port, name) {
  if (process.env.USE_TLS === 'true') {
    const certDir = path.join(__dirname, '..', 'certs');
    const options = {
      key: fs.readFileSync(path.join(certDir, 'key.pem')),
      cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
    };
    https.createServer(options, app).listen(port, () => console.log(`[${name}] HTTPS ouvindo na porta ${port}`));
  } else {
    http.createServer(app).listen(port, () => console.log(`[${name}] HTTP ouvindo na porta ${port}`));
  }
}
startServer(app, PORT, 'orders');
