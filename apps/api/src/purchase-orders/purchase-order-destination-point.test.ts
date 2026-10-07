import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  PurchaseOrderImportService,
} from './purchase-order-import.service';


const AUTHORIZATION_ID =
  '30000000-0000-4000-8000-000000000001';

const BUCARAMANGA_ID =
  '40000000-0000-4000-8000-000000000001';

const FALLBACK_POINT_ID =
  '40000000-0000-4000-8000-000000000002';


function service() {
  return new PurchaseOrderImportService(
    {
      pool: {},
    } as never,

    {} as never,
  );
}


function resolver(
  instance:
    PurchaseOrderImportService,
) {
  return instance as unknown as {
    destinationPoint:
      (
        client: never,
        authorizationItemId: string,
        commercialCode: string,
      ) => Promise<string>;
  };
}


describe(
  'PurchaseOrderImportService destinationPoint',
  () => {
    it(
      'prioriza el punto programado de AUTO_DESTINO sobre el mapping del producto',
      async () => {
        const query =
          vi.fn(
            (
              sql:
                string,
            ) => {
              const normalized =
                String(
                  sql,
                )
                  .replace(
                    /\s+/g,
                    ' ',
                  )
                  .toLowerCase();


              if (
                normalized.includes(
                  'from patient_schedules ps',
                )
              ) {
                return {
                  rows: [
                    {
                      dispensing_point_id:
                        BUCARAMANGA_ID,

                      active:
                        true,
                    },
                  ],

                  rowCount:
                    1,
                };
              }


              if (
                normalized.includes(
                  'product_delivery_point_mappings',
                )
              ) {
                throw new Error(
                  'PRODUCT_MAPPING_MUST_NOT_BE_QUERIED',
                );
              }


              throw new Error(
                `UNEXPECTED_QUERY: ${normalized}`,
              );
            },
          );


        const point =
          await resolver(
            service(),
          ).destinationPoint(
            {
              query,
            } as never,

            AUTHORIZATION_ID,
            '10517',
          );


        expect(
          point,
        ).toBe(
          BUCARAMANGA_ID,
        );


        expect(
          query,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );


    it(
      'prioriza el punto habitual del paciente cuando AUTO_DESTINO no tiene programación',
      async () => {
        const query =
          vi.fn(
            (
              sql:
                string,
            ) => {
              const normalized =
                String(
                  sql,
                )
                  .replace(
                    /\s+/g,
                    ' ',
                  )
                  .toLowerCase();


              if (
                normalized.includes(
                  'from patient_schedules ps',
                )
              ) {
                return {
                  rows:
                    [],

                  rowCount:
                    0,
                };
              }


              if (
                normalized.includes(
                  'patient_default_dispensing_points pdp',
                )
              ) {
                return {
                  rows: [
                    {
                      dispensing_point_id:
                        BUCARAMANGA_ID,

                      active:
                        true,
                    },
                  ],

                  rowCount:
                    1,
                };
              }


              if (
                normalized.includes(
                  'product_delivery_point_mappings',
                )
              ) {
                throw new Error(
                  'PRODUCT_MAPPING_MUST_NOT_BE_QUERIED',
                );
              }


              throw new Error(
                `UNEXPECTED_QUERY: ${normalized}`,
              );
            },
          );


        const point =
          await resolver(
            service(),
          ).destinationPoint(
            {
              query,
            } as never,

            AUTHORIZATION_ID,
            '10517',
          );


        expect(
          point,
        ).toBe(
          BUCARAMANGA_ID,
        );


        expect(
          query,
        ).toHaveBeenCalledTimes(
          2,
        );
      },
    );


    it(
      'conserva product_delivery_point_mappings como fallback cuando la AUTO no tiene programación ni punto habitual',
      async () => {
        const query =
          vi.fn(
            (
              sql:
                string,
            ) => {
              const normalized =
                String(
                  sql,
                )
                  .replace(
                    /\s+/g,
                    ' ',
                  )
                  .toLowerCase();


              if (
                normalized.includes(
                  'from patient_schedules ps',
                )
              ) {
                return {
                  rows:
                    [],

                  rowCount:
                    0,
                };
              }


              if (
                normalized.includes(
                  'patient_default_dispensing_points pdp',
                )
              ) {
                return {
                  rows:
                    [],

                  rowCount:
                    0,
                };
              }


              if (
                normalized.includes(
                  'product_delivery_point_mappings',
                )
              ) {
                return {
                  rows: [
                    {
                      dispensing_point_id:
                        FALLBACK_POINT_ID,
                    },
                  ],

                  rowCount:
                    1,
                };
              }


              throw new Error(
                `UNEXPECTED_QUERY: ${normalized}`,
              );
            },
          );


        const point =
          await resolver(
            service(),
          ).destinationPoint(
            {
              query,
            } as never,

            AUTHORIZATION_ID,
            '13346',
          );


        expect(
          point,
        ).toBe(
          FALLBACK_POINT_ID,
        );


        expect(
          query,
        ).toHaveBeenCalledTimes(
          3,
        );
      },
    );


    it(
      'rechaza AUTO_DESTINO programada en dos puntos distintos',
      async () => {
        const query =
          vi.fn(
            (
              sql:
                string,
            ) => {
              const normalized =
                String(
                  sql,
                )
                  .replace(
                    /\s+/g,
                    ' ',
                  )
                  .toLowerCase();


              if (
                normalized.includes(
                  'from patient_schedules ps',
                )
              ) {
                return {
                  rows: [
                    {
                      dispensing_point_id:
                        BUCARAMANGA_ID,

                      active:
                        true,
                    },
                    {
                      dispensing_point_id:
                        FALLBACK_POINT_ID,

                      active:
                        true,
                    },
                  ],

                  rowCount:
                    2,
                };
              }


              throw new Error(
                `UNEXPECTED_QUERY: ${normalized}`,
              );
            },
          );


        try {
          await resolver(
            service(),
          ).destinationPoint(
            {
              query,
            } as never,

            AUTHORIZATION_ID,
            '10517',
          );

          throw new Error(
            'EXPECTED_REJECTION',
          );
        } catch (
          error
        ) {
          const response =
            (
              error as {
                getResponse?:
                  () => unknown;
              }
            ).getResponse?.();


          expect(
            response,
          ).toMatchObject({
            code:
              'PURCHASE_ORDER_SCHEDULE_POINT_AMBIGUOUS',
          });
        }
      },
    );


    it(
      'rechaza el punto programado si está inactivo',
      async () => {
        const query =
          vi.fn(
            (
              sql:
                string,
            ) => {
              const normalized =
                String(
                  sql,
                )
                  .replace(
                    /\s+/g,
                    ' ',
                  )
                  .toLowerCase();


              if (
                normalized.includes(
                  'from patient_schedules ps',
                )
              ) {
                return {
                  rows: [
                    {
                      dispensing_point_id:
                        BUCARAMANGA_ID,

                      active:
                        false,
                    },
                  ],

                  rowCount:
                    1,
                };
              }


              throw new Error(
                `UNEXPECTED_QUERY: ${normalized}`,
              );
            },
          );


        try {
          await resolver(
            service(),
          ).destinationPoint(
            {
              query,
            } as never,

            AUTHORIZATION_ID,
            '10517',
          );

          throw new Error(
            'EXPECTED_REJECTION',
          );
        } catch (
          error
        ) {
          const response =
            (
              error as {
                getResponse?:
                  () => unknown;
              }
            ).getResponse?.();


          expect(
            response,
          ).toMatchObject({
            code:
              'PURCHASE_ORDER_SCHEDULE_POINT_INACTIVE',
          });
        }
      },
    );
  },
);
