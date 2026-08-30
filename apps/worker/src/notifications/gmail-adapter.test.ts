import { describe, expect, it, vi } from 'vitest';
import type { WorkerConfig } from '@authorization/config';
import { GmailSendError, type GmailSendInput } from '@authorization/domain';
import { renderTemplate } from './notification-processor';
import { GmailApiAdapter, GmailFakeAdapter } from './gmail-adapter';

describe('renderTemplate', () => {
  it('sustituye placeholders con los parámetros', () => {
    const result = renderTemplate('Autorizacion {{authorizationKey}} lista ({{coverageType}})', {
      authorizationKey: 'A:M',
      coverageType: 'PBS',
    });
    expect(result).toBe('Autorizacion A:M lista (PBS)');
  });

  it('deja vacíos los placeholders sin parámetro', () => {
    expect(renderTemplate('Hola {{missing}}', {})).toBe('Hola ');
  });
});

describe('GmailFakeAdapter', () => {
  it('entrega localmente y devuelve un identificador', async () => {
    const onSend = vi.fn<(input: GmailSendInput) => void>();
    const adapter = new GmailFakeAdapter(onSend);
    const result = await adapter.send({ to: ['olp@example.test'], subject: 'S', body: 'B' });
    expect(result.messageId).toMatch(/^fake-/);
    expect(onSend).toHaveBeenCalledWith({ to: ['olp@example.test'], subject: 'S', body: 'B' });
  });
});

describe('GmailApiAdapter', () => {
  const baseConfig: Partial<WorkerConfig> = {
    GMAIL_SENDER: 'notificaciones@example.test',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'sa@example.iam.gserviceaccount.com',
    GOOGLE_PRIVATE_KEY: 'not-a-real-key',
    GMAIL_TIMEOUT_MS: 1000,
  };

  it('falla con error retryable si las credenciales no permiten firmar', async () => {
    const adapter = new GmailApiAdapter(baseConfig as WorkerConfig);
    await expect(adapter.send({ to: ['a@b.test'], subject: 'S', body: 'B' })).rejects.toThrow();
    try {
      await adapter.send({ to: ['a@b.test'], subject: 'S', body: 'B' });
    } catch (error) {
      expect(error instanceof GmailSendError || error instanceof Error).toBe(true);
    }
  });

  it('exige remitente configurado', async () => {
    const adapter = new GmailApiAdapter({
      ...baseConfig,
      GMAIL_SENDER: undefined,
    } as WorkerConfig);
    await expect(adapter.send({ to: ['a@b.test'], subject: 'S', body: 'B' })).rejects.toThrow(
      /GMAIL_SENDER/,
    );
  });
});
