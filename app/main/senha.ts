// IPC da senha de acesso não supervisionado: liga a janela principal ao
// cofre (cofre-senha.ts), que guarda o hash na pasta de dados do app.
import { join } from 'node:path';
import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { CANAL_SENHA_DEFINIR, CANAL_SENHA_ESTADO, CANAL_SENHA_REMOVER } from '../preload/api';
import { CofreSenha } from './cofre-senha';
import { ehJanelaDoIndicador, sessaoComoAnfitriao } from './indicador';
import { janelaDoQuadroPrincipal } from './quadros';

/** Valida o texto vindo do renderer. O limite é só contra abuso: a regra de tamanho da senha fica no cofre. */
function texto(valor: unknown): string {
  if (typeof valor !== 'string' || valor.length > 1024) throw new Error('pedido inválido');
  return valor;
}

/** Só a janela principal do app pode mexer na senha (nunca o indicador). */
function exigirJanelaPrincipal(evento: IpcMainInvokeEvent): void {
  const janela = janelaDoQuadroPrincipal(evento.senderFrame);
  if (!janela || ehJanelaDoIndicador(janela)) throw new Error('origem não autorizada');
}

export function configurarSenha(): void {
  const cofre = CofreSenha.abrir({
    arquivo: join(app.getPath('userData'), 'seguranca.json'),
    emSessao: sessaoComoAnfitriao,
  });

  ipcMain.handle(CANAL_SENHA_ESTADO, async (evento) => {
    exigirJanelaPrincipal(evento);
    return { definida: (await cofre).definida };
  });

  ipcMain.handle(CANAL_SENHA_DEFINIR, async (evento, nova: unknown, atual: unknown) => {
    exigirJanelaPrincipal(evento);
    return (await cofre).definir(texto(nova), atual === null ? null : texto(atual));
  });

  ipcMain.handle(CANAL_SENHA_REMOVER, async (evento, atual: unknown) => {
    exigirJanelaPrincipal(evento);
    return (await cofre).remover(texto(atual));
  });
}
