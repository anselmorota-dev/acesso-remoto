// Testes do monitor da área de transferência, com uma área falsa no lugar da do sistema.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { TEXTO_AREA_TRANSFERENCIA_MAXIMO } from '@acesso-remoto/shared';
import { MonitorAreaTransferencia } from './monitor-area';

const monitores: MonitorAreaTransferencia[] = [];
afterEach(() => monitores.splice(0).forEach((m) => m.desligar()));

/** Área falsa; "comContador": como no Windows, um número que muda a cada cópia. */
function criar(inicial = '', comContador = false) {
  const area = {
    textoAtual: inicial,
    falhar: false,
    contador: 1,
    leituras: 0,
    get texto() {
      return this.textoAtual;
    },
    set texto(novo: string) {
      this.textoAtual = novo;
      this.contador++;
    },
  };
  const copiados: Array<string | null> = [];
  const monitor = new MonitorAreaTransferencia({
    // Assíncrona como a do Electron, com um pequeno atraso em cada operação.
    area: {
      lerTexto: async () => {
        area.leituras++;
        await new Promise((r) => setTimeout(r, 3));
        if (area.falhar) throw new Error('área ocupada por outro programa');
        return area.texto;
      },
      escreverTexto: async (texto) => {
        await new Promise((r) => setTimeout(r, 3));
        // Como o Windows pode fazer: guarda com outra quebra de linha.
        area.texto = texto.replace(/\r?\n/g, '\r\n');
      },
      ...(comContador ? { contadorDeMudancas: () => area.contador } : {}),
    },
    aoCopiar: (texto) => copiados.push(texto),
    intervaloMs: 10,
  });
  monitores.push(monitor);
  return { area, copiados, monitor };
}

const esperar = (ms = 60) => new Promise((r) => setTimeout(r, ms));

test('avisa cada texto novo copiado, uma vez só', async () => {
  const { area, copiados, monitor } = criar('já estava copiado');
  monitor.ligar(false);
  await esperar();
  assert.deepEqual(copiados, [], 'o que já estava copiado não conta (anfitrião)');

  area.texto = 'primeiro';
  await esperar();
  area.texto = 'segundo';
  await esperar();
  assert.deepEqual(copiados, ['primeiro', 'segundo']);
});

test('"enviarAtual": o que já está copiado conta como novo (visualizador)', async () => {
  const { copiados, monitor } = criar('comando para colar lá');
  monitor.ligar(true);
  await esperar();
  assert.deepEqual(copiados, ['comando para colar lá']);
});

test('o texto recebido do outro lado não volta (sem eco), mesmo que o sistema o normalize', async () => {
  const { area, copiados, monitor } = criar();
  monitor.ligar(false);
  // Várias escritas seguidas, com as conferências periódicas acontecendo no meio.
  for (let i = 0; i < 20; i++) {
    void monitor.escrever(`recebido ${i}\nsegunda linha`);
    await esperar(7);
  }
  assert.equal(await monitor.escrever('linha 1\nlinha 2'), true);
  assert.equal(area.texto, 'linha 1\r\nlinha 2');
  await esperar();
  await monitor.ocioso();
  assert.deepEqual(copiados, []);
});

test('desligado, não lê nem escreve nada', async () => {
  const { area, copiados, monitor } = criar();
  assert.equal(await monitor.escrever('de fora da sessão'), false);
  assert.equal(area.texto, '');
  monitor.ligar(false);
  monitor.desligar();
  area.texto = 'copiado depois da sessão';
  await esperar();
  assert.deepEqual(copiados, []);
});

test('algo que não é texto (vazio) não é enviado; texto grande demais avisa com null', async () => {
  const { area, copiados, monitor } = criar('texto');
  monitor.ligar(false);
  area.texto = ''; // ex.: copiaram uma imagem
  await esperar();
  area.texto = 'x'.repeat(TEXTO_AREA_TRANSFERENCIA_MAXIMO + 1);
  await esperar();
  assert.deepEqual(copiados, [null]);
});

test('área ocupada por outro programa: tenta de novo na próxima, sem avisar à toa', async () => {
  const { area, copiados, monitor } = criar('antes');
  monitor.ligar(false);
  area.falhar = true;
  await esperar();
  area.falhar = false;
  area.texto = 'depois';
  await esperar();
  assert.deepEqual(copiados, ['depois']);
});

// Com o contador do Windows: a área só é aberta quando algo foi copiado.

test('com contador: sem cópia nova, a área nem é aberta', async () => {
  const { area, monitor } = criar('inicial', true);
  monitor.ligar(false);
  await esperar(30);
  const leiturasIniciais = area.leituras;
  await esperar(150); // ~15 conferências
  assert.equal(area.leituras, leiturasIniciais);
});

test('com contador: cópias novas são avisadas, e o texto recebido não volta', async () => {
  const { area, copiados, monitor } = criar('inicial', true);
  monitor.ligar(false);
  await esperar(30);
  area.texto = 'copiado aqui';
  await esperar();
  assert.equal(await monitor.escrever('veio do outro lado'), true);
  await esperar();
  area.texto = 'copiado de novo';
  await esperar();
  assert.deepEqual(copiados, ['copiado aqui', 'copiado de novo']);
});

test('com contador: leitura que falha é tentada de novo mesmo sem nova mudança', async () => {
  const { area, copiados, monitor } = criar('inicial', true);
  monitor.ligar(false);
  await esperar(30);
  area.falhar = true;
  area.texto = 'copiado com a área ocupada';
  await esperar(40);
  area.falhar = false;
  await esperar();
  assert.deepEqual(copiados, ['copiado com a área ocupada']);
});
