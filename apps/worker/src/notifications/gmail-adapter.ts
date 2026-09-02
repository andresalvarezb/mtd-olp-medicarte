import { createSign } from 'node:crypto';
import {
  GmailSendError,
  type GmailPort,
  type GmailSendInput,
  type GmailSendResult,
} from '@authorization/domain';
import type { WorkerConfig } from '@authorization/config';

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users';

/**
 * ADR-006: envío por Gmail API desde el worker. Las credenciales son secretos
 * de infraestructura (service account con delegación de dominio) y nunca se
 * registran en logs. Un fallo de red o HTTP produce GmailSendError retryable.
 */
export class GmailApiAdapter implements GmailPort {
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(private readonly config: WorkerConfig) {}

  async send(input: GmailSendInput): Promise<GmailSendResult> {
    const sender = this.config.GMAIL_SENDER;
    if (!sender) throw new GmailSendError('GMAIL_SENDER is not configured', false);
    const accessToken = await this.getAccessToken();
    const message = [
      `To: ${input.to.join(', ')}`,
      ...(input.from ? [`From: ${input.from}`] : []),
      'Content-Type: text/plain; charset="UTF-8"',
      'MIME-Version: 1.0',
      `Subject: =?UTF-8?B?${Buffer.from(input.subject, 'utf8').toString('base64')}?=`,
      '',
      input.body,
    ].join('\r\n');
    const raw = Buffer.from(message, 'utf8').toString('base64url');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.GMAIL_TIMEOUT_MS);
    try {
      const response = await fetch(
        `${GMAIL_SEND_ENDPOINT}/${encodeURIComponent(sender)}/messages/send`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ raw }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new GmailSendError(
          `Gmail send failed with HTTP ${response.status}: ${detail.slice(0, 200)}`,
        );
      }
      const payload = (await response.json()) as { id?: string };
      if (!payload.id) throw new GmailSendError('Gmail send response has no message id');
      return { messageId: payload.id };
    } catch (error) {
      if (error instanceof GmailSendError) throw error;
      throw new GmailSendError(error instanceof Error ? error.message : 'Gmail send failed');
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60_000) {
      return this.cachedToken.token;
    }
    const serviceAccountEmail = this.config.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = this.config.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!serviceAccountEmail || !privateKey) {
      throw new GmailSendError('Gmail service account is not configured', false);
    }
    const issuedAt = Math.floor(now / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const claims = Buffer.from(
      JSON.stringify({
        iss: serviceAccountEmail,
        scope: GMAIL_SCOPE,
        aud: TOKEN_ENDPOINT,
        sub: this.config.GMAIL_SENDER,
        iat: issuedAt,
        exp: issuedAt + 3600,
      }),
    ).toString('base64url');
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    const signature = signer.sign(privateKey).toString('base64url');
    const assertion = `${header}.${claims}.${signature}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.GMAIL_TIMEOUT_MS);
    try {
      const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new GmailSendError(
          `Gmail token request failed with HTTP ${response.status}: ${detail.slice(0, 200)}`,
        );
      }
      const payload = (await response.json()) as { access_token?: string; expires_in?: number };
      if (!payload.access_token)
        throw new GmailSendError('Gmail token response has no access token');
      this.cachedToken = {
        token: payload.access_token,
        expiresAt: now + (payload.expires_in ?? 3600) * 1000,
      };
      return payload.access_token;
    } catch (error) {
      if (error instanceof GmailSendError) throw error;
      throw new GmailSendError(
        error instanceof Error ? error.message : 'Gmail token request failed',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Adaptador de desarrollo/pruebas: entrega local sin llamadas externas.
 * Devuelve un identificador determinista para trazabilidad.
 */
export class GmailFakeAdapter implements GmailPort {
  constructor(private readonly onSend?: (input: GmailSendInput) => void) {}

  send(input: GmailSendInput): Promise<GmailSendResult> {
    this.onSend?.(input);
    return Promise.resolve({ messageId: `fake-${crypto.randomUUID()}` });
  }
}
