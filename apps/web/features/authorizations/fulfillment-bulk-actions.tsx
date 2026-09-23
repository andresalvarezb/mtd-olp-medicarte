'use client';

import {
  useRef,
  useState,
} from 'react';

import {
  downloadAuthorizationFulfillmentTemplate,
  uploadAuthorizationFulfillmentWorkbook,
} from '@/lib/authorization-query-api';


type Props =
  Readonly<{
    organizationId:
      string;

    canManage:
      boolean;

    onImported?:
      () => void;
  }>;


function saveBlob(
  blob:
    Blob,

  filename:
    string,
) {
  const url =
    URL.createObjectURL(
      blob,
    );

  const anchor =
    document.createElement(
      'a',
    );

  anchor.href =
    url;

  anchor.download =
    filename;

  document.body.appendChild(
    anchor,
  );

  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(
    url,
  );
}


function saveBase64(
  base64:
    string,

  filename:
    string,
) {
  const binary =
    window.atob(
      base64,
    );

  const bytes =
    new Uint8Array(
      binary.length,
    );

  for (
    let index = 0;
    index < binary.length;
    index += 1
  ) {
    bytes[index] =
      binary.charCodeAt(
        index,
      );
  }

  saveBlob(
    new Blob(
      [bytes],
      {
        type:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ),
    filename,
  );
}


export function FulfillmentBulkActions({
  organizationId,
  canManage,
  onImported,
}: Props) {
  const fileRef =
    useRef<HTMLInputElement>(
      null,
    );

  const [busy, setBusy] =
    useState(false);

  const [message, setMessage] =
    useState<
      string | null
    >(null);

  const [error, setError] =
    useState<
      string | null
    >(null);

  const [
    rejected,
    setRejected,
  ] =
    useState<
      string | null
    >(null);


  if (!canManage) {
    return null;
  }


  async function template() {
    setBusy(true);
    setError(null);

    try {
      const blob =
        await downloadAuthorizationFulfillmentTemplate(
          organizationId,
        );

      saveBlob(
        blob,
        'plantilla-entrega-aplicacion.xlsx',
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
    file:
      File | undefined,
  ) {
    if (!file) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    setRejected(null);

    try {
      const result =
        await uploadAuthorizationFulfillmentWorkbook(
          organizationId,
          file,
        );

      setMessage(
        `Entrega/Aplicación: ${result.acceptedRows} aceptadas de ${result.totalRows}; ${result.rejectedRows} rechazadas.`,
      );

      setRejected(
        result.rejectedWorkbookBase64,
      );

      onImported?.();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible cargar Entrega/Aplicación.',
      );
    } finally {
      if (
        fileRef.current
      ) {
        fileRef.current.value =
          '';
      }

      setBusy(false);
    }
  }


  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '0.5rem',
        marginTop: '0.75rem',
      }}
    >
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void template();
        }}
      >
        Descargar plantilla Entrega/Aplicación
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={() => {
          fileRef.current?.click();
        }}
      >
        Cargar Entrega/Aplicación
      </button>

      {rejected ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            saveBase64(
              rejected,
              'entrega-aplicacion-rechazados.xlsx',
            );
          }}
        >
          Descargar rechazados
        </button>
      ) : null}

      <input
        ref={fileRef}
        hidden
        type="file"
        accept=".xlsx"
        onChange={(event) => {
          void upload(
            event.target.files?.[0],
          );
        }}
      />

      {message ? (
        <span>
          {message}
        </span>
      ) : null}

      {error ? (
        <span role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
