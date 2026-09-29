// Testes do fluxo pedido → aceite → sessão → repasse de sinais → encerramento.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { Sinal } from '@acesso-remoto/shared';
import { iniciarServidor, type OpcoesServidor, type ServidorSinalizacao } from './servidor.js';
import { encerrarClientes, registrarCliente } from './auxiliares-teste.js';
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

type Registrado = Awaited<ReturnType<typeof registrarCliente>>;
const registrado = (): Promise<Registrado> => registrarCliente(servidor.porta);

const oferta: Sinal = { tipo: 'oferta', sdp: 'v=0 (oferta de teste)' };
const ice: Sinal = {
  tipo: 'ice',
  candidato: { candidate: 'candidate:1 1 udp 1 127.0.0.1 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 },
};

/** Visualizador pede, anfitrião recebe o pedido (com o prazo configurado no servidor). */
async function pedir(visualizador: Registrado, anfitriao: Registrado, prazoMs = 30_000, comSenha = false): Promise<void> {
  visualizador.enviar({ tipo: 'conectar', destino: anfitriao.id, comSenha });
  assert.deepEqual(await anfitriao.proxima(), { tipo: 'pedido_conexao', origem: visualizador.id, prazoMs, comSenha });
}

/** Leva os dois até uma sessão iniciada. */
async function emSessao(): Promise<{ visualizador: Registrado; anfitriao: Registrado }> {
  const visualizador = await registrado();
  const anfitriao = await registrado();
  await pedir(visualizador, anfitriao);
  anfitriao.enviar({ tipo: 'responder_pedido', origem: visualizador.id, aceito: true, porSenha: false });
  assert.deepEqual(await visualizador.proxima(), {
    tipo: 'sessao_iniciada',
    parceiro: anfitriao.id,
    papel: 'visualizador',
    porSenha: false,
  });
  assert.deepEqual(await anfitriao.proxima(), {
    tipo: 'sessao_iniciada',
    parceiro: visualizador.id,
    papel: 'anfitriao',
    porSenha: false,
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

  anfitriao.enviar({ tipo: 'responder_pedido', origem: visualizador.id, aceito: false, porSenha: false });
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
  visualizador.enviar({ tipo: 'conectar', destino: '123456789', comSenha: false });
  assert.deepEqual(await visualizador.proxima(), {
    tipo: 'pedido_recusado',
    destino: '123456789',
    motivo: 'offline',
  });
});

test('não é possível pedir conexão para o próprio ID', async () => {
  const cliente = await registrado();
  cliente.enviar({ tipo: 'conectar', destino: cliente.id, comSenha: false });
  const erro = await cliente.proxima();
  assert.equal(erro.tipo === 'erro' && erro.codigo, 'destino_invalido');
});

test('anfitrião ocupado recusa novos pedidos', async () => {
  const { anfitriao } = await emSessao();
  const outro = await registrado();
  outro.enviar({ tipo: 'conectar', destino: anfitriao.id, comSenha: false });
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
  segundo.enviar({ tipo: 'conectar', destino: anfitriao.id, comSenha: false });
  const resposta = await segundo.proxima();
  assert.equal(resposta.tipo === 'pedido_recusado' && resposta.motivo, 'ocupado');
});

test('visualizador não pode abrir dois pedidos ao mesmo tempo', async () => {
  const visualizador = await registrado();
  const anfitriao = await registrado();
  await pedir(visualizador, anfitriao);
  const outro = await registrado();
  visualizador.enviar({ tipo: 'conectar', destino: outro.id, comSenha: false });
  const erro = await visualizador.proxima();
  assert.equal(erro.tipo === 'erro' && erro.codigo, 'ja_em_sessao');
  await outro.nadaRecebidoEm();
});

test('responder a um pedido inexistente é recusado', async () => {
  const anfitriao = await registrado();
  const qualquer = await registrado();
  anfitriao.enviar({ tipo: 'responder_pedido', origem: qualquer.id, aceito: true, porSenha: false });
  const erro = await anfitriao.proxima();
  assert.equal(erro.tipo === 'erro' && erro.codigo, 'pedido_inexistente');
  await qualquer.nadaRecebidoEm();
});

test('pedido expira se o anfitrião não responder a tempo', async () => {
  await servidor.fechar();
  await subir({ prazoRespostaPedidoMs: 100 });
  const visualizador = await registrado();
  const anfitriao = await registrado();
  await pedir(visualizador, anfitriao, 100);

  assert.deepEqual(await visualizador.proxima(), {
    tipo: 'pedido_recusado',
    destino: anfitriao.id,
    motivo: 'sem_resposta',
  });
  assert.deepEqual(await anfitriao.proxima(), { tipo: 'pedido_cancelado', origem: visualizador.id });

  // Aceitar depois do prazo não vale mais.
  anfitriao.enviar({ tipo: 'responder_pedido', origem: visualizador.id, aceito: true, porSenha: false });
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

// ---------------------------------------------------------------------------
// Sessões longas: a sessão sobrevive a quedas do servidor (a conexão direta
// não passa por ele) e os dois lados são religados quando voltam.
// ---------------------------------------------------------------------------

/** A mesma instalação conectando de novo (mesma identidade = mesmo ID). */
const voltar = (cliente: Registrado): Promise<Registrado> => registrarCliente(servidor.porta, cliente.identidade);

test('queda de um lado não encerra a sessão: o outro é avisado e continua ocupado', async () => {
  const { visualizador, anfitriao } = await emSessao();
  anfitriao.socket.terminate();
  assert.deepEqual(await visualizador.proxima(), { tipo: 'parceiro_ausente', parceiro: anfitriao.id });

  // Continua em sessão: novos pedidos a ele são recusados...
  const outro = await registrado();
  outro.enviar({ tipo: 'conectar', destino: visualizador.id, comSenha: false });
  const resposta = await outro.proxima();
  assert.equal(resposta.tipo === 'pedido_recusado' && resposta.motivo, 'ocupado');
  // ...e sinais não têm para onde ir até o parceiro voltar.
  visualizador.enviar({ tipo: 'sinal', sinal: ice });
  const erro = await visualizador.proxima();
  assert.equal(erro.tipo === 'erro' && erro.codigo, 'sem_sessao');
});

test('quem cai e volta declara a sessão e os dois são religados', async () => {
  const { visualizador, anfitriao } = await emSessao();
  anfitriao.socket.terminate();
  await visualizador.proxima(); // parceiro_ausente

  const anfitriaoDeNovo = await voltar(anfitriao);
  anfitriaoDeNovo.enviar({ tipo: 'retomar', parceiro: visualizador.id, papel: 'anfitriao', porSenha: false });
  assert.deepEqual(await anfitriaoDeNovo.proxima(), { tipo: 'sessao_retomada', parceiro: visualizador.id });
  assert.deepEqual(await visualizador.proxima(), { tipo: 'sessao_retomada', parceiro: anfitriao.id });

  // Sinais voltam a passar (ex.: para reconectar a conexão direta).
  anfitriaoDeNovo.enviar({ tipo: 'sinal', sinal: oferta });
  assert.deepEqual(await visualizador.proxima(), { tipo: 'sinal', sinal: oferta });
});

test('servidor reiniciado: os dois declaram a sessão e são religados', async () => {
  // Os IDs sobrevivem ao reinício (em produção, no banco).
  const instalacoes = new InstalacoesEmMemoria();
  await servidor.fechar();
  await subir({ instalacoes });
  const { visualizador, anfitriao } = await emSessao();
  await servidor.fechar();
  await subir({ instalacoes });

  const v = await voltar(visualizador);
  const a = await voltar(anfitriao);
  v.enviar({ tipo: 'retomar', parceiro: anfitriao.id, papel: 'visualizador', porSenha: false });
  await v.nadaRecebidoEm(); // o parceiro ainda não declarou: espera
  a.enviar({ tipo: 'retomar', parceiro: visualizador.id, papel: 'anfitriao', porSenha: false });
  assert.deepEqual(await a.proxima(), { tipo: 'sessao_retomada', parceiro: visualizador.id });
  assert.deepEqual(await v.proxima(), { tipo: 'sessao_retomada', parceiro: anfitriao.id });
});

test('parceiro que volta sem a sessão (app reaberto): a espera acaba no prazo', async () => {
  await servidor.fechar();
  await subir({ prazoRetomadaMs: 100 });
  const { visualizador, anfitriao } = await emSessao();
  anfitriao.socket.terminate();
  await visualizador.proxima(); // parceiro_ausente

  // Voltou ao servidor, mas não declara sessão nenhuma.
  const anfitriaoDeNovo = await voltar(anfitriao);
  assert.deepEqual(await visualizador.proxima(), { tipo: 'sessao_encerrada', motivo: 'parceiro_desconectou' });
  // Os dois ficam livres.
  await pedir(visualizador, anfitriaoDeNovo);
});

test('declarações que não combinam não religam ninguém', async () => {
  const instalacoes = new InstalacoesEmMemoria();
  await servidor.fechar();
  await subir({ prazoRetomadaMs: 100, instalacoes });
  const { visualizador, anfitriao } = await emSessao();
  await servidor.fechar();
  await subir({ prazoRetomadaMs: 100, instalacoes });

  // Os dois dizem ser o visualizador: não é a mesma sessão.
  const v = await voltar(visualizador);
  const a = await voltar(anfitriao);
  v.enviar({ tipo: 'retomar', parceiro: anfitriao.id, papel: 'visualizador', porSenha: false });
  a.enviar({ tipo: 'retomar', parceiro: visualizador.id, papel: 'visualizador', porSenha: false });
  assert.deepEqual(await v.proxima(), { tipo: 'sessao_encerrada', motivo: 'parceiro_desconectou' });
  assert.deepEqual(await a.proxima(), { tipo: 'sessao_encerrada', motivo: 'parceiro_desconectou' });
});

test('um estranho não consegue se ligar a quem espera outro parceiro', async () => {
  await servidor.fechar();
  await subir({ prazoRetomadaMs: 100 });
  const { visualizador, anfitriao } = await emSessao();
  anfitriao.socket.terminate();
  await visualizador.proxima(); // parceiro_ausente

  const intruso = await registrado();
  intruso.enviar({ tipo: 'retomar', parceiro: visualizador.id, papel: 'anfitriao', porSenha: false });
  // O intruso não é religado a nada (a espera dele acaba no prazo)...
  assert.deepEqual(await intruso.proxima(), { tipo: 'sessao_encerrada', motivo: 'parceiro_desconectou' });
  // ...e o visualizador nem fica sabendo: continua esperando o parceiro certo.
  await visualizador.nadaRecebidoEm();
  const anfitriaoDeNovo = await voltar(anfitriao);
  anfitriaoDeNovo.enviar({ tipo: 'retomar', parceiro: visualizador.id, papel: 'anfitriao', porSenha: false });
  assert.deepEqual(await visualizador.proxima(), { tipo: 'sessao_retomada', parceiro: anfitriao.id });
});

test('pedir uma conexão nova a quem ainda espera por você encerra a sessão antiga', async () => {
  const { visualizador, anfitriao } = await emSessao();
  visualizador.socket.terminate();
  await anfitriao.proxima(); // parceiro_ausente

  const visualizadorDeNovo = await voltar(visualizador);
  visualizadorDeNovo.enviar({ tipo: 'conectar', destino: anfitriao.id, comSenha: false });
  assert.deepEqual(await anfitriao.proxima(), { tipo: 'sessao_encerrada', motivo: 'parceiro_desconectou' });
  assert.equal((await anfitriao.proxima()).tipo, 'pedido_conexao');
});

test('encerrar durante a espera libera quem esperava', async () => {
  const { visualizador, anfitriao } = await emSessao();
  visualizador.socket.terminate();
  await anfitriao.proxima(); // parceiro_ausente
  anfitriao.enviar({ tipo: 'encerrar' });
  const outro = await registrado();
  await pedir(outro, anfitriao);
});

test('a mesma instalação conectando de novo (substituição) mantém a sessão retomável', async () => {
  const { visualizador, anfitriao } = await emSessao();
  // O visualizador reconecta antes de o servidor perceber a queda da conexão antiga.
  const visualizadorDeNovo = await voltar(visualizador);
  const aviso = await visualizador.proxima();
  assert.equal(aviso.tipo === 'erro' && aviso.codigo, 'substituida');
  assert.deepEqual(await anfitriao.proxima(), { tipo: 'parceiro_ausente', parceiro: visualizador.id });

  visualizadorDeNovo.enviar({ tipo: 'retomar', parceiro: anfitriao.id, papel: 'visualizador', porSenha: false });
  assert.deepEqual(await anfitriao.proxima(), { tipo: 'sessao_retomada', parceiro: visualizador.id });
});

test('retomar tendo outro pedido ou sessão em andamento é recusado', async () => {
  const { visualizador, anfitriao } = await emSessao();
  visualizador.enviar({ tipo: 'retomar', parceiro: anfitriao.id, papel: 'visualizador', porSenha: false });
  const erro = await visualizador.proxima();
  assert.equal(erro.tipo === 'erro' && erro.codigo, 'ja_em_sessao');
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

// ---------------------------------------------------------------------------
// Acesso com senha (a senha em si nunca passa pelo servidor)
// ---------------------------------------------------------------------------

test('pedido com senha: o anfitrião aceita "por senha" e os dois ficam sabendo', async () => {
  const visualizador = await registrado();
  const anfitriao = await registrado();
  await pedir(visualizador, anfitriao, 30_000, true);
  anfitriao.enviar({ tipo: 'responder_pedido', origem: visualizador.id, aceito: true, porSenha: true });
  assert.deepEqual(await visualizador.proxima(), {
    tipo: 'sessao_iniciada',
    parceiro: anfitriao.id,
    papel: 'visualizador',
    porSenha: true,
  });
  assert.deepEqual(await anfitriao.proxima(), {
    tipo: 'sessao_iniciada',
    parceiro: visualizador.id,
    papel: 'anfitriao',
    porSenha: true,
  });
});

test('pedido com senha também pode ser aceito normalmente (alguém presente no anfitrião)', async () => {
  const visualizador = await registrado();
  const anfitriao = await registrado();
  await pedir(visualizador, anfitriao, 30_000, true);
  anfitriao.enviar({ tipo: 'responder_pedido', origem: visualizador.id, aceito: true, porSenha: false });
  const inicio = await visualizador.proxima();
  assert.ok(inicio.tipo === 'sessao_iniciada' && inicio.porSenha === false);
});

test('aceitar "por senha" um pedido sem senha é recusado e o pedido continua pendente', async () => {
  const visualizador = await registrado();
  const anfitriao = await registrado();
  await pedir(visualizador, anfitriao); // sem senha
  anfitriao.enviar({ tipo: 'responder_pedido', origem: visualizador.id, aceito: true, porSenha: true });
  const erro = await anfitriao.proxima();
  assert.equal(erro.tipo === 'erro' && erro.codigo, 'mensagem_invalida');
  await visualizador.nadaRecebidoEm();

  // O aceite normal continua valendo.
  anfitriao.enviar({ tipo: 'responder_pedido', origem: visualizador.id, aceito: true, porSenha: false });
  const inicio = await visualizador.proxima();
  assert.ok(inicio.tipo === 'sessao_iniciada' && inicio.porSenha === false);
});

// ---------------------------------------------------------------------------
// Limite de senhas erradas no servidor (3.5)
// ---------------------------------------------------------------------------

/** Uma tentativa de acesso com senha que o anfitrião recusa (senha errada). */
async function tentativaErrada(visualizador: Registrado, anfitriao: Registrado): Promise<void> {
  await pedir(visualizador, anfitriao, 30_000, true);
  anfitriao.enviar({ tipo: 'responder_pedido', origem: visualizador.id, aceito: true, porSenha: true });
  assert.equal((await visualizador.proxima()).tipo, 'sessao_iniciada');
  assert.equal((await anfitriao.proxima()).tipo, 'sessao_iniciada');
  anfitriao.enviar({ tipo: 'encerrar', motivo: 'senha_incorreta' });
  const fim = await visualizador.proxima();
  assert.ok(fim.tipo === 'sessao_encerrada' && fim.motivo === 'senha_incorreta');
}

async function pedirComSenha(visualizador: Registrado, destino: string) {
  visualizador.enviar({ tipo: 'conectar', destino, comSenha: true });
  return visualizador.proxima();
}

const deIp = (ip: string) => registrarCliente(servidor.porta, undefined, ip);

test('senhas erradas do mesmo IP: esse IP fica bloqueado naquele ID (e só nele)', async () => {
  await servidor.fechar();
  await subir({ proxiesConfiaveis: 1, limites: { errosSenhaPorIpEId: { limite: 2, janelaMs: 60_000, bloqueioMs: 60_000 } } });
  const atacante = await deIp('66.6.6.6');
  const alvo = await deIp('200.1.1.1');
  const outroAlvo = await deIp('200.2.2.2');

  await tentativaErrada(atacante, alvo);
  await tentativaErrada(atacante, alvo);
  // Bloqueado ANTES de chegar ao anfitrião (que nem fica sabendo, e não expõe o IP).
  assert.deepEqual(await pedirComSenha(atacante, alvo.id), { tipo: 'pedido_recusado', destino: alvo.id, motivo: 'bloqueado' });
  await alvo.nadaRecebidoEm();

  // Outro ID não é afetado.
  atacante.enviar({ tipo: 'conectar', destino: outroAlvo.id, comSenha: true });
  assert.equal((await outroAlvo.proxima()).tipo, 'pedido_conexao');
});

test('outro IP continua podendo tentar a senha no mesmo ID (o dono não é trancado para fora)', async () => {
  await servidor.fechar();
  await subir({ proxiesConfiaveis: 1, limites: { errosSenhaPorIpEId: { limite: 2, janelaMs: 60_000, bloqueioMs: 60_000 } } });
  const atacante = await deIp('66.6.6.6');
  const dono = await deIp('201.5.5.5');
  const alvo = await deIp('200.1.1.1');
  await tentativaErrada(atacante, alvo);
  await tentativaErrada(atacante, alvo);

  dono.enviar({ tipo: 'conectar', destino: alvo.id, comSenha: true });
  assert.deepEqual(await alvo.proxima(), { tipo: 'pedido_conexao', origem: dono.id, prazoMs: 30_000, comSenha: true });
});

test('teto por ID: erros de vários IPs somados pausam o acesso com senha a ele', async () => {
  await servidor.fechar();
  await subir({
    proxiesConfiaveis: 1,
    limites: {
      errosSenhaPorIpEId: { limite: 100, janelaMs: 60_000, bloqueioMs: 60_000 },
      errosSenhaPorId: { limite: 3, janelaMs: 60_000, bloqueioMs: 60_000 },
    },
  });
  const alvo = await deIp('200.1.1.1');
  for (const ip of ['1.0.0.1', '1.0.0.2', '1.0.0.3']) await tentativaErrada(await deIp(ip), alvo);

  const novo = await deIp('1.0.0.4');
  assert.deepEqual(await pedirComSenha(novo, alvo.id), { tipo: 'pedido_recusado', destino: alvo.id, motivo: 'bloqueado' });

  // O aceite comum (alguém presente no anfitrião) continua funcionando.
  novo.enviar({ tipo: 'conectar', destino: alvo.id, comSenha: false });
  assert.equal((await alvo.proxima()).tipo, 'pedido_conexao');
});

test('senha recusada enquanto o visualizador está fora do servidor ainda conta o erro', async () => {
  await servidor.fechar();
  await subir({ proxiesConfiaveis: 1, limites: { errosSenhaPorIpEId: { limite: 1, janelaMs: 60_000, bloqueioMs: 60_000 } } });
  const atacante = await deIp('66.6.6.6');
  const alvo = await deIp('200.1.1.1');
  await pedir(atacante, alvo, 30_000, true);
  alvo.enviar({ tipo: 'responder_pedido', origem: atacante.id, aceito: true, porSenha: true });
  await atacante.proxima();
  await alvo.proxima();
  // Sai do servidor de propósito e manda a senha só pela conexão direta.
  atacante.socket.terminate();
  assert.equal((await alvo.proxima()).tipo, 'parceiro_ausente');
  alvo.enviar({ tipo: 'encerrar', motivo: 'senha_incorreta' });

  const deNovo = await registrarCliente(servidor.porta, atacante.identidade, '66.6.6.6');
  assert.deepEqual(await pedirComSenha(deNovo, alvo.id), { tipo: 'pedido_recusado', destino: alvo.id, motivo: 'bloqueado' });
});

test('"senha_incorreta" numa sessão aceita manualmente não conta como erro de senha', async () => {
  await servidor.fechar();
  await subir({ proxiesConfiaveis: 1, limites: { errosSenhaPorIpEId: { limite: 1, janelaMs: 60_000, bloqueioMs: 60_000 } } });
  const visualizador = await deIp('66.6.6.6');
  const anfitriao = await deIp('200.1.1.1');
  await pedir(visualizador, anfitriao); // sem senha
  anfitriao.enviar({ tipo: 'responder_pedido', origem: visualizador.id, aceito: true, porSenha: false });
  await visualizador.proxima();
  await anfitriao.proxima();
  anfitriao.enviar({ tipo: 'encerrar', motivo: 'senha_incorreta' }); // anfitrião com defeito
  await visualizador.proxima();

  visualizador.enviar({ tipo: 'conectar', destino: anfitriao.id, comSenha: true });
  assert.equal((await anfitriao.proxima()).tipo, 'pedido_conexao');
});

// ---------------------------------------------------------------------------
// TURN (etapa 5.3)
// ---------------------------------------------------------------------------

const SERVIDORES_TURN = [{ urls: ['turns:turn.exemplo:443?transport=tcp'], username: 'u1', credential: 'c1' }];

/** Provedor falso: anota o que foi gerado e revogado; "atrasoMs" simula a API. */
function turnFalso(opcoes: { atrasoMs?: number; falhar?: boolean } = {}) {
  let geradas = 0;
  const revogadas: string[] = [];
  const provedor = {
    async gerar() {
      await new Promise((r) => setTimeout(r, opcoes.atrasoMs ?? 0));
      if (opcoes.falhar) return null;
      geradas++;
      return { usuario: `usuario-${geradas}`, servidores: SERVIDORES_TURN };
    },
    revogar: (usuario: string) => revogadas.push(usuario),
  };
  return { provedor, revogadas, geradas: () => geradas };
}

test('TURN: os dois lados recebem as credenciais na sessão; encerrar as revoga', async () => {
  await servidor.fechar();
  const turn = turnFalso();
  await subir({ turn: turn.provedor });
  const visualizador = await registrado();
  const anfitriao = await registrado();
  await pedir(visualizador, anfitriao);
  anfitriao.enviar({ tipo: 'responder_pedido', origem: visualizador.id, aceito: true, porSenha: false });
  const paraV = await visualizador.proxima();
  const paraA = await anfitriao.proxima();
  assert.ok(paraV.tipo === 'sessao_iniciada' && paraA.tipo === 'sessao_iniciada');
  assert.deepEqual(paraV.iceServers, SERVIDORES_TURN);
  assert.deepEqual(paraA.iceServers, SERVIDORES_TURN);

  visualizador.enviar({ tipo: 'encerrar' });
  await anfitriao.proxima();
  assert.deepEqual(turn.revogadas, ['usuario-1']);
});

test('TURN: queda do servidor não revoga (a conexão direta pode seguir pelo TURN)', async () => {
  await servidor.fechar();
  const turn = turnFalso();
  await subir({ turn: turn.provedor });
  const visualizador = await registrado();
  const anfitriao = await registrado();
  await pedir(visualizador, anfitriao);
  anfitriao.enviar({ tipo: 'responder_pedido', origem: visualizador.id, aceito: true, porSenha: false });
  await visualizador.proxima();
  await anfitriao.proxima();
  visualizador.socket.terminate();
  assert.equal((await anfitriao.proxima()).tipo, 'parceiro_ausente');
  assert.deepEqual(turn.revogadas, []);
});

test('TURN: sem credenciais (API fora do ar), a sessão começa só com STUN', async () => {
  await servidor.fechar();
  await subir({ turn: turnFalso({ falhar: true }).provedor });
  const visualizador = await registrado();
  const anfitriao = await registrado();
  await pedir(visualizador, anfitriao);
  anfitriao.enviar({ tipo: 'responder_pedido', origem: visualizador.id, aceito: true, porSenha: false });
  assert.deepEqual(await visualizador.proxima(), {
    tipo: 'sessao_iniciada',
    parceiro: anfitriao.id,
    papel: 'visualizador',
    porSenha: false,
  });
});

test('TURN: pedido cancelado enquanto as credenciais eram geradas não vira sessão (e elas são revogadas)', async () => {
  await servidor.fechar();
  const turn = turnFalso({ atrasoMs: 150 });
  await subir({ turn: turn.provedor });
  const visualizador = await registrado();
  const anfitriao = await registrado();
  await pedir(visualizador, anfitriao);
  anfitriao.enviar({ tipo: 'responder_pedido', origem: visualizador.id, aceito: true, porSenha: false });
  await new Promise((r) => setTimeout(r, 30));
  visualizador.enviar({ tipo: 'encerrar' }); // desistiu antes de a sessão começar
  assert.deepEqual(await anfitriao.proxima(), { tipo: 'pedido_cancelado', origem: visualizador.id });
  await new Promise((r) => setTimeout(r, 250));
  await visualizador.nadaRecebidoEm();
  await anfitriao.nadaRecebidoEm();
  assert.deepEqual(turn.revogadas, ['usuario-1']);
});

test('TURN: resposta repetida durante a geração não cria duas sessões', async () => {
  await servidor.fechar();
  const turn = turnFalso({ atrasoMs: 100 });
  await subir({ turn: turn.provedor });
  const visualizador = await registrado();
  const anfitriao = await registrado();
  await pedir(visualizador, anfitriao);
  anfitriao.enviar({ tipo: 'responder_pedido', origem: visualizador.id, aceito: true, porSenha: false });
  anfitriao.enviar({ tipo: 'responder_pedido', origem: visualizador.id, aceito: true, porSenha: false });
  assert.equal((await visualizador.proxima()).tipo, 'sessao_iniciada');
  assert.equal((await anfitriao.proxima()).tipo, 'sessao_iniciada');
  await visualizador.nadaRecebidoEm(300);
  await anfitriao.nadaRecebidoEm();
  assert.equal(turn.geradas(), 2);
  assert.deepEqual(turn.revogadas, ['usuario-2']); // a segunda sobrou e foi revogada
});
