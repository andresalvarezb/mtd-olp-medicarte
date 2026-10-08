'use client';

import { useLoadingFeedback } from '@/hooks/use-loading-feedback';

import { TableLoadingRow } from '@/components/ui/loading-state';

import { useEffect, useRef, useState } from 'react';

import { PageHeader } from '@/components/ui/page-header';

import { Card, CardBody } from '@/components/ui/card';

import { FilterActions, FilterBar, FilterField } from '@/components/ui/filter-bar';

import { useRole } from '@/components/layout/role-context';

import { useApiData } from '@/hooks/use-api-data';
import { useRealtimeRevision } from '@/components/realtime/realtime-context';

import {
  ApiError,
} from '@/lib/api-client';

import {
  editAuthorizationManually,
  fulfillAuthorization,
  getAuthorizationQueryItem,
  getAuthorizationHistory,
  listAuthorizationQuery,
  type AuthorizationFulfillmentType,
  type AuthorizationHistoryEvent,
  type AuthorizationQueryFilters,
  type AuthorizationQueryItem,
} from '@/lib/authorization-query-api';

import {
  authorizationOperationalLabel,
} from '@/lib/authorization-operational-display';

import {
  billingAuditColumnLabel,
  billingAuditEvidenceLabel,
  billingAuditResultLabel,
  billingAuditStatusLabel,
} from '@/lib/authorization-billing-audit-display';

import {
  decideAuthorizationBillingAudit,
  getAuthorizationBillingAudit,
  searchAuthorizationBillingAuditDriveEvidence,
  startAuthorizationBillingAudit,
  type AuthorizationBillingAuditDecisionRequest,
  type AuthorizationBillingAuditResponse,
} from '@/lib/authorization-billing-audits-api';

import {
  downloadExportable,
  saveExportable,
} from '@/lib/exportables-api';

const AUTHORIZATION_DRAWER_EXIT_MS =
  340;


function initialValidationLabel(
  status:
    AuthorizationQueryItem['initialValidationStatus'],
) {
  const labels = {
    PASSED:
      'Cumple',

    PENDING:
      'Validación pendiente',

    FAILED:
      'No cumple',
  } satisfies Record<
    AuthorizationQueryItem['initialValidationStatus'],
    string
  >;

  return labels[status];
}


function authorizationLifecycleLabel(
  item:
    AuthorizationQueryItem,
): 'Habilitada' | 'Inhabilitada' | 'Pendiente' {
  const labels = {
    ENABLED:
      'Habilitada',

    PENDING:
      'Pendiente',

    DISABLED:
      'Inhabilitada',
  } satisfies Record<
    AuthorizationQueryItem['lifecycleEnablement'],
    'Habilitada' | 'Inhabilitada' | 'Pendiente'
  >;

  return labels[
    item.lifecycleEnablement
  ];
}

function authorizationLifecycleReasonText(
  item:
    AuthorizationQueryItem,
): string {
  if (
    item.lifecycleReasons.length ===
      0
  ) {
    return 'Sin bloqueos';
  }

  return item.lifecycleReasons
    .map(
      (reason) =>
        reason.message,
    )
    .join(
      ' · ',
    );
}


function validityLabel(
  status:
    AuthorizationQueryItem['validityStatus'],
) {
  const labels = {
    IN_WINDOW:
      'Dentro de rango',

    EXPIRED:
      'Vencida',

    OUTSIDE_HORIZON:
      'Fuera de rango +30',

    INVALID_DATE:
      'Fecha inválida',
  } satisfies Record<
    AuthorizationQueryItem['validityStatus'],
    string
  >;

  return labels[status];
}


function fulfillmentStatusLabel(
  item:
    AuthorizationQueryItem,
) {
  const labels = {
    PENDING:
      'Pendiente de atención',

    PARTIAL:
      'Con aplicación pendiente',

    COMPLETE:
      'Atención completa',
  } satisfies Record<
    AuthorizationQueryItem['fulfillmentProgressStatus'],
    string
  >;

  return labels[
    item.fulfillmentProgressStatus
  ];
}





type AuthorizationUnifiedStatus =
  | ''
  | 'UNASSIGNED'
  | 'PARTIALLY_ASSIGNED'
  | 'ASSIGNED'
  | 'APPLICATION_PENDING'
  | 'OUT_OF_OPERATION'
  | 'CLOSED';


function authorizationUnifiedStatusFilters(
  status:
    AuthorizationUnifiedStatus,
): AuthorizationQueryFilters {
  switch (
    status
  ) {
    case 'UNASSIGNED':
      return {
        operationalStatus:
          'UNASSIGNED',

        fulfillmentProgressStatus:
          'PENDING',
      };


    case 'PARTIALLY_ASSIGNED':
      return {
        operationalStatus:
          'PARTIALLY_ASSIGNED',

        fulfillmentProgressStatus:
          'PENDING',
      };


    case 'ASSIGNED':
      return {
        operationalStatus:
          'ASSIGNED',

        fulfillmentProgressStatus:
          'PENDING',
      };


    case 'APPLICATION_PENDING':
      return {
        fulfillmentProgressStatus:
          'PARTIAL',
      };


    case 'OUT_OF_OPERATION':
      return {
        operationalStatus:
          'OUT_OF_OPERATION',
      };


    case 'CLOSED':
      return {
        operationalStatus:
          'CLOSED',
      };


    default:
      return {};
  }
}


function singlePurchaseOrderCode(
  value:
    string | null,
) {
  if (!value) {
    return null;
  }

  const codes =
    value
      .split(',')
      .map(
        (candidate) =>
          candidate.trim(),
      )
      .filter(Boolean);

  if (
    codes.length !==
    1
  ) {
    return null;
  }

  return codes[0]!;
}


type AuthorizationPurchaseOrderContext =
  Readonly<{
    kind:
      | 'active'
      | 'trace';

    message:
      string;
  }>;


function purchaseOrderCodes(
  value:
    string | null,
): string[] {
  if (!value) {
    return [];
  }

  return [
    ...new Set(
      value
        .split(',')
        .map(
          (code) =>
            code.trim(),
        )
        .filter(
          Boolean,
        ),
    ),
  ];
}


function purchaseOrderReference(
  codes:
    string[],
): string {
  if (
    codes.length === 1
  ) {
    const code =
      codes[0];

    return code
      ? `la OC ${code}`
      : 'la OC relacionada';
  }

  return `las OC ${codes.join(
    ', ',
  )}`;
}


function authorizationPurchaseOrderContext(
  item:
    AuthorizationQueryItem,
): AuthorizationPurchaseOrderContext | null {
  const activeCodes =
    item.remainingAssignedQuantity >
      0
      ? purchaseOrderCodes(
          item.purchaseOrder,
        )
      : [];


  const traceCodes =
    [
      ...new Set(
        item.purchaseOrders
          .map(
            (order) =>
              order.purchaseOrderCode
                .trim(),
          )
          .filter(
            Boolean,
          ),
      ),
    ];


  const otherTraceCodes =
    traceCodes.filter(
      (code) =>
        !activeCodes.includes(
          code,
        ),
    );


  const point =
    item.dispensingPointCode
    ??
    item.dispensingPointName;


  if (
    activeCodes.length >
    0
  ) {
    const pointText =
      point
        ? ` en ${point}`
        : '';

    const traceText =
      otherTraceCodes.length >
      0
        ? ` Además, registra trazabilidad con ${purchaseOrderReference(
            otherTraceCodes,
          )}.`
        : '';

    return {
      kind:
        'active',

      message:
        `Esta autorización está actualmente relacionada con ${purchaseOrderReference(
          activeCodes,
        )}. Tiene ${item.allocatedQuantity} unidades asignadas y ${item.remainingAssignedQuantity} continúan disponibles para entrega/aplicación${pointText}.${traceText}`,
    };
  }


  if (
    traceCodes.length >
    0
  ) {
    return {
      kind:
        'trace',

      message:
        `Esta autorización está relacionada con ${purchaseOrderReference(
          traceCodes,
        )}, pero todavía no tiene producto recibido/asignado disponible para entrega/aplicación.`,
    };
  }


  return null;
}


function fulfillmentTypeLabel(
  type:
    string | null,
) {
  if (
    type === 'APPLICATION'
  ) {
    return 'Aplicación';
  }

  if (
    type === 'DELIVERY'
  ) {
    return 'Entrega';
  }

  return '—';
}

function currentBogotaDate() {
  return new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone:
        'America/Bogota',

      year:
        'numeric',

      month:
        '2-digit',

      day:
        '2-digit',
    },
  ).format(
    new Date(),
  );
}

function authorizationDateLabel(
  value:
    string | null,
) {
  if (!value) {
    return '—';
  }

  const normalized =
    value.trim();

  const compact =
    normalized.match(
      /^(\d{4})(\d{2})(\d{2})$/,
    );

  if (compact) {
    return `${compact[3]}/${compact[2]}/${compact[1]}`;
  }

  const iso =
    normalized.match(
      /^(\d{4})-(\d{2})-(\d{2})/,
    );

  if (iso) {
    return `${iso[3]}/${iso[2]}/${iso[1]}`;
  }

  return normalized;
}


function authorizationDateInputValue(
  value:
    string | null,
) {
  if (!value) {
    return null;
  }

  const normalized =
    value.trim();

  const compact =
    normalized.match(
      /^(\d{4})(\d{2})(\d{2})$/,
    );

  if (compact) {
    return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }

  const iso =
    normalized.match(
      /^(\d{4})-(\d{2})-(\d{2})/,
    );

  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  return null;
}


function moderatorFeeLabel(
  value:
    string | null,
) {
  if (
    !value
    ||
    !value.trim()
  ) {
    return 'Sin valor registrado';
  }

  const raw =
    value.trim();

  let numeric:
    number;

  if (
    /^-?\d+(\.\d+)?$/
      .test(raw)
  ) {
    numeric =
      Number(raw);
  } else if (
    /^\d{1,3}(\.\d{3})+(,\d+)?$/
      .test(raw)
  ) {
    numeric =
      Number(
        raw
          .replace(
            /\./g,
            '',
          )
          .replace(
            ',',
            '.',
          ),
      );
  } else {
    numeric =
      Number(
        raw.replace(
          ',',
          '.',
        ),
      );
  }

  if (
    !Number.isFinite(
      numeric,
    )
  ) {
    return raw;
  }

  return new Intl.NumberFormat(
    'es-CO',
    {
      style:
        'currency',

      currency:
        'COP',

      maximumFractionDigits:
        0,
    },
  ).format(
    numeric,
  );
}


function manualEditErrorMessage(
  cause:
    unknown,
) {
  if (
    cause instanceof
      ApiError
  ) {
    const messages:
      Record<
        string,
        string
      > =
      {
        AUTHORIZATION_IDENTITY_CONFLICT:
          'Ya existe esta autorización con el código de producto indicado.',

        AUTHORIZATION_PRODUCT_NOT_ACTIVE:
          'El código no existe o no está activo en el Anexo Tarifario.',

        AUTHORIZATION_BELOW_MINIMUM_QUANTITY:
          'La cantidad es inferior a la cantidad mínima configurada para el producto.',

        AUTHORIZATION_PRODUCT_ALREADY_FULFILLED:
          'El producto no puede cambiarse porque ya existe una entrega/aplicación.',

        AUTHORIZATION_DRAFT_APPLICATION_EXISTS:
          'Existe una aplicación en borrador de Medicarte. Debe resolverse antes de modificar producto o cantidad.',

        AUTHORIZATION_SCHEDULE_RECONCILIATION_COMPLEX:
          'La autorización tiene varias programaciones activas y la cantidad no puede redistribuirse automáticamente.',

        AUTHORIZATION_QUANTITY_BELOW_FULFILLED:
          'La cantidad no puede ser menor que la cantidad ya entregada/aplicada.',

        AUTHORIZATION_VALIDITY_BEFORE_FULFILLMENT:
          'La vigencia no puede terminar antes de la entrega/aplicación registrada.',

        AUTHORIZATION_PO_RECONCILIATION_COMPLEX:
          'La autorización está distribuida en varias líneas de OC y requiere revisión antes de modificarla.',

        AUTHORIZATION_PO_RECONCILIATION_CONFLICT:
          'No fue posible reconciliar la OC de MTD de forma segura.',
      };

    return (
      messages[cause.code]
      ??
      cause.message
    );
  }

  return cause instanceof Error
    ? cause.message
    : 'No fue posible guardar los cambios.';
}


