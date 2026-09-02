/**
 * Puerto del dominio hacia Gmail (ADR-006). La transacción de negocio nunca
 * envía correo: el worker consume el outbox y entrega a través de este
 * puerto. Un fallo de Gmail no revierte el cambio de negocio.
 */
export type GmailSendInput = Readonly<{
  from?: string;
  to: readonly string[];
  subject: string;
  body: string;
}>;

export type GmailSendResult = Readonly<{
  messageId: string;
}>;

export interface GmailPort {
  send(input: GmailSendInput): Promise<GmailSendResult>;
}

export class GmailSendError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean = true,
  ) {
    super(message);
    this.name = 'GmailSendError';
  }
}
