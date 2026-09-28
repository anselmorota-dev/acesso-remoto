// Testa o ciclo de sessão com dois "apps" (sinalização + controlador)
// conversando pelo servidor real. A conexão WebRTC é substituída por uma
// falsa, porque o Node não tem RTCPeerConnection; o WebRTC real é testado
// com o app aberto.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { iniciarServidor, type ServidorSinalizacao } from '@acesso-remoto/server/servidor';
import type { EventoInput, Sinal } from '@acesso-remoto/shared';
import { ErroCaptura } from './captura';
import type { OpcoesPar, Par } from './par';
import { ControladorSessao, parceiroControlando, type EstadoSessao } from './sessao';
import { ClienteSinalizacao } from './sinalizacao';

/** Quando true, o próximo anfitrião falso falha ao capturar a tela. */
let simularFalhaCaptura = false;

/** Conexão falsa: registra o que o controlador pede e permite simular eventos. */
class ParFalso implements Par {
  readonly sinaisRecebidos: Sinal[] = [];
  readonly inputsEnviados: EventoInput[] = [];
  iniciado = false;
  fechado = false;
  constructor(readonly opcoes: OpcoesPar) {}
  async iniciar() {
    this.iniciado = true;
    if (this.opcoes.papel === 'anfitriao' && simularFalhaCaptura) throw new ErroCaptura('sem permissão');
    // Como o real: o anfitrião começa enviando a oferta.
    if (this.opcoes.papel === 'anfitriao') this.opcoes.enviarSinal({ tipo: 'oferta', sdp: 'oferta-falsa' });
  }
  async receberSinal(sinal: Sinal) {
    this.sinaisRecebidos.push(sinal);
    if (sinal.tipo === 'oferta') this.opcoes.enviarSinal({ tipo: 'resposta', sdp: 'resposta-falsa' });
  }
  enviarInput(evento: EventoInput) {
    this.inputsEnviados.push(evento);
  }
  fechar() {
    this.fechado = true;
  }
}

let servidor: ServidorSinalizacao;
const limpezas: Array<() => void> = [];

beforeEach(async () => {
  servidor = await iniciarServidor({ porta: 0, log: () => {}, prazoRespostaPedidoMs: 5000 });
});

afterEach(async () => {
  simularFalhaCaptura = false;
  for (const limpar of limpezas.splice(0)) limpar();
  await servidor.fechar();
});

/** Um "app" completo, ligado como no main.ts, esperando ficar online. */
async function criarApp() {
  const estados: EstadoSessao[] = [];
  const pares: ParFalso[] = [];
  const videos: Array<MediaStream | null> = [];
  const inputs: EventoInput[] = [];
  let liberacoes = 0;
  let id = '';
  const sinalizacao: ClienteSinalizacao = new ClienteSinalizacao({
    url: `ws://127.0.0.1:${servidor.porta}`,
    esperasReconexaoMs: [50],
    aoMudarEstado: (estado) => {
      if (estado.fase === 'online') id = estado.id;
      else controlador.servidorPerdido();
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
  });
  sinalizacao.iniciar();
  limpezas.push(() => sinalizacao.parar());
  await aguardar(() => id !== '');
  return { controlador, sinalizacao, estados, pares, videos, inputs, liberacoes: () => liberacoes, id: () => id };
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
async function emSessao() {
  const visualizador = await criarApp();
  const anfitriao = await criarApp();
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

test('se o servidor cai, a sessão termina e a conexão é fechada', async () => {
  const { visualizador, anfitriao } = await emSessao();
  await servidor.fechar();

  await aguardar(() => fase(visualizador) === 'livre' && fase(anfitriao) === 'livre');
  assert.equal(aviso(visualizador), 'A conexão com o servidor caiu; a sessão foi encerrada.');
  assert.ok(visualizador.pares[0]?.fechado && anfitriao.pares[0]?.fechado);
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
