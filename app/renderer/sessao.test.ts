// Testa o ciclo de sessão com dois "apps" (sinalização + controlador)
// conversando pelo servidor real. A conexão WebRTC é substituída por uma
// falsa, porque o Node não tem RTCPeerConnection; o WebRTC real é testado
// com o app aberto.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { novaIdentidade } from '@acesso-remoto/server/auxiliares-teste';
import { InstalacoesEmMemoria } from '@acesso-remoto/server/instalacoes';
import { iniciarServidor, type ServidorSinalizacao } from '@acesso-remoto/server/servidor';
import type { EventoInput, Sinal } from '@acesso-remoto/shared';
import { ErroCaptura } from './captura';
import type { CanalArquivos } from './arquivos';
import type { OpcoesPar, Par } from './par';
import { ControladorSessao, caixaDeAceiteAberta, parceiroControlando, type EstadoSessao } from './sessao';
import { ClienteSinalizacao } from './sinalizacao';

/** Quando true, o próximo anfitrião falso falha ao capturar a tela. */
let simularFalhaCaptura = false;

/** Conexão falsa: registra o que o controlador pede e permite simular eventos. */
class ParFalso implements Par {
  readonly sinaisRecebidos: Sinal[] = [];
  readonly inputsEnviados: EventoInput[] = [];
  readonly senhasEnviadas: string[] = [];
  iniciado = false;
  telaLiberada = false;
  autenticacaoConfirmada = false;
  fechado = false;
  /** O que foi pedido ao fechar: aviso pelo canal (e o motivo) ou nenhum aviso. */
  avisoAoFechar: { motivo?: string } | undefined;
  reiniciosIce = 0;
  readonly areaEnviada: string[] = [];
  constructor(readonly opcoes: OpcoesPar) {}
  enviarAreaTransferencia(texto: string) {
    if (texto.length > 1000) return false; // "grande demais" no par falso
    this.areaEnviada.push(texto);
    return true;
  }
  async iniciar() {
    this.iniciado = true;
    // Como o real: o anfitrião começa enviando a oferta.
    if (this.opcoes.papel === 'anfitriao') this.opcoes.enviarSinal({ tipo: 'oferta', sdp: 'oferta-falsa' });
  }
  async liberarTela() {
    if (simularFalhaCaptura) throw new ErroCaptura('sem permissão');
    this.telaLiberada = true;
  }
  async receberSinal(sinal: Sinal) {
    this.sinaisRecebidos.push(sinal);
    if (sinal.tipo === 'oferta') this.opcoes.enviarSinal({ tipo: 'resposta', sdp: 'resposta-falsa' });
  }
  enviarInput(evento: EventoInput) {
    this.inputsEnviados.push(evento);
  }
  enviarSenha(senha: string) {
    this.senhasEnviadas.push(senha);
  }
  confirmarAutenticacao() {
    this.autenticacaoConfirmada = true;
  }
  async reiniciarIce() {
    // Como o real: uma oferta nova, que o servidor repassa ao visualizador.
    this.reiniciosIce++;
    this.opcoes.enviarSinal({ tipo: 'oferta', sdp: `oferta-reinicio-${this.reiniciosIce}` });
  }
  fechar(aviso?: { motivo?: string }) {
    this.fechado = true;
    this.avisoAoFechar = aviso;
  }
  /** Simula a conexão direta passando a funcionar. */
  conectar() {
    this.opcoes.aoMudarEstado('conectado');
  }
}

/** Como o anfitrião falso responde à senha (no app, quem confere é o main), e prazos. */
interface OpcoesApp {
  senhaDefinida?: boolean;
  senhaCerta?: string;
  bloqueado?: boolean;
  prazoSenhaMs?: number;
  prazoReconexaoMs?: number;
  intervaloReinicioIceMs?: number;
  esperaCanalPerdidoMs?: number;
}

let servidor: ServidorSinalizacao;
/** Os IDs sobrevivem a um reinício do servidor (em produção, no banco). */
let instalacoes: InstalacoesEmMemoria;
const limpezas: Array<() => void> = [];

async function subirServidor(porta = 0): Promise<void> {
  servidor = await iniciarServidor({ porta, log: () => {}, prazoRespostaPedidoMs: 5000, instalacoes });
}

/** Derruba o servidor e o sobe de novo na mesma porta (como um reinício no Render). */
async function reiniciarServidor(entreUmEOutro?: () => Promise<void>): Promise<void> {
  const porta = servidor.porta;
  await servidor.fechar();
  await entreUmEOutro?.();
  await subirServidor(porta);
}

beforeEach(async () => {
  instalacoes = new InstalacoesEmMemoria();
  await subirServidor();
});

