// Interface do app. Por enquanto só confirma que o preload (window.api)
// e o pacote shared estão acessíveis a partir do renderer.
import { PROTOCOL_VERSION } from '@acesso-remoto/shared';

const lista = document.querySelector<HTMLUListElement>('#info');

const linhas: Array<[string, string]> = [
  ['Protocolo', `v${PROTOCOL_VERSION}`],
  ['Electron', window.api.versoes.electron],
  ['Chromium', window.api.versoes.chrome],
  ['Node', window.api.versoes.node],
];

for (const [rotulo, valor] of linhas) {
  const item = document.createElement('li');
  item.textContent = `${rotulo}: ${valor}`;
  lista?.append(item);
}
