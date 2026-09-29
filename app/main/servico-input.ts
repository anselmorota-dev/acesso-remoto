// Lógica do processo de input (parte testável, sem Electron).
//
// Recebe dois tipos de mensagem:
//   - do renderer da janela principal, por um MessagePort direto (sem passar
//     pelo main): eventos a executar e o "soltar tudo" do fim da sessão;
//   - do main: a área do monitor mostrado, "os monitores mudaram" e "soltar
//     tudo" (janela fechou ou travou).
// Tudo que chega é validado de novo aqui (cada processo é uma fronteira).
import { esquemaEventoInput } from '@acesso-remoto/shared';
import { ExecutorInput, type Robo } from './executor-input';
import type { Retangulo } from './lista-monitores';

/** O robô de verdade (robotjs) também precisa saber quando a área de trabalho muda. */
export interface RoboDoProcesso extends Robo {
  /** O robotjs guarda o tamanho da área de trabalho: se um monitor entra ou sai, precisa reler. */
  atualizarTela(): void;
}

/** Mensagens do renderer (pelo MessagePort). */
export type MensagemDoRenderer = { tipo: 'executar'; evento: unknown } | { tipo: 'liberar' };

/** Comandos do main (pelo canal do processo). */
export type ComandoDoMain =
  | { tipo: 'area'; area: Retangulo }
  | { tipo: 'monitores_mudaram' }
  | { tipo: 'liberar' };

const ehObjeto = (dados: unknown): dados is Record<string, unknown> => typeof dados === 'object' && dados !== null;
const ehNumero = (valor: unknown): valor is number => typeof valor === 'number' && Number.isFinite(valor);

function ehArea(valor: unknown): valor is Retangulo {
  return (
    ehObjeto(valor) &&
    ehNumero(valor['x']) &&
    ehNumero(valor['y']) &&
    ehNumero(valor['largura']) &&
    ehNumero(valor['altura']) &&
    valor['largura'] > 0 &&
    valor['altura'] > 0
  );
}

export interface OpcoesServicoInput {
  plataforma: NodeJS.Platform;
  /** Relógio (injetável nos testes). */
  agora?: () => number;
  log?: (mensagem: string) => void;
}

export class ServicoInput {
  private readonly robo: RoboDoProcesso;
  private readonly executor: ExecutorInput;
  private readonly log: (mensagem: string) => void;
  /** Até o main informar, uma área mínima (mouse no canto): nada acontece fora do lugar. */
  private area: Retangulo = { x: 0, y: 0, largura: 1, altura: 1 };

  constructor(robo: RoboDoProcesso, opcoes: OpcoesServicoInput) {
    this.robo = robo;
    this.log = opcoes.log ?? ((mensagem) => console.warn(mensagem));
    this.executor = new ExecutorInput(robo, {
      plataforma: opcoes.plataforma,
      areaDoMonitor: () => this.area,
      agora: opcoes.agora,
    });
  }

  /** Mensagem vinda do renderer (não confiável: validada aqui). */
  doRenderer(dados: unknown): void {
    if (!ehObjeto(dados)) return;
    if (dados['tipo'] === 'liberar') {
      this.executor.liberar();
      return;
    }
    if (dados['tipo'] !== 'executar') return;
    const resultado = esquemaEventoInput.safeParse(dados['evento']);
    if (!resultado.success) {
      this.log('[input] evento inválido, ignorado');
      return;
    }
    this.executor.executar(resultado.data);
  }

  /** Comando vindo do main. */
  doMain(dados: unknown): void {
    if (!ehObjeto(dados)) return;
    switch (dados['tipo']) {
      case 'area':
        if (ehArea(dados['area'])) this.area = dados['area'];
        break;
      case 'monitores_mudaram':
        this.robo.atualizarTela();
        break;
      case 'liberar':
        this.executor.liberar();
        break;
    }
  }

  /** Solta o que estiver apertado (ex.: o canal com o renderer fechou). */
  liberar(): void {
    this.executor.liberar();
  }
}