afterEach(async () => {
  simularFalhaCaptura = false;
  for (const limpar of limpezas.splice(0)) limpar();
  await servidor.fechar();
});

/** Um "app" completo, ligado como no main.ts, esperando ficar online. */
async function criarApp(opcoesApp: OpcoesApp = {}) {
  const estados: EstadoSessao[] = [];
  const pares: ParFalso[] = [];
  const videos: Array<MediaStream | null> = [];
  const inputs: EventoInput[] = [];
  const areaRecebida: string[] = [];
  const canaisArquivos: Array<CanalArquivos | null> = [];
  const mensagensArquivos: Array<string | ArrayBuffer> = [];
  let liberacoes = 0;
  let verificacoesServidor = 0;
  let id = '';
  const identidade = novaIdentidade();
  const sinalizacao: ClienteSinalizacao = new ClienteSinalizacao({
    url: `ws://127.0.0.1:${servidor.porta}`,
    identidade: {
      chavePublica: async () => identidade.chavePublica,
      assinarDesafio: async (desafio) => identidade.assinar(desafio),
    },
    esperasReconexaoMs: [50],
    // Como no main.ts.
    aoMudarEstado: (estado) => {
      if (estado.fase === 'online') {
        id = estado.id;
        controlador.servidorVoltou();
      } else {
        controlador.servidorPerdido();
      }
    },
    aoMensagem: (mensagem) => controlador.receber(mensagem),
  });
  const controlador = new ControladorSessao({
    enviar: (mensagem) => sinalizacao.enviar(mensagem),
    aoMudarEstado: (estado) => estados.push(estado),
    criarPar: (opcoes) => {
      const par = new ParFalso(opcoes);
      pares.push(par);
      return par;
    },
    aoMudarVideo: (video) => videos.push(video),
    aoReceberInput: (evento) => inputs.push(evento),
    aoLiberarInput: () => liberacoes++,
    aoReceberAreaTransferencia: (texto) => areaRecebida.push(texto),
    aoMudarCanalArquivos: (canal) => canaisArquivos.push(canal),
    aoMensagemArquivos: (dados) => mensagensArquivos.push(dados),
    senhaDefinida: async () => opcoesApp.senhaDefinida ?? false,
    tentarSenha: async (senha) => {
      if (opcoesApp.bloqueado) return 'bloqueada';
      return senha === opcoesApp.senhaCerta ? 'ok' : 'incorreta';
    },
    prazoSenhaMs: opcoesApp.prazoSenhaMs,
    prazoReconexaoMs: opcoesApp.prazoReconexaoMs,
    intervaloReinicioIceMs: opcoesApp.intervaloReinicioIceMs,
    esperaCanalPerdidoMs: opcoesApp.esperaCanalPerdidoMs,
    verificarServidor: () => verificacoesServidor++,
  });
  sinalizacao.iniciar();
  // Parar também o controlador: timers de reconexão não podem sobrar entre testes.
  limpezas.push(() => {
    sinalizacao.parar();
    controlador.encerrar();
  });
  await aguardar(() => id !== '');
  return {
    controlador,
    sinalizacao,
    estados,
    pares,
    videos,
    inputs,
    areaRecebida,
    canaisArquivos,
    mensagensArquivos,
    liberacoes: () => liberacoes,
    verificacoesServidor: () => verificacoesServidor,
    id: () => id,
  };
}

type App = Awaited<ReturnType<typeof criarApp>>;

async function aguardar(condicao: () => boolean, limiteMs = 3000): Promise<void> {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > limiteMs) throw new Error('Tempo esgotado');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const fase = (app: App) => app.controlador.estado.fase;
const aviso = (app: App) => {
  const estado = app.controlador.estado;
  return estado.fase === 'livre' ? estado.aviso : undefined;
};

/** Leva visualizador e anfitrião até a sessão iniciada. */
async function emSessao(opcoes: OpcoesApp = {}) {
  const visualizador = await criarApp(opcoes);
  const anfitriao = await criarApp(opcoes);
  visualizador.controlador.conectar(anfitriao.id());
  await aguardar(() => fase(anfitriao) === 'pedido_recebido');
  anfitriao.controlador.responderPedido(true);
  await aguardar(() => fase(visualizador) === 'em_sessao' && fase(anfitriao) === 'em_sessao');
  return { visualizador, anfitriao };
}

