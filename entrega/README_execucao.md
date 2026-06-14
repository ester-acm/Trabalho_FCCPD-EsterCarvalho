# Como rodar o projeto

Mini e-commerce distribuído com um API Gateway e três serviços (Usuários, Produtos com réplica, e Pedidos). Tudo em Node.js, comunicação por HTTP/REST.

```
Cliente (curl / Postman / scripts/demo.js)
        |
   API Gateway (8080)   -> entrada única, heartbeat e dashboard
        |
   +----+-------------+-------------+
   |                  |             |
 Usuários         Produtos        Pedidos
  (5001)        5002 + 5012        (5003)
                (primário/réplica)
```

## O que precisa ter instalado

- Node.js 18 ou mais novo (eu desenvolvi e testei no Node 22).
- Docker é opcional, só se quiser subir pelo compose.

## Rodando com Node (jeito principal)

Dentro da pasta `entrega/`:

```
npm install
npm start
```

O `npm start` sobe os 5 processos juntos (usuários, produtos primário, produtos réplica, pedidos e gateway), cada um com a saída numa cor no terminal. Depois disso:

- Gateway e dashboard: http://localhost:8080
- Serviços por trás: 5001 (usuários), 5002 e 5012 (produtos), 5003 (pedidos)

Para parar, é só dar Ctrl+C.

### Rodar a demonstração

Com o sistema no ar, abra **outro terminal** na pasta `entrega/` e rode:

```
npm run demo
```

Esse script faz o fluxo todo passando pelo gateway: login de admin, cria um produto (que é replicado), faz leitura alternando entre as réplicas, registra e loga um usuário comum, cria e lista um pedido, e no fim testa a segurança (usuário comum tomando 403 ao tentar criar produto, e requisição sem token tomando 401).

### Subir um serviço por vez (se precisar)

Cada serviço também roda sozinho:

```
npm run start:users
npm run start:products      (primário, 5002)
npm run start:replica       (réplica, 5012)
npm run start:orders
npm run start:gateway
```

## Rodando com Docker Compose (opcional)

Também na pasta `entrega/`:

```
docker compose up --build
```

Isso sobe os 5 containers já conectados na mesma rede. O acesso continua em http://localhost:8080. Para derrubar: `docker compose down`.

## TLS / HTTPS (opcional)

```
npm run certs       (gera um certificado autoassinado em entrega/certs)
npm run start:tls   (sobe tudo em HTTPS)
```

O dashboard passa a ficar em https://localhost:8080. O navegador vai reclamar do certificado autoassinado, isso é normal. As chamadas entre os serviços também passam a ser por HTTPS.

## Dashboard

Abrir http://localhost:8080 no navegador. A página mostra, atualizando sozinha a cada 2 segundos, se cada serviço está ONLINE ou OFFLINE, com base no heartbeat do gateway. É bom deixar aberto quando for testar a queda de um serviço, dá pra ver ele ficar vermelho e depois voltar.

## Endpoints (todos passam pelo gateway, em http://localhost:8080)

Usuários:
- POST `/users/register` -> body `{ name, email, password, role? }`
- POST `/users/login` -> body `{ email, password }`, devolve `{ token, user }`
- GET `/users/:id` -> precisa de token (o próprio usuário ou um admin)

Produtos:
- GET `/products` -> lista (alternando entre primário e réplica)
- GET `/products/:id` -> detalhe
- POST `/products` -> precisa de token de admin, body `{ name, price, stock?, description? }`

Pedidos:
- POST `/orders` -> precisa de token, body `{ productId, quantity }`
- GET `/orders/:userId` -> precisa de token (o próprio usuário ou um admin)

Monitoramento:
- GET `/status` -> JSON com a situação de todos os serviços
- GET `/health` -> em cada serviço, devolve `{ "status": "ok" }`

### Logins que já vêm criados

- admin@shop.com / admin123 (admin)
- ester@shop.com / ester123 (usuário comum)

## Exemplo rápido com curl

```
curl -s -X POST http://localhost:8080/users/login -H "Content-Type: application/json" -d "{\"email\":\"admin@shop.com\",\"password\":\"admin123\"}"
```

Pega o token que voltou e usa pra criar um produto:

```
curl -s -X POST http://localhost:8080/products -H "Content-Type: application/json" -H "Authorization: Bearer SEU_TOKEN" -d "{\"name\":\"Webcam HD\",\"price\":199.9,\"stock\":15}"
```

No Windows é mais tranquilo usar o `npm run demo` ou o Postman do que ficar escapando aspas no curl.

## Testando a tolerância a falhas

1. Com tudo rodando, derrube um serviço (fecha o processo do Pedidos, ou `docker compose stop orders` se estiver no Docker).
2. Em uns 5 segundos o gateway escreve no terminal e no arquivo `gateway/logs/gateway.log` a falha com a hora.
3. Chame `GET http://localhost:8080/orders/algumId`: vem 503. Mas usuários e produtos continuam funcionando.
4. Suba o serviço de novo: o gateway registra a recuperação e volta a atender.
5. Para a réplica: pare a réplica de produtos, crie um produto (vai funcionar mesmo assim, marcado como pendente), suba a réplica e veja no log do primário que ela foi reconciliada.

Tem o passo a passo com as saídas reais no arquivo TESTES.md.

## Gerar o relatório em PDF

O relatorio.pdf já está na pasta. Se mexer no relatorio.md e quiser gerar de novo:

```
npm run report
```

## Organização das pastas

```
entrega/
  gateway/     gateway (heartbeat, roteamento, dashboard em public/)
  users/       serviço de usuários (5001)
  products/    serviço de produtos, o mesmo código roda como primário (5002) e réplica (5012)
  orders/      serviço de pedidos (5003)
  scripts/     demo.js, generate-certs.js, build-report.js
  docker-compose.yml
  .env / .env.example
  README_execucao.md
  TESTES.md
  relatorio.pdf
```
