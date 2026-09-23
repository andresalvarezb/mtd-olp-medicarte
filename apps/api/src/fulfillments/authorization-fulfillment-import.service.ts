import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';

import {
  fulfillAuthorizationRequestSchema,
} from '@authorization/contracts';

import type {
  createDatabase,
} from '@authorization/database';

import * as XLSX from 'xlsx';

import type {
  Scope,
} from '../common/request-scope';

import {
  DATABASE,
} from '../tokens';

import {
  AuthorizationFulfillmentService,
} from './authorization-fulfillment.service';

import {
  AuthorizationFulfillmentXlsxError,
  createAuthorizationFulfillmentTemplate,
  parseAuthorizationFulfillmentWorkbook,
  type AuthorizationFulfillmentImportRow,
} from './authorization-fulfillment-xlsx';


type Database =
  ReturnType<typeof createDatabase>;


export type UploadedAuthorizationFulfillmentFile =
  Readonly<{
    originalname:
      string;

    mimetype:
      string;

    size:
      number;

    buffer:
      Buffer;
  }>;


export type AuthorizationFulfillmentImportRowResult =
  Readonly<{
    rowNumber:
      number;

    authorizationKey:
      string | null;

    fulfillmentType:
      'APPLICATION'
      | 'DELIVERY'
      | null;

    effectiveDate:
      string | null;

    status:
      'ACCEPTED'
      | 'REJECTED';

    authorizationItemId:
      string | null;

    fulfillmentId:
      string | null;

    errorCode:
      string | null;

    errorMessage:
      string | null;
  }>;


export type AuthorizationFulfillmentImportResult =
  Readonly<{
    totalRows:
      number;

    acceptedRows:
      number;

    rejectedRows:
      number;

    rejectedWorkbookBase64:
      string | null;

    results:
      AuthorizationFulfillmentImportRowResult[];
  }>;


function exceptionInformation(
  error:
    unknown,
): {
  code: string;
  message: string;
} {
  if (
    error &&
    typeof error === 'object' &&
    'getResponse' in error &&
    typeof (
      error as {
        getResponse?: unknown;
      }
    ).getResponse === 'function'
  ) {
    const response =
      (
        error as {
          getResponse:
            () => unknown;
        }
      ).getResponse();

    if (
      response &&
      typeof response === 'object'
    ) {
      const candidate =
        response as {
          code?: unknown;
          message?: unknown;
        };

      return {
        code:
          typeof candidate.code === 'string'
            ? candidate.code
            : 'AUTHORIZATION_FULFILLMENT_IMPORT_ERROR',

        message:
          typeof candidate.message === 'string'
            ? candidate.message
            : 'No fue posible registrar la Entrega/Aplicación.',
      };
    }
  }


  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (
      error as {
        code?: unknown;
      }
    ).code === 'string'
  ) {
    return {
      code:
        (
          error as {
            code: string;
          }
        ).code,

      message:
        error instanceof Error
          ? error.message
          : (
              error as {
                code: string;
              }
            ).code,
    };
  }


  return {
    code:
      'AUTHORIZATION_FULFILLMENT_IMPORT_ERROR',

    message:
      error instanceof Error
        ? error.message
        : 'No fue posible registrar la Entrega/Aplicación.',
  };
}


function rejectedWorkbook(
  rows:
    AuthorizationFulfillmentImportRowResult[],
): string | null {
  const rejected =
    rows.filter(
      (row) =>
        row.status ===
        'REJECTED',
    );


  if (
    rejected.length === 0
  ) {
    return null;
  }


  const workbook =
    XLSX.utils.book_new();

  const sheet =
    XLSX.utils.aoa_to_sheet([
      [
        'CLAVE_AUTORIZACION',
        'TIPO_DISPENSACION',
        'FECHA',
        'CODIGO_ERROR',
        'DETALLE',
      ],

      ...rejected.map(
        (row) => [
          row.authorizationKey ?? '',

          row.fulfillmentType ===
            'APPLICATION'
            ? 'APLICACION'
            : row.fulfillmentType ===
                'DELIVERY'
              ? 'ENTREGA'
              : '',

          row.effectiveDate ?? '',
          row.errorCode ?? '',
          row.errorMessage ?? '',
        ],
      ),
    ]);


  sheet['!cols'] = [
    { wch: 42 },
    { wch: 22 },
    { wch: 18 },
    { wch: 48 },
    { wch: 72 },
  ];


  XLSX.utils.book_append_sheet(
    workbook,
    sheet,
    'RECHAZADOS',
  );


  const output =
    XLSX.write(
      workbook,
      {
        type: 'buffer',
        bookType: 'xlsx',
      },
    );


  const buffer =
    Buffer.isBuffer(output)
      ? output
      : Buffer.from(
          output as Uint8Array,
        );


  return buffer.toString(
    'base64',
  );
}