test('pedido aceito: os dois entram em sessão e trocam oferta/resposta', async () => {
  const { visualizador, anfitriao } = await emSessao();

  const estadoV = visualizador.controlador.estado;
  const estadoA = anfitriao.controlador.estado;
  assert.ok(estadoV.fase === 'em_sessao' && estadoV.papel === 'visualizador');
  assert.ok(estadoA.fase === 'em_sessao' && estadoA.papel === 'anfitriao');
  assert.equal(estadoV.parceiro, anfitriao.id());
  assert.equal(estadoA.parceiro, visualizador.id());

  // Oferta do anfitrião chega ao visualizador, e a resposta volta.
  const [parV] = visualizador.pares;
  const [parA] = anfitriao.pares;
  assert.ok(parV && parA && parA.iniciado);
  await aguardar(() => parV.sinaisRecebidos.length === 1 && parA.sinaisRecebidos.length === 1);
  assert.deepEqual(parV.sinaisRecebidos, [{ tipo: 'oferta', sdp: 'oferta-falsa' }]);
  assert.deepEqual(parA.sinaisRecebidos, [{ tipo: 'resposta', sdp: 'resposta-falsa' }]);

  // Estado da conexão direta e latência aparecem no estado da sessão.
  parV.opcoes.aoMudarEstado('conectado');
  parV.opcoes.aoMedirLatencia?.(7);
  const final = visualizador.controlador.estado;
  assert.ok(final.fase === 'em_sessao' && final.conexao === 'conectado' && final.latenciaMs === 7);
});

test('a caixa de aceite só aparece para o anfitrião; o visualizador aguarda', async () => {
  const visualizador = await criarApp();
  const anfitriao = await criarApp();
  const antes = Date.now();
  visualizador.controlador.conectar(anfitriao.id());
  assert.equal(fase(visualizador), 'pedindo');
  await aguardar(() => fase(anfitriao) === 'pedido_recebido');
  const estado = anfitriao.controlador.estado;
  assert.ok(estado.fase === 'pedido_recebido' && estado.origem === visualizador.id());
  // O prazo informado pelo servidor (5 s nestes testes) vira um instante de expiração.
  assert.ok(estado.expiraEm >= antes + 5000 && estado.expiraEm <= Date.now() + 5000);
  // Nenhuma conexão WebRTC é criada antes do aceite.
  assert.equal(visualizador.pares.length + anfitriao.pares.length, 0);
});

test('pedido recusado volta ao início com aviso e sem conexão', async () => {
  const visualizador = await criarApp();
  const anfitriao = await criarApp();
  visualizador.controlador.conectar(anfitriao.id());
  await aguardar(() => fase(anfitriao) === 'pedido_recebido');
  anfitriao.controlador.responderPedido(false);

  await aguardar(() => fase(visualizador) === 'livre');
  assert.equal(aviso(visualizador), 'O outro computador recusou o acesso.');
  assert.equal(fase(anfitriao), 'livre');
  assert.equal(visualizador.pares.length + anfitriao.pares.length, 0);
});

test('ID offline é informado ao visualizador', async () => {
  const visualizador = await criarApp();
  visualizador.controlador.conectar('123456789');
  await aguardar(() => fase(visualizador) === 'livre');
  assert.equal(aviso(visualizador), 'Nenhum computador online com esse ID.');
});

test('visualizador cancela o pedido e a caixa do anfitrião some', async () => {
  const visualizador = await criarApp();
  const anfitriao = await criarApp();
  visualizador.controlador.conectar(anfitriao.id());
  await aguardar(() => fase(anfitriao) === 'pedido_recebido');
  visualizador.controlador.encerrar();

  await aguardar(() => fase(anfitriao) === 'livre');
  assert.equal(aviso(anfitriao), 'O pedido de acesso foi cancelado.');
});

test('encerrar de um lado fecha a conexão dos dois', async () => {
  const { visualizador, anfitriao } = await emSessao();
  anfitriao.controlador.encerrar();

  assert.equal(aviso(anfitriao), 'Sessão encerrada.');
  await aguardar(() => fase(visualizador) === 'livre');
  assert.equal(aviso(visualizador), 'A sessão foi encerrada pelo outro computador.');
  assert.ok(visualizador.pares[0]?.fechado && anfitriao.pares[0]?.fechado);
});

test('falha na conexão direta encerra a sessão dos dois lados', async () => {
  const { visualizador, anfitriao } = await emSessao();
  visualizador.pares[0]?.opcoes.aoMudarEstado('falhou');

  assert.equal(aviso(visualizador), 'Não foi possível estabelecer a conexão direta.');
  await aguardar(() => fase(anfitriao) === 'livre');
  assert.ok(anfitriao.pares[0]?.fechado);
});

test('se o servidor cai antes da conexão direta funcionar, a sessão termina', async () => {
  const { visualizador, anfitriao } = await emSessao();
  await servidor.fechar();

  await aguardar(() => fase(visualizador) === 'livre' && fase(anfitriao) === 'livre');
  assert.equal(aviso(visualizador), 'A conexão com o servidor caiu; a sessão foi encerrada.');
  assert.ok(visualizador.pares[0]?.fechado && anfitriao.pares[0]?.fechado);
});

