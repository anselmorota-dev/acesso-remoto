// Preload: ponte entre o main e o renderer. Roda em sandbox e expõe
// ao renderer apenas o objeto abaixo, via contextBridge. O ipcRenderer
// nunca é exposto inteiro: cada função usa um canal fixo, e o main valida
// qualquer dado que o renderer mande junto.
import { contextBridge, ipcRenderer } from 'electron';
import {
  CANAL_AREA_COPIADO,
  CANAL_AREA_ESCREVER,
  CANAL_AREA_MONITORAR,
  CANAL_ARQUIVOS_CONCLUIR,
  CANAL_ARQUIVOS_DESCARTAR,
  CANAL_ARQUIVOS_FALHOU,
  CANAL_ARQUIVOS_INICIAR,
  CANAL_ARQUIVOS_MOSTRAR,
  CANAL_ARQUIVOS_PEDACO,
  CANAL_BANDEJA_ESTADO,
  CANAL_CHAMAR_ATENCAO,
  CANAL_CHAT_ABRIR,
  CANAL_CHAT_NOTIFICAR,
  CANAL_INICIO_AUTOMATICO_DEFINIR,
  CANAL_INICIO_AUTOMATICO_LER,
  CANAL_INICIO_AUTOMATICO_MUDOU,
  CANAL_EXECUTAR_INPUT,
  CANAL_IDENTIDADE_ASSINAR,
  CANAL_IDENTIDADE_CHAVE,
  CANAL_INDICAR_SESSAO,
  CANAL_LIBERAR_INPUT,
  CANAL_MANTER_ACORDADO,
  CANAL_MONITORES_LISTAR,
  CANAL_MONITORES_MUDOU,
  CANAL_MONITORES_PREPARAR,
  CANAL_PEDIDO_ENCERRAR,
  CANAL_SENHA_DEFINIR,
  CANAL_SENHA_ESTADO,
  CANAL_SENHA_REMOVER,
  CANAL_SENHA_TENTAR,
  type ApiDoPreload,
} from './api';

const api: ApiDoPreload = {
  versoes: {
    electron: process.versions.electron ?? '?',
    chrome: process.versions.chrome ?? '?',
    node: process.versions.node,
  },
  chamarAtencao: () => ipcRenderer.send(CANAL_CHAMAR_ATENCAO),
  input: {
    executar: (evento) => ipcRenderer.send(CANAL_EXECUTAR_INPUT, evento),
    liberar: () => ipcRenderer.send(CANAL_LIBERAR_INPUT),
  },
  sessao: {
    indicar: (parceiro) => ipcRenderer.send(CANAL_INDICAR_SESSAO, parceiro),
    // O evento do IPC não é repassado: daria ao renderer acesso ao ipcRenderer.
    aoPedirEncerramento: (tratar) => {
      ipcRenderer.on(CANAL_PEDIDO_ENCERRAR, () => tratar());
    },
    manterAcordado: (ligar) => ipcRenderer.send(CANAL_MANTER_ACORDADO, ligar),
  },
  monitores: {
    listar: () => ipcRenderer.invoke(CANAL_MONITORES_LISTAR),
    preparar: (id) => ipcRenderer.invoke(CANAL_MONITORES_PREPARAR, id),
    aoMudar: (tratar) => {
      ipcRenderer.on(CANAL_MONITORES_MUDOU, () => tratar());
    },
  },
  areaTransferencia: {
    monitorar: (ligar, enviarAtual) => ipcRenderer.send(CANAL_AREA_MONITORAR, ligar, enviarAtual),
    // Só o texto chega ao renderer, nunca o evento do IPC.
    aoCopiar: (tratar) => {
      ipcRenderer.on(CANAL_AREA_COPIADO, (_evento, texto: unknown) => tratar(typeof texto === 'string' ? texto : null));
    },
    escrever: (texto) => ipcRenderer.send(CANAL_AREA_ESCREVER, texto),
  },
  arquivos: {
    iniciar: (nome, tamanho) => ipcRenderer.invoke(CANAL_ARQUIVOS_INICIAR, nome, tamanho),
    gravar: (token, pedaco) => ipcRenderer.send(CANAL_ARQUIVOS_PEDACO, token, pedaco),
    concluir: (token) => ipcRenderer.invoke(CANAL_ARQUIVOS_CONCLUIR, token),
    descartar: (token) => ipcRenderer.send(CANAL_ARQUIVOS_DESCARTAR, token),
    mostrar: (token) => ipcRenderer.send(CANAL_ARQUIVOS_MOSTRAR, token),
    aoFalhar: (tratar) => {
      ipcRenderer.on(CANAL_ARQUIVOS_FALHOU, (_evento, token: unknown) => {
        if (typeof token === 'string') tratar(token);
      });
    },
  },
  chat: {
    notificar: (de, texto) => ipcRenderer.send(CANAL_CHAT_NOTIFICAR, de, texto),
    aoAbrir: (tratar) => {
      ipcRenderer.on(CANAL_CHAT_ABRIR, () => tratar());
    },
  },
  bandeja: {
    atualizar: (estado) => ipcRenderer.send(CANAL_BANDEJA_ESTADO, estado),
  },
  inicioAutomatico: {
    ligado: () => ipcRenderer.invoke(CANAL_INICIO_AUTOMATICO_LER),
    definir: (ligar) => ipcRenderer.invoke(CANAL_INICIO_AUTOMATICO_DEFINIR, ligar),
    // Só o valor (boolean) chega ao renderer, nunca o evento do IPC.
    aoMudar: (tratar) => {
      ipcRenderer.on(CANAL_INICIO_AUTOMATICO_MUDOU, (_evento, ligado: unknown) => tratar(ligado === true));
    },
  },
  identidade: {
    chavePublica: () => ipcRenderer.invoke(CANAL_IDENTIDADE_CHAVE),
    assinarDesafio: (desafio) => ipcRenderer.invoke(CANAL_IDENTIDADE_ASSINAR, desafio),
  },
  senha: {
    estado: () => ipcRenderer.invoke(CANAL_SENHA_ESTADO),
    definir: (nova, atual) => ipcRenderer.invoke(CANAL_SENHA_DEFINIR, nova, atual),
    remover: (atual) => ipcRenderer.invoke(CANAL_SENHA_REMOVER, atual),
    tentar: (senha) => ipcRenderer.invoke(CANAL_SENHA_TENTAR, senha),
  },
};

contextBridge.exposeInMainWorld('api', api);
