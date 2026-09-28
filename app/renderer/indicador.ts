// Página do indicador de sessão ativa (janela flutuante do anfitrião).
// Mostra quem está controlando (vem na URL, posto pelo main) e pede o
// encerramento pelo único recurso que o preload dela expõe.
import type { ApiIndicador } from '../preload/api-indicador';
import { ehIdValido, formatarId } from './id';
import { elemento } from './telas/util';

const api = (window as unknown as { indicador: ApiIndicador }).indicador;
const parceiro = new URLSearchParams(location.search).get('parceiro') ?? '';
const botao = elemento<HTMLButtonElement>('#encerrar');

elemento<HTMLElement>('#parceiro').textContent = ehIdValido(parceiro) ? formatarId(parceiro) : 'Outro computador';

botao.addEventListener('click', () => {
  botao.disabled = true;
  botao.textContent = 'Encerrando…';
  api.encerrar(); // o main fecha esta janela quando a sessão acabar
});
