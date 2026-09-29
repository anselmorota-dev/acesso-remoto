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
- **Chamadas nativas do sistema:** `koffi` (4.2: contador da área de transferência do Windows)
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
- `npm run preview` — build de produção e abre o app usando o servidor do Render
- Configuração pública do app em `app/.env` (desenvolvimento: `ws://localhost:8080`) e
  `app/.env.production` (produção: `wss://` do Render); segredos/ajustes pessoais em
  `*.local` (fora do git)
- Repositório: https://github.com/anselmorota-dev/acesso-remoto (privado, branch `main`);
  cada push na `main` refaz o deploy do servidor no Render.
- Servidor publicado: https://acesso-remoto-sinalizacao.onrender.com (`/saude` → ok)
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
- [x] 2.4 Encerrar sessão pelos dois lados; indicador de sessão ativa
- [ ] 2.5 Deploy do servidor no Render e teste entre duas redes diferentes
- **Pronto quando:** consigo usar outro computador de verdade, pela internet.

### Fase 3 — Acesso não supervisionado
- [x] 3.1 Definir senha no anfitrião (hash local)
- [x] 3.2 ID fixo por instalação (o servidor lembra cada instalação; exige armazenamento persistente)
- [x] 3.3 Conectar com senha sem precisar de aceite
- [x] 3.4 Iniciar com o sistema e ficar na bandeja
- [x] 3.5 Limite de tentativas no servidor
- **Pronto:** ✅ fase 3 concluída em 28/09/2026

### Fase 4 — Recursos de produtividade
- [x] 4.1 Sessões longas: sem limite de tempo, sobrevivem a quedas do servidor e da rede
- [x] 4.2 Área de transferência compartilhada
- [x] 4.3 Transferência de arquivos pelo DataChannel (com progresso)
- [x] 4.4 Chat simples durante a sessão
- **Pronto:** ✅ fase 4 concluída em 28/09/2026

### Fase 5 — Robustez
- [x] 5.1 Múltiplos monitores (escolher qual ver)
- [x] 5.2 Qualidade adaptativa à conexão
- [ ] 5.3 Servidor TURN para redes corporativas
- [ ] 5.4 Instaladores para Windows e macOS

## Observações por sistema
- **macOS:** exige permissões de Gravação de Tela e Acessibilidade; orientar o usuário na primeira execução.
- **Windows:** sem rodar como serviço, não é possível controlar janelas de administrador (UAC). Tratar na fase 5.
- **Render (plano gratuito):** o servidor "dorme" sem uso; a primeira conexão pode demorar alguns segundos.

## Estado atual
Fase 1 concluída. Fase 2: 2.1 a 2.4 concluídas; 2.5 publicada e testada na mesma máquina,
falta o teste entre duas redes (o usuário fará depois, com outro notebook). Fase 3 concluída
(28/09/2026). Fase 4 concluída (28/09/2026; servidor com protocolo v9): sessões longas,
área de transferência, arquivos e chat. Fase 5: 5.1 e 5.2 concluídas (29/09/2026; protocolo
v11). Próxima: 5.3 (servidor TURN). Pendente do usuário: teste real entre duas redes (2.5).

