import {
  apiRequest,
} from './api-client';

export type TariffPreviewRow = {
  rowNumber:
    number;

  codigoProducto:
    string | null;

  state:
    | 'UNCHANGED'
    | 'CHANGED'
    | 'ANOMALOUS'
    | 'REJECTED';

  action:
    | 'NEW'
    | 'UNCHANGED'
    | 'UPDATE'
    | 'REJECT';

  anomalyCode:
    string | null;

  tariffChanged:
    boolean;

  deliveryPointManaged:
    boolean;

  deliveryPointChanged:
    boolean;
};

export type TariffPreview = {
  total:
    number;

  unchanged:
    number;

  changed:
    number;

  anomalous:
    number;

  rejected:
    number;

  scalePatternDetected:
    boolean;

  rows:
    TariffPreviewRow[];
};

export type TariffImportResponse = {
  id:
    string;

  status:
    string;

  originalFilename:
    string;

  preview:
    TariffPreview | null;

  previewTotal:
    number;

  previewUnchanged:
    number;

  previewChanged:
    number;

  previewAnomalous:
    number;

  previewRejected:
    number;

  previewScalePatternDetected:
    boolean;

  confirmedAt:
    string | null;

  completedAt:
    string | null;
};

export type TariffPrepareResponse = {
  outcome:
    'prepared';

  importId:
    string;

  preview:
    TariffPreview;
};

export type TariffConfirmResponse = {
  outcome:
    'completed';

  importId:
    string;

  preview:
    TariffPreview;

  created:
    number;

  updated:
    number;

  unchanged:
    number;

  rejected:
    number;
};

export async function uploadTariffAnnex(
  organizationId:
    string,

  file:
    File,
) {
  const body =
    new FormData();

  body.append(
    'file',
    file,
  );

  return apiRequest<
    TariffImportResponse
  >(
    '/admin/tariff-annex/imports',
    {
      method:
        'POST',

      organizationId,

      body,
    },
  );
}

export function prepareTariffAnnex(
  organizationId:
    string,

  importId:
    string,
) {
  return apiRequest<
    TariffPrepareResponse
  >(
    `/admin/tariff-annex/imports/${importId}/prepare`,
    {
      method:
        'POST',

      organizationId,
    },
  );
}

export function confirmTariffAnnex(
  organizationId:
    string,

  importId:
    string,

  overrideReason?:
    string,
) {
  return apiRequest<
    TariffConfirmResponse
  >(
    `/admin/tariff-annex/imports/${importId}/confirm`,
    {
      method:
        'POST',

      organizationId,

      body:
        JSON.stringify(
          overrideReason
            ? {
                overrideReason,
              }
            : {},
        ),
    },
  );
}

export function getTariffAnnexImport(
  organizationId:
    string,

  importId:
    string,
) {
  return apiRequest<
    TariffImportResponse
  >(
    `/admin/tariff-annex/imports/${importId}`,
    {
      organizationId,
    },
  );
}
