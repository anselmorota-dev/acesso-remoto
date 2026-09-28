// Som de aviso para pedido de acesso: um "ding-dong" curto gerado pela
// Web Audio API (dois tons senoidais), sem arquivo de áudio.
//
// O Electron permite tocar som sem gesto do usuário (autoplayPolicy padrão
// "no-user-gesture-required"), então funciona mesmo com a janela em segundo plano.

let contexto: AudioContext | null = null;

export function tocarSomPedido(): void {
  try {
    contexto ??= new AudioContext();
    if (contexto.state === 'suspended') void contexto.resume();
    const inicio = contexto.currentTime;
    tocarNota(contexto, 880, inicio, 0.3); // lá: "ding"
    tocarNota(contexto, 660, inicio + 0.2, 0.45); // mi: "dong"
  } catch (erro) {
    // Sem som não é motivo para travar o pedido: a caixa aparece de qualquer jeito.
    console.warn('[alerta] não foi possível tocar o som:', erro);
  }
}

function tocarNota(ctx: AudioContext, frequenciaHz: number, inicio: number, duracaoS: number): void {
  const oscilador = ctx.createOscillator();
  oscilador.type = 'sine';
  oscilador.frequency.value = frequenciaHz;

  // Envelope: sobe rápido e decai, para não "estalar" no começo e no fim.
  const volume = ctx.createGain();
  volume.gain.setValueAtTime(0.0001, inicio);
  volume.gain.exponentialRampToValueAtTime(0.25, inicio + 0.01);
  volume.gain.exponentialRampToValueAtTime(0.0001, inicio + duracaoS);

  oscilador.connect(volume).connect(ctx.destination);
  oscilador.start(inicio);
  oscilador.stop(inicio + duracaoS);
}