Decisões já tomadas:
- Qualidade do vídeo (5.2, protocolo v11; escolhas do usuário: automático + modos,
  automático por equilíbrio, AV1). Medido nesta máquina (i3-7020U, 1366x768, texto
  rolando; PSNR da imagem recebida contra o quadro original, número do quadro num
  "código de barras"): VP8 (o padrão do WebRTC) 33,6 dB sem limite → 22,9 dB e 8 fps a
  250 kbps; VP9 ~40 dB mas limitado pela CPU (10 fps, 40–47 ms/quadro); AV1 39,9 dB sem
  limite (metade da banda do VP8), 36,9 dB e 28 fps a 500 kbps, texto nítido a 250 kbps
  (16 fps), 22–28 ms/quadro; H.264 usa a placa (Quick Sync) mas ignora o limite de taxa
  e dá 23 dB. Reduzir a resolução à mão no modo tela quase não aumenta o fps (e borra o
  texto): descartado. `contentHint` decide: "detail" mantém a resolução e derruba o fps;
  "motion" mantém o fps e o WebRTC reduz a resolução sozinho (683x384 a 250 kbps).
  - Codec: o anfitrião põe AV1 na frente e VP8 de reserva (`setCodecPreferences` com
    `ordenarCodecs`, `renderer/qualidade.ts`).
  - Perfis: nitidez = `detail` + `maintain-resolution`; fluidez = `motion` +
    `maintain-framerate` (`PERFIS`). Aplicado na trilha atual e nas capturas novas
    (troca de monitor).
  - Modos (o visualizador escolhe; recomeça em Automático a cada sessão): Automático,
    Nitidez, Fluidez. Canal: `qualidade {modo}` (visualizador → anfitrião) e
    `qualidade_estado {modo, efetivo}` (anfitrião → visualizador), só com a sessão
    liberada e da conexão atual.
  - Automático (`AjusteAutomatico`, puro e testado): nitidez; passa para fluidez com
    movimento (≥ 3% da tela mudando por segundo) E fps enviado < 12 por 3 amostras
    seguidas; volta para nitidez com 3 amostras sem movimento. O movimento é medido pelo
    anfitrião (`renderer/movimento.ts`: quadro da captura reduzido a 64x36 em cinza,
    células com diferença > 10): a captura do Windows entrega ~20 quadros/s mesmo com a
    tela parada, então as estatísticas do `media-source` não servem para isso.
  - `ControleQualidade` (uma por sessão liberada, mede 1 vez/s; o anfitrião começa quando
    a tela começa a ir, o visualizador quando a sessão libera). Indicador no painel do
    visualizador (`telas/qualidade.ts`): "1366×768 · 29 fps · 615 kbps · AV1 ·
    automático: nitidez" + caixa "Qualidade" (perde o foco ao escolher: o teclado volta
    para o remoto).
  - Mensagens de estado (`monitores`, `qualidade`, `qualidade_estado`) esperam o canal
    abrir (`enviarEstado` no par, a última de cada tipo). Corrige um defeito da 5.1: no
    aceite comum a tela é capturada antes de a conexão direta abrir, e pela internet a
    lista de monitores podia se perder.
  - Não medido: CPU do AV1 em telas grandes (1920x1080 tem ~2x os pixels; com a CPU no
    limite o WebRTC derruba o fps); conferir no teste com o outro notebook.
- Múltiplos monitores (5.1, protocolo v10; escolhas do usuário: quem escolhe é o
  visualizador; teste com monitor físico). Canal "controle": `monitores {lista, atual}`
  (anfitrião → visualizador; lista da esquerda para a direita, `{id, largura, altura,
  principal}`, até 16) quando a imagem começa, a cada troca e quando os monitores mudam;
  `escolher_monitor {id}` (visualizador → anfitrião). Só com a sessão liberada, só da
  conexão atual; o anfitrião só aceita um id da lista que anunciou. Id = `display.id` do
  Electron em texto (é o mesmo `display_id` do desktopCapturer no Windows). Toda sessão
  começa pelo principal. Main: `main/monitores.ts` (lista em cache, refeita nos eventos
  `display-added|removed|metrics-changed`; IPC `monitores:listar|preparar` e aviso
  `monitores:mudou`) + `main/lista-monitores.ts` (puro, testado). A captura: o renderer
  chama `monitores.preparar(id)` e depois `getDisplayMedia`; o autorizador entrega esse
  monitor (id inválido ou sumido = principal) e anota o "mostrado". O mouse age só no
  monitor mostrado: `ExecutorInput` recebe `areaDoMonitor()` (coordenadas do robotjs:
  no Windows, `screen.dipToScreenRect` = pixels físicos da área de trabalho virtual, pode
  ser negativa). `robot.updateScreenMetrics()` a cada mudança de monitores. Troca: nova
  captura + `replaceTrack` (sem renegociar), a anterior só para depois; capturas em fila
  no par (o main entrega o último "preparado"); falha na troca mantém o monitor anterior
  e a sessão. Monitor mostrado desconectado → volta ao principal. Visualizador: botões
  "1, 2…" (`telas/monitores.ts`) no painel, só com 2+ monitores, o à vista com
  `aria-pressed`. Não há "todos os monitores juntos".
