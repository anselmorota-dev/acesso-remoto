// Testa o cliente de sinalização contra o servidor real. Roda no Node,
// que tem o mesmo WebSocket global do navegador.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { iniciarServidor, type ServidorSinalizacao } from '@acesso-remoto/server/servidor';
import { PROTOCOL_VERSION } from '@acesso-remoto/shared';
import { ClienteSinalizacao, type EstadoSinalizacao } from './sinalizacao';

const limpezas: Array<() => unknown> = [];
afterEach(async () => {
  for (const limpar of limpezas.splice(0).reverse()) await limpar();
});

async function subirServidor(porta = 0): Promise<ServidorSinalizacao> {
  const servidor = await iniciarServidor({ porta, log: () => {} });
  limpezas.push(() => servidor.fechar());
  return servidor;
}

/** Cria um cliente que registra todos os estados pelos quais passou. */
function criarCliente(url: string, extras: { versaoProtocolo?: number } = {}) {
  const estados: EstadoSinalizacao[] = [];
  const cliente = new ClienteSinalizacao({
    url,
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

test('reconecta e recebe um novo ID quando o servidor volta', async () => {
  const primeiro = await subirServidor();
  const porta = primeiro.porta;
  const { cliente, estados } = criarCliente(`ws://127.0.0.1:${porta}`);
  cliente.iniciar();
  await aguardar(() => cliente.estado.fase === 'online');

  await primeiro.fechar(); // servidor cai (ex.: Render reiniciou)
  await aguardar(() => cliente.estado.fase === 'offline');

  const segundo = await subirServidor(porta); // volta na mesma porta
  await aguardar(() => cliente.estado.fase === 'online');
  assert.equal(segundo.quantidadeRegistrados(), 1);
  assert.equal(estados.filter((e) => e.fase === 'online').length, 2);
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
