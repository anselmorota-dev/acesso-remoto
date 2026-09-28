// Testa o cliente de sinalização contra o servidor real. Roda no Node,
// que tem o mesmo WebSocket global do navegador.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { iniciarServidorCalado, novaIdentidade, type IdentidadeTeste } from '@acesso-remoto/server/auxiliares-teste';
import { InstalacoesEmMemoria } from '@acesso-remoto/server/instalacoes';
import { iniciarServidor, type OpcoesServidor, type ServidorSinalizacao } from '@acesso-remoto/server/servidor';
import { PROTOCOL_VERSION } from '@acesso-remoto/shared';
import {
  ClienteSinalizacao,
  type EstadoSinalizacao,
  type IdentidadeCliente,
  type OpcoesSinalizacao,
} from './sinalizacao';

const limpezas: Array<() => unknown> = [];
afterEach(async () => {
  for (const limpar of limpezas.splice(0).reverse()) await limpar();
});

async function subirServidor(porta = 0, opcoes: Partial<OpcoesServidor> = {}): Promise<ServidorSinalizacao> {
  const servidor = await iniciarServidor({ porta, log: () => {}, ...opcoes });
  limpezas.push(() => servidor.fechar());
  return servidor;
}

/** Identidade de teste no formato que o cliente espera (no app, quem assina é o main). */
function identidadeCliente(identidade: IdentidadeTeste = novaIdentidade()): IdentidadeCliente {
  return {
    chavePublica: async () => identidade.chavePublica,
    assinarDesafio: async (desafio) => identidade.assinar(desafio),
  };
}

/** Cria um cliente que registra todos os estados pelos quais passou. */
function criarCliente(url: string, extras: Partial<OpcoesSinalizacao> = {}) {
  const estados: EstadoSinalizacao[] = [];
  const cliente = new ClienteSinalizacao({
    url,
    identidade: identidadeCliente(),
    esperasReconexaoMs: [50, 100],
    aoMudarEstado: (estado) => estados.push(estado),
    ...extras,
  });
  limpezas.push(() => cliente.parar());
  return { cliente, estados };
}

async function aguardar(condicao: () => boolean, limiteMs = 3000): Promise<void> {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > limiteMs) throw new Error('Tempo esgotado');
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('conecta, registra e fica online com um ID válido', async () => {
  const servidor = await subirServidor();
  const { cliente, estados } = criarCliente(`ws://127.0.0.1:${servidor.porta}`);
  cliente.iniciar();

  await aguardar(() => cliente.estado.fase === 'online');
  assert.deepEqual(
    estados.map((e) => e.fase),
    ['conectando', 'online'],
  );
  const estado = cliente.estado;
  assert.ok(estado.fase === 'online' && /^[1-9]\d{8}$/.test(estado.id));
  assert.equal(servidor.quantidadeRegistrados(), 1);
});

test('fica offline e continua tentando enquanto não há servidor', async () => {
  const servidor = await subirServidor();
  const porta = servidor.porta;
  await servidor.fechar(); // porta agora sem ninguém escutando

  const { cliente, estados } = criarCliente(`ws://127.0.0.1:${porta}`);
  cliente.iniciar();

  await aguardar(() => estados.filter((e) => e.fase === 'offline').length >= 3);
  // As esperas seguem a lista e repetem a última.
  const esperas = estados.flatMap((e) => (e.fase === 'offline' ? [e.proximaTentativaMs] : []));
  assert.deepEqual(esperas.slice(0, 3), [50, 100, 100]);
});

test('reconecta quando o servidor volta e mantém o mesmo ID', async () => {
  const instalacoes = new InstalacoesEmMemoria(); // faz o papel do banco (sobrevive ao reinício)
  const primeiro = await subirServidor(0, { instalacoes });
  const porta = primeiro.porta;
  const { cliente, estados } = criarCliente(`ws://127.0.0.1:${porta}`);
  cliente.iniciar();
  await aguardar(() => cliente.estado.fase === 'online');
  const idAntes = cliente.estado.fase === 'online' ? cliente.estado.id : '';

  await primeiro.fechar(); // servidor cai (ex.: Render reiniciou)
  await aguardar(() => cliente.estado.fase === 'offline');

  const segundo = await subirServidor(porta, { instalacoes }); // volta na mesma porta
  await aguardar(() => cliente.estado.fase === 'online');
  assert.equal(segundo.quantidadeRegistrados(), 1);
  assert.equal(estados.filter((e) => e.fase === 'online').length, 2);
  assert.ok(cliente.estado.fase === 'online' && cliente.estado.id === idAntes);
});

