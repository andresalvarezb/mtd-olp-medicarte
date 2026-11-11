import * as XLSX from 'xlsx';
import { currentBogotaDate } from '@authorization/domain';

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type {
  Scope,
} from '../common/request-scope';

import {
  ExportablesService,
} from './exportables.service';


const scope:
  Scope = {
    organizationId:
      '11111111-1111-4111-8111-111111111111',

    organizationCode:
      'MTD',

    userId:
      '22222222-2222-4222-8222-222222222222',

    correlationId:
      '33333333-3333-4333-8333-333333333333',

    readSensitive:
      true,

    isFoundationAdmin:
      true,

    canCrossOrganizationOperationalExport:
      true,

    pointAccessKind:
      'global',
  };


describe(
  'ExportablesService purchaseOrders',
  () => {
    afterEach(() => vi.useRealTimers());
    it(
      'agrega PUNTO al final de OC_PRODUCTOS y AUTO_RELACIONADAS',
      async () => {
        const today = currentBogotaDate();
        const query =
          vi.fn()
            .mockResolvedValueOnce({
              rows: [
                {
                  OC:
                    '9185',

                  CODIGO_PRODUCTO:
                    '10156',

                  PRODUCTO:
                    'BIEMPAG 25MG',

                  CANTIDAD_SOLICITADA:
                    30,

                  CANTIDAD_OLP:
                    30,

                  CANTIDAD_MEDICARTE:
                    30,

                  PUNTO:
                    'CIMA',
                },
              ],
            })
            .mockResolvedValueOnce({
              rows: [
                {
                  OC:
                    '9185',

                  CLAVE_AUTO:
                    '262125761591988|10156',

                  NUMERO_AUTORIZACION:
                    '262125761591988',

                  CODIGO_PRODUCTO:
                    '10156',

                  CANTIDAD_AUTO:
                    30,

                  CANTIDAD_APORTADA_A_OC:
                    30,

                  PUNTO:
                    'CIMA',

                  FECHA_ASIGNACION:
                    today,

                  FECHA_FINAL_VIGENCIA:
                    today,

                  ESTADO_ANULACION:
                    'NO ANULADA',

                  ESTADO_VINCULO_OC:
                    'ACTIVO',
                },
              ],
            })
            .mockResolvedValueOnce({
              rows: [
                {
                  CLAVE_AUTO: '262125761591988|10156',
                  NUMERO_AUTORIZACION: '262125761591988',
                  CODIGO_PRODUCTO: '10156',
                  CANTIDAD_AUTO: 30,
                  FECHA_ASIGNACION: today,
                  FECHA_FINAL_VIGENCIA: today,
                  ESTADO_ANULACION: 'NO ANULADA',
                  ESTADO_VINCULO_OC: 'SIN_OC',
                  OC_RELACIONADAS: '',
                },
                {
                  CLAVE_AUTO: 'AUTO-LIBERADA|10157',
                  NUMERO_AUTORIZACION: 'AUTO-LIBERADA',
                  CODIGO_PRODUCTO: '10157',
                  CANTIDAD_AUTO: 4,
                  FECHA_ASIGNACION: '2000-01-01',
                  FECHA_FINAL_VIGENCIA: today,
                  ESTADO_ANULACION: 'ANULADA',
                  ESTADO_VINCULO_OC: 'LIBERADO',
                  OC_RELACIONADAS: 'OC-HISTORICA',
                },
              ],
            });


        const service =
          new ExportablesService(
            {
              pool: {
                query,
              },
            } as never,
          );


        const result =
          await service.purchaseOrders(
            scope,
          );


        const workbook =
          XLSX.read(
            result.content,
            {
              type:
                'buffer',
            },
          );


        const productSheet =
          workbook.Sheets[
            'OC_PRODUCTOS'
          ];

        const authorizationSheet =
          workbook.Sheets[
            'AUTO_RELACIONADAS'
          ];

        const allAuthorizationsSheet = workbook.Sheets['AUTORIZACIONES'];


        expect(
          productSheet,
        ).toBeDefined();

        expect(
          authorizationSheet,
        ).toBeDefined();
        expect(allAuthorizationsSheet).toBeDefined();


        const products =
          XLSX.utils.sheet_to_json<
            unknown[]
          >(
            productSheet!,
            {
              header:
                1,
            },
          );


        const authorizations =
          XLSX.utils.sheet_to_json<
            unknown[]
          >(
            authorizationSheet!,
            {
              header:
                1,
            },
          );


        expect(
          products[0],
        ).toEqual([
          'OC',
          'CODIGO_PRODUCTO',
          'PRODUCTO',
          'CANTIDAD_SOLICITADA',
          'CANTIDAD_OLP',
          'CANTIDAD_MEDICARTE',
          'PUNTO',
        ]);


        expect(
          products[1],
        ).toEqual([
          '9185',
          '10156',
          'BIEMPAG 25MG',
          30,
          30,
          30,
          'CIMA',
        ]);


        expect(
          authorizations[0],
        ).toEqual([
          'OC',
          'CLAVE_AUTO',
          'NUMERO_AUTORIZACION',
          'CODIGO_PRODUCTO',
          'CANTIDAD_AUTO',
          'CANTIDAD_APORTADA_A_OC',
          'PUNTO',
          'FECHA_ASIGNACION',
          'FECHA_FINAL_VIGENCIA',
          'MES_GESTION',
          'ESTADO_VIGENCIA',
          'ESTADO_ANULACION',
          'ESTADO_VINCULO_OC',
        ]);


        expect(
          authorizations[1],
        ).toEqual([
          '9185',
          '262125761591988|10156',
          '262125761591988',
          '10156',
          30,
          30,
          'CIMA',
          today,
          today,
          today.slice(0, 7),
          'VIGENTE',
          'NO ANULADA',
          'ACTIVO',
        ]);

        const allAuthorizations = XLSX.utils.sheet_to_json<unknown[]>(
          allAuthorizationsSheet!,
          { header: 1 },
        );
        expect(allAuthorizations[0]).toEqual([
          'CLAVE_AUTO',
          'NUMERO_AUTORIZACION',
          'CODIGO_PRODUCTO',
          'CANTIDAD_AUTO',
          'FECHA_ASIGNACION',
          'FECHA_FINAL_VIGENCIA',
          'MES_GESTION',
          'ESTADO_VIGENCIA',
          'ESTADO_ANULACION',
          'ESTADO_VINCULO_OC',
          'OC_RELACIONADAS',
        ]);
        expect(allAuthorizations[1]).toEqual([
          '262125761591988|10156',
          '262125761591988',
          '10156',
          30,
          today,
          today,
          today.slice(0, 7),
          'VIGENTE',
          'NO ANULADA',
          'SIN_OC',
          '',
        ]);
        expect(allAuthorizations[2]).toEqual([
          'AUTO-LIBERADA|10157',
          'AUTO-LIBERADA',
          '10157',
          4,
          '2000-01-01',
          today,
          '2000-01',
          'VIGENTE',
          'ANULADA',
          'LIBERADO',
          'OC-HISTORICA',
        ]);

        const relatedSql = String(query.mock.calls[1]?.[0]).replace(/\s+/g, ' ').toLowerCase();
        expect(relatedSql).toContain('distinct on ( po.id, source.authorization_item_id )');
        expect(relatedSql).toContain('( source.released_at is null and po.status not in (\'rejected\', \'cancelled\') ) desc');
        expect(query.mock.calls[1]?.[1]).toEqual([scope.organizationId]);
        expect(query.mock.calls[2]?.[1]).toEqual([scope.organizationId]);


        const productsSql =
          String(
            query.mock.calls[
              0
            ]?.[
              0
            ],
          );


        expect(
          productsSql,
        ).toContain(
          'pol.dispensing_point_id',
        );

        expect(
          productsSql,
        ).toContain(
          'dispensing_point_name',
        );

        expect(
          productsSql,
        ).toContain(
          'dispensing_point_id,',
        );

        expect(
          productsSql,
        ).toContain(
          'product_delivery_point_mappings mapped',
        );

        expect(
          productsSql,
        ).toContain(
          'mapped.dispensing_point_id',
        );

        expect(
          productsSql,
        ).toContain(
          'historical_point.name',
        );

        expect(
          productsSql,
        ).toContain(
          'mapped_point.name',
        );


        const authorizationsSql =
          String(
            query.mock.calls[
              1
            ]?.[
              0
            ],
          );


        expect(
          authorizationsSql,
        ).toContain(
          'point.name',
        );

        expect(
          authorizationsSql,
        ).toContain(
          'pol.dispensing_point_id',
        );

        expect(
          authorizationsSql,
        ).toContain(
          'product_delivery_point_mappings mapped',
        );

        expect(
          authorizationsSql,
        ).toContain(
          'historical_point.name',
        );

        expect(
          authorizationsSql,
        ).toContain(
          'mapped_point.name',
        );
      },
    );
    it(
      'incluye FECHA_ASIGNACION y FECHA_FINAL_VIGENCIA en la exportación de candidatas a OC',
      async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
        const today = currentBogotaDate();
        const yesterdayDate = new Date(`${today}T00:00:00.000Z`);
        yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
        const yesterday = yesterdayDate.toISOString().slice(0, 10);
        const query = vi.fn().mockResolvedValue({
          rows: [
            {
              authorization_key: 'KEY-001|PROD-1',
              numero_autorizacion: 'KEY-001',
              codigo_medicamento: 'PROD-1',
              cantidad: 10,
              fecha_asignacion: today,
              fecha_final_vigencia: today,
              punto: 'Bogotá',
            },
            {
              authorization_key: 'KEY-002|PROD-2',
              numero_autorizacion: 'KEY-002',
              codigo_medicamento: 'PROD-2',
              cantidad: 7,
              fecha_asignacion: '2000-01-01',
              fecha_final_vigencia: today,
              punto: 'Medellín',
            },
            {
              authorization_key: 'KEY-003|PROD-3',
              numero_autorizacion: 'KEY-003',
              codigo_medicamento: 'PROD-3',
              cantidad: 8,
              fecha_asignacion: '2026-11-01',
              fecha_final_vigencia: yesterday,
            },
            {
              authorization_key: 'KEY-004|PROD-4',
              numero_autorizacion: 'KEY-004',
              codigo_medicamento: 'PROD-4',
              cantidad: 9,
              fecha_asignacion: '2026-11-01',
              fecha_final_vigencia: '2026-10-31',
            },
          ],
        });

        const service = new ExportablesService({
          pool: { query },
        } as never);

        const exported = await service.purchaseOrderCandidates(scope);
        expect(exported.filename).toBe('AUTO-para-generar-OC.xlsx');

        const workbook = XLSX.read(exported.content, { type: 'buffer' });
        const sheet = workbook.Sheets['ORDENES_COMPRA'];
        expect(sheet).toBeDefined();

        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet!, { header: 1 });
        expect(matrix[0]).toEqual([
          'CLAVE_AUTORIZACION_ORIGEN',
          'CLAVE_AUTORIZACION_DESTINO',
          'OC',
          'CODIGO_PRODUCTO',
          'CANTIDAD',
          'FECHA_ASIGNACION',
          'FECHA_FINAL_VIGENCIA',
          'PUNTO',
        ]);

        expect(matrix[1]).toEqual([
          '',
          'KEY-001|PROD-1',
          '',
          'PROD-1',
          10,
          today,
          today,
          'Bogotá',
        ]);
        expect(matrix[2]).toEqual([
          '',
          'KEY-002|PROD-2',
          '',
          'PROD-2',
          7,
          '2000-01-01',
          today,
          'Medellín',
        ]);
        expect(matrix[3]?.[1]).toBe('KEY-003|PROD-3');
        expect(matrix).toHaveLength(4);
        expect(matrix.some((row) => row[1] === 'KEY-004|PROD-4')).toBe(false);
        const metadata = XLSX.utils.sheet_to_json<unknown[]>(
          workbook.Sheets['METADATA']!, { header: 1 },
        );
        expect(String(metadata[3]?.[1])).toContain('Vigencia para OC');
        expect(String(metadata[3]?.[1])).toContain('no se excluyen por mes');
        expect(String(metadata[3]?.[1])).toContain('hoy + 20 días');
        expect(String(metadata[3]?.[1])).toContain('días 1 a 5 de gracia');
        expect(query.mock.calls[0]?.[1]).toEqual([scope.organizationId]);
      },
    );
  },
);


