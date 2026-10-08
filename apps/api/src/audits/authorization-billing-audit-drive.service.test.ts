import type {
  ApiConfig,
} from '@authorization/config';

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';


const mocks =
  vi.hoisted(
    () => ({
      existsSync:
        vi.fn(),

      GoogleAuth:
        vi.fn(),

      drive:
        vi.fn(),

      list:
        vi.fn(),

      get:
        vi.fn(),
    }),
  );


vi.mock(
  'node:fs',
  () => ({
    existsSync:
      mocks.existsSync,
  }),
);


vi.mock(
  'googleapis',
  () => ({
    google: {
      auth: {
        GoogleAuth:
          mocks.GoogleAuth,
      },

      drive:
        mocks.drive,
    },
  }),
);


import {
  AuthorizationBillingAuditDriveService,
} from './authorization-billing-audit-drive.service';


function createService() {
  const config =
    {
      GOOGLE_DRIVE_AUDIT_ROOT_FOLDER_ID:
        'root-medicarte',

      GOOGLE_DRIVE_AUDIT_ROOT_FOLDER_IDS:
        'root-medicarte,root-facturas',

      GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE:
        '/etc/secrets/google-drive-audit-service-account.json',
    } as unknown as ApiConfig;


  return new AuthorizationBillingAuditDriveService(
    config,
  );
}


describe(
  'AuthorizationBillingAuditDriveService',
  () => {
    beforeEach(
      () => {
        vi.clearAllMocks();


        mocks.existsSync.mockReturnValue(
          true,
        );


        mocks.drive.mockReturnValue({
          files: {
            list:
              mocks.list,

            get:
              mocks.get,
          },
        });
      },
    );


    it(
      'prioriza el archivo exacto <AUTO>.pdf',
      async () => {
        mocks.list.mockResolvedValueOnce({
          data: {
            nextPageToken:
              null,

            files: [
              {
                id:
                  'exact-file',

                name:
                  '261036840431888.pdf',

                mimeType:
                  'application/pdf',

                parents: [
                  'root-medicarte',
                ],

                size:
                  '100',

                modifiedTime:
                  '2026-10-01T00:00:00.000Z',
              },
            ],
          },
        });


        const service =
          createService();


        const result =
          await service.findEvidence(
            '261036840431888',
          );


        expect(
          result,
        ).toEqual([
          expect.objectContaining({
            driveFileId:
              'exact-file',

            fileName:
              '261036840431888.pdf',
          }),
        ]);


        expect(
          mocks.list,
        ).toHaveBeenCalledTimes(
          1,
        );


        const exactSearchParams =
          mocks.list.mock.calls[
            0
          ]?.[
            0
          ] as
            | {
                q?:
                  string;
              }
            | undefined;


        expect(
          exactSearchParams?.q,
        ).toContain(
          "name = '261036840431888.pdf'",
        );
      },
    );


    it(
      'usa fullText cuando el soporte se llama por número de factura',
      async () => {
        /*
         * Búsqueda exacta:
         * no existe <AUTO>.pdf.
         */
        mocks.list.mockResolvedValueOnce({
          data: {
            nextPageToken:
              null,

            files:
              [],
          },
        });


        /*
         * Fallback fullText:
         *
         * Caso real:
         *
         * AUTO:
         * 261036840431888
         *
         * archivo:
         * MT356152.pdf
         */
        mocks.list.mockResolvedValueOnce({
          data: {
            nextPageToken:
              null,

            files: [
              {
                id:
                  'invoice-file',

                name:
                  'MT356152.pdf',

                mimeType:
                  'application/pdf',

                parents: [
                  'root-facturas',
                ],

                size:
                  '993018',

                modifiedTime:
                  '2026-10-01T14:10:52.465Z',
              },
            ],
          },
        });


        const service =
          createService();


        const result =
          await service.findEvidence(
            '261036840431888',
          );


        expect(
          result,
        ).toEqual([
          expect.objectContaining({
            driveFileId:
              'invoice-file',

            fileName:
              'MT356152.pdf',
          }),
        ]);


        expect(
          mocks.list,
        ).toHaveBeenCalledTimes(
          2,
        );


        const fullTextSearchParams =
          mocks.list.mock.calls[
            1
          ]?.[
            0
          ] as
            | {
                q?:
                  string;
              }
            | undefined;


        expect(
          fullTextSearchParams?.q,
        ).toContain(
          "fullText contains '261036840431888'",
        );
      },
    );
  },
);
