# Mini E-commerce Distribuído

Projeto desenvolvido para a disciplina de **Fundamentos de Computação Concorrente, Paralela e Distribuída (FCCPD)**, com o objetivo de implementar uma versão simplificada de um sistema de e-commerce baseado em uma arquitetura de microsserviços. A proposta aplica, de forma prática, conceitos fundamentais de sistemas distribuídos estudados ao longo da disciplina: decomposição em serviços independentes, replicação de dados, detecção de falhas por *heartbeat* e autenticação entre serviços por meio de JWT.

- **Autora:** Ester Carvalho
- **Disciplina:** Fundamentos de Computação Concorrente, Paralela e Distribuída (FCCPD)

## Descrição geral

O sistema é composto por um API Gateway, que atua como único ponto de entrada, e por três microsserviços independentes, responsáveis, respectivamente, pelo gerenciamento de usuários, de produtos e de pedidos. Cada serviço é executado como um processo separado, em sua própria porta, e mantém sua própria base de dados em arquivo JSON, de modo que não há compartilhamento de estado em memória entre eles. A comunicação ocorre exclusivamente por meio de requisições HTTP/REST.

Além das funcionalidades básicas, o projeto contempla três mecanismos centrais de sistemas distribuídos:

- **Replicação de dados:** o serviço de Produtos mantém duas instâncias (primário e réplica). As escritas são propagadas de forma síncrona para a réplica e as leituras são distribuídas entre as duas instâncias por meio de *round-robin*.
- **Tolerância a falhas:** o Gateway verifica periodicamente a disponibilidade de cada serviço por *heartbeat*, registra os eventos de falha e de recuperação em log e responde com o código `503` quando um serviço indisponível é requisitado.
- **Segurança:** a autenticação é realizada por tokens JWT assinados, contendo o papel do usuário (`admin` ou `user`), e as senhas são armazenadas com *hash* gerado pelo algoritmo bcrypt.

## Arquitetura

```
                  Cliente (curl / Postman / script de demonstração)
                                  |
                      +-----------------------+
                      |   API Gateway  :8080   |   entrada única, heartbeat e dashboard
                      +--+---------+--------+--+
                         |         |        |
              +----------v-+  +----v-----+  +v----------+
              |  Usuários  |  | Produtos |  |  Pedidos  |
              |   :5001    |  |  :5002   |  |   :5003   |
              +------------+  +----+-----+  +-----------+
                                   |  replicação síncrona
                              +----v-----+
                              |  Réplica |
                              |  :5012   |
                              +----------+
```

Cada componente é um processo independente, com base de dados própria.

## Tecnologias utilizadas

| Categoria | Ferramenta |
|---|---|
| Ambiente de execução | Node.js (versão 18 ou superior) |
| Framework HTTP | Express |
| Autenticação | JSON Web Token (jsonwebtoken) |
| Hash de senhas | bcryptjs |
| Execução simultânea dos serviços | concurrently |
| Conteinerização (opcional) | Docker Compose |
| Comunicação cifrada (opcional) | TLS com certificado autoassinado |

## Pré-requisitos

- Node.js, versão 18 ou superior. O desenvolvimento e os testes foram realizados na versão 22.
- Docker é necessário apenas para a execução via Docker Compose, que é opcional.

## Instruções de execução

Na pasta do projeto, instale as dependências e inicie os serviços:

```bash
npm install
npm start
```

O comando `npm start` inicia, de forma simultânea, os cinco processos do sistema: serviço de Usuários, primário e réplica de Produtos, serviço de Pedidos e API Gateway. Após a inicialização, o painel de monitoramento fica disponível em `http://localhost:8080`.

Para executar a demonstração completa do fluxo do sistema, abra um segundo terminal e execute:

```bash
npm run demo
```

As instruções detalhadas — incluindo a execução por meio do Docker Compose, a ativação do TLS e os procedimentos para simulação de falhas — encontram-se no arquivo [README_execucao.md](README_execucao.md).

## Credenciais de acesso pré-cadastradas

