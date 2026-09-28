// Testes da gravação dos arquivos recebidos, numa pasta temporária.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Recebimentos } from './recebimentos';

function pastaNova(): string {
  return join(mkdtempSync(join(tmpdir(), 'recebidos-')), 'Acesso Remoto');
}

const bytes = (texto: string) => new TextEncoder().encode(texto);
const esperar = (ms = 50) => new Promise((r) => setTimeout(r, ms));

test('arquivo inteiro ganha o nome de verdade; nada de parcial sobra', async () => {
  const pasta = pastaNova();
  const r = new Recebimentos(pasta);
  const token = r.iniciar('notas.txt', 10); // "olá mundo" em UTF-8: o "á" ocupa 2 bytes
  assert.ok(token);
  assert.ok(r.gravar(token, bytes('olá ')));
  assert.ok(r.gravar(token, bytes('mundo')));
  const resultado = await r.concluir(token);
  assert.ok(resultado.ok);
  assert.equal(resultado.nome, 'notas.txt');
  assert.equal(readFileSync(join(pasta, 'notas.txt'), 'utf8'), 'olá mundo');
  assert.deepEqual(readdirSync(pasta), ['notas.txt']);
  assert.equal(r.caminhoConcluido(token), join(pasta, 'notas.txt'));
});

test('não sobrescreve arquivo existente', async () => {
  const pasta = pastaNova();
  const r = new Recebimentos(pasta);
  r.iniciar('x', 0); // cria a pasta
  writeFileSync(join(pasta, 'foto.jpg'), 'antiga');
  const token = r.iniciar('foto.jpg', 4);
  assert.ok(token);
  r.gravar(token, bytes('nova'));
  const resultado = await r.concluir(token);
  assert.ok(resultado.ok && resultado.nome === 'foto (2).jpg');
  assert.equal(readFileSync(join(pasta, 'foto.jpg'), 'utf8'), 'antiga');
  assert.equal(readFileSync(join(pasta, 'foto (2).jpg'), 'utf8'), 'nova');
});

test('nome com caminho fica dentro da pasta', async () => {
  const pasta = pastaNova();
  const r = new Recebimentos(pasta);
  const token = r.iniciar('..\\..\\fora.txt', 1);
  assert.ok(token);
  r.gravar(token, bytes('!'));
  const resultado = await r.concluir(token);
  assert.ok(resultado.ok);
  assert.equal(resultado.caminho, join(pasta, 'fora.txt'));
});

test('mais bytes que o anunciado são recusados; menos, não conclui', async () => {
  const pasta = pastaNova();
  const r = new Recebimentos(pasta);
  const a = r.iniciar('a.bin', 3);
  assert.ok(a);
  assert.equal(r.gravar(a, bytes('abcd')), false);
  const b = r.iniciar('b.bin', 10);
  assert.ok(b);
  r.gravar(b, bytes('curto'));
  assert.deepEqual(await r.concluir(b), { ok: false, erro: 'tamanho' });
  r.descartar(a);
  await esperar();
  assert.deepEqual(readdirSync(pasta), [], 'parciais apagados');
});

test('descartar apaga o parcial (cancelado, sessão encerrada)', async () => {
  const pasta = pastaNova();
  const r = new Recebimentos(pasta);
  const token = r.iniciar('grande.iso', 1000);
  assert.ok(token);
  r.gravar(token, bytes('começo'));
  r.descartarTodos();
  await esperar();
  assert.deepEqual(readdirSync(pasta), []);
  assert.equal(r.abertos, 0);
  assert.equal(r.gravar(token, bytes('mais')), false);
});

test('pasta impossível de criar: não começa', () => {
  const base = mkdtempSync(join(tmpdir(), 'recebidos-'));
  writeFileSync(join(base, 'arquivo'), 'x');
  // "arquivo" é um arquivo: não dá para criar uma pasta dentro dele.
  const r = new Recebimentos(join(base, 'arquivo', 'Acesso Remoto'));
  assert.equal(r.iniciar('a.txt', 1), null);
});
