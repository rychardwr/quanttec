# Decisões de arquitetura

## Tomadas

1. **TypeScript no back-end e no front-end.** Usa uma só linguagem e um só toolchain, e o Azure Functions tem suporte de primeira linha para Node. O ambiente já tem Node e Core Tools, e não tem .NET.
2. **Monólito modular em Functions.** Os módulos ficam em `api/src/modules`. Em `src/functions` fica só o registro dos endpoints.
3. **O webhook só valida e enfileira.** O POST verifica a `X-Hub-Signature-256` sobre os bytes crus, grava o payload na fila `whatsapp-inbound` e responde 200. O consumidor da fila faz o resto. Depois de 5 falhas (`host.json`), a mensagem vai para `whatsapp-inbound-poison` (dead-letter).
4. **Idempotência pelo banco.** `messages.wa_message_id` tem índice único. Uma notificação reenviada falha no insert e é tratada como já processada, sem precisar de tabela extra.
5. **O catálogo departamento × cidade fica no banco** (`department_cities`), e a constraint de FK impede ticket com par inválido. A regra de roteamento (`decideRouting`) recebe o catálogo como entrada.
6. **Flag do piloto via variável `SERVICE_SCOPE`.** A ordem de checagem é: dados incompletos → par não atendido → fora do piloto → roteado.
7. **Perfis guardados em coluna (`attendants.role`)**, não em tabela de permissões. Hoje só existem ATTENDANT e MASTER. Uma tabela só entra se aparecer permissão granular de verdade.
8. **CPF e RG são criptografados na aplicação** com AES-256-GCM e chave no Key Vault. A busca por CPF usa um HMAC (`cpf_hash`), nunca o valor em claro. Isso soma à TDE que o Azure SQL já aplica.
9. **Tickets sem classificação** (`department_id` nulo, quando a IA falha) ficam visíveis só para o MASTER, que faz a triagem.
10. **CPF mascarado no texto das mensagens** (`redactCpf`). O texto é mascarado antes de ser gravado e antes de ir para a IA. Os CPFs válidos encontrados vão, criptografados, para `customers`.
    - Um CPF com pontuação é sempre mascarado.
    - Uma sequência de 11 dígitos sem pontuação só é mascarada se os dígitos verificadores forem válidos. Assim, números de telefone continuam legíveis.
11. **IA no Azure AI Foundry**, com um modelo "mini". O modelo exato será escolhido quando a conta for criada, conforme a disponibilidade na região.
12. **Piloto: FINANCEIRO:ITARARE.**
13. **Autenticação: opção (A), de custo zero.** O front-end fica na SWA Free e serve só as telas. O login usa Microsoft Entra ID via OIDC: o SPA autentica com MSAL e a Function App valida o JWT. Todo o back-end fica numa única Function App (Consumption).
    - O Entra ID só autentica. Quem é atendente, o perfil e o departamento ficam na tabela `attendants`, ligados pelo `identity_provider_id`.
    - Um login válido no Entra que não esteja cadastrado ou ativo em `attendants` não tem acesso a nada.
    - Pode haver uma conta por pessoa (recomendado, por rastreabilidade e LGPD) ou uma conta compartilhada por departamento. O modelo atende os dois casos sem mudar código.
    - Os usuários são criados no tenant da Quanttec, que só existirá junto com a conta Azure própria do projeto.

## Em aberto

- **Retenção (LGPD):** os dados continuam guardados depois do atendimento. O prazo e o expurgo dependem da área de negócio.
- **Contas dos atendentes:** uma por pessoa ou uma por departamento. A recomendação é uma por pessoa.
- **RG no texto das mensagens:** o formato varia por estado e ainda não é mascarado.
- **Migrations:** escolher a ferramenta que vai aplicá-las (script próprio ou ferramenta pronta). Decidir quando houver banco.
