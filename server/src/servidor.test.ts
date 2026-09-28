// Testes de ponta a ponta: sobe o servidor numa porta livre e conecta
// clientes WebSocket de verdade, como o app fará.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '@acesso-remoto/shared';
import { iniciarServidor, type OpcoesServidor, type ServidorSinalizacao } from './servidor.js';
import {
  aguardar,
  completarRegistro,
  conectarCliente,
  encerrarClientes,
  novaIdentidade,
  registrarCliente,
} from './auxiliares-teste.js';
import { InstalacoesEmMemoria } from './instalacoes.js';

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
  // 20 instalações novas do mesmo IP: acima do limite padrão (testado à parte).
  await servidor.fechar();
  await subir({ limites: { instalacoesNovasPorHora: 100 } });
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
    { tipo: 'registrar', versao: PROTOCOL_VERSION, chavePublica: 'curta-demais' },
    { tipo: 'provar', assinatura: 'nao-e-assinatura' },
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
  assert.match(await completarRegistro(cliente, novaIdentidade()), /^[1-9]\d{8}$/);
});

test('mensagens que exigem ID são recusadas antes do registro', async () => {
  const cliente = await conectar();
  cliente.enviar({ tipo: 'conectar', destino: '123456789', comSenha: false });
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
  await completarRegistro(morto, novaIdentidade());
  assert.equal(servidor.quantidadeRegistrados(), 2);

  await morto.fechado;
  await aguardar(() => servidor.quantidadeRegistrados() === 1);
  assert.equal(saudavel.socket.readyState, WebSocket.OPEN);
});

test('ping do app recebe pong (o app usa isso para saber que a conexão está viva)', async () => {
  const cliente = await conectarRegistrado();
  cliente.enviar({ tipo: 'ping' });
  assert.deepEqual(await cliente.proxima(), { tipo: 'pong' });
});

test('ping do app também mantém viva uma conexão cujo ping do WebSocket não volta', async () => {
  // O app manda o seu ping a cada 20 s; o heartbeat do servidor é de 30 s.
  await servidor.fechar();
  await subir({ intervaloHeartbeatMs: 100 });
  const cliente = await conectar({ autoPong: false });
  await completarRegistro(cliente, novaIdentidade());
  const pingar = setInterval(() => cliente.enviar({ tipo: 'ping' }), 30);
  try {
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(cliente.socket.readyState, WebSocket.OPEN);
  } finally {
    clearInterval(pingar);
  }
});

// ---------------------------------------------------------------------------
// ID fixo por instalação (identidade com chave pública + desafio)
// ---------------------------------------------------------------------------

test('a mesma instalação recebe sempre o mesmo ID, mesmo depois de reconectar', async () => {
  const identidade = novaIdentidade();
  const primeira = await registrarCliente(servidor.porta, identidade);
  primeira.socket.close();
  await aguardar(() => servidor.quantidadeRegistrados() === 0);
  const segunda = await registrarCliente(servidor.porta, identidade);
  assert.equal(segunda.id, primeira.id);
});

test('com repositório persistente, o ID sobrevive a reiniciar o servidor', async () => {
  const instalacoes = new InstalacoesEmMemoria(); // faz o papel do banco
  await servidor.fechar();
  await subir({ instalacoes });
  const identidade = novaIdentidade();
  const antes = await registrarCliente(servidor.porta, identidade);

  encerrarClientes();
  await servidor.fechar();
  await subir({ instalacoes });
  const depois = await registrarCliente(servidor.porta, identidade);
  assert.equal(depois.id, antes.id);
});

test('registrar sem chave pública é recusado', async () => {
  const cliente = await conectar();
  cliente.enviar({ tipo: 'registrar', versao: PROTOCOL_VERSION });
  const resposta = await cliente.proxima();
  assert.equal(resposta.tipo === 'erro' && resposta.codigo, 'mensagem_invalida');
});

test('assinatura de outra chave é recusada e a conexão fechada', async () => {
  const dono = novaIdentidade();
  const impostor = novaIdentidade();
  const cliente = await conectar();
  // O impostor apresenta a chave pública do dono, mas não tem a chave privada dele.
  cliente.enviar({ tipo: 'registrar', versao: PROTOCOL_VERSION, chavePublica: dono.chavePublica });
  const desafio = await cliente.proxima();
  assert.ok(desafio.tipo === 'desafio');
  cliente.enviar({ tipo: 'provar', assinatura: impostor.assinar(desafio.desafio) });
  const resposta = await cliente.proxima();
  assert.equal(resposta.tipo === 'erro' && resposta.codigo, 'assinatura_invalida');
  assert.equal(await cliente.fechado, 1008);
  assert.equal(servidor.quantidadeRegistrados(), 0);
});

test('provar sem desafio pendente é recusado', async () => {
  const cliente = await conectar();
  cliente.enviar({ tipo: 'provar', assinatura: 'A'.repeat(86) });
  const resposta = await cliente.proxima();
  assert.equal(resposta.tipo === 'erro' && resposta.codigo, 'assinatura_invalida');
});