// ---------------------------------------------------------------------------
// Sessões longas (4.1): quedas do servidor e da conexão direta
// ---------------------------------------------------------------------------

/** Sessão com a conexão direta funcionando nos dois lados. */
async function sessaoConectada(opcoes: OpcoesApp = {}) {
  const apps = await emSessao(opcoes);
  const parV = apps.visualizador.pares[0];
  const parA = apps.anfitriao.pares[0];
  assert.ok(parV && parA);
  parV.conectar();
  parA.conectar();
  return { ...apps, parV, parA };
}

const reconectando = (app: App) => {
  const estado = app.controlador.estado;
  return estado.fase === 'em_sessao' && estado.reconectandoAte !== null;
};

test('servidor reinicia no meio da sessão: ela continua e os dois são religados', async () => {
  const { visualizador, anfitriao, parV, parA } = await sessaoConectada();

  await reiniciarServidor(async () => {
    // Sem servidor: os dois seguem em sessão pela conexão direta.
    await aguardar(() => visualizador.sinalizacao.estado.fase !== 'online' && anfitriao.sinalizacao.estado.fase !== 'online');
    assert.equal(fase(visualizador), 'em_sessao');
    assert.equal(fase(anfitriao), 'em_sessao');
    assert.equal(parA.fechado || parV.fechado, false);
    // A conexão direta cai também: sem servidor, ainda não dá para refazê-la.
    parA.opcoes.aoMudarEstado('falhou');
    assert.ok(reconectando(anfitriao));
    assert.equal(parA.reiniciosIce, 0);
  });

  // O servidor voltou: os dois declaram a sessão, são religados e o
  // anfitrião refaz a conexão direta (a oferta nova chega ao visualizador).
  await aguardar(() => parV.sinaisRecebidos.some((s) => s.tipo === 'oferta' && s.sdp === 'oferta-reinicio-1'));
  assert.equal(parA.reiniciosIce, 1);
  parA.conectar();
  assert.equal(reconectando(anfitriao), false);
  assert.equal(fase(anfitriao), 'em_sessao');

  // Encerrar pelo servidor funciona de novo.
  visualizador.controlador.encerrar();
  await aguardar(() => fase(anfitriao) === 'livre');
  assert.equal(aviso(anfitriao), 'A sessão foi encerrada pelo outro computador.');
});

test('conexão direta cai: o anfitrião a refaz (ICE restart) e o controle volta', async () => {
  const { visualizador, anfitriao, parV, parA } = await sessaoConectada();

  parA.opcoes.aoMudarEstado('falhou');
  parV.opcoes.aoMudarEstado('conectando'); // "disconnected" no visualizador
  assert.ok(reconectando(anfitriao) && reconectando(visualizador));
  // O anfitrião solta o que estivesse apertado e confere o servidor; tenta refazer já.
  assert.equal(anfitriao.liberacoes(), 1);
  assert.equal(anfitriao.verificacoesServidor(), 1);
  assert.equal(parA.reiniciosIce, 1);
  await aguardar(() => parV.sinaisRecebidos.some((s) => s.tipo === 'oferta' && s.sdp === 'oferta-reinicio-1'));
  // A resposta do visualizador volta ao anfitrião pelo servidor.
  await aguardar(() => parA.sinaisRecebidos.filter((s) => s.tipo === 'resposta').length === 2);

  // Enquanto isso, o input do visualizador é descartado (nada fica na fila).
  visualizador.controlador.enviarInput(clique);
  assert.deepEqual(parV.inputsEnviados, []);

  parA.conectar();
  parV.conectar();
  assert.equal(reconectando(anfitriao) || reconectando(visualizador), false);
  visualizador.controlador.enviarInput(clique);
  assert.deepEqual(parV.inputsEnviados, [clique]);
});

test('oscilação curta: o anfitrião só refaz a conexão se ela não voltar sozinha', async () => {
  const { anfitriao, parA } = await sessaoConectada({ intervaloReinicioIceMs: 50 });
  parA.opcoes.aoMudarEstado('conectando'); // "disconnected": costuma voltar sozinho
  assert.equal(parA.reiniciosIce, 0);
  await aguardar(() => parA.reiniciosIce >= 2); // e tenta de novo de tempos em tempos
  parA.conectar();
  const depois = parA.reiniciosIce;
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(parA.reiniciosIce, depois, 'conectado de novo: para de tentar');
  assert.equal(reconectando(anfitriao), false);
});

