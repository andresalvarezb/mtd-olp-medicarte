'use client';

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
  listAuthorizationQuery,
  type AuthorizationFulfillmentType,
  type AuthorizationQueryAuditStatus,
  type AuthorizationQueryFilters,
  type AuthorizationQueryItem,
} from '@/lib/authorization-query-api';

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
  if (
    item.fulfillmentStatus ===
      'PENDING'
    &&
    (
      item.initialValidationStatus ===
        'FAILED'
      ||
      item.validityStatus ===
        'EXPIRED'
      ||
      item.validityStatus ===
        'INVALID_DATE'
    )
  ) {
    return 'No realizada';
  }

  const labels = {
    PENDING:
      'Pendiente',

    DELIVERED:
      'Entregada',

    APPLIED:
      'Aplicada',
  } satisfies Record<
    AuthorizationQueryItem['fulfillmentStatus'],
    string
  >;

  return labels[
    item.fulfillmentStatus
  ];
}


function auditStatusLabel(
  status:
    AuthorizationQueryAuditStatus,
) {
  const labels = {
    PENDING:
      'Pendiente',

    IN_REVIEW:
      'En auditoría',

    APPROVED:
      'Se puede facturar',

    REJECTED:
      'No se puede facturar',
  } satisfies Record<
    AuthorizationQueryAuditStatus,
    string
  >;

  return labels[status];
}


function authorizationAuditStatus(
  item:
    AuthorizationQueryItem,
): AuthorizationQueryAuditStatus {
  const {
    auditStatus,
  } =
    item;

  return auditStatus;
}


function authorizationAuditLabel(
  item:
    AuthorizationQueryItem,
) {
  if (
    item.fulfillmentStatus ===
      'PENDING'
  ) {
    return 'No aplica';
  }

  return auditStatusLabel(
    authorizationAuditStatus(
      item,
    ),
  );
}


