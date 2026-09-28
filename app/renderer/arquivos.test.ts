// Testa a transferência de arquivos com dois gerenciadores ligados por um
// canal falso (com fila e atraso na entrega, como o RTCDataChannel) e um
// gravador em memória no lugar do main.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { PEDACO_ARQUIVO } from '@acesso-remoto/shared';
import { GerenciadorArquivos, type CanalArquivos, type GravadorArquivos, type Transferencia } from './arquivos';

const limpezas: Array<() => void> = [];
afterEach(() => limpezas.splice(0).forEach((f) => f()));

/**
 * Um lado do canal: o que é enviado entra na fila e chega ao outro lado em
 * ordem. "bytesPorMs" simula a velocidade da rede (cada mensagem ocupa o
 * "fio" pelo tempo do seu tamanho); sem ela, chega depois de "atrasoMs".
 */
function criarCanal(atrasoMs: number, entregar: (dados: string | ArrayBuffer) => void, bytesPorMs?: number) {
  let fila = 0;
  let maiorFila = 0;
  let fioLivreEm = 0;
  const canal: CanalArquivos = {
    enviar(dados) {
      const tamanho = typeof dados === 'string' ? dados.length : dados.byteLength;
      fila += tamanho;
      maiorFila = Math.max(maiorFila, fila);
      const agora = Date.now();
      fioLivreEm = Math.max(agora, fioLivreEm) + (bytesPorMs ? tamanho / bytesPorMs : 0);
      setTimeout(() => {
        fila -= tamanho;
        entregar(dados);
      }, fioLivreEm - agora + atrasoMs);
    },
    fila: () => fila,
    esperarFila: (limite) =>
      new Promise((resolve) => {
        const conferir = () => (fila <= limite ? resolve() : setTimeout(conferir, 1));
        conferir();
      }),
  };
  return { canal, maiorFila: () => maiorFila };
}

/** Gravador em memória, com falhas simuláveis. */
function criarGravador(opcoes: { falharAoIniciar?: boolean } = {}) {
  const arquivos = new Map<string, { nome: string; tamanho: number; partes: Uint8Array[]; descartado: boolean; concluido: boolean }>();
  let proximo = 0;
  const gravador: GravadorArquivos = {
    iniciar: async (nome, tamanho) => {
      if (opcoes.falharAoIniciar) return null;
      const token = `00000000-0000-0000-0000-${String(++proximo).padStart(12, '0')}`;
      arquivos.set(token, { nome, tamanho, partes: [], descartado: false, concluido: false });
      return token;
    },
    gravar: (token, pedaco) => arquivos.get(token)?.partes.push(pedaco.slice()),
    concluir: async (token) => {
      const a = arquivos.get(token);
      if (!a) return { ok: false, erro: 'disco' };
      const total = a.partes.reduce((s, p) => s + p.byteLength, 0);
      if (total !== a.tamanho) return { ok: false, erro: 'tamanho' };
      a.concluido = true;
      return { ok: true, nome: a.nome };
    },
    descartar: (token) => {
      const a = arquivos.get(token);
      if (a) a.descartado = true;
    },
  };
  const conteudo = (token: string) => Buffer.concat(arquivos.get(token)?.partes ?? []);
  return { gravador, arquivos, conteudo };
}

/** Dois computadores (A e B) em sessão, cada um com seu gerenciador. */
function emSessao(opcoes: { atrasoMs?: number; bytesPorMs?: number; gravadorB?: ReturnType<typeof criarGravador> } = {}) {
  const atraso = opcoes.atrasoMs ?? 0;
  const gravadorA = criarGravador();
  const gravadorB = opcoes.gravadorB ?? criarGravador();
  const listas = { A: [] as readonly Transferencia[], B: [] as readonly Transferencia[] };
  const A = new GerenciadorArquivos({ gravador: gravadorA.gravador, aoMudar: (l) => (listas.A = l), intervaloProgressoMs: 0 });
  const B = new GerenciadorArquivos({ gravador: gravadorB.gravador, aoMudar: (l) => (listas.B = l), intervaloProgressoMs: 0 });
  const deA = criarCanal(atraso, (d) => B.receber(d), opcoes.bytesPorMs);
  const deB = criarCanal(atraso, (d) => A.receber(d), opcoes.bytesPorMs);
  A.definirCanal(deA.canal);
  B.definirCanal(deB.canal);
  limpezas.push(() => {
    A.definirCanal(null);
    B.definirCanal(null);
  });
  return { A, B, listas, gravadorA, gravadorB, canalA: deA, canalB: deB };
}

