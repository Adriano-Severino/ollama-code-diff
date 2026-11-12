# Backlog — Ollama Code Diff

Lista priorizada de evolução do projeto, baseada no Roadmap do README e em gaps encontrados no código.

## Em andamento

_(nenhuma)_

## Próximos

- [ ] **Regenerar última resposta** — botão ↻ na última mensagem do assistente para reenviar a mesma pergunta.
- [ ] **Modelo por modo** — settings `modelChat`/`modelAgent`/`modelEdit`/`modelPlan` para usar modelos diferentes conforme o modo.
- [ ] **Som na notificação de conclusão** — opção para tocar um beep/som do sistema junto à notificação.

## Concluídos

- [x] **Histórico de sessões** — `HistoryManager` com `globalState`, overlay de histórico no chat com carregar/excluir sessões.
- [x] **Histórico persistente robusto** — título da sessão agora é gerado a partir da primeira mensagem, sessão é salva ao fechar o painel, timestamps das mensagens são preservados e a data aparece no histórico.
- [x] **Templates de prompts customizáveis** — setting `ollama-code-diff.promptTemplates` permite criar slash commands próprios com variáveis `{input}`, `{selection}`, `{file}` e `{language}`.
- [x] **Métricas de uso e performance** — cada requisição ao Ollama registra modelo, tokens e duração; exibido no Output Channel, num item da Status Bar e no comando `Ollama: Mostrar Metricas de Uso` (setting `enableUsageMetrics` para desativar).
- [x] **Exportar análises em HTML** — botão ⤓ no chat e comando `Ollama: Exportar Chat como HTML` geram arquivo HTML standalone com markdown renderizado (imprimível para PDF).
- [x] **Análise de commits Git** — comandos `Ollama: Analisar Commit Git` (ref arbitrária via `git show`) e `Ollama: Analisar Commits Recentes` (`git log -n`), ambos com instrução customizável e resultado em Markdown lateral; também no menu Ollama.
- [x] **Suporte a mais linguagens no RAG** — chunking semântico para brace languages (Java, C#, C/C++, Go, Rust, Swift, Kotlin, Scala, PHP, Ruby), CSS/SCSS/Less, HTML/XML/SVG/Vue e JSON (por chave de topo); índice passa a cobrir `.md`, `.scss`, `.vue`, `.kt`, etc.
- [x] **Ferramentas Git no modo Agent** — novas tools `gitlog` (histórico recente), `gitshow` (commit com stat+patch, ref e path opcionais) e `gitblame` (autoria por linha/faixa), reutilizando `utils/git.ts` com sanitização de refs e paths.
- [x] **Métricas de uso persistentes** — `UsageTracker` é restaurado do `globalState` na ativação (últimas 500 requisições) e persistido a cada nova métrica; Status Bar mostra a última métrica mesmo após reiniciar o VS Code.
- [x] **Cobertura de testes de integração** — novo suite `gitIntegration.test.ts` (6 testes: git real, detecção de repo, sanitização de refs) e lista de comandos esperados atualizada com todos os comandos novos.
- [x] **Config de templates via UI** — botão 🧩 no chat abre overlay para criar/editar/excluir `promptTemplates` (salvo em `ConfigurationTarget.Global`, com as mesmas variáveis do settings.json).
- [x] **Autocomplete de slash commands** — digitar `/` no início da mensagem sugere comandos built-in e templates customizados com hints, navegável por teclado/mouse.
- [x] **Métricas de uso por modo** — `RequestUsage` ganhou campo `mode` (chat/agent/edit/plan); resumo do `UsageTracker` agora quebra tokens e tempo por modo, com registros antigos agrupados em "outros".
- [x] **Exportar sessão do histórico** — cada item do overlay de histórico ganhou botão ⤓ que exporta aquela sessão como HTML (mesmo fluxo da sessão atual).
- [x] **Exportação durante geração** — `inProgressResponse` acompanha o stream (chat/plan); exportar no meio de uma resposta inclui o texto parcial marcado como "geração em andamento".
- [x] **Busca no histórico de chats** — campo de busca no overlay de histórico filtra sessões por título ou conteúdo das mensagens (case-insensitive, em tempo real).
- [x] **Diff visual entre sessões** — botão ⇄ no histórico abre seletor de duas sessões; overlay mostra diff linha a linha (verde/vermelho) calculado com a lib `diff`, com contagem de linhas adicionadas/removidas.
- [x] **Notificações de conclusão** — ao terminar chat/agent/edit/plan com o painel oculto, mostra notificação do VS Code com ação "Ver chat" (foca a view); controlado pela setting `ollama-code-diff.notifyOnCompletion`.
