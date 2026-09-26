'use client';

import { TariffProductsTable } from './tariff-products-table';
import { useRef, useState } from 'react';

import * as XLSX from 'xlsx';

import { PageHeader } from '@/components/ui/page-header';

import { Card, CardBody } from '@/components/ui/card';

import { useRole } from '@/components/layout/role-context';

import {
  confirmTariffAnnex,
  getTariffAnnexImport,
  prepareTariffAnnex,
  uploadTariffAnnex,
  type TariffConfirmResponse,
  type TariffImportResponse,
  type TariffPreview,
} from '@/lib/purchase-configuration-api';

const TEMPLATE_HEADERS = [
  'CODIGO_MEDICAMENTO',
  'TARIFA_UNIDAD',
  'NUMERO_EXPEDIENTE_INVIMA',
  'CONSECUTIVO_INVIMA_PRESENTACION',
  'DESCRIPCION_GENERICA_MEDICAMENTO',
  'DESCRIPCION_COMERCIAL_MEDICAMENTO',
  'LABORATORIO_MEDICAMENTO',
  'TIPO_INCLUSION_MEDICAMENTO',
  'CANTIDAD_MINIMA',
  'CODIGO_CUM_FINAL',
  'MODELO',
  'PUNTO_APLICACION_PREDETERMINADO',
] as const;

function downloadTemplate() {
  const workbook = XLSX.utils.book_new();

  const sheet = XLSX.utils.aoa_to_sheet([[...TEMPLATE_HEADERS]]);

  XLSX.utils.book_append_sheet(workbook, sheet, 'Anexo Tarifario');

  XLSX.writeFile(workbook, 'plantilla-anexo-tarifario-puntos.xlsx');
}