async function aguardar(condicao: () => boolean, limiteMs = 5000): Promise<void> {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > limiteMs) throw new Error('Tempo esgotado');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const arquivo = (nome: string, conteudo: Uint8Array) => new File([conteudo as Uint8Array<ArrayBuffer>], nome);
const estados = (lista: readonly Transferencia[]) => lista.map((t) => t.estado);

test('envia vários arquivos (vazio, pequeno, vários pedaços) e chegam idênticos', async () => {
  const { A, listas, gravadorB } = emSessao();
  const grande = randomBytes(PEDACO_ARQUIVO * 3 + 123);
  A.enviar([arquivo('vazio.txt', new Uint8Array()), arquivo('pequeno.txt', Buffer.from('olá')), arquivo('grande.bin', grande)]);
  await aguardar(() => listas.A.length === 3 && listas.A.every((t) => t.estado === 'concluido'));
  await aguardar(() => listas.B.length === 3 && listas.B.every((t) => t.estado === 'concluido'));

  assert.deepEqual(
    listas.B.map((t) => [t.direcao, t.nome, t.tamanho, t.transferidos]),
    [
      ['recebendo', 'vazio.txt', 0, 0],
      ['recebendo', 'pequeno.txt', 4, 4],
      ['recebendo', 'grande.bin', grande.length, grande.length],
    ],
  );
  const tokens = listas.B.map((t) => t.token ?? '');
  assert.equal(gravadorB.conteudo(tokens[1] ?? '').toString(), 'olá');
  assert.ok(gravadorB.conteudo(tokens[2] ?? '').equals(grande));
  assert.ok(listas.A.every((t) => t.direcao === 'enviando' && t.transferidos === t.tamanho));
});

test('os dois lados enviam ao mesmo tempo', async () => {
  const { A, B, listas, gravadorA, gravadorB } = emSessao({ atrasoMs: 1 });
  const deA = randomBytes(300_000);
  const deB = randomBytes(200_000);
  A.enviar([arquivo('de-a.bin', deA)]);
  B.enviar([arquivo('de-b.bin', deB)]);
  await aguardar(() => [...listas.A, ...listas.B].length === 4 && [...listas.A, ...listas.B].every((t) => t.estado === 'concluido'));
  const recebidoEmB = listas.B.find((t) => t.direcao === 'recebendo');
  const recebidoEmA = listas.A.find((t) => t.direcao === 'recebendo');
  assert.ok(gravadorB.conteudo(recebidoEmB?.token ?? '').equals(deA));
  assert.ok(gravadorA.conteudo(recebidoEmA?.token ?? '').equals(deB));
});

test('arquivo grande não enche a memória: a fila do canal fica limitada', async () => {
  const { A, listas, canalA } = emSessao({ atrasoMs: 2 });
  A.enviar([arquivo('grande.iso', new Uint8Array(12 * 1024 * 1024))]);
  await aguardar(() => listas.A[0]?.estado === 'concluido', 20_000);
  assert.ok(canalA.maiorFila() <= 1024 * 1024 + PEDACO_ARQUIVO, `fila chegou a ${canalA.maiorFila()} bytes`);
});

