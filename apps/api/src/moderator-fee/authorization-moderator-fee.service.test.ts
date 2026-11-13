import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { Scope } from '../common/request-scope';

import { AuthorizationModeratorFeeService } from './authorization-moderator-fee.service';

const authorizationId = '30000000-0000-4000-8000-000000000001';

const scope = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  organizationCode: 'MEDICARTE',
  userId: '40000000-0000-4000-8000-000000000001',
  correlationId: '50000000-0000-4000-8000-000000000001',
  pointAccessKind: 'explicit',
} as Scope;

const mtdScope = {
  ...scope,
  organizationCode: 'MTD',
} as Scope;

const idempotencyKey = '60000000-0000-4000-8000-000000000001';

const payment = {
  status: 'COLLECTED' as const,
  collectedAt: '2026-10-16T10:00:00-05:00',
  expectedVersion: 0,
  idempotencyKey,
};

function fixture(
  authorized = true,
  initialExpectedAmountCop: string | null = '12500',
  fulfillmentEffectiveDate: string | null = '2026-10-15',
  options: {
    activeReservation?: boolean;
    authorizationItemCount?: number;
    annulledAt?: string | null;
    sheetFailure?: boolean;
  } = {},
) {
  let expectedAmountCop = initialExpectedAmountCop;
  let sheetFailure = options.sheetFailure ?? false;
  const syncStatuses = new Map<string, string>();

  const events: Array<Record<string, unknown>> = [];
  const sqlStatements: string[] = [];
  const release = vi.fn();
  const appendRow = vi.fn(() => sheetFailure
    ? Promise.reject(new Error('Sheets no disponible')) : Promise.resolve());

  const query = vi.fn((statement: string, params?: unknown[]) => {
    const normalized = statement.replace(/\s+/g, ' ').trim().toLowerCase();

    sqlStatements.push(normalized);

    if (['begin', 'commit', 'rollback'].includes(normalized)) {
      return Promise.resolve({ rows: [] });
    }

    if (normalized.includes('from authorization_items i')) {
      return Promise.resolve({
        rows: authorized
          ? [
              {
                id: authorizationId,
                numero_autorizacion: 'TEST-AUTH-001',
                codigo_medicamento: 'MED001',
                product_description: 'Medicamento test',
                patient_document: '123456789',
                patient_name: 'Paciente Test',
                expected_amount_cop: expectedAmountCop,
                fulfillment_effective_date: fulfillmentEffectiveDate,
                authorization_item_count: String(options.authorizationItemCount ?? 1),
                has_confirmed_fulfillment: fulfillmentEffectiveDate !== null,
                has_active_reservation: options.activeReservation ?? false,
                annulled_at: options.annulledAt ?? null,
              },
            ]
          : [],
      });
    }

    if (normalized.includes('from authorization_moderator_fee_events')) {
      return Promise.resolve({
        rows: [...events].reverse().map(event => ({ ...event,
          sync_status: syncStatuses.get(String(event.id)) ?? null })),
      });
    }

    if (normalized.includes('insert into authorization_moderator_fee_events')) {
      events.push({
        id: `70000000-0000-4000-8000-${String(events.length + 1).padStart(12, '0')}`,
        version: params?.[1],
        status: params?.[2],
        amount_cop: params?.[3],
        collected_at: params?.[4],
        observation: params?.[5],
        reference: params?.[6],
        registered_by: params?.[7],
        idempotency_key: params?.[10],
        related_event_id: params?.[12],
        effective_at: params?.[13],
        reason: params?.[14],
        manual_amount: params?.[15],
        source_amount_cop: params?.[16],
        difference_cop: params?.[17],
        created_at: new Date('2026-10-17T10:00:00Z'),
      });

      return Promise.resolve({
        rows: [{ id: events.at(-1)?.id }],
      });
    }

    if (normalized.includes('insert into audit_events')) {
      return Promise.resolve({ rows: [] });
    }
    if (normalized.includes('moderator_fee_sheet_sync')) {
      const eventId = String(params?.[0]);
      if (normalized.startsWith('insert')) syncStatuses.set(eventId, String(params?.[1]));
      if (normalized.startsWith('update')) syncStatuses.set(eventId,
        normalized.includes("status = 'failed'") ? 'FAILED' : String(params?.[1]));
      return Promise.resolve({ rows: normalized.startsWith('select')
        ? [{ status: syncStatuses.get(eventId) ?? 'PENDING' }] : [] });
    }

    if (normalized === 'select id from users where id = $1::uuid for share') {
      const actorExists = params?.[0] === scope.userId;

      return {
        rows: actorExists ? [{ id: scope.userId }] : [],
        rowCount: actorExists ? 1 : 0,
      };
    }

    throw new Error(`UNEXPECTED_SQL: ${normalized}`);
  });

  const database = {
    pool: {
      query,
      connect: vi.fn(() =>
        Promise.resolve({
          query,
          release,
        }),
      ),
    },
  };

  return {
    service: new AuthorizationModeratorFeeService(
      database as never,
      // Config mock: sin Sheet configurado para que no intente conectarse
      {
        GOOGLE_SHEETS_MODERATOR_FEE_ID: '',
        GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE: '',
      } as never,
      // SheetService mock: no-op
      {
        appendRow,
        getInvoiceUrl: vi.fn(() => Promise.resolve('https://drive.google.com/test-invoice.pdf')),
      } as never,
    ),
    events,
    sqlStatements,
    query,
    release,
    appendRow,
    setExpectedAmountCop(value: string | null) {
      expectedAmountCop = value;
    },
    setSheetFailure(value: boolean) { sheetFailure = value; },
  };
}

