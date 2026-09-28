// Testes do fluxo pedido → aceite → sessão → repasse de sinais → encerramento.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { Sinal } from '@acesso-remoto/shared';
import { iniciarServidor, type OpcoesServidor, type ServidorSinalizacao } from './servidor.js';
import { encerrarClientes, registrarCliente, type ClienteTeste } from './auxiliares-teste.js';

let servidor: ServidorSinalizacao;

async function subir(opcoes: Partial<OpcoesServidor> = {}): Promise<void> {
  servidor = await iniciarServidor({ porta: 0, log: () => {}, ...opcoes });
}

beforeEach(() => subir());

afterEach(async () => {
  encerrarClientes();
  await servidor.fechar();
});

type Registrado = ClienteTeste & { id: string };
const registrado = (): Promise<Registrado> => registrarCliente(servidor.porta);

const oferta: Sinal = { tipo: 'oferta', sdp: 'v=0 (oferta de teste)' };
const ice: Sinal = {
  tipo: 'ice',
  candidato: { candidate: 'candidate:1 1 udp 1 127.0.0.1 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 },
};

/** Visualizador pede, anfitrião recebe o pedido. */
async function pedir(visualizador: Registrado, anfitriao: Registrado): Promise<void> {
  visualizador.enviar({ tipo: 'conectar', destino: anfitriao.id });
  assert.deepEqual(await anfitriao.proxima(), { tipo: 'pedido_conexao', origem: visualizador.id });
}

/** Leva os dois até uma sessão iniciada. */
async function emSessao(): Promise<{ visualizador: Registrado; anfitriao: Registrado }> {
  const visualizador = await registrado();
  const anfitriao = await registrado();
  await pedir(visualizador, anfitriao);
  anfitriao.enviar({ tipo: 'responder_pedido', origem: visualizador.id, aceito: true });
  assert.deepEqual(await visualizador.proxima(), {
    tipo: 'sessao_iniciada',
    parceiro: anfitriao.id,
    papel: 'visualizador',
  });
  assert.deepEqual(await anfitriao.proxima(), {
    tipo: 'sessao_iniciada',
    parceiro: visualizador.id,
    papel: 'anfitriao',
  });
  return { visualizador, anfitriao };
}

test('pedido aceito inicia a sessão para os dois lados', async () => {
  await emSessao();
});

test('sinais são repassados entre os dois lados da sessão', async () => {
  const { visualizador, anfitriao } = await emSessao();

  anfitriao.enviar({ tipo: 'sinal', sinal: oferta });
  assert.deepEqual(await visualizador.proxima(), { tipo: 'sinal', sinal: oferta });

  visualizador.enviar({ tipo: 'sinal', sinal: ice });
  assert.deepEqual(await anfitriao.proxima(), { tipo: 'sinal', sinal: ice });
});

test('pedido recusado avisa o visualizador e não cria sessão', async () => {
  const visualizador = await registrado();
  const anfitriao = await registrado();
  await pedir(visualizador, anfitriao);

  anfitriao.enviar({ tipo: 'responder_pedido', origem: visualizador.id, aceito: false });
  assert.deepEqual(await visualizador.proxima(), {
    tipo: 'pedido_recusado',
    destino: anfitriao.id,
    motivo: 'recusado',
  });

  // Sem sessão, sinais não passam.
  visualizador.enviar({ tipo: 'sinal', sinal: ice });
  const erro = await visualizador.proxima();
  assert.equal(erro.tipo === 'erro' && erro.codigo, 'sem_sessao');
  await anfitriao.nadaRecebidoEm();
});

test('sinal fora de sessão é recusado e não chega a ninguém', async () => {
  const intruso = await registrado();
  const alvo = await registrado();
  intruso.enviar({ tipo: 'sinal', sinal: oferta });
  const erro = await intruso.proxima();
  assert.equal(erro.tipo === 'erro' && erro.codigo, 'sem_sessao');
  await alvo.nadaRecebidoEm();
});

test('pedir para um ID offline é recusado na hora', async () => {
  const visualizador = await registrado();
  visualizador.enviar({ tipo: 'conectar', destino: '123456789' });
  assert.deepEqual(await visualizador.proxima(), {
    tipo: 'pedido_recusado',
    destino: '123456789',
    motivo: 'offline',
  });
});

test('não é possível pedir conexão para o próprio ID', async () => {
  const cliente = await registrado();
  cliente.enviar({ tipo: 'conectar', destino: cliente.id });
  const erro = await cliente.proxima();
  assert.equal(erro.tipo === 'erro' && erro.codigo, 'destino_invalido');
});

test('anfitrião ocupado recusa novos pedidos', async () => {
  const { anfitriao } = await emSessao();
  const outro = await registrado();
  outro.enviar({ tipo: 'conectar', destino: anfitriao.id });
  assert.deepEqual(await outro.proxima(), {
    tipo: 'pedido_recusado',
    destino: anfitriao.id,
    motivo: 'ocupado',
  });
  await anfitriao.nadaRecebidoEm();
});

test('anfitrião com pedido pendente também conta como ocupado', async () => {
  const primeiro = await registrado();
  const anfitriao = await registrado();
  await pedir(primeiro, anfitriao);
  const segundo = await registrado();
  segundo.enviar({ tipo: 'conectar', destino: anfitriao.id });
  const resposta = await segundo.proxima();
  assert.equal(resposta.tipo === 'pedido_recusado' && resposta.motivo, 'ocupado');
});

test('visualizador não pode abrir dois pedidos ao mesmo tempo', async () => {
  const visualizador = await registrado();
  const anfitriao = await registrado();
  await pedir(visualizador, anfitriao);
  const outro = await registrado();
  visualizador.enviar({ tipo: 'conectar', destino: outro.id });
  const erro = await visualizador.proxima();
  assert.equal(erro.tipo === 'erro' && erro.codigo, 'ja_em_sessao');
  await outro.nadaRecebidoEm();
});

test('responder a um pedido inexistente é recusado', async () => {
  const anfitriao = await registrado();
  const qualquer = await registrado();
  anfitriao.enviar({ tipo: 'responder_pedido', origem: qualquer.id, aceito: true });
  const erro = await anfitriao.proxima();
  assert.equal(erro.tipo === 'erro' && erro.codigo, 'pedido_inexistente');
  await qualquer.nadaRecebidoEm();
});

test('pedido expira se o anfitrião não responder a tempo', async () => {
  await servidor.fechar();
  await subir({ prazoRespostaPedidoMs: 100 });
  const visualizador = await registrado();
  const anfitriao = await registrado();
  await pedir(visualizador, anfitriao);

  assert.deepEqual(await visualizador.proxima(), {
    tipo: 'pedido_recusado',
    destino: anfitriao.id,
    motivo: 'sem_resposta',
  });
  assert.deepEqual(await anfitriao.proxima(), { tipo: 'pedido_cancelado', origem: visualizador.id });

  // Aceitar depois do prazo não vale mais.
  anfitriao.enviar({ tipo: 'responder_pedido', origem: visualizador.id, aceito: true });
  const erro = await anfitriao.proxima();
  assert.equal(erro.tipo === 'erro' && erro.codigo, 'pedido_inexistente');
});

test('visualizador pode cancelar o pedido antes da resposta', async () => {
  const visualizador = await registrado();
  const anfitriao = await registrado();
  await pedir(visualizador, anfitriao);
  visualizador.enviar({ tipo: 'encerrar' });
  assert.deepEqual(await anfitriao.proxima(), { tipo: 'pedido_cancelado', origem: visualizador.id });

  // Os dois ficam livres: um novo pedido funciona.
  await pedir(visualizador, anfitriao);
});

test('visualizador que cai durante o pedido cancela o pedido', async () => {
  const visualizador = await registrado();
  const anfitriao = await registrado();
  await pedir(visualizador, anfitriao);
  visualizador.socket.terminate();
  assert.deepEqual(await anfitriao.proxima(), { tipo: 'pedido_cancelado', origem: visualizador.id });
});

test('anfitrião que cai com pedido pendente aparece como offline', async () => {
  const visualizador = await registrado();
  const anfitriao = await registrado();
  await pedir(visualizador, anfitriao);
  anfitriao.socket.terminate();
  const resposta = await visualizador.proxima();
  assert.equal(resposta.tipo === 'pedido_recusado' && resposta.motivo, 'offline');
});

test('encerrar avisa o parceiro e libera os dois', async () => {
  const { visualizador, anfitriao } = await emSessao();
  visualizador.enviar({ tipo: 'encerrar' });
  assert.deepEqual(await anfitriao.proxima(), {
    tipo: 'sessao_encerrada',
    motivo: 'encerrada_pelo_parceiro',
  });

  // Depois de encerrar, sinais não passam mais...
  anfitriao.enviar({ tipo: 'sinal', sinal: oferta });
  const erro = await anfitriao.proxima();
  assert.equal(erro.tipo === 'erro' && erro.codigo, 'sem_sessao');
  // ...e uma nova sessão pode começar.
  await pedir(visualizador, anfitriao);
});

test('o motivo de uma falha é repassado ao parceiro', async () => {
  const { visualizador, anfitriao } = await emSessao();
  anfitriao.enviar({ tipo: 'encerrar', motivo: 'captura_indisponivel' });
  assert.deepEqual(await visualizador.proxima(), {
    tipo: 'sessao_encerrada',
    motivo: 'captura_indisponivel',
  });
});

test('queda de um lado encerra a sessão do outro', async () => {
  const { visualizador, anfitriao } = await emSessao();
  anfitriao.socket.terminate();
  assert.deepEqual(await visualizador.proxima(), {
    tipo: 'sessao_encerrada',
    motivo: 'parceiro_desconectou',
  });
});

test('sinais com formato inválido são barrados pelo servidor', async () => {
  const { visualizador, anfitriao } = await emSessao();
  visualizador.enviar({ tipo: 'sinal', sinal: { tipo: 'oferta', sdp: '' } });
  visualizador.enviar({ tipo: 'sinal', sinal: { tipo: 'script', codigo: 'alert(1)' } });
  for (let i = 0; i < 2; i++) {
    const erro = await visualizador.proxima();
    assert.equal(erro.tipo === 'erro' && erro.codigo, 'mensagem_invalida');
  }
  await anfitriao.nadaRecebidoEm();
});
