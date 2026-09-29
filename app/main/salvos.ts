// IPC dos computadores salvos (conexoes-salvas.ts). Só a janela principal
// usa; a senha decifrada só sai daqui no instante de conectar.
import { join } from 'node:path';
import { app, ipcMain, safeStorage, type IpcMainInvokeEvent } from 'electron';
import {
  CANAL_SALVOS_LISTAR,
  CANAL_SALVOS_MARCAR_USO,
  CANAL_SALVOS_REMOVER,
  CANAL_SALVOS_SALVAR,
  CANAL_SALVOS_SENHA,
} from '../preload/api';
import { ConexoesSalvas } from './conexoes-salvas';
import { ehJanelaDoIndicador } from './indicador';
import { janelaDoQuadroPrincipal } from './quadros';

function exigirJanelaPrincipal(evento: IpcMainInvokeEvent): void {
  const janela = janelaDoQuadroPrincipal(evento.senderFrame);
  if (!janela || ehJanelaDoIndicador(janela)) throw new Error('origem não autorizada');
}

export function configurarSalvos(): void {
  const salvos = ConexoesSalvas.abrir({
    arquivo: join(app.getPath('userData'), 'conexoes.json'),
    cifra: {
      disponivel: () => safeStorage.isEncryptionAvailable(),
      cifrar: (texto) => safeStorage.encryptString(texto),
      decifrar: (dados) => safeStorage.decryptString(dados),
    },
  });

  ipcMain.handle(CANAL_SALVOS_LISTAR, async (evento) => {
    exigirJanelaPrincipal(evento);
    return (await salvos).listar();
  });

  // senha: texto = guardar; null = esquecer; undefined = manter a atual.
  ipcMain.handle(CANAL_SALVOS_SALVAR, async (evento, id: unknown, apelido: unknown, senha: unknown) => {
    exigirJanelaPrincipal(evento);
    const valor = typeof senha === 'string' || senha === null ? senha : undefined;
    return (await salvos).salvar(id, apelido, valor);
  });

  ipcMain.handle(CANAL_SALVOS_REMOVER, async (evento, id: unknown) => {
    exigirJanelaPrincipal(evento);
    await (await salvos).remover(id);
  });

  ipcMain.handle(CANAL_SALVOS_SENHA, async (evento, id: unknown) => {
    exigirJanelaPrincipal(evento);
    return (await salvos).senhaParaConectar(id);
  });

  ipcMain.handle(CANAL_SALVOS_MARCAR_USO, async (evento, id: unknown) => {
    exigirJanelaPrincipal(evento);
    await (await salvos).marcarUso(id);
  });
}
