# Quanttec

Plataforma de atendimento **WhatsApp + IA** com central de tickets própria.

O cliente manda mensagem no WhatsApp. A IA identifica o departamento e a cidade e coleta os dados cadastrais (nome, telefone, CPF, RG). Um atendente humano confirma e conclui o atendimento pela plataforma. **A IA nunca executa a ação final.**

| Departamento | Cidades |
|---|---|
| Financeiro | Itararé, Sengés, Taquarituba |
| Medicina | Itararé, Sengés |
| Segurança | Itararé, Taquarituba |

O piloto começa com **Financeiro + Itararé**, ligado pela flag `SERVICE_SCOPE`.

## Status

Em desenvolvimento, fase de fundação. Nada foi publicado no Azure ainda.

| Item | Estado |
|---|---|
| Webhook da Meta (verificação, assinatura, enfileiramento) | ✅ |
| Regra de roteamento departamento × cidade e flag de piloto | ✅ |
| Visibilidade de tickets por perfil (atendente / master) | ✅ |
| Mascaramento de CPF no texto das mensagens | ✅ |
| Schema do banco (migrations) | ✅ escrito, ainda não aplicado |
| Consumidor da fila e criação de ticket | ⏳ próximo |
| Integração com IA (Azure AI Foundry) | ⏳ |
| Autenticação dos atendentes | ⏳ decisão em aberto |
| Front-end (Azure Static Web Apps) | ⏳ |
| Infraestrutura e CI/CD | ⏳ |

## Arquitetura

```
WhatsApp ──► Meta Cloud API ──► POST /api/v1/whatsapp/webhook
                                   │  valida X-Hub-Signature-256
                                   ▼
                          Azure Queue Storage (whatsapp-inbound)
                                   │  dead-letter: whatsapp-inbound-poison
                                   ▼
                          Consumidor (Functions) ──► IA (Azure AI Foundry)
                                   │
                                   ▼
                          Azure SQL (tickets, mensagens, clientes)
                                   ▲
Atendente ──► Front-end (Static Web Apps) ──► API /api/v1/...
```

- **Back-end:** Azure Functions v4 (Node + TypeScript), em monólito modular com controller → service → repository.
- **Banco:** Azure SQL Database serverless, tier gratuito, que pausa ao atingir o limite.
- **IA:** modelo "mini" no Azure AI Foundry, chamado só pelo back-end.
- **Segredos:** Azure Key Vault. **Observabilidade:** Application Insights.

As decisões e as questões em aberto estão em [docs/decisoes.md](docs/decisoes.md).

## Estrutura

```
api/                    Azure Functions
  src/functions/        Registro dos endpoints (só ligação com o runtime)
  src/modules/          Módulos por assunto
    whatsapp/           Webhook da Meta
    routing/            Roteamento e flag de piloto
    access/             RBAC de tickets
    privacy/            Mascaramento de dados pessoais
  src/shared/           Configuração
  db/migrations/        Migrations SQL versionadas
  test/                 Testes (Vitest)
docs/                   Decisões de arquitetura
```

## Rodar localmente

Requisitos:
- Node 22+
- [Azure Functions Core Tools 4](https://learn.microsoft.com/azure/azure-functions/functions-run-local)
- [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite), o emulador do Storage usado pela fila

```sh
npm install
cp api/local.settings.example.json api/local.settings.json   # preencher os valores
npm test                       # testes
npm run typecheck              # checagem de tipos
npm start --workspace api      # build + func start
```

### Endpoints

Todos com o prefixo `/api`.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/v1/health` | Health check |
| GET | `/v1/whatsapp/webhook` | Handshake de verificação da Meta |
| POST | `/v1/whatsapp/webhook` | Notificações da Meta. Exige `X-Hub-Signature-256` válida; sem ela, responde 401 |

### Variáveis de ambiente

| Nome | Descrição |
|---|---|
| `AzureWebJobsStorage` | Storage da fila `whatsapp-inbound` |
| `META_APP_SECRET` | App secret da Meta, que valida a assinatura do webhook. Em produção, vem do Key Vault |
| `META_VERIFY_TOKEN` | Token definido ao cadastrar o webhook na Meta |
| `SERVICE_SCOPE` | `*` libera todo o catálogo; `FINANCEIRO:ITARARE[,DEP:CIDADE...]` restringe ao piloto |

Nenhuma variável tem valor padrão. Se faltar alguma, a função falha ao iniciar.

## Segurança e LGPD

- Todo webhook passa pela verificação de assinatura antes de qualquer processamento.
- A idempotência vem do índice único em `messages.wa_message_id`, porque a Meta reenvia notificações.
- O controle de acesso é aplicado no back-end: o atendente vê só o próprio departamento e o master vê tudo.
- CPF e RG do cadastro são criptografados na aplicação (AES-256-GCM, com a chave no Key Vault).
- O CPF digitado no texto é mascarado antes de ser gravado e antes de ir para a IA.
- O conteúdo das mensagens e os dados pessoais nunca vão para os logs.
- Fora da janela de 24h, o envio usa só modelos de mensagem pré-aprovados.