function dateTimeLabel(
  value:
    string | null,
) {
  if (!value) {
    return '—';
  }

  const parsed =
    new Date(
      value,
    );

  if (
    Number.isNaN(
      parsed.getTime(),
    )
  ) {
    return value;
  }

  return parsed.toLocaleString(
    'es-CO',
  );
}

export function ConsultaAutorizacionesView() {
  const { organizationId, hasPermission } = useRole();

  const [filters, setFilters] = useState<{
    authorizationNumber:
      string;

    commercialCode:
      string;

    patient:
      string;

    lifecycleEnablement:
      string;

    status:
      AuthorizationUnifiedStatus;
  }>({
    authorizationNumber:
      '',

    commercialCode:
      '',

    patient:
      '',

    lifecycleEnablement:
      '',

    status:
      '',
  });

  const [appliedFilters, setAppliedFilters] = useState(filters);

  const [page, setPage] = useState(1);

  const [pageSize, setPageSize] = useState(10);

  const [selected, setSelected] = useState<AuthorizationQueryItem | null>(null);

  const [
    authorizationDrawerVisible,
    setAuthorizationDrawerVisible,
  ] =
    useState(
      false,
    );

  const authorizationDrawerCloseTimer =
    useRef<
      number |
      null
    >(
      null,
    );

  const authorizationDrawerOpenFrame =
    useRef<
      number |
      null
    >(
      null,
    );

  const [
    editingAuthorization,
    setEditingAuthorization,
  ] =
    useState(false);

  const [
    savingAuthorizationEdit,
    setSavingAuthorizationEdit,
  ] =
    useState(false);

  const [
    authorizationEditError,
    setAuthorizationEditError,
  ] =
    useState<string | null>(
      null,
    );

  const [
    authorizationEdit,
    setAuthorizationEdit,
  ] =
    useState({
      commercialCode:
        '',

      quantity:
        '',

      validityEndDate:
        '',
    });

  const [
    fulfillmentType,
    setFulfillmentType,
  ] =
    useState<AuthorizationFulfillmentType>(
      'APPLICATION',
    );

  const [
    fulfillmentDate,
    setFulfillmentDate,
  ] =
    useState('');

  const [
    fulfillmentQuantity,
    setFulfillmentQuantity,
  ] =
    useState('');

  const [
    fulfillmentPurchaseOrderCode,
    setFulfillmentPurchaseOrderCode,
  ] =
    useState('');

  const [
    fulfilling,
    setFulfilling,
  ] =
    useState(false);

  const [
    fulfillmentError,
    setFulfillmentError,
  ] =
    useState<string | null>(
      null,
    );

  const summaryTopRef =
    useRef<HTMLDivElement | null>(
      null,
    );


  const [
    fulfillmentSuccess,
    setFulfillmentSuccess,
  ] =
    useState<{
      type:
        AuthorizationFulfillmentType;

      quantity:
        number;

      effectiveDate:
        string;
    } | null>(
      null,
    );


  const [
    managingAuthorization,
    setManagingAuthorization,
  ] =
    useState(false);

  const [
    viewingHistory,
    setViewingHistory,
  ] =
    useState(false);

  const [
    viewingBillingAudit,
    setViewingBillingAudit,
  ] =
    useState(
      false,
    );

  const [
    billingAudit,
    setBillingAudit,
  ] =
    useState<
      AuthorizationBillingAuditResponse |
      null
    >(
      null,
    );

  const [
    billingAuditLoading,
    setBillingAuditLoading,
  ] =
    useState(
      false,
    );

  const [
    billingAuditError,
    setBillingAuditError,
  ] =
    useState<
      string |
      null
    >(
      null,
    );

  const [
    billingAuditDriveSearching,
    setBillingAuditDriveSearching,
  ] =
    useState(
      false,
    );


  const [
    billingAuditDecisionSaving,
    setBillingAuditDecisionSaving,
  ] =
    useState(
      false,
    );

  const [
    billingAuditDecisionResult,
    setBillingAuditDecisionResult,
  ] =
    useState<
      AuthorizationBillingAuditDecisionRequest['result'] |
      ''
    >(
      '',
    );

  const [
    billingAuditObservation,
    setBillingAuditObservation,
  ] =
    useState(
      '',
    );

  const [
    billingAuditActionError,
    setBillingAuditActionError,
  ] =
    useState<
      string |
      null
    >(
      null,
    );



  const [
    authorizationHistory,
    setAuthorizationHistory,
  ] =
    useState<
      AuthorizationHistoryEvent[]
    >(
      [],
    );

  const [
    authorizationHistoryLoading,
    setAuthorizationHistoryLoading,
  ] =
    useState(
      false,
    );

  const [
    authorizationHistoryError,
    setAuthorizationHistoryError,
  ] =
    useState<string | null>(
      null,
    );


  const [
    exportingAuthorizations,
    setExportingAuthorizations,
  ] =
    useState(
      false,
    );


  useEffect(
    () => {
      return () => {
        if (
          authorizationDrawerCloseTimer.current !==
          null
        ) {
          window.clearTimeout(
            authorizationDrawerCloseTimer.current,
          );
        }

        if (
          authorizationDrawerOpenFrame.current !==
          null
        ) {
          window.cancelAnimationFrame(
            authorizationDrawerOpenFrame.current,
          );
        }


      };
    },
    [],
  );


  async function exportAuthorizations() {
    setFulfillmentError(
      null,
    );

    setExportingAuthorizations(
      true,
    );

    try {
      const blob =
        await downloadExportable(
          organizationId,
          'authorizations',
        );

      saveExportable(
        blob,
        'autorizaciones-consolidado.xlsx',
      );
    } catch (
      cause
    ) {
      setFulfillmentError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible exportar las autorizaciones.',
      );
    } finally {
      setExportingAuthorizations(
        false,
      );
    }
  }


  const canFulfill =
    hasPermission(
      'patient_applications.manage',
    );




  const canManualEdit =
    hasPermission(
      'authorizations.manual_edit',
    );

  const canReadBillingAudit =
    hasPermission(
      'application_audits.read',
    );


  const canManageBillingAudit =
    hasPermission(
      'application_audits.manage',
    );


const [
  filterQueryRevision,
  setFilterQueryRevision,
] =
  useState(
    0,
  );


const query = useApiData(
    () =>
      listAuthorizationQuery(organizationId, {
        page,
        limit: pageSize,

        ...(appliedFilters.authorizationNumber
          ? {
              authorizationNumber: appliedFilters.authorizationNumber,
            }
          : {}),

        ...(appliedFilters.commercialCode
          ? {
              commercialCode: appliedFilters.commercialCode,
            }
          : {}),

        ...(appliedFilters.patient
          ? {
              patient: appliedFilters.patient,
            }
          : {}),

        ...(appliedFilters.lifecycleEnablement
          ? {
              lifecycleEnablement:
                appliedFilters.lifecycleEnablement as NonNullable<
                  AuthorizationQueryFilters['lifecycleEnablement']
                >,
            }
          : {}),

        ...authorizationUnifiedStatusFilters(
          appliedFilters.status,
        ),
      }),
    [
      organizationId,
      appliedFilters,
      page,
      pageSize,
      filterQueryRevision,
    ],
    ['AUTHORIZATIONS'],
  );

  const authorizationLoading =
  useLoadingFeedback(
    query.loading,
  );


