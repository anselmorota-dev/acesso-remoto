// Mensagens trocadas diretamente entre os dois apps pelo DataChannel do
// WebRTC (sem passar pelo servidor): o ping que mede a latência e os
// eventos de input (mouse e teclado) e, no acesso não supervisionado, a senha.
import { z } from 'zod';
import { esquemaMotivoFalha } from './mensagens.js';
import { SENHA_MAXIMA } from './senha.js';

/** Falhas que podem encerrar a sessão pelo canal direto (todas menos as de senha). */
export const esquemaMotivoFimPeloCanal = esquemaMotivoFalha.exclude(['senha_incorreta', 'senha_bloqueada']);
export type MotivoFimPeloCanal = z.infer<typeof esquemaMotivoFimPeloCanal>;

/** Maior mensagem aceita pelo canal, checada antes do JSON.parse. */
export const TAMANHO_MAXIMO_MENSAGEM_CANAL = 16 * 1024;

// ---------------------------------------------------------------------------
// Eventos de input (visualizador → anfitrião)
// ---------------------------------------------------------------------------

/** Posição na tela remota normalizada: 0 = borda esquerda/superior, 1 = direita/inferior. */
const coordenada = z.number().min(0).max(1);

/** Maior rolagem aceita num único evento, em pixels (vários "cliques" da roda). */
export const ROLAGEM_MAXIMA = 2000;
const rolagem = z.number().int().min(-ROLAGEM_MAXIMA).max(ROLAGEM_MAXIMA);

export const esquemaBotaoMouse = z.enum(['esquerdo', 'meio', 'direito']);
export type BotaoMouse = z.infer<typeof esquemaBotaoMouse>;

/**
 * Teclas enviadas pelo nome (mesmos nomes do robotjs). Letras, números e
 * símbolos não entram aqui: como texto, viajam em "texto"; em atalhos
 * (Ctrl+C), como um único caractere ASCII no campo "tecla".
 */
export const TECLAS_NOMEADAS = [
  // Modificadores
  'control', 'right_control', 'shift', 'right_shift', 'alt', 'right_alt', 'command',
  // Edição e navegação
  'enter', 'tab', 'backspace', 'delete', 'escape', 'space', 'insert', 'menu',
  'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown',
  // Funções
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
] as const;
export type TeclaNomeada = (typeof TECLAS_NOMEADAS)[number];

/** Uma tecla nomeada ou um único caractere ASCII visível (usado em atalhos). */
const tecla = z.union([z.enum(TECLAS_NOMEADAS), z.string().regex(/^[\x21-\x7e]$/)]);

/** Maior texto num único evento (normalmente é um caractere por tecla). */
export const TEXTO_MAXIMO = 32;

const esquemasInput = [
  /** Move o cursor para a posição. */
  z.object({ tipo: z.literal('mouse_mover'), x: coordenada, y: coordenada }),
  /**
   * Aperta ou solta um botão. Leva a posição junto para o clique cair no
   * lugar certo mesmo que o último "mover" ainda não tenha sido enviado.
   */
  z.object({
    tipo: z.literal('mouse_botao'),
    botao: esquemaBotaoMouse,
    pressionado: z.boolean(),
    x: coordenada,
    y: coordenada,
  }),
  /** Rola a roda do mouse, em pixels, como no navegador (dy > 0 = descer, dx > 0 = direita). */
  z.object({ tipo: z.literal('mouse_rolar'), dx: rolagem, dy: rolagem }),
  /** Aperta ou solta uma tecla (teclas especiais, modificadores e atalhos). */
  z.object({ tipo: z.literal('tecla'), tecla, pressionada: z.boolean() }),
  /**
   * Digita texto (letras, acentos, símbolos), já composto no visualizador:
   * não depende do layout de teclado do anfitrião. Caracteres de controle
   * (Enter, Tab...) são barrados: esses viajam como "tecla".
   */
  z.object({
    tipo: z.literal('texto'),
    texto: z.string().min(1).max(TEXTO_MAXIMO).regex(/^\P{Cc}+$/u),
  }),
] as const;

/** Eventos de input: chegam pelo canal e são repassados do renderer ao main. */
export const esquemaEventoInput = z.discriminatedUnion('tipo', [...esquemasInput]);
export type EventoInput = z.infer<typeof esquemaEventoInput>;

// ---------------------------------------------------------------------------
// Todas as mensagens do canal
// ---------------------------------------------------------------------------

export const esquemaMensagemCanal = z.discriminatedUnion('tipo', [
  /** Pedido de eco; "t" é o horário de envio (relógio de quem enviou). */
  z.object({ tipo: z.literal('ping'), t: z.number().finite() }),
  /** Eco do ping, devolvendo o mesmo "t" para calcular o tempo de ida e volta. */
  z.object({ tipo: z.literal('pong'), t: z.number().finite() }),
  /**
   * Visualizador → anfitrião, na sessão aceita por senha: a senha, pela conexão
   * direta (criptografada), nunca pelo servidor. Limite folgado em unidades
   * UTF-16; a regra de tamanho de verdade é checada no anfitrião.
   */
  z.object({ tipo: z.literal('senha'), senha: z.string().min(1).max(SENHA_MAXIMA * 4) }),
  /** Anfitrião → visualizador: a senha conferiu; tela e controle liberados. */
  z.object({ tipo: z.literal('autenticado') }),
  /**
   * Qualquer lado: a sessão acabou (clique em Encerrar ou falha). Vai também
   * pelo servidor; pelo canal, o fim chega mesmo com o servidor fora do ar.
   * Senha recusada não vem por aqui: esse aviso só vale pelo servidor, que
   * conta os erros (o visualizador não pode se adiantar e "apagar" a contagem).
   */
  z.object({ tipo: z.literal('encerrar'), motivo: esquemaMotivoFimPeloCanal.optional() }),
  ...esquemasInput,
]);
export type MensagemCanal = z.infer<typeof esquemaMensagemCanal>;
