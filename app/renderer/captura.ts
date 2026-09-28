// Captura da tela deste computador (lado anfitrião).
// Qual tela é entregue quem decide é o processo main (main/captura.ts).

/** Falha ao obter a imagem da tela (ex.: permissão negada no macOS). */
export class ErroCaptura extends Error {}

export async function capturarTela(): Promise<MediaStream> {
  let tela: MediaStream;
  try {
    tela = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 30 } },
      audio: false,
    });
  } catch (erro) {
    throw new ErroCaptura('Não foi possível capturar a tela', { cause: erro });
  }
  // "detail": quando a rede aperta, o WebRTC reduz o fps em vez da
  // resolução — em acesso remoto, texto legível importa mais que fluidez.
  for (const trilha of tela.getVideoTracks()) trilha.contentHint = 'detail';
  return tela;
}
