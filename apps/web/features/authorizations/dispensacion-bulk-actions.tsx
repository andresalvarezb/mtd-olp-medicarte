'use client';

import {
  useRef,
  useState,
} from 'react';

import {
  downloadDispensationTemplate,
  uploadDispensationWorkbook,
} from '@/lib/authorization-query-api';

type Props = Readonly<{
  organizationId: string;
  canManage: boolean;
  onImported?: () => void;
}>;

function downloadBlob(
  blob: Blob,
  filename: string,
) {
  const url =
    URL.createObjectURL(blob);

  const anchor =
    document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
}

export function DispensacionBulkActions({
  organizationId,
  canManage,
  onImported,
}: Props) {
  const inputRef =
    useRef<HTMLInputElement>(null);

  const [busy, setBusy] =
    useState(false);

  const [message, setMessage] =
    useState<string | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  if (!canManage) {
    return null;
  }

  async function downloadTemplate() {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const blob =
        await downloadDispensationTemplate(
          organizationId,
        );

      downloadBlob(
        blob,
        'plantilla-dispensacion.xlsx',
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible descargar la plantilla.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function upload(
    file: File | undefined,
  ) {
    if (!file) return;

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const result =
        await uploadDispensationWorkbook(
          organizationId,
          file,
        );

      setMessage(
        `Dispensación procesada: ${result.acceptedRows} aceptadas de ${result.totalRows}. ` +
          `${result.rejectedRows} rechazadas.`,
      );

      onImported?.();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible cargar la dispensación.',
      );
    } finally {
      if (inputRef.current) {
        inputRef.current.value = '';
      }

      setBusy(false);
    }
  }

  return (
    <div className="bulk-action-panel">
      <div className="bulk-action-copy">
        <strong>
          Cargar dispensación
        </strong>

        <span>
          Plantilla: Clave autorización y fecha de dispensación.
        </span>
      </div>

      <div className="bulk-action-buttons">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => {
            void downloadTemplate();
          }}
        >
          Descargar plantilla
        </button>

        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={() =>
            inputRef.current?.click()
          }
        >
          Cargar dispensación
        </button>

        <input
          ref={inputRef}
          hidden
          type="file"
          accept=".xlsx"
          onChange={(event) => {
            void upload(
              event.target.files?.[0],
            );
          }}
        />
      </div>

      {message ? (
        <div className="success-message">
          {message}
        </div>
      ) : null}

      {error ? (
        <div
          className="login-error"
          role="alert"
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