- Chat (4.4, protocolo v9): mensagem `chat {texto}` no canal "controle" (texto puro, sem
  espaços nas pontas, até 2000 caracteres; quebras de linha valem). Só com a sessão
  liberada. Conversa só em memória (`renderer/chat.ts`, ConversaChat: até 200 mensagens,
  contador de não lidas; recomeça a cada sessão; "total" + "geracao" dizem à tela o que é
  novo). Tela (`telas/chat.ts`): botão "Chat (n)" no painel da sessão, painel recolhível;
  Enter envia, Shift+Enter quebra a linha, Esc tira o foco do campo; mensagens por
  `textContent` (nunca HTML). Teclado: `controle.ts` NÃO captura teclas digitadas em campo
  de texto do app (`campoDeTexto`) e solta o que estava apertado no anfitrião ao entrar num
  campo. Aviso com a janela sem foco (escolha do usuário: notificação do Windows, sem roubar
  o foco): `main/chat.ts` usa o balão da bandeja (`notificarNaBandeja`; a Notification do
  Electron exige atalho no menu Iniciar, que só existe com o instalador), pisca na barra de
  tarefas, no máximo um aviso a cada 4 s; clicar abre a janela com o chat (`chat:abrir`).
- Arquivos (4.3, protocolo v8; escolhas do usuário: os dois lados enviam, recebidos vão para
  Downloads\Acesso Remoto sem perguntar). Segundo DataChannel "arquivos" (criado pelo
  anfitrião antes da oferta; o visualizador só aceita os rótulos "controle" e "arquivos"),
  para um arquivo grande nunca atrasar mouse/teclado. Protocolo em `shared/src/arquivos.ts`:
  `arquivo_inicio {id, nome, tamanho}` → pedaços binários de 64 KiB → `arquivo_fim` →
  `arquivo_recebido` | `arquivo_erro {motivo}`; `arquivo_cancelar` dos dois lados. Um
  arquivo por vez em cada sentido (fila). Só com a sessão liberada (o controlador entrega o
  canal, `aoMudarCanalArquivos`, e filtra as mensagens). `renderer/arquivos.ts`
  (GerenciadorArquivos, testado com dois lados ligados por um canal falso com velocidade
  simulada): fila do canal limitada a 1 MB (volta a encher em 256 KB) e o "fim" só vai
  quando a fila esvazia — até lá o Cancelar vale (antes, com 4 MB, um arquivo de 3 MB ia
  todo para a fila e o cancelamento chegava depois do arquivo completo). Quem recebe confere
  o tamanho (mais bytes que o anunciado, pedaço > 64 KiB ou "inicio" sem "fim" = abandona e
  avisa). Main: `recebimentos.ts` grava em `.<token>.parcial` e só renomeia quando chega
  inteiro (espera o arquivo FECHAR: o Windows não renomeia arquivo aberto); nunca
  sobrescreve ("foto (2).jpg"); `nome-arquivo.ts` limpa o nome (descarta caminhos,
  caracteres proibidos, nomes reservados CON/NUL/COM1..., pontos no fim, 150 caracteres).
  O renderer nunca escolhe pasta nem caminho; "Mostrar na pasta" usa o token (o caminho fica
  no main). Parciais apagados ao cancelar, ao fim da sessão e se a janela fechar/travar.
  Interface: botão "Enviar arquivos" no painel da sessão, arrastar e soltar na janela, lista
  com progresso/velocidade (itens atualizados no lugar, não recriados). Pastas: não (só
  arquivos, vários de uma vez). Sem hash: DTLS + SCTP confiável já garantem integridade.
- Velocidade (medida em 28/09/2026, nesta máquina: i3-7020U, 2 núcleos): DataChannel puro
  7–8 MB/s; o app com dois apps + vídeo na mesma máquina, ~4,5 MB/s. O gargalo é o SCTP do
  Chromium nesta CPU (fila de 4 MB não mudou o resultado no app).
- Área de transferência (4.2, protocolo v7): só texto (imagens podem vir com a 4.3),
  automática nos dois sentidos (escolhas do usuário). Só com a sessão liberada (aceite ou
  senha conferida), nos dois papéis. No início da sessão só o visualizador manda o que já
  estava copiado (o anfitrião, só o que copiar depois; senão um apagaria a cópia do outro).
  Mensagem `area_transferencia {texto}` no MESMO canal do teclado (chega antes do Ctrl+V
  seguinte); limite: a mensagem inteira ≤ 256 KiB em bytes (e ≤ `maxMessageSize` negociado;
  `serializarAreaTransferencia`), texto ≤ 200 mil caracteres; maior que isso não vai e o
  painel avisa (`telaSessao.avisar`). `TAMANHO_MAXIMO_MENSAGEM_CANAL` passou a 256 KiB.
  Canal ainda fechado: guarda o último texto e manda ao abrir. Main: `monitor-area.ts`
  (puro, testado) confere a cada 0,5 s; o clipboard do Electron 44 é ASSÍNCRONO
  (`readText`/`writeText` devolvem Promise), então leituras e escritas passam por uma fila
  (sem ela, uma conferência lia o texto recém-recebido e o devolvia: eco). Texto recebido é
  anotado como "já visto" (como o sistema o devolve). IPC `area:monitorar|copiado|escrever`
  (só a janela principal; desliga se ela fechar/travar/recarregar).