test('conexão direta que não volta no prazo encerra a sessão nos dois lados', async () => {
  const { visualizador, anfitriao, parA } = await sessaoConectada({ prazoReconexaoMs: 100 });
  parA.opcoes.aoMudarEstado('falhou');
  await aguardar(() => fase(anfitriao) === 'livre');
  assert.equal(aviso(anfitriao), 'A conexão direta caiu e não voltou a tempo; a sessão foi encerrada.');
  assert.deepEqual(parA.avisoAoFechar, { motivo: 'falha_conexao' });
  await aguardar(() => fase(visualizador) === 'livre');
  assert.equal(aviso(visualizador), 'A conexão direta com o outro computador falhou.');
});

test('a primeira conexão direta que falha continua encerrando a sessão (sem reconexão)', async () => {
  const { anfitriao } = await emSessao();
  anfitriao.pares[0]?.opcoes.aoMudarEstado('falhou');
  assert.equal(fase(anfitriao), 'livre');
});

test('encerrar avisa também pela conexão direta; senha recusada, só pelo servidor', async () => {
  const { anfitriao, parA } = await sessaoConectada();
  anfitriao.controlador.encerrar();
  assert.deepEqual(parA.avisoAoFechar, {});

  const comSenha = await sessaoComSenha({ senhaDefinida: true, senhaCerta: SENHA }, 'senha errada 999');
  comSenha.parA.opcoes.aoReceberSenha?.('senha errada 999');
  await aguardar(() => fase(comSenha.anfitriao) === 'livre');
  assert.equal(comSenha.parA.fechado, true);
  assert.equal(comSenha.parA.avisoAoFechar, undefined);
});

test('aviso de fim pela conexão direta encerra a sessão mesmo sem servidor', async () => {
  const { visualizador, parV } = await sessaoConectada();
  await servidor.fechar();
  await aguardar(() => visualizador.sinalizacao.estado.fase !== 'online');
  assert.equal(fase(visualizador), 'em_sessao');

  parV.opcoes.aoEncerrarPeloParceiro?.(undefined);
  assert.equal(fase(visualizador), 'livre');
  assert.equal(aviso(visualizador), 'A sessão foi encerrada pelo outro computador.');
  assert.ok(parV.fechado);
});

test('quem estava fora do servidor e recebe o fim pelo canal libera a espera no servidor', async () => {
  const { visualizador, anfitriao, parA } = await sessaoConectada();
  // O visualizador cai do servidor; o anfitrião fica esperando a retomada...
  visualizador.sinalizacao.parar();
  await new Promise((r) => setTimeout(r, 150)); // o servidor percebe a queda
  // ...e o visualizador encerra pela conexão direta.
  parA.opcoes.aoEncerrarPeloParceiro?.(undefined);
  assert.equal(fase(anfitriao), 'livre');

  // O anfitrião ficou livre também no servidor: aceita um pedido novo.
  const outro = await criarApp();
  outro.controlador.conectar(anfitriao.id());
  await aguardar(() => fase(anfitriao) === 'pedido_recebido');
});

test('canal fechado sem aviso: espera o motivo pelo servidor antes de encerrar', async () => {
  const { visualizador, parV, parA } = await sessaoComSenha({ senhaDefinida: true, senhaCerta: SENHA }, 'senha errada 999');
  // A conexão fecha antes de o motivo (que vem pelo servidor) chegar.
  parV.opcoes.aoPerderCanal?.();
  parA.opcoes.aoReceberSenha?.('senha errada 999');
  await aguardar(() => fase(visualizador) === 'livre');
  assert.equal(aviso(visualizador), 'Senha incorreta.');
});

test('canal fechado sem aviso e sem motivo: encerra por falha', async () => {
  const { visualizador, anfitriao, parV } = await sessaoConectada({ esperaCanalPerdidoMs: 50 });
  parV.opcoes.aoPerderCanal?.();
  await aguardar(() => fase(visualizador) === 'livre');
  await aguardar(() => fase(anfitriao) === 'livre');
});

test('nova sessão funciona depois de encerrar a anterior', async () => {
  const { visualizador, anfitriao } = await emSessao();
  visualizador.controlador.encerrar();
  await aguardar(() => fase(anfitriao) === 'livre');

  visualizador.controlador.conectar(anfitriao.id());
  await aguardar(() => fase(anfitriao) === 'pedido_recebido');
  anfitriao.controlador.responderPedido(true);
  await aguardar(() => fase(visualizador) === 'em_sessao' && fase(anfitriao) === 'em_sessao');
  assert.equal(visualizador.pares.length, 2);
});

test('vídeo recebido vai para a tela e é retirado ao encerrar', async () => {
  const { visualizador, anfitriao } = await emSessao();
  const videoFalso = { id: 'tela-remota' } as unknown as MediaStream;
  visualizador.pares[0]?.opcoes.aoReceberVideo?.(videoFalso);
  assert.deepEqual(visualizador.videos, [videoFalso]);

  anfitriao.controlador.encerrar();
  await aguardar(() => fase(visualizador) === 'livre');
  assert.deepEqual(visualizador.videos, [videoFalso, null]);
});

