'use client';

import { useEffect, useRef, useState } from 'react';

import { ApiError } from '@/lib/api-client';
import {
  getAuthorizationModeratorFee,
  registerAuthorizationModeratorFee,
  type ModeratorFeeResponse,
  type RegisterModeratorFeeRequest,
} from '@/lib/authorization-moderator-fee-api';
import {
  bogotaToday,
  moderatorFeeBalances,
  moderatorFeeCollectionDateIso,
  moderatorFeeDate,
  moderatorFeeMoney,
  normalizeModeratorFeeAmount,
} from '@/lib/moderator-fee-presentation';

type EntryStatus = '' | 'COLLECTED' | 'NOT_COLLECTED';

type Props = {
  organizationId: string;
  authorizationItemId: string;
  canManage: boolean;
  mode: 'summary' | 'manage';
};

function statusLabel(status: ModeratorFeeResponse['status']): string {
  switch (status) {
    case 'COLLECTED':
      return 'Recaudo registrado';
    case 'NOT_COLLECTED':
      return 'No recaudado';
    default:
      return 'Sin registro de recaudo';
  }
}

function latestObservation(detail: ModeratorFeeResponse): string {
  const latest = detail.history.reduce<
    (typeof detail.history)[number] | null
  >(
    (current, event) =>
      current === null || event.version > current.version ? event : current,
    null,
  );

  return latest?.observation?.trim() || '—';
}

function FinancialAmounts({ detail }: { detail: ModeratorFeeResponse }) {
  const balances = moderatorFeeBalances(detail);

  return (
    <>
      <div>
        <span>Valor cuota moderadora</span>
        <strong>{moderatorFeeMoney(balances.expected)}</strong>
      </div>
      <div>
        <span>Total recaudado</span>
        <strong>{moderatorFeeMoney(balances.collected)}</strong>
      </div>
    </>
  );
}