- Disputa pela área de transferência (Windows só deixa um programa abri-la por vez): ler a
  cada 0,5 s fazia outros programas falharem ao copiar (~2% sem novas tentativas, medido;
  0% sem o app). Correção (escolha do usuário): `GetClipboardSequenceNumber` (user32) via
  **koffi** (FFI, mantida, binários prontos; funciona sem o script de instalação) em
  `main/contador-area.ts`: o texto só é lido quando o contador muda. Sem contador (outros
  sistemas ou falha ao carregar), lê direto. Leitura que falha zera o contador anotado.
- Sessões longas (4.1, protocolo v6; objetivo do projeto: sessões de um dia inteiro). Não há
  limite de duração. Depois que a conexão direta funciona, a sessão não depende do servidor:
  - Servidor cai/reinicia (o Render gratuito "pode reiniciar a qualquer momento", e cada push
    refaz o deploy): a sessão continua. No servidor, quem perde o parceiro fica `retomando`
    (conta como ocupado; recebe `parceiro_ausente`); quem volta manda `retomar {parceiro,
    papel, porSenha}` logo após o `registrado`. Só religa (`sessao_retomada` aos dois) quando
    os DOIS declaram a mesma sessão (papéis opostos). Se o parceiro volta e não declara em 15 s
    (`prazoRetomadaMs`; ex.: app reaberto), a espera acaba (`sessao_encerrada
    {parceiro_desconectou}`); pedir `conectar` a quem ainda espera por você também a encerra.
    Substituição (mesma instalação reconectando) mantém a sessão retomável. Senha recusada
    com o visualizador fora do servidor ainda conta (`ipParceiro` guardado no `retomando`).
  - Sessão que ainda não conectou direto (negociando) acaba se o servidor cair.
  - Conexão direta cai depois de conectada: "reconectando" com prazo de 5 min (escolha do
    usuário; `prazoReconexaoMs`), depois encerra (`falha_conexao`). O anfitrião refaz com ICE
    restart (`par.reiniciarIce()`, nova oferta pelo servidor): na hora se "failed", e a cada
    10 s enquanto não voltar (só quando o servidor liga os dois; também logo após
    `sessao_retomada`). A primeira conexão que falha continua encerrando a sessão.
  - Durante a queda: o anfitrião solta botões/teclas (`aoLiberarInput`); o visualizador
    descarta input (não enfileira); painel com contagem e faixa sobre o vídeo.
  - Fim pela conexão direta também (`encerrar {motivo?}` no canal, antes de fechar; o par
    espera o aviso sair, até 1 s). Senha recusada NÃO vai pelo canal (só pelo servidor, que
    conta os erros; o visualizador não pode se adiantar). Canal fechado sem aviso: espera 2 s
    pelo motivo vindo do servidor, depois encerra por falha. Quem recebe o fim pelo canal
    manda `encerrar` ao servidor (limpa um `retomando`).
  - Candidato ICE inválido não derruba a sessão (pode chegar atrasado da rodada anterior);
    resposta atrasada é ignorada; erro de sinal após conectar só vai para o log.
  - Ping do app: `ping`/`pong` a cada 10 s; servidor calado por 25 s = conexão morta
    (reconecta sem esperar o "close"). Queda da conexão direta pede `verificarConexao()`
    (resposta em 5 s). O ping também mantém o Render acordado (a documentação confirma que
    mensagens WebSocket contam como tráfego).
  - Energia (`main/energia.ts`): em sessão (qualquer papel), `powerSaveBlocker`
    "prevent-display-sleep" (IPC `sessao:manter-acordado`, só da janela principal; desfeito
    se a janela fechar/travar/recarregar). Não impede suspender ao fechar a tampa (configurar
    no Windows: "ao fechar a tampa: não fazer nada").
  - Não resolvido (fase 5): tela de bloqueio do Windows (Win+L) não pode ser desbloqueada
    remotamente (exige serviço do Windows).
