// Mede quanto da tela mudou entre uma amostra e a seguinte (anfitrião, etapa 5.2).
// Reduz um quadro da captura para 64x36 em tons de cinza e compara com o
// anterior (as contas ficam em qualidade.ts). A captura do Windows entrega
// quadros mesmo com a tela parada, por isso a comparação é feita aqui.
import { ALTURA_AMOSTRA, LARGURA_AMOSTRA, fracaoDiferente, paraCinza } from './qualidade';

export class AmostradorMovimento {
  private video: HTMLVideoElement | null = null;
  private trilha: MediaStreamTrack | null = null;
  private anterior: Uint8Array | null = null;
  private contexto: OffscreenCanvasRenderingContext2D | null = null;

  /** Fração da tela que mudou desde a última medida (null: sem imagem ou primeira medida). */
  medir(trilha: MediaStreamTrack | null): number | null {
    if (!trilha || trilha.readyState !== 'live') {
      this.soltar();
      return null;
    }
    // Trilha nova (início ou troca de monitor): prepara um <video> fora da página para lê-la.
    if (trilha !== this.trilha) {
      this.soltar();
      this.trilha = trilha;
      const video = document.createElement('video');
      video.muted = true;
      video.srcObject = new MediaStream([trilha]);
      video.play().catch(() => {}); // sem imagem, as medidas voltam null
      this.video = video;
      return null;
    }
    if (!this.video || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    this.contexto ??= new OffscreenCanvas(LARGURA_AMOSTRA, ALTURA_AMOSTRA).getContext('2d', { willReadFrequently: true });
    if (!this.contexto) return null;
    this.contexto.drawImage(this.video, 0, 0, LARGURA_AMOSTRA, ALTURA_AMOSTRA);
    const atual = paraCinza(this.contexto.getImageData(0, 0, LARGURA_AMOSTRA, ALTURA_AMOSTRA).data);
    const fracao = this.anterior ? fracaoDiferente(this.anterior, atual) : null;
    this.anterior = atual;
    return fracao;
  }

  /** Larga o <video> (fim da sessão ou trilha nova). A trilha em si é parada por quem capturou. */
  soltar(): void {
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.video = null;
    this.trilha = null;
    this.anterior = null;
  }
}
