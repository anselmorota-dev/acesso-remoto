// Visualizador: transforma o mouse sobre o vídeo da tela remota em eventos
// de input para o anfitrião.
//
// O vídeo usa object-fit: contain, então a imagem pode ter faixas pretas
// em volta; as coordenadas são calculadas sobre a área da imagem e enviadas
// normalizadas (0 a 1), independentes do tamanho da janela de cada lado.
//
// Para não inundar o canal, movimentos e rolagens são agrupados e enviados
// no máximo uma vez por quadro de tela (requestAnimationFrame). Botões vão
// na hora, com a posição junto.
import { ROLAGEM_MAXIMA, type BotaoMouse, type EventoInput } from '@acesso-remoto/shared';

export interface Retangulo {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Ponto {
  x: number;
  y: number;
}

/** Onde a imagem aparece dentro do elemento (object-fit: contain), ou null se não há imagem. */
export function areaDaImagem(elemento: Retangulo, larguraVideo: number, alturaVideo: number): Retangulo | null {
  if (larguraVideo <= 0 || alturaVideo <= 0 || elemento.width <= 0 || elemento.height <= 0) return null;
  const escala = Math.min(elemento.width / larguraVideo, elemento.height / alturaVideo);
  const width = larguraVideo * escala;
  const height = alturaVideo * escala;
  return {
    left: elemento.left + (elemento.width - width) / 2,
    top: elemento.top + (elemento.height - height) / 2,
    width,
    height,
  };
}

/**
 * Converte um ponto da janela em coordenada normalizada da imagem.
 * Fora da imagem: null, ou preso à borda se "prender" (durante um arraste).
 */
export function normalizar(clienteX: number, clienteY: number, area: Retangulo, prender: boolean): Ponto | null {
  let x = (clienteX - area.left) / area.width;
  let y = (clienteY - area.top) / area.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) {
    if (!prender) return null;
    x = Math.min(1, Math.max(0, x));
    y = Math.min(1, Math.max(0, y));
  }
  return { x, y };
}

/** Pixels por "linha" de rolagem, quando o navegador informa em linhas. */
const PIXELS_POR_LINHA = 40;

/** Converte a rolagem do WheelEvent para pixels (deltaMode: 0 pixels, 1 linhas, 2 páginas). */
export function rolagemEmPixels(dx: number, dy: number, modo: number, alturaPagina: number): { dx: number; dy: number } {
  const fator = modo === 1 ? PIXELS_POR_LINHA : modo === 2 ? alturaPagina : 1;
  return { dx: dx * fator, dy: dy * fator };
}

// MouseEvent.button → botão do protocolo (os botões extras são ignorados).
const BOTOES: Partial<Record<number, BotaoMouse>> = { 0: 'esquerdo', 1: 'meio', 2: 'direito' };

const limitarRolagem = (valor: number) => Math.max(-ROLAGEM_MAXIMA, Math.min(ROLAGEM_MAXIMA, Math.round(valor)));

export interface ControleRemoto {
  /** Esquece botões apertados e envios pendentes (fim da sessão). */
  redefinir(): void;
}

export function montarControleRemoto(video: HTMLVideoElement, enviar: (evento: EventoInput) => void): ControleRemoto {
  const pressionados = new Set<BotaoMouse>();
  let ultimoPonto: Ponto | null = null;
  let movimentoPendente: Ponto | null = null;
  let rolagemPendente = { dx: 0, dy: 0 };
  let quadroAgendado = false;

  const pontoDe = (evento: MouseEvent, prender: boolean): Ponto | null => {
    const area = areaDaImagem(video.getBoundingClientRect(), video.videoWidth, video.videoHeight);
    return area ? normalizar(evento.clientX, evento.clientY, area, prender) : null;
  };

  function agendarEnvio(): void {
    if (quadroAgendado) return;
    quadroAgendado = true;
    requestAnimationFrame(enviarPendentes);
  }

  function enviarPendentes(): void {
    quadroAgendado = false;
    if (movimentoPendente) {
      enviar({ tipo: 'mouse_mover', ...movimentoPendente });
      movimentoPendente = null;
    }
    const dx = limitarRolagem(rolagemPendente.dx);
    const dy = limitarRolagem(rolagemPendente.dy);
    rolagemPendente = { dx: 0, dy: 0 };
    if (dx !== 0 || dy !== 0) enviar({ tipo: 'mouse_rolar', dx, dy });
  }

  function mudarBotao(botao: BotaoMouse, pressionado: boolean, ponto: Ponto): void {
    // O botão leva a posição mais recente; um "mover" pendente ficaria para trás.
    movimentoPendente = null;
    if (pressionado) pressionados.add(botao);
    else pressionados.delete(botao);
    enviar({ tipo: 'mouse_botao', botao, pressionado, ...ponto });
  }

  // Apertar só vale sobre a imagem; soltar e mover são ouvidos na janela
  // inteira, para um arraste que sai da imagem continuar funcionando.
  video.addEventListener('mousedown', (evento) => {
    const botao = BOTOES[evento.button];
    const ponto = pontoDe(evento, false);
    if (!botao || !ponto) return;
    evento.preventDefault(); // evita seleção de texto e a rolagem automática do botão do meio
    ultimoPonto = ponto;
    mudarBotao(botao, true, ponto);
  });

  window.addEventListener('mouseup', (evento) => {
    const botao = BOTOES[evento.button];
    if (!botao || !pressionados.has(botao)) return;
    const ponto = pontoDe(evento, true) ?? ultimoPonto;
    if (ponto) mudarBotao(botao, false, ponto);
  });

  window.addEventListener('mousemove', (evento) => {
    // Fora da imagem, o movimento só conta durante um arraste (preso à borda).
    const ponto = pontoDe(evento, pressionados.size > 0);
    if (!ponto) return;
    ultimoPonto = ponto;
    movimentoPendente = ponto;
    agendarEnvio();
  });

  // Se a janela perde o foco no meio de um arraste (ex.: Alt+Tab), o "soltar"
  // nunca chegaria: solta tudo para o anfitrião não ficar com botão preso.
  window.addEventListener('blur', () => {
    if (!ultimoPonto) return;
    for (const botao of [...pressionados]) mudarBotao(botao, false, ultimoPonto);
  });

  video.addEventListener(
    'wheel',
    (evento) => {
      evento.preventDefault();
      if (!pontoDe(evento, false)) return;
      const { dx, dy } = rolagemEmPixels(evento.deltaX, evento.deltaY, evento.deltaMode, video.clientHeight);
      rolagemPendente = { dx: rolagemPendente.dx + dx, dy: rolagemPendente.dy + dy };
      agendarEnvio();
    },
    { passive: false }, // necessário para o preventDefault valer
  );

  // O clique direito vai para o computador remoto, não abre menu aqui.
  video.addEventListener('contextmenu', (evento) => evento.preventDefault());

  return {
    redefinir() {
      pressionados.clear();
      ultimoPonto = null;
      movimentoPendente = null;
      rolagemPendente = { dx: 0, dy: 0 };
    },
  };
}
