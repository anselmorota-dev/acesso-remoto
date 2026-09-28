// Contador de mudanças da área de transferência do Windows.
//
// Ler a área de transferência exige "abri-la", e o Windows só deixa um
// programa por vez: lendo a cada 0,5 s, outros programas falhavam ao copiar
// em ~1% das vezes (medido na 4.2). GetClipboardSequenceNumber (user32) diz
// se algo mudou SEM abrir a área; o monitor só lê o texto quando o número
// muda. Chamado pela koffi (biblioteca de chamadas nativas, binários prontos).
// Em outros sistemas não há esse bloqueio: o monitor lê direto (sem contador).
import koffi from 'koffi';

export function criarContadorDeMudancas(): (() => number) | undefined {
  if (process.platform !== 'win32') return undefined;
  try {
    const user32 = koffi.load('user32.dll');
    const sequencia = user32.func('uint32 __stdcall GetClipboardSequenceNumber()') as () => number;
    return () => sequencia();
  } catch (erro) {
    // Sem o contador, o monitor continua funcionando (lendo a área direto).
    console.warn('[main] contador da área de transferência indisponível:', erro);
    return undefined;
  }
}
