// Testa várias sessões ao mesmo tempo: apps (sinalização + gerenciador)
// conversando pelo servidor real, com conexões WebRTC falsas.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { novaIdentidade } from '@acesso-remoto/server/auxiliares-teste';
import { InstalacoesEmMemoria } from '@acesso-remoto/server/instalacoes';
import { iniciarServidor, type ServidorSinalizacao } from '@acesso-remoto/server/servidor';
import type { IdCliente } from '@acesso-remoto/shared';
import { GerenciadorSessoes } from './gerenciador-sessoes';
import { ParFalso } from './par-falso';
import type { EstadoSessao } from './sessao';
import { ClienteSinalizacao } from './sinalizacao';

let servidor: ServidorSinalizacao;
let instalacoes: InstalacoesEmMemoria;
const limpezas: Array<() => void> = [];

async function subirServidor(porta = 0): Promise<void> {
  servidor = await iniciarServidor({ porta, log: () => {}, prazoRespostaPedidoMs: 5000, instalacoes });
}

beforeEach(async () => {
  instalacoes = new InstalacoesEmMemoria();
  await subirServidor();
});

afterEach(async () => {
  for (const limpar of limpezas.splice(0)) limpar();
  await servidor.fechar();
});

async function aguardar(condicao: () => boolean, limiteMs = 3000): Promise<void> {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > limiteMs) throw new Error('Tempo esgotado');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Um "app": sinalização + gerenciador, ligados como no main.ts. */
/** "aoCriarPar": anota a conexão (falsa) criada para cada sessão. */
async function criarApp(opcoesApp: { aoCriarPar?: (parceiro: IdCliente, par: ParFalso) => void } = {}) {
  let id = '';
  const avisos: Array<[IdCliente, string | undefined]> = [];
  const identidade = novaIdentidade();
  const gerenciador: GerenciadorSessoes = new GerenciadorSessoes({
    opcoesDaSessao: (parceiro) => ({
      enviar: (mensagem) => sinalizacao.enviar(mensagem),
      criarPar: (opcoes) => {
        const par = new ParFalso(opcoes);
        opcoesApp.aoCriarPar?.(parceiro, par);
        return par;
      },
      senhaDefinida: async () => false,
    }),
    aoMudar: (parceiro, estado) => {
      if (estado.fase === 'livre') avisos.push([parceiro, estado.aviso]);
    },
  });
  const sinalizacao: ClienteSinalizacao = new ClienteSinalizacao({
    url: `ws://127.0.0.1:${servidor.porta}`,
    identidade: {
      chavePublica: async () => identidade.chavePublica,
      assinarDesafio: async (desafio) => identidade.assinar(desafio),
    },
    esperasReconexaoMs: [50],
    aoMudarEstado: (estado) => {
      if (estado.fase === 'online') {
        id = estado.id;
        gerenciador.servidorVoltou();
      } else {
        gerenciador.servidorPerdido();
      }
    },
    aoMensagem: (mensagem) => gerenciador.receber(mensagem),
  });
  sinalizacao.iniciar();
  limpezas.push(() => {
    sinalizacao.parar();
    gerenciador.encerrarTodas();
  });
  await aguardar(() => id !== '');
  const estadoCom = (parceiro: IdCliente): EstadoSessao | undefined => gerenciador.obter(parceiro)?.estado;
  return { gerenciador, sinalizacao, avisos, id: () => id, estadoCom };
}

type App = Awaited<ReturnType<typeof criarApp>>;
const fase = (app: App, parceiro: IdCliente) => app.estadoCom(parceiro)?.fase;

/** O visualizador acessa o anfitrião, que aceita. */
async function acessar(visualizador: App, anfitriao: App): Promise<void> {
  assert.equal(visualizador.gerenciador.conectar(anfitriao.id()), null);
  await aguardar(() => fase(anfitriao, visualizador.id()) === 'pedido_recebido');
  anfitriao.gerenciador.obter(visualizador.id())?.responderPedido(true);
  await aguardar(() => fase(visualizador, anfitriao.id()) === 'em_sessao' && fase(anfitriao, visualizador.id()) === 'em_sessao');
}

