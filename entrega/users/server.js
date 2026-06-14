'use strict';
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
try { require('dotenv').config(); } catch (_) {}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-troque-isto';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const PORT = parseInt(process.env.USERS_PORT || '5001', 10);
const DATA_FILE = path.join(__dirname, 'data', 'users.json');

function loadData(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function saveData(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function seed() {
  if (fs.existsSync(DATA_FILE)) return;
  const now = new Date().toISOString();
  saveData(DATA_FILE, [
    { id: 'u-admin', name: 'Administradora', email: 'admin@shop.com', role: 'admin', passwordHash: bcrypt.hashSync('admin123', 10), createdAt: now },
    { id: 'u-ester', name: 'Ester', email: 'ester@shop.com', role: 'user', passwordHash: bcrypt.hashSync('ester123', 10), createdAt: now },
  ]);
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
        return res.status(403).json({ error: 'Permissão insuficiente para esta operação' });
      }
      return next();
    } catch (_) {
      return res.status(401).json({ error: 'Token inválido ou expirado' });
    }
  };
}

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'users' }));

app.post('/users/register', (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email e password são obrigatórios' });
  }
  const users = loadData(DATA_FILE, []);
  if (users.find((u) => u.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(409).json({ error: 'E-mail já cadastrado' });
  }
  const user = {
    id: 'u-' + crypto.randomUUID().slice(0, 8),
    name,
    email,
    role: role === 'admin' ? 'admin' : 'user',
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveData(DATA_FILE, users);
  const { passwordHash, ...safe } = user;
  return res.status(201).json(safe);
});

app.post('/users/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email e password são obrigatórios' });
  const users = loadData(DATA_FILE, []);
  const user = users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }
  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );
  return res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.get('/users/:id', auth(), (req, res) => {
  if (req.user.userId !== req.params.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  const user = loadData(DATA_FILE, []).find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  const { passwordHash, ...safe } = user;
  return res.json(safe);
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
startServer(app, PORT, 'users');