function operationalLabel(
  status:
    AuthorizationQueryItem['operationalStatus'],
) {
  const labels = {
    UNASSIGNED:
      'Pendiente de recepción/asignación',

    PARTIALLY_ASSIGNED:
      'Asignación parcial',

    ASSIGNED:
      'Lista para entrega/aplicación',

    OUT_OF_OPERATION:
      'Fuera de operación',

    CLOSED:
      'Cerrada',
  };

  return labels[status];
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
        `Esta autorización registra trazabilidad con ${purchaseOrderReference(
          traceCodes,
        )}, pero actualmente no tiene producto asignado disponible para entrega/aplicación.`,
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

  const [filters, setFilters] = useState({
    authorizationNumber: '',
    commercialCode: '',
    patient: '',
    lifecycleEnablement: '',
    operationalStatus: '',
    coverageType: '',
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

  const [
    managingAuthorization,
    setManagingAuthorization,
  ] =
    useState(false);

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

        ...(appliedFilters.operationalStatus
          ? {
              operationalStatus: appliedFilters.operationalStatus as NonNullable<
                AuthorizationQueryFilters['operationalStatus']
              >,
            }
          : {}),

        ...(appliedFilters.coverageType
          ? {
              coverageType: appliedFilters.coverageType as NonNullable<
                AuthorizationQueryFilters['coverageType']
              >,
            }
          : {}),
      }),
    [organizationId, appliedFilters, page, pageSize],
    ['AUTHORIZATIONS'],
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

  const data = query.data;

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
    setPage(1);
    setAppliedFilters(filters);
  }

  function clearFilters() {
    const cleared = {
      authorizationNumber: '',
      commercialCode: '',
      patient: '',
      lifecycleEnablement: '',
      operationalStatus: '',
      coverageType: '',
    };

    setFilters(cleared);
    setAppliedFilters(cleared);
    setPage(1);
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

    setFulfillmentError(
      null,
    );

    setManagingAuthorization(
      false,
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
      !selected.operationalEligible
    ) {
      setFulfillmentError(
        'La autorización no está habilitada para entrega/aplicación porque está fuera de la ventana operacional Hoy + 30 o no superó la validación.',
      );

      return;
    }

    if (
      !purchaseOrderCode
    ) {
      setFulfillmentError(
        'No existe una única orden de compra asociada a la asignación disponible.',
      );

      return;
    }

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

      setFulfillmentDate(
        '',
      );

      setManagingAuthorization(
        false,
      );

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

  const selectedValidityEndDate =
    authorizationDateInputValue(
      selected?.validityEndDate ??
        null,
    );

  const fulfillmentMaxDate =
    selectedValidityEndDate &&
    selectedValidityEndDate <
      todayBogota
      ? selectedValidityEndDate
      : todayBogota;

  const selectedActivePurchaseOrderCode =
    selected &&
    selected.remainingAssignedQuantity >
      0
      ? singlePurchaseOrderCode(
          selected.purchaseOrder,
        )
      : null;

  const canFulfillSelected =
    Boolean(
      selected &&
      selected.operationalEligible &&
      canFulfill &&
      selected.operationalStatus ===
        'ASSIGNED' &&
      selected.remainingAssignedQuantity >
        0 &&
      selectedActivePurchaseOrderCode !==
        null,
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
                value={filters.operationalStatus}
                onChange={(event) =>
                  setFilters({
                    ...filters,

                    operationalStatus:
                      event.target.value,
                  })
                }
              >
                <option value="">
                  Todos
                </option>

                <option value="UNASSIGNED">
                  Pendiente de recepción/asignación
                </option>

                <option value="ASSIGNED">
                  Lista para entrega/aplicación
                </option>

                <option value="PARTIALLY_ASSIGNED">
                  Asignación parcial
                </option>

                <option value="OUT_OF_OPERATION">
                  Fuera de operación
                </option>

                <option value="CLOSED">
                  Cerrada
                </option>
              </select>
            </FilterField>

            <FilterField label="Cobertura">
              <select
                className="control"
                value={filters.coverageType}
                onChange={(event) =>
                  setFilters({
                    ...filters,

                    coverageType: event.target.value,
                  })
                }
              >
                <option value="">Todas</option>

                <option value="PBS">PBS</option>

                <option value="NO_PBS">NO PBS</option>
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
                        {operationalLabel(
                          item.operationalStatus,
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
                        {authorizationAuditLabel(
                          item,
                        )}
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
              </tbody>
            </table>
          </div>

          <div className="authorization-query-pagination list-pagination">
            <div className="authorization-query-pagination-summary">
              <span>
                {data
                  ? `Mostrando ${firstVisible}–${lastVisible} de ${data.total}`
                  : 'Cargando…'}
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
                  query.loading
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
                  query.loading
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
                    {operationalLabel(
                      selected.operationalStatus,
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
                  !managingAuthorization
                }
                className={
                  !managingAuthorization
                    ? 'active'
                    : ''
                }
                onClick={() => {
                  setManagingAuthorization(
                    false,
                  );

                  setFulfillmentDate(
                    '',
                  );

                  setFulfillmentError(
                    null,
                  );
                }}
              >
                Resumen
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={
                  managingAuthorization
                }
                className={
                  managingAuthorization
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
              >
                Gestionar entrega / aplicación
              </button>
            </div>


            {!managingAuthorization ? (
              <>
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

                <div className="authorization-detail-grid authorization-summary-grid">
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
                        {selected.quantity ??
                          '—'}
                      </strong>
                    )}
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
                      OC activa
                    </span>

                    <strong>
                      {selectedActivePurchaseOrderCode ??
                        'Sin OC activa'}
                    </strong>
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

                {selectedPurchaseOrderContext ? (
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
                      {authorizationAuditLabel(
                        selected,
                      )}
                    </strong>
                  </div>
                </div>


                {!selected.operationalEligible ? (
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
                      Disponible
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
                      La fecha efectiva no puede superar la fecha de vencimiento de la autorización.
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
                          !fulfillmentDate ||
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
                    ? 'La autorización está vencida y se encuentra fuera de operación. No puede recibir nuevas asignaciones ni registrar entrega o aplicación. La relación con órdenes de compra anteriores se conserva únicamente como trazabilidad histórica; una vez cumplido el periodo de gracia de 5 días, cualquier saldo reservado no consumido debe quedar liberado en Disponibilidad.'
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
