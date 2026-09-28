# Projeto: App de Acesso Remoto (estilo AnyDesk)

## Contexto
Estou construindo do zero um app de acesso remoto para aprender e ter uma ferramenta própria.
Não tenho pressa: prefiro entender cada parte a avançar rápido.

## Como trabalhar comigo
- Responda e comente o código em português.
- Antes de implementar uma etapa, explique em poucas linhas o que vai fazer e por quê.
- Implemente uma etapa por vez e teste antes de seguir. Não pule etapas.
- Ao terminar uma etapa, faça um commit com mensagem clara e marque [x] no roteiro abaixo.
- Se uma decisão tiver alternativas relevantes, apresente as opções e deixe eu escolher.
- Verifique se as bibliotecas citadas aqui ainda são mantidas antes de usá-las.

## Stack
- **App desktop:** Electron + TypeScript
- **Vídeo e dados:** WebRTC (RTCPeerConnection + DataChannel)
- **Controle de mouse/teclado:** `@jitsi/robotjs` (escolhido na 2.2: ativo e com binários N-API
  prontos, que funcionam no Electron sem compilar; o `@nut-tree-fork/nut-js` estava parado desde 03/2025)
- **Servidor de sinalização:** Node.js + TypeScript + `ws` (WebSocket), deploy no Render
- **Redes difíceis (fase 5):** servidor TURN (coturn ou serviço gerenciado)
- **Monorepo:** npm workspaces (`shared`, `server`, `app`); TypeScript 7 só para checar tipos
- **Build do app:** electron-vite 5 (Vite fixado na v7, exigência do electron-vite)
- **Servidor em dev:** tsx (roda o TypeScript direto, com recarga)
- **Validação de mensagens:** Zod 4, esquemas em `shared/src/mensagens.ts` (geram os tipos)
- **Testes:** `node:test` + tsx, arquivos `*.test.ts` ao lado do código
- **Interface:** HTML/TypeScript puro, sem framework. Cada tela em `renderer/telas/` expõe
  `montar...()` (liga eventos uma vez) e `atualizar(estado)` (redesenha a partir do estado)

## Comandos
- `npm run dev` — servidor + app juntos (ou `dev:server` / `dev:app` separados)
- `npm run typecheck` — checagem de tipos de todos os pacotes
- `npm test` — testes automáticos (servidor e renderer do app)
- `npm run build` — build do app (saída em `app/out/`)
- Configuração pública do app em `app/.env` (ex.: `RENDERER_VITE_SERVIDOR_URL`);
  segredos/ajustes pessoais em `*.local` (fora do git)
- O pacote `shared` é TypeScript puro (sem build): o electron-vite o inclui no bundle
  e o tsx o executa direto.

## Estrutura de pastas
```
/server    servidor de sinalização (IDs, conexão entre pares)
/app       app Electron
  /main      processo principal (janelas, IPC, controle de input)
  /preload   ponte segura entre main e renderer
  /renderer  interface (tela inicial, visualização remota)
/shared    tipos e formato das mensagens usados pelos dois lados
```

## Arquitetura
1. Ao abrir, o app conecta no servidor via WSS e recebe um ID de 9 dígitos.
2. Quem quer acessar (visualizador) digita o ID do outro (anfitrião).
3. O servidor avisa o anfitrião, que vê o popup Aceitar/Recusar.
4. Aceito, os dois trocam oferta/resposta WebRTC e candidatos ICE pelo servidor.
5. A partir daí a conexão é direta: o anfitrião envia a tela como trilha de vídeo;
   o visualizador envia eventos de mouse/teclado pelo DataChannel.
6. O servidor NUNCA recebe vídeo nem comandos, só as mensagens de sinalização.

### Eventos de input
- Coordenadas do mouse enviadas normalizadas (0 a 1), convertidas para pixels no anfitrião.
- Mensagens em JSON com tipo definido em /shared (ex.: mousemove, mousedown, keydown).
- O renderer do anfitrião repassa os eventos ao processo main via IPC; só o main executa input.

