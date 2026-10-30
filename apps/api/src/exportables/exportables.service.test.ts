import * as XLSX from 'xlsx';

import {
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
    it(
      'agrega PUNTO al final de OC_PRODUCTOS y AUTO_RELACIONADAS',
      async () => {
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


        expect(
          productSheet,
        ).toBeDefined();

        expect(
          authorizationSheet,
        ).toBeDefined();


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
        ]);


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
        const query = vi.fn().mockResolvedValue({
          rows: [
            {
              authorization_key: 'KEY-001|PROD-1',
              numero_autorizacion: 'KEY-001',
              codigo_medicamento: 'PROD-1',
              cantidad: 10,
              fecha_asignacion: '2026-10-01',
              fecha_final_vigencia: '2026-11-15',
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
        ]);

        expect(matrix[1]).toEqual([
          '',
          'KEY-001|PROD-1',
          '',
          'PROD-1',
          10,
          '2026-10-01',
          '2026-11-15',
        ]);
      },
    );
  },
);


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
         * Para una AUTO que sí tiene MIPRES:
         *
         * Habilitada:
         * validity_status = IN_WINDOW
         * + initial_validation = PASSED.
         *
         * Desbloqueada:
         * mipres_state = UNLOCKED.
         */
        expect(
          normalized,
        ).toContain(
          "e.validity_status in ( 'IN_WINDOW', 'EXPIRED' ) and e.mipres_state = 'UNLOCKED'",
        );


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