- ID fixo por instalação (3.2, protocolo v3): cada instalação tem um par Ed25519
  (`main/chaves-instalacao.ts`, `userData/identidade.json`, chave privada cifrada com
  `safeStorage`/DPAPI). Registro: `registrar {versao, chavePublica}` → `desafio {desafio}` →
  `provar {assinatura}` → `registrado {id}`. Assina-se `mensagemDeRegistro(desafio)` (prefixo
  fixo + desafio de 32 bytes aleatórios, uso único). A versão é checada antes da chave (app
  antigo recebe `versao_incompativel`). Mesma instalação conectando de novo substitui a antiga
  (`erro substituida`; o app para de reconectar, fase `substituida`). Banco fora do ar →
  `erro indisponivel` + fechamento 1011 (o app reconecta). Todos recebem ID fixo.
- IDs no servidor: `RepositorioInstalacoes` (`server/src/instalacoes.ts`): em memória sem
  `DATABASE_URL` (dev/testes), Postgres com ela (`instalacoes-postgres.ts`, driver `pg`, tabela
  `instalacoes` criada na partida). Banco: Neon, plano gratuito (0,5 GB, suspende após 5 min).
  Teste de integração só roda com `TESTE_DATABASE_URL`. `DATABASE_URL` cadastrada à mão no
  Render (Environment → Edit), nunca no git nem no chat. O servidor troca `sslmode=require`
  por `verify-full` (`comCertificadoVerificado`): o pg 9 vai enfraquecer o "require".
- `safeStorage` no Windows depende da chave no arquivo `Local State`, que o Chromium grava com
  atraso (~10 s) ou ao fechar: se o app for derrubado nos primeiros segundos da 1ª execução, a
  identidade não decifra depois e vira outra (ID novo). Aceito como risco pequeno; alternativa
  seria guardar a chave sem cifrar (protegida só pela conta do Windows).
- Acesso com senha (3.3, protocolo v4): campo "Senha (opcional)" ao conectar. `conectar
  {comSenha}` → `pedido_conexao {comSenha}`; anfitrião com senha definida responde sozinho
  `responder_pedido {porSenha: true}` (sem caixa, som nem foco); sem senha definida, vira pedido
  comum com caixa. O servidor recusa `porSenha` em pedido sem senha. `sessao_iniciada {porSenha}`.
  Sessão por senha começa travada (`em_sessao.liberada = false`): o vídeo vai reservado na
  oferta (`addTransceiver` sendonly) e só é capturado em `liberarTela()` (`replaceTrack`, sem
  renegociar); input ignorado e indicador escondido até liberar. A senha vai pelo DataChannel
  (`senha`), nunca pelo servidor; uma tentativa por sessão; prazo de 15 s. O main confere
  (`CofreSenha.tentar`, IPC `senha:tentar`) com limite local de 5 erros em 10 min (`bloqueada`).
  Certo → `autenticado` pelo canal + tela + controle; errado → `encerrar {senha_incorreta |
  senha_bloqueada}`. A senha do visualizador só fica em memória até a sessão começar.
  Custo aceito: quem sabe o ID consegue montar a conexão direta (e ver o IP) antes da senha.
- Bandeja (3.4, `main/bandeja.ts`): ícone desenhado por código (`icone-bandeja.ts`, 16 e 32 px,
  cinza; vermelho em sessão), menu montado por `menu-bandeja.ts` (abrir, ID, copiar ID,
  encerrar sessão, "Iniciar junto com o computador", sair); a janela principal informa ID e
  parceiro por `bandeja:estado`. O X esconde a janela (aviso "continua rodando" uma vez por
  execução); só "Sair" encerra (`before-quit` liga `saindo`). "Iniciar junto com o computador":
  opção no cartão do acesso não supervisionado e no menu, desligada por padrão;
  `setLoginItemSettings` com `--oculto` (começa só na bandeja). Em desenvolvimento registra o
  electron.exe + pasta do projeto (entrada "electron.app.Electron"); vale de verdade com o
  instalador (5.4). Janela principal com `backgroundThrottling: false` (anfitrião escondido
  transmite normalmente: ~29 fps no teste).
- Limites no servidor (3.5, protocolo v5, `server/src/limites.ts`, em memória: zeram ao
  reiniciar): pedidos de conexão 20/min por IP e por ID (`erro limite_excedido`); instalações
  novas 10/h por IP (protege o banco; `buscarId`/`criarId` separados para isso); senhas
  erradas contadas pelo `encerrar {senha_incorreta|senha_bloqueada}` do anfitrião, só em sessão
  por senha: 5 em 10 min do mesmo IP no mesmo ID → esse IP bloqueado 15 min nesse ID; 30 em 1 h
  no ID (qualquer IP) → acesso com senha a ele pausado 1 h. Bloqueado recebe
  `pedido_recusado {bloqueado}` antes de o pedido chegar ao anfitrião (sem conexão direta, sem
  IP exposto); o aceite comum continua valendo. Escolha do usuário: IP + ID com teto por ID
  (um atacante sozinho não tranca o dono para fora).
