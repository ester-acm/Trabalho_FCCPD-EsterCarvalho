# Testes que eu fiz

Aqui ficam as anotações dos testes que rodei pra ter certeza de que cada parte
funcionava: a replicação, a queda e a volta de um serviço, e a segurança. Tudo foi
testado com o sistema rodando pelo `npm start`. Dá pra repetir rodando `npm run demo`
e depois seguindo os passos das seções 2 e 3 na mão.

## 1. Fluxo completo (npm run demo)

Esse foi o primeiro teste, batendo em todos os endpoints pelo gateway. Saída:

```
=== 1) Login do ADMIN (admin@shop.com / admin123) ===
200 { id: 'u-admin', name: 'Administradora', email: 'admin@shop.com', role: 'admin' }

=== 2) ADMIN cria um produto (escrita replicada no primário 5002 -> réplica 5012) ===
201 { id: 'p-50af8427', name: 'Headset 7.1', price: 399.9, stock: 30,
      description: 'Headset surround', replication: 'confirmed' }

=== 3) Leitura de /products (round-robin entre primário e réplica) ===
servido por: http://localhost:5002 | total de produtos: 4
servido por: http://localhost:5012 | total de produtos: 4
servido por: http://localhost:5002 | total de produtos: 4
servido por: http://localhost:5012 | total de produtos: 4

=== 4) Confere que o produto novo está NA RÉPLICA (5012) diretamente ===
réplica respondeu 200 -> Headset 7.1

=== 5) Registro de um usuário comum ===
201 { id: 'u-a409ac55', name: 'João', email: 'joao@shop.com', role: 'user' }

=== 6) Login do usuário comum ===
200 { id: 'u-a409ac55', name: 'João', email: 'joao@shop.com', role: 'user' }

=== 7) Usuário comum cria um pedido ===
201 { id: 'o-dbaf1f73', userId: 'u-a409ac55', productId: 'p-50af8427',
      productName: 'Headset 7.1', quantity: 2, unitPrice: 399.9, total: 799.8 }

=== 8) Lista pedidos do usuário ===
200 [ { id: 'o-dbaf1f73', ... total: 799.8 } ]

=== 9) SEGURANÇA: usuário comum tenta criar produto -> deve dar 403 ===
403 { error: 'Apenas administradores podem executar esta operação' }

=== 10) SEGURANÇA: requisição sem token -> deve dar 401 ===
401 { error: 'Token JWT ausente' }
```

O que esse teste me mostrou: a escrita replicou (veio `replication: confirmed`), a
leitura ficou alternando entre 5002 e 5012, o pedido ligou usuário e produto certinho,
e a segurança barrou o usuário comum (403) e a requisição sem token (401).

## 2. Derrubando o serviço de Pedidos

Esse foi o teste pra ver a tolerância a falha. Passos:

1. Com tudo no ar, fechei só o processo do Pedidos (5003).
2. Uns 5 segundos depois o heartbeat já tinha percebido. Situação na hora:

```
users:           up
products:        up
productsReplica: up
orders:          down
```

3. Conferindo que o resto continuou funcionando e só os pedidos caíram:

```
GET /products            -> HTTP 200 | itens: 4      (produtos ok)
POST /users/login        -> 200, role=admin          (usuários ok)
GET /orders/u-admin      -> HTTP 503                  (pedidos fora)
```

4. Subi o Pedidos de novo e o gateway voltou a atender sozinho. Criei um pedido
   depois da volta e funcionou normal:

```
Pedido criado pós-recuperação: o-624fa57d | produto=Teclado Mecânico | total=299.9
```

O log do gateway registrou a falha e a recuperação com a hora certa
(arquivo gateway/logs/gateway.log):

```
[2026-06-10T18:35:29.322Z] FALHA: serviço 'Pedidos' (http://localhost:5003) não respondeu ao heartbeat após 2 tentativas.
[2026-06-10T18:35:47.330Z] 503 GET /orders/u-admin -> 'Pedidos' está DOWN
[2026-06-10T18:36:04.410Z] RECUPERAÇÃO: serviço 'Pedidos' (http://localhost:5003) voltou a responder.
```

## 3. Derrubando a réplica de Produtos (e a reconciliação)

Esse foi o que eu mais quis testar, pra ver a réplica se acertar sozinha quando volta.

1. Fechei só a réplica (5012). Situação:

```
productsReplica: down | products(primário): up
```

2. Criei um produto com a réplica fora. O primário aceitou mesmo assim e marcou
   como pendente (que era o que eu queria, pra não travar a venda):

```
Produto criado com réplica DOWN -> id=p-240ed7fa | replication=pending
```

3. As leituras continuaram, agora só pelo primário:

```
GET /products -> HTTP 200 | servido por: http://localhost:5002 | itens: 5
```

4. Subi a réplica de novo. O reconciliador do primário mandou o estado completo
   e a réplica se igualou. Conferindo direto nela (5012):

```
Produtos na réplica (5012):
  - Teclado Mecânico  (R$ 299.9)
  - Mouse Gamer       (R$ 149.9)
  - Monitor 27" 144Hz (R$ 1599)
  - Headset 7.1       (R$ 399.9)
  - Cadeira Gamer     (R$ 899)      <- esse foi criado enquanto a réplica estava fora

Total na réplica: 5 | Total no primário: 5
```

Ou seja: o produto que entrou com a réplica caída apareceu nela depois que voltou,
sem eu precisar fazer nada na mão.

## 4. TLS / HTTPS

Gerei o certificado (npm run certs) e subi em HTTPS (npm run start:tls). Os 5 serviços
subiram em HTTPS e a comunicação interna primário->réplica também passou a ser por
HTTPS. Uma escrita pelo gateway HTTPS voltou com `replication: confirmed`, que prova
que a réplica recebeu o dado mesmo com tudo cifrado.

## 5. Subida limpa

Só pra registrar que o `npm start` sobe os 5 sem erro, e o primário já reconcilia a
réplica logo no início:

```
[USERS]    [users] HTTP ouvindo na porta 5001
[PRODUTOS] [products:primary] HTTP ouvindo na porta 5002
[REPLICA]  [products:replica] HTTP ouvindo na porta 5012
[PEDIDOS]  [orders] HTTP ouvindo na porta 5003
[GATEWAY]  [gateway] HTTP ouvindo na porta 8080 — dashboard em http://localhost:8080/
[PRODUTOS] [products:primary] réplica reconciliada (3 produtos)
```
