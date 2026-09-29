// Captura da tela deste computador (lado anfitrião).
// Qual tela é entregue quem decide é o processo main (main/captura.ts): antes
// de pedir a captura, o renderer diz a ele qual monitor quer (etapa 5.1).
import type { IdMonitor } from '@acesso-remoto/shared';

/** Falha ao obter a imagem da tela (ex.: permissão negada no macOS). */
export class ErroCaptura extends Error {}

export interface Captura {
  tela: MediaStream;
  /** O monitor capturado (null se o sistema não informou). */
  monitor: IdMonitor | null;
}

/** Captura o monitor pedido (null: o principal; se ele não existir mais, também o principal). */
export async function capturarTela(monitor: IdMonitor | null): Promise<Captura> {
  let tela: MediaStream;
  let entregue: IdMonitor | null;
  try {
    entregue = await window.api.monitores.preparar(monitor);
    tela = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 30 } },
      audio: false,
    });
  } catch (erro) {
    throw new ErroCaptura('Não foi possível capturar a tela', { cause: erro });
  }
  // "detail": quando a rede aperta, o WebRTC reduz o fps em vez da
  // resolução — em acesso remoto, texto legível importa mais que fluidez.
  // (É o perfil "nitidez"; o par troca para "fluidez" se for o caso, 5.2.)
  for (const trilha of tela.getVideoTracks()) trilha.contentHint = 'detail';
  return { tela, monitor: entregue };
}