- IP do cliente: X-Forwarded-For contado do fim (o cliente forja o começo). No Render (medido
  em 28/09/2026): "cliente, Cloudflare, balanceador" + proxy local → 3 proxies (`RENDER`
  definida → 3; `PROXIES_CONFIAVEIS` sobrescreve). Log avisa se o IP escolhido for interno.
  IPv6 agrupado por /64. Verificado em produção: IP forjado não escapa do limite.
- Instância única por pasta de dados (`requestSingleInstanceLock`): duas cópias com a mesma
  identidade se derrubariam; abrir de novo foca a janela existente.
- Senha (3.1): `@node-rs/argon2` (sem script de instalação; o `crypto.argon2` do Node não funciona
  no Electron, que usa BoringSSL), argon2id padrão da biblioteca, 64 MiB, 3 passagens (~0,3 s).
  Mínimo 8 caracteres (escolha do usuário), máximo 128, sem regras de composição; normalizada
  em NFC. Regras em `shared/src/senha.ts`. Cofre em `main/cofre-senha.ts` (puro, testado):
  hash PHC em `userData/seguranca.json`, gravação atômica; arquivo inválido = sem senha.
  Alterar/remover exige a senha atual e é bloqueado durante sessão como anfitrião (o main usa
  o estado do indicador: `sessaoComoAnfitriao()`), para o visualizador não criar acesso para si.
  IPC `senha:estado|definir|remover` (invoke) só da janela principal; o renderer nunca vê o hash.
- Protocolo: registro com desafio (ver ID fixo acima); erros vêm como `erro {codigo}`.
  Servidor desconecta quem não se registra em 10 s e usa ping/pong a cada 30 s.
- A conexão com o servidor fica no renderer (`renderer/sinalizacao.ts`), junto do WebRTC;
  reconecta sozinha (esperas de 1, 2, 5 e 10 s) e mantém o ID fixo da instalação.
- Aceite do anfitrião implementado já na 1.4 (caixa <dialog>, foco inicial em Recusar,
  Esc = recusar), para cumprir a regra de segurança desde a primeira conexão.
- Sessões no servidor (`server/src/sessoes.ts`): conectar → pedido_conexao → responder_pedido
  → sessao_iniciada (para os dois). Só depois disso o servidor repassa `sinal` entre o par;
  pedido expira em 30 s; um pedido/sessão por vez de cada lado; queda durante o pedido avisa
  o parceiro (durante a sessão, ver "Sessões longas").
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
- Pixels: desde a 5.1, a área do monitor mostrado em pixels físicos (`dipToScreenRect`, mesmo
  sistema do `moveMouse` no Windows), não os DIP do `screen` do Electron.
  `robot.setMouseDelay(0)`: o padrão (10 ms) trava o main.
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
- Indicador de sessão (2.4, `main/indicador.ts`): janela flutuante no topo, centralizada, nível
  "screen-saver", sem moldura, `focusable: false` (não rouba foco), `closable: false`, fora da
  barra de tarefas, arrastável. Aparece no vídeo do visualizador (proposital). Página própria
  (`renderer/indicador.html`) e preload próprio que só expõe `window.indicador.encerrar()`.
  Fluxo: renderer principal → `sessao:indicar` (ID ou null, via `parceiroControlando`) → main;
  Encerrar → `indicador:encerrar` → main → `sessao:pedido-encerrar` → janela principal.
  Some se a janela principal fechar, travar ou recarregar; fechar a principal fecha o app.
- Preloads em sandbox não carregam outros arquivos: os dois preloads não podem importar o mesmo
  módulo em tempo de execução (por isso `preload/api-indicador.ts` é separado de `api.ts`). O
  plugin `preloadsSemChunks` (electron.vite.config.ts) faz o build falhar se isso acontecer.
  `isolatedEntries` do electron-vite 5 foi descartado: experimental e quebra fora de um terminal
  (chama `process.stdout.clearLine`/`moveCursor` sem checar TTY).
