import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';

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


type Database =
  ReturnType<typeof createDatabase>;


export type UploadedDispensationFile =
  Readonly<{
    originalname: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  }>;


type ParsedRow =
  Readonly<{
    rowNumber: number;
    authorizationKey: string | null;
    dispensationDate: string | null;
  }>;


type ImportRowResult =
  Readonly<{
    rowNumber: number;

    authorizationKey:
      string | null;

    dispensationDate:
      string | null;

    status:
      | 'ACCEPTED'
      | 'REJECTED'
      | 'UNCHANGED';

    errorCode:
      string | null;

    errorMessage:
      string | null;
  }>;


const HEADERS = [
  'CLAVE_AUTORIZACION',
  'FECHA_DISPENSACION',
] as const;



type ExcelDateParts =
  Readonly<{
    y: number;
    m: number;
    d: number;
  }>;


function scalarText(
  value: unknown,
): string {
  if (
    typeof value === 'string'
  ) {
    return value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }

  return '';
}


function hasCellValue(
  value: unknown,
): boolean {
  if (
    value === null ||
    value === undefined
  ) {
    return false;
  }

  if (
    value instanceof Date
  ) {
    return true;
  }

  return scalarText(
    value,
  ).trim() !== '';
}


function parseExcelDateCode(
  value: number,
): ExcelDateParts | null {
  const ssf: unknown =
    Reflect.get(
      XLSX as object,
      'SSF',
    );

  if (
    typeof ssf !== 'object' ||
    ssf === null
  ) {
    return null;
  }

  const parser =
    (
      ssf as
        Record<string, unknown>
    ).parse_date_code;

  if (
    typeof parser !== 'function'
  ) {
    return null;
  }

  const parsed: unknown =
    Reflect.apply(
      parser,
      ssf,
      [
        value,
      ],
    );

  if (
    typeof parsed !== 'object' ||
    parsed === null
  ) {
    return null;
  }

  const record =
    parsed as
      Record<string, unknown>;

  const y =
    record.y;

  const m =
    record.m;

  const d =
    record.d;

  if (
    typeof y !== 'number' ||
    !Number.isInteger(y) ||
    typeof m !== 'number' ||
    !Number.isInteger(m) ||
    typeof d !== 'number' ||
    !Number.isInteger(d)
  ) {
    return null;
  }

  return {
    y,
    m,
    d,
  };
}


function normalizeHeader(
  value: unknown,
): string {
  return scalarText(
    value,
  )
    .replace(
      /^\uFEFF/,
      '',
    )
    .trim()
    .normalize(
      'NFD',
    )
    .replace(
      /[\u0300-\u036f]/g,
      '',
    )
    .replace(
      /[^A-Z0-9_]+/gi,
      '_',
    )
    .replace(
      /_+/g,
      '_',
    )
    .replace(
      /^_+|_+$/g,
      '',
    )
    .toUpperCase();
}


function normalizeText(
  value: unknown,
): string | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const normalized =
    scalarText(
      value,
    ).trim();

  return normalized || null;
}


function normalizeDate(
  value: unknown,
): string | null {
  if (
    value instanceof Date &&
    !Number.isNaN(
      value.getTime(),
    )
  ) {
    return [
      String(
        value.getFullYear(),
      ).padStart(
        4,
        '0',
      ),

      String(
        value.getMonth() + 1,
      ).padStart(
        2,
        '0',
      ),

      String(
        value.getDate(),
      ).padStart(
        2,
        '0',
      ),
    ].join(
      '-',
    );
  }


  if (
    typeof value === 'number' &&
    Number.isFinite(
      value,
    )
  ) {
    const parsed =
      parseExcelDateCode(
        value,
      );

    if (
      !parsed
    ) {
      return null;
    }

    return [
      String(
        parsed.y,
      ).padStart(
        4,
        '0',
      ),

      String(
        parsed.m,
      ).padStart(
        2,
        '0',
      ),

      String(
        parsed.d,
      ).padStart(
        2,
        '0',
      ),
    ].join(
      '-',
    );
  }


  const text =
    normalizeText(
      value,
    );

  if (
    !text
  ) {
    return null;
  }


  const iso =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(
      text,
    );

  if (
    iso
  ) {
    const date =
      new Date(
        `${text}T00:00:00Z`,
      );

    if (
      !Number.isNaN(
        date.getTime(),
      ) &&
      date
        .toISOString()
        .slice(
          0,
          10,
        ) === text
    ) {
      return text;
    }

    return null;
  }


  const colombian =
    /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(
      text,
    );

  if (
    colombian
  ) {
    const normalized =
      `${colombian[3]}-${colombian[2]}-${colombian[1]}`;

    const date =
      new Date(
        `${normalized}T00:00:00Z`,
      );

    if (
      !Number.isNaN(
        date.getTime(),
      ) &&
      date
        .toISOString()
        .slice(
          0,
          10,
        ) === normalized
    ) {
      return normalized;
    }
  }


  return null;
}


