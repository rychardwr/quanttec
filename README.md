# Quanttec

Plataforma de atendimento por **chat web**, com central de tickets própria.

O cliente abre o chat no navegador (pensado para celular) e escolhe a área e a cidade. Depois, preenche os dados cadastrais (nome, telefone, CPF, RG), aceita o aviso de privacidade e conversa com um atendente humano. O atendente responde e conclui o atendimento pelo painel.

| Departamento | Cidades |
|---|---|
| Financeiro | Itararé, Sengés, Taquarituba |
| Medicina | Itararé, Sengés |
| Segurança | Itararé, Taquarituba |

O piloto começa com **Financeiro + Itararé**, ligado pela flag `SERVICE_SCOPE`.

> O primeiro canal planejado era o WhatsApp, e a versão com webhook da Meta está na tag [`canal-whatsapp`](../../tree/canal-whatsapp). O chat web veio primeiro porque não há número de WhatsApp para testar agora. Ver [docs/decisoes.md](docs/decisoes.md).

## Status

Em desenvolvimento. Nada foi publicado no Azure ainda.

| Item | Estado |
|---|---|
| API do chat do cliente (opções, abrir atendimento, mensagens) | ✅ |
| Chat do cliente (React, responsivo) | ✅ |
| Roteamento departamento × cidade e flag de piloto | ✅ |
| Mascaramento de CPF no texto; criptografia de CPF e RG (AES-256-GCM) | ✅ |
| Schema do banco e ferramenta de migrations | ✅ escritos, ainda não aplicados num banco real |
| Repositório Azure SQL | ✅ escrito; testes de contrato prontos, aguardando banco |
| Painel do atendente (login Entra ID, responder, concluir) | ⏳ próximo |
| Infraestrutura (Bicep) e CI/CD | ⏳ |

## Arquitetura

```
Cliente (navegador) ──► Front-end React (Static Web Apps Free)
                              │  polling a cada 4 s
                              ▼
                    API /api/v1/chat/...  (Azure Functions, Node + TypeScript)
                              │
                              ▼
                    Azure SQL (clientes, sessões, tickets, mensagens)
                              ▲
Atendente ──► Painel (login Entra ID) ──► API /api/v1/... (próxima etapa)
```

- **Back-end:** monólito modular em controller → service → repository. A composição fica em `api/src/shared/container.ts`.
- **Banco:** Azure SQL serverless no tier gratuito. Para rodar localmente sem banco, existe um repositório em memória (`DATA_STORE=memory`), recusado dentro do Azure.
- **Sessão do cliente:**
  - token aleatório de 256 bits, válido por 30 dias;
  - o navegador guarda o token e o servidor guarda só o hash SHA-256;
  - o cliente volta à conversa pelo mesmo navegador.

## Estrutura

```
api/                      Azure Functions
  src/functions/          Registro dos endpoints (só ligação com o runtime)
  src/modules/
    chat/                 Chat do cliente: controller, service, repositórios (SQL e memória)
    routing/              Catálogo, roteamento e flag de piloto
    access/               RBAC de tickets (atendente x master)
    privacy/              Mascaramento e criptografia de dados pessoais
  src/shared/             Configuração, composição e migrations
  src/tools/migrate.ts    Aplica as migrations
  db/migrations/          Migrations SQL versionadas
  test/                   Testes (Vitest)
web/                      Front-end React + Vite
  src/chat/               Telas do chat do cliente
  src/ui/                 Componentes do design system
  src/api/                Cliente da API
docs/                     Decisões de arquitetura
```

## Rodar localmente

Requisitos: Node 22+ e [Azure Functions Core Tools 4](https://learn.microsoft.com/azure/azure-functions/functions-run-local).

```sh
npm install
cp api/local.settings.example.json api/local.settings.json   # gerar as duas chaves (comando abaixo)
npm test                         # testes da API e do front-end
npm start --workspace api        # API em http://localhost:7071 (DATA_STORE=memory)
npm run dev --workspace web      # chat em http://localhost:5173
```

Para gerar uma chave: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

Para usar um SQL Server real, defina `DATA_STORE=sql` e `SQL_CONNECTION_STRING` e rode `npm run migrate --workspace api`. Os testes de contrato do repositório também rodam contra o SQL quando `TEST_SQL_CONNECTION_STRING` aponta para um banco migrado (nunca o de produção).

### Endpoints (v1)

Todos com o prefixo `/api`. O cliente se identifica com `Authorization: Bearer <sessionToken>`.

| Método | Rota | Descrição | Respostas |
|---|---|---|---|
| GET | `/v1/health` | Health check | 200 |
| GET | `/v1/chat/options` | Áreas e cidades do piloto, e o aviso de privacidade vigente | 200 |
| POST | `/v1/chat/conversations` | Abre o atendimento com o formulário. Devolve `sessionToken`, `ticketId` e `ticketNumber` | 201, 400 (campos inválidos), 422 (opção indisponível) |
| GET | `/v1/chat/tickets/{ticketId}/messages?after={seq}` | Mensagens depois do cursor, e o status do ticket | 200, 401, 404 |
| POST | `/v1/chat/tickets/{ticketId}/messages` | Envia `{ clientMessageId, text }`. Idempotente por `clientMessageId` | 201, 400, 401, 404, 409 (encerrado) |

Os erros de validação devolvem só os nomes dos campos (`{ "error": "invalid_request", "fields": ["cpf"] }`), nunca os valores.

### Variáveis de ambiente (API)

| Nome | Descrição |
|---|---|
| `SERVICE_SCOPE` | `*` libera todo o catálogo; `FINANCEIRO:ITARARE[,DEP:CIDADE...]` restringe ao piloto |
| `DATA_STORE` | `sql` ou `memory` (só local; recusado no Azure) |
| `SQL_CONNECTION_STRING` | Obrigatória com `DATA_STORE=sql`. Em produção, vem do Key Vault |
| `FIELD_ENCRYPTION_KEY` | Chave AES-256 (32 bytes em base64) para CPF e RG. Em produção, vem do Key Vault |
| `FIELD_HASH_KEY` | Chave HMAC (32 bytes em base64) para buscar CPF sem guardá-lo em claro. Deve ser diferente da anterior |

Nenhuma variável tem valor padrão. Se faltar alguma, a função falha ao iniciar.

Front-end: `VITE_API_BASE_URL` (ver `web/.env.example`).

## Segurança e LGPD

- **Consentimento:** obrigatório para abrir o atendimento. Fica registrado com data e versão do aviso, e o servidor recusa uma versão diferente da vigente.
- **CPF e RG:** criptografados na aplicação, com a chave no Key Vault. O CPF digitado no texto é mascarado antes de ser gravado.
- **Isolamento entre clientes:** o cliente só acessa os próprios tickets. Um ticket de outra pessoa responde 404, sem revelar que existe.
- **Atendentes:** o controle de acesso fica no back-end; o atendente vê só o próprio departamento e o master vê tudo.
- **Banco:** consultas sempre parametrizadas.
- **Logs:** os dados pessoais nunca vão para os logs.
- **Pendente:** rate limiting e captcha no chat público, antes de abrir para o público. Ver [docs/decisoes.md](docs/decisoes.md).
