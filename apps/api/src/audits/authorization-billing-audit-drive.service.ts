import {
  BadGatewayException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';

import type {
  ApiConfig,
} from '@authorization/config';

import {
  existsSync,
} from 'node:fs';

import type {
  Readable,
} from 'node:stream';

import {
  google,
  type drive_v3,
} from 'googleapis';

import {
  API_CONFIG,
} from '../tokens';


export type BillingAuditDriveEvidence =
  Readonly<{
    driveFileId:
      string;

    fileName:
      string;

    mimeType:
      string | null;

    webViewLink:
      string | null;

    sizeBytes:
      number | null;

    md5Checksum:
      string | null;

    driveModifiedAt:
      string | null;
  }>;


@Injectable()
export class AuthorizationBillingAuditDriveService {
  constructor(
    @Inject(
      API_CONFIG,
    )
    private readonly config:
      ApiConfig,
  ) {}


  async findEvidence(
    authorizationNumber:
      string,
  ): Promise<
    BillingAuditDriveEvidence[]
  > {
    const rootIds =
      this.rootIds();

    const credentialFile =
      this.config
        .GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE;


    if (
      rootIds.length ===
        0
      ||
      !credentialFile
      ||
      !existsSync(
        credentialFile,
      )
    ) {
      throw new InternalServerErrorException({
        code:
          'AUTHORIZATION_BILLING_AUDIT_DRIVE_NOT_CONFIGURED',

        message:
          'Google Drive no está configurado para auditoría de facturación.',
      });
    }


    try {
      const auth =
        new google.auth.GoogleAuth({
          keyFile:
            credentialFile,

          scopes: [
            'https://www.googleapis.com/auth/drive.readonly',
          ],
        });


      const drive =
        google.drive({
          version:
            'v3',

          auth,
        });


      /*
       * Estrategia de búsqueda:
       *
       * 1. Preferimos el contrato histórico:
       *
       *      <numero_autorizacion>.pdf
       *
       * 2. Si no encontramos un archivo válido dentro
       *    de las raíces autorizadas, hacemos fallback
       *    sobre el índice fullText de Google Drive.
       *
       * Esto permite soportar documentos como:
       *
       *      MT356152.pdf
       *
       * cuyo contenido contiene:
       *
       *      261036840431888
       */
      const targetName =
        `${authorizationNumber}.pdf`;


      const exactCandidates =
        await this.searchCandidates(
          drive,

          [
            `name = '${this.escapeQueryLiteral(
              targetName,
            )}'`,

            `mimeType = 'application/pdf'`,

            'trashed = false',
          ].join(
            ' and ',
          ),
        );


      const exactEvidence =
        await this.acceptCandidates(
          drive,
          exactCandidates,
          rootIds,
        );


      const contentCandidates =
        await this.searchCandidates(
          drive,

          [
            `fullText contains '${this.escapeQueryLiteral(
              authorizationNumber,
            )}'`,

            `mimeType = 'application/pdf'`,

            'trashed = false',
          ].join(
            ' and ',
          ),
        );


      const contentEvidence =
        await this.acceptCandidates(
          drive,
          contentCandidates,
          rootIds,
        );


      /*
       * Una misma AUTO puede tener varios soportes.
       *
       * No debemos detenernos al encontrar
       * <numero_autorizacion>.pdf, porque también
       * pueden existir PDFs con otros nombres cuyo
       * contenido referencia la misma autorización.
       *
       * Unimos ambas fuentes y deduplicamos por el
       * identificador canónico del archivo en Drive.
       */
      const evidenceByDriveFileId =
        new Map<
          string,
          BillingAuditDriveEvidence
        >();


      for (
        const evidence
        of [
          ...exactEvidence,
          ...contentEvidence,
        ]
      ) {
        evidenceByDriveFileId.set(
          evidence.driveFileId,
          evidence,
        );
      }


      return [
        ...evidenceByDriveFileId.values(),
      ];
    } catch (
      error
    ) {
      if (
        error instanceof
          InternalServerErrorException
      ) {
        throw error;
      }


      throw new BadGatewayException({
        code:
          'AUTHORIZATION_BILLING_AUDIT_DRIVE_ERROR',

        message:
          'No fue posible consultar los soportes en Google Drive.',
      });
    }
  }


  async downloadEvidence(
    fileId:
      string,
  ): Promise<
    Readable
  > {
    const credentialFile =
      this.config
        .GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE;


    if (
      !credentialFile
      ||
      !existsSync(
        credentialFile,
      )
    ) {
      throw new InternalServerErrorException({
        code:
          'AUTHORIZATION_BILLING_AUDIT_DRIVE_NOT_CONFIGURED',

        message:
          'Google Drive no está configurado para auditoría de facturación.',
      });
    }


    try {
      const auth =
        new google.auth.GoogleAuth({
          keyFile:
            credentialFile,

          scopes: [
            'https://www.googleapis.com/auth/drive.readonly',
          ],
        });


      const drive =
        google.drive({
          version:
            'v3',

          auth,
        });


      const response =
        await drive.files.get(
          {
            fileId,

            alt:
              'media',

            supportsAllDrives:
              true,
          },

          {
            responseType:
              'stream',
          },
        );


      return response.data as unknown as Readable;
    } catch (
      error
    ) {
      if (
        error instanceof
          InternalServerErrorException
      ) {
        throw error;
      }


      throw new BadGatewayException({
        code:
          'AUTHORIZATION_BILLING_AUDIT_DRIVE_ERROR',

        message:
          'No fue posible descargar el soporte desde Google Drive.',
      });
    }
  }


  private rootIds():
    readonly string[] {
    const roots =
      [
        this.config
          .GOOGLE_DRIVE_AUDIT_ROOT_FOLDER_ID
          ??
          '',

        ...(
          this.config
            .GOOGLE_DRIVE_AUDIT_ROOT_FOLDER_IDS
          ??
          ''
        )
          .split(
            ',',
          ),
      ]
        .map(
          (
            value,
          ) =>
            value.trim(),
        )
        .filter(
          Boolean,
        );


    return [
      ...new Set(
        roots,
      ),
    ];
  }


  private async searchCandidates(
    drive:
      drive_v3.Drive,

    query:
      string,
  ): Promise<
    drive_v3.Schema$File[]
  > {
    const candidates:
      drive_v3.Schema$File[] =
        [];


    let pageToken:
      string | undefined;


    do {
      const params:
        drive_v3.Params$Resource$Files$List =
        {
          q:
            query,

          fields:
            'nextPageToken,files(id,name,mimeType,webViewLink,size,md5Checksum,modifiedTime,parents)',

          pageSize:
            100,

          spaces:
            'drive',

          supportsAllDrives:
            true,

          includeItemsFromAllDrives:
            true,
        };


      if (
        pageToken
      ) {
        params.pageToken =
          pageToken;
      }


      const response =
        await drive.files.list(
          params,
        );


      candidates.push(
        ...(
          response.data.files
          ??
          []
        ),
      );


      pageToken =
        response.data.nextPageToken
        ??
        undefined;
    } while (
      pageToken
    );


    return candidates;
  }


  private async acceptCandidates(
    drive:
      drive_v3.Drive,

    candidates:
      readonly drive_v3.Schema$File[],

    rootIds:
      readonly string[],
  ): Promise<
    BillingAuditDriveEvidence[]
  > {
    const parentCache =
      new Map<
        string,
        readonly string[]
      >();


    const allowedRoots =
      new Set(
        rootIds,
      );


    const accepted:
      BillingAuditDriveEvidence[] =
        [];


    const seen =
      new Set<
        string
      >();


    for (
      const file
      of candidates
    ) {
      if (
        !file.id
        ||
        seen.has(
          file.id,
        )
        ||
        file.mimeType !==
          'application/pdf'
      ) {
        continue;
      }


      const belongs =
        await this.belongsToRoots(
          drive,

          file.parents
          ??
          [],

          allowedRoots,

          parentCache,
        );


      if (
        !belongs
      ) {
        continue;
      }


      seen.add(
        file.id,
      );


      const parsedSize =
        file.size ==
          null
          ? null
          : Number(
              file.size,
            );


      accepted.push({
        driveFileId:
          file.id,

        fileName:
          file.name
          ??
          `${file.id}.pdf`,

        mimeType:
          file.mimeType
          ??
          null,

        webViewLink:
          file.webViewLink
          ??
          `https://drive.google.com/file/d/${file.id}/view`,

        sizeBytes:
          parsedSize !==
            null
          &&
          Number.isSafeInteger(
            parsedSize,
          )
          &&
          parsedSize >=
            0
            ? parsedSize
            : null,

        md5Checksum:
          file.md5Checksum
          ??
          null,

        driveModifiedAt:
          file.modifiedTime
          ??
          null,
      });
    }


    return accepted;
  }


  private async belongsToRoots(
    drive:
      drive_v3.Drive,

    initialParents:
      readonly string[],

    rootIds:
      ReadonlySet<
        string
      >,

    cache:
      Map<
        string,
        readonly string[]
      >,
  ): Promise<
    boolean
  > {
    const queue =
      [
        ...initialParents,
      ];


    const visited =
      new Set<
        string
      >();


    while (
      queue.length >
        0
    ) {
      const current =
        queue.shift();


      if (
        !current
      ) {
        continue;
      }


      if (
        rootIds.has(
          current,
        )
      ) {
        return true;
      }


      if (
        visited.has(
          current,
        )
      ) {
        continue;
      }


      visited.add(
        current,
      );


      if (
        visited.size >
          50
      ) {
        return false;
      }


      let parents =
        cache.get(
          current,
        );


      if (
        !parents
      ) {
        const response =
          await drive.files.get({
            fileId:
              current,

            fields:
              'id,parents',

            supportsAllDrives:
              true,
          });


        parents =
          response.data.parents
          ??
          [];


        cache.set(
          current,
          parents,
        );
      }


      for (
        const parent
        of parents
      ) {
        if (
          !visited.has(
            parent,
          )
        ) {
          queue.push(
            parent,
          );
        }
      }
    }


    return false;
  }


  private escapeQueryLiteral(
    value:
      string,
  ): string {
    return value
      .replaceAll(
        '\\',
        '\\\\',
      )
      .replaceAll(
        "'",
        "\\'",
      );
  }
}
