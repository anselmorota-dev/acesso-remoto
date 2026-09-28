// Ícone da bandeja, desenhado por código (sem arquivo de imagem): um círculo
// com um monitor branco. Cinza escuro normalmente; vermelho durante uma
// sessão, para chamar a atenção de quem olha a bandeja.
// O ícone definitivo (.ico/.icns) vem com os instaladores (etapa 5.4).

const COR_NORMAL = { r: 0x3a, g: 0x3f, b: 0x4b };
const COR_SESSAO = { r: 0xd6, g: 0x45, b: 0x2f };

/**
 * Bitmap tamanho×tamanho no formato BGRA (o que o nativeImage.createFromBitmap
 * espera no Windows e no macOS).
 */
export function desenharIcone(tamanho: number, emSessao: boolean): Buffer {
  const bitmap = Buffer.alloc(tamanho * tamanho * 4); // tudo transparente
  const fundo = emSessao ? COR_SESSAO : COR_NORMAL;
  const centro = (tamanho - 1) / 2;
  const raio = tamanho / 2;
  // Medidas do monitor proporcionais ao ícone (desenhadas numa grade de 16).
  const u = tamanho / 16;
  const dentro = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) =>
    x >= x0 * u && x < x1 * u && y >= y0 * u && y < y1 * u;

  for (let y = 0; y < tamanho; y++) {
    for (let x = 0; x < tamanho; x++) {
      const distancia = Math.hypot(x - centro, y - centro);
      // Borda do círculo suavizada (meio pixel de transição).
      const alfa = Math.max(0, Math.min(1, raio - distancia + 0.5));
      if (alfa === 0) continue;

      const monitor =
        dentro(x, y, 4, 4, 12, 10) || // tela
        dentro(x, y, 7, 10, 9, 12) || // pé
        dentro(x, y, 5, 12, 11, 13); // base
      const cor = monitor ? { r: 255, g: 255, b: 255 } : fundo;
      const i = (y * tamanho + x) * 4;
      bitmap[i] = cor.b;
      bitmap[i + 1] = cor.g;
      bitmap[i + 2] = cor.r;
      bitmap[i + 3] = Math.round(alfa * 255);
    }
  }
  return bitmap;
}