test('quem envia cancela no meio: o parcial é apagado do outro lado', async () => {
  const { A, listas, gravadorB } = emSessao({ atrasoMs: 1, bytesPorMs: 2000 });
  A.enviar([arquivo('lento.bin', new Uint8Array(3 * 1024 * 1024))]);
  await aguardar(() => (listas.B[0]?.transferidos ?? 0) > 0);
  A.cancelar(listas.A[0]?.chave ?? '');
  await aguardar(() => listas.B[0]?.estado === 'cancelado');
  assert.equal(listas.A[0]?.estado, 'cancelado');
  assert.equal(listas.B[0]?.motivo, 'cancelado pelo outro computador');
  assert.ok([...gravadorB.arquivos.values()].every((a) => a.descartado && !a.concluido));
});

test('quem recebe cancela no meio: quem envia para', async () => {
  const { A, B, listas, gravadorB } = emSessao({ atrasoMs: 1, bytesPorMs: 2000 });
  A.enviar([arquivo('lento.bin', new Uint8Array(3 * 1024 * 1024)), arquivo('depois.txt', Buffer.from('ok'))]);
  await aguardar(() => (listas.B[0]?.transferidos ?? 0) > 0);
  B.cancelar(listas.B[0]?.chave ?? '');
  await aguardar(() => listas.A[0]?.estado === 'cancelado');
  assert.equal(listas.A[0]?.motivo, 'cancelado pelo outro computador');
  assert.ok([...gravadorB.arquivos.values()][0]?.descartado);
  // O próximo da fila segue normalmente.
  await aguardar(() => listas.A[1]?.estado === 'concluido');
});

test('quem recebe não consegue criar o arquivo: quem envia vê o erro', async () => {
  const { A, listas } = emSessao({ gravadorB: criarGravador({ falharAoIniciar: true }) });
  A.enviar([arquivo('x.txt', Buffer.from('conteúdo'))]);
  await aguardar(() => listas.A[0]?.estado === 'erro');
  assert.equal(listas.A[0]?.motivo, 'o outro computador não conseguiu gravar o arquivo');
  assert.equal(listas.B[0]?.estado, 'erro');
});

test('disco cheio no meio do recebimento: os dois lados param', async () => {
  const { A, B, listas, gravadorB } = emSessao({ atrasoMs: 1, bytesPorMs: 2000 });
  A.enviar([arquivo('grande.bin', new Uint8Array(3 * 1024 * 1024))]);
  await aguardar(() => (listas.B[0]?.transferidos ?? 0) > PEDACO_ARQUIVO && gravadorB.arquivos.size === 1);
  B.falhaNaGravacao([...gravadorB.arquivos.keys()][0] ?? '');
  await aguardar(() => listas.A[0]?.estado === 'erro');
  assert.equal(listas.B[0]?.estado, 'erro');
  assert.equal(listas.B[0]?.motivo, 'não foi possível gravar o arquivo neste computador');
  assert.ok([...gravadorB.arquivos.values()][0]?.descartado);
});

test('sessão encerrada no meio: envio e recebimento abandonados, parcial apagado', async () => {
  const { A, B, listas, gravadorB } = emSessao({ atrasoMs: 1, bytesPorMs: 2000 });
  A.enviar([arquivo('a.bin', new Uint8Array(3 * 1024 * 1024)), arquivo('b.bin', new Uint8Array(10))]);
  await aguardar(() => (listas.B[0]?.transferidos ?? 0) > 0);
  A.definirCanal(null);
  B.definirCanal(null);
  assert.deepEqual(estados(listas.A), ['cancelado', 'cancelado']);
  assert.equal(listas.A[0]?.motivo, 'a sessão foi encerrada');
  assert.deepEqual(estados(listas.B), ['cancelado']);
  await aguardar(() => [...gravadorB.arquivos.values()].every((a) => a.descartado));
  assert.equal(A.podeEnviar, false);
});

