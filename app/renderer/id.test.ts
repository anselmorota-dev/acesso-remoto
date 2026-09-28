import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ehIdValido, extrairDigitos, formatarId } from './id';

test('extrairDigitos mantém só dígitos, no máximo 9', () => {
  assert.equal(extrairDigitos('123 456 789'), '123456789');
  assert.equal(extrairDigitos('123-456-789'), '123456789');
  assert.equal(extrairDigitos('abc12'), '12');
  assert.equal(extrairDigitos('1234567890123'), '123456789');
  assert.equal(extrairDigitos(''), '');
});

test('formatarId agrupa de 3 em 3, inclusive enquanto digita', () => {
  assert.equal(formatarId('123456789'), '123 456 789');
  assert.equal(formatarId('1234'), '123 4');
  assert.equal(formatarId('12'), '12');
  assert.equal(formatarId(''), '');
});

test('ehIdValido segue a regra do servidor', () => {
  assert.equal(ehIdValido('123456789'), true);
  assert.equal(ehIdValido('012345678'), false); // zero à esquerda
  assert.equal(ehIdValido('12345678'), false); // curto
  assert.equal(ehIdValido('1234567890'), false); // longo
});
