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
  'ExportablesService authorizations filtered export',
  () => {
    it(
      'exporta el universo completo filtrado y no únicamente una página',
      async () => {
        const ids = [
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        ];


        const canonicalItems =
          ids.map(
            (
              id,
              index,
            ) => ({
              id,

              authorizationNumber:
                `AUTO-${index + 1}`,

              initialValidationStatus:
                'PASSED',

              validityStatus:
                'EXPIRED',

              lifecycleEnablement:
                'DISABLED',

              lifecycleReasons: [
                {
                  code:
                    'EXPIRED',

                  message:
                    'Fecha final de vigencia vencida',
                },
              ],

              operationalStatus:
                'OUT_OF_OPERATION',
            }),
          );


        const list =
          vi.fn()
            .mockResolvedValueOnce({
              items: [
                canonicalItems[0],
              ],

              total:
                3,

              page:
                1,

              pageSize:
                1,
            })
            .mockResolvedValueOnce({
              items:
                canonicalItems,

              total:
                3,

              page:
                1,

              pageSize:
                3,
            });


        const query =
          vi.fn()
            .mockResolvedValue({
              rows:
                ids.map(
                  (
                    id,
                    index,
                  ) => ({
                    id,

                    authorization_key:
                      `AUTO-${index + 1}|100`,

                    numero_autorizacion:
                      `AUTO-${index + 1}`,

                    codigo_medicamento:
                      '100',

                    source_data:
                      {},

                    minimum_quantity:
                      1,

                    initial_validation_status:
                      'PASSED',

                    lifecycle_enablement_status:
                      'HABILITADA',

                    validity_status:
                      'IN_WINDOW',

                    coverage_type:
                      'PBS',

                    direction_status:
                      'NOT_APPLICABLE',

                    operational_state:
                      'UNASSIGNED',

                    has_any_po:
                      false,

                    has_active_po:
                      false,

                    allocated_quantity:
                      0,

                    consumed_quantity:
                      0,

                    released_quantity:
                      0,

                    remaining_quantity:
                      0,

                    created_at:
                      new Date(
                        '2026-09-28T12:00:00.000Z',
                      ),

                    updated_at:
                      new Date(
                        '2026-09-28T12:00:00.000Z',
                      ),
                  }),
                ),
            });


        const service =
          new ExportablesService(
            {
              pool: {
                query,
              },
            } as never,

            {
              list,
            } as never,
          );


        const result =
          await service.authorizations(
            scope,
            {
              lifecycleEnablement:
                'DISABLED',

              coverageType:
                'PBS',

              patient:
                'PACIENTE X',
            },
          );


        expect(
          list,
        ).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({
            lifecycleEnablement:
              'DISABLED',

            coverageType:
              'PBS',

            patient:
              'PACIENTE X',

            page:
              1,

            limit:
              1,
          }),
          scope,
        );


        expect(
          list,
        ).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            lifecycleEnablement:
              'DISABLED',

            coverageType:
              'PBS',

            patient:
              'PACIENTE X',

            page:
              1,

            limit:
              3,
          }),
          scope,
        );


        expect(
          query,
        ).toHaveBeenCalledWith(
          expect.stringContaining(
            '$1::uuid[]',
          ),
          [
            ids,
          ],
        );


        expect(
          result.rowCount,
        ).toBe(
          3,
        );


        const workbook =
          XLSX.read(
            result.content,
            {
              type:
                'buffer',
            },
          );

        const sheet =
          workbook.Sheets[
            'AUTORIZACIONES'
          ];

        expect(
          sheet,
        ).toBeDefined();


        const rows =
          XLSX.utils.sheet_to_json<
            Record<
              string,
              unknown
            >
          >(
            sheet!,
          );


        expect(
          rows,
        ).toHaveLength(
          3,
        );


        expect(
          rows.map(
            (row) =>
              row[
                'HABILITACION'
              ],
          ),
        ).toEqual([
          'Inhabilitada',
          'Inhabilitada',
          'Inhabilitada',
        ]);


        expect(
          rows.map(
            (row) =>
              row[
                'MOTIVO_HABILITACION'
              ],
          ),
        ).toEqual([
          'Fecha final de vigencia vencida',
          'Fecha final de vigencia vencida',
          'Fecha final de vigencia vencida',
        ]);


        expect(
          rows.map(
            (row) =>
              row[
                'VIGENCIA'
              ],
          ),
        ).toEqual([
          'VENCIDA',
          'VENCIDA',
          'VENCIDA',
        ]);


        expect(
          rows.map(
            (row) =>
              row[
                'ESTADO_OPERACION'
              ],
          ),
        ).toEqual([
          'OUT_OF_OPERATION',
          'OUT_OF_OPERATION',
          'OUT_OF_OPERATION',
        ]);
      },
    );
  },
);


