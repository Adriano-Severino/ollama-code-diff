# Guia de Uso Completo - Ollama Code Diff v2.1 🚀

Bem-vindo à nova versão do **Ollama Code Diff**! Esta extensão transforma seu VS Code em um ambiente de desenvolvimento assistido por IA totalmente local, privado e poderoso.

## 🛠️ Configuração Inicial

1. **Instale o Ollama**: Certifique-se de ter o [Ollama](https://ollama.com/) rodando.
2. **Baixe os Modelos Recomendados**:
   - Para Chat/Agente: `ollama pull qwen2.5-coder:7b` (ou `deepseek-r1`)
   - Para Autocompletar (rápido): `ollama pull qwen2.5-coder:1.5b-base`
   - Para RAG (embeddings): `ollama pull nomic-embed-text`
3. **Configuração no VS Code**:
   - Vá em `Settings` > `Ollama Code Diff`.
   - Selecione os modelos baixados para cada função.

---

## ✨ Funcionalidades Principais

### 1. 👻 Ghost Text (Autocompletar Inteligente Multi-Modelo)
Enquanto você digita, a IA sugere continuações de código em tempo real (estilo Copilot/Cursor) com preenchimento contextual Fill-In-The-Middle (FIM).
- **Aceitar**: Pressione `Tab`.
- **Rejeitar**: Continue digitando ou pressione `Esc`.
- **Modelos compatíveis**: Qwen 2.5 Coder, DeepSeek Coder, CodeLlama, StarCoder e CodeGemma.
- **Debounce configurável**: Ajuste `ollama-code-diff.completionDebounceMs` no settings (padrão: 350ms).

### 2. 💬 Chat Assistente & Modos de Operação
Abra a barra lateral do Ollama para conversar sobre seu código.
- Use o menu dropdown para alternar entre os modos:
  - **Mode: Chat**: Conversa padrão, tira dúvidas, explica código e gera snippets.
  - **Mode: Plan**: Atua como Arquiteto de Software, estruturando objetivos, análise de impacto e checklist técnico ordenado.
  - **Mode: Edit**: Aplicação direta de patches com preview unificado de diff.
  - **Mode: Agent**: Agente autônomo capaz de encadear ferramentas para resolver problemas ponta a ponta.

### 3. ⚡ Ações Rápidas em Blocos de Código (Chat)
Cada bloco de código gerado no chat possui uma barra superior com botões de ação instantânea:
- **📋 Copiar**: Copia o snippet limpo para a área de transferência.
- **📥 Inserir**: Insere o trecho exatamente na posição atual do cursor no editor ativo.
- **⚡ Aplicar**: Abre o diff manager para revisar e aplicar as alterações no arquivo aberto.

### 4. 🧠 RAG Concorrente (Busca Semântica)
Permita que a IA “leia” todo o seu projeto de forma inteligente e rápida:
- **Indexação Concorrente**: Indexação paralela (pool de 4 workers) acelerando projetos médios e grandes.
- **Chunking Semântico**: Suporte estruturado para **TypeScript/JavaScript** (classes/interfaces/funções), **Python** (`def`/`class`/decorators) e **Markdown** (seções e headings).
- **Busca Semântica**: Use `Ollama: Semantic Search` ou deixe o **Agente** invocar `searchsemantic` automaticamente.

### 5. 🤖 Agente Autônomo com Novas Ferramentas Git
No **Mode: Agent**, a IA executa tarefas complexas com o loop Thought-Plan-Action:
- **Ferramentas de Arquivo**: `read`, `write`, `listfiles`, `findfile`, `filetree`, `openfile`, `savefile`, `closefile`.
- **Ferramentas Git**: `gitstatus` (ver status da branch e arquivos modificados) e `gitdiff` (inspecionar diff staged ou unstaged).
- **Ferramentas Semânticas & LSP**: `searchsemantic`, `searchtext`, `lsprename`, `lsporganizeimports`, `lspcodeactions`, `lspquickfix`.
- **Terminal com Confirmação**: `run` executa comandos com verificação modal de segurança.

### 6. 📌 Gerenciamento de Contexto
Controle exatamente o que a IA vê:
- **@menção**: Digite `@` no chat para selecionar e incluir um arquivo específico na conversa.
- **Pinned Files**: Clique no botão **📌** para fixar arquivos cruciais (`types.ts`, `.env.example`, etc).
- **Seleção de Código**: O código selecionado no editor é enviado automaticamente como contexto adicional.

### 7. ⚡ Slash Commands
Comandos rápidos para agilizar tarefas comuns:
- `/explain`: Explica a lógica do trecho ativo.
- `/fix`: Encontra e sugere correções para bugs.
- `/test`: Gera testes unitários automatizados.
- `/refactor`: Sugere melhorias de arquitetura, clareza e performance.

---

## 💡 Dicas Pro
- **Contexto é rei**: Use `@` e **Pin** para dar contexto relevante. Modelos pequenos funcionam muito melhor quando sabem exatamente onde olhar.
- **RAG local**: Mantenha seu índice atualizado se fizer grandes mudanças no projeto (`Ollama: Index Codebase`).
- **Modelo separado**: Use um modelo pequeno (1.5b ou 3b) para o Ghost Text (latência ultrabaixa) e um modelo maior (7b ou 14b) para o Chat/Agente (melhor qualidade).

---

## 🗺️ Roadmap de Evolução (paridade com “Copilot Codex”)

Objetivo: elevar robustez, edição avançada e automação com ferramentas para alcançar paridade funcional com experiências do tipo Copilot/Codex.

### Fase 1 — Robustez e Qualidade (próximas semanas)
-✅ Indexação RAG incremental: atualizar apenas arquivos alterados, respeitar `.gitignore` e oferecer status/percentual.
-✅ Diagnóstico e observabilidade: canal de Output, logs detalhados opcionais e relatório de falhas com contexto mínimo.
-✅ Cancelamento e timeouts: abortar prompts longos, liberar recursos e evitar travamento da UI.
-✅ Cache inteligente: reutilizar embeddings e respostas parciais para reduzir latência.
-✅ Validação de configuração: checar modelos indisponíveis e sugerir correções no Settings.
-✅ Testes automatizados: unidade (helpers), integração (extensão VS Code), e2e (fluxos básicos).

### Fase 2 — Edição Avançada com Ferramentas
-✅ Edição multi-arquivo com **preview de diff** e “apply/undo” seguro.
- ✅ Operações semânticas via LSP: rename, organize imports, code actions e quick-fixes (comandos e ferramentas do Agent).
- ✅ Modo “Edit”: instruções em linguagem natural que geram patches aplicáveis.
- ✅ Ações com terminal: executar comandos com confirmação, capturar saída e anexar ao contexto.
- ✅ Leitura inteligente: chunking de arquivos grandes e limites de tokens por contexto.

### Fase 3 — Fluxos de Paridade Copilot/Codex
- “Agentic edits”: planejamento + execução + verificação (plan/act/verify).
- Revisão de código automática (PR review local) com checklists de segurança e qualidade.
- Geração de testes com feedback: criar, rodar, ajustar e explicar falhas.
- “Inline chat” no editor: conversas ancoradas no bloco de código.
- Sugestões contextuais avançadas: histórico de arquivos recentes e padrões do projeto.

### Fase 4 — Segurança, Privacidade e Confiabilidade
- Permissões por ferramenta (read/write/run) com confirmações configuráveis.
- Workspace Trust: restringir execução de comandos em repositórios não confiáveis.
- Modo offline estrito e controle de retenção de dados.
- Telemetria opcional e transparente (desligada por padrão).

### Fase 5 — Ecossistema e Extensibilidade
- Suporte a múltiplos backends locais (Ollama, LM Studio, etc.).
- “Skills/Plugins” para fluxos específicos (tests, refactor, docs, release).
- Templates de prompt por linguagem/framework e presets por workspace.

---

## 📊 Métricas de Paridade (KPIs)

Objetivo: medir, de forma objetiva, a evolução rumo à paridade funcional com Copilot/Codex.

- **Latência do Ghost Text (P50/P95)**: tempo até a primeira sugestão aparecer.
- **Latência do Chat/Agent (P50/P95)**: tempo até a primeira resposta útil.
- **Taxa de Aceitação de Sugestões**: % de Ghost Text aceito pelo usuário.
- **Precisão de RAG (Top-K)**: % de respostas que citam arquivos corretos do workspace.
- **Taxa de Sucesso de Edição**: % de edições aplicadas sem erro ou rollback.
- **Cobertura de Fluxos**: % dos fluxos principais com testes e2e (indexar, buscar, editar, aplicar diff).
- **Erros por Sessão**: falhas do backend (modelo indisponível, timeout, parsing).
- **Uso de Ferramentas (Agent)**: taxa de ações com `read/write/run` concluídas sem intervenção manual.

---

## 🧾 Backlog de Issues (proposta)

Formato sugerido: `Título — Prioridade — Labels`

1. **Indexação incremental com `.gitignore`** — P0 — `rag`, `indexing`, `performance`
2. **Progresso visual e cancelamento de indexação** — P0 — `ux`, `indexing`
3. **Canal de Output com logs estruturados** — P1 — `observability`, `dx`
4. **Timeouts e cancelamento de prompts longos** — P0 — `stability`, `agent`
5. **Cache de embeddings e respostas parciais** — P1 — `performance`, `rag`
6. **Validação de modelos configurados** — P0 — `settings`, `guardrails`
7. **Preview de diff + apply/undo seguro** — P0 — `editor`, `diff`
8. **Modo Edit (NL → patch aplicável)** — P0 — `editor`, `agent`
9. **Integração LSP (rename/imports/code actions)** — P1 — `lsp`, `refactor`
10. **Ações com terminal com confirmação** — P1 — `tools`, `agent`
11. **Chunking inteligente e limites por contexto** — P1 — `context`, `rag`
12. **Plan/Act/Verify no Agent** — P1 — `agent`, `reliability`
13. **Geração e execução de testes com feedback** — P1 — `testing`, `agent`
14. **Inline chat ancorado no editor** — P2 — `ux`, `editor`
15. **Workspace Trust para execução de comandos** — P0 — `security`
16. **Modo offline estrito + retenção de dados** — P1 — `privacy`
17. **Telemetria opcional e transparente** — P2 — `privacy`, `observability`
18. **Suporte a backends locais adicionais** — P2 — `providers`
19. **Skills/Plugins para fluxos específicos** — P2 — `extensibility`
20. **Presets por linguagem/framework** — P2 — `prompts`, `ux`

---

Aproveite seu par programador local! 🖥️🤖