| E-mail | Senha | Papel |
|---|---|---|
| `admin@shop.com` | `admin123` | Administrador |
| `ester@shop.com` | `ester123` | Usuário comum |

## Endpoints

Todas as requisições são realizadas por meio do Gateway, no endereço `http://localhost:8080`. Os endpoints marcados com asterisco (*) exigem token JWT no cabeçalho `Authorization: Bearer <token>`.

### Serviço de Usuários

| Método | Rota | Descrição |
|---|---|---|
| POST | `/users/register` | Cadastra um novo usuário |
| POST | `/users/login` | Autentica o usuário e retorna um token JWT |
| GET | `/users/:id` | Retorna os dados de um usuário (*) |

### Serviço de Produtos

| Método | Rota | Descrição |
|---|---|---|
| GET | `/products` | Lista todos os produtos |
| GET | `/products/:id` | Detalha um produto específico |
| POST | `/products` | Cadastra um produto (* — restrito a administradores) |

### Serviço de Pedidos

| Método | Rota | Descrição |
|---|---|---|
| POST | `/orders` | Cria um pedido, vinculando usuário e produto (*) |
| GET | `/orders/:userId` | Lista os pedidos de um usuário (*) |

### Monitoramento

| Método | Rota | Descrição |
|---|---|---|
| GET | `/status` | Apresenta a situação atual de todos os serviços |
| GET | `/health` | Verificação de saúde, disponível em cada serviço |

## Estrutura de diretórios

```
entrega/
├── gateway/             API Gateway: roteamento, heartbeat e dashboard
├── users/              Serviço de Usuários (porta 5001)
├── products/           Serviço de Produtos: primário (5002) e réplica (5012)
├── orders/             Serviço de Pedidos (porta 5003)
├── scripts/            Scripts de demonstração, geração de certificados e do relatório
├── docker-compose.yml  Definição da infraestrutura para execução via Docker
├── README_execucao.md  Instruções detalhadas de execução
├── TESTES.md           Registro dos testes realizados
└── relatorio.pdf       Relatório técnico do projeto
```

## Mecanismos implementados

### Consistência na replicação

Foi adotada a replicação no modelo primário-réplica com escrita síncrona. Enquanto as duas instâncias estão disponíveis, o sistema apresenta consistência forte, uma vez que toda escrita é confirmada apenas após ser propagada à réplica. Caso a réplica esteja indisponível no momento da escrita, o primário aceita a operação e a marca como pendente, sincronizando a réplica posteriormente; nesse intervalo, a consistência passa a ser eventual. A justificativa para essa decisão de projeto está detalhada no relatório.

### Tolerância a falhas

O Gateway envia, em intervalos regulares, requisições ao endpoint `/health` de cada serviço. Quando um serviço deixa de responder, a falha é registrada em log com data e hora, e as requisições direcionadas a esse serviço passam a receber o código `503`. Quando o serviço volta a responder, a recuperação também é registrada. No caso da réplica de Produtos, a sincronização dos dados perdidos ocorre de forma automática após o seu retorno.

### Segurança

A autenticação é realizada por meio de tokens JWT assinados com uma chave secreta, contendo o identificador do usuário, o e-mail, o papel e a data de expiração. As rotas protegidas validam a assinatura do token antes de processar a requisição: requisições sem token recebem o código `401` e requisições sem a permissão necessária recebem o código `403`. As senhas são armazenadas exclusivamente em forma de *hash* (bcrypt). A comunicação interna de replicação é protegida por uma chave compartilhada entre os serviços.

## Testes

Os testes realizados — abrangendo a replicação de dados, a queda e a recuperação de serviços e a validação dos mecanismos de segurança — estão documentados, com as respectivas saídas, no arquivo [TESTES.md](TESTES.md).

## Relatório

A análise técnica completa do projeto, incluindo a discussão das decisões de projeto, dos *trade-offs* e das limitações da implementação, está disponível no arquivo [relatorio.pdf](relatorio.pdf).
