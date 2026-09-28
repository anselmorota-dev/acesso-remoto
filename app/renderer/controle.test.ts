// Testes da conversão "ponto na janela do visualizador" → "ponto na tela remota".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { areaDaImagem, normalizar, rolagemEmPixels } from './controle';

test('imagem mais larga que o elemento ganha faixas em cima e embaixo', () => {
  // Elemento 800x800 mostrando vídeo 1600x900: a imagem fica 800x450, centrada.
  const area = areaDaImagem({ left: 0, top: 100, width: 800, height: 800 }, 1600, 900);
  assert.deepEqual(area, { left: 0, top: 275, width: 800, height: 450 });
});

test('imagem mais alta que o elemento ganha faixas nas laterais', () => {
  const area = areaDaImagem({ left: 10, top: 0, width: 1000, height: 500 }, 1000, 1000);
  assert.deepEqual(area, { left: 260, top: 0, width: 500, height: 500 });
});

test('sem vídeo (ou elemento sem tamanho) não há área', () => {
  assert.equal(areaDaImagem({ left: 0, top: 0, width: 800, height: 600 }, 0, 0), null);
  assert.equal(areaDaImagem({ left: 0, top: 0, width: 0, height: 0 }, 1920, 1080), null);
});

test('ponto dentro da imagem vira coordenada de 0 a 1', () => {
  const area = { left: 100, top: 50, width: 400, height: 200 };
  assert.deepEqual(normalizar(100, 50, area, false), { x: 0, y: 0 });
  assert.deepEqual(normalizar(300, 150, area, false), { x: 0.5, y: 0.5 });
  assert.deepEqual(normalizar(500, 250, area, false), { x: 1, y: 1 });
});

test('ponto nas faixas pretas é ignorado, ou preso à borda quando pedido', () => {
  const area = { left: 100, top: 50, width: 400, height: 200 };
  assert.equal(normalizar(50, 150, area, false), null);
  // Durante um arraste o mouse pode sair da imagem: prende na borda.
  assert.deepEqual(normalizar(50, 300, area, true), { x: 0, y: 1 });
});

test('rolagem em linhas ou páginas é convertida para pixels', () => {
  assert.deepEqual(rolagemEmPixels(3, -100, 0, 600), { dx: 3, dy: -100 });
  assert.deepEqual(rolagemEmPixels(0, 3, 1, 600), { dx: 0, dy: 120 }); // linhas: 40 px
  assert.deepEqual(rolagemEmPixels(0, 1, 2, 600), { dx: 0, dy: 600 }); // página: altura visível
});
