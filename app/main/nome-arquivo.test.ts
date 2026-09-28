// Testes do nome seguro para arquivos recebidos (o nome vem da rede).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nomeLivre, nomeSeguro } from './nome-arquivo';

test('nome comum passa igual (acentos e espaços inclusive)', () => {
  assert.equal(nomeSeguro('Relatório final 2026.pdf'), 'Relatório final 2026.pdf');
  assert.equal(nomeSeguro('.bashrc'), '.bashrc');
});

test('caminhos são descartados: só o último pedaço fica', () => {
  assert.equal(nomeSeguro('..\\..\\Windows\\System32\\evil.dll'), 'evil.dll');
  assert.equal(nomeSeguro('../../etc/passwd'), 'passwd');
  assert.equal(nomeSeguro('C:\\Users\\alguem\\foto.jpg'), 'foto.jpg');
  assert.equal(nomeSeguro('..'), 'arquivo');
  assert.equal(nomeSeguro('pasta/'), 'arquivo');
});

test('caracteres proibidos no Windows viram "_"', () => {
  assert.equal(nomeSeguro('a<b>c:d"e|f?g*h.txt'), 'a_b_c_d_e_f_g_h.txt');
  assert.equal(nomeSeguro('linha\nquebrada\u0000.txt'), 'linha_quebrada_.txt');
});

test('nomes reservados do Windows ganham um "_" na frente', () => {
  for (const nome of ['CON', 'nul.txt', 'Com1.log', 'LPT9', 'aux.tar.gz']) {
    assert.equal(nomeSeguro(nome), `_${nome}`, nome);
  }
  assert.equal(nomeSeguro('console.txt'), 'console.txt');
});

test('pontos e espaços no fim são tirados (o Windows os ignora)', () => {
  assert.equal(nomeSeguro('nota.txt. . '), 'nota.txt');
  assert.equal(nomeSeguro('   '), 'arquivo');
});

test('nome longo demais é encurtado mantendo a extensão', () => {
  const nome = nomeSeguro(`${'a'.repeat(300)}.docx`);
  assert.equal(nome.length, 150);
  assert.ok(nome.endsWith('.docx'));
});

test('nome livre: nunca sobrescreve; numera como o Windows', () => {
  const existentes = new Set(['foto.jpg', 'foto (2).jpg', 'leia-me']);
  const existe = (n: string) => existentes.has(n.toLowerCase());
  assert.equal(nomeLivre('outra.jpg', existe), 'outra.jpg');
  assert.equal(nomeLivre('foto.jpg', existe), 'foto (3).jpg');
  assert.equal(nomeLivre('FOTO.JPG', existe), 'FOTO (3).JPG');
  assert.equal(nomeLivre('leia-me', existe), 'leia-me (2)');
});
