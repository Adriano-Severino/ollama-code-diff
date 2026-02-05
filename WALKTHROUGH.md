# Guia de Uso Completo - Ollama Code Diff v2.0 🚀

Bem-vindo à nova versão do **Ollama Code Diff**! Esta extensão transforma seu VS Code em um ambiente de desenvolvimento assistido por IA totalmente local, privado e poderoso.

## 🛠️ Configuração Inicial

1.  **Instale o Ollama**: Certifique-se de ter o [Ollama](https://ollama.com/) rodando.
2.  **Baixe os Modelos Recomendados**:
    *   Para Chat/Agente: `ollama pull qwen2.5-coder:7b` (ou `deepseek-r1`)
    *   Para Autocompletar (Rápido): `ollama pull qwen2.5-coder:1.5b-base`
    *   Para RAG (Embeddings): `ollama pull nomic-embed-text`
3.  **Configuração no VS Code**:
    *   Vá em `Settings` > `Ollama Code Diff`.
    *   Selecione os modelos baixados para cada função.

---

## ✨ Funcionalidades Principais

### 1. 👻 Ghost Text (Autocompletar Inteligente)
Enquanto você digita, a IA sugere continuações de código em cinza (estilo Copilot).
*   **Aceitar**: Pressione `Tab`.
*   **Rejeitar**: Continue digitando ou pressione `Esc`.

### 2. 💬 Chat Assistente
Abra a barra lateral do Ollama para conversar sobre seu código.
*   Use o menu dropdown para alternar entre:
    *   **Mode: Chat**: Conversa padrão, tira dúvidas e gera snippets.
    *   **Mode: Agent**: Agente autônomo capaz de usar ferramentas (criar arquivos, rodar comandos, etc).

### 3. 🧠 RAG (Busca Semântica)
Permita que a IA "leia" todo o seu projeto.
*   **Indexar Projeto**: Execute o comando `Ollama: Index Codebase` (Ctrl+Shift+P). Isso cria um índice local do seu código.
*   **Busca**: Use o comando `Ollama: Semantic Search` ou pergunte ao **Agente** (ele usará a ferramenta automaticamente).

### 4. 🔗 Gerenciamento de Contexto (Novo na v2.0)
Controle exatamente o que a IA vê:
*   **@menção**: Digite `@` no chat para selecionar e incluir um arquivo específico na conversa.
*   **📌 Pinned Files**:
    *   Clique no botão **📌** na barra de input.
    *   Selecione arquivos críticos (ex: `types.ts`, `app.config`).
    *   Esses arquivos ficarão "fixados" e serão lidos em **todas** as mensagens.
*   **Seleção de Código**: O texto selecionado no editor é enviado automaticamente como contexto.

### 5. ⚡ Slash Commands
Comandos rápidos para agilizar tarefas comuns:
*   `/explain`: Explica o código selecionado ou o arquivo aberto.
*   `/fix`: Analisa e propõe correções para bugs.
*   `/test`: Gera testes unitários para a função selecionada.
*   `/refactor`: Sugere melhorias de código e performance.

### 6. 🤖 Agente Autônomo
No **Mode: Agent**, a IA pode executar tarefas complexas em múltiplos passos:
*   *"Crie um componente React de botão e seu arquivo CSS, depois crie um teste para ele."*
*   O agente pode: `read`, `write`, `list_files`, `run_command`, `search_semantic`, etc.

---

## 💡 Dicas Pro
*   **Contexto é Rei**: Use `@` e **Pin** para dar contexto relevante. Modelos pequenos funcionam muito melhor quando sabem exatamente onde olhar.
*   **RAG Local**: Mantenha seu índice atualizado se fizer grandes mudanças no projeto (`Ollama: Index Codebase`).
*   **Modelo Separado**: Use um modelo pequeno (1.5b ou 3b) para o Ghost Text para ter latência ultrabaixa, e um modelo maior (7b ou 14b) para o Chat/Agente para maior inteligência.

Aproveite seu par programador local! 🖥️🤖
