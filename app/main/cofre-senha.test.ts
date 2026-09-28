// Testes do cofre da senha de acesso não supervisionado (argon2 de verdade,
// com custo baixo para rodar rápido, e arquivo numa pasta temporária).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CofreSenha, JANELA_ERROS_SENHA_MS, LIMITE_ERROS_SENHA } from './cofre-senha';

const CUSTO_TESTE = { memoriaKiB: 1024, passagens: 1 };

async function abrir(opcoes: { arquivo?: string; emSessao?: () => boolean } = {}) {
  const arquivo = opcoes.arquivo ?? join(mkdtempSync(join(tmpdir(), 'cofre-')), 'seguranca.json');
  const cofre = await CofreSenha.abrir({ arquivo, emSessao: opcoes.emSessao ?? (() => false), custo: CUSTO_TESTE });
  return { cofre, arquivo };
}

test('sem arquivo, não há senha definida', async () => {
  const { cofre } = await abrir();
  assert.equal(cofre.definida, false);
  assert.equal(await cofre.confere('qualquer coisa'), false);
});

test('definir guarda só o hash argon2id, nunca a senha', async () => {
  const { cofre, arquivo } = await abrir();
  assert.deepEqual(await cofre.definir('minha senha secreta', null), { ok: true });
  assert.equal(cofre.definida, true);

  const conteudo = readFileSync(arquivo, 'utf8');
  assert.match(conteudo, /\$argon2id\$/);
  assert.doesNotMatch(conteudo, /minha senha secreta/);

  assert.equal(await cofre.confere('minha senha secreta'), true);
  assert.equal(await cofre.confere('minha senha secretA'), false);
});

test('senha curta ou longa demais é recusada', async () => {
  const { cofre } = await abrir();
  assert.deepEqual(await cofre.definir('1234567', null), { ok: false, erro: 'curta' });
  assert.deepEqual(await cofre.definir('x'.repeat(129), null), { ok: false, erro: 'longa' });
  // Conta caracteres, não bytes: 8 caracteres acentuados bastam.
  assert.deepEqual(await cofre.definir('çãéíóúâê', null), { ok: true });
});

test('a mesma senha em formas Unicode diferentes confere', async () => {
  const { cofre } = await abrir();
  await cofre.definir('ação segura', null); // "ç" e "ã" como um caractere só (NFC)
  assert.equal(await cofre.confere('ação segura'.normalize('NFD')), true); // "c" + cedilha etc.
});

test('alterar exige a senha atual', async () => {
  const { cofre } = await abrir();
  await cofre.definir('senha antiga 1', null);
  assert.deepEqual(await cofre.definir('senha nova 22', null), { ok: false, erro: 'senha_atual_incorreta' });
  assert.deepEqual(await cofre.definir('senha nova 22', 'errada errada'), { ok: false, erro: 'senha_atual_incorreta' });
  assert.deepEqual(await cofre.definir('senha nova 22', 'senha antiga 1'), { ok: true });
  assert.equal(await cofre.confere('senha antiga 1'), false);
  assert.equal(await cofre.confere('senha nova 22'), true);
});

test('remover exige a senha atual e desativa o acesso', async () => {
  const { cofre } = await abrir();
  await cofre.definir('senha antiga 1', null);
  assert.deepEqual(await cofre.remover('errada errada'), { ok: false, erro: 'senha_atual_incorreta' });
  assert.equal(cofre.definida, true);
  assert.deepEqual(await cofre.remover('senha antiga 1'), { ok: true });
  assert.equal(cofre.definida, false);
  assert.equal(await cofre.confere('senha antiga 1'), false);
});

test('com sessão ativa, nada pode ser alterado (nem pelo visualizador)', async () => {
  let emSessao = false;
  const { cofre } = await abrir({ emSessao: () => emSessao });
  await cofre.definir('senha antiga 1', null);
  emSessao = true;
  assert.deepEqual(await cofre.definir('senha do intruso', 'senha antiga 1'), { ok: false, erro: 'sessao_ativa' });
  assert.deepEqual(await cofre.remover('senha antiga 1'), { ok: false, erro: 'sessao_ativa' });
  assert.equal(await cofre.confere('senha antiga 1'), true);
});

test('a senha continua definida ao abrir o app de novo', async () => {
  const { cofre, arquivo } = await abrir();
  await cofre.definir('senha que fica', null);
  const { cofre: reaberto } = await abrir({ arquivo });
  assert.equal(reaberto.definida, true);
  assert.equal(await reaberto.confere('senha que fica'), true);
});

test('arquivo corrompido ou adulterado vale como "sem senha" (acesso desativado)', async () => {
  const { arquivo } = await abrir();
  writeFileSync(arquivo, '{ isto não é json');
  assert.equal((await abrir({ arquivo })).cofre.definida, false);
  writeFileSync(arquivo, JSON.stringify({ versao: 1, senha: 'texto-puro-nao-e-hash' }));
  assert.equal((await abrir({ arquivo })).cofre.definida, false);
});

test('tentar: confere a senha de quem quer acessar', async () => {
  const { cofre } = await abrir();
  assert.equal(await cofre.tentar('qualquer coisa'), 'sem_senha');
  await cofre.definir('senha de acesso', null);
  assert.equal(await cofre.tentar('senha errada!'), 'incorreta');
  assert.equal(await cofre.tentar('senha de acesso'), 'ok');
});

test('tentar: 5 erros em 10 minutos bloqueiam até a janela passar (nem a certa passa)', async () => {
  let agora = 0;
  const arquivo = join(mkdtempSync(join(tmpdir(), 'cofre-')), 'seguranca.json');
  const cofre = await CofreSenha.abrir({ arquivo, emSessao: () => false, custo: CUSTO_TESTE, agora: () => agora });
  await cofre.definir('senha de acesso', null);

  for (let i = 0; i < LIMITE_ERROS_SENHA; i++) assert.equal(await cofre.tentar(`errada ${i}`), 'incorreta');
  assert.equal(await cofre.tentar('senha de acesso'), 'bloqueada');

  agora += JANELA_ERROS_SENHA_MS; // os erros "vencem"
  assert.equal(await cofre.tentar('senha de acesso'), 'ok');
});

test('tentar: acertar zera a contagem de erros', async () => {
  const { cofre } = await abrir();
  await cofre.definir('senha de acesso', null);
  for (let i = 0; i < LIMITE_ERROS_SENHA - 1; i++) await cofre.tentar(`errada ${i}`);
  assert.equal(await cofre.tentar('senha de acesso'), 'ok');
  for (let i = 0; i < LIMITE_ERROS_SENHA - 1; i++) assert.equal(await cofre.tentar(`errada ${i}`), 'incorreta');
  assert.equal(await cofre.tentar('senha de acesso'), 'ok');
});

test('a gravação não deixa arquivo temporário para trás', async () => {
  const { cofre, arquivo } = await abrir();
  await cofre.definir('senha qualquer', null);
  assert.equal(existsSync(`${arquivo}.tmp`), false);
});
