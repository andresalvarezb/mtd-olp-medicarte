'use client';

import { useEffect, useRef, useState } from 'react';

import { ApiError } from '@/lib/api-client';
import {
  getAuthorizationModeratorFee,
  getAuthorizationModeratorFeeInvoiceUrl,
  registerAuthorizationModeratorFee,
  retryAuthorizationModeratorFeeSync,
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

type EntryStatus = '' | 'COLLECTED' | 'NOT_COLLECTED' | 'REFUNDED' | 'INVALIDATED';

type Props = {
  organizationId: string;
  authorizationItemId: string;
  canManage: boolean;
  mode: 'summary' | 'manage';
  operationalWarning?: string | null;
};

function statusLabel(status: ModeratorFeeResponse['status']): string {
  switch (status) {
    case 'COLLECTED':
      return 'Recaudo registrado';
    case 'NOT_COLLECTED':
      return 'No recaudado';
    case 'REFUNDED':
      return 'Devuelto';
    case 'INVALIDATED':
      return 'Recaudo invalidado';
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
      <div><span>Total devuelto</span><strong>{moderatorFeeMoney(balances.refunded)}</strong></div>
      <div><span>Recaudo neto</span><strong>{moderatorFeeMoney(balances.net)}</strong></div>
    </>
  );
}

export function AuthorizationModeratorFeePanel({
  organizationId,
  authorizationItemId,
  canManage,
  mode,
  operationalWarning,
}: Props) {
  const [detail, setDetail] = useState<ModeratorFeeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [status, setStatus] = useState<EntryStatus>('');
  const [amountCop, setAmountCop] = useState('');
  const [collectionDate, setCollectionDate] = useState('');
  const [professionalDocument, setProfessionalDocument] = useState('');
  const [observation, setObservation] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [confirmError, setConfirmError] = useState(false);

  const [fetchingInvoice, setFetchingInvoice] = useState(false);
  const [invoiceMessage, setInvoiceMessage] = useState<{
    type: 'info' | 'success' | 'warning' | 'error';
    text: string;
    url?: string;
  } | null>(null);

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
    setProfessionalDocument('');
    setObservation('');
    setReason('');
    setReference('');
    setConfirmError(false);
    setFetchingInvoice(false);
    setInvoiceMessage(null);
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

  async function handleDownloadInvoice(): Promise<void> {
    setFetchingInvoice(true);
    setInvoiceMessage({
      type: 'info',
      text: 'Consultando factura generada...',
    });

    try {
      const res = await getAuthorizationModeratorFeeInvoiceUrl(
        organizationId,
        authorizationItemId,
      );

      if (res.invoiceUrl) {
        setInvoiceMessage({
          type: 'success',
          text: 'Factura encontrada. Se abrirá en una nueva pestaña.',
          url: res.invoiceUrl,
        });
        window.open(res.invoiceUrl, '_blank', 'noopener,noreferrer');
      } else {
        setInvoiceMessage({
          type: 'warning',
          text: 'La factura aún no está disponible en la hoja de cálculo. Recuerda que el proceso toma aproximadamente 1 minuto después de registrar el recaudo. Por favor, intenta de nuevo en un momento.',
        });
      }
    } catch (cause: unknown) {
      setInvoiceMessage({
        type: 'error',
        text:
          cause instanceof Error
            ? cause.message
            : 'No fue posible consultar la factura en este momento.',
      });
    } finally {
      setFetchingInvoice(false);
    }
  }

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
      !canManage ||
      saving ||
      !detail ||
      !status
    ) {
      return;
    }

    const collectedIso = status === 'COLLECTED' || status === 'REFUNDED'
      ? moderatorFeeCollectionDateIso(collectionDate)
      : null;
    const normalizedAmount = status === 'COLLECTED' || status === 'REFUNDED'
      ? normalizeModeratorFeeAmount(amountCop)
      : null;
    const expectedAmount = detail.expectedAmountCop === null
      ? null
      : normalizeModeratorFeeAmount(detail.expectedAmountCop);

    if ((status === 'COLLECTED' || status === 'REFUNDED') && !collectedIso) {
      setError('Indica una fecha efectiva válida y no futura.');
      return;
    }

    if (status === 'COLLECTED' && expectedAmount !== null && (
      normalizedAmount === null ||
      normalizedAmount !== expectedAmount
    )) {
      setError(
        'El valor recaudado debe coincidir con el valor completo de la cuota moderadora. Este módulo no admite abonos parciales.',
      );
      return;
    }
    if ((status === 'COLLECTED' || status === 'REFUNDED') && normalizedAmount === null) {
      setError('Indica un importe real mayor que cero.');
      return;
    }
    if (status === 'COLLECTED' && expectedAmount === null && !observation.trim()) {
      setError('El valor manual exige una observación.');
      return;
    }
    const active = detail.history.find(event => event.status === 'COLLECTED' &&
      !detail.history.some(reversal =>
        (reversal.status === 'REFUNDED' || reversal.status === 'INVALIDATED') &&
        reversal.relatedEventId === event.id));
    if ((status === 'REFUNDED' || status === 'INVALIDATED') && (!active || !reason.trim())) {
      setError('Indica el recaudo original y un motivo.');
      return;
    }
    if (status === 'INVALIDATED' && !confirmError) {
      setError('Confirma que el dinero nunca fue recibido.');
      return;
    }
    if ((status === 'REFUNDED' || status === 'INVALIDATED') &&
      !window.confirm(status === 'REFUNDED'
        ? '¿Confirmas que el dinero ya fue devuelto al paciente?'
        : '¿Confirmas que el recaudo original fue registrado por error y nunca se recibió dinero?')) return;

    const normalizedObservation = observation.trim() || null;
    const normalizedProfessional = professionalDocument.trim() || null;

    const fingerprint = JSON.stringify({
      authorizationItemId,
      version: detail.version,
      status,
      normalizedAmount,
      collectedIso,
      professionalDocument: normalizedProfessional,
      observation: normalizedObservation,
      reason: reason.trim(),
      reference: reference.trim(),
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
      professionalDocument: normalizedProfessional,
    };

    const body: RegisterModeratorFeeRequest = status === 'COLLECTED'
      ? {
          ...base,
          status: 'COLLECTED',
          amountCop: normalizedAmount!,
          collectedAt: collectedIso!,
          manualAmount: expectedAmount === null,
        }
      : status === 'REFUNDED'
      ? { ...base, status, amountCop: normalizedAmount!, effectiveAt: collectedIso!,
          reason: reason.trim(), relatedEventId: active!.id, reference: reference.trim() || null }
      : status === 'INVALIDATED'
      ? { ...base, status, reason: reason.trim(), relatedEventId: active!.id,
          confirmError: true, reference: reference.trim() || null }
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
      setProfessionalDocument('');
      setObservation('');
      setReason('');
      setReference('');
      setConfirmError(false);
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
      {operationalWarning ? <p role="status" style={{ color: '#92400e' }}>
        {operationalWarning} El registro de dinero real sigue disponible.
      </p> : null}

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
              <strong>
                {statusLabel(detail.status)}
              </strong>
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

          {detail.status === 'COLLECTED' ? (
            <div
              className="authorization-moderator-fee-invoice-card"
              style={{
                marginTop: 16,
                padding: '14px 18px',
                backgroundColor: 'var(--surface-subtle, #f8fafc)',
                borderRadius: 8,
                border: '1px solid var(--border-color, #e2e8f0)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div>
                  <strong style={{ fontSize: '0.95rem' }}>Factura de cuota moderadora</strong>
                  <p
                    style={{
                      margin: 0,
                      marginTop: 2,
                      fontSize: '0.82rem',
                      color: 'var(--text-muted, #64748b)',
                    }}
                  >
                    Se genera en la hoja de cálculo aproximadamente un minuto después del registro.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={fetchingInvoice}
                  onClick={() => void handleDownloadInvoice()}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    fontWeight: 500,
                  }}
                >
                  {fetchingInvoice ? '⏳ Consultando factura…' : '📄 Descargar factura'}
                </button>
              </div>

              {invoiceMessage ? (
                <div
                  role="status"
                  style={{
                    fontSize: '0.85rem',
                    padding: '10px 14px',
                    borderRadius: 6,
                    backgroundColor:
                      invoiceMessage.type === 'success'
                        ? '#ecfdf5'
                        : invoiceMessage.type === 'warning'
                        ? '#fffbeb'
                        : invoiceMessage.type === 'error'
                        ? '#fef2f2'
                        : '#f0f9ff',
                    color:
                      invoiceMessage.type === 'success'
                        ? '#065f46'
                        : invoiceMessage.type === 'warning'
                        ? '#92400e'
                        : invoiceMessage.type === 'error'
                        ? '#991b1b'
                        : '#075985',
                    border: `1px solid ${
                      invoiceMessage.type === 'success'
                        ? '#a7f3d0'
                        : invoiceMessage.type === 'warning'
                        ? '#fde68a'
                        : invoiceMessage.type === 'error'
                        ? '#fecaca'
                        : '#bae6fd'
                    }`,
                  }}
                >
                  <div>{invoiceMessage.text}</div>
                  {invoiceMessage.url ? (
                    <div style={{ marginTop: 6 }}>
                      <a
                        href={invoiceMessage.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontWeight: 600,
                          textDecoration: 'underline',
                          color: 'inherit',
                        }}
                      >
                        Abrir factura enlace directo ↗
                      </a>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {mode === 'manage' &&
          (
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
              ) : detail.status === 'REFUNDED' || detail.status === 'INVALIDATED' ? (
                <p role="status">El movimiento anterior cerró el recaudo. Puede registrarse otro pago real.</p>
              ) : (
                <p role="status">
                  Recaudo registrado. Cualquier corrección quedará en el historial.
                </p>
              )}

              {canManage ? (
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
                        setAmountCop(next === 'COLLECTED' ? detail.expectedAmountCop ?? ''
                          : next === 'REFUNDED' ? detail.history.find(event => event.status === 'COLLECTED')?.amountCop ?? ''
                          : '');
                        setCollectionDate(next === 'COLLECTED' || next === 'REFUNDED'
                          ? bogotaToday()
                          : '');
                        setError(null);
                        setSuccess(null);
                      }}
                    >
                      <option value="">Seleccionar</option>
                      {detail.status !== 'COLLECTED' ? <option value="COLLECTED">Pago recibido</option> : null}
                      {detail.status !== 'COLLECTED' ? <option value="NOT_COLLECTED">Pago no recibido</option> : null}
                      {detail.status === 'COLLECTED' ? <option value="REFUNDED">Devolución efectiva</option> : null}
                      {detail.status === 'COLLECTED' ? <option value="INVALIDATED">Invalidar error</option> : null}
                    </select>
                  </label>

                  {status === 'COLLECTED' || status === 'REFUNDED' ? (
                    <>
                      <label className="authorization-fulfillment-date">
                        <span>{status === 'REFUNDED' ? 'Valor devuelto (COP)' : 'Valor recaudado (COP)'}</span>
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
                      {status === 'COLLECTED' ? <small>
                        Debe corresponder al valor completo de la cuota:
                        {' '}{moderatorFeeMoney(moderatorFeeBalances(detail).expected)}.
                        No se permiten abonos parciales.
                      </small> : <small>La primera versión admite solo devolución total.</small>}

                      <label className="authorization-fulfillment-date">
                        <span>{status === 'REFUNDED' ? 'Fecha efectiva de devolución' : 'Fecha de recaudo'}</span>
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

                      {status === 'COLLECTED' ? <label className="authorization-fulfillment-date">
                        <span>Cédula del profesional</span>
                        <input
                          type="text"
                          className="control"
                          placeholder="Número de cédula del profesional"
                          value={professionalDocument}
                          disabled={saving}
                          onChange={(event) => {
                            setProfessionalDocument(event.target.value);
                            setError(null);
                          }}
                        />
                      </label> : null}
                    </>
                  ) : null}

                  {status === 'REFUNDED' || status === 'INVALIDATED' ? (
                    <>
                      <label className="authorization-fulfillment-date">
                        <span>Motivo obligatorio</span>
                        <textarea className="control" maxLength={1000} value={reason}
                          onChange={event => setReason(event.target.value)} required />
                      </label>
                      <label className="authorization-fulfillment-date">
                        <span>Soporte o referencia</span>
                        <input className="control" maxLength={255} value={reference}
                          onChange={event => setReference(event.target.value)} />
                      </label>
                      {status === 'INVALIDATED' ? <label>
                        <input type="checkbox" checked={confirmError}
                          onChange={event => setConfirmError(event.target.checked)} />
                        Confirmo que el dinero nunca fue recibido.
                      </label> : null}
                    </>
                  ) : null}

                  {status ? (
                    <>
                      <label className="authorization-fulfillment-date">
                        <span>Observación {status === 'COLLECTED' && !normalizeModeratorFeeAmount(detail.expectedAmountCop ?? '') ? '(obligatoria para valor manual)' : '(opcional)'}</span>
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
                  Consulta de solo lectura. El recaudo lo gestiona MTD.
                </p>
              )}


            </>
          )}
          <details style={{ marginTop: 16 }}>
            <summary>Historial financiero ({detail.history.length})</summary>
            <ol>{detail.history.map(event => <li key={event.id}>
              {statusLabel(event.status)} · {moderatorFeeMoney(event.amountCop === null ? 0 : Number(event.amountCop))}
              {' · '}{moderatorFeeDate(event.effectiveAt ?? event.collectedAt)}
              {' · '}{event.reason ?? event.observation ?? 'Sin observación'}
              {' · '}ID: {event.id}
              {event.syncStatus ? ` · Hoja: ${event.syncStatus}` : ''}
              {canManage && (event.syncStatus === 'FAILED' || event.syncStatus === 'PENDING')
                ? <button type="button" className="btn secondary" onClick={() => {
                    void retryAuthorizationModeratorFeeSync(organizationId, authorizationItemId, event.id)
                      .then(setDetail).catch(cause => setError(cause instanceof Error ? cause.message : 'Error de sincronización'));
                  }}>Reintentar Sheets</button> : null}
            </li>)}</ol>
          </details>
          {detail.history[0] ? <p>Último movimiento: {statusLabel(detail.history[0].status)} · {moderatorFeeDate(detail.history[0].registeredAt)}</p> : null}
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