## Regras de segurança (não negociáveis)
- Nenhuma sessão começa sem aceite explícito no anfitrião ou senha válida (fase 3).
- Comunicação com o servidor só por WSS (TLS) em produção.
- Electron: `contextIsolation: true`, `nodeIntegration: false`, preload expondo só o necessário.
- Validar e limitar todo evento recebido pelo DataChannel antes de executar.
- Senha de acesso não supervisionado guardada apenas como hash (argon2 ou bcrypt), nunca em texto.
- Limite de tentativas de conexão por ID no servidor, para evitar força bruta.
- Indicador visível no anfitrião sempre que houver sessão ativa, com botão de encerrar.

## Roteiro

### Fase 1 — Ver a tela
- [x] 1.1 Estrutura do monorepo, TypeScript, scripts de dev
- [x] 1.2 Servidor de sinalização: registrar cliente e atribuir ID de 9 dígitos
- [x] 1.3 App mostra o próprio ID e campo para conectar em outro ID
- [x] 1.4 Troca de oferta/resposta/ICE via servidor
- [x] 1.5 Anfitrião captura a tela e o visualizador exibe
- **Pronto quando:** duas instâncias (mesma máquina ou rede) se veem. ✅ concluída em 27/09/2026

### Fase 2 — Controlar
- [x] 2.1 Popup Aceitar/Recusar no anfitrião (janela vem para frente, contagem regressiva, som)
- [x] 2.2 DataChannel com eventos de mouse (mover, clicar, rolar)
- [x] 2.3 Teclado, incluindo atalhos (Ctrl, Alt, Shift) e caracteres com acento
- [ ] 2.4 Encerrar sessão pelos dois lados; indicador de sessão ativa
- [ ] 2.5 Deploy do servidor no Render e teste entre duas redes diferentes
- **Pronto quando:** consigo usar outro computador de verdade, pela internet.

### Fase 3 — Acesso não supervisionado
- [ ] 3.1 Definir senha no anfitrião (hash local)
- [ ] 3.2 Conectar com senha sem precisar de aceite
- [ ] 3.3 Iniciar com o sistema e ficar na bandeja
- [ ] 3.4 Limite de tentativas no servidor

### Fase 4 — Recursos de produtividade
- [ ] 4.1 Área de transferência compartilhada
- [ ] 4.2 Transferência de arquivos pelo DataChannel (com progresso)
- [ ] 4.3 Chat simples durante a sessão

### Fase 5 — Robustez
- [ ] 5.1 Múltiplos monitores (escolher qual ver)
- [ ] 5.2 Qualidade adaptativa à conexão
- [ ] 5.3 Servidor TURN para redes corporativas
- [ ] 5.4 Instaladores para Windows e macOS

## Observações por sistema
- **macOS:** exige permissões de Gravação de Tela e Acessibilidade; orientar o usuário na primeira execução.
- **Windows:** sem rodar como serviço, não é possível controlar janelas de administrador (UAC). Tratar na fase 5.
- **Render (plano gratuito):** o servidor "dorme" sem uso; a primeira conexão pode demorar alguns segundos.

## Estado atual
Fase 1 concluída (etapas 1.1 a 1.5). Fase 2 em andamento: 2.1 a 2.3 concluídas. Próxima: 2.4
(encerrar pelos dois lados e indicador de sessão ativa).

Decisões já tomadas:
- ID temporário: sorteado pelo servidor a cada conexão, guardado só em memória.
  ID fixo por instalação (com segredo de posse + banco) fica para a fase 3.
- Protocolo: app manda `registrar {versao}` → servidor responde `registrado {id}` ou `erro {codigo}`.
  Servidor desconecta quem não se registra em 10 s e usa ping/pong a cada 30 s.
- A conexão com o servidor fica no renderer (`renderer/sinalizacao.ts`), junto do WebRTC;
  reconecta sozinha (esperas de 1, 2, 5 e 10 s) e recebe ID novo a cada reconexão.
