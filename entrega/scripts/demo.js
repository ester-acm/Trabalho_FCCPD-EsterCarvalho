'use strict';
const BASE = process.env.GATEWAY_URL || 'http://localhost:8080';
if (BASE.startsWith('https')) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function call(method, path, { token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data;
  try { data = await r.json(); } catch (_) { data = null; }
  return { status: r.status, data, served: r.headers.get('x-served-by') };
}

function line(title) { console.log('\n=== ' + title + ' ==='); }

(async () => {
  line('1) Login do ADMIN (admin@shop.com / admin123)');
  const adminLogin = await call('POST', '/users/login', { body: { email: 'admin@shop.com', password: 'admin123' } });
  console.log(adminLogin.status, adminLogin.data.user);
  const adminToken = adminLogin.data.token;

  line('2) ADMIN cria um produto (escrita replicada no primário 5002 -> réplica 5012)');
  const created = await call('POST', '/products', {
    token: adminToken,
    body: { name: 'Headset 7.1', price: 399.9, stock: 30, description: 'Headset surround' },
  });
  console.log(created.status, created.data);
  const productId = created.data.id;

  line('3) Leitura de /products (round-robin entre primário e réplica)');
  for (let i = 0; i < 4; i++) {
    const list = await call('GET', '/products');
    console.log('servido por:', list.served, '| total de produtos:', list.data.length);
  }

  line('4) Confere que o produto novo está NA RÉPLICA (5012) diretamente');
  if (BASE.startsWith('https')) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    const replicaScheme = BASE.startsWith('https') ? 'https' : 'http';
    const rep = await fetch(`${replicaScheme}://localhost:5012/products/${productId}`);
    console.log('réplica respondeu', rep.status, '->', (await rep.json()).name);
  } catch (e) { console.log('réplica indisponível:', e.message); }

  line('5) Registro de um usuário comum');
  const reg = await call('POST', '/users/register', { body: { name: 'João', email: 'joao@shop.com', password: 'joao123' } });
  console.log(reg.status, reg.data);

  line('6) Login do usuário comum');
  const userLogin = await call('POST', '/users/login', { body: { email: 'joao@shop.com', password: 'joao123' } });
  console.log(userLogin.status, userLogin.data.user);
  const userToken = userLogin.data.token;
  const userId = userLogin.data.user.id;

  line('7) Usuário comum cria um pedido');
  const order = await call('POST', '/orders', { token: userToken, body: { productId, quantity: 2 } });
  console.log(order.status, order.data);

  line('8) Lista pedidos do usuário');
  const orders = await call('GET', '/orders/' + userId, { token: userToken });
  console.log(orders.status, orders.data);

  line('9) SEGURANÇA: usuário comum tenta criar produto -> deve dar 403');
  const denied = await call('POST', '/products', { token: userToken, body: { name: 'Hack', price: 1 } });
  console.log(denied.status, denied.data);

  line('10) SEGURANÇA: requisição sem token -> deve dar 401');
  const noToken = await call('GET', '/orders/' + userId);
  console.log(noToken.status, noToken.data);

  console.log('\nDemo concluída.');
})().catch((e) => { console.error('Erro na demo:', e.message); process.exit(1); });
