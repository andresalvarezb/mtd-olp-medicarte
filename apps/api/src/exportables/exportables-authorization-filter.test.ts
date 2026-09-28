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
