// Gera build/icon.png (256x256), o ícone do instalador e do executável, a
// partir do mesmo desenho do ícone da bandeja (main/icone-bandeja.ts).
// O electron-builder converte o PNG para .ico no Windows (e .icns no macOS).
// Rodar de novo só se o desenho mudar: npm run icone -w @acesso-remoto/app
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { desenharIcone } from '../main/icone-bandeja';

const TAMANHO = 256;

/** Um bloco do PNG: tamanho, tipo, dados e CRC. */
function bloco(tipo: string, dados: Buffer): Buffer {
  const cabecalho = Buffer.alloc(8);
  cabecalho.writeUInt32BE(dados.length, 0);
  cabecalho.write(tipo, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([cabecalho.subarray(4), dados])));
  return Buffer.concat([cabecalho, dados, crc]);
}

/** PNG RGBA a partir do bitmap BGRA do ícone. */
function paraPng(bgra: Buffer, tamanho: number): Buffer {
  const linhas = Buffer.alloc(tamanho * (tamanho * 4 + 1));
  for (let y = 0; y < tamanho; y++) {
    const inicio = y * (tamanho * 4 + 1);
    linhas[inicio] = 0; // filtro "nenhum"
    for (let x = 0; x < tamanho; x++) {
      const de = (y * tamanho + x) * 4;
      const para = inicio + 1 + x * 4;
      linhas[para] = bgra[de + 2]!;
      linhas[para + 1] = bgra[de + 1]!;
      linhas[para + 2] = bgra[de]!;
      linhas[para + 3] = bgra[de + 3]!;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tamanho, 0);
  ihdr.writeUInt32BE(tamanho, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('IDAT', deflateSync(linhas)),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}

const destino = join(import.meta.dirname, 'icon.png');
writeFileSync(destino, paraPng(desenharIcone(TAMANHO, false), TAMANHO));
console.log(`ícone gerado: ${destino}`);
