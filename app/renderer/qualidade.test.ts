// Testes das regras de qualidade do vídeo (etapa 5.2).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModoQualidade, PerfilVideo } from '@acesso-remoto/shared';
import {
  AjusteAutomatico,
  AMOSTRAS_PARA_TROCAR,
  ControleQualidade,
  descreverVideo,
  fracaoDiferente,
  ordenarCodecs,
  paraCinza,
  resumirVideo,
  type AmostraVideo,
  type EstadoQualidade,
  type ParQualidade,
} from './qualidade';

test('codecs: AV1 primeiro, VP8 de reserva, o resto na ordem original', () => {
  const codecs = ['video/VP8', 'video/rtx', 'video/H264', 'video/AV1', 'video/VP9', 'video/red'].map((mimeType) => ({ mimeType }));
  assert.deepEqual(
    ordenarCodecs(codecs).map((c) => c.mimeType),
    ['video/AV1', 'video/VP8', 'video/rtx', 'video/H264', 'video/VP9', 'video/red'],
  );
  // Sem AV1 (outro sistema): VP8 vai na frente.
  assert.equal(ordenarCodecs(codecs.filter((c) => c.mimeType !== 'video/AV1'))[0]?.mimeType, 'video/VP8');
});

test('movimento: fração de células que mudaram além do limiar', () => {
  const a = new Uint8Array([10, 10, 10, 10]);
  assert.equal(fracaoDiferente(a, new Uint8Array([10, 15, 10, 10])), 0); // abaixo do limiar (ruído)
  assert.equal(fracaoDiferente(a, new Uint8Array([10, 200, 10, 10])), 0.25);
  assert.equal(fracaoDiferente(a, new Uint8Array([0, 0])), 1); // tamanhos diferentes: tudo mudou
  assert.deepEqual([...paraCinza(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]))], [255, 0]);
});

test('automático: em movimento com fps baixo passa para fluidez; parado, volta', () => {
  const ajuste = new AjusteAutomatico();
  const movimento = { movimento: 0.2, fpsEnviado: 6 };
  // Uma ou duas amostras ruins não bastam (evita trocar por um pico).
  for (let i = 0; i < AMOSTRAS_PARA_TROCAR - 1; i++) assert.equal(ajuste.registrar(movimento), 'nitidez');
  assert.equal(ajuste.registrar(movimento), 'fluidez');
  // Em fluidez, continua enquanto houver movimento (o fps alto aqui é mérito da fluidez).
  for (let i = 0; i < 5; i++) assert.equal(ajuste.registrar({ movimento: 0.2, fpsEnviado: 28 }), 'fluidez');
  // O movimento parou: depois de algumas amostras, volta para nitidez.
  const parado = { movimento: 0.001, fpsEnviado: 28 };
  for (let i = 0; i < AMOSTRAS_PARA_TROCAR - 1; i++) assert.equal(ajuste.registrar(parado), 'fluidez');
  assert.equal(ajuste.registrar(parado), 'nitidez');
});

test('automático: movimento com a conexão acompanhando (fps bom) fica em nitidez', () => {
  const ajuste = new AjusteAutomatico();
  for (let i = 0; i < 10; i++) assert.equal(ajuste.registrar({ movimento: 0.5, fpsEnviado: 25 }), 'nitidez');
  // Tela parada com fps baixo (nada para enviar) também não é motivo para trocar.
  for (let i = 0; i < 10; i++) assert.equal(ajuste.registrar({ movimento: 0, fpsEnviado: 2 }), 'nitidez');
  // Amostra interrompida no meio zera a contagem.
  ajuste.registrar({ movimento: 0.5, fpsEnviado: 5 });
  ajuste.registrar({ movimento: 0.5, fpsEnviado: 5 });
  ajuste.registrar({ movimento: 0.5, fpsEnviado: 25 });
  ajuste.registrar({ movimento: 0.5, fpsEnviado: 5 });
  assert.equal(ajuste.perfil, 'nitidez');
  // Sem medida de movimento (sem imagem), nada muda.
  for (let i = 0; i < 5; i++) assert.equal(ajuste.registrar({ movimento: null, fpsEnviado: 1 }), 'nitidez');
});