- Aceite do anfitrião implementado já na 1.4 (caixa <dialog>, foco inicial em Recusar,
  Esc = recusar), para cumprir a regra de segurança desde a primeira conexão.
- Sessões no servidor (`server/src/sessoes.ts`): conectar → pedido_conexao → responder_pedido
  → sessao_iniciada (para os dois). Só depois disso o servidor repassa `sinal` entre o par;
  pedido expira em 30 s; um pedido/sessão por vez de cada lado; queda avisa o parceiro.
- Pedido de acesso (2.1): `pedido_conexao` traz `prazoMs` (protocolo v2); o servidor é a única
  fonte do prazo, o app só mostra a contagem (`expiraEm` no estado). Ao chegar um pedido, o
  renderer chama `window.api.chamarAtencao()` (IPC `janela:chamar-atencao`, só aceito do quadro
  principal das nossas janelas, ver `main/quadros.ts`): o main restaura, mostra, foca e, se o
  Windows barrar o foco, pisca na barra de tarefas. Som: "ding-dong" por Web Audio
  (`renderer/alerta.ts`), sem arquivo.
- Mouse (2.2): aceitar o pedido libera ver E controlar (a caixa de aceite diz isso). Fluxo:
  `renderer/controle.ts` (visualizador; coordenadas 0–1 sobre a área real da imagem, descontando
  as faixas do object-fit; mover/rolar agrupados por requestAnimationFrame; botão leva a posição
  junto) → canal (`mouse_mover`, `mouse_botao`, `mouse_rolar` em `shared/src/canal.ts`) →
  ControladorSessao (só o anfitrião repassa, só da conexão atual) → IPC `input:executar` →
  `main/input.ts` valida de novo (Zod) → `main/executor-input.ts` (pixels, limite de 200
  eventos/s por balde de fichas, botões apertados) → robotjs. Fim da sessão, janela fechada ou
  renderer travado soltam os botões (`input:liberar`); o visualizador solta ao perder o foco.
- Pixels: usa `robot.getScreenSize()` (mesmo sistema de coordenadas do `moveMouse`), não o
  `screen` do Electron (que usa DIP). `robot.setMouseDelay(0)`: o padrão (10 ms) trava o main.
- Rolagem em pixels do navegador (dy > 0 = descer); `rolagemParaSistema` converte (Windows:
  100 px = 120 unidades da roda; macOS: pixels; Linux: cliques).
- Teclado (2.3), modelo híbrido: texto vai como caractere pronto (`texto`, composto no
  visualizador: tecla morta + a = á; independe do layout do anfitrião; `robot.unicodeTap` por
  unidade UTF-16) e teclas especiais/atalhos como teclas (`tecla`, nomes do robotjs em
  `TECLAS_NOMEADAS` ou um caractere ASCII para atalhos; `robot.keyToggle`).
- Modificadores ficam pendentes no visualizador (`renderer/teclado.ts`, TradutorTeclado) e só
  vão ao anfitrião antes de tecla/atalho, clique ou rolagem; tocado sozinho vai como toque. Isso
  evita que o AltGr do ABNT2 (Chromium: Ctrl+Alt) vire atalho no anfitrião.
- Caractere de atalho: letra pelo layout (`key`), número pela tecla física (`code`).
- Captura de teclado só com a tela remota à vista (`definirAtivo`); preventDefault em tudo.
  Menu padrão do Electron removido (`Menu.setApplicationMenu(null)`): Ctrl+W/Ctrl+R/Alt
  agiam no app. Win+tecla, Alt+Tab e Ctrl+Alt+Del não são capturáveis (o sistema age antes).
- WebRTC (`renderer/par.ts`): o anfitrião cria a oferta e o DataChannel "controle"; trickle
  ICE com fila de candidatos que chegam antes da descrição remota. Ping/pong pelo canal mede
  a latência. Mensagens do canal validadas com Zod (`shared/src/canal.ts`), máx. 16 KB.
