// Testa os textos e o limite dos avisos de mensagem nova no chat.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criarLimiteDeAvisos, formatarIdAviso, resumoMensagem } from './aviso-chat';

test('ID formatado como na tela', () => {
  assert.equal(formatarIdAviso('123456789'), '123 456 789');
});

test('resumo numa linha e curto', () => {
  assert.equal(resumoMensagem('  olá\n\n  tudo   bem?  '), 'olá tudo bem?');
  const longo = resumoMensagem('a'.repeat(500));
  assert.equal(longo.length, 120);
  assert.ok(longo.endsWith('…'));
});

test('no máximo um aviso por intervalo', () => {
  let agora = 0;
  const pode = criarLimiteDeAvisos(4000, () => agora);
  assert.equal(pode(), true);
  agora = 1000;
  assert.equal(pode(), false);
  agora = 4000;
  assert.equal(pode(), true);
  agora = 7999;
  assert.equal(pode(), false);
});