test('assinatura de um desafio antigo não vale para um novo', async () => {
  const identidade = novaIdentidade();
  const primeira = await conectar();
  primeira.enviar({ tipo: 'registrar', versao: PROTOCOL_VERSION, chavePublica: identidade.chavePublica });
  const antigo = await primeira.proxima();
  assert.ok(antigo.tipo === 'desafio');
  const assinaturaAntiga = identidade.assinar(antigo.desafio);

  // Quem capturasse essa assinatura não conseguiria usá-la numa outra conexão.
  const outra = await conectar();
  outra.enviar({ tipo: 'registrar', versao: PROTOCOL_VERSION, chavePublica: identidade.chavePublica });
  const novo = await outra.proxima();
  assert.ok(novo.tipo === 'desafio' && novo.desafio !== antigo.desafio);
  outra.enviar({ tipo: 'provar', assinatura: assinaturaAntiga });
  const resposta = await outra.proxima();
  assert.equal(resposta.tipo === 'erro' && resposta.codigo, 'assinatura_invalida');
});

test('a mesma instalação conectando de novo substitui a conexão antiga', async () => {
  const identidade = novaIdentidade();
  const antiga = await registrarCliente(servidor.porta, identidade);
  const nova = await registrarCliente(servidor.porta, identidade);
  assert.equal(nova.id, antiga.id);

  const aviso = await antiga.proxima();
  assert.equal(aviso.tipo === 'erro' && aviso.codigo, 'substituida');
  assert.equal(await antiga.fechado, 1008);
  assert.equal(servidor.quantidadeRegistrados(), 1);
  assert.equal(nova.socket.readyState, WebSocket.OPEN);
});

test('banco fora do ar: o app recebe "indisponivel" e pode tentar de novo', async () => {
  await servidor.fechar();
  await subir({
    instalacoes: {
      buscarId: () => Promise.reject(new Error('banco fora do ar')),
      criarId: () => Promise.reject(new Error('banco fora do ar')),
      fechar: async () => {},
    },
  });
  const identidade = novaIdentidade();
  const cliente = await conectar();
  cliente.enviar({ tipo: 'registrar', versao: PROTOCOL_VERSION, chavePublica: identidade.chavePublica });
  const desafio = await cliente.proxima();
  assert.ok(desafio.tipo === 'desafio');
  cliente.enviar({ tipo: 'provar', assinatura: identidade.assinar(desafio.desafio) });
  const resposta = await cliente.proxima();
  assert.equal(resposta.tipo === 'erro' && resposta.codigo, 'indisponivel');
  assert.equal(await cliente.fechado, 1011); // 1011 = erro interno do servidor
});

test('rota /saude responde ok', async () => {
  const resposta = await fetch(`http://127.0.0.1:${servidor.porta}/saude`);
  assert.equal(resposta.status, 200);
  assert.equal(await resposta.text(), 'ok');
});

// ---------------------------------------------------------------------------
// Limites de tentativas (3.5)
// ---------------------------------------------------------------------------

test('muitos pedidos de conexão seguidos: "limite_excedido"', async () => {
  await servidor.fechar();
  await subir({ limites: { pedidosPorMinuto: 3 } });
  const cliente = await conectarRegistrado();
  const respostas: string[] = [];
  for (let i = 0; i < 4; i++) {
    cliente.enviar({ tipo: 'conectar', destino: '123456789', comSenha: false }); // ID offline
    const resposta = await cliente.proxima();
    respostas.push(resposta.tipo === 'erro' ? resposta.codigo : resposta.tipo);
  }
  assert.deepEqual(respostas, ['pedido_recusado', 'pedido_recusado', 'pedido_recusado', 'limite_excedido']);
});

/** Tenta registrar uma instalação nova e devolve a resposta ao "provar". */
async function tentarInstalacaoNova(ip: string) {
  const cliente = await conectarCliente(servidor.porta, { ip });
  const identidade = novaIdentidade();
  cliente.enviar({ tipo: 'registrar', versao: PROTOCOL_VERSION, chavePublica: identidade.chavePublica });
  const desafio = await cliente.proxima();
  assert.ok(desafio.tipo === 'desafio');
  cliente.enviar({ tipo: 'provar', assinatura: identidade.assinar(desafio.desafio) });
  return { resposta: await cliente.proxima(), cliente };
}

test('instalações novas por IP são limitadas; instalações já conhecidas continuam entrando', async () => {
  await servidor.fechar();
  await subir({ limites: { instalacoesNovasPorHora: 2 }, proxiesConfiaveis: 1 });
  const conhecida = novaIdentidade();
  await registrarCliente(servidor.porta, conhecida, '200.1.1.1');
  await registrarCliente(servidor.porta, novaIdentidade(), '200.1.1.1');

  // Terceira instalação nova do mesmo IP: recusada.
  const { resposta, cliente } = await tentarInstalacaoNova('200.1.1.1');
  assert.equal(resposta.tipo === 'erro' && resposta.codigo, 'limite_excedido');
  assert.equal(await cliente.fechado, 1008);

  // A instalação que já existia entra normalmente; outro IP também cria.
  await registrarCliente(servidor.porta, conhecida, '200.1.1.1');
  await registrarCliente(servidor.porta, novaIdentidade(), '200.9.9.9');
});

test('IP forjado no começo do X-Forwarded-For não escapa do limite', async () => {
  await servidor.fechar();
  await subir({ limites: { instalacoesNovasPorHora: 1 }, proxiesConfiaveis: 1 });
  // O cliente põe um IP inventado no começo; o proxy acrescenta o real no fim.
  await registrarCliente(servidor.porta, novaIdentidade(), '1.1.1.1, 200.1.1.1');
  const { resposta } = await tentarInstalacaoNova('2.2.2.2, 200.1.1.1');
  assert.equal(resposta.tipo === 'erro' && resposta.codigo, 'limite_excedido');
});
