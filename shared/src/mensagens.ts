// Formato das mensagens trocadas entre o app e o servidor de sinalização.
// Cada mensagem é um objeto JSON com o campo "tipo", que identifica o formato.
// Os esquemas Zod servem para duas coisas: validar o que chega pela rede
// e gerar os tipos TypeScript (assim tipo e validação nunca divergem).
import { z } from 'zod';

/** ID de 9 dígitos, sem zero à esquerda (ex.: "123456789"). */
export const esquemaId = z.string().regex(/^[1-9]\d{8}$/, 'ID deve ter 9 dígitos');
export type IdCliente = z.infer<typeof esquemaId>;

// ---------------------------------------------------------------------------
// App → servidor
// ---------------------------------------------------------------------------

/** Primeira mensagem de toda conexão: pede um ID ao servidor. */
const registrar = z.object({
  tipo: z.literal('registrar'),
  /** Versão do protocolo do app, para o servidor recusar versões incompatíveis. */
  versao: z.number().int().nonnegative(),
});

export const esquemaMensagemDoCliente = z.discriminatedUnion('tipo', [registrar]);
export type MensagemDoCliente = z.infer<typeof esquemaMensagemDoCliente>;

// ---------------------------------------------------------------------------
// Servidor → app
// ---------------------------------------------------------------------------

/** Resposta ao "registrar": o ID que este app vai usar enquanto estiver conectado. */
const registrado = z.object({
  tipo: z.literal('registrado'),
  id: esquemaId,
});

export const esquemaCodigoErro = z.enum([
  /** JSON malformado, tipo desconhecido ou campos inválidos. */
  'mensagem_invalida',
  /** App e servidor usam versões diferentes do protocolo. */
  'versao_incompativel',
  /** A conexão tentou se registrar mais de uma vez. */
  'ja_registrado',
]);
export type CodigoErro = z.infer<typeof esquemaCodigoErro>;

const erro = z.object({
  tipo: z.literal('erro'),
  codigo: esquemaCodigoErro,
  mensagem: z.string(),
});

export const esquemaMensagemDoServidor = z.discriminatedUnion('tipo', [registrado, erro]);
export type MensagemDoServidor = z.infer<typeof esquemaMensagemDoServidor>;

// ---------------------------------------------------------------------------
// Utilitário
// ---------------------------------------------------------------------------

/**
 * Converte o texto recebido pela rede numa mensagem validada.
 * Retorna null se não for JSON ou não seguir o esquema — nunca lança erro,
 * porque dado vindo da rede não é confiável.
 */
export function decodificarMensagem<T>(esquema: z.ZodType<T>, texto: string): T | null {
  let dados: unknown;
  try {
    dados = JSON.parse(texto);
  } catch {
    return null;
  }
  const resultado = esquema.safeParse(dados);
  return resultado.success ? resultado.data : null;
}
