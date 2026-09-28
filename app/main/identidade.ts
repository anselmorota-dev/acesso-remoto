// IPC da identidade da instalação: a janela principal (onde fica a conexão
// com o servidor) pede a chave pública e a assinatura do desafio de registro.
// A chave privada nunca sai do processo main.
import { join } from 'node:path';
import { app, ipcMain, safeStorage, type IpcMainInvokeEvent } from 'electron';
import { CANAL_IDENTIDADE_ASSINAR, CANAL_IDENTIDADE_CHAVE } from '../preload/api';
import { ChavesInstalacao } from './chaves-instalacao';
import { ehJanelaDoIndicador } from './indicador';
import { janelaDoQuadroPrincipal } from './quadros';

function exigirJanelaPrincipal(evento: IpcMainInvokeEvent): void {
  const janela = janelaDoQuadroPrincipal(evento.senderFrame);
  if (!janela || ehJanelaDoIndicador(janela)) throw new Error('origem não autorizada');
}

export function configurarIdentidade(): void {
  const chaves = ChavesInstalacao.abrir({
    arquivo: join(app.getPath('userData'), 'identidade.json'),
    cifra: {
      disponivel: () => safeStorage.isEncryptionAvailable(),
      cifrar: (texto) => safeStorage.encryptString(texto),
      decifrar: (dados) => safeStorage.decryptString(dados),
    },
  });

  ipcMain.handle(CANAL_IDENTIDADE_CHAVE, async (evento) => {
    exigirJanelaPrincipal(evento);
    return (await chaves).chavePublica;
  });

  ipcMain.handle(CANAL_IDENTIDADE_ASSINAR, async (evento, desafio: unknown) => {
    exigirJanelaPrincipal(evento);
    if (typeof desafio !== 'string') throw new Error('desafio inválido');
    return (await chaves).assinarDesafio(desafio);
  });
}
