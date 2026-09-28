import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gerarId } from './ids.js';

test('gera IDs de 9 dígitos sem zero à esquerda', () => {
  for (let i = 0; i < 1000; i++) {
    assert.match(gerarId(() => false), /^[1-9]\d{8}$/);
  }
});

test('sorteia de novo quando o ID já está em uso', () => {
  const sorteios = [111_111_111, 222_222_222, 333_333_333];
  const emUso = new Set(['111111111', '222222222']);
  const id = gerarId((candidato) => emUso.has(candidato), () => sorteios.shift()!);
  assert.equal(id, '333333333');
});

test('desiste depois de muitas colisões em vez de travar', () => {
  assert.throws(() => gerarId(() => true), /ID livre/);
});
