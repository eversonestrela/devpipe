# DevPipe — Esteira Inteligente de Desenvolvimento com IA

Aplicação local que transforma uma fila de chamados em uma **esteira de desenvolvimento executada por IA** (inicialmente o Claude), com interface no estilo painel de missões, rastreabilidade completa e supervisão humana.

```
Backlog → Análise → Planejamento → Preparação → Desenvolvimento → Validação → Revisão → Concluído
                                                                    ↘ Bloqueado     ↘ Devolvido p/ ajustes
```

- **Executável único** (Go), sem instalador, sem banco externo, sem dependências em tempo de execução além do `git` e da CLI do agente.
- **Interface web local** embutida no executável, aberta automaticamente no navegador em `http://localhost:7420`.
- **Cada demanda trabalha em uma `git worktree` isolada**, numa branch própria criada a partir da branch base escolhida. O seu checkout e suas alterações não commitadas nunca são tocados.
- **Nada destrutivo é automático**: nunca há merge, push, reset, rebase, clean ou descarte. Commits ficam apenas na branch de trabalho local da demanda.

---

## 1. Requisitos

| Item | Observação |
|---|---|
| Windows 10 1809+, macOS 13+ ou Linux | |
| Git | No `PATH` |
| Claude Code (CLI) | Provedor de IA inicial. Veja a seção 3 |
| Git for Windows (só Windows) | Recomendado: permite que o agente rode os comandos de build/teste liberados |
| Go 1.24+ | **Somente** para compilar a partir do código-fonte |

## 2. Instalar e executar

### Usando o executável pronto

1. Copie `devpipe-windows-amd64.exe` (ou o binário do seu sistema, em `dist/`) para uma pasta, por exemplo `C:\Ferramentas\DevPipe\`.
2. Execute-o. O navegador abre em `http://localhost:7420`.
3. Os dados ficam em `%AppData%\DevPipe` (Windows), `~/Library/Application Support/DevPipe` (macOS) ou `~/.config/DevPipe` (Linux).

Opções de linha de comando:

```
devpipe.exe -port 7420            # porta local (só escuta em 127.0.0.1)
devpipe.exe -data D:\DevPipeDados # pasta de dados alternativa
devpipe.exe -no-browser           # não abrir o navegador
devpipe.exe -version
```

### Compilando a partir do código

As dependências estão em `vendor/`, então a compilação funciona **sem internet**.

```powershell
# Windows
.\build.ps1            # gera dist\devpipe.exe
```
```bash
# Linux/macOS (gera binários para Windows, Linux e macOS)
./build.sh
```

Ou manualmente: `go build -mod=vendor -trimpath -ldflags "-s -w" -o devpipe.exe ./cmd/devpipe`

Executar os testes: `go test -mod=vendor ./...`

## 3. Configurar o Claude

O DevPipe executa o **Claude Code CLI** em modo não interativo (`claude -p --output-format stream-json`) dentro da worktree da demanda. É o Claude Code que lê, edita e valida o código; o DevPipe controla permissões, diretório, tempo limite, cancelamento e registra tudo.

1. **Instale o Claude Code** (instalador nativo recomendado):
   - PowerShell: `irm https://claude.ai/install.ps1 | iex`
   - macOS/Linux: `curl -fsSL https://claude.ai/install.sh | bash`
   - Alternativas: `winget install Anthropic.ClaudeCode` ou `npm install -g @anthropic-ai/claude-code`
2. **Autentique**: abra um terminal, rode `claude` e faça login pelo navegador. É necessária uma conta **Pro, Max, Team, Enterprise ou Console** — o plano gratuito do claude.ai não inclui o Claude Code. Alternativamente, defina `ANTHROPIC_API_KEY` (cobrança por tokens no Console).
3. No DevPipe, abra **Provedores de IA** e clique em **Testar conexão** (faz uma chamada real mínima e mostra o custo informado).
4. Se o `claude` não estiver no `PATH`, informe o caminho completo (ex.: `C:\Users\voce\.local\bin\claude.exe`).