test('falha na captura encerra a sessão e o motivo chega ao visualizador', async () => {
  simularFalhaCaptura = true;
  const visualizador = await criarApp();
  const anfitriao = await criarApp();
  visualizador.controlador.conectar(anfitriao.id());
  await aguardar(() => fase(anfitriao) === 'pedido_recebido');
  anfitriao.controlador.responderPedido(true); // aceita, mas a captura vai falhar

  await aguardar(() => fase(anfitriao) === 'livre' && fase(visualizador) === 'livre');
  assert.equal(aviso(anfitriao), 'Não foi possível capturar a tela deste computador.');
  assert.equal(aviso(visualizador), 'O outro computador não conseguiu capturar a tela.');
  assert.ok(anfitriao.pares[0]?.fechado && visualizador.pares[0]?.fechado);
});

test('indicador: só o anfitrião em sessão tem alguém controlando', async () => {
  const visualizador = await criarApp();
  const anfitriao = await criarApp();
  visualizador.controlador.conectar(anfitriao.id());
  await aguardar(() => fase(anfitriao) === 'pedido_recebido');
  // Pedido ainda não aceito: ninguém controla.
  assert.equal(parceiroControlando(anfitriao.controlador.estado), null);

  anfitriao.controlador.responderPedido(true);
  await aguardar(() => fase(visualizador) === 'em_sessao' && fase(anfitriao) === 'em_sessao');
  assert.equal(parceiroControlando(anfitriao.controlador.estado), visualizador.id());
  assert.equal(parceiroControlando(visualizador.controlador.estado), null);

  anfitriao.controlador.encerrar();
  assert.equal(parceiroControlando(anfitriao.controlador.estado), null);
});

const clique: EventoInput ={ tipo: 'mouse_botao', botao: 'esquerdo', pressionado: true, x: 0.5, y: 0.5 };

test('só o visualizador envia input pelo canal', async () => {
  const { visualizador, anfitriao } = await emSessao();
  visualizador.controlador.enviarInput(clique);
  anfitriao.controlador.enviarInput(clique);
  assert.deepEqual(visualizador.pares[0]?.inputsEnviados, [clique]);
  assert.deepEqual(anfitriao.pares[0]?.inputsEnviados, []);
});

test('fora de uma sessão, input não é enviado', async () => {
  const visualizador = await criarApp();
  visualizador.controlador.enviarInput(clique); // não há par: não pode lançar erro
  assert.equal(visualizador.pares.length, 0);
});

test('input recebido só é executado no anfitrião', async () => {
  const { visualizador, anfitriao } = await emSessao();
  anfitriao.pares[0]?.opcoes.aoReceberInput?.(clique);
  visualizador.pares[0]?.opcoes.aoReceberInput?.(clique);
  assert.deepEqual(anfitriao.inputs, [clique]);
  assert.deepEqual(visualizador.inputs, []);
});

test('fim da sessão solta os botões no anfitrião e ignora input atrasado', async () => {
  const { visualizador, anfitriao } = await emSessao();
  const parAntigo = anfitriao.pares[0];
  visualizador.controlador.encerrar();
  await aguardar(() => fase(anfitriao) === 'livre');

  assert.equal(anfitriao.liberacoes(), 1);
  assert.equal(visualizador.liberacoes(), 0);
  // Um evento que chegue depois do fim (conexão antiga) não é executado.
  parAntigo?.opcoes.aoReceberInput?.(clique);
  assert.deepEqual(anfitriao.inputs, []);
});

// ---------------------------------------------------------------------------
// Acesso com senha (não supervisionado)
// ---------------------------------------------------------------------------

const SENHA = 'frase secreta 123';

/** Visualizador conecta com senha num anfitrião com as opções dadas; espera os dois em sessão. */
async function sessaoComSenha(opcoesAnfitriao: OpcoesApp, senha = SENHA) {
  const visualizador = await criarApp();
  const anfitriao = await criarApp(opcoesAnfitriao);
  visualizador.controlador.conectar(anfitriao.id(), senha);
  await aguardar(() => fase(visualizador) === 'em_sessao' && fase(anfitriao) === 'em_sessao');
  const parV = visualizador.pares[0];
  const parA = anfitriao.pares[0];
  assert.ok(parV && parA);
  return { visualizador, anfitriao, parV, parA };
}

const liberada = (app: App) => {
  const estado = app.controlador.estado;
  return estado.fase === 'em_sessao' && estado.liberada;
};

