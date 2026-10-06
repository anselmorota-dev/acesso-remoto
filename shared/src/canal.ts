// Mensagens trocadas diretamente entre os dois apps pelo DataChannel do
// WebRTC (sem passar pelo servidor): o ping que mede a latência, os eventos
// de input (mouse e teclado), a escolha do monitor e, no acesso não
// supervisionado, a senha.
import { z } from 'zod';
import { esquemaMotivoFalha } from './mensagens.js';
import { SENHA_MAXIMA } from './senha.js';

/** Falhas que podem encerrar a sessão pelo canal direto (todas menos as de senha). */
export const esquemaMotivoFimPeloCanal = esquemaMotivoFalha.exclude(['senha_incorreta', 'senha_bloqueada']);
export type MotivoFimPeloCanal = z.infer<typeof esquemaMotivoFimPeloCanal>;

/**
 * Maior mensagem aceita pelo canal (em unidades de texto), checada antes do
 * JSON.parse. É o tamanho máximo de mensagem que o Chromium negocia no
 * WebRTC (256 KiB); cabe um texto grande da área de transferência.
 */
export const TAMANHO_MAXIMO_MENSAGEM_CANAL = 256 * 1024;

/**
 * Maior texto da área de transferência enviado de uma vez (em caracteres).
 * O limite de fato é o tamanho da mensagem em bytes, conferido no envio:
 * com acentos e símbolos, cabem menos caracteres.
 */
export const TEXTO_AREA_TRANSFERENCIA_MAXIMO = 200_000;

/** Maior mensagem do chat (em caracteres). */
export const CHAT_TEXTO_MAXIMO = 2000;

// ---------------------------------------------------------------------------
// Eventos de input (visualizador → anfitrião)
// ---------------------------------------------------------------------------

/** Posição na tela remota normalizada: 0 = borda esquerda/superior, 1 = direita/inferior. */
const coordenada = z.number().min(0).max(1);

/** Maior rolagem aceita num único evento, em pixels (vários "cliques" da roda). */
export const ROLAGEM_MAXIMA = 2000;
const rolagem = z.number().int().min(-ROLAGEM_MAXIMA).max(ROLAGEM_MAXIMA);

/**
 * Número de sequência dos movimentos do mouse. O "mover" vai por um canal
 * sem ordem e sem retransmissão (canal "mouse"): o anfitrião descarta os que
 * chegam atrasados. O clique leva o número do último movimento enviado, para
 * um movimento atrasado não mexer no mouse depois dele. Opcional: versões que
 * não o mandam continuam funcionando (sem descarte).
 */
const sequencia = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional();

/** Canal só dos movimentos do mouse: sem ordem e sem retransmissão. */
export const ROTULO_CANAL_MOUSE = 'mouse';

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
  z.object({ tipo: z.literal('mouse_mover'), x: coordenada, y: coordenada, n: sequencia }),
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
    n: sequencia,
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
// Monitores do anfitrião (etapa 5.1)
// ---------------------------------------------------------------------------

/** Mais monitores que isso num computador é defeito ou abuso. */
export const MONITORES_MAXIMO = 16;

/** Identificador de um monitor (o número que o sistema dá a ele, em texto). */
export const esquemaIdMonitor = z.string().regex(/^\d{1,20}$/);
export type IdMonitor = z.infer<typeof esquemaIdMonitor>;

const pixels = z.number().int().min(1).max(32_768);

/** Um monitor do anfitrião, como o visualizador vê na lista. */
export const esquemaMonitor = z.object({
  id: esquemaIdMonitor,
  /** Resolução em pixels reais (a da imagem capturada). */
  largura: pixels,
  altura: pixels,
  /** É o monitor principal do sistema (onde fica a barra de tarefas). */
  principal: z.boolean(),
});
export type Monitor = z.infer<typeof esquemaMonitor>;

// ---------------------------------------------------------------------------
// Qualidade do vídeo (etapa 5.2)
// ---------------------------------------------------------------------------

/**
 * O que o visualizador escolhe: "nitidez" (resolução cheia; em movimento
 * pesado com pouca banda, o fps cai), "fluidez" (fps alto; a resolução cai)
 * ou "automatico" (nitidez, trocando para fluidez enquanto a tela está em
 * movimento e a conexão não acompanha).
 */
export const esquemaModoQualidade = z.enum(['automatico', 'nitidez', 'fluidez']);
export type ModoQualidade = z.infer<typeof esquemaModoQualidade>;

/** Como o vídeo está sendo codificado de fato (no automático, muda sozinho). */
export const esquemaPerfilVideo = z.enum(['nitidez', 'fluidez']);
export type PerfilVideo = z.infer<typeof esquemaPerfilVideo>;

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
  /**
   * Qualquer lado, com a sessão liberada: o texto que acabou de ser copiado
   * neste computador, para o outro colar. Vai pelo mesmo canal do teclado,
   * então chega antes de um Ctrl+V enviado logo depois.
   */
  z.object({ tipo: z.literal('area_transferencia'), texto: z.string().min(1).max(TEXTO_AREA_TRANSFERENCIA_MAXIMO) }),
  /**
   * Qualquer lado, com a sessão liberada: uma mensagem do chat. Texto puro
   * (quem recebe mostra como texto, nunca como HTML); quebras de linha valem.
   */
  z.object({ tipo: z.literal('chat'), texto: z.string().trim().min(1).max(CHAT_TEXTO_MAXIMO) }),
  /**
   * Anfitrião → visualizador, com a sessão liberada: os monitores deste
   * computador (da esquerda para a direita) e qual está sendo mostrado.
   * Vai quando a imagem começa, a cada troca e quando os monitores mudam.
   */
  z.object({
    tipo: z.literal('monitores'),
    lista: z.array(esquemaMonitor).min(1).max(MONITORES_MAXIMO),
    atual: esquemaIdMonitor,
  }),
  /** Visualizador → anfitrião, com a sessão liberada: mostrar outro monitor. */
  z.object({ tipo: z.literal('escolher_monitor'), id: esquemaIdMonitor }),
  /** Visualizador → anfitrião, com a sessão liberada: o modo de qualidade escolhido. */
  z.object({ tipo: z.literal('qualidade'), modo: esquemaModoQualidade }),
  /**
   * Anfitrião → visualizador, com a sessão liberada: o modo em uso e o perfil
   * de fato (no automático, "nitidez" ou "fluidez" conforme o movimento).
   */
  z.object({ tipo: z.literal('qualidade_estado'), modo: esquemaModoQualidade, efetivo: esquemaPerfilVideo }),
  ...esquemasInput,
]);
export type MensagemCanal = z.infer<typeof esquemaMensagemCanal>;
