// Testes da ordem dos movimentos do mouse (canal sem ordem e sem retransmissão).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EventoInput } from '@acesso-remoto/shared';
import { NumeradorMouse, OrdemMouse } from './ordem-mouse';

const mover = (n: number | undefined, x = 0.5): EventoInput => ({ tipo: 'mouse_mover', x, y: 0.5, ...(n === undefined ? {} : { n }) });
const clique = (n: number | undefined, pressionado = true): EventoInput => ({
  tipo: 'mouse_botao',
  botao: 'esquerdo',
  pressionado,
  x: 0.5,
  y: 0.5,
  ...(n === undefined ? {} : { n }),
});

test('movimento atrasado (número menor que o último) é descartado', () => {
  const ordem = new OrdemMouse();
  assert.equal(ordem.aceitar(mover(0)), true);
  assert.equal(ordem.aceitar(mover(2)), true);
  assert.equal(ordem.aceitar(mover(1)), false); // chegou depois do 2
  assert.equal(ordem.aceitar(mover(2)), false); // repetido
  assert.equal(ordem.aceitar(mover(5)), true); // pulou 3 e 4 (perdidos): tudo bem
});

test('depois de um clique, movimentos anteriores a ele não valem mais', () => {
  const ordem = new OrdemMouse();
  assert.equal(ordem.aceitar(mover(0)), true);
  // O clique saiu depois do movimento 3 (que se atrasou na rede).
  assert.equal(ordem.aceitar(clique(3)), true);
  assert.equal(ordem.aceitar(mover(3)), false);
  assert.equal(ordem.aceitar(mover(4)), true);
  // Soltar o botão sempre vale, mesmo com número antigo.
  assert.equal(ordem.aceitar(clique(1, false)), true);
});

test('sem número (versão anterior) ou outros eventos: executa como sempre', () => {
  const ordem = new OrdemMouse();
  assert.equal(ordem.aceitar(mover(10)), true);
  assert.equal(ordem.aceitar(mover(undefined)), true);
  assert.equal(ordem.aceitar({ tipo: 'tecla', tecla: 'enter', pressionada: true }), true);
  assert.equal(ordem.aceitar({ tipo: 'mouse_rolar', dx: 0, dy: 100 }), true);
});

test('visualizador numera os movimentos e o clique leva o número do último', () => {
  const numerador = new NumeradorMouse();
  assert.deepEqual(numerador.numerar(clique(undefined)), clique(undefined)); // antes de qualquer movimento
  assert.deepEqual(numerador.numerar(mover(undefined, 0.1)), mover(0, 0.1));
  assert.deepEqual(numerador.numerar(mover(undefined, 0.2)), mover(1, 0.2));
  assert.deepEqual(numerador.numerar(clique(undefined)), clique(1));
  assert.deepEqual(numerador.numerar(mover(undefined, 0.3)), mover(2, 0.3));
  const tecla: EventoInput = { tipo: 'tecla', tecla: 'enter', pressionada: true };
  assert.deepEqual(numerador.numerar(tecla), tecla);
});
