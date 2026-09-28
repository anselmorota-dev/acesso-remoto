// Testa o ciclo de sessão com dois "apps" (sinalização + controlador)
// conversando pelo servidor real. A conexão WebRTC é substituída por uma
// falsa, porque o Node não tem RTCPeerConnection; o WebRTC real é testado
// com o app aberto.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { iniciarServidor, type ServidorSinalizacao } from '@acesso-remoto/server/servidor';
import type { Sinal } from '@acesso-remoto/shared';
import type { OpcoesPar, Par } from './par';
import { ControladorSessao, type EstadoSessao } from './sessao';
import { ClienteSinalizacao } from './sinalizacao';

/** Conexão falsa: registra o que o controlador pede e permite simular eventos. */
class ParFalso implements Par {
  readonly sinaisRecebidos: Sinal[] = [];
  iniciado = false;
  fechado = false;
  constructor(readonly opcoes: OpcoesPar) {}
  async iniciar() {
    this.iniciado = true;
    // Como o real: o anfitrião começa enviando a oferta.
    if (this.opcoes.papel === 'anfitriao') this.opcoes.enviarSinal({ tipo: 'oferta', sdp: 'oferta-falsa' });
  }
  async receberSinal(sinal: Sinal) {
    this.sinaisRecebidos.push(sinal);
    if (sinal.tipo === 'oferta') this.opcoes.enviarSinal({ tipo: 'resposta', sdp: 'resposta-falsa' });
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
  for (const limpar of limpezas.splice(0)) limpar();
  await servidor.fechar();
});

/** Um "app" completo, ligado como no main.ts, esperando ficar online. */
async function criarApp() {
  const estados: EstadoSessao[] = [];
  const pares: ParFalso[] = [];
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
  });
  sinalizacao.iniciar();
  limpezas.push(() => sinalizacao.parar());
  await aguardar(() => id !== '');
  return { controlador, sinalizacao, estados, pares, id: () => id };
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
  visualizador.controlador.conectar(anfitriao.id());
  assert.equal(fase(visualizador), 'pedindo');
  await aguardar(() => fase(anfitriao) === 'pedido_recebido');
  const estado = anfitriao.controlador.estado;
  assert.ok(estado.fase === 'pedido_recebido' && estado.origem === visualizador.id());
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