test('outra cópia da mesma instalação conecta: a antiga para de tentar', async () => {
  const servidor = await subirServidor();
  const url = `ws://127.0.0.1:${servidor.porta}`;
  const identidade = identidadeCliente();
  const { cliente: antiga, estados } = criarCliente(url, { identidade });
  antiga.iniciar();
  await aguardar(() => antiga.estado.fase === 'online');

  const { cliente: nova } = criarCliente(url, { identidade });
  nova.iniciar();
  await aguardar(() => antiga.estado.fase === 'substituida' && nova.estado.fase === 'online');
  await new Promise((r) => setTimeout(r, 300)); // tempo de sobra para uma reconexão indevida
  assert.equal(estados.at(-1)?.fase, 'substituida');
  assert.equal(nova.estado.fase, 'online');
  assert.equal(servidor.quantidadeRegistrados(), 1);
});

test('identidade com defeito não registra, mas continua tentando', async () => {
  const servidor = await subirServidor();
  const quebrada: IdentidadeCliente = {
    chavePublica: () => Promise.reject(new Error('arquivo de identidade ilegível')),
    assinarDesafio: () => Promise.reject(new Error('sem chave')),
  };
  const { cliente, estados } = criarCliente(`ws://127.0.0.1:${servidor.porta}`, { identidade: quebrada });
  cliente.iniciar();
  await aguardar(() => estados.filter((e) => e.fase === 'offline').length >= 2);
  assert.equal(servidor.quantidadeRegistrados(), 0);
});

test('parar fecha a conexão e não tenta reconectar', async () => {
  const servidor = await subirServidor();
  const { cliente, estados } = criarCliente(`ws://127.0.0.1:${servidor.porta}`);
  cliente.iniciar();
  await aguardar(() => cliente.estado.fase === 'online');

  cliente.parar();
  await aguardar(() => servidor.quantidadeRegistrados() === 0);
  await new Promise((r) => setTimeout(r, 200)); // tempo de sobra para uma reconexão indevida
  assert.equal(estados.at(-1)?.fase, 'online');
  assert.equal(servidor.quantidadeRegistrados(), 0);
});

test('com o servidor respondendo, o ping mantém a conexão sem reconectar', async () => {
  const servidor = await subirServidor();
  const { cliente, estados } = criarCliente(`ws://127.0.0.1:${servidor.porta}`, {
    intervaloPingMs: 20,
    prazoSilencioMs: 100,
  });
  cliente.iniciar();
  await aguardar(() => cliente.estado.fase === 'online');
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(
    estados.map((e) => e.fase),
    ['conectando', 'online'],
  );
});

test('servidor calado demais (rede caída em silêncio): a conexão é dada como morta e o app reconecta', async () => {
  const calado = await iniciarServidorCalado();
  limpezas.push(() => calado.fechar());
  const { cliente, estados } = criarCliente(`ws://127.0.0.1:${calado.porta}`, {
    intervaloPingMs: 20,
    prazoSilencioMs: 100,
  });
  cliente.iniciar();
  await aguardar(() => estados.filter((e) => e.fase === 'online').length >= 2);
  assert.deepEqual(
    estados.slice(0, 4).map((e) => e.fase),
    ['conectando', 'online', 'offline', 'conectando'],
  );
  assert.ok(calado.conexoes() >= 2);
});

test('verificarConexao: sem resposta no prazo curto, reconecta na hora', async () => {
  const calado = await iniciarServidorCalado();
  limpezas.push(() => calado.fechar());
  const { cliente, estados } = criarCliente(`ws://127.0.0.1:${calado.porta}`, {
    // Ping periódico longo: só a verificação pedida pode perceber a queda.
    intervaloPingMs: 60_000,
    prazoSilencioMs: 120_000,
    prazoVerificacaoMs: 50,
  });
  cliente.iniciar();
  await aguardar(() => cliente.estado.fase === 'online');
  cliente.verificarConexao();
  await aguardar(() => estados.some((e) => e.fase === 'offline'), 1000);
});

test('verificarConexao com o servidor respondendo não derruba nada', async () => {
  const servidor = await subirServidor();
  const { cliente, estados } = criarCliente(`ws://127.0.0.1:${servidor.porta}`, { prazoVerificacaoMs: 50 });
  cliente.iniciar();
  await aguardar(() => cliente.estado.fase === 'online');
  cliente.verificarConexao();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(estados.at(-1)?.fase, 'online');
  assert.equal(estados.length, 2);
});

test('versão incompatível para as tentativas e avisa o motivo', async () => {
  const servidor = await subirServidor();
  const { cliente, estados } = criarCliente(`ws://127.0.0.1:${servidor.porta}`, {
    versaoProtocolo: PROTOCOL_VERSION + 1,
  });
  cliente.iniciar();

  await aguardar(() => cliente.estado.fase === 'incompativel');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(estados.at(-1)?.fase, 'incompativel');
  assert.equal(estados.filter((e) => e.fase === 'conectando').length, 1);
});