const authorizationRealtimeRevision = useRealtimeRevision(['AUTHORIZATIONS']);
  const selectedAuthorizationId = selected?.id ?? null;

  useEffect(() => {
    if (
      !selectedAuthorizationId
      ||
      editingAuthorization
    ) {
      return;
    }
    let cancelled = false;

    void getAuthorizationQueryItem(organizationId, selectedAuthorizationId)
      .then((refreshed) => {
        if (!cancelled) setSelected(refreshed);
      })
      .catch(() => {
        // La tabla ya maneja el error de reconciliación; el detalle conserva el último snapshot.
      });

    return () => {
      cancelled = true;
    };
  }, [
    authorizationRealtimeRevision,
    editingAuthorization,
    organizationId,
    selectedAuthorizationId,
  ]);

  const data =
    query.data;

  const showAuthorizationLoading =
    authorizationLoading.visible;



  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const firstVisible =
    data && data.total > 0
      ? (page - 1) * data.pageSize + 1
      : 0;

  const lastVisible =
    data
      ? Math.min(
          page * data.pageSize,
          data.total,
        )
      : 0;

  function applyFilters() {
    authorizationLoading.trigger();

    setPage(
      1,
    );

    setAppliedFilters({
      ...filters,
    });

    setFilterQueryRevision(
      (current) =>
        current +
        1,
    );
  }


  function clearFilters() {
    const cleared = {
      authorizationNumber:
        '',

      commercialCode:
        '',

      patient:
        '',

      lifecycleEnablement:
        '',

      status:
        '' as AuthorizationUnifiedStatus,
    };

    /*
     * Limpiar afecta tanto los controles visibles
     * como los filtros realmente enviados a la API.
     */
    setFilters({
      ...cleared,
    });

    setAppliedFilters({
      ...cleared,
    });

    setPage(
      1,
    );

    authorizationLoading.trigger();

    /*
     * Siempre vuelve a consultar el listado completo.
     */
    setFilterQueryRevision(
      (current) =>
        current +
        1,
    );
  }


  function closeAuthorizationDetail() {
    if (
      authorizationDrawerOpenFrame.current !==
      null
    ) {
      window.cancelAnimationFrame(
        authorizationDrawerOpenFrame.current,
      );

      authorizationDrawerOpenFrame.current =
        null;
    }


    setAuthorizationDrawerVisible(
      false,
    );


    if (
      authorizationDrawerCloseTimer.current !==
      null
    ) {
      window.clearTimeout(
        authorizationDrawerCloseTimer.current,
      );
    }


    authorizationDrawerCloseTimer.current =
      window.setTimeout(
        () => {
          setSelected(
            null,
          );

          setManagingAuthorization(
            false,
          );

          setViewingHistory(
            false,
          );

          setViewingBillingAudit(
            false,
          );

          setBillingAudit(
            null,
          );

          setBillingAuditError(
            null,
          );

          setBillingAuditActionError(
            null,
          );

          setBillingAuditDecisionResult(
            '',
          );

          setBillingAuditObservation(
            '',
          );

          setEditingAuthorization(
            false,
          );

          setAuthorizationEditError(
            null,
          );

          authorizationDrawerCloseTimer.current =
            null;
        },
        AUTHORIZATION_DRAWER_EXIT_MS,
      );
  }


  async function openDetail(
    item:
      AuthorizationQueryItem,
  ) {
    /*
     * La lista trae purchaseOrders[] vacío
     * intencionalmente para mantenerse liviana.
     *
     * Al abrir Ver recuperamos el detail real,
     * que contiene la relación durable
     * AUTO -> purchase_order_authorization_sources -> OC.
     */
    if (
      authorizationDrawerCloseTimer.current !==
      null
    ) {
      window.clearTimeout(
        authorizationDrawerCloseTimer.current,
      );

      authorizationDrawerCloseTimer.current =
        null;
    }


    if (
      authorizationDrawerOpenFrame.current !==
      null
    ) {
      window.cancelAnimationFrame(
        authorizationDrawerOpenFrame.current,
      );
    }


    setAuthorizationDrawerVisible(
      false,
    );

    setSelected(
      item,
    );


    authorizationDrawerOpenFrame.current =
      window.requestAnimationFrame(
        () => {
          setAuthorizationDrawerVisible(
            true,
          );

          authorizationDrawerOpenFrame.current =
            null;
        },
      );


    setFulfillmentType(
      'APPLICATION',
    );

    setFulfillmentDate(
      '',
    );

    setFulfillmentQuantity(
      '',
    );

    setFulfillmentError(
      null,
    );

    setFulfillmentSuccess(
      null,
    );

    setManagingAuthorization(
      false,
    );

    setViewingHistory(
      false,
    );

    setViewingBillingAudit(
      false,
    );

    setBillingAudit(
      null,
    );

    setBillingAuditError(
      null,
    );

    setBillingAuditActionError(
      null,
    );

    setBillingAuditDecisionResult(
      '',
    );

    setBillingAuditObservation(
      '',
    );

    setEditingAuthorization(
      false,
    );

    setAuthorizationEditError(
      null,
    );

    if (!organizationId) {
      return;
    }

    try {
      const detail =
        await getAuthorizationQueryItem(
          organizationId,
          item.id,
        );

      /*
       * Evita que una respuesta tardía reabra o
       * reemplace otra autorización seleccionada.
       */
      setSelected(
        (current) =>
          current?.id === item.id
            ? detail
            : current,
      );
    } catch (cause) {
      setFulfillmentError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible cargar el detalle completo de la autorización.',
      );
    }
  }


  function beginManualEdit() {
    if (
      !selected
      ||
      !canManualEdit
    ) {
      return;
    }

    setManagingAuthorization(
      false,
    );

    setAuthorizationEditError(
      null,
    );

    setAuthorizationEdit({
      commercialCode:
        selected.commercialCode,

      quantity:
        selected.quantity
        ??
        '',

      validityEndDate:
        authorizationDateInputValue(
          selected.validityEndDate,
        )
        ??
        '',
    });

    setEditingAuthorization(
      true,
    );
  }


  function cancelManualEdit() {
    setEditingAuthorization(
      false,
    );

    setAuthorizationEditError(
      null,
    );
  }


  async function saveManualEdit() {
    if (
      !selected
      ||
      !organizationId
      ||
      savingAuthorizationEdit
    ) {
      return;
    }

    const quantity =
      Number(
        authorizationEdit.quantity,
      );

    if (
      !authorizationEdit.commercialCode.trim()
      ||
      !Number.isInteger(quantity)
      ||
      quantity <= 0
      ||
      !authorizationEdit.validityEndDate
    ) {
      setAuthorizationEditError(
        'Completa código de producto, cantidad y fecha final de vigencia con valores válidos.',
      );

      return;
    }

    setSavingAuthorizationEdit(
      true,
    );

    setAuthorizationEditError(
      null,
    );

    try {
      await editAuthorizationManually(
        organizationId,
        selected.id,
        {
          commercialCode:
            authorizationEdit.commercialCode.trim(),

          quantity,

          validityEndDate:
            authorizationEdit.validityEndDate,

          expectedVersion:
            selected.version,
        },
      );

      const refreshed =
        await getAuthorizationQueryItem(
          organizationId,
          selected.id,
        );

      setSelected(
        refreshed,
      );

      setEditingAuthorization(
        false,
      );

      setAuthorizationEditError(
        null,
      );

      query.reload();
    } catch (cause) {
      if (
        cause instanceof ApiError
        &&
        cause.code ===
          'AUTHORIZATION_VERSION_CONFLICT'
      ) {
        try {
          const refreshed =
            await getAuthorizationQueryItem(
              organizationId,
              selected.id,
            );

          setSelected(
            refreshed,
          );

          setAuthorizationEdit({
            commercialCode:
              refreshed.commercialCode,

            quantity:
              refreshed.quantity
              ??
              '',

            validityEndDate:
              authorizationDateInputValue(
                refreshed.validityEndDate,
              )
              ??
              '',
          });
        } catch {
          // Se conserva el conflicto original.
        }

        setAuthorizationEditError(
          'Esta autorización cambió desde que fue abierta. Se cargó la versión más reciente.',
        );

        return;
      }

      setAuthorizationEditError(
        manualEditErrorMessage(
          cause,
        ),
      );
    } finally {
      setSavingAuthorizationEdit(
        false,
      );
    }
  }


  async function confirmFulfillment() {
    const purchaseOrderCode =
      fulfillmentPurchaseOrderCode
      ||
      singlePurchaseOrderCode(
        selected?.purchaseOrder ??
          null,
      );

    if (
      !selected ||
      !organizationId ||
      !fulfillmentDate ||
      fulfilling
    ) {
      return;
    }

    if (
      selected.operationalStatus !==
        'ASSIGNED'
      &&
      selected.operationalStatus !==
        'PARTIALLY_ASSIGNED'
    ) {
      setFulfillmentError(
        'La autorización no tiene saldo físico disponible para registrar entrega o aplicación.',
      );

      return;
    }

    const fulfillmentQuantityNumber =
      Number(
        fulfillmentQuantity,
      );

    const fulfillmentMaxQuantity =
      Math.max(
        0,
        Math.min(
          selected.remainingAuthorizedQuantity,
          selected.remainingAssignedQuantity,
        ),
      );

    if (
      !Number.isInteger(
        fulfillmentQuantityNumber,
      )
      ||
      fulfillmentQuantityNumber <=
        0
      ||
      fulfillmentQuantityNumber >
        fulfillmentMaxQuantity
    ) {
      setFulfillmentError(
        `Ingresa una cantidad entera entre 1 y ${fulfillmentMaxQuantity}.`,
      );

      return;
    }

    if (
      fulfillmentDate >
        currentBogotaDate()
    ) {
      setFulfillmentError(
        'La fecha efectiva no puede ser futura.',
      );

      return;
    }

    if (
      !purchaseOrderCode
    ) {
      setFulfillmentError(
        'Selecciona la orden de compra desde la cual se entregó o aplicó el producto.',
      );

      return;
    }

    /*
     * Snapshot visual de la operación confirmada.
     *
     * Se conserva antes del await para que la alerta
     * muestre exactamente lo enviado en esta operación,
     * no el acumulado posterior.
     */
    const submittedFulfillmentType =
      fulfillmentType;

    const submittedFulfillmentQuantity =
      fulfillmentQuantityNumber;

    const submittedFulfillmentDate =
      fulfillmentDate;


    setFulfilling(
      true,
    );

    setFulfillmentError(
      null,
    );

    try {
      await fulfillAuthorization(
        organizationId,
        selected.id,
        {
          purchaseOrderCode,

          fulfillmentType,

          quantity:
            fulfillmentQuantityNumber,

          effectiveDate:
            fulfillmentDate,
        },
      );

      const refreshed =
        await getAuthorizationQueryItem(
          organizationId,
          selected.id,
        );

      setSelected(
        refreshed,
      );

      setFulfillmentSuccess({
        type:
          submittedFulfillmentType,

        quantity:
          submittedFulfillmentQuantity,

        effectiveDate:
          submittedFulfillmentDate,
      });


      setFulfillmentDate(
        '',
      );

      setFulfillmentQuantity(
        '',
      );

      setManagingAuthorization(
        false,
      );

      setViewingHistory(
        false,
      );

      requestAnimationFrame(() => {
        const drawer =
          summaryTopRef.current?.closest(
            '.authorization-detail-drawer',
          );

        if (
          drawer instanceof HTMLElement
        ) {
          drawer.scrollTo({
            top:
              0,

            behavior:
              'smooth',
          });
        }
      });

      query.reload();
    } catch (caught) {
      setFulfillmentError(
        caught instanceof Error
          ? caught.message
          : 'No fue posible completar la operación.',
      );
    } finally {
      setFulfilling(
        false,
      );
    }
  }

  const todayBogota =
    currentBogotaDate();

  /*
   * Una reserva ya asignada puede cerrarse después
   * del vencimiento. La única cota de fecha efectiva
   * es que no sea futura.
   */
  const fulfillmentMaxDate =
    todayBogota;

  /*
   * OC durablemente relacionada con la autorización.
   *
   * Fuente:
   * purchase_order_authorization_sources
   *
   * Esto es distinto de la disponibilidad física.
   * Una AUTO puede tener OC relacionada aunque todavía
   * no exista inventory_authorization_allocation.
   */



  /*
   * Las OC operativamente utilizables para fulfillment
   * requieren saldo físico asignado.
   *
   * Una AUTO puede tener más de una OC activa.
   */
  const selectedActivePurchaseOrders =
    selected
      ? selected.purchaseOrders.filter(
          (order) =>
            order.availableQuantity >
              0,
        )
      : [];

  const selectedActivePurchaseOrder =
    selectedActivePurchaseOrders.find(
      (order) =>
        order.purchaseOrderCode ===
          fulfillmentPurchaseOrderCode,
    )
    ??
    (
      selectedActivePurchaseOrders.length ===
        1
        ? selectedActivePurchaseOrders[0]!
        : null
    );


  const selectedFulfillmentMaxQuantity =
    selected &&
    selectedActivePurchaseOrder
      ? Math.max(
          0,
          Math.min(
            selected.remainingAuthorizedQuantity,
            selectedActivePurchaseOrder.availableQuantity,
          ),
        )
      : 0;

  const fulfillmentQuantityNumber =
    Number(
      fulfillmentQuantity,
    );

  const fulfillmentQuantityValid =
    Number.isInteger(
      fulfillmentQuantityNumber,
    )
    &&
    fulfillmentQuantityNumber >
      0
    &&
    fulfillmentQuantityNumber <=
      selectedFulfillmentMaxQuantity;

  const fulfillmentDateValid =
    Boolean(
      fulfillmentDate
      &&
      fulfillmentDate <=
        todayBogota,
    );

  async function loadBillingAudit(
    authorizationItemId:
      string,
  ) {
    if (
      !organizationId
    ) {
      return;
    }

    setBillingAuditLoading(
      true,
    );

    setBillingAuditError(
      null,
    );

    try {
      const audit =
        await getAuthorizationBillingAudit(
          organizationId,
          authorizationItemId,
        );

      setBillingAudit(
        audit,
      );
    } catch (
      cause
    ) {
      if (
        cause instanceof ApiError
        &&
        cause.status === 404
        &&
        cause.code ===
          'AUTHORIZATION_BILLING_AUDIT_NOT_FOUND'
      ) {
        /*
         * La creación del registro de auditoría es
         * un detalle técnico, no una acción de negocio
         * que deba ejecutar manualmente el usuario.
         *
         * Para una AUTO cerrada y con permiso de gestión,
         * materializamos automáticamente la auditoría.
         */
        if (
          canManageBillingAudit
          &&
          selected?.id ===
            authorizationItemId
          &&
          selected.operationalStatus ===
            'CLOSED'
        ) {
          try {
            const audit =
              await startAuthorizationBillingAudit(
                organizationId,
                authorizationItemId,
              );

            setBillingAudit(
              audit,
            );
          } catch (
            startCause
          ) {
            setBillingAudit(
              null,
            );

            setBillingAuditError(
              startCause instanceof Error
                ? startCause.message
                : 'No fue posible preparar la auditoría de facturación.',
            );
          }

          return;
        }

        setBillingAudit(
          null,
        );

        return;
      }

      setBillingAuditError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible consultar la auditoría de facturación.',
      );
    } finally {
      setBillingAuditLoading(
        false,
      );
    }
  }



  function openBillingAuditEvidence(
    webViewLink: string | null,
    driveFileId: string,
  ) {
    /*
     * El soporte ya está identificado y validado
     * por el backend dentro de una raíz autorizada.
     *
     * Para visualización no descargamos el PDF ni
     * generamos Blob URLs: abrimos directamente
     * la vista del archivo en Google Drive.
     */
    const url =
      webViewLink
      ??
      `https://drive.google.com/file/d/${encodeURIComponent(
        driveFileId,
      )}/view`;


    window.open(
      url,
      '_blank',
      'noopener,noreferrer',
    );
  }


  async function searchBillingAuditDriveEvidence() {
    if (
      !billingAudit
      ||
      !organizationId
      ||
      !canManageBillingAudit
      ||
      billingAuditDriveSearching
    ) {
      return;
    }

    const auditId =
      billingAudit.id;


    /*
     * Defensa de contrato.
     *
     * Nunca debemos producir:
     *
     * /authorization-billing-audits/undefined/...
     */
    if (
      typeof auditId !==
        'string'
      ||
      auditId.length ===
        0
    ) {
      setBillingAuditActionError(
        'La auditoría aún no está inicializada. Inicia la auditoría antes de buscar soportes.',
      );

      return;
    }


    setBillingAuditDriveSearching(
      true,
    );

    setBillingAuditActionError(
      null,
    );

    try {
      const refreshedAudit =
        await searchAuthorizationBillingAuditDriveEvidence(
          organizationId,
          auditId,
        );

      setBillingAudit(
        (current) =>
          current?.id === auditId
            ? refreshedAudit
            : current,
      );
    } catch (
      cause
    ) {
      setBillingAuditActionError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible buscar el soporte en Google Drive.',
      );
    } finally {
      setBillingAuditDriveSearching(
        false,
      );
    }
  }


  async function decideBillingAudit() {
    if (
      !selected
      ||
      !billingAuditDecisionResult
    ) {
      return;
    }

    if (
      selected.operationalStatus !==
        'CLOSED'
    ) {
      setBillingAuditActionError(
        'La auditoría solo puede registrarse cuando la AUTO está cerrada.',
      );

      return;
    }

    const observation =
      billingAuditObservation.trim();

    const evidenceCount =
      billingAudit?.evidence?.length
      ??
      selected.billingAuditEvidenceCount
      ??
      0;

    if (
      (
        billingAuditDecisionResult ===
          'DOES_NOT_COMPLY'
        ||
        evidenceCount ===
          0
      )
      &&
      observation.length ===
        0
    ) {
      setBillingAuditActionError(
        evidenceCount ===
          0
          ? 'La observación es obligatoria cuando la auditoría no tiene soportes.'
          : 'La observación es obligatoria cuando la AUTO no cumple.',
      );

      return;
    }

    setBillingAuditActionError(
      null,
    );

    setBillingAuditDecisionSaving(
      true,
    );

    try {
      /*
       * El estado visual PENDING puede existir en el read-model
       * aunque aún no exista authorization_billing_audits.
       *
       * /start es idempotente y materializa/recupera la
       * auditoría técnica necesaria antes de decidir.
       */
      const persistedAudit =
        await startAuthorizationBillingAudit(
          organizationId,
          selected.id,
        );

      if (
        persistedAudit.status ===
          'REVIEWED'
      ) {
        setBillingAudit(
          persistedAudit,
        );

        const refreshed =
          await getAuthorizationQueryItem(
            organizationId,
            selected.id,
          );

        setSelected(
          refreshed,
        );

        query.reload();

        setBillingAuditActionError(
          'La auditoría ya había sido revisada.',
        );

        return;
      }

      const decidedAudit =
        await decideAuthorizationBillingAudit(
          organizationId,
          persistedAudit.id,
          {
            result:
              billingAuditDecisionResult,

            observation:
              observation.length >
                0
                ? observation
                : null,
          },
        );

      setBillingAudit(
        decidedAudit,
      );

      /*
       * Refrescamos el read-model canónico para que:
       *
       * - tabla principal
       * - resumen
       * - pestaña Auditoría
       *
       * reflejen exactamente el mismo estado.
       */
      const refreshed =
        await getAuthorizationQueryItem(
          organizationId,
          selected.id,
        );

      setSelected(
        refreshed,
      );

      setBillingAuditDecisionResult(
        '',
      );

      setBillingAuditObservation(
        '',
      );

      query.reload();
    } catch (
      cause
    ) {
      setBillingAuditActionError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible guardar la decisión de auditoría.',
      );
    } finally {
      setBillingAuditDecisionSaving(
        false,
      );
    }
  }



  async function loadAuthorizationHistory(
    authorizationItemId:
      string,
  ) {
    setAuthorizationHistoryLoading(
      true,
    );

    setAuthorizationHistoryError(
      null,
    );

    try {
      const response =
        await getAuthorizationHistory(
          organizationId,
          authorizationItemId,
        );

      setAuthorizationHistory(
        response.items,
      );
    } catch (
      cause
    ) {
      setAuthorizationHistory(
        [],
      );

      setAuthorizationHistoryError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible consultar el historial de la autorización.',
      );
    } finally {
      setAuthorizationHistoryLoading(
        false,
      );
    }
  }


  const canFulfillSelected =
    Boolean(
      selected &&
      canFulfill &&
      (
        selected.operationalStatus ===
          'ASSIGNED'
        ||
        selected.operationalStatus ===
          'PARTIALLY_ASSIGNED'
      ) &&
      selected.remainingAuthorizedQuantity >
        0 &&
      selected.remainingAssignedQuantity >
        0 &&
      selectedActivePurchaseOrders.length >
        0,
    );


  const selectedPurchaseOrderContext =
    selected
      ? authorizationPurchaseOrderContext(
          selected,
        )
      : null;


  return (
    <>
      <PageHeader
        title="Consulta de Autorizaciones"
        description="Consulta las autorizaciones registradas y su estado actual."
        actions={
          <>
            {hasPermission(
              'operational_exports.create',
            ) ? (
              <button
                type="button"
                className="btn"
                disabled={
                  exportingAuthorizations
                }
                onClick={() => {
                  void exportAuthorizations();
                }}
              >
                {
                  exportingAuthorizations
                    ? 'Generando…'
                    : 'Exportar autorizaciones'
                }
              </button>
            ) : null}

          </>
        }
      />



      <Card className="operational-list-workspace authorization-query-workspace">
<CardBody>
          <FilterBar>
            <FilterField label="Autorización">
              <input
                className="control"
                value={filters.authorizationNumber}
                onChange={(event) =>
                  setFilters({
                    ...filters,

                    authorizationNumber: event.target.value,
                  })
                }
                placeholder="Número o clave de autorización"
              />
            </FilterField>

            <FilterField label="Producto">
              <input
                className="control"
                value={filters.commercialCode}
                onChange={(event) =>
                  setFilters({
                    ...filters,

                    commercialCode: event.target.value,
                  })
                }
                placeholder="Código comercial"
              />
            </FilterField>

            <FilterField label="Paciente">
              <input
                className="control"
                value={filters.patient}
                onChange={(event) =>
                  setFilters({
                    ...filters,

                    patient: event.target.value,
                  })
                }
                placeholder="Nombre o documento"
              />
            </FilterField>

            <FilterField label="Habilitación">
              <select
                className="control"
                value={filters.lifecycleEnablement}
                onChange={(event) =>
                  setFilters({
                    ...filters,

                    lifecycleEnablement:
                      event.target.value,
                  })
                }
              >
                <option value="">
                  Todas
                </option>

                <option value="ENABLED">
                  Habilitada
                </option>

                <option value="PENDING">
                  Pendiente
                </option>

                <option value="DISABLED">
                  Inhabilitada
                </option>
              </select>
            </FilterField>

            <FilterField label="Estado">
              <select
                className="control"
                value={
                  filters.status
                }
                onChange={(
                  event,
                ) =>
                  setFilters({
                    ...filters,

                    status:
                      event.target.value as AuthorizationUnifiedStatus,
                  })
                }
              >
                <option value="">
                  Todos
                </option>

                <option value="UNASSIGNED">
                  Sin asignar
                </option>

                <option value="PARTIALLY_ASSIGNED">
                  Parcialmente asignada
                </option>

                <option value="ASSIGNED">
                  Lista para entrega/aplicación
                </option>

                <option value="APPLICATION_PENDING">
                  Con aplicación pendiente
                </option>

                <option value="OUT_OF_OPERATION">
                  Fuera de operación
                </option>

                <option value="CLOSED">
                  Cerrada
                </option>
              </select>
            </FilterField>

            <FilterActions>
              <button
                type="button"
                className="btn primary"
                onClick={applyFilters}
              >
                Filtrar
              </button>

              <button
                type="button"
                className="btn"
                onClick={clearFilters}
              >
                Limpiar
              </button>
            </FilterActions>
          </FilterBar>

          <div className="table-wrap">
            <table
              className="authorization-query-table"
              style={{
                width: '100%',
                minWidth: 0,
                tableLayout: 'fixed',
              }}
            >
              <colgroup>
                <col style={{ width: '11%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '4%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '6%' }} />
              </colgroup>

              <thead>
                <tr>
                  <th>Autorización</th>

                  <th>Paciente</th>

                  <th>Producto</th>

                  <th>Cant.</th>

                  <th>Vigencia</th>

                  <th>Habilitación</th>

                  <th>Estado operativo</th>

                  <th>Validación</th>

                  <th>Auditoría</th>

                  <th
                    style={{
                      position: 'sticky',
                      right: 0,
                      zIndex: 2,
                      background: 'inherit',
                      textAlign: 'center',
                    }}
                  >
                    Acción
                  </th>
                </tr>
              </thead>

              <tbody>
                {showAuthorizationLoading ? (
                  <TableLoadingRow
                    colSpan={10}
                    label="Cargando autorizaciones"
                  />
                ) : (

                  <>

                {(data?.items ?? []).map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>
                        {item.authorizationNumber}
                      </strong>
                    </td>

                    <td>
                      <div className="authorization-cell-stack">
                        <strong>
                          {item.patientName ?? 'Sin nombre'}
                        </strong>

                        <span>
                          {item.patientDocument ?? 'Sin documento'}
                        </span>
                      </div>
                    </td>

                    <td>
                      <div className="authorization-cell-stack">
                        <strong>
                          {item.productDescription ??
                            'Sin nombre de producto'}
                        </strong>

                        <span>
                          COD: {item.commercialCode}
                        </span>
                      </div>
                    </td>

                    <td>
                      <strong>
                        {item.quantity ?? '—'}
                      </strong>
                    </td>

                    <td>
                      <div className="authorization-cell-stack">
                        <strong>
                          {validityLabel(
                            item.validityStatus,
                          )}
                        </strong>

                        <span>
                          {item.validityStatus ===
                          'OUTSIDE_HORIZON'
                            ? `Inicia: ${authorizationDateLabel(
                                item.assignmentDate,
                              )}`
                            : item.validityStatus ===
                                'EXPIRED'
                              ? `Venció: ${authorizationDateLabel(
                                  item.validityEndDate,
                                )}`
                              : item.validityStatus ===
                                  'IN_WINDOW'
                                ? `Vence: ${authorizationDateLabel(
                                    item.validityEndDate,
                                  )}`
                                : 'Fechas no válidas'}
                        </span>
                      </div>
                    </td>

                    <td
                      style={{
                        verticalAlign: 'middle',
                      }}
                    >
                      <div
                        className="authorization-cell-stack"
                        style={{
                          whiteSpace:
                            'normal',

                          lineHeight:
                            1.25,
                        }}
                      >
                        <strong>
                          {authorizationLifecycleLabel(
                            item,
                          )}
                        </strong>

                        <span
                          title={authorizationLifecycleReasonText(
                            item,
                          )}
                        >
                          {authorizationLifecycleReasonText(
                            item,
                          )}
                        </span>
                      </div>
                    </td>

                    <td
                      style={{
                        verticalAlign: 'middle',
                        overflow: 'hidden',
                      }}
                    >
                      <span
                        className={`authorization-operational-status ${item.operationalStatus.toLowerCase()}`}
                        style={{
                          whiteSpace: 'normal',
                          lineHeight: 1.25,
                          maxWidth: '100%',
                          textAlign: 'left',
                        }}
                      >
                        {authorizationOperationalLabel(
                          item,
                        )}
                      </span>
                    </td>

                    <td
                      style={{
                        verticalAlign: 'middle',
                        paddingLeft: '20px',
                      }}
                    >
                      <strong>
                        {initialValidationLabel(
                          item.initialValidationStatus,
                        )}
                      </strong>
                    </td>

                    <td>
                      <strong>
                        {billingAuditColumnLabel(item)}
                      </strong>
                    </td>

                    <td
                      style={{
                        position: 'sticky',
                        right: 0,
                        zIndex: 1,
                        background: 'white',
                        textAlign: 'center',
                      }}
                    >
                      <button
                        type="button"
                        className="button"
                        onClick={() => {
                          void openDetail(item);
                        }}
                      >
                        Ver
                      </button>
                    </td>
                  </tr>
                ))}

                {!query.loading &&
                (data?.items.length ?? 0) ===
                  0 ? (
                  <tr>
                    <td colSpan={9}>
                      <div className="table-empty-state">
                        <strong>
                          Sin resultados
                        </strong>

                        <span>
                          No existen autorizaciones con los filtros seleccionados.
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : null}

                  </>
                )}
              </tbody>
            </table>
          </div>

          <div className="authorization-query-pagination list-pagination">
            <div className="authorization-query-pagination-summary">
              <span>
                {showAuthorizationLoading
                  ? 'Mostrando —'
                  : data
                    ? `Mostrando ${firstVisible}–${lastVisible} de ${data.total}`
                    : 'Mostrando —'}
              </span>

              <label className="authorization-query-page-size-field">
                <span>
                  Filas
                </span>

                <select
                  className="control authorization-query-page-size"
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(
                      Number(
                        event.target.value,
                      ),
                    );

                    setPage(1);
                  }}
                >
                  <option value={10}>
                    10
                  </option>

                  <option value={25}>
                    25
                  </option>

                  <option value={50}>
                    50
                  </option>

                  <option value={100}>
                    100
                  </option>
                </select>
              </label>
            </div>

            <div className="authorization-query-pagination-controls">
              <button
                type="button"
                className="btn"
                disabled={
                  page <= 1 ||
                  showAuthorizationLoading
                }
                onClick={() =>
                  setPage(
                    (current) =>
                      Math.max(
                        current - 1,
                        1,
                      ),
                  )
                }
              >
                Anterior
              </button>

              <strong>
                Página {page} de {totalPages}
              </strong>

              <button
                type="button"
                className="btn"
                disabled={
                  page >= totalPages ||
                  showAuthorizationLoading
                }
                onClick={() =>
                  setPage(
                    (current) =>
                      Math.min(
                        current + 1,
                        totalPages,
                      ),
                  )
                }
              >
                Siguiente
              </button>
            </div>
          </div>
        </CardBody>
      </Card>

      {selected ? (
        <div
          className={`operation-drawer-backdrop authorization-detail-backdrop ${
            authorizationDrawerVisible
              ? 'is-visible'
              : ''
          }`}
          onMouseDown={
            closeAuthorizationDetail
          }
        >
          <aside
            className={`operation-drawer authorization-detail-drawer ${
              authorizationDrawerVisible
                ? 'is-visible'
                : ''
            }`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="operation-drawer-header">
              <div className="authorization-drawer-heading">
                <span>
                  Autorización
                </span>

                <h2>
                  {selected.authorizationNumber}
                </h2>

                <div className="authorization-header-badges">
                  <strong
                    className={`authorization-operational-status ${selected.operationalStatus.toLowerCase()}`}
                  >
                    {authorizationOperationalLabel(
                      selected,
                    )}
                  </strong>

                  <strong className="authorization-coverage-badge">
                    {selected.coverageType}
                  </strong>
                </div>
              </div>

              <div className="authorization-drawer-actions">
                {canManualEdit && !managingAuthorization ? (
                  editingAuthorization ? (
                    <>
                      <button
                        type="button"
                        className="btn authorization-drawer-action"
                        disabled={savingAuthorizationEdit}
                        onClick={cancelManualEdit}
                      >
                        Cancelar
                      </button>

                      <button
                        type="button"
                        className="btn primary authorization-drawer-action"
                        disabled={savingAuthorizationEdit}
                        onClick={() => {
                          void saveManualEdit();
                        }}
                      >
                        {savingAuthorizationEdit
                          ? 'Guardando…'
                          : 'Guardar'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn authorization-drawer-action"
                      onClick={beginManualEdit}
                    >
                      Editar
                    </button>
                  )
                ) : null}

                <button
                  type="button"
                  className="operation-close"
                  aria-label="Cerrar detalle"
                  onClick={
                    closeAuthorizationDetail
                  }
                >
                  ×
                </button>
              </div>
            </div>


            <div
              className="authorization-drawer-tabs"
              role="tablist"
              aria-label="Vista de autorización"
            >
              <button
                type="button"
                role="tab"
                aria-selected={
                  !managingAuthorization &&
                  !viewingHistory &&
                  !viewingBillingAudit
                }
                className={
                  !managingAuthorization &&
                  !viewingHistory &&
                  !viewingBillingAudit
                    ? 'active'
                    : ''
                }
                onClick={() => {
                  setManagingAuthorization(
                    false,
                  );

                  setViewingHistory(
                    false,
                  );

                  setViewingBillingAudit(
                    false,
                  );

                  setFulfillmentDate(
                    '',
                  );

                  setFulfillmentQuantity(
                    '',
                  );

                  setFulfillmentError(
                    null,
                  );
                }}
              >
                Resumen
              </button>

              {canFulfill ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={
                    managingAuthorization &&
                    !viewingHistory &&
                    !viewingBillingAudit
                  }
                  className={
                    managingAuthorization &&
                    !viewingHistory &&
                    !viewingBillingAudit
                      ? 'active'
                      : ''
                  }
                  disabled={
                    editingAuthorization
                  }
                  title={
                    editingAuthorization
                      ? 'Guarda o cancela la edición antes de cambiar de vista.'
                      : undefined
                  }
                  onClick={() => {
                    if (
                      editingAuthorization
                    ) {
                      return;
                    }

                    setManagingAuthorization(
                      true,
                    );

                    setViewingHistory(
                    false,
                  );

                  setViewingBillingAudit(
                    false,
                  );

                    setFulfillmentType(
                      'APPLICATION',
                    );

                    setFulfillmentDate(
                      '',
                    );

                    setFulfillmentQuantity(
                      String(
                        selectedFulfillmentMaxQuantity,
                      ),
                    );

                    setFulfillmentError(
                      null,
                    );
                  }}
                >
                  Gestionar entrega / aplicación
                </button>
              ) : null}
              {canReadBillingAudit ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={
                    viewingBillingAudit
                  }
                  className={
                    viewingBillingAudit
                      ? 'active'
                      : ''
                  }
                  disabled={
                    editingAuthorization
                  }
                  title={
                    editingAuthorization
                      ? 'Guarda o cancela la edición antes de cambiar de vista.'
                      : undefined
                  }
                  onClick={() => {
                    if (
                      editingAuthorization
                    ) {
                      return;
                    }

                    setManagingAuthorization(
                      false,
                    );

                    setViewingHistory(
                      false,
                    );

                    setViewingBillingAudit(
                      true,
                    );

                    setBillingAuditError(
                      null,
                    );

                    void loadBillingAudit(
                      selected.id,
                    );
                  }}
                >
                  Auditoría
                </button>
              ) : null}


              <button
                type="button"
                role="tab"
                aria-selected={
                  viewingHistory
                }
                className={
                  viewingHistory
                    ? 'active'
                    : ''
                }
                disabled={
                  editingAuthorization
                }
                title={
                  editingAuthorization
                    ? 'Guarda o cancela la edición antes de cambiar de vista.'
                    : undefined
                }
                onClick={() => {
                  if (
                    editingAuthorization
                  ) {
                    return;
                  }

                  setManagingAuthorization(
                    false,
                  );

                  setViewingHistory(
                    true,
                  );

                  setViewingBillingAudit(
                    false,
                  );

                  void loadAuthorizationHistory(
                    selected.id,
                  );

                  setFulfillmentError(
                    null,
                  );
                }}
              >
                Historial
              </button>
            </div>


            {viewingBillingAudit ? (
              <>
                {billingAuditLoading ? (
                  <div className="authorization-history-empty">
                    Cargando auditoría…
                  </div>
                ) : billingAuditError ? (
                  <div
                    className="authorization-fulfillment-error"
                    role="alert"
                  >
                    {billingAuditError}
                  </div>
                ) : billingAudit ? (
                  <>
                    <div
                      style={{
                        display:
                          'grid',

                        gridTemplateColumns:
                          billingAudit.status ===
                            'REVIEWED'
                            ? 'repeat(3, minmax(0, 1fr))'
                            : 'repeat(2, minmax(0, 1fr))',

                        gap:
                          '20px',

                        padding:
                          '8px 0 16px',

                        marginBottom:
                          '16px',

                        borderBottom:
                          '1px solid var(--border-color, #e2e7ef)',
                      }}
                    >
                      <div>
                        <span
                          style={{
                            display:
                              'block',

                            fontSize:
                              '12px',

                            opacity:
                              0.65,

                            marginBottom:
                              '2px',
                          }}
                        >
                          Estado
                        </span>

                        <strong>
                          {billingAuditStatusLabel(billingAudit.status)}
                        </strong>
                      </div>

                      <div>
                        <span
                          style={{
                            display:
                              'block',

                            fontSize:
                              '12px',

                            opacity:
                              0.65,

                            marginBottom:
                              '2px',
                          }}
                        >
                          Resultado
                        </span>

                        <strong>
                          {billingAuditResultLabel(
                            billingAudit.result,
                          )}
                        </strong>
                      </div>

                      <div>
                        <span
                          style={{
                            display:
                              'block',

                            fontSize:
                              '12px',

                            opacity:
                              0.65,

                            marginBottom:
                              '2px',
                          }}
                        >
                          Soportes
                        </span>

                        <strong>
                          {billingAuditEvidenceLabel(
                            (
                              billingAudit.evidence
                              ??
                              []
                            ).length,
                          )}
                        </strong>
                      </div>

                      <div>
                        <span
                          style={{
                            display:
                              'block',

                            fontSize:
                              '12px',

                            opacity:
                              0.65,

                            marginBottom:
                              '2px',
                          }}
                        >
                          Fecha de auditoría
                        </span>

                        <strong>
                          {dateTimeLabel(
                            billingAudit.auditedAt
                              ??
                              billingAudit.createdAt,
                          )}
                        </strong>
                      </div>

                      {billingAudit.status ===
                      'REVIEWED' ? (
                        <div>
                          <span
                            style={{
                              display:
                                'block',

                              fontSize:
                                '12px',

                              opacity:
                                0.65,

                              marginBottom:
                                '2px',
                            }}
                          >
                            Auditor
                          </span>

                          <strong>
                            {billingAudit.auditedByName
                              ??
                              billingAudit.auditedBy
                              ??
                              '—'}
                          </strong>
                        </div>
                      ) : null}
                    </div>


                    {billingAuditActionError ? (
                      <div
                        className="authorization-fulfillment-error"
                        role="alert"
                        style={{
                          marginBottom:
                            '16px',
                        }}
                      >
                        {billingAuditActionError}
                      </div>
                    ) : null}


                    <div
                      style={{
                        display:
                          'grid',

                        gridTemplateColumns:
                          'minmax(0, 1.05fr) minmax(300px, 0.95fr)',

                        gap:
                          '14px',

                        alignItems:
                          'stretch',
                      }}
                    >
                      <section
                        style={{
                          border:
                            '1px solid var(--border-color, #dfe4ec)',

                          borderRadius:
                            '12px',

                          padding:
                            '14px',

                          minWidth:
                            0,


                            order:
                              2,
}}
                      >
                        <div
                          style={{
                            display:
                              'flex',

                            alignItems:
                              'center',

                            justifyContent:
                              'space-between',

                            gap:
                              '12px',

                            marginBottom:
                              '14px',
                          }}
                        >
                          <div>
                            <strong>
                              Soportes
                            </strong>

                            <div
                              style={{
                                marginTop:
                                  '2px',

                                fontSize:
                                  '12px',

                                opacity:
                                  0.65,
                              }}
                            >
                              PDF asociados a la auditoría.
                            </div>
                          </div>

                          {canManageBillingAudit ? (
                            <button
                              type="button"
                              className="btn"
                              disabled={
                                billingAuditDriveSearching
                                ||
                                billingAuditDecisionSaving
                              }
                              onClick={() => {
                                void searchBillingAuditDriveEvidence();
                              }}
                            >
                              {billingAuditDriveSearching
                                ? 'Buscando…'
                                : 'Buscar en Drive'}
                            </button>
                          ) : null}
                        </div>


                        {(billingAudit.evidence ?? []).length ===
                        0 ? (
                          <div
                            style={{
                              padding:
                                '18px 0',

                              opacity:
                                0.68,
                            }}
                          >
                            Sin soportes asociados a esta autorización.
                          </div>
                        ) : (
                          <div
                            style={{
                              display:
                                'grid',

                              gap:
                                '10px',
                            }}
                          >
                            {(billingAudit.evidence ?? []).map(
                              (
                                evidence,
                              ) => (
                                <div
                                  key={
                                    evidence.id
                                  }
                                  style={{
                                    display:
                                      'flex',

                                    alignItems:
                                      'center',

                                    justifyContent:
                                      'space-between',

                                    gap:
                                      '12px',

                                    padding:
                                      '10px 12px',

                                    border:
                                      '1px solid var(--border-color, #e3e7ee)',

                                    borderRadius:
                                      '10px',

                                    minWidth:
                                      0,
                                  }}
                                >
                                  <div
                                    style={{
                                      minWidth:
                                        0,
                                    }}
                                  >
                                    <strong
                                      style={{
                                        display:
                                          'block',

                                        overflow:
                                          'hidden',

                                        textOverflow:
                                          'ellipsis',

                                        whiteSpace:
                                          'nowrap',
                                      }}
                                    >
                                      {evidence.fileName}
                                    </strong>

                                    <span
                                      style={{
                                        display:
                                          'block',

                                        marginTop:
                                          '3px',

                                        fontSize:
                                          '12px',

                                        opacity:
                                          0.65,
                                      }}
                                    >
                                      PDF · Google Drive
                                    </span>
                                  </div>

                                  <button
                                    type="button"
                                    className="btn"
                                    onClick={() => {
                                      openBillingAuditEvidence(
                                        evidence.webViewLink,
                                        evidence.driveFileId,
                                      );
                                    }}
                                  >
                                    Ver PDF
                                  </button>
                                </div>
                              ),
                            )}
                          </div>
                        )}

                      </section>


                      {billingAudit.status ===
                      'REVIEWED' ? (
                        <section
                          style={{
                            border:
                              '1px solid var(--border-color, #dfe4ec)',

                            borderRadius:
                              '12px',

                            padding:
                              '16px',

                            height:
                              '100%',


                            order:
                              1,
}}
                        >
                          <div
                            style={{
                              marginBottom:
                                '16px',
                            }}
                          >
                            <strong>
                              Resultado final
                            </strong>

                            <div
                              style={{
                                marginTop:
                                  '2px',

                                fontSize:
                                  '12px',

                                opacity:
                                  0.65,
                              }}
                            >
                              La auditoría está cerrada y no puede modificarse.
                            </div>
                          </div>

                          <div
                            style={{
                              fontSize:
                                '20px',

                              fontWeight:
                                700,

                              marginBottom:
                                '18px',
                            }}
                          >
                            {billingAudit.result ===
                            'COMPLIES'
                              ? '✓ Cumple'
                              : billingAudit.result ===
                                  'DOES_NOT_COMPLY'
                                ? '✕ No cumple'
                                : '—'}
                          </div>

                          <div>
                            <span
                              style={{
                                display:
                                  'block',

                                fontSize:
                                  '12px',

                                opacity:
                                  0.65,

                                marginBottom:
                                  '4px',
                              }}
                            >
                              Observación
                            </span>

                            <div
                              style={{
                                lineHeight:
                                  1.5,

                                whiteSpace:
                                  'pre-wrap',
                              }}
                            >
                              {billingAudit.observation
                                ??
                                'Sin observación.'}
                            </div>
                          </div>
                        </section>
                      ) : canManageBillingAudit ? (
                        <section
                          style={{
                            border:
                              '1px solid var(--border-color, #dfe4ec)',

                            borderRadius:
                              '12px',

                            padding:
                              '16px',


                            order:
                              1,
}}
                        >
                          <div
                            style={{
                              marginBottom:
                                '16px',
                            }}
                          >
                            <strong>
                              Registrar decisión
                            </strong>

                            <div
                              style={{
                                marginTop:
                                  '2px',

                                fontSize:
                                  '12px',

                                opacity:
                                  0.65,
                              }}
                            >
                              Define el resultado de la auditoría.
                            </div>
                          </div>


                          <div
                            style={{
                              marginBottom:
                                '16px',
                            }}
                          >
                            <span
                              style={{
                                display:
                                  'block',

                                fontSize:
                                  '12px',

                                fontWeight:
                                  600,

                                marginBottom:
                                  '8px',
                              }}
                            >
                              Resultado
                            </span>

                            <div
                              style={{
                                display:
                                  'grid',

                                gridTemplateColumns:
                                  '1fr 1fr',

                                gap:
                                  '8px',
                              }}
                            >
                              <button
                                type="button"
                                className={
                                  billingAuditDecisionResult ===
                                    'COMPLIES'
                                    ? 'btn primary'
                                    : 'btn'
                                }
                                aria-pressed={
                                  billingAuditDecisionResult ===
                                  'COMPLIES'
                                }
                                disabled={
                                  billingAuditDecisionSaving
                                }
                                onClick={() => {
                                  setBillingAuditDecisionResult(
                                    'COMPLIES',
                                  );

                                  setBillingAuditActionError(
                                    null,
                                  );
                                }}
                              >
                                ✓ Cumple
                              </button>

                              <button
                                type="button"
                                className={
                                  billingAuditDecisionResult ===
                                    'DOES_NOT_COMPLY'
                                    ? 'btn primary'
                                    : 'btn'
                                }
                                aria-pressed={
                                  billingAuditDecisionResult ===
                                  'DOES_NOT_COMPLY'
                                }
                                disabled={
                                  billingAuditDecisionSaving
                                }
                                onClick={() => {
                                  setBillingAuditDecisionResult(
                                    'DOES_NOT_COMPLY',
                                  );

                                  setBillingAuditActionError(
                                    null,
                                  );
                                }}
                              >
                                ✕ No cumple
                              </button>
                            </div>
                          </div>


                          <label
                            style={{
                              display:
                                'grid',

                              gap:
                                '6px',

                              marginBottom:
                                '16px',
                            }}
                          >
                            <span
                              style={{
                                fontSize:
                                  '12px',

                                fontWeight:
                                  600,
                              }}
                            >
                              Observación
                              {billingAuditDecisionResult ===
                              'DOES_NOT_COMPLY'
                                ? ' *'
                                : ''}
                            </span>

                            <textarea
                              className="control"
                              rows={4}
                              maxLength={4000}
                              value={
                                billingAuditObservation
                              }
                              disabled={
                                billingAuditDecisionSaving
                              }
                              placeholder={
                                (billingAudit.evidence ?? []).length ===
                                0
                                  ? 'Observación obligatoria: justifica la decisión sin soportes.'
                                  : billingAuditDecisionResult ===
                                      'DOES_NOT_COMPLY'
                                    ? 'Describe por qué la AUTO no cumple.'
                                    : 'Observación opcional.'
                              }
                              onChange={(event) => {
                                setBillingAuditObservation(
                                  event.target.value,
                                );

                                setBillingAuditActionError(
                                  null,
                                );
                              }}
                            />

                            {(billingAudit.evidence ?? []).length ===
                            0 ? (
                              <span
                                style={{
                                  display:
                                    'block',

                                  marginTop:
                                    '8px',

                                  fontSize:
                                    '12px',

                                  opacity:
                                    0.72,
                                }}
                              >
                                Esta auditoría no tiene soportes; la observación es obligatoria.
                              </span>
                            ) : null}

                            {billingAuditDecisionResult ===
                            'DOES_NOT_COMPLY' ? (
                              <span
                                style={{
                                  fontSize:
                                    '12px',

                                  opacity:
                                    0.7,
                                }}
                              >
                                Obligatoria para No cumple o cuando la auditoría no tiene soportes.
                              </span>
                            ) : null}
                          </label>


                          <div
                            style={{
                              display:
                                'flex',

                              justifyContent:
                                'flex-end',
                            }}
                          >
                            <button
                              type="button"
                              className="btn primary"
                              disabled={
                                billingAuditDecisionSaving
                                ||
                                !billingAuditDecisionResult
                                ||
                                (
                                  (
                                    billingAuditDecisionResult ===
                                      'DOES_NOT_COMPLY'
                                    ||
                                    (billingAudit.evidence ?? []).length ===
                                      0
                                  )
                                  &&
                                  !billingAuditObservation.trim()
                                )
                              }
                              onClick={() => {
                                void decideBillingAudit();
                              }}
                            >
                              {billingAuditDecisionSaving
                                ? 'Guardando…'
                                : 'Confirmar decisión'}
                            </button>
                          </div>
                        </section>
                      ) : (
                        <section
                          style={{
                            border:
                              '1px solid var(--border-color, #dfe4ec)',

                            borderRadius:
                              '12px',

                            padding:
                              '16px',
                          }}
                        >
                          <strong>
                        {billingAuditColumnLabel(selected)}
                      </strong>

                          <p
                            style={{
                              margin:
                                '6px 0 0',

                              opacity:
                                0.7,
                            }}
                          >
                            No tienes permisos para registrar la decisión.
                          </p>
                        </section>
                      )}
                    </div>
                  </>
                ) : (
                  <section
                    style={{
                      border:
                        '1px solid var(--border-color, #dfe4ec)',

                      borderRadius:
                        '12px',

                      padding:
                        '20px',

                      display:
                        'flex',

                      alignItems:
                        'center',

                      justifyContent:
                        'space-between',

                      gap:
                        '16px',
                    }}
                  >
                    <div>
                      <strong>
                        Auditoría pendiente
                      </strong>

                      <p
                        style={{
                          margin:
                            '4px 0 0',

                          opacity:
                            0.7,
                        }}
                      >
                        {selected.operationalStatus ===
                        'CLOSED'
                          ? 'La AUTO está pendiente de auditoría y no tiene soportes registrados.'
                          : 'La AUTO debe estar cerrada antes de realizar la auditoría de facturación.'}
                      </p>
                    </div>

                  </section>
                )}
              </>) : viewingHistory ? (
              <>
                <div className="authorization-summary-section-heading">
                  <strong>
                    Historial
                  </strong>

                  <span>
                    Acciones y movimientos registrados sobre esta autorización.
                  </span>
                </div>

                {authorizationHistoryLoading ? (
                  <div className="authorization-history-empty">
                    Cargando historial…
                  </div>
                ) : authorizationHistoryError ? (
                  <div
                    className="authorization-fulfillment-error"
                    role="alert"
                  >
                    {authorizationHistoryError}
                  </div>
                ) : authorizationHistory.length ===
                  0 ? (
                  <div className="authorization-history-empty">
                    No existen eventos registrados para esta autorización.
                  </div>
                ) : (
                  <div className="authorization-history-list">
                    {authorizationHistory.map(
                      (
                        event,
                        index,
                      ) => (
                        <article
                          key={
                            event.id
                          }
                          className="authorization-history-card"
                        >
                          <div className="authorization-history-card-rail">
                            <span className="authorization-history-dot" />

                            {index <
                            authorizationHistory.length -
                              1 ? (
                              <span className="authorization-history-line" />
                            ) : null}
                          </div>

                          <div className="authorization-history-card-content">
                            <div className="authorization-history-card-header">
                              <div>
                                <strong>
                                  {event.title}
                                </strong>

                                <span>
                                  {dateTimeLabel(
                                    event.occurredAt,
                                  )}
                                </span>
                              </div>

                              <span className="authorization-history-event-type">
                                {event.type ===
                                'AUTHORIZATION_CREATED'
                                  ? 'Autorización'
                                  : event.type ===
                                      'PURCHASE_ORDER_LINKED'
                                    ? 'Orden de compra'
                                    : event.type ===
                                        'PRODUCT_RECEIVED'
                                      ? 'Recepción'
                                      : event.type ===
                                          'INVENTORY_ASSIGNED'
                                        ? 'Asignación'
                                        : event.type ===
                                              'REASSIGNMENT_OUT' ||
                                            event.type ===
                                              'REASSIGNMENT_IN'
                                          ? 'Reasignación'
                                          : event.type ===
                                                'APPLICATION_RECORDED'
                                            ? 'Aplicación'
                                            : event.type ===
                                                  'DELIVERY_RECORDED'
                                              ? 'Entrega'
                                              : 'Acción'}
                              </span>
                            </div>

                            <p className="authorization-history-description">
                              {event.description}
                            </p>

                            {event.details.length >
                            0 ? (
                              <div className="authorization-history-details">
                                {event.details.map(
                                  (
                                    detail,
                                    detailIndex,
                                  ) => (
                                    <div
                                      key={`${event.id}:${detail.label}:${detailIndex}`}
                                    >
                                      <span>
                                        {detail.label}
                                      </span>

                                      <strong>
                                        {detail.value}
                                      </strong>
                                    </div>
                                  ),
                                )}
                              </div>
                            ) : null}

                            {event.actorName ||
                            event.organizationCode ? (
                              <div className="authorization-history-actor">
                                Registrado por{' '}
                                <strong>
                                  {event.actorName ??
                                    'Sistema'}
                                </strong>

                                {event.organizationCode
                                  ? ` · ${event.organizationCode}`
                                  : ''}
                              </div>
                            ) : null}
                          </div>
                        </article>
                      ),
                    )}
                  </div>
                )}
              </>
            ) : !managingAuthorization ? (
              <>
                <div
                  ref={summaryTopRef}
                  className="authorization-summary-top-anchor"
                />
                {fulfillmentSuccess ? (
                  <div
                    className="authorization-fulfillment-success"
                    role="status"
                    aria-live="polite"
                  >
                    <div
                      className="authorization-fulfillment-success-icon"
                      aria-hidden="true"
                    >
                      ✓
                    </div>

                    <div className="authorization-fulfillment-success-copy">
                      <strong>
                        {fulfillmentSuccess.type ===
                        'APPLICATION'
                          ? 'Aplicación registrada correctamente'
                          : 'Entrega registrada correctamente'}
                      </strong>

                      <span>
                        {fulfillmentSuccess.quantity}{' '}
                        unidad(es) registradas
                        {' · '}
                        Fecha efectiva:{' '}
                        {authorizationDateLabel(
                          fulfillmentSuccess.effectiveDate,
                        )}
                      </span>
                    </div>

                    <button
                      type="button"
                      className="authorization-fulfillment-success-close"
                      aria-label="Cerrar confirmación"
                      onClick={() => {
                        setFulfillmentSuccess(
                          null,
                        );
                      }}
                    >
                      ×
                    </button>
                  </div>
                ) : null}

                <div className="authorization-summary-section-heading">
                  <strong>
                    Paciente
                  </strong>

                  <span>
                    ¿A quién corresponde esta autorización?
                  </span>
                </div>

                <div className="authorization-detail-grid authorization-summary-grid">
                  <div className="authorization-summary-span-3">
                    <span>
                      Paciente
                    </span>

                    <strong>
                      {selected.patientName ??
                        'Sin nombre registrado'}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Documento
                    </span>

                    <strong>
                      {selected.patientDocument ??
                        'Sin documento'}
                    </strong>
                  </div>
                </div>


                <div className="authorization-summary-section-heading">
                  <strong>
                    Medicamento
                  </strong>

                  <span>
                    ¿Qué producto y cantidad fueron autorizados?
                  </span>
                </div>

                <div className="authorization-detail-grid authorization-summary-grid authorization-summary-medication-grid">
                  <div>
                    <span>
                      Código
                    </span>

                    {editingAuthorization ? (
                      <input
                        className="control authorization-manual-edit-control"
                        value={authorizationEdit.commercialCode}
                        onChange={(event) => {
                          setAuthorizationEdit({
                            ...authorizationEdit,

                            commercialCode:
                              event.target.value,
                          });
                        }}
                        aria-label="Código de producto"
                      />
                    ) : (
                      <strong>
                        {selected.commercialCode}
                      </strong>
                    )}
                  </div>

                  <div className="authorization-summary-span-2">
                    <span>
                      Producto
                    </span>

                    <strong>
                      {selected.productDescription ??
                        'Sin nombre'}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Cantidad autorizada
                    </span>

                    {editingAuthorization ? (
                      <input
                        className="control authorization-manual-edit-control"
                        type="number"
                        min="1"
                        step="1"
                        value={authorizationEdit.quantity}
                        onChange={(event) => {
                          setAuthorizationEdit({
                            ...authorizationEdit,

                            quantity:
                              event.target.value,
                          });
                        }}
                        aria-label="Cantidad autorizada"
                      />
                    ) : (
                      <strong>
                        {selected.authorizedQuantity}
                      </strong>
                    )}
                  </div>
                </div>

                <div className="authorization-detail-grid authorization-summary-grid">
                  <div className="authorization-summary-span-2">
                    <span>
                      Posología
                    </span>

                    <strong>
                      {selected.dosage ??
                        'Sin posología registrada'}
                    </strong>
                  </div>
                  <div className="authorization-summary-span-2">
                    <span>
                      Atendido
                    </span>

                    <strong>
                      {selected.fulfilledQuantity}
                      {' / '}
                      {selected.authorizedQuantity}
                    </strong>
                  </div>

                </div>


                <div className="authorization-summary-section-heading">
                  <strong>
                    Habilitación
                  </strong>

                  <span>
                    ¿Puede operar actualmente?
                  </span>
                </div>

                <div className="authorization-detail-grid authorization-summary-grid">
                  <div>
                    <span>
                      Habilitación
                    </span>

                    <strong>
                      {authorizationLifecycleLabel(
                        selected,
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Validación inicial
                    </span>

                    <strong>
                      {initialValidationLabel(
                        selected.initialValidationStatus,
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Inicio
                    </span>

                    <strong>
                      {authorizationDateLabel(
                        selected.assignmentDate,
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Vencimiento
                    </span>

                    {editingAuthorization ? (
                      <input
                        className="control authorization-manual-edit-control"
                        type="date"
                        value={authorizationEdit.validityEndDate}
                        onChange={(event) => {
                          setAuthorizationEdit({
                            ...authorizationEdit,

                            validityEndDate:
                              event.target.value,
                          });
                        }}
                        aria-label="Fecha final de vigencia"
                      />
                    ) : (
                      <strong>
                        {authorizationDateLabel(
                          selected.validityEndDate,
                        )}
                      </strong>
                    )}
                  </div>
                </div>

                {selected.operationalStatus !==
                'CLOSED' ? (
                  <div
                    className={`authorization-summary-message ${selected.lifecycleEnablement.toLowerCase()}`}
                  >
                    <strong>
                      {
                        selected.lifecycleEnablement ===
                          'ENABLED'
                          ? 'Sin bloqueos'
                          : selected.lifecycleEnablement ===
                              'DISABLED'
                            ? 'Motivo de inhabilitación'
                            : 'Condición pendiente'
                      }
                    </strong>

                    <span>
                      {authorizationLifecycleReasonText(
                        selected,
                      )}
                    </span>
                  </div>
                ) : null}


                {authorizationEditError ? (
                  <div className="authorization-manual-edit-error">
                    {authorizationEditError}
                  </div>
                ) : null}


                <div className="authorization-summary-section-heading">
                  <strong>
                    Disponibilidad
                  </strong>

                  <span>
                    ¿Qué existe actualmente para atenderla?
                  </span>
                </div>

                <div className="authorization-detail-grid authorization-summary-grid">
                  <div>
                    <span>
                      Cantidad asignada
                    </span>

                    <strong>
                      {selected.allocatedQuantity}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Saldo asignado disponible
                    </span>

                    <strong>
                      {selected.remainingAssignedQuantity}
                    </strong>
                  </div>

                  <div>
                    <span>
                      OC relacionadas
                    </span>

                    {selected.purchaseOrders.length >
                      0 ? (
                      <div>
                        {selected.purchaseOrders.map(
                          (order) => (
                            <small
                              key={
                                order.id
                              }
                              style={{
                                display:
                                  'block',
                              }}
                            >
                              <strong>
                                {order.purchaseOrderCode}
                              </strong>
                              {' · '}
                              {order.sourceQuantity}
                              {' unidad(es) asociadas'}
                              {order.availableQuantity >
                                0
                                ? ` · ${order.availableQuantity} disponible(s)`
                                : ''}
                            </small>
                          ),
                        )}
                      </div>
                    ) : (
                      <strong>
                        Sin OC relacionada
                      </strong>
                    )}
                  </div>

                  <div>
                    <span>
                      Punto
                    </span>

                    <strong>
                      {selected.dispensingPointCode ??
                        'Sin punto'}
                    </strong>

                    {selected.dispensingPointName ? (
                      <small>
                        {selected.dispensingPointName}
                      </small>
                    ) : null}
                  </div>
                </div>

                {selected.operationalStatus !==
                  'CLOSED' &&
                selectedPurchaseOrderContext ? (
                  <div
                    className={`authorization-summary-oc-message ${selectedPurchaseOrderContext.kind}`}
                  >
                    {selectedPurchaseOrderContext.kind ===
                    'active' ? (
                      <strong
                        className="authorization-summary-oc-message-icon"
                        aria-hidden="true"
                      >
                        ✓
                      </strong>
                    ) : null}

                    <span>
                      {selectedPurchaseOrderContext.message}
                    </span>
                  </div>
                ) : null}


                <div className="authorization-summary-section-heading">
                  <strong>
                    Seguimiento
                  </strong>

                  <span>
                    Información complementaria del ciclo de la autorización.
                  </span>
                </div>

                <div className="authorization-detail-grid authorization-summary-grid">
                  <div>
                    <span>
                      Cuota moderadora
                    </span>

                    <strong>
                      {moderatorFeeLabel(
                        selected.moderatorFeeValue,
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Vigencia
                    </span>

                    <strong>
                      {validityLabel(
                        selected.validityStatus,
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Entrega / aplicación
                    </span>

                    <strong>
                      {fulfillmentStatusLabel(
                        selected,
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Auditoría
                    </span>

                    <strong>
                        {billingAuditColumnLabel(selected)}
                      </strong>
                  </div>
                </div>


                {!selected.operationalEligible &&
                selected.operationalStatus !==
                  'CLOSED' &&
                selected.operationalStatus !==
                  'ASSIGNED' &&
                selected.operationalStatus !==
                  'PARTIALLY_ASSIGNED' ? (
                  <div className="authorization-operation-message authorization-summary-operation-message">
                    Esta autorización se conserva visible para consulta,
                    pero actualmente no está habilitada para operaciones.
                    Revisa el motivo de habilitación antes de continuar.
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="authorization-summary-section-heading">
                  <strong>
                    Contexto de la operación
                  </strong>

                  <span>
                    Verifica paciente, producto y disponibilidad antes de registrar el cumplimiento.
                  </span>
                </div>

                <div className="authorization-detail-grid authorization-summary-grid authorization-management-context">
                  <div>
                    <span>
                      Paciente
                    </span>

                    <strong>
                      {selected.patientName ??
                        'Sin nombre registrado'}
                    </strong>

                    <small>
                      {selected.patientDocument ??
                        'Sin documento'}
                    </small>
                  </div>

                  <div>
                    <span>
                      Producto
                    </span>

                    <strong>
                      {selected.productDescription ??
                        selected.commercialCode}
                    </strong>

                    <small>
                      COD: {selected.commercialCode}
                    </small>
                  </div>

                  <div>
                    <span>
                      Posología
                    </span>

                    <strong>
                      {selected.dosage ??
                        'Sin posología registrada'}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Autorizado
                    </span>

                    <strong>
                      {selected.authorizedQuantity}
                    </strong>
                  </div>
                  <div>
                    <span>
                      Atendido
                    </span>

                    <strong>
                      {selected.fulfilledQuantity}
                      {' / '}
                      {selected.authorizedQuantity}
                    </strong>
                  </div>


                  <div>
                    <span>
                      Asignado disponible
                    </span>

                    <strong>
                      {selected.remainingAssignedQuantity}
                    </strong>

                    <small>
                      Punto: {selected.dispensingPointCode ?? 'Sin punto'}
                    </small>
                  </div>

                  <div>
                    <span>
                      Estado
                    </span>

                    <strong>
                      {fulfillmentStatusLabel(
                        selected,
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Cuota moderadora
                    </span>

                    <strong>
                      {moderatorFeeLabel(
                        selected.moderatorFeeValue,
                      )}
                    </strong>
                  </div>
                </div>


                <div className="operation-section-title">
                  Gestionar entrega / aplicación
                </div>

            {selected.operationalStatus ===
            'CLOSED' ? (
              <div className="authorization-closure-panel">
                <div className="authorization-closure-heading">
                  <div className="authorization-closure-check">
                    ✓
                  </div>

                  <div>
                    <strong>
                      Autorización cerrada
                    </strong>

                    <span>
                      La operación fue registrada correctamente.
                    </span>
                  </div>
                </div>

                <div className="authorization-closure-summary">
                  <div>
                    <span>
                      Tipo
                    </span>

                    <strong>
                      {fulfillmentTypeLabel(
                        selected.fulfillment
                          ?.type ??
                          null,
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Cantidad
                    </span>

                    <strong>
                      {selected.fulfillment
                        ?.quantity ??
                        '—'}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Fecha efectiva
                    </span>

                    <strong>
                      {authorizationDateLabel(
                        selected.fulfillment
                          ?.effectiveDate ??
                          null,
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Registrado
                    </span>

                    <strong>
                      {dateTimeLabel(
                        selected.fulfillment
                          ?.confirmedAt ??
                          null,
                      )}
                    </strong>
                  </div>
                </div>
              </div>
            ) : canFulfillSelected ? (
              <>
                {!managingAuthorization ? (
                  <div className="authorization-management-entry">
                    <p>
                      La autorización está disponible para que Medicarte registre su cumplimiento.
                    </p>

                    <button
                      type="button"
                      className="btn primary authorization-manage-button"
                      onClick={() => {
                        setManagingAuthorization(
                          true,
                        );

                        setFulfillmentType(
                          'APPLICATION',
                        );

                        setFulfillmentDate(
                          '',
                        );

                        const defaultPurchaseOrder =
                          selectedActivePurchaseOrders[0]
                          ??
                          null;

                        setFulfillmentPurchaseOrderCode(
                          defaultPurchaseOrder
                            ?.purchaseOrderCode
                          ??
                          '',
                        );

                        setFulfillmentQuantity(
                          String(
                            defaultPurchaseOrder
                              ? Math.min(
                                  selected.remainingAuthorizedQuantity,
                                  defaultPurchaseOrder.availableQuantity,
                                )
                              : 0,
                          ),
                        );

                        setFulfillmentError(
                          null,
                        );
                      }}
                    >
                      Gestionar autorización
                    </button>
                  </div>
                ) : (
                  <div className="authorization-fulfillment-form">
                    <div className="authorization-management-heading">
                      <strong>
                        ¿Qué deseas registrar?
                      </strong>

                      <span>
                        Selecciona la operación realizada al paciente.
                      </span>
                    </div>

                    <div className="authorization-fulfillment-choice">
                      <label
                        className={
                          fulfillmentType ===
                          'APPLICATION'
                            ? 'selected'
                            : ''
                        }
                      >
                        <input
                          type="radio"
                          name="fulfillmentType"
                          checked={
                            fulfillmentType ===
                            'APPLICATION'
                          }
                          onChange={() => {
                            setFulfillmentType(
                              'APPLICATION',
                            );

                            setFulfillmentDate(
                              '',
                            );

                            setFulfillmentError(
                              null,
                            );
                          }}
                        />

                        <span>
                          Aplicar
                        </span>
                      </label>

                      <label
                        className={
                          fulfillmentType ===
                          'DELIVERY'
                            ? 'selected'
                            : ''
                        }
                      >
                        <input
                          type="radio"
                          name="fulfillmentType"
                          checked={
                            fulfillmentType ===
                            'DELIVERY'
                          }
                          onChange={() => {
                            setFulfillmentType(
                              'DELIVERY',
                            );

                            setFulfillmentDate(
                              '',
                            );

                            setFulfillmentError(
                              null,
                            );
                          }}
                        />

                        <span>
                          Entregar
                        </span>
                      </label>
                    </div>

                    {selectedActivePurchaseOrders.length >
                      1 ? (
                      <label className="authorization-fulfillment-date">
                        <span>
                          Orden de compra
                        </span>

                        <select
                          className="control"
                          value={
                            fulfillmentPurchaseOrderCode
                          }
                          onChange={(event) => {
                            const code =
                              event.target.value;

                            setFulfillmentPurchaseOrderCode(
                              code,
                            );

                            const order =
                              selectedActivePurchaseOrders.find(
                                (candidate) =>
                                  candidate.purchaseOrderCode ===
                                    code,
                              );

                            setFulfillmentQuantity(
                              order
                                ? String(
                                    Math.min(
                                      selected.remainingAuthorizedQuantity,
                                      order.availableQuantity,
                                    ),
                                  )
                                : '',
                            );

                            setFulfillmentError(
                              null,
                            );
                          }}
                        >
                          {selectedActivePurchaseOrders.map(
                            (order) => (
                              <option
                                key={
                                  order.id
                                }
                                value={
                                  order.purchaseOrderCode
                                }
                              >
                                {order.purchaseOrderCode}
                                {' · '}
                                {order.availableQuantity}
                                {' disponible'}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                    ) : null}

                    <label className="authorization-fulfillment-date">
                      <span>
                        Cantidad a entregar / aplicar
                      </span>

                      <input
                        type="number"
                        className="control"
                        min="1"
                        step="1"
                        max={
                          selectedFulfillmentMaxQuantity
                        }
                        value={
                          fulfillmentQuantity
                        }
                        onChange={(event) => {
                          setFulfillmentQuantity(
                            event.target.value,
                          );

                          setFulfillmentError(
                            null,
                          );
                        }}
                      />

                      <small>
                        Máximo operable: {selectedFulfillmentMaxQuantity}
                      </small>
                    </label>

                    <label className="authorization-fulfillment-date">
                      <span>
                        {fulfillmentType ===
                        'APPLICATION'
                          ? 'Fecha de aplicación'
                          : 'Fecha de entrega'}
                      </span>

                      <input
                        type="date"
                        className="control"
                        value={
                          fulfillmentDate
                        }
                        max={
                          fulfillmentMaxDate
                        }
                        onChange={(event) =>
                          setFulfillmentDate(
                            event.target.value,
                          )
                        }
                      />
                    </label>

                    <p className="authorization-fulfillment-help">
                      La fecha efectiva no puede ser futura. Una reserva ya asignada se conserva aunque la autorización haya vencido.
                    </p>

                    {fulfillmentError ? (
                      <div
                        className="authorization-fulfillment-error"
                        role="alert"
                      >
                        {
                          fulfillmentError
                        }
                      </div>
                    ) : null}

                    <div className="authorization-management-actions">
                      <button
                        type="button"
                        className="btn"
                        disabled={
                          fulfilling
                        }
                        onClick={() => {
                          setManagingAuthorization(
                            false,
                          );

                          setFulfillmentDate(
                            '',
                          );

                          setFulfillmentQuantity(
                            '',
                          );

                          setFulfillmentPurchaseOrderCode(
                            '',
                          );

                          setFulfillmentError(
                            null,
                          );
                        }}
                      >
                        Cancelar
                      </button>

                      <button
                        type="button"
                        className="btn primary"
                        disabled={
                          !fulfillmentQuantityValid ||
                          !fulfillmentDateValid ||
                          fulfilling
                        }
                        onClick={() =>
                          void confirmFulfillment()
                        }
                      >
                        {fulfilling
                          ? 'Guardando…'
                          : fulfillmentType ===
                              'APPLICATION'
                            ? 'Confirmar aplicación'
                            : 'Confirmar entrega'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="authorization-operation-message">
                {selected.operationalStatus ===
                'OUT_OF_OPERATION'
                  ? selected.validityStatus ===
                      'EXPIRED'
                    ? 'La autorización está vencida y no tiene una reserva activa disponible. No recibe nuevas asignaciones. Si existe una reserva en otra autorización, el producto solo puede cambiar de AUTO mediante una reasignación explícita.'
                    : selected.initialValidationStatus ===
                        'FAILED'
                      ? 'La autorización no superó la validación inicial y se encuentra fuera de operación. No puede recibir asignaciones ni registrar entrega o aplicación.'
                      : selected.validityStatus ===
                          'INVALID_DATE'
                        ? 'La autorización contiene fechas de vigencia inválidas y se encuentra fuera de operación hasta que la información sea corregida.'
                        : selected.validityStatus ===
                            'OUTSIDE_HORIZON'
                          ? 'La autorización está fuera de la ventana operacional Hoy + 30. Se conserva para consulta y podrá entrar en operación cuando alcance la ventana permitida.'
                          : 'La autorización todavía no ha completado las condiciones necesarias para entrar en operación.'
                  : selected.operationalStatus ===
                      'UNASSIGNED'
                    ? 'La autorización está habilitada, pero todavía no cuenta con una asignación activa de inventario. Revisa la recepción y la disponibilidad del producto antes de entregar o aplicar.'
                    : 'La gestión está disponible únicamente para Medicarte.'}
              </div>
            )}
              </>
            )}
          </aside>
        </div>
      ) : null}
    </>
  );
}