@Injectable()
export class AuthorizationFulfillmentImportService {
  constructor(
    @Inject(DATABASE)
    private readonly database:
      Database,

    private readonly fulfillments:
      AuthorizationFulfillmentService,
  ) {}


  buildTemplate():
    Buffer {
    return createAuthorizationFulfillmentTemplate();
  }


  async import(
    file:
      UploadedAuthorizationFulfillmentFile,

    scope:
      Scope,
  ): Promise<
    AuthorizationFulfillmentImportResult
  > {
    if (
      scope.organizationCode !==
      'MEDICARTE'
    ) {
      throw new ForbiddenException({
        code:
          'AUTHORIZATION_FULFILLMENT_MEDICARTE_ONLY',

        message:
          'Solo Medicarte puede registrar la entrega o aplicación del producto.',
      });
    }


    if (
      !file.buffer?.length
    ) {
      throw new BadRequestException({
        code:
          'AUTHORIZATION_FULFILLMENT_FILE_REQUIRED',

        message:
          'Debe seleccionar un archivo XLSX.',
      });
    }


    if (
      !file.originalname
        .toLowerCase()
        .endsWith('.xlsx')
    ) {
      throw new BadRequestException({
        code:
          'AUTHORIZATION_FULFILLMENT_FILE_FORMAT_INVALID',

        message:
          'Solo se admiten archivos XLSX (.xlsx).',
      });
    }


    let rows:
      AuthorizationFulfillmentImportRow[];


    try {
      rows =
        parseAuthorizationFulfillmentWorkbook(
          file.buffer,
        );
    } catch (error) {
      if (
        error instanceof
        AuthorizationFulfillmentXlsxError
      ) {
        throw new BadRequestException({
          code:
            error.code,

          message:
            error.message,
        });
      }

      throw error;
    }


    if (
      rows.length === 0
    ) {
      throw new BadRequestException({
        code:
          'AUTHORIZATION_FULFILLMENT_EMPTY_FILE',

        message:
          'La plantilla no contiene filas para procesar.',
      });
    }


    const counts =
      new Map<string, number>();


    for (
      const row of rows
    ) {
      if (
        !row.authorizationKey
      ) {
        continue;
      }

      counts.set(
        row.authorizationKey,
        (
          counts.get(
            row.authorizationKey,
          ) ?? 0
        ) + 1,
      );
    }


    const results:
      AuthorizationFulfillmentImportRowResult[] = [];


    for (
      const row of rows
    ) {
      const base = {
        rowNumber:
          row.rowNumber,

        authorizationKey:
          row.authorizationKey,

        fulfillmentType:
          row.fulfillmentType,

        effectiveDate:
          row.effectiveDate,
      } as const;


      if (
        !row.authorizationKey
      ) {
        results.push({
          ...base,

          status:
            'REJECTED',

          authorizationItemId:
            null,

          fulfillmentId:
            null,

          errorCode:
            'AUTHORIZATION_KEY_REQUIRED',

          errorMessage:
            'CLAVE_AUTORIZACION es obligatoria.',
        });

        continue;
      }


      if (
        !row.rawFulfillmentType
      ) {
        results.push({
          ...base,

          fulfillmentType:
            null,

          status:
            'REJECTED',

          authorizationItemId:
            null,

          fulfillmentId:
            null,

          errorCode:
            'AUTHORIZATION_FULFILLMENT_TYPE_REQUIRED',

          errorMessage:
            'TIPO_DISPENSACION es obligatorio.',
        });

        continue;
      }


      if (
        !row.fulfillmentType
      ) {
        results.push({
          ...base,

          status:
            'REJECTED',

          authorizationItemId:
            null,

          fulfillmentId:
            null,

          errorCode:
            'AUTHORIZATION_FULFILLMENT_TYPE_INVALID',

          errorMessage:
            'TIPO_DISPENSACION debe ser ENTREGA o APLICACION.',
        });

        continue;
      }


      if (
        !row.effectiveDate
      ) {
        results.push({
          ...base,

          status:
            'REJECTED',

          authorizationItemId:
            null,

          fulfillmentId:
            null,

          errorCode:
            'AUTHORIZATION_FULFILLMENT_DATE_INVALID',

          errorMessage:
            'FECHA debe contener una fecha válida.',
        });

        continue;
      }


      if (
        (
          counts.get(
            row.authorizationKey,
          ) ?? 0
        ) > 1
      ) {
        results.push({
          ...base,

          status:
            'REJECTED',

          authorizationItemId:
            null,

          fulfillmentId:
            null,

          errorCode:
            'DUPLICATE_AUTHORIZATION_KEY',

          errorMessage:
            'CLAVE_AUTORIZACION está repetida dentro del archivo.',
        });

        continue;
      }


      const target =
        await this.database.pool.query<{
          id: string;
        }>(
          `
            select
              ai.id

            from
              authorization_items ai

            where
              ai.authorization_key =
                $1

              and exists (
                select 1

                from
                  authorization_item_organizations aio

                where
                  aio.authorization_item_id =
                    ai.id

                  and aio.organization_id =
                    $2
              )

            limit 2
          `,
          [
            row.authorizationKey,
            scope.organizationId,
          ],
        );


      if (
        target.rows.length === 0
      ) {
        results.push({
          ...base,

          status:
            'REJECTED',

          authorizationItemId:
            null,

          fulfillmentId:
            null,

          errorCode:
            'AUTHORIZATION_NOT_FOUND',

          errorMessage:
            'No existe una autorización visible con esa CLAVE_AUTORIZACION.',
        });

        continue;
      }


      if (
        target.rows.length !==
        1
      ) {
        results.push({
          ...base,

          status:
            'REJECTED',

          authorizationItemId:
            null,

          fulfillmentId:
            null,

          errorCode:
            'AUTHORIZATION_KEY_NOT_UNIQUE',

          errorMessage:
            'CLAVE_AUTORIZACION no identifica una única autorización.',
        });

        continue;
      }


      const authorization =
        target.rows[0]!;


      const body =
        fulfillAuthorizationRequestSchema.parse({
          fulfillmentType:
            row.fulfillmentType,

          effectiveDate:
            row.effectiveDate,
        });


      try {
        /*
         * ÚNICA fuente de reglas operacionales:
         * AuthorizationFulfillmentService.
         *
         * El importador no implementa FEFO,
         * consumo, movimientos ni cierre.
         */
        const fulfillment =
          await this.fulfillments.fulfill(
            authorization.id,
            body,
            scope,
            'XLSX',
          );


        const fulfillmentId =
          fulfillment &&
          typeof fulfillment === 'object' &&
          'id' in fulfillment &&
          typeof fulfillment.id === 'string'
            ? fulfillment.id
            : null;


        results.push({
          ...base,

          status:
            'ACCEPTED',

          authorizationItemId:
            authorization.id,

          fulfillmentId,

          errorCode:
            null,

          errorMessage:
            null,
        });
      } catch (error) {
        const information =
          exceptionInformation(
            error,
          );


        results.push({
          ...base,

          status:
            'REJECTED',

          authorizationItemId:
            authorization.id,

          fulfillmentId:
            null,

          errorCode:
            information.code,

          errorMessage:
            information.message,
        });
      }
    }


    const acceptedRows =
      results.filter(
        (row) =>
          row.status ===
          'ACCEPTED',
      ).length;


    const rejectedRows =
      results.length -
      acceptedRows;


    return {
      totalRows:
        results.length,

      acceptedRows,

      rejectedRows,

      rejectedWorkbookBase64:
        rejectedWorkbook(
          results,
        ),

      results,
    };
  }
}