export function ConfiguracionCompraView() {
  const { organizationId, hasPermission } = useRole();

  const inputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);

  const [importId, setImportId] = useState<string | null>(null);

  const [preview, setPreview] = useState<TariffPreview | null>(null);

  const [completed, setCompleted] = useState<TariffImportResponse | null>(null);

  const [confirmResult, setConfirmResult] = useState<TariffConfirmResponse | null>(null);

  const [overrideReason, setOverrideReason] = useState('');

  const canImport = hasPermission('tariff_annex.import');

  async function selectFile(file: File | undefined) {
    if (!file) {
      return;
    }

    setBusy(true);
    setError(null);
    setCompleted(null);
    setConfirmResult(null);
    setPreview(null);
    setImportId(null);
    setOverrideReason('');
    setFileName(file.name);

    try {
      const uploaded = await uploadTariffAnnex(organizationId, file);

      const prepared = await prepareTariffAnnex(organizationId, uploaded.id);

      setImportId(uploaded.id);

      setPreview(prepared.preview);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'No fue posible preparar el Anexo Tarifario.',
      );
    } finally {
      setBusy(false);

      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  }

  async function confirm() {
    if (!importId || !preview) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const result = await confirmTariffAnnex(
        organizationId,
        importId,
        overrideReason.trim() || undefined,
      );

      setConfirmResult(result);

      const final = await getTariffAnnexImport(organizationId, importId);

      setCompleted(final);

      setPreview(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'No fue posible confirmar el Anexo Tarifario.',
      );
    } finally {
      setBusy(false);
    }
  }

  function cancelPreview() {
    setPreview(null);
    setImportId(null);
    setFileName(null);
    setOverrideReason('');
  }

  const requiresOverride = (preview?.anomalous ?? 0) > 0;

  const canConfirm =
    !busy && !!preview && (!requiresOverride || overrideReason.trim().length >= 10);

  return (
    <>
      <PageHeader
        title="Anexo Tarifario"
        description="Administra productos, tarifas contractuales y su punto de aplicación predeterminado."
        actions={
          <>
            <button type="button" className="btn" onClick={downloadTemplate}>
              Descargar plantilla
            </button>

            {canImport ? (
              <button
                type="button"
                className="btn primary"
                disabled={busy || preview !== null}
                onClick={() => inputRef.current?.click()}
              >
                {busy ? 'Procesando…' : 'Cargar Anexo Tarifario'}
              </button>
            ) : null}

            <input
              ref={inputRef}
              hidden
              type="file"
              accept=".xlsx"
              onChange={(event) => {
                void selectFile(event.target.files?.[0]);
              }}
            />
          </>
        }
      />

      {error ? (
        <div
          className="login-error"
          role="alert"
          style={{
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      ) : null}

      {preview || completed ? (
        <Card>
          <CardBody>
            {preview ? (
              <div className="purchase-config-preview">
                <div className="purchase-config-file">
                  <div>
                    <strong>{fileName ?? 'Anexo Tarifario'}</strong>

                    <span>Archivo validado. Revisa el resultado antes de confirmar.</span>
                  </div>

                  <span className="pill blue">Pendiente de confirmación</span>
                </div>

                <div className="purchase-config-metrics">
                  <div>
                    <span>Registros</span>

                    <strong>{preview.total}</strong>
                  </div>

                  <div>
                    <span>Sin cambios</span>

                    <strong>{preview.unchanged}</strong>
                  </div>

                  <div>
                    <span>Cambios</span>

                    <strong>{preview.changed}</strong>
                  </div>

                  <div>
                    <span>Rechazados</span>

                    <strong>{preview.rejected}</strong>
                  </div>

                  <div>
                    <span>Anomalías</span>

                    <strong>{preview.anomalous}</strong>
                  </div>
                </div>

                {requiresOverride ? (
                  <div className="purchase-config-warning">
                    <strong>Se detectaron cambios tarifarios atípicos.</strong>

                    <p>
                      Para confirmar debes registrar una justificación de mínimo 10 caracteres. La
                      justificación quedará auditada.
                    </p>

                    <textarea
                      className="control"
                      rows={3}
                      value={overrideReason}
                      onChange={(event) => setOverrideReason(event.target.value)}
                      placeholder="Motivo de la confirmación excepcional"
                    />
                  </div>
                ) : null}

                <div className="purchase-config-actions">
                  <button type="button" className="btn" disabled={busy} onClick={cancelPreview}>
                    Cancelar
                  </button>

                  <button
                    type="button"
                    className="btn primary"
                    disabled={!canConfirm}
                    onClick={() => {
                      void confirm();
                    }}
                  >
                    {busy ? 'Confirmando…' : 'Confirmar carga'}
                  </button>
                </div>
              </div>
            ) : null}

            {completed ? (
              <div className="purchase-config-preview">
                <div className="purchase-config-file">
                  <div>
                    <strong>{completed.originalFilename}</strong>

                    <span>Anexo Tarifario y puntos predeterminados actualizados.</span>
                  </div>

                  <span className="pill green">Carga finalizada</span>
                </div>

                <div className="purchase-config-metrics">
                  <div>
                    <span>Procesadas</span>

                    <strong>{completed.previewTotal}</strong>
                  </div>

                  <div>
                    <span>Nuevas</span>

                    <strong>{confirmResult?.created ?? 0}</strong>
                  </div>

                  <div>
                    <span>Actualizadas</span>

                    <strong>{confirmResult?.updated ?? 0}</strong>
                  </div>

                  <div>
                    <span>Sin cambios</span>

                    <strong>{confirmResult?.unchanged ?? 0}</strong>
                  </div>

                  <div>
                    <span>Rechazadas</span>

                    <strong>{confirmResult?.rejected ?? completed.previewRejected}</strong>
                  </div>
                </div>

                <div className="purchase-config-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setCompleted(null);

                      setConfirmResult(null);

                      setFileName(null);

                      setImportId(null);
                    }}
                  >
                    Cargar otro archivo
                  </button>
                </div>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <TariffProductsTable />
    </>
  );
}