test('com senha certa: o anfitrião aceita sozinho, e tela/controle só depois da senha', async () => {
  const { visualizador, anfitriao, parV, parA } = await sessaoComSenha({ senhaDefinida: true, senhaCerta: SENHA });

  // Nenhuma caixa de aceite apareceu no anfitrião (o pedido ficou "verificando").
  assert.ok(anfitriao.estados.some((e) => e.fase === 'pedido_recebido'));
  assert.ok(!anfitriao.estados.some(caixaDeAceiteAberta));

  // Conectados, mas ainda travados: sem tela, sem input, sem "alguém controlando".
  assert.equal(liberada(anfitriao), false);
  assert.equal(parA.telaLiberada, false);
  assert.deepEqual(parV.senhasEnviadas, [SENHA]);
  parA.opcoes.aoReceberInput?.(clique);
  assert.deepEqual(anfitriao.inputs, []);
  assert.equal(parceiroControlando(anfitriao.controlador.estado), null);
  visualizador.controlador.enviarInput(clique);
  assert.deepEqual(parV.inputsEnviados, []);

  // A senha chega ao anfitrião pelo canal direto e confere.
  parA.opcoes.aoReceberSenha?.(SENHA);
  await aguardar(() => liberada(anfitriao));
  assert.ok(parA.telaLiberada && parA.autenticacaoConfirmada);
  assert.equal(parceiroControlando(anfitriao.controlador.estado), visualizador.id());
  parA.opcoes.aoReceberInput?.(clique);
  assert.deepEqual(anfitriao.inputs, [clique]);

  // O visualizador recebe a confirmação e passa a controlar.
  parV.opcoes.aoAutenticado?.();
  assert.equal(liberada(visualizador), true);
  visualizador.controlador.enviarInput(clique);
  assert.deepEqual(parV.inputsEnviados, [clique]);
});

test('senha errada encerra a sessão dos dois lados, avisando cada um', async () => {
  const { visualizador, anfitriao, parA } = await sessaoComSenha({ senhaDefinida: true, senhaCerta: SENHA }, 'senha errada 999');
  parA.opcoes.aoReceberSenha?.('senha errada 999');
  await aguardar(() => fase(anfitriao) === 'livre' && fase(visualizador) === 'livre');
  assert.equal(aviso(visualizador), 'Senha incorreta.');
  assert.equal(aviso(anfitriao), 'Uma tentativa de acesso com senha errada foi recusada.');
  assert.equal(parA.telaLiberada, false);
});

test('muitas tentativas: o anfitrião recusa com "bloqueada"', async () => {
  const { visualizador, anfitriao, parA } = await sessaoComSenha({ senhaDefinida: true, senhaCerta: SENHA, bloqueado: true });
  parA.opcoes.aoReceberSenha?.(SENHA); // nem a certa passa enquanto estiver bloqueado
  await aguardar(() => fase(visualizador) === 'livre');
  assert.equal(aviso(visualizador), 'Muitas tentativas com senha errada. Tente de novo mais tarde.');
  assert.equal(parA.telaLiberada, false);
  assert.equal(fase(anfitriao), 'livre');
});

test('senha que não chega a tempo encerra a sessão', async () => {
  const { visualizador, anfitriao } = await sessaoComSenha({ senhaDefinida: true, senhaCerta: SENHA, prazoSenhaMs: 100 });
  // Ninguém entrega a senha ao anfitrião.
  await aguardar(() => fase(anfitriao) === 'livre' && fase(visualizador) === 'livre');
  assert.equal(aviso(visualizador), 'Senha incorreta.');
});

test('anfitrião sem senha definida: o pedido com senha vira um pedido comum (caixa de aceite)', async () => {
  const visualizador = await criarApp();
  const anfitriao = await criarApp({ senhaDefinida: false });
  visualizador.controlador.conectar(anfitriao.id(), SENHA);
  await aguardar(() => caixaDeAceiteAberta(anfitriao.controlador.estado));
  anfitriao.controlador.responderPedido(true);
  await aguardar(() => liberada(anfitriao) && liberada(visualizador));
  // Sessão comum: nenhuma senha é enviada.
  assert.deepEqual(visualizador.pares[0]?.senhasEnviadas, []);
  assert.equal(anfitriao.pares[0]?.telaLiberada, true);
});

test('sem senha, a sessão comum já começa liberada e a tela é capturada logo', async () => {
  const { anfitriao, visualizador } = await emSessao();
  assert.ok(liberada(anfitriao) && liberada(visualizador));
  await aguardar(() => anfitriao.pares[0]?.telaLiberada === true);
});

// ---------------------------------------------------------------------------
// Área de transferência compartilhada (4.2)
// ---------------------------------------------------------------------------

