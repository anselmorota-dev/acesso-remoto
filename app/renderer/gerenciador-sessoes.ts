// Várias sessões ao mesmo tempo: o visualizador acessa até MAXIMO_SESSOES
// computadores (escolha do usuário: 4). Cada sessão continua sendo um
// ControladorSessao, que cuida de UMA sessão; este gerenciador cria um por
// computador, entrega a cada um as mensagens do servidor pelo "parceiro" e o
// tira da lista quando a sessão acaba.
//
// Regras (as mesmas do servidor, conferidas aqui para responder na hora):
// quem está sendo acessado não acessa outros; quem acessa outros não é
// acessado (o servidor responde "ocupado"); no máximo MAXIMO_SESSOES.
import { MAXIMO_SESSOES, type IdCliente } from '@acesso-remoto/shared';
import { ControladorSessao, type EstadoSessao, type OpcoesControlador } from './sessao';
import type { MensagemRecebida } from './sinalizacao';

export interface OpcoesGerenciador {
  /** Opções do controlador da sessão com "parceiro" (o aoMudarEstado é do gerenciador). */
  opcoesDaSessao: (parceiro: IdCliente) => Omit<OpcoesControlador, 'aoMudarEstado'>;
  /**
   * O estado de uma sessão mudou. "livre" = acabou (com o aviso do motivo, se
   * houver); logo depois ela sai da lista.
   */
  aoMudar: (parceiro: IdCliente, estado: EstadoSessao) => void;
}

/** Por que não dá para acessar mais um computador agora. */
export type MotivoNaoConecta = 'hospedando' | 'limite' | 'ja_aberta';

export class GerenciadorSessoes {
  private readonly opcoes: OpcoesGerenciador;
  private readonly sessoes = new Map<IdCliente, ControladorSessao>();

  constructor(opcoes: OpcoesGerenciador) {
    this.opcoes = opcoes;
  }

  /** As sessões abertas (pedidos e sessões), na ordem em que foram abertas. */
  lista(): Array<{ parceiro: IdCliente; controlador: ControladorSessao }> {
    return [...this.sessoes].map(([parceiro, controlador]) => ({ parceiro, controlador }));
  }

  obter(parceiro: IdCliente): ControladorSessao | undefined {
    return this.sessoes.get(parceiro);
  }

  get quantidade(): number {
    return this.sessoes.size;
  }

  /** Este computador está sendo acessado (ou tem um pedido para responder)? */
  hospedando(): boolean {
    for (const controlador of this.sessoes.values()) {
      const estado = controlador.estado;
      if (estado.fase === 'pedido_recebido' || (estado.fase === 'em_sessao' && estado.papel === 'anfitriao')) return true;
    }
    return false;
  }

  /** null se dá para acessar "destino" agora; senão, o motivo. */
  motivoParaNaoConectar(destino: IdCliente): MotivoNaoConecta | null {
    if (this.hospedando()) return 'hospedando';
    if (this.sessoes.has(destino)) return 'ja_aberta';
    if (this.sessoes.size >= MAXIMO_SESSOES) return 'limite';
    return null;
  }

  /** Acessa mais um computador (com senha: sem aceite). */
  conectar(destino: IdCliente, senha?: string): MotivoNaoConecta | null {
    const motivo = this.motivoParaNaoConectar(destino);
    if (motivo) return motivo;
    this.criar(destino).conectar(destino, senha);
    return null;
  }

  /** Mensagem do servidor: vai para a sessão do parceiro dela. */
  receber(mensagem: MensagemRecebida): void {
    switch (mensagem.tipo) {
      case 'pedido_conexao':
        // Alguém quer acessar este computador: uma sessão nova (o servidor só
        // manda pedido para quem está totalmente livre).
        (this.sessoes.get(mensagem.origem) ?? this.criar(mensagem.origem)).receber(mensagem);
        return;
      case 'pedido_cancelado':
        this.sessoes.get(mensagem.origem)?.receber(mensagem);
        return;
      case 'pedido_recusado':
        this.sessoes.get(mensagem.destino)?.receber(mensagem);
        return;
      case 'sessao_iniciada':
      case 'sinal':
      case 'parceiro_ausente':
      case 'sessao_retomada':
      case 'sessao_encerrada':
        this.sessoes.get(mensagem.parceiro)?.receber(mensagem);
        return;
      case 'erro':
        // Erros sobre um pedido ou sessão dizem com quem; os outros (registro,
        // conexão substituída) são tratados pela sinalização.
        if (mensagem.parceiro) this.sessoes.get(mensagem.parceiro)?.receber(mensagem);
        return;
    }
  }

  /** A conexão com o servidor caiu: pedidos acabam; sessões já conectadas continuam. */
  servidorPerdido(): void {
    for (const controlador of [...this.sessoes.values()]) controlador.servidorPerdido();
  }

  /** De volta ao servidor: cada sessão que continua se declara. */
  servidorVoltou(): void {
    for (const controlador of [...this.sessoes.values()]) controlador.servidorVoltou();
  }

  /** Encerra todas (ex.: pedido do indicador ou do menu da bandeja). */
  encerrarTodas(): void {
    for (const controlador of [...this.sessoes.values()]) controlador.encerrar();
  }

  private criar(parceiro: IdCliente): ControladorSessao {
    const controlador: ControladorSessao = new ControladorSessao({
      ...this.opcoes.opcoesDaSessao(parceiro),
      aoMudarEstado: (estado) => {
        // Um controlador que já saiu da lista (sessão antiga) não fala mais nada.
        if (this.sessoes.get(parceiro) !== controlador) return;
        if (estado.fase === 'livre') this.sessoes.delete(parceiro);
        this.opcoes.aoMudar(parceiro, estado);
      },
    });
    this.sessoes.set(parceiro, controlador);
    return controlador;
  }
}