**Somente assinatura Pro (padrão: ligado)** — em *Provedores de IA*, a opção "Usar somente o limite da assinatura Pro/Max" garante que a esteira não gere cobrança fora do plano:
- remove do processo do Claude as variáveis que direcionariam para cobrança por API (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, Bedrock/Vertex/Foundry);
- confere a fonte de autenticação informada pela CLI a cada chamada e **interrompe** a execução se não for o login da assinatura;
- **interrompe** se a conta começar a usar "uso extra" pago;
- quando o limite do plano acaba, **pausa a fila** e retoma sozinha no horário de liberação (ou pelo botão "Retomar agora" na Central).

A Central mostra o consumo do plano (janela de 5 h e semanal). O valor em US$ exibido nas execuções é o **equivalente em API, apenas informativo** — não é cobrado na assinatura. Cada demanda faz ao menos duas chamadas (análise e desenvolvimento) e, se a validação falhar, até N correções (configurável); para poupar o limite, mantenha 1 demanda em paralelo e 1–2 tentativas de correção. Documentação oficial: <https://code.claude.com/docs/en/setup>.

**Outros agentes** — o provedor **CLI genérico** executa qualquer agente de linha de comando (prompt via stdin, variáveis `DEVPIPE_PHASE` e `DEVPIPE_WORKDIR`). Novos provedores nativos são adicionados implementando a interface em `internal/provider/provider.go`.

## 4. Primeiros passos

1. **Configuração e segurança** → informe os **diretórios autorizados** (ex.: `C:\repos`). Projetos fora deles são recusados.
2. **Projetos** → cadastre o caminho do repositório e clique em *Validar e detectar* (linguagem, solução principal, branches, arquivos de padrões). Configure:
   - comando de **build** e de **testes** (validação oficial executada pela aplicação);
   - **comandos que a IA pode executar** (prefixos, ex.: `dotnet build`, `dotnet test`);
   - **atalhos de branch base** (ex.: `release, main, main_versao, stage`) — configuráveis por projeto;
   - arquivos de padrões do repositório e regras adicionais.
3. **Padrões e regras** → cadastre regras globais e por projeto (texto, Markdown ou arquivo importado).
4. **Nova demanda** → ticket, título, prioridade, requisitos, branch base e anexos (PDF, DOCX, DOC, TXT, MD, imagens — inclusive prints colados com Ctrl+V). Clique em **Criar e colocar na fila**.
5. Acompanhe na **Esteira** e no **Monitor**. Na **Revisão**, inspecione o diff e escolha **Aprovar e concluir** ou **Devolver para ajustes** (com novas instruções e anexos).
6. Para integrar o resultado, faça o merge da branch `devpipe/...` pelo seu fluxo normal (o DevPipe nunca faz merge/push).

## 4.1 Codificação de arquivos (ANSI / Windows-1252)

As ferramentas de edição dos agentes de IA trabalham em UTF-8. Em projetos ANSI (Windows-1252), editar um arquivo diretamente faria todos os acentos virarem `�` (no editor aparece `permissï¿½es`). Isso **não** é resolvido por regras ou instruções ao modelo — a esteira resolve de forma determinística:

1. Antes de cada edição da IA, os arquivos Windows-1252 da worktree são convertidos **sem perdas** para UTF-8.
2. Depois, cada arquivo alterado volta à codificação original (Windows-1252, UTF-8 ou UTF-8 com BOM), preservando CRLF.
3. Caracteres `�` introduzidos são recuperados pelo vocabulário da versão original do arquivo; o que não puder ser recuperado com certeza, ou caracteres inexistentes em Windows-1252 (ex.: `→`, emojis), **reprovam a validação** e a IA é chamada para corrigir.
4. Arquivos novos seguem a opção *Codificação dos arquivos* do projeto (padrão: a predominante do repositório).

**Branches corrompidas por versões anteriores:** abra a demanda → aba *Alterações (diff)* → **Reparar acentuação / codificação**. O reparo também é aplicado automaticamente ao Retomar ou Devolver para ajustes.

## 4.2 Fazenda da Esteira (painel de TV)

Menu **Fazenda (TV)** (ou `/fazenda.html`): painel animado em pixel art que mostra a esteira como uma fazenda, em que cada demanda é uma plantação, o Claude e você são os fazendeiros e o clima indica a saúde da esteira. `?demo=1` mostra dados fictícios para apresentação. Detalhes em `docs/FAZENDA.md`.

## 4.3 Avisos quando uma demanda precisa de você

