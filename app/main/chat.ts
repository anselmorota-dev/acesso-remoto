// Aviso de mensagem nova no chat quando a janela do app não está em foco
// (ex.: escondida na bandeja, com alguém usando outro programa): notificação
// do Windows (balão da bandeja) e a janela pisca na barra de tarefas. Não
// rouba o foco. Clicar na notificação abre a janela com o chat.
import { ipcMain, Notification } from 'electron';
import { CHAT_TEXTO_MAXIMO } from '@acesso-remoto/shared';
import { CANAL_CHAT_ABRIR, CANAL_CHAT_NOTIFICAR } from '../preload/api';
import { criarLimiteDeAvisos, formatarIdAviso, resumoMensagem } from './aviso-chat';
import { notificarNaBandeja } from './bandeja';
import { janelaDoQuadroPrincipal } from './quadros';

/** No máximo um aviso a cada 4 s (uma conversa rápida não vira uma chuva de balões). */
const INTERVALO_AVISOS_MS = 4000;

export function configurarChat(opcoes: { mostrarJanela: () => void }): void {
  const podeAvisar = criarLimiteDeAvisos(INTERVALO_AVISOS_MS);

  ipcMain.on(CANAL_CHAT_NOTIFICAR, (evento, de: unknown, texto: unknown) => {
    const janela = janelaDoQuadroPrincipal(evento.senderFrame);
    if (!janela) return;
    if (typeof de !== 'string' || !/^[1-9]\d{8}$/.test(de)) return;
    if (typeof texto !== 'string' || !texto || texto.length > CHAT_TEXTO_MAXIMO) return;
    // Quem está com a janela à frente já vê a mensagem no app.
    if (janela.isFocused()) return;

    if (janela.isVisible() && !janela.isMinimized()) {
      janela.flashFrame(true);
      janela.once('focus', () => janela.flashFrame(false));
    }
    if (!podeAvisar()) return;
    console.log('[main] mensagem nova no chat com a janela sem foco: aviso mostrado');

    const titulo = `Mensagem de ${formatarIdAviso(de)}`;
    const corpo = resumoMensagem(texto);
    const abrirChat = () => {
      opcoes.mostrarJanela();
      if (!janela.isDestroyed()) janela.webContents.send(CANAL_CHAT_ABRIR);
    };
    if (notificarNaBandeja(titulo, corpo, abrirChat)) return;
    if (Notification.isSupported()) {
      const notificacao = new Notification({ title: titulo, body: corpo });
      notificacao.on('click', abrirChat);
      notificacao.show();
    }
  });
}