test('indicador: taxa pela diferença de bytes, codec sem o prefixo', () => {
  const a: AmostraVideo = { t: 1000, bytes: 100_000, largura: 1366, altura: 768, fps: 27.6, codec: 'video/AV1' };
  const b: AmostraVideo = { ...a, t: 2000, bytes: 156_250 };
  const resumo = resumirVideo(a, b);
  assert.deepEqual(resumo, { largura: 1366, altura: 768, fps: 28, kbps: 450, codec: 'AV1' });
  assert.equal(descreverVideo(resumo), '1366×768 · 28 fps · 450 kbps · AV1');
  assert.equal(descreverVideo({ ...resumo, kbps: 2480 }), '1366×768 · 28 fps · 2,5 Mbps · AV1');
  assert.equal(resumirVideo(null, b).kbps, null); // primeira amostra: sem taxa ainda
});

/** Par falso: anota perfis e mensagens; estatísticas e movimento controlados pelo teste. */
function criarPar() {
  const perfis: PerfilVideo[] = [];
  const estados: Array<[ModoQualidade, PerfilVideo]> = [];
  const pedidos: ModoQualidade[] = [];
  const medidas = { fps: 30 as number | null, movimento: 0 as number | null, bytes: 0, t: 0 };
  const par: ParQualidade = {
    definirPerfil: (p) => perfis.push(p),
    estatisticasVideo: async () => {
      medidas.t += 1000;
      medidas.bytes += 50_000;
      return { t: medidas.t, bytes: medidas.bytes, largura: 1366, altura: 768, fps: medidas.fps, codec: 'video/AV1' };
    },
    medirMovimento: async () => medidas.movimento,
    enviarQualidade: (m) => pedidos.push(m),
    enviarEstadoQualidade: (m, e) => estados.push([m, e]),
  };
  return { par, perfis, estados, pedidos, medidas };
}

test('controle (anfitrião): anuncia o início, aplica o modo pedido e troca sozinho no automático', async () => {
  const { par, perfis, estados, medidas } = criarPar();
  const mudancas: EstadoQualidade[] = [];
  const controle = new ControleQualidade({ papel: 'anfitriao', par, aoMudar: (e) => mudancas.push(e), intervaloMs: 1e9 });
  controle.iniciar();
  assert.deepEqual(estados, [['automatico', 'nitidez']]);
  assert.deepEqual(perfis, ['nitidez']);

  // Movimento pesado e fps baixo: passa para fluidez depois de algumas amostras.
  medidas.movimento = 0.3;
  medidas.fps = 5;
  for (let i = 0; i < AMOSTRAS_PARA_TROCAR; i++) await controle.amostrar();
  assert.deepEqual(estados.at(-1), ['automatico', 'fluidez']);
  assert.equal(perfis.at(-1), 'fluidez');

  // O visualizador escolhe nitidez: vale na hora e o automático para de mexer.
  controle.pedirModo('nitidez');
  assert.deepEqual(estados.at(-1), ['nitidez', 'nitidez']);
  for (let i = 0; i < 5; i++) await controle.amostrar();
  assert.equal(perfis.at(-1), 'nitidez');

  // Fluidez escolhida à mão.
  controle.pedirModo('fluidez');
  assert.deepEqual(estados.at(-1), ['fluidez', 'fluidez']);
  // De volta ao automático: recomeça em nitidez.
  controle.pedirModo('automatico');
  assert.deepEqual(estados.at(-1), ['automatico', 'nitidez']);
  controle.parar();
  controle.pedirModo('fluidez'); // parado: ignora
  assert.deepEqual(estados.at(-1), ['automatico', 'nitidez']);
});

test('controle (visualizador): pede o modo, recebe o estado e mede o que chega', async () => {
  const { par, pedidos } = criarPar();
  const mudancas: EstadoQualidade[] = [];
  const controle = new ControleQualidade({ papel: 'visualizador', par, aoMudar: (e) => mudancas.push(e), intervaloMs: 1e9 });
  controle.iniciar();
  controle.escolher('fluidez');
  assert.deepEqual(pedidos, ['fluidez']);
  controle.receberEstado('fluidez', 'fluidez');
  await controle.amostrar();
  await controle.amostrar();
  assert.deepEqual(controle.estado, {
    modo: 'fluidez',
    efetivo: 'fluidez',
    video: { largura: 1366, altura: 768, fps: 30, kbps: 400, codec: 'AV1' },
  });
  // O pedido do visualizador não vale no próprio visualizador (só o anfitrião aplica).
  controle.pedirModo('nitidez');
  assert.equal(controle.estado.modo, 'fluidez');
  controle.parar();
});
