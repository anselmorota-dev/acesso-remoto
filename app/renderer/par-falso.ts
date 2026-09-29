// Conexão WebRTC falsa para os testes do renderer (o Node não tem
// RTCPeerConnection): registra o que o controlador pede e permite simular
// eventos. Usada pelos testes da sessão e do gerenciador de sessões.
import type { EventoInput, IdMonitor, ModoQualidade, Monitor, PerfilVideo, Sinal } from '@acesso-remoto/shared';
import { ErroCaptura } from './captura';
import type { OpcoesPar, Par } from './par';

/** Ajustes do par falso para o próximo teste (voltar ao padrão no afterEach). */
export const configuracaoParFalso = {
  /** O próximo anfitrião falso falha ao capturar a tela. */
  falharCaptura: false,
};

/** Monitores de exemplo: o notebook (principal) e um monitor à esquerda. */
export const PRINCIPAL: Monitor = { id: '111', largura: 1366, altura: 768, principal: true };
export const ESQUERDA: Monitor = { id: '222', largura: 1920, altura: 1080, principal: false };

/** Conexão falsa: registra o que o controlador pede e permite simular eventos. */
export class ParFalso implements Par {
  readonly sinaisRecebidos: Sinal[] = [];
  readonly inputsEnviados: EventoInput[] = [];
  readonly senhasEnviadas: string[] = [];
  iniciado = false;
  telaLiberada = false;
  autenticacaoConfirmada = false;
  fechado = false;
  /** O que foi pedido ao fechar: aviso pelo canal (e o motivo) ou nenhum aviso. */
  avisoAoFechar: { motivo?: string } | undefined;
  reiniciosIce = 0;
  readonly areaEnviada: string[] = [];
  readonly chatEnviado: string[] = [];
  /** Monitores: o que o anfitrião anunciou, o que o visualizador pediu e as trocas feitas. */
  readonly monitoresEnviados: Array<{ lista: Monitor[]; atual: IdMonitor }> = [];
  readonly monitoresEscolhidos: IdMonitor[] = [];
  readonly trocasMonitor: Array<IdMonitor | null> = [];
  falharTrocaMonitor = false;
  /** Qualidade: perfis aplicados, modos pedidos (visualizador) e estados anunciados (anfitrião). */
  readonly perfis: PerfilVideo[] = [];
  readonly qualidadePedida: ModoQualidade[] = [];
  readonly estadosQualidade: Array<[ModoQualidade, PerfilVideo]> = [];
  constructor(readonly opcoes: OpcoesPar) {}
  definirPerfil(perfil: PerfilVideo) {
    this.perfis.push(perfil);
  }
  async estatisticasVideo() {
    return null;
  }
  async medirMovimento() {
    return null;
  }
  enviarQualidade(modo: ModoQualidade) {
    this.qualidadePedida.push(modo);
  }
  enviarEstadoQualidade(modo: ModoQualidade, efetivo: PerfilVideo) {
    this.estadosQualidade.push([modo, efetivo]);
  }
  async trocarMonitor(id: IdMonitor | null) {
    if (this.falharTrocaMonitor) throw new ErroCaptura('monitor sumiu');
    this.trocasMonitor.push(id);
    return id ?? PRINCIPAL.id;
  }
  enviarMonitores(lista: Monitor[], atual: IdMonitor) {
    this.monitoresEnviados.push({ lista, atual });
  }
  escolherMonitor(id: IdMonitor) {
    this.monitoresEscolhidos.push(id);
  }
  enviarChat(texto: string) {
    this.chatEnviado.push(texto);
    return true;
  }
  enviarAreaTransferencia(texto: string) {
    if (texto.length > 1000) return false; // "grande demais" no par falso
    this.areaEnviada.push(texto);
    return true;
  }
  async iniciar() {
    this.iniciado = true;
    // Como o real: o anfitrião começa enviando a oferta.
    if (this.opcoes.papel === 'anfitriao') this.opcoes.enviarSinal({ tipo: 'oferta', sdp: 'oferta-falsa' });
  }
  async liberarTela() {
    if (configuracaoParFalso.falharCaptura) throw new ErroCaptura('sem permissão');
    this.telaLiberada = true;
    return PRINCIPAL.id; // como o real: começa pelo principal
  }
  async receberSinal(sinal: Sinal) {
    this.sinaisRecebidos.push(sinal);
    if (sinal.tipo === 'oferta') this.opcoes.enviarSinal({ tipo: 'resposta', sdp: 'resposta-falsa' });
  }
  enviarInput(evento: EventoInput) {
    this.inputsEnviados.push(evento);
  }
  enviarSenha(senha: string) {
    this.senhasEnviadas.push(senha);
  }
  confirmarAutenticacao() {
    this.autenticacaoConfirmada = true;
  }
  async reiniciarIce() {
    // Como o real: uma oferta nova, que o servidor repassa ao visualizador.
    this.reiniciosIce++;
    this.opcoes.enviarSinal({ tipo: 'oferta', sdp: `oferta-reinicio-${this.reiniciosIce}` });
  }
  fechar(aviso?: { motivo?: string }) {
    this.fechado = true;
    this.avisoAoFechar = aviso;
  }
  /** Simula a conexão direta passando a funcionar. */
  conectar() {
    this.opcoes.aoMudarEstado('conectado');
  }
}
