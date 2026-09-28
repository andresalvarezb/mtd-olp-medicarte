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


export type ExportableFilters =
  Readonly<
    Record<
      string,
      string | undefined
    >
  >;


export async function downloadExportable(
  organizationId:
    string,

  kind:
    ExportableKind,

  filters?:
    ExportableFilters,
): Promise<Blob> {
  const params =
    new URLSearchParams();

  for (
    const [
      key,
      value,
    ]
    of Object.entries(
      filters ?? {},
    )
  ) {
    if (value) {
      params.set(
        key,
        value,
      );
    }
  }

  const query =
    params.toString();

  const route =
    query
      ? `${ROUTES[kind]}?${query}`
      : ROUTES[kind];

  return apiRequest<Blob>(
    route,
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
