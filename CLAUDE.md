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
- **Controle de mouse/teclado:** `@nut-tree-fork/nut-js` (fork comunitário gratuito do nut.js);
  alternativa: `@jitsi/robotjs`. Confirmar qual está mais estável antes de adotar.
- **Servidor de sinalização:** Node.js + TypeScript + `ws` (WebSocket), deploy no Render
- **Redes difíceis (fase 5):** servidor TURN (coturn ou serviço gerenciado)
- **Monorepo:** npm workspaces (`shared`, `server`, `app`); TypeScript 7 só para checar tipos
- **Build do app:** electron-vite 5 (Vite fixado na v7, exigência do electron-vite)
- **Servidor em dev:** tsx (roda o TypeScript direto, com recarga)
- **Validação de mensagens:** Zod 4, esquemas em `shared/src/mensagens.ts` (geram os tipos)
- **Testes:** `node:test` + tsx, arquivos `*.test.ts` ao lado do código

## Comandos
- `npm run dev` — servidor + app juntos (ou `dev:server` / `dev:app` separados)
- `npm run typecheck` — checagem de tipos de todos os pacotes
- `npm test` — testes automáticos (hoje só do servidor)
- `npm run build` — build do app (saída em `app/out/`)
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
- [ ] 1.3 App mostra o próprio ID e campo para conectar em outro ID
- [ ] 1.4 Troca de oferta/resposta/ICE via servidor
- [ ] 1.5 Anfitrião captura a tela e o visualizador exibe
- **Pronto quando:** duas instâncias (mesma máquina ou rede) se veem.

### Fase 2 — Controlar
- [ ] 2.1 Popup Aceitar/Recusar no anfitrião
- [ ] 2.2 DataChannel com eventos de mouse (mover, clicar, rolar)
- [ ] 2.3 Teclado, incluindo atalhos (Ctrl, Alt, Shift) e caracteres com acento
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
Fase 1, etapa 1.2 concluída. Próxima: 1.3 (app mostra o próprio ID e campo para conectar).

Decisões já tomadas:
- ID temporário: sorteado pelo servidor a cada conexão, guardado só em memória.
  ID fixo por instalação (com segredo de posse + banco) fica para a fase 3.
- Protocolo: app manda `registrar {versao}` → servidor responde `registrado {id}` ou `erro {codigo}`.
  Servidor desconecta quem não se registra em 10 s e usa ping/pong a cada 30 s.

Notas para as próximas etapas:
- `@nut-tree-fork/nut-js` sem atualização desde 03/2025; `@jitsi/robotjs` ativo (07/2026).
  Reavaliar na fase 2, provável escolha: robotjs.
- A CSP do renderer (`app/renderer/index.html`) precisa liberar o servidor em `connect-src` na 1.3.