test('quem recebe recusa mais bytes que o anunciado, pedaço grande demais e mensagens soltas', async () => {
  const enviados: Array<string | ArrayBuffer> = [];
  const { gravador, arquivos } = criarGravador();
  const visto = { lista: [] as readonly Transferencia[] };
  const B = new GerenciadorArquivos({ gravador, aoMudar: (l) => (visto.lista = l) });
  B.definirCanal({ enviar: (d) => enviados.push(d), fila: () => 0, esperarFila: async () => {} });

  // Pedaço sem "arquivo_inicio" e mensagens inválidas: ignorados.
  B.receber(new ArrayBuffer(10));
  B.receber('isto não é json');
  B.receber(JSON.stringify({ tipo: 'arquivo_inicio', id: 1, nome: '', tamanho: 5 }));
  assert.equal(visto.lista.length, 0);

  // Anunciou 10 bytes e mandou 20: abandona e avisa.
  B.receber(JSON.stringify({ tipo: 'arquivo_inicio', id: 1, nome: 'a.bin', tamanho: 10 }));
  await aguardar(() => arquivos.size === 1);
  B.receber(new ArrayBuffer(20));
  assert.equal(visto.lista[0]?.estado, 'erro');
  assert.deepEqual(JSON.parse(String(enviados.at(-1))), { tipo: 'arquivo_erro', id: 1, motivo: 'tamanho' });
  assert.ok([...arquivos.values()][0]?.descartado);

  // Pedaço maior que o combinado: abandona.
  B.receber(JSON.stringify({ tipo: 'arquivo_inicio', id: 2, nome: 'b.bin', tamanho: 1_000_000 }));
  B.receber(new ArrayBuffer(PEDACO_ARQUIVO + 1));
  assert.deepEqual(JSON.parse(String(enviados.at(-1))), { tipo: 'arquivo_erro', id: 2, motivo: 'protocolo' });

  // "Fim" com bytes faltando: abandona.
  B.receber(JSON.stringify({ tipo: 'arquivo_inicio', id: 3, nome: 'c.bin', tamanho: 100 }));
  B.receber(new ArrayBuffer(50));
  B.receber(JSON.stringify({ tipo: 'arquivo_fim', id: 3 }));
  assert.deepEqual(JSON.parse(String(enviados.at(-1))), { tipo: 'arquivo_erro', id: 3, motivo: 'tamanho' });
});

test('fora de uma sessão liberada (sem canal), nada é enviado', () => {
  const visto = { lista: [] as readonly Transferencia[] };
  const g = new GerenciadorArquivos({ gravador: criarGravador().gravador, aoMudar: (l) => (visto.lista = l) });
  g.enviar([arquivo('a.txt', Buffer.from('a'))]);
  assert.equal(g.podeEnviar, false);
  assert.equal(visto.lista.length, 0);
  assert.deepEqual(g.lista, []);
});

test('limpar tira só o que já terminou', async () => {
  const { A, listas } = emSessao({ atrasoMs: 1, bytesPorMs: 2000 });
  A.enviar([arquivo('rapido.txt', Buffer.from('a')), arquivo('lento.bin', new Uint8Array(3 * 1024 * 1024))]);
  await aguardar(() => listas.A[0]?.estado === 'concluido' && listas.A[1]?.estado === 'transferindo');
  A.limpar();
  assert.deepEqual(listas.A.map((t) => t.nome), ['lento.bin']);
});

test('cancelamento de quem recebe que cruza com o "fim" no caminho: quem envia não fica esperando para sempre', async () => {
  const enviados: Array<string | ArrayBuffer> = [];
  const visto = { lista: [] as readonly Transferencia[] };
  const A = new GerenciadorArquivos({ gravador: criarGravador().gravador, aoMudar: (l) => (visto.lista = l) });
  A.definirCanal({ enviar: (d) => enviados.push(d), fila: () => 0, esperarFila: async () => {} });
  A.enviar([arquivo('a.txt', Buffer.from('abc'))]);
  // Tudo saiu, inclusive o "fim": aguardando a confirmação.
  await aguardar(() => visto.lista[0]?.estado === 'finalizando');
  // Quem recebe tinha cancelado antes de o "fim" chegar lá.
  A.receber(JSON.stringify({ tipo: 'arquivo_cancelar', id: 1 }));
  assert.equal(visto.lista[0]?.estado, 'cancelado');
});
