// Testes de ponta a ponta: sobe o servidor numa porta livre e conecta
// clientes WebSocket de verdade, como o app fará.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '@acesso-remoto/shared';
import { iniciarServidor, type OpcoesServidor, type ServidorSinalizacao } from './servidor.js';
import { aguardar, conectarCliente, encerrarClientes, registrarCliente } from './auxiliares-teste.js';

let servidor: ServidorSinalizacao;

async function subir(opcoes: Partial<OpcoesServidor> = {}): Promise<void> {
  servidor = await iniciarServidor({ porta: 0, log: () => {}, ...opcoes });
}

beforeEach(() => subir());

afterEach(async () => {
  encerrarClientes();
  await servidor.fechar();
});

const conectar = (opcoes?: { autoPong?: boolean }) => conectarCliente(servidor.porta, opcoes);
const conectarRegistrado = () => registrarCliente(servidor.porta);

test('registrar devolve um ID de 9 dígitos', async () => {
  const { id } = await conectarRegistrado();
  assert.match(id, /^[1-9]\d{8}$/);
  assert.equal(servidor.quantidadeRegistrados(), 1);
});

test('cada cliente recebe um ID diferente', async () => {
  const clientes = await Promise.all(Array.from({ length: 20 }, conectarRegistrado));
  const ids = new Set(clientes.map((c) => c.id));
  assert.equal(ids.size, 20);
});

test('o ID é liberado quando o cliente desconecta', async () => {
  const cliente = await conectarRegistrado();
  cliente.socket.close();
  await aguardar(() => servidor.quantidadeRegistrados() === 0);
});

test('registrar duas vezes na mesma conexão é recusado', async () => {
  const cliente = await conectarRegistrado();
  cliente.enviar({ tipo: 'registrar', versao: PROTOCOL_VERSION });
  const resposta = await cliente.proxima();
  assert.equal(resposta.tipo === 'erro' && resposta.codigo, 'ja_registrado');
  assert.equal(servidor.quantidadeRegistrados(), 1);
});

test('mensagens inválidas recebem erro sem derrubar a conexão', async () => {
  const cliente = await conectar();
  const invalidas = [
    'isto não é json',
    '[]',
    'null',
    { tipo: 'desconhecido' },
    { tipo: 'registrar' },
    { tipo: 'registrar', versao: 'um' },
  ];
  for (const invalida of invalidas) {
    cliente.enviar(invalida);
    const resposta = await cliente.proxima();
    assert.equal(resposta.tipo === 'erro' && resposta.codigo, 'mensagem_invalida', JSON.stringify(invalida));
  }
  cliente.socket.send(Buffer.from([1, 2, 3]), { binary: true });
  const resposta = await cliente.proxima();
  assert.equal(resposta.tipo === 'erro' && resposta.codigo, 'mensagem_invalida');

  // Depois dos erros, ainda consegue se registrar normalmente.
  cliente.enviar({ tipo: 'registrar', versao: PROTOCOL_VERSION });
  assert.equal((await cliente.proxima()).tipo, 'registrado');
});

test('mensagens que exigem ID são recusadas antes do registro', async () => {
  const cliente = await conectar();
  cliente.enviar({ tipo: 'conectar', destino: '123456789' });
  const resposta = await cliente.proxima();
  assert.equal(resposta.tipo === 'erro' && resposta.codigo, 'nao_registrado');
});

test('versão de protocolo diferente é recusada e a conexão fechada', async () => {
  const cliente = await conectar();
  cliente.enviar({ tipo: 'registrar', versao: PROTOCOL_VERSION + 1 });
  const resposta = await cliente.proxima();
  assert.equal(resposta.tipo === 'erro' && resposta.codigo, 'versao_incompativel');
  assert.equal(await cliente.fechado, 1008);
  assert.equal(servidor.quantidadeRegistrados(), 0);
});

test('mensagem acima do limite de tamanho derruba a conexão', async () => {
  const cliente = await conectar();
  cliente.enviar('x'.repeat(64 * 1024 + 1));
  assert.equal(await cliente.fechado, 1009); // 1009 = mensagem grande demais
});

test('quem não se registra dentro do prazo é desconectado', async () => {
  await servidor.fechar();
  await subir({ prazoRegistroMs: 100 });
  const cliente = await conectar();
  assert.equal(await cliente.fechado, 1008);
});

test('heartbeat derruba conexões que não respondem ao ping', async () => {
  await servidor.fechar();
  await subir({ intervaloHeartbeatMs: 50 });

  // Um cliente normal responde aos pings e continua conectado...
  const saudavel = await conectarRegistrado();
  // ...já este simula uma conexão morta: não responde pong.
  const morto = await conectar({ autoPong: false });
  morto.enviar({ tipo: 'registrar', versao: PROTOCOL_VERSION });
  await morto.proxima();
  assert.equal(servidor.quantidadeRegistrados(), 2);

  await morto.fechado;
  await aguardar(() => servidor.quantidadeRegistrados() === 1);
  assert.equal(saudavel.socket.readyState, WebSocket.OPEN);
});

test('rota /saude responde ok', async () => {
  const resposta = await fetch(`http://127.0.0.1:${servidor.porta}/saude`);
  assert.equal(resposta.status, 200);
  assert.equal(await resposta.text(), 'ok');
});
