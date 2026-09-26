import {
  apiRequest,
} from './api-client';


export type ExportableKind =
  | 'purchase-order-candidates'
  | 'purchase-orders'
  | 'authorizations';


const ROUTES:
  Record<
    ExportableKind,
    string
  > = {
    'purchase-order-candidates':
      '/exportables/purchase-order-candidates.xlsx',

    'purchase-orders':
      '/exportables/purchase-orders.xlsx',

    authorizations:
      '/exportables/authorizations.xlsx',
  };


export async function downloadExportable(
  organizationId:
    string,

  kind:
    ExportableKind,
): Promise<Blob> {
  return apiRequest<Blob>(
    ROUTES[
      kind
    ],
    {
      organizationId,
    },
  );
}


export function saveExportable(
  blob:
    Blob,

  filename:
    string,
): void {
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

  anchor.click();

  URL.revokeObjectURL(
    url,
  );
}
