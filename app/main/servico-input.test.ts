// Testes da lógica do processo de input, com um robô falso.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ServicoInput, type RoboDoProcesso } from './servico-input';

function criar() {
  const chamadas: string[] = [];
  const logs: string[] = [];
  const robo: RoboDoProcesso = {
    moverPara: (x, y) => chamadas.push(`mover ${x},${y}`),
    botao: (botao, pressionado) => chamadas.push(`${botao} ${pressionado ? 'desce' : 'sobe'}`),
    rolar: (x, y) => chamadas.push(`rolar ${x},${y}`),
    tecla: (tecla, pressionada) => chamadas.push(`tecla ${tecla} ${pressionada ? 'desce' : 'sobe'}`),
    digitar: (texto) => chamadas.push(`digitar ${texto}`),
    atualizarTela: () => chamadas.push('atualizar tela'),
  };
  const servico = new ServicoInput(robo, { plataforma: 'win32', agora: () => 0, log: (m) => logs.push(m) });
  return { servico, chamadas, logs };
}

test('executa o evento do renderer na área informada pelo main', () => {
  const { servico, chamadas } = criar();
  servico.doMain({ tipo: 'area', area: { x: -1920, y: 0, largura: 1920, altura: 1080 } });
  servico.doRenderer({ tipo: 'executar', evento: { tipo: 'mouse_mover', x: 0.5, y: 0.5 } });
  assert.deepEqual(chamadas, ['mover -960,540']);
});

test('mensagens inválidas do renderer são ignoradas', () => {
  const { servico, chamadas, logs } = criar();
  servico.doMain({ tipo: 'area', area: { x: 0, y: 0, largura: 100, altura: 100 } });
  for (const lixo of [null, 'texto', 42, {}, { tipo: 'outro' }, { tipo: 'executar', evento: { tipo: 'mouse_mover', x: 5, y: 0 } }]) {
    servico.doRenderer(lixo);
  }
  assert.deepEqual(chamadas, []);
  assert.equal(logs.length, 1); // só o evento com formato de input, mas fora dos limites
});

test('área inválida do main é ignorada (fica a anterior)', () => {
  const { servico, chamadas } = criar();
  servico.doMain({ tipo: 'area', area: { x: 0, y: 0, largura: 200, altura: 100 } });
  servico.doMain({ tipo: 'area', area: { x: 0, y: 0, largura: 0, altura: 100 } });
  servico.doMain({ tipo: 'area', area: { x: 'a', y: 0, largura: 10, altura: 10 } });
  servico.doRenderer({ tipo: 'executar', evento: { tipo: 'mouse_mover', x: 1, y: 1 } });
  assert.deepEqual(chamadas, ['mover 199,99']);
});

test('soltar tudo: pelo renderer, pelo main ou quando o canal fecha', () => {
  const { servico, chamadas } = criar();
  servico.doMain({ tipo: 'area', area: { x: 0, y: 0, largura: 100, altura: 100 } });
  const clique = { tipo: 'mouse_botao', botao: 'esquerdo', pressionado: true, x: 0, y: 0 };
  servico.doRenderer({ tipo: 'executar', evento: clique });
  servico.doRenderer({ tipo: 'liberar' });
  servico.doRenderer({ tipo: 'executar', evento: clique });
  servico.doMain({ tipo: 'liberar' });
  servico.doRenderer({ tipo: 'executar', evento: clique });
  servico.liberar();
  assert.deepEqual(chamadas.filter((c) => !c.startsWith('mover')), [
    'esquerdo desce',
    'esquerdo sobe',
    'esquerdo desce',
    'esquerdo sobe',
    'esquerdo desce',
    'esquerdo sobe',
  ]);
});

test('monitores mudaram: o robô relê a área de trabalho', () => {
  const { servico, chamadas } = criar();
  servico.doMain({ tipo: 'monitores_mudaram' });
  assert.deepEqual(chamadas, ['atualizar tela']);
});