test('área de transferência: os dois lados enviam e recebem com a sessão liberada', async () => {
  const { visualizador, anfitriao, parV, parA } = await sessaoConectada();
  assert.equal(visualizador.controlador.enviarAreaTransferencia('do visualizador'), 'enviado');
  assert.equal(anfitriao.controlador.enviarAreaTransferencia('do anfitrião'), 'enviado');
  assert.deepEqual(parV.areaEnviada, ['do visualizador']);
  assert.deepEqual(parA.areaEnviada, ['do anfitrião']);

  parA.opcoes.aoReceberAreaTransferencia?.('do visualizador');
  parV.opcoes.aoReceberAreaTransferencia?.('do anfitrião');
  assert.deepEqual(anfitriao.areaRecebida, ['do visualizador']);
  assert.deepEqual(visualizador.areaRecebida, ['do anfitrião']);

  assert.equal(visualizador.controlador.enviarAreaTransferencia('x'.repeat(1001)), 'grande_demais');
});

test('área de transferência: nada passa fora de sessão nem antes de a senha conferir', async () => {
  const sozinho = await criarApp();
  assert.equal(sozinho.controlador.enviarAreaTransferencia('fora de sessão'), 'ignorado');

  const { visualizador, anfitriao, parV, parA } = await sessaoComSenha({ senhaDefinida: true, senhaCerta: SENHA });
  // Travada (senha ainda não conferida): não envia nem aceita.
  assert.equal(visualizador.controlador.enviarAreaTransferencia('cedo demais'), 'ignorado');
  parA.opcoes.aoReceberAreaTransferencia?.('tentando plantar um texto');
  assert.deepEqual(anfitriao.areaRecebida, []);
  assert.deepEqual(parV.areaEnviada, []);

  // Senha conferida: liberada nos dois lados.
  parA.opcoes.aoReceberSenha?.(SENHA);
  await aguardar(() => liberada(anfitriao));
  parV.opcoes.aoAutenticado?.();
  parA.opcoes.aoReceberAreaTransferencia?.('agora vale');
  assert.deepEqual(anfitriao.areaRecebida, ['agora vale']);
  assert.equal(visualizador.controlador.enviarAreaTransferencia('agora vai'), 'enviado');
});

test('área de transferência: texto que chega por uma conexão antiga é ignorado', async () => {
  const { anfitriao, parA } = await sessaoConectada();
  anfitriao.controlador.encerrar();
  parA.opcoes.aoReceberAreaTransferencia?.('atrasado');
  assert.deepEqual(anfitriao.areaRecebida, []);
});

// ---------------------------------------------------------------------------
// Transferência de arquivos (4.3): o canal só vale com a sessão liberada
// ---------------------------------------------------------------------------

const canalFalso = (): CanalArquivos => ({ enviar: () => {}, fila: () => 0, esperarFila: async () => {} });

test('arquivos: o canal é entregue com a sessão liberada e retirado ao encerrar', async () => {
  const { anfitriao, parA } = await sessaoConectada();
  const canal = canalFalso();
  parA.opcoes.aoMudarCanalArquivos?.(canal);
  assert.deepEqual(anfitriao.canaisArquivos, [canal]);
  parA.opcoes.aoMensagemArquivos?.('{"tipo":"arquivo_fim","id":1}');
  assert.equal(anfitriao.mensagensArquivos.length, 1);

  anfitriao.controlador.encerrar();
  assert.deepEqual(anfitriao.canaisArquivos, [canal, null]);
  // Conexão antiga: nada mais passa.
  parA.opcoes.aoMensagemArquivos?.('{"tipo":"arquivo_fim","id":2}');
  assert.equal(anfitriao.mensagensArquivos.length, 1);
});

test('arquivos: na sessão por senha, nada antes de a senha conferir', async () => {
  const { visualizador, anfitriao, parV, parA } = await sessaoComSenha({ senhaDefinida: true, senhaCerta: SENHA });
  const canalA = canalFalso();
  parA.opcoes.aoMudarCanalArquivos?.(canalA);
  parV.opcoes.aoMudarCanalArquivos?.(canalFalso());
  parA.opcoes.aoMensagemArquivos?.(new ArrayBuffer(8)); // tentando mandar arquivo antes da senha
  assert.deepEqual(anfitriao.canaisArquivos, []);
  assert.deepEqual(anfitriao.mensagensArquivos, []);
  assert.deepEqual(visualizador.canaisArquivos, []);

  parA.opcoes.aoReceberSenha?.(SENHA);
  await aguardar(() => liberada(anfitriao));
  assert.deepEqual(anfitriao.canaisArquivos, [canalA]);
  parV.opcoes.aoAutenticado?.();
  assert.equal(visualizador.canaisArquivos.length, 1);
});