describe('ExportablesService MTD scope', () => {
  it('rejects purchase order exports outside MTD before querying data', async () => {
    const query = vi.fn();
    const service = new ExportablesService({ pool: { query } } as never);
    const otherOrganization = { ...scope, organizationCode: 'COMPENSAR' };

    await expect(service.purchaseOrderCandidates(otherOrganization)).rejects.toMatchObject({
      response: { code: 'EXPORT_MTD_ONLY' },
    });
    await expect(service.purchaseOrders(otherOrganization)).rejects.toMatchObject({
      response: { code: 'EXPORT_MTD_ONLY' },
    });
    expect(query).not.toHaveBeenCalled();
  });
});


describe(
  'ExportablesService purchaseOrderCandidates MIPRES eligibility',
  () => {
    it(
      'exige Habilitada y Desbloqueada cuando la AUTO tiene MIPRES',
      async () => {
        const query =
          vi.fn()
            .mockResolvedValue({
              rows: [],
            });


        const service =
          new ExportablesService(
            {
              pool: {
                query,
              },
            } as never,
          );


        await service.purchaseOrderCandidates(
          scope,
        );


        const normalized =
          String(
            query.mock.calls[
              0
            ]?.[
              0
            ],
          )
            .replace(
              /\s+/g,
              ' ',
            )
            .trim();


        /*
         * La existencia de MIPRES se determina
         * por no_prescripcion.
         */
        expect(
          normalized,
        ).toContain(
          'no_prescripcion',
        );


        /*
         * El estado MIPRES efectivo se calcula
         * independientemente de Habilitación.
         */
        expect(
          normalized,
        ).toContain(
          "coverage_type = 'PBS' then 'UNLOCKED'",
        );

        expect(
          normalized,
        ).toContain(
          "coverage_type = 'NO_PBS' and mipres_manual_decision = 'MANUALLY_ENABLED' then 'UNLOCKED'",
        );


        /*
         * Para una AUTO que sí tiene MIPRES, los controles de
         * habilitación y desbloqueo siguen en SQL. La vigencia de
         * asignación se calcula con la regla compartida en el dominio.
         */
        expect(normalized).toContain("e.mipres_state = 'UNLOCKED'");
        expect(normalized).toContain("e.initial_validation = 'PASSED'");
        expect(normalized).toContain('aio.organization_id = $1');
        expect(normalized).not.toContain('validity_status');


        /*
         * direction_status no puede volver a ser
         * el gate para generar OC.
         */
        expect(
          normalized,
        ).not.toContain(
          "coverage_type = 'NO_PBS' and direction_status = 'CONFIRMED'",
        );
      },
    );
  },
);