- WebRTC (`renderer/par.ts`): o anfitrião cria a oferta e o DataChannel "controle"; trickle
  ICE com fila de candidatos que chegam antes da descrição remota. Ping/pong pelo canal mede
  a latência. Mensagens do canal validadas com Zod (`shared/src/canal.ts`), máx. 16 KB.
- STUN (2.5): Google (`stun.l.google.com:19302`) e Cloudflare (`stun.cloudflare.com:3478`) em
  `renderer/par.ts`. Sem TURN (5.3): redes que bloqueiam conexão direta ainda não funcionam.
- Deploy (2.5): `render.yaml` (Blueprint) na raiz; build `npm ci -w @acesso-remoto/server
  --omit=dev` (não instala o Electron), start `npm start -w @acesso-remoto/server` (tsx é
  dependência de produção do servidor), Node 24, verificação em `/saude`, deploy a cada push.
  Publicado (28/09/2026) e testado: duas instâncias nesta máquina conectam pelo Render (sessão,
  vídeo, latência ~12 ms). Falta só o teste entre duas redes diferentes (outro notebook), que o
  usuário fará depois; quando passar, marcar a 2.5.
- Captura (1.5): o renderer chama `getDisplayMedia`; o main (`main/captura.ts`) autoriza só
  pedidos do quadro principal das nossas janelas e entrega o monitor escolhido (5.1). Até 30 fps,
  `contentHint = 'detail'` (perfil nitidez; a 5.2 troca para "motion" na fluidez). O vídeo
  vai reservado na oferta (transceptor) e a trilha entra com `replaceTrack`.
- Ao encerrar a sessão (qualquer motivo) as trilhas da captura recebem `stop()`; se a sessão
  acabar enquanto a captura ainda está sendo obtida, ela é parada assim que chega.
- `encerrar` aceita `motivo` (`captura_indisponivel` | `falha_conexao`), repassado ao parceiro.
- Visualizador: `renderer/telas/visualizacao.ts` troca a janela para o vídeo remoto
  (`body[data-tela='remota']`), com `object-fit: contain`.
- `renderer/sessao.ts` (ControladorSessao) é a máquina de estados da sessão; recebe a
  conexão WebRTC por injeção (`criarPar`) para ser testada no Node com um par falso.

Notas para as próximas etapas:
- robotjs: o npm desta máquina bloqueia scripts de instalação (`install: node-gyp-build`); não
  faz falta porque o binário win32-x64 vem pronto. Na 5.4 (instalador) o `.node` precisa ficar
  fora do asar (`asarUnpack`). O mesmo vale para a koffi (4.2).
- Teste E2E do chat: digitar com `Input.dispatchKeyEvent` (keyDown com `text`); para
  Enter/Shift+Enter é o evento `char` com `text: '\r'` que quebra a linha num textarea.
  O balão da bandeja não é verificável por código: o main registra "aviso mostrado".
- Teste E2E de arquivos: `DOM.setFileInputFiles` no `#escolher-arquivos` simula o botão;
  `Input.dispatchDragEvent` (dragEnter/dragOver/drop com `files`) simula arrastar. Os dois
  apps gravam na MESMA Downloads\Acesso Remoto: nomes diferentes por sentido, e apagar só o
  que o teste criou.
