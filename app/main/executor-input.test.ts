// Testes do executor de input com um "robô" falso que só anota as chamadas.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BotaoMouse } from '@acesso-remoto/shared';
import { ExecutorInput, LIMITE_EVENTOS_POR_SEGUNDO, rolagemParaSistema, type Robo } from './executor-input';

function criar(opcoes: { plataforma?: NodeJS.Platform } = {}) {
  const chamadas: string[] = [];
  const robo: Robo = {
    tamanhoTela: () => ({ largura: 1366, altura: 768 }),
    moverPara: (x, y) => chamadas.push(`mover ${x},${y}`),
    botao: (botao: BotaoMouse, pressionado) => chamadas.push(`${botao} ${pressionado ? 'desce' : 'sobe'}`),
    rolar: (x, y) => chamadas.push(`rolar ${x},${y}`),
    tecla: (tecla, pressionada) => chamadas.push(`tecla ${tecla} ${pressionada ? 'desce' : 'sobe'}`),
    digitar: (texto) => chamadas.push(`digitar ${texto}`),
  };
  let agora = 0;
  const executor = new ExecutorInput(robo, { plataforma: opcoes.plataforma ?? 'win32', agora: () => agora });
  return { executor, chamadas, avancar: (ms: number) => (agora += ms) };
}

test('coordenadas normalizadas viram pixels do monitor', () => {
  const { executor, chamadas } = criar();
  executor.executar({ tipo: 'mouse_mover', x: 0, y: 0 });
  executor.executar({ tipo: 'mouse_mover', x: 1, y: 1 });
  executor.executar({ tipo: 'mouse_mover', x: 0.5, y: 0.5 });
  assert.deepEqual(chamadas, ['mover 0,0', 'mover 1365,767', 'mover 683,384']);
});

test('botão move o cursor para a posição antes de apertar', () => {
  const { executor, chamadas } = criar();
  executor.executar({ tipo: 'mouse_botao', botao: 'direito', pressionado: true, x: 0.25, y: 0.5 });
  executor.executar({ tipo: 'mouse_botao', botao: 'direito', pressionado: false, x: 0.25, y: 0.5 });
  assert.deepEqual(chamadas, ['mover 341,384', 'direito desce', 'mover 341,384', 'direito sobe']);
});

test('liberar solta os botões que ficaram apertados', () => {
  const { executor, chamadas } = criar();
  executor.executar({ tipo: 'mouse_botao', botao: 'esquerdo', pressionado: true, x: 0, y: 0 });
  executor.executar({ tipo: 'mouse_botao', botao: 'meio', pressionado: true, x: 0, y: 0 });
  executor.executar({ tipo: 'mouse_botao', botao: 'meio', pressionado: false, x: 0, y: 0 });
  chamadas.length = 0;
  executor.liberar();
  assert.deepEqual(chamadas, ['esquerdo sobe']);
  // Liberar de novo não faz nada: não há mais botão apertado.
  executor.liberar();
  assert.deepEqual(chamadas, ['esquerdo sobe']);
});

test('soltar um botão que não estava apertado é ignorado', () => {
  const { executor, chamadas } = criar();
  executor.executar({ tipo: 'mouse_botao', botao: 'esquerdo', pressionado: false, x: 0, y: 0 });
  assert.deepEqual(chamadas, []);
});

test('excesso de eventos é descartado, mas soltar botão sempre passa', () => {
  const { executor, chamadas, avancar } = criar();
  executor.executar({ tipo: 'mouse_botao', botao: 'esquerdo', pressionado: true, x: 0, y: 0 });
  let aceitos = 1;
  for (let i = 0; i < LIMITE_EVENTOS_POR_SEGUNDO * 2; i++) {
    if (executor.executar({ tipo: 'mouse_mover', x: 0.5, y: 0.5 })) aceitos++;
  }
  assert.equal(aceitos, LIMITE_EVENTOS_POR_SEGUNDO);

  // Mesmo sem fichas, soltar o botão apertado é executado (evita botão preso).
  chamadas.length = 0;
  assert.equal(executor.executar({ tipo: 'mouse_botao', botao: 'esquerdo', pressionado: false, x: 0, y: 0 }), true);
  assert.deepEqual(chamadas, ['mover 0,0', 'esquerdo sobe']);

  // As fichas voltam com o tempo.
  avancar(100);
  assert.equal(executor.executar({ tipo: 'mouse_mover', x: 0, y: 0 }), true);
});

test('rolagem é convertida para a unidade de cada sistema', () => {
  // Windows: 100 px (um "clique" no Chromium) = 120 unidades; positivo = para cima.
  assert.deepEqual(rolagemParaSistema(0, 100, 'win32'), { x: 0, y: -120 });
  assert.deepEqual(rolagemParaSistema(100, 0, 'win32'), { x: -120, y: 0 });
  // macOS: pixels, positivo = para cima/esquerda.
  assert.deepEqual(rolagemParaSistema(30, -50, 'darwin'), { x: -30, y: 50 });
  // Linux (X11): "cliques" da roda; qualquer rolagem vale pelo menos um.
  assert.deepEqual(rolagemParaSistema(0, 250, 'linux'), { x: 0, y: -3 });
  assert.deepEqual(rolagemParaSistema(0, -10, 'linux'), { x: 0, y: 1 });
});

test('teclas descem e sobem; repetição (tecla segurada) é executada', () => {
  const { executor, chamadas } = criar();
  executor.executar({ tipo: 'tecla', tecla: 'backspace', pressionada: true });
  executor.executar({ tipo: 'tecla', tecla: 'backspace', pressionada: true }); // repetição
  executor.executar({ tipo: 'tecla', tecla: 'backspace', pressionada: false });
  executor.executar({ tipo: 'tecla', tecla: 'enter', pressionada: false }); // não estava apertada
  assert.deepEqual(chamadas, ['tecla backspace desce', 'tecla backspace desce', 'tecla backspace sobe']);
});

test('texto é digitado como veio', () => {
  const { executor, chamadas } = criar();
  executor.executar({ tipo: 'texto', texto: 'ção' });
  assert.deepEqual(chamadas, ['digitar ção']);
});

test('liberar solta teclas e botões apertados', () => {
  const { executor, chamadas } = criar();
  executor.executar({ tipo: 'tecla', tecla: 'control', pressionada: true });
  executor.executar({ tipo: 'tecla', tecla: 'c', pressionada: true });
  executor.executar({ tipo: 'mouse_botao', botao: 'esquerdo', pressionado: true, x: 0, y: 0 });
  chamadas.length = 0;
  executor.liberar();
  assert.deepEqual(chamadas.sort(), ['esquerdo sobe', 'tecla c sobe', 'tecla control sobe']);
});

test('soltar tecla passa mesmo sem fichas', () => {
  const { executor, chamadas } = criar();
  executor.executar({ tipo: 'tecla', tecla: 'shift', pressionada: true });
  for (let i = 0; i < LIMITE_EVENTOS_POR_SEGUNDO * 2; i++) executor.executar({ tipo: 'texto', texto: 'a' });
  chamadas.length = 0;
  assert.equal(executor.executar({ tipo: 'tecla', tecla: 'shift', pressionada: false }), true);
  assert.deepEqual(chamadas, ['tecla shift sobe']);
});

test('rolagem zerada não chama o robô', () => {
  const { executor, chamadas } = criar();
  executor.executar({ tipo: 'mouse_rolar', dx: 0, dy: 0 });
  executor.executar({ tipo: 'mouse_rolar', dx: 0, dy: 100 });
  assert.deepEqual(chamadas, ['rolar 0,-120']);
});
