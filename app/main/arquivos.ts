// Arquivos recebidos do outro computador: liga a janela principal (que recebe
// os pedaços pela conexão direta) à gravação em Downloads\Acesso Remoto
// (recebimentos.ts). O renderer nunca escolhe a pasta nem o caminho: só
// manda o nome sugerido e os bytes; nome e lugar são decididos aqui.
import { join } from 'node:path';
import { app, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { NOME_ARQUIVO_MAXIMO, PEDACO_ARQUIVO } from '@acesso-remoto/shared';
import {
  CANAL_ARQUIVOS_CONCLUIR,
  CANAL_ARQUIVOS_DESCARTAR,
  CANAL_ARQUIVOS_FALHOU,
  CANAL_ARQUIVOS_INICIAR,
  CANAL_ARQUIVOS_MOSTRAR,
  CANAL_ARQUIVOS_PEDACO,
} from '../preload/api';
import { janelaDoQuadroPrincipal } from './quadros';
import { Recebimentos } from './recebimentos';

/** A janela que está recebendo: se ela fechar, travar ou recarregar, os parciais são apagados. */
let dono: WebContents | null = null;
let recebimentos: Recebimentos | null = null;

const aoPerderDono = () => {
  recebimentos?.descartarTodos();
  soltarDono();
};
const EVENTOS_PERDA_DONO = ['destroyed', 'render-process-gone', 'did-start-loading'] as const;

function soltarDono(): void {
  if (dono && !dono.isDestroyed()) {
    for (const evento of EVENTOS_PERDA_DONO) dono.off(evento as 'destroyed', aoPerderDono);
  }
  dono = null;
}

function pasta(): string {
  return join(app.getPath('downloads'), 'Acesso Remoto');
}

function daJanelaPrincipal(evento: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return janelaDoQuadroPrincipal(evento.senderFrame) !== null;
}

const ehToken = (valor: unknown): valor is string => typeof valor === 'string' && /^[0-9a-f-]{36}$/.test(valor);

export function configurarArquivos(): void {
  recebimentos = new Recebimentos(pasta(), (token) => {
    if (dono && !dono.isDestroyed()) dono.send(CANAL_ARQUIVOS_FALHOU, token);
  });
  const r = recebimentos;

  ipcMain.handle(CANAL_ARQUIVOS_INICIAR, (evento, nome: unknown, tamanho: unknown) => {
    if (!daJanelaPrincipal(evento)) throw new Error('origem não autorizada');
    if (typeof nome !== 'string' || !nome || nome.length > NOME_ARQUIVO_MAXIMO) return null;
    if (typeof tamanho !== 'number' || !Number.isSafeInteger(tamanho) || tamanho < 0) return null;
    if (dono !== evento.sender) {
      soltarDono();
      dono = evento.sender;
      for (const nomeEvento of EVENTOS_PERDA_DONO) evento.sender.on(nomeEvento as 'destroyed', aoPerderDono);
    }
    const token = r.iniciar(nome, tamanho);
    if (!token) console.warn('[main] não foi possível criar a pasta de arquivos recebidos');
    return token;
  });

  ipcMain.on(CANAL_ARQUIVOS_PEDACO, (evento, token: unknown, pedaco: unknown) => {
    if (evento.sender !== dono || !ehToken(token)) return;
    if (!(pedaco instanceof Uint8Array) || pedaco.byteLength > PEDACO_ARQUIVO) return;
    r.gravar(token, pedaco);
  });

  ipcMain.handle(CANAL_ARQUIVOS_CONCLUIR, async (evento, token: unknown) => {
    if (evento.sender !== dono || !ehToken(token)) return { ok: false, erro: 'disco' };
    const resultado = await r.concluir(token);
    if (resultado.ok) console.log(`[main] arquivo recebido: ${resultado.nome}`);
    // O caminho completo fica aqui; o renderer só precisa do nome.
    return resultado.ok ? { ok: true, nome: resultado.nome } : resultado;
  });

  ipcMain.on(CANAL_ARQUIVOS_DESCARTAR, (evento, token: unknown) => {
    if (evento.sender === dono && ehToken(token)) r.descartar(token);
  });

  // "Mostrar na pasta": só arquivos recebidos nesta execução (nunca um caminho vindo do renderer).
  ipcMain.on(CANAL_ARQUIVOS_MOSTRAR, (evento, token: unknown) => {
    if (!daJanelaPrincipal(evento) || !ehToken(token)) return;
    const caminho = r.caminhoConcluido(token);
    if (caminho) shell.showItemInFolder(caminho);
  });
}