describe(
  'ExportablesService authorizations export-all fast path',
  () => {
    it(
      'exporta todo sin ejecutar AuthorizationQueryRepository.list',
      async () => {
        const list =
          vi.fn();


        const query =
          vi.fn()
            .mockResolvedValue({
              rows: [
                {
                  id:
                    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',

                  authorization_key:
                    'AUTO-ALL-1|10156',

                  numero_autorizacion:
                    'AUTO-ALL-1',

                  codigo_medicamento:
                    '10156',

                  source_data: {
                    NUMERO_AUTORIZACION:
                      'AUTO-ALL-1',

                    CODIGO_COMERCIAL:
                      '10156',

                    CANTIDAD:
                      '30',

                    FECHA_ASIGNACION:
                      '20260901',

                    FECHA_FINAL_VIGENCIA:
                      '20991231',
                  },

                  enablement_status:
                    'ENABLED',

                  tariff_membership_status:
                    'LISTED',

                  coverage_type:
                    'PBS',

                  direction_status:
                    'NOT_APPLICABLE',

                  minimum_quantity:
                    1,

                  has_any_po:
                    false,

                  has_active_po:
                    false,

                  purchase_order_codes:
                    null,

                  dispensing_points:
                    null,

                  allocated_quantity:
                    0,

                  consumed_quantity:
                    0,

                  released_quantity:
                    0,

                  remaining_quantity:
                    0,

                  fulfillment_type:
                    null,

                  effective_date:
                    null,

                  fulfillment_quantity:
                    null,

                  has_legacy_fulfillment:
                    false,

                  resolved_review_status:
                    null,

                  audit_observations:
                    null,

                  created_at:
                    new Date(
                      '2026-09-29T12:00:00.000Z',
                    ),

                  updated_at:
                    new Date(
                      '2026-09-29T12:00:00.000Z',
                    ),
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

            {
              list,
            } as never,
          );


        const result =
          await service.authorizations(
            scope,
          );


        expect(
          list,
        ).not.toHaveBeenCalled();


        expect(
          query,
        ).toHaveBeenCalledTimes(
          1,
        );


        const sql:
          unknown =
          query.mock.calls[0]?.[0] as unknown;

        const parameters:
          unknown =
          query.mock.calls[0]?.[1] as unknown;


        expect(
          String(
            sql,
          ),
        ).toContain(
          'where\n              true',
        );


        expect(
          parameters,
        ).toEqual(
          [],
        );


        expect(
          result.rowCount,
        ).toBe(
          1,
        );


        const workbook =
          XLSX.read(
            result.content,
            {
              type:
                'buffer',
            },
          );


        const sheet =
          workbook.Sheets[
            'AUTORIZACIONES'
          ];


        expect(
          sheet,
        ).toBeDefined();


        const rows =
          XLSX.utils.sheet_to_json<
            Record<
              string,
              unknown
            >
          >(
            sheet!,
          );


        expect(
          rows,
        ).toHaveLength(
          1,
        );


        expect(
          rows[0]?.[
            'NUMERO_AUTORIZACION'
          ],
        ).toBe(
          'AUTO-ALL-1',
        );
      },
    );
  },
);
