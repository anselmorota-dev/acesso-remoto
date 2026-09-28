// Testes do ícone e do menu da bandeja (partes puras, sem Electron).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { desenharIcone } from './icone-bandeja';
import { dicaBandeja, itensMenu, type AcoesBandeja } from './menu-bandeja';

/** Pixel (x, y) do bitmap BGRA como [r, g, b, a]. */
function pixel(bitmap: Buffer, tamanho: number, x: number, y: number): [number, number, number, number] {
  const i = (y * tamanho + x) * 4;
  return [bitmap[i + 2] ?? -1, bitmap[i + 1] ?? -1, bitmap[i] ?? -1, bitmap[i + 3] ?? -1];
}

test('ícone: tamanho certo, canto transparente, monitor branco no meio', () => {
  for (const tamanho of [16, 32]) {
    const icone = desenharIcone(tamanho, false);
    assert.equal(icone.length, tamanho * tamanho * 4);
    assert.equal(pixel(icone, tamanho, 0, 0)[3], 0, 'canto transparente');
    assert.deepEqual(pixel(icone, tamanho, Math.floor(tamanho / 2), Math.floor(tamanho * 0.4)), [255, 255, 255, 255]);
  }
});

test('ícone: fundo vermelho durante a sessão, cinza fora dela', () => {
  const [rNormal, , , aNormal] = pixel(desenharIcone(16, false), 16, 2, 8);
  const [rSessao, gSessao, , aSessao] = pixel(desenharIcone(16, true), 16, 2, 8);
  assert.equal(aNormal, 255);
  assert.equal(aSessao, 255);
  assert.ok(rSessao > 200 && gSessao < 100, 'vermelho na sessão');
  assert.ok(rNormal < 100, 'cinza escuro fora da sessão');
});

const acoes: AcoesBandeja = {
  abrir: () => {},
  copiarId: () => {},
  encerrarSessao: () => {},
  alternarInicioAutomatico: () => {},
  sair: () => {},
};
const rotulos = (itens: ReturnType<typeof itensMenu>) => itens.map((i) => (i.type === 'separator' ? '---' : i.label));

test('menu fora de sessão: abrir, ID, copiar, iniciar com o computador, sair', () => {
  const itens = itensMenu({ id: '123456789', parceiro: null }, false, acoes);
  assert.deepEqual(rotulos(itens), [
    'Abrir Acesso Remoto',
    '---',
    'Seu ID: 123 456 789',
    'Copiar ID',
    '---',
    'Iniciar junto com o computador',
    '---',
    'Sair',
  ]);
  assert.equal(itens.find((i) => i.label === 'Iniciar junto com o computador')?.checked, false);
  assert.equal(itens.find((i) => i.label?.startsWith('Seu ID'))?.enabled, false);
});

test('menu em sessão mostra quem está controlando e o "Encerrar sessão"', () => {
  const itens = itensMenu({ id: '123456789', parceiro: '987654321' }, true, acoes);
  assert.ok(rotulos(itens).includes('Encerrar sessão com 987 654 321'));
  assert.equal(itens.find((i) => i.label === 'Iniciar junto com o computador')?.checked, true);
});

test('menu sem ID (ainda conectando): não oferece copiar', () => {
  const itens = itensMenu({ id: null, parceiro: null }, false, acoes);
  assert.ok(rotulos(itens).includes('Conectando ao servidor…'));
  assert.ok(!rotulos(itens).includes('Copiar ID'));
});

test('dica da bandeja', () => {
  assert.equal(dicaBandeja({ id: '123456789', parceiro: null }), 'Acesso Remoto — ID 123 456 789');
  assert.equal(dicaBandeja({ id: '123456789', parceiro: '987654321' }), 'Acesso Remoto — sessão ativa com 987 654 321');
  assert.equal(dicaBandeja({ id: null, parceiro: null }), 'Acesso Remoto — conectando…');
});
