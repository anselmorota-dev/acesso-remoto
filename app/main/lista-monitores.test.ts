// Testes da lista de monitores (parte pura, sem Electron).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { areaDoRobo, escolherMonitor, montarMonitores, paraVisualizador, type DisplayEletron } from './lista-monitores';

// Notebook (1366x768, 100%) como principal e um monitor 4K a 150% à esquerda.
const notebook: DisplayEletron = { id: 111, bounds: { x: 0, y: 0, width: 1366, height: 768 }, scaleFactor: 1 };
const monitor4k: DisplayEletron = { id: 222, bounds: { x: -2560, y: -300, width: 2560, height: 1440 }, scaleFactor: 1.5 };

/** Conversão falsa de DIP para pixels físicos (no app, quem faz é o Electron). */
const dipParaTela = (b: DisplayEletron['bounds']) =>
  b.x < 0 ? { x: -3840, y: -450, width: 3840, height: 2160 } : b;

test('lista em ordem da esquerda para a direita, com o principal marcado', () => {
  const lista = montarMonitores([notebook, monitor4k], 111, (d) => areaDoRobo(d, 'win32', dipParaTela));
  assert.deepEqual(
    lista.map((m) => [m.id, m.principal]),
    [
      ['222', false],
      ['111', true],
    ],
  );
  // Resolução real: DIP x escala.
  assert.deepEqual(lista[0]?.pixels, { largura: 3840, altura: 2160 });
  assert.deepEqual(paraVisualizador(lista), [
    { id: '222', largura: 3840, altura: 2160, principal: false },
    { id: '111', largura: 1366, altura: 768, principal: true },
  ]);
});

test('área do robô: Windows usa a conversão do Electron; macOS fica em pontos', () => {
  assert.deepEqual(areaDoRobo(monitor4k, 'win32', dipParaTela), { x: -3840, y: -450, largura: 3840, altura: 2160 });
  assert.deepEqual(areaDoRobo(monitor4k, 'darwin', dipParaTela), { x: -2560, y: -300, largura: 2560, altura: 1440 });
  assert.deepEqual(areaDoRobo(monitor4k, 'linux', dipParaTela), { x: -3840, y: -450, largura: 3840, altura: 2160 });
});

test('escolha: o pedido se existir; senão o principal', () => {
  const lista = montarMonitores([notebook, monitor4k], 111, (d) => areaDoRobo(d, 'win32', dipParaTela));
  assert.equal(escolherMonitor(lista, '222')?.id, '222');
  assert.equal(escolherMonitor(lista, null)?.id, '111');
  assert.equal(escolherMonitor(lista, '999')?.id, '111'); // desconectado: volta ao principal
  assert.equal(escolherMonitor([], null), null);
});

test('no máximo 16 monitores vão ao visualizador', () => {
  const muitos = Array.from({ length: 20 }, (_, i) => ({ ...notebook, id: i + 1, bounds: { ...notebook.bounds, x: i * 1366 } }));
  const lista = montarMonitores(muitos, 1, (d) => areaDoRobo(d, 'win32', (b) => b));
  assert.equal(paraVisualizador(lista).length, 16);
});