describe('Recaudo de cuota moderadora', () => {
  it('consulta estado SIN REGISTRO sin inventar pagos', async () => {
    const environment = fixture();

    const response = await environment.service.detail(authorizationId, scope);

    expect(response.status).toBe('NOT_RECORDED');
    expect(response.version).toBe(0);
    expect(response.amountCop).toBeNull();
    expect(response.expectedAmountCop).toBe('12500');

    const statement = environment.sqlStatements[0]!;

    expect(statement).toContain('user_point_scopes');
    expect(statement).toContain('patient_schedules');
    expect(statement).toContain('patient_default_dispensing_points');
    expect(statement).toContain('purchase_order_authorization_sources');
    expect(statement).toContain('product_delivery_point_mappings');
    expect(statement).toContain('authorization_fulfillments');
    expect(statement).toContain('order by f.confirmed_at desc');
    expect(statement).not.toContain('fecha_dispensacion');
    expect(statement).not.toContain('fecha_programada');
  });

  it('envía a la hoja la fecha financiera, independiente del fulfillment', async () => {
    const environment = fixture(true, '12500', '2026-10-15');

    await environment.service.register(authorizationId, payment, mtdScope);

    expect(environment.appendRow).toHaveBeenCalledWith(
      expect.objectContaining({ effectiveDate: '2026-10-16T15:00:00.000Z' }),
    );
  });

  it('conserva fecha financiera cuando no existe atención confirmada', async () => {
    const environment = fixture(true, '12500', null, {
      activeReservation: true,
    });

    await environment.service.register(authorizationId, payment, mtdScope);

    expect(environment.appendRow).toHaveBeenCalledWith(
      expect.objectContaining({ effectiveDate: '2026-10-16T15:00:00.000Z' }),
    );
  });

  it('no expone autorizaciones fuera del alcance', async () => {
    const environment = fixture(false);

    await expect(environment.service.detail(authorizationId, scope)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('impide que MEDICARTE registre un recaudo', async () => {
    const environment = fixture();

    await expect(
      environment.service.register(authorizationId, payment, scope),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('registra el recaudo y su auditoría transaccional', async () => {
    const environment = fixture();

    const response = await environment.service.register(authorizationId, payment, mtdScope);

    expect(response.status).toBe('COLLECTED');
    expect(response.amountCop).toBe('12500.00');
    expect(response.version).toBe(1);
    expect(response.history).toHaveLength(1);

    expect(environment.sqlStatements).toContain('commit');

    const lockedAuthorization = environment.sqlStatements.find((value) =>
      value.includes('from authorization_items i'),
    )!;

    expect(lockedAuthorization).toContain('for update of i');
    expect(lockedAuthorization).toContain('authorization_item_count');
    expect(lockedAuthorization).toContain('has_confirmed_fulfillment');
    expect(lockedAuthorization).toContain('has_active_reservation');
    expect(lockedAuthorization).toContain(
      "active_reservation.status in ('allocated', 'partially_consumed')",
    );
    expect(lockedAuthorization).toContain(
      'active_reservation.allocated_quantity - active_reservation.consumed_quantity - active_reservation.released_quantity',
    );

    expect(
      environment.sqlStatements.some((value) => value.includes('insert into audit_events')),
    ).toBe(true);

    expect(environment.release).toHaveBeenCalledTimes(2);
  });

  it('permite recaudar sin atención confirmada ni reserva activa', async () => {
    const environment = fixture(true, '12500', null);

    expect((await environment.service.register(authorizationId, payment, mtdScope)).status).toBe('COLLECTED');
    expect(environment.events).toHaveLength(1);
  });

  it('permite recaudar antes de la atención con reserva activa', async () => {
    const environment = fixture(true, '12500', null, {
      activeReservation: true,
    });

    const response = await environment.service.register(authorizationId, payment, mtdScope);

    expect(response.status).toBe('COLLECTED');
    expect(response.amountCop).toBe('12500.00');
  });

  it('bloquea números de autorización históricos con múltiples productos', async () => {
    const environment = fixture(true, '12500', '2026-10-15', {
      authorizationItemCount: 2,
    });

    await expect(
      environment.service.register(authorizationId, payment, mtdScope),
    ).rejects.toMatchObject({
      response: {
        code: 'MODERATOR_FEE_AUTHORIZATION_IDENTITY_AMBIGUOUS',
      },
    });

    expect(environment.events).toHaveLength(0);
  });

  it('permite registrar dinero recibido sobre autorización anulada', async () => {
    const environment = fixture(true, '12500', '2026-10-15', {
      annulledAt: '2026-10-14T10:00:00Z',
    });

    expect((await environment.service.register(authorizationId, payment, mtdScope)).status).toBe('COLLECTED');
    expect(environment.events).toHaveLength(1);
  });

  it('no duplica un reintento con la misma clave', async () => {
    const environment = fixture();

    await environment.service.register(authorizationId, payment, mtdScope);

    const repeated = await environment.service.register(authorizationId, payment, mtdScope);

    expect(repeated.version).toBe(1);
    expect(environment.events).toHaveLength(1);

    expect(
      environment.sqlStatements.filter((value) =>
        value.includes('insert into authorization_moderator_fee_events'),
      ),
    ).toHaveLength(1);
  });

  it('rechaza reutilizar la clave con otro contenido', async () => {
    const environment = fixture();

    await environment.service.register(authorizationId, payment, mtdScope);

    await expect(
      environment.service.register(
        authorizationId,
        { ...payment, observation: 'Contenido diferente' },
        mtdScope,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(environment.events).toHaveLength(1);
  });

  it('rechaza la actualización con versión desactualizada', async () => {
    const environment = fixture();

    await environment.service.register(authorizationId, payment, mtdScope);

    await expect(
      environment.service.register(
        authorizationId,
        {
          status: 'NOT_COLLECTED',
          expectedVersion: 0,
          idempotencyKey: '60000000-0000-4000-8000-000000000002',
        },
        mtdScope,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(environment.events).toHaveLength(1);
  });

  it('rechaza fechas de recaudo futuras', async () => {
    const environment = fixture();

    await expect(
      environment.service.register(
        authorizationId,
        {
          ...payment,
          collectedAt: '2099-01-01T10:00:00-05:00',
        },
        mtdScope,
      ),
    ).rejects.toThrow();

    expect(environment.events).toHaveLength(0);
  });

  it('acepta un importe explícito únicamente si coincide con la autorización', async () => {
    const environment = fixture();

    const response = await environment.service.register(
      authorizationId,
      { ...payment, amountCop: '12500.00' },
      mtdScope,
    );

    expect(response.amountCop).toBe('12500.00');
    expect(environment.events).toHaveLength(1);
  });

  it('rechaza un importe manipulado por el cliente', async () => {
    const environment = fixture();

    await expect(
      environment.service.register(authorizationId, { ...payment, amountCop: '13000' }, mtdScope),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(environment.events).toHaveLength(0);
    expect(
      environment.sqlStatements.some((statement) => statement.includes('insert into audit_events')),
    ).toBe(false);
  });

  it.each([null, '0', '0.00', '12500.123'])(
    'rechaza el registro de pago si la cuota esperada es %s',
    async (expectedAmountCop) => {
      const environment = fixture(true, expectedAmountCop);

      await expect(
        environment.service.register(authorizationId, payment, mtdScope),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(environment.events).toHaveLength(0);
    },
  );

  it('permite registrar que no se recibió el pago sin importe esperado', async () => {
    const environment = fixture(true, null);

    const response = await environment.service.register(
      authorizationId,
      {
        status: 'NOT_COLLECTED',
        expectedVersion: 0,
        idempotencyKey,
        observation: 'Paciente no realizó el pago',
      },
      mtdScope,
    );

    expect(response.status).toBe('NOT_COLLECTED');
    expect(response.amountCop).toBeNull();
    expect(response.version).toBe(1);
    expect(environment.events).toHaveLength(1);
  });

  it('permite a MTD consultar el recaudo sin ampliar el acceso de MEDICARTE', async () => {
    const environment = fixture();

    const response = await environment.service.detail(authorizationId, mtdScope);

    expect(response.status).toBe('NOT_RECORDED');
    expect(response.expectedAmountCop).toBe('12500');
  });

  it.each([
    {
      scenario: 'la cuota aumenta',
      newAmount: '25000',
      explicitAmount: false,
    },
    {
      scenario: 'la cuota deja de estar definida',
      newAmount: null,
      explicitAmount: false,
    },
    {
      scenario: 'el cliente reenvía el importe original',
      newAmount: '25000',
      explicitAmount: true,
    },
  ])(
    'conserva un reintento idempotente cuando $scenario',
    async ({ newAmount, explicitAmount }) => {
      const environment = fixture();

      const request = explicitAmount ? { ...payment, amountCop: '12500' } : payment;

      const first = await environment.service.register(authorizationId, request, mtdScope);

      expect(first.amountCop).toBe('12500.00');
      expect(first.version).toBe(1);

      environment.setExpectedAmountCop(newAmount);

      const repeated = await environment.service.register(authorizationId, request, mtdScope);

      expect(repeated.version).toBe(1);
      expect(repeated.amountCop).toBe('12500.00');
      expect(repeated.expectedAmountCop).toBe(newAmount);

      expect(environment.events).toHaveLength(1);

      expect(
        environment.sqlStatements.filter((statement) =>
          statement.includes('insert into authorization_moderator_fee_events'),
        ),
      ).toHaveLength(1);
    },
  );

  it('rechaza reutilizar una clave con un importe distinto tras cambiar la cuota', async () => {
    const environment = fixture();

    await environment.service.register(authorizationId, payment, mtdScope);

    environment.setExpectedAmountCop('25000');

    await expect(
      environment.service.register(authorizationId, { ...payment, amountCop: '25000' }, mtdScope),
    ).rejects.toMatchObject({
      response: {
        code: 'MODERATOR_FEE_IDEMPOTENCY_CONFLICT',
      },
    });

    expect(environment.events).toHaveLength(1);
  });

  it('impide un segundo recaudo aunque cambie el valor de la cuota', async () => {
    const environment = fixture();

    await environment.service.register(authorizationId, payment, mtdScope);

    environment.setExpectedAmountCop('25000');

    await expect(
      environment.service.register(
        authorizationId,
        {
          ...payment,
          expectedVersion: 1,
          idempotencyKey: '60000000-0000-4000-8000-000000000003',
        },
        mtdScope,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'MODERATOR_FEE_ALREADY_COLLECTED',
      },
    });

    expect(environment.events).toHaveLength(1);
  });

  it('impide un segundo recaudo aun con el mismo importe', async () => {
    const environment = fixture();

    await environment.service.register(authorizationId, payment, mtdScope);

    await expect(
      environment.service.register(
        authorizationId,
        {
          ...payment,
          expectedVersion: 1,
          idempotencyKey: '60000000-0000-4000-8000-000000000004',
        },
        mtdScope,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'MODERATOR_FEE_ALREADY_COLLECTED',
      },
    });

    expect(environment.events).toHaveLength(1);
  });

  it('NOT_COLLECTED no puede ocultar un recaudo activo', async () => {
    const environment = fixture();

    await environment.service.register(authorizationId, payment, mtdScope);

    await expect(environment.service.register(
      authorizationId,
      {
        status: 'NOT_COLLECTED',
        expectedVersion: 1,
        idempotencyKey: '60000000-0000-4000-8000-000000000005',
        observation: 'Corrección conservando historial',
      },
      mtdScope,
    )).rejects.toMatchObject({ response: { code: 'MODERATOR_FEE_ACTIVE_COLLECTION' } });
    expect(environment.events).toHaveLength(1);
  });

  it('obtiene la URL de la factura desde el servicio de Sheets', async () => {
    const environment = fixture();

    const result = await environment.service.getInvoiceUrl(authorizationId, scope);

    expect(result).toEqual({
      invoiceUrl: 'https://drive.google.com/test-invoice.pdf',
    });
  });

  it.each(['REFUNDED', 'INVALIDATED'] as const)(
    '%s cierra el recaudo y permite otro legítimo', async status => {
      const environment = fixture(true, '12500', null);
      const first = await environment.service.register(authorizationId, payment, mtdScope);
      const relatedEventId = first.history[0]!.id;
      const reversal = status === 'REFUNDED'
        ? { status, amountCop: '12500.00', effectiveAt: '2026-10-18T10:00:00-05:00',
            reason: 'Devolución efectiva', relatedEventId }
        : { status, reason: 'Registro original erróneo', relatedEventId,
            confirmError: true as const };
      const after = await environment.service.register(authorizationId,
        { ...reversal, expectedVersion: 1,
          idempotencyKey: '60000000-0000-4000-8000-000000000007' }, mtdScope);
      expect(after.status).toBe(status);
      expect(after.netCollectedCop).toBe('0.00');
      expect(after.totalRefundedCop).toBe(status === 'REFUNDED' ? '12500.00' : '0.00');
      expect(after.history).toHaveLength(2);
      await expect(environment.service.register(authorizationId,
        { ...reversal, expectedVersion: 2,
          idempotencyKey: '60000000-0000-4000-8000-000000000008' }, mtdScope))
        .rejects.toMatchObject({ response: { code: 'MODERATOR_FEE_NO_ACTIVE_COLLECTION' } });
      const next = await environment.service.register(authorizationId,
        { ...payment, expectedVersion: 2,
          idempotencyKey: '60000000-0000-4000-8000-000000000009' }, mtdScope);
      expect(next.status).toBe('COLLECTED');
      expect(next.netCollectedCop).toBe('12500.00');
    },
  );

  it('exige importe manual y observación cuando la fuente es inválida', async () => {
    const environment = fixture(true, null, null);
    const result = await environment.service.register(authorizationId, {
      ...payment, amountCop: '8500.00', manualAmount: true,
      observation: 'Importe efectivamente recibido según comprobante',
    }, mtdScope);
    expect(result.amountCop).toBe('8500.00');
    expect(result.history[0]?.manualAmount).toBe(true);
    expect(result.history[0]?.sourceAmountCop).toBeNull();
  });

  it('rechaza devolución parcial y referencia a otro recaudo', async () => {
    const environment = fixture();
    const first = await environment.service.register(authorizationId, payment, mtdScope);
    await expect(environment.service.register(authorizationId, {
      status: 'REFUNDED', amountCop: '1000', effectiveAt: '2026-10-18T10:00:00-05:00',
      reason: 'Devolución', relatedEventId: first.history[0]!.id,
      expectedVersion: 1, idempotencyKey: '60000000-0000-4000-8000-000000000010',
    }, mtdScope)).rejects.toMatchObject({
      response: { code: 'MODERATOR_FEE_PARTIAL_REFUND_UNSUPPORTED' },
    });
  });

  it('conserva pago si Sheets falla y permite reintento sin duplicar evento', async () => {
    const environment = fixture(true, '12500', null, { sheetFailure: true });
    const paid = await environment.service.register(authorizationId, payment, mtdScope);
    expect(paid.status).toBe('COLLECTED');
    expect(environment.events).toHaveLength(1);
    expect((await environment.service.detail(authorizationId, mtdScope)).history[0]?.syncStatus)
      .toBe('FAILED');
    environment.setSheetFailure(false);
    const retried = await environment.service.retrySheetSync(
      authorizationId, paid.history[0]!.id, mtdScope);
    expect(retried.history[0]?.syncStatus).toBe('SYNCED');
    expect(environment.events).toHaveLength(1);
  });

  it('conserva NOT_COLLECTED histórico sin interpretarlo como devolución', async () => {
    const environment = fixture();
    environment.events.push({
      id: '70000000-0000-4000-8000-000000000001', version: 1,
      status: 'COLLECTED', amount_cop: '12500.00',
      collected_at: '2026-10-16T15:00:00.000Z',
      observation: null, reference: null, registered_by: mtdScope.userId,
      idempotency_key: idempotencyKey, created_at: '2026-10-17T10:00:00.000Z',
    });
    environment.events.push({
      id: '70000000-0000-4000-8000-000000000002', version: 2,
      status: 'NOT_COLLECTED', amount_cop: null, collected_at: null,
      observation: 'Nota histórica', reference: null, registered_by: mtdScope.userId,
      idempotency_key: '60000000-0000-4000-8000-000000000011',
      created_at: '2026-10-18T10:00:00.000Z',
    });
    const detail = await environment.service.detail(authorizationId, mtdScope);
    expect(detail.status).toBe('COLLECTED');
    expect(detail.netCollectedCop).toBe('12500.00');
    expect(detail.totalRefundedCop).toBe('0.00');
    expect(detail.history.map(event => event.status)).toEqual(['NOT_COLLECTED', 'COLLECTED']);
  });

  it('rechaza invalidar o devolver sin recaudo anterior', async () => {
    const environment = fixture();
    for (const request of [
      { status: 'INVALIDATED' as const, reason: 'Error de registro',
        confirmError: true as const },
      { status: 'REFUNDED' as const, reason: 'Devolución', amountCop: '12500',
        effectiveAt: '2026-10-18T10:00:00-05:00' },
    ]) {
      await expect(environment.service.register(authorizationId, {
        ...request, relatedEventId: '70000000-0000-4000-8000-000000000001',
        expectedVersion: 0, idempotencyKey: randomUUID(),
      }, mtdScope)).rejects.toMatchObject({
        response: { code: 'MODERATOR_FEE_NO_ACTIVE_COLLECTION' },
      });
    }
    expect(environment.events).toHaveLength(0);
  });
});
