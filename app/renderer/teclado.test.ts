// Testes do tradutor de teclado (visualizador): o que cada sequência de
// teclas locais vira no protocolo.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EventoInput } from '@acesso-remoto/shared';
import { TradutorTeclado, type EventoTecla } from './teclado';

/** Evento de teclado com os campos que o tradutor usa (padrão: sem modificadores). */
function ev(key: string, code: string, mods: Partial<EventoTecla> = {}): EventoTecla {
  return { key, code, ctrlKey: false, altKey: false, metaKey: false, altGraph: false, ...mods };
}
const desce = (tecla: string): EventoInput => ({ tipo: 'tecla', tecla, pressionada: true });
const sobe = (tecla: string): EventoInput => ({ tipo: 'tecla', tecla, pressionada: false });
const texto = (t: string): EventoInput => ({ tipo: 'texto', texto: t });

const CTRL = ev('Control', 'ControlLeft', { ctrlKey: true });
const SHIFT = ev('Shift', 'ShiftLeft');
const ALT = ev('Alt', 'AltLeft', { altKey: true });

test('letra vira texto; soltar não envia nada', () => {
  const t = new TradutorTeclado();
  assert.deepEqual(t.desceu(ev('a', 'KeyA')), [texto('a')]);
  assert.deepEqual(t.subiu(ev('a', 'KeyA')), []);
});

test('acento composto (tecla morta) chega pronto como texto', () => {
  const t = new TradutorTeclado();
  assert.deepEqual(t.desceu(ev('Dead', 'BracketLeft')), []);
  assert.deepEqual(t.desceu(ev('á', 'KeyA')), [texto('á')]);
  assert.deepEqual(t.desceu(ev('ç', 'Semicolon')), [texto('ç')]);
});

test('Shift + letra vira texto maiúsculo, sem mandar o Shift', () => {
  const t = new TradutorTeclado();
  assert.deepEqual(t.desceu(SHIFT), []);
  assert.deepEqual(t.desceu(ev('A', 'KeyA')), [texto('A')]);
  assert.deepEqual(t.subiu(SHIFT), []);
});

test('Ctrl+C vira atalho: modificador antes, tecla depois', () => {
  const t = new TradutorTeclado();
  assert.deepEqual(t.desceu(CTRL), []);
  assert.deepEqual(t.desceu(ev('c', 'KeyC', { ctrlKey: true })), [desce('control'), desce('c')]);
  assert.deepEqual(t.subiu(ev('c', 'KeyC', { ctrlKey: true })), [sobe('c')]);
  assert.deepEqual(t.subiu(CTRL), [sobe('control')]);
});

test('atalho usa a letra do layout; Shift e números usam a tecla física', () => {
  const t = new TradutorTeclado();
  t.desceu(CTRL);
  // AZERTY: a tecla com "z" fica na posição física do W.
  assert.deepEqual(t.desceu(ev('z', 'KeyW', { ctrlKey: true })), [desce('control'), desce('z')]);
  t.desceu(SHIFT);
  // Ctrl+Shift+1: o navegador informa "!", mas o atalho é com o 1.
  assert.deepEqual(t.desceu(ev('!', 'Digit1', { ctrlKey: true })), [desce('shift'), desce('1')]);
  // Ctrl+Shift+C: "C" maiúsculo vira "c" (o Shift já foi).
  assert.deepEqual(t.desceu(ev('C', 'KeyC', { ctrlKey: true })), [desce('c')]);
});

test('teclas especiais sincronizam os modificadores (Shift+seta seleciona)', () => {
  const t = new TradutorTeclado();
  t.desceu(SHIFT);
  assert.deepEqual(t.desceu(ev('ArrowRight', 'ArrowRight')), [desce('shift'), desce('right')]);
  assert.deepEqual(t.subiu(ev('ArrowRight', 'ArrowRight')), [sobe('right')]);
  assert.deepEqual(t.subiu(SHIFT), [sobe('shift')]);
});

test('tecla segurada repete a descida', () => {
  const t = new TradutorTeclado();
  assert.deepEqual(t.desceu(ev('Backspace', 'Backspace')), [desce('backspace')]);
  assert.deepEqual(t.desceu(ev('Backspace', 'Backspace')), [desce('backspace')]);
  assert.deepEqual(t.subiu(ev('Backspace', 'Backspace')), [sobe('backspace')]);
});

test('espaço e Enter viajam como teclas', () => {
  const t = new TradutorTeclado();
  assert.deepEqual(t.desceu(ev(' ', 'Space')), [desce('space')]);
  assert.deepEqual(t.desceu(ev('Enter', 'NumpadEnter')), [desce('enter')]);
});

test('Alt tocado sozinho vai como toque (abre o menu no anfitrião)', () => {
  const t = new TradutorTeclado();
  assert.deepEqual(t.desceu(ALT), []);
  assert.deepEqual(t.desceu(ALT), []); // repetição enquanto segura
  assert.deepEqual(t.subiu(ALT), [desce('alt'), sobe('alt')]);
});

test('AltGr + tecla (ABNT2) vira texto, sem Ctrl/Alt no anfitrião', () => {
  const t = new TradutorTeclado();
  const altGr = { ctrlKey: true, altKey: true, altGraph: true };
  // O Chromium no Windows manda um Control "falso" antes do AltGraph.
  assert.deepEqual(t.desceu(CTRL), []);
  assert.deepEqual(t.desceu(ev('AltGraph', 'AltRight', altGr)), []);
  assert.deepEqual(t.desceu(ev('/', 'KeyQ', altGr)), [texto('/')]);
  assert.deepEqual(t.subiu(ev('/', 'KeyQ', altGr)), []);
  assert.deepEqual(t.subiu(ev('AltGraph', 'AltRight', altGr)), []);
  assert.deepEqual(t.subiu(CTRL), []); // não foi um toque sozinho
});

test('teclas sem significado para o anfitrião são ignoradas', () => {
  const t = new TradutorTeclado();
  assert.deepEqual(t.desceu(ev('CapsLock', 'CapsLock')), []);
  assert.deepEqual(t.desceu(ev('Unidentified', '')), []);
  assert.deepEqual(t.desceu(ev('Process', 'KeyA')), []);
});

test('antes de clicar, os modificadores seguros vão ao anfitrião (Ctrl+clique)', () => {
  const t = new TradutorTeclado();
  t.desceu(CTRL);
  assert.deepEqual(t.sincronizar(), [desce('control')]);
  assert.deepEqual(t.sincronizar(), []); // já está sincronizado
  assert.deepEqual(t.subiu(CTRL), [sobe('control')]);
});

test('soltar tudo solta teclas e modificadores no anfitrião', () => {
  const t = new TradutorTeclado();
  t.desceu(CTRL);
  t.desceu(ev('c', 'KeyC', { ctrlKey: true }));
  assert.deepEqual(t.soltarTudo(), [sobe('c'), sobe('control')]);
  // Depois disso, os "soltar" que chegarem não mandam nada.
  assert.deepEqual(t.subiu(ev('c', 'KeyC')), []);
  assert.deepEqual(t.subiu(CTRL), []);
});