- Teste E2E da área de transferência: na mesma máquina os dois apps veem a MESMA área do
  Windows (o teste confere o caminho, limites e ausência de eco; o "copiar num e colar no
  outro" de verdade fica para o teste entre dois computadores). O script altera a área do
  usuário: guardar antes e devolver no fim (com novas tentativas: pode estar ocupada).
  PowerShell: arquivos .ps1 são bloqueados pela política desta máquina (usar comando inline
  ou -EncodedCommand); `GetOpenClipboardWindow` e `OpenClipboard` em laço NÃO servem para
  medir disputa (leituras duram microssegundos); medir por falhas de cópia de outro programa.
- Mouse ainda não testado com escala do Windows ≠ 100% nem no macOS (esta máquina: 1366x768,
  100%; monitor HDMI de teste 1280x720, 100%). Escalas diferentes por monitor: conferir.
- Teste E2E de qualidade (5.2): o anfitrião cobre a tela (`SetWindowPos` com
  HWND_TOPMOST, 0,0,1366,768) e o visualizador fica minimizado (senão a janela dele,
  mostrando a tela, cria um "espelho" que nunca para); movimento = canvas com texto
  rolando na página do anfitrião (esconder a rolagem da página: a barra cobre 17 px do
  canvas); banda fraca = `maxBitrate` no `RTCRtpSender` (capturar as RTCPeerConnection com
  `Page.enable` + `Page.addScriptToEvaluateOnNewDocument` + `Page.reload`; sem o
  `Page.enable` o script não roda). Scripts que usam `process.exit` pulam o `finally`:
  fechar os electron.exe do projeto depois.
- Teste E2E com dois monitores: o monitor HDMI desta máquina fica em modo Duplicar (o
  sistema vê um monitor só); `DisplaySwitch.exe /extend` estende (fica à direita, x=1366)
  e `/clone` devolve o modo do usuário (ao fim do teste); `/internal` simula desligar o
  segundo. Onde o cursor real parou: abrir o main do anfitrião com `--inspect` e avaliar
  `screen.getCursorScreenPoint()` (DIP). O app em produção aponta para o Render: para
  testar com o servidor local, `npx electron-vite build --mode development` (e refazer o
  build normal no fim).
- Teclado: AltGr e teclas mortas reais só testados em unidade (o CDP não simula AltGraph);
  conferir à mão com teclado ABNT2. IME (japonês/chinês) ignorado. `unicodeTap` gera VK_PACKET:
  alguns jogos que leem a tecla física não veem letras digitadas (modo "tecla física" com
  koffi + SendInput seria a alternativa, se precisar).
- Um "enviar Ctrl+Alt+Del" exige serviço do Windows (SAS); fica para a fase 5.
- Teste E2E do teclado: criar um textarea de teste na janela do anfitrião, focá-lo com clique
  remoto e só então digitar (as teclas vão para onde estiver o foco real do Windows).
- Teste E2E com o indicador aberto: o processo tem duas janelas e `MainWindowHandle` do
  PowerShell pode ser o indicador; escolher a janela pelo título (EnumWindows). O indicador é
  um alvo "page" separado no CDP (URL com `indicador.html`).
- Capturas de tela nos testes E2E mostram a tela real do usuário: não guardar além do necessário.
- E2E: para simular o X, mandar `WM_CLOSE` à janela (user32 `PostMessage`); `window.close()` na
  página segue outro caminho. Para simular "Sair", abrir o main com `--inspect` e avaliar
  `process.mainModule.require('electron').app.quit()` — e desconectar o depurador logo depois,
  senão o Node espera ("Waiting for the debugger to disconnect") e o processo não termina.
- Teste E2E do mouse: anfitrião e visualizador na mesma máquina movem o mouse real; posicionar
  as janelas lado a lado (user32 `SetWindowPos`) e clicar só em área vazia da janela do anfitrião.
- Endurecimento pendente do Electron: `setPermissionRequestHandler`/`setPermissionCheckHandler`
  negando tudo que o app não usa (hoje o Electron concede permissões por padrão).
- Se o usuário parar a captura pelo sistema operacional, a trilha termina ("ended") mas a
  sessão continua sem imagem; tratar quando houver como testar (ex.: macOS).
- macOS ainda não testado: exige permissão de Gravação de Tela para `getDisplayMedia`.
- Teste E2E de reconexão (4.1): o servidor roda dentro do script (`iniciarServidor` com o
  mesmo `InstalacoesEmMemoria`, para os IDs sobreviverem ao reinício; rodar o script com
  `node --import tsx` a partir de `server/`). Para simular queda da conexão direta: capturar
  as RTCPeerConnection com `Page.addScriptToEvaluateOnNewDocument` + `Page.reload`,
  sobrescrever `connectionState` na instância ("failed") e disparar `connectionstatechange`;
  a renegociação que se segue é real (conferir que o `ice-ufrag` mudou dos dois lados).
- Queda real de rede (trocar de Wi-Fi) ainda não foi testada: conferir no teste entre redes.
- Ao testar o app pelo Claude Code: a variável `ELECTRON_RUN_AS_NODE=1` (herdada do VS Code)
  precisa ser removida, e processos Electron em segundo plano morrem quando outra tarefa
  de fundo termina, então orquestrar servidor + app num único script.
- Teste com duas instâncias: `npm run build -w @acesso-remoto/app` e abrir
  `node_modules/electron/dist/electron.exe .` (em app/) duas vezes, cada uma com
  `--user-data-dir` próprio e `--remote-debugging-port` para conduzir pelo DevTools Protocol.
  O Electron não implementa o domínio `Browser` do CDP (minimizar/estado da janela): usar a
  user32 (`ShowWindow`, `IsIconic`) via `powershell -EncodedCommand` com o PID do processo.
