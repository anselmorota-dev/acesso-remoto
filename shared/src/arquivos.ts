// Transferência de arquivos pelo canal "arquivos" (separado do canal
// "controle", para um arquivo grande nunca atrasar mouse e teclado).
//
// Cada lado envia um arquivo por vez (os outros esperam na fila):
//   arquivo_inicio {id, nome, tamanho} → pedaços binários (até 64 KiB cada)
//   → arquivo_fim {id}; quem recebe responde arquivo_recebido {id} ou
//   arquivo_erro {id, motivo}. Qualquer lado pode mandar arquivo_cancelar {id}.
// "id" é numerado por quem envia; os pedaços pertencem ao arquivo em
// andamento naquele sentido (o canal entrega tudo em ordem).
import { z } from 'zod';

/** Tamanho de cada pedaço binário (o WebRTC não aceita o arquivo inteiro de uma vez). */
export const PEDACO_ARQUIVO = 64 * 1024;

/** Maior mensagem de controle (JSON) aceita no canal de arquivos. */
export const TAMANHO_MAXIMO_CONTROLE_ARQUIVOS = 4 * 1024;

/** Maior nome de arquivo aceito (o nome de fato é limpo e encurtado por quem recebe). */
export const NOME_ARQUIVO_MAXIMO = 255;

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const esquemaMotivoErroArquivo = z.enum([
  /** Quem recebe não conseguiu gravar (disco cheio, sem permissão). */
  'disco',
  /** Chegou mais ou menos do que o tamanho anunciado. */
  'tamanho',
  /** Mensagens fora de ordem ou inválidas: a transferência foi abandonada. */
  'protocolo',
]);
export type MotivoErroArquivo = z.infer<typeof esquemaMotivoErroArquivo>;

export const esquemaMensagemArquivos = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('arquivo_inicio'),
    id,
    nome: z.string().min(1).max(NOME_ARQUIVO_MAXIMO),
    tamanho: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
  z.object({ tipo: z.literal('arquivo_fim'), id }),
  z.object({ tipo: z.literal('arquivo_cancelar'), id }),
  z.object({ tipo: z.literal('arquivo_recebido'), id }),
  z.object({ tipo: z.literal('arquivo_erro'), id, motivo: esquemaMotivoErroArquivo }),
]);
export type MensagemArquivos = z.infer<typeof esquemaMensagemArquivos>;