test('acessa dois computadores ao mesmo tempo, cada um na sua sessão', async () => {
  const v = await criarApp();
  const a = await criarApp();
  const b = await criarApp();
  await acessar(v, a);
  await acessar(v, b);
  assert.deepEqual(
    v.gerenciador.lista().map((s) => s.parceiro),
    [a.id(), b.id()],
  );
  // Cada lado vê a sessão certa.
  const sessaoA = v.estadoCom(a.id());
  const sessaoB = v.estadoCom(b.id());
  assert.ok(sessaoA?.fase === 'em_sessao' && sessaoA.parceiro === a.id() && sessaoA.papel === 'visualizador');
  assert.ok(sessaoB?.fase === 'em_sessao' && sessaoB.parceiro === b.id());

  // Encerrar uma não mexe na outra.
  v.gerenciador.obter(a.id())?.encerrar();
  await aguardar(() => fase(a, v.id()) === undefined);
  assert.equal(v.gerenciador.obter(a.id()), undefined);
  assert.equal(fase(v, b.id()), 'em_sessao');
  assert.deepEqual(a.avisos, [[v.id(), 'A sessão foi encerrada pelo outro computador.']]);
});

test('os sinais WebRTC vão para a conexão da sessão certa', async () => {
  const pares = new Map<string, ParFalso>();
  const v = await criarApp({ aoCriarPar: (parceiro, par) => pares.set(parceiro, par) });
  const a = await criarApp();
  const b = await criarApp();
  await acessar(v, a);
  await acessar(v, b);
  // Cada anfitrião falso manda a sua oferta; cada uma chega só ao par da sua sessão.
  await aguardar(() => (pares.get(a.id())?.sinaisRecebidos.length ?? 0) > 0 && (pares.get(b.id())?.sinaisRecebidos.length ?? 0) > 0);
  assert.equal(pares.get(a.id())?.sinaisRecebidos.length, 1);
  assert.equal(pares.get(b.id())?.sinaisRecebidos.length, 1);
});

test('limites: não repete o mesmo computador, no máximo 4, e quem é acessado não acessa', async () => {
  const v = await criarApp();
  const anfitrioes = [await criarApp(), await criarApp(), await criarApp(), await criarApp()];
  await acessar(v, anfitrioes[0]!);
  assert.equal(v.gerenciador.conectar(anfitrioes[0]!.id()), 'ja_aberta');
  for (const a of anfitrioes.slice(1)) await acessar(v, a);
  const quinto = await criarApp();
  assert.equal(v.gerenciador.conectar(quinto.id()), 'limite');
  assert.equal(v.gerenciador.quantidade, 4);
  // Quem está sendo acessado não acessa outros.
  assert.equal(anfitrioes[0]!.gerenciador.conectar(quinto.id()), 'hospedando');
});

test('quem acessa outros computadores não é acessado (ocupado)', async () => {
  const v = await criarApp();
  const a = await criarApp();
  const outro = await criarApp();
  await acessar(v, a);
  assert.equal(outro.gerenciador.conectar(v.id()), null);
  await aguardar(() => outro.gerenciador.quantidade === 0);
  assert.deepEqual(outro.avisos, [[v.id(), 'O outro computador já está em uma sessão.']]);
  assert.equal(v.gerenciador.quantidade, 1); // nenhum pedido chegou ao visualizador
});

test('servidor reinicia: as duas sessões continuam e são retomadas', async () => {
  // Só sessão cuja conexão direta já funcionou sobrevive à queda do servidor.
  const pares: ParFalso[] = [];
  const anotar = { aoCriarPar: (_parceiro: IdCliente, par: ParFalso) => pares.push(par) };
  const v = await criarApp(anotar);
  const a = await criarApp(anotar);
  const b = await criarApp(anotar);
  await acessar(v, a);
  await acessar(v, b);
  for (const par of pares) par.conectar();
  const porta = servidor.porta;
  await servidor.fechar();
  await subirServidor(porta);
  // Todos voltam e declaram; as sessões seguem abertas nos três.
  await aguardar(() => v.sinalizacao.estado.fase === 'online' && a.sinalizacao.estado.fase === 'online' && b.sinalizacao.estado.fase === 'online', 5000);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(fase(v, a.id()), 'em_sessao');
  assert.equal(fase(v, b.id()), 'em_sessao');
  // Encerrar pelo servidor funciona de novo (as sessões foram religadas).
  v.gerenciador.obter(b.id())?.encerrar();
  await aguardar(() => b.gerenciador.quantidade === 0);
  assert.equal(fase(v, a.id()), 'em_sessao');
});

test('pedido recusado por um computador não afeta a sessão com outro', async () => {
  const v = await criarApp();
  const a = await criarApp();
  const b = await criarApp();
  await acessar(v, a);
  v.gerenciador.conectar(b.id());
  await aguardar(() => fase(b, v.id()) === 'pedido_recebido');
  b.gerenciador.obter(v.id())?.responderPedido(false);
  await aguardar(() => v.gerenciador.obter(b.id()) === undefined);
  assert.deepEqual(v.avisos, [[b.id(), 'O outro computador recusou o acesso.']]);
  assert.equal(fase(v, a.id()), 'em_sessao');
});