@Injectable()
export class DispensationImportService {
  constructor(
    @Inject(
      DATABASE,
    )
    private readonly database:
      Database,
  ) {}


  template(): Buffer {
    const workbook =
      XLSX.utils.book_new();

    const sheet =
      XLSX.utils.aoa_to_sheet([
        [
          ...HEADERS,
        ],
      ]);

    sheet['!cols'] = [
      {
        wch: 42,
      },
      {
        wch: 22,
      },
    ];

    XLSX.utils.book_append_sheet(
      workbook,
      sheet,
      'DISPENSACION',
    );

    const output: unknown =
      XLSX.write(
        workbook,
        {
          type:
            'buffer',

          bookType:
            'xlsx',
        },
      );

    if (
      Buffer.isBuffer(
        output,
      )
    ) {
      return output;
    }

    if (
      output instanceof Uint8Array
    ) {
      return Buffer.from(
        output,
      );
    }

    throw new Error(
      'DISPENSATION_XLSX_WRITE_INVALID_OUTPUT',
    );
  }


  async import(
    file:
      UploadedDispensationFile,

    actor:
      Scope,
  ) {
    if (
      actor.organizationCode !==
        'MEDICARTE' &&
      !actor.isFoundationAdmin
    ) {
      throw new ForbiddenException({
        code:
          'DISPENSATION_MEDICARTE_ONLY',

        message:
          'Solo MEDICARTE puede cargar fechas de dispensación.',
      });
    }


    if (
      !file.buffer?.length
    ) {
      throw new BadRequestException({
        code:
          'DISPENSATION_FILE_REQUIRED',

        message:
          'Debe seleccionar un archivo XLSX.',
      });
    }


    if (
      !file.originalname
        .toLowerCase()
        .endsWith(
          '.xlsx',
        )
    ) {
      throw new BadRequestException({
        code:
          'DISPENSATION_INVALID_FILE_FORMAT',

        message:
          'Solo se admiten archivos XLSX (.xlsx).',
      });
    }


    let workbook:
      XLSX.WorkBook;


    try {
      workbook =
        XLSX.read(
          file.buffer,
          {
            type:
              'buffer',

            raw:
              true,

            cellDates:
              true,
          },
        );
    } catch {
      throw new BadRequestException({
        code:
          'DISPENSATION_INVALID_XLSX',

        message:
          'El archivo XLSX no es legible.',
      });
    }


    const sheetName =
      workbook.SheetNames[
        0
      ];


    if (
      !sheetName
    ) {
      throw new BadRequestException({
        code:
          'DISPENSATION_EMPTY_WORKBOOK',

        message:
          'El archivo no contiene una hoja de datos.',
      });
    }


    const sheet =
      workbook.Sheets[
        sheetName
      ];


    if (
      !sheet
    ) {
      throw new BadRequestException({
        code:
          'DISPENSATION_SHEET_NOT_FOUND',

        message:
          'No fue posible leer la hoja de dispensación.',
      });
    }


    const matrix =
      XLSX.utils.sheet_to_json<
        unknown[]
      >(
        sheet,
        {
          header:
            1,

          raw:
            true,

          defval:
            null,

          blankrows:
            false,
        },
      );


    const headerRow =
      matrix[
        0
      ];


    if (
      !headerRow
    ) {
      throw new BadRequestException({
        code:
          'DISPENSATION_HEADERS_REQUIRED',

        message:
          'El archivo no contiene encabezados.',
      });
    }


    const headers =
      headerRow.map(
        normalizeHeader,
      );


    if (
      headers.length !==
        HEADERS.length ||
      HEADERS.some(
        (
          header,
          index,
        ) =>
          headers[
            index
          ] !==
          header,
      )
    ) {
      throw new BadRequestException({
        code:
          'DISPENSATION_INVALID_HEADERS',

        message:
          `Los encabezados deben ser exactamente: ${HEADERS.join(
            ', ',
          )}.`,
      });
    }


    const rows:
      ParsedRow[] = [];


    for (
      let index = 1;
      index <
        matrix.length;
      index += 1
    ) {
      const values =
        matrix[
          index
        ] ?? [];


      const key =
        normalizeText(
          values[
            0
          ],
        );


      const rawDate =
        values[
          1
        ];


      const hasDate =
        hasCellValue(
          rawDate,
        );


      if (
        !key &&
        !hasDate
      ) {
        continue;
      }


      rows.push({
        rowNumber:
          index + 1,

        authorizationKey:
          key,

        dispensationDate:
          normalizeDate(
            rawDate,
          ),
      });
    }


    if (
      rows.length === 0
    ) {
      throw new BadRequestException({
        code:
          'DISPENSATION_EMPTY_FILE',

        message:
          'La plantilla no contiene filas para procesar.',
      });
    }


    const counts =
      new Map<
        string,
        number
      >();


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


    const client =
      await this.database.pool.connect();


    const results:
      ImportRowResult[] = [];


    try {
      await client.query(
        'begin',
      );


      for (
        const row of rows
      ) {
        if (
          !row.authorizationKey
        ) {
          results.push({
            ...row,

            status:
              'REJECTED',

            errorCode:
              'AUTHORIZATION_KEY_REQUIRED',

            errorMessage:
              'CLAVE_AUTORIZACION es obligatoria.',
          });

          continue;
        }


        if (
          !row.dispensationDate
        ) {
          results.push({
            ...row,

            status:
              'REJECTED',

            errorCode:
              'DISPENSATION_DATE_INVALID',

            errorMessage:
              'FECHA_DISPENSACION debe contener una fecha válida.',
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
            ...row,

            status:
              'REJECTED',

            errorCode:
              'DUPLICATE_AUTHORIZATION_KEY',

            errorMessage:
              'CLAVE_AUTORIZACION está repetida dentro del archivo.',
          });

          continue;
        }


        /*
         * La autorización debe existir dentro del scope
         * operacional de MEDICARTE.
         */
        const authorization =
          await client.query<{
            id: string;
          }>(
            `
              select
                ai.id

              from
                authorization_items ai

              join
                authorization_item_organizations aio

                on aio.authorization_item_id =
                   ai.id

              where
                ai.authorization_key =
                  $1

                and aio.organization_id =
                  $2

              for update of ai
            `,
            [
              row.authorizationKey,
              actor.organizationId,
            ],
          );


        const item =
          authorization.rows[
            0
          ];


        if (
          !item
        ) {
          results.push({
            ...row,

            status:
              'REJECTED',

            errorCode:
              'AUTHORIZATION_NOT_FOUND',

            errorMessage:
              'No existe una autorización visible para MEDICARTE con esa CLAVE_AUTORIZACION.',
          });

          continue;
        }


        const current =
          await client.query<{
            id: string;

            dispensation_date:
              string;
          }>(
            `
              select
                id,
                dispensation_date::text

              from
                authorization_dispensations

              where
                authorization_item_id =
                  $1

              for update
            `,
            [
              item.id,
            ],
          );


        const existing =
          current.rows[
            0
          ];


        /*
         * Idempotencia semántica:
         * misma autorización + misma fecha = UNCHANGED.
         */
        if (
          existing &&
          existing.dispensation_date ===
            row.dispensationDate
        ) {
          results.push({
            ...row,

            status:
              'UNCHANGED',

            errorCode:
              null,

            errorMessage:
              null,
          });

          continue;
        }


        /*
         * Si ya existía otra fecha, el cargue actualiza el
         * evento moderno y conserva auditoría before/after.
         *
         * No toca autorización legacy.
         */
        if (
          existing
        ) {
          await client.query(
            `
              update
                authorization_dispensations

              set
                dispensation_date =
                  $2::date,

                source =
                  'XLSX',

                reported_by =
                  $3,

                reported_at =
                  now(),

                updated_at =
                  now()

              where
                id =
                  $1
            `,
            [
              existing.id,

              row.dispensationDate,

              actor.userId,
            ],
          );


          await client.query(
            `
              insert into
                audit_events (
                  actor_type,
                  actor_id,
                  organization_id,
                  action,
                  resource_type,
                  resource_id,
                  before,
                  after,
                  correlation_id,
                  request_id,
                  result
                )

              values (
                'USER',
                $1,
                $2,
                'AUTHORIZATION_DISPENSATION_UPDATED',
                'authorization_dispensation',
                $3,
                $4::jsonb,
                $5::jsonb,
                $6,
                $6,
                'SUCCESS'
              )
            `,
            [
              actor.userId,

              actor.organizationId,

              existing.id,

              JSON.stringify({
                dispensationDate:
                  existing.dispensation_date,
              }),

              JSON.stringify({
                dispensationDate:
                  row.dispensationDate,

                source:
                  'XLSX',
              }),

              actor.correlationId,
            ],
          );
        } else {
          const inserted =
            await client.query<{
              id: string;
            }>(
              `
                insert into
                  authorization_dispensations (
                    organization_id,
                    authorization_item_id,
                    dispensation_date,
                    source,
                    reported_by
                  )

                values (
                  $1,
                  $2,
                  $3::date,
                  'XLSX',
                  $4
                )

                returning id
              `,
              [
                actor.organizationId,

                item.id,

                row.dispensationDate,

                actor.userId,
              ],
            );


          const dispensation =
            inserted.rows[
              0
            ];


          if (
            !dispensation
          ) {
            throw new Error(
              'AUTHORIZATION_DISPENSATION_INSERT_FAILED',
            );
          }


          await client.query(
            `
              insert into
                audit_events (
                  actor_type,
                  actor_id,
                  organization_id,
                  action,
                  resource_type,
                  resource_id,
                  after,
                  correlation_id,
                  request_id,
                  result
                )

              values (
                'USER',
                $1,
                $2,
                'AUTHORIZATION_DISPENSATION_CREATED',
                'authorization_dispensation',
                $3,
                $4::jsonb,
                $5,
                $5,
                'SUCCESS'
              )
            `,
            [
              actor.userId,

              actor.organizationId,

              dispensation.id,

              JSON.stringify({
                authorizationItemId:
                  item.id,

                dispensationDate:
                  row.dispensationDate,

                source:
                  'XLSX',
              }),

              actor.correlationId,
            ],
          );
        }


        results.push({
          ...row,

          status:
            'ACCEPTED',

          errorCode:
            null,

          errorMessage:
            null,
        });
      }


      await client.query(
        'commit',
      );
    } catch (
      error
    ) {
      await client.query(
        'rollback',
      );

      throw error;
    } finally {
      client.release();
    }


    const acceptedRows =
      results.filter(
        (row) =>
          row.status ===
          'ACCEPTED',
      ).length;


    const unchangedRows =
      results.filter(
        (row) =>
          row.status ===
          'UNCHANGED',
      ).length;


    const rejectedRows =
      results.filter(
        (row) =>
          row.status ===
          'REJECTED',
      ).length;


    return {
      totalRows:
        results.length,

      acceptedRows,

      unchangedRows,

      rejectedRows,

      results,
    };
  }
}