- Sem STUN/TURN ainda (`iceServers: []`): funciona na mesma máquina/rede. Decidir STUN na 2.5.
- Captura (1.5): o renderer chama `getDisplayMedia`; o main (`main/captura.ts`) autoriza só
  pedidos do quadro principal das nossas janelas e entrega o monitor principal. Até 30 fps,
  `contentHint = 'detail'` (prioriza nitidez). A trilha é adicionada antes da oferta.
- Ao encerrar a sessão (qualquer motivo) as trilhas da captura recebem `stop()`; se a sessão
  acabar enquanto a captura ainda está sendo obtida, ela é parada assim que chega.
- `encerrar` aceita `motivo` (`captura_indisponivel` | `falha_conexao`), repassado ao parceiro.
- Visualizador: `renderer/telas/visualizacao.ts` troca a janela para o vídeo remoto
  (`body[data-tela='remota']`), com `object-fit: contain`.
- Se a conexão com o servidor cai, a sessão é encerrada (mesmo que o P2P ainda funcione).
- `renderer/sessao.ts` (ControladorSessao) é a máquina de estados da sessão; recebe a
  conexão WebRTC por injeção (`criarPar`) para ser testada no Node com um par falso.

Notas para as próximas etapas:
- robotjs: o npm desta máquina bloqueia scripts de instalação (`install: node-gyp-build`); não
  faz falta porque o binário win32-x64 vem pronto. Na 5.4 (instalador) o `.node` precisa ficar
  fora do asar (`asarUnpack`).
- robotjs guarda o tamanho da área de trabalho virtual na 1ª chamada e não atualiza: se os
  monitores mudarem com o app aberto, as coordenadas ficam erradas. Tratar na 5.1.
- Mouse ainda não testado com escala do Windows ≠ 100% nem no macOS (esta máquina: 1366x768, 100%).
- Teclado: AltGr e teclas mortas reais só testados em unidade (o CDP não simula AltGraph);
  conferir à mão com teclado ABNT2. IME (japonês/chinês) ignorado. `unicodeTap` gera VK_PACKET:
  alguns jogos que leem a tecla física não veem letras digitadas (modo "tecla física" com
  koffi + SendInput seria a alternativa, se precisar).
- Um "enviar Ctrl+Alt+Del" exige serviço do Windows (SAS); fica para a fase 5.
- Teste E2E do teclado: criar um textarea de teste na janela do anfitrião, focá-lo com clique
  remoto e só então digitar (as teclas vão para onde estiver o foco real do Windows).
- Teste E2E do mouse: anfitrião e visualizador na mesma máquina movem o mouse real; posicionar
  as janelas lado a lado (user32 `SetWindowPos`) e clicar só em área vazia da janela do anfitrião.
- Endurecimento pendente do Electron: `setPermissionRequestHandler`/`setPermissionCheckHandler`
  negando tudo que o app não usa (hoje o Electron concede permissões por padrão).
- Se o usuário parar a captura pelo sistema operacional, a trilha termina ("ended") mas a
  sessão continua sem imagem; tratar quando houver como testar (ex.: macOS).
- macOS ainda não testado: exige permissão de Gravação de Tela para `getDisplayMedia`.
- Se a rede cair "em silêncio", o app só percebe quando o TCP expirar (o navegador não expõe
  ping/pong). Se incomodar, criar um ping no nível da aplicação.
- Ao testar o app pelo Claude Code: a variável `ELECTRON_RUN_AS_NODE=1` (herdada do VS Code)
  precisa ser removida, e processos Electron em segundo plano morrem quando outra tarefa
  de fundo termina, então orquestrar servidor + app num único script.
- Teste com duas instâncias: `npm run build -w @acesso-remoto/app` e abrir
  `node_modules/electron/dist/electron.exe .` (em app/) duas vezes, cada uma com
  `--user-data-dir` próprio e `--remote-debugging-port` para conduzir pelo DevTools Protocol.
  O Electron não implementa o domínio `Browser` do CDP (minimizar/estado da janela): usar a
  user32 (`ShowWindow`, `IsIconic`) via `powershell -EncodedCommand` com o PID do processo.