Você não precisa ficar olhando a esteira. Quando uma demanda **chega na Revisão**, **pede aprovação da especificação** ou **bloqueia/falha**, o DevPipe avisa:

- **Notificação do Windows** (quando a aba do DevPipe está em segundo plano). Clicar nela abre a demanda. Revisões somem sozinhas; aprovações e bloqueios ficam até você clicar.
- **Som curto** (dois tons subindo para revisão/aprovação, descendo para bloqueio).
- **Contador** no título da aba — `(3) DevPipe` — e no ícone da aba.

No rodapé do menu lateral: **🔔 Ativar avisos do Windows** (na primeira vez o navegador pede permissão), **🔊/🔇** liga e desliga o som, e a linha logo abaixo mostra quantas demandas esperam você. As preferências ficam no navegador. Para receber os avisos, deixe a aba do DevPipe aberta (pode ficar minimizada ou atrás de outras janelas).

Se aparecer "Só na tela (Windows bloqueado)", o navegador bloqueou as notificações do site: libere pelo cadeado na barra de endereço → Notificações → Permitir.

## 5. Projeto de demonstração

`demo/loja-demo` é um projeto JavaScript sem dependências (usa só o Node, que qualquer instalação do Claude Code via npm já tem; com o instalador nativo, instale o Node 18+ para rodar os testes do demo). `demo/demanda-exemplo/CH-1001-cupom-desconto.docx` é a especificação de uma demanda real.

```powershell
.\demo\preparar-demo.ps1 C:\repos       # cria C:\repos\loja-demo com git e branches main/release/stage
```
```bash
./demo/preparar-demo.sh ~/repos
```

Depois, no DevPipe:

1. Autorize `C:\repos` em Configuração e segurança.
2. Cadastre o projeto `C:\repos\loja-demo` com build `node --check src/pedido.js`, testes `node --test`, comandos liberados `node --test` e `node --check`, e arquivo de padrões `docs/padroes.md`.
3. Crie a demanda **CH-1001**, branch base `release`, anexe o `.docx` e coloque na fila.
4. Na revisão, devolva para ajustes pedindo, por exemplo: *"o cupom passa a ter um campo codigo obrigatório e o retorno deve incluir cupomAplicado"*.

Este roteiro foi executado de ponta a ponta com o Claude real durante o desenvolvimento: ciclo original ≈ 2 min (validação OK, commit local) e ciclo de ajuste ≈ 70 s, reaproveitando a mesma branch.

## 6. Estrutura do código

```
cmd/devpipe/            ponto de entrada (servidor local, abertura do navegador)
internal/domain/        tipos e etapas da esteira
internal/store/         SQLite (driver puro-Go, sem CGO) + migrações
internal/pipeline/      orquestrador: fila, locks por repositório, etapas, validação, revisões, recuperação
internal/provider/      abstração de agentes de IA: Claude Code CLI e CLI genérico
internal/gitx/          Git: validação, branches, worktrees isoladas, diff, commit local
internal/docs/          extração de PDF/DOCX/DOC/TXT/MD e classificação de imagens
internal/encx/          proteção de codificação (Windows-1252 ⇄ UTF-8, BOM, CRLF, reparo de '�')
internal/rules/         composição das regras com precedência e hash de versão
internal/security/      diretórios autorizados, redação de segredos, classificação de comandos
internal/fazenda/       regras e métricas do painel Fazenda da Esteira
internal/web/           API REST, SSE (tempo real) e interface embutida (static/, inclui Phaser 3)
demo/                   projeto e demanda de demonstração
docs/ARQUITETURA.md     decisões técnicas, arquitetura, modelo de dados e segurança
```

## 7. Limitações conhecidas (v0.1)

- Extração de PDF usa `pdftotext` (Poppler) se estiver no PATH; sem ele, o próprio Claude lê o PDF original. `.doc` legado requer `antiword`/`catdoc` ou conversão para `.docx`.
- O provedor CLI genérico não permite à aplicação impor permissões por ferramenta; o isolamento vem da worktree e da revisão humana.
- A remoção de worktrees/branches de demandas concluídas é manual (por segurança, nada é apagado automaticamente).
- Uma demanda por repositório executa por vez (mesmo com paralelismo maior configurado).
- Não há autenticação de usuários: a aplicação é monousuário e escuta apenas em `127.0.0.1`.
