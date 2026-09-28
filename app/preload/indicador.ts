// Preload da janela do indicador de sessão. Expõe só o que ela precisa:
// pedir para encerrar. Nada de input, captura ou outras funções do app.
import { contextBridge, ipcRenderer } from 'electron';
import { CANAL_ENCERRAR_PELO_INDICADOR, type ApiIndicador } from './api-indicador';

const api: ApiIndicador = {
  encerrar: () => ipcRenderer.send(CANAL_ENCERRAR_PELO_INDICADOR),
};

contextBridge.exposeInMainWorld('indicador', api);
