// Menu e dica do ícone da bandeja, montados a partir do estado do app.
// Puro (sem Electron além do tipo), para ser testado no Node.
import type { MenuItemConstructorOptions } from 'electron';

/** O que a bandeja precisa saber do app (informado pela janela principal). */
export interface EstadoBandeja {
  /** ID deste computador, ou null enquanto conecta ao servidor. */
  id: string | null;
  /** Quem está vendo e controlando este computador agora, ou null. */
  parceiro: string | null;
}

export interface AcoesBandeja {
  abrir(): void;
  copiarId(): void;
  encerrarSessao(): void;
  alternarInicioAutomatico(ligar: boolean): void;
  sair(): void;
}

/** "123456789" → "123 456 789". */
function formatar(id: string): string {
  return id.match(/\d{1,3}/g)?.join(' ') ?? id;
}

export function dicaBandeja(estado: EstadoBandeja): string {
  if (estado.parceiro) return `Acesso Remoto — sessão ativa com ${formatar(estado.parceiro)}`;
  if (estado.id) return `Acesso Remoto — ID ${formatar(estado.id)}`;
  return 'Acesso Remoto — conectando…';
}

export function itensMenu(
  estado: EstadoBandeja,
  iniciarComSistema: boolean,
  acoes: AcoesBandeja,
): MenuItemConstructorOptions[] {
  const itens: MenuItemConstructorOptions[] = [
    { label: 'Abrir Acesso Remoto', click: acoes.abrir },
    { type: 'separator' },
    // Só informativo (desabilitado): o ID para ler em voz alta ou copiar.
    { label: estado.id ? `Seu ID: ${formatar(estado.id)}` : 'Conectando ao servidor…', enabled: false },
  ];
  if (estado.id) itens.push({ label: 'Copiar ID', click: acoes.copiarId });
  if (estado.parceiro) {
    itens.push({ type: 'separator' }, { label: `Encerrar sessão com ${formatar(estado.parceiro)}`, click: acoes.encerrarSessao });
  }
  itens.push(
    { type: 'separator' },
    {
      label: 'Iniciar junto com o computador',
      type: 'checkbox',
      checked: iniciarComSistema,
      click: (item) => acoes.alternarInicioAutomatico(item.checked),
    },
    { type: 'separator' },
    { label: 'Sair', click: acoes.sair },
  );
  return itens;
}