export function AuthorizationModeratorFeePanel({
  organizationId,
  authorizationItemId,
  canManage,
  mode,
}: Props) {
  const [detail, setDetail] = useState<ModeratorFeeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [status, setStatus] = useState<EntryStatus>('');
  const [amountCop, setAmountCop] = useState('');
  const [collectionDate, setCollectionDate] = useState('');
  const [observation, setObservation] = useState('');

  const attempt = useRef<{
    fingerprint: string;
    key: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    setDetail(null);
    setLoading(true);
    setError(null);
    setSuccess(null);
    setStatus('');
    setAmountCop('');
    setCollectionDate('');
    setObservation('');
    attempt.current = null;

    void getAuthorizationModeratorFee(
      organizationId,
      authorizationItemId,
    )
      .then((response) => {
        if (!cancelled) setDetail(response);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'No fue posible consultar el recaudo.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [organizationId, authorizationItemId]);

  async function reload(): Promise<void> {
    const latest = await getAuthorizationModeratorFee(
      organizationId,
      authorizationItemId,
    );

    setDetail(latest);
  }

  async function save(): Promise<void> {
    if (
      mode !== 'manage' ||
      detail?.status === 'COLLECTED' ||
      !canManage ||
      saving ||
      !detail ||
      !status
    ) {
      return;
    }

    const collectedIso = status === 'COLLECTED'
      ? moderatorFeeCollectionDateIso(collectionDate)
      : null;
    const normalizedAmount = status === 'COLLECTED'
      ? normalizeModeratorFeeAmount(amountCop)
      : null;
    const expectedAmount = detail.expectedAmountCop === null
      ? null
      : normalizeModeratorFeeAmount(detail.expectedAmountCop);

    if (status === 'COLLECTED' && !collectedIso) {
      setError('Indica una fecha de recaudo válida, no futura, en Colombia.');
      return;
    }

    if (status === 'COLLECTED' && (
      normalizedAmount === null ||
      expectedAmount === null ||
      normalizedAmount !== expectedAmount
    )) {
      setError(
        'El valor recaudado debe coincidir con el valor completo de la cuota moderadora. Este módulo no admite abonos parciales.',
      );
      return;
    }

    const normalizedObservation = observation.trim() || null;

    const fingerprint = JSON.stringify({
      authorizationItemId,
      version: detail.version,
      status,
      normalizedAmount,
      collectedIso,
      observation: normalizedObservation,
    });

    if (attempt.current?.fingerprint !== fingerprint) {
      attempt.current = {
        fingerprint,
        key: crypto.randomUUID(),
      };
    }

    const base = {
      idempotencyKey: attempt.current.key,
      expectedVersion: detail.version,
      observation: normalizedObservation,
    };

    const body: RegisterModeratorFeeRequest = status === 'COLLECTED'
      ? {
          ...base,
          status: 'COLLECTED',
          amountCop: normalizedAmount!,
          collectedAt: collectedIso!,
        }
      : {
          ...base,
          status: 'NOT_COLLECTED',
        };

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const saved = await registerAuthorizationModeratorFee(
        organizationId,
        authorizationItemId,
        body,
      );

      setDetail(saved);
      attempt.current = null;
      setStatus('');
      setAmountCop('');
      setCollectionDate('');
      setObservation('');
      setSuccess('Estado del recaudo guardado correctamente.');
    } catch (cause: unknown) {
      if (
        cause instanceof ApiError &&
        cause.code === 'MODERATOR_FEE_VERSION_CONFLICT'
      ) {
        try {
          await reload();
        } catch {
          // Se conserva el mensaje original de conflicto.
        }

        setError(
          'Otro usuario actualizó el recaudo. Verifica el estado antes de guardar.',
        );
      } else if (
        cause instanceof ApiError &&
        cause.code === 'MODERATOR_FEE_IDEMPOTENCY_CONFLICT'
      ) {
        attempt.current = null;
        setError(
          'Este intento ya fue utilizado con datos diferentes. Verifica el estado vigente.',
        );
      } else {
        setError(
          cause instanceof Error
            ? cause.message
            : 'No fue posible guardar el recaudo.',
        );
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="authorization-fulfillment-form"
      aria-label="Cuota moderadora"
      style={{ marginTop: 20, marginBottom: 20 }}
    >
      <div className="authorization-summary-section-heading">
        <strong>
          {mode === 'summary'
            ? 'Cuota moderadora'
            : 'Valor cuota moderadora y recaudo'}
        </strong>
      </div>

      {loading ? <p role="status">Cargando cuota moderadora…</p> : null}

      {detail ? (
        <>
          {/* La tarjeta financiera también pertenece a Entrega / Aplicación. */}
          <div
            className="authorization-detail-grid authorization-summary-grid moderator-fee-inline-grid"
            style={{
              gridTemplateColumns:
                'repeat(4, minmax(0, 1fr))',
            }}
          >
            <FinancialAmounts detail={detail} />
            <div>
              <span>Estado del recaudo</span>
              <strong>{statusLabel(detail.status)}</strong>
            </div>
            {detail.status === 'COLLECTED' ? (
              <div>
                <span>Fecha del último recaudo</span>
                <strong>{moderatorFeeDate(detail.collectedAt)}</strong>
              </div>
            ) : (
              <div>
                <span>Observación</span>
                <strong>{latestObservation(detail)}</strong>
              </div>
            )}

          </div>

          {mode === 'manage' ? (
            <>
              {detail.status === 'NOT_RECORDED' ? (
                <p role="status">
                  Aún no se ha registrado si se recibió la cuota moderadora.
                </p>
              ) : detail.status === 'NOT_COLLECTED' ? (
                <p role="status">
                  No se registró recaudo. La cuota permanece pendiente mientras
                  exista un valor esperado.
                </p>
              ) : (
                <p role="status">
                  Recaudo registrado. Cualquier corrección quedará en el historial.
                </p>
              )}

              {canManage && detail.status !== 'COLLECTED' ? (
                <>
                  <label className="authorization-fulfillment-date">
                    <span>Estado a registrar</span>
                    <select
                      className="control"
                      value={status}
                      disabled={saving}
                      onChange={(event) => {
                        const next = event.target.value as EntryStatus;
                        setStatus(next);
                        setAmountCop(next === 'COLLECTED'
                          ? detail.expectedAmountCop ?? ''
                          : '');
                        setCollectionDate(next === 'COLLECTED'
                          ? bogotaToday()
                          : '');
                        setError(null);
                        setSuccess(null);
                      }}
                    >
                      <option value="">Seleccionar</option>
                      <option value="COLLECTED">Pago recibido</option>
                      <option value="NOT_COLLECTED">Pago no recibido</option>
                    </select>
                  </label>

                  {status === 'COLLECTED' ? (
                    <>
                      <label className="authorization-fulfillment-date">
                        <span>Valor recaudado (COP)</span>
                        <input
                          type="number"
                          className="control"
                          min="0.01"
                          step="0.01"
                          value={amountCop}
                          disabled={saving}
                          required
                          onChange={(event) => {
                            setAmountCop(event.target.value);
                            setError(null);
                          }}
                        />
                      </label>
                      <small>
                        Debe corresponder al valor completo de la cuota:
                        {' '}{moderatorFeeMoney(moderatorFeeBalances(detail).expected)}.
                        No se permiten abonos parciales.
                      </small>

                      <label className="authorization-fulfillment-date">
                        <span>Fecha de recaudo</span>
                        <input
                          type="date"
                          className="control"
                          value={collectionDate}
                          max={bogotaToday()}
                          disabled={saving}
                          required
                          onChange={(event) => {
                            setCollectionDate(event.target.value);
                            setError(null);
                          }}
                        />
                      </label>
                    </>
                  ) : null}

                  {status ? (
                    <>
                      <label className="authorization-fulfillment-date">
                        <span>Observación (opcional)</span>
                        <textarea
                          className="control"
                          rows={3}
                          maxLength={1000}
                          value={observation}
                          disabled={saving}
                          onChange={(event) => {
                            setObservation(event.target.value);
                            setError(null);
                          }}
                        />
                      </label>
                      <div className="authorization-management-actions">
                        <button
                          type="button"
                          className="btn primary"
                          disabled={saving}
                          onClick={() => void save()}
                        >
                          {saving ? 'Guardando…' : 'Guardar estado del recaudo'}
                        </button>
                      </div>
                    </>
                  ) : null}
                </>
              ) : (
                <p role="status">
                  {detail.status === 'COLLECTED'
                    ? 'Cuota completamente recaudada. No se permiten nuevos pagos.'
                    : 'Consulta de solo lectura. El recaudo lo gestiona MTD.'}
                </p>
              )}


            </>
          ) : null}
        </>
      ) : null}

      {error ? (
        <div className="authorization-fulfillment-error" role="alert">
          {error}
        </div>
      ) : null}

      {mode === 'manage' && success ? (
        <div className="authorization-fulfillment-success" role="status">
          {success}
        </div>
      ) : null}
    </section>
  );
}
