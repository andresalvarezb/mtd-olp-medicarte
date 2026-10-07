import {
  BadGatewayException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import type { ApiConfig } from '@authorization/config';
import { existsSync } from 'node:fs';
import type { Readable } from 'node:stream';
import { google, type drive_v3 } from 'googleapis';

import { API_CONFIG } from '../tokens';

export type BillingAuditDriveEvidence = Readonly<{
  driveFileId: string;
  fileName: string;
  mimeType: string | null;
  webViewLink: string | null;
  sizeBytes: number | null;
  md5Checksum: string | null;
  driveModifiedAt: string | null;
}>;

@Injectable()
export class AuthorizationBillingAuditDriveService {
  constructor(
    @Inject(API_CONFIG)
    private readonly config: ApiConfig,
  ) {}

  async findEvidence(authorizationNumber: string): Promise<BillingAuditDriveEvidence[]> {
    const rootId = this.config.GOOGLE_DRIVE_AUDIT_ROOT_FOLDER_ID;

    const credentialFile = this.config.GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE;

    if (!rootId || !credentialFile || !existsSync(credentialFile)) {
      throw new InternalServerErrorException({
        code: 'AUTHORIZATION_BILLING_AUDIT_DRIVE_NOT_CONFIGURED',
        message: 'Google Drive no está configurado para auditoría de facturación.',
      });
    }

    try {
      const auth = new google.auth.GoogleAuth({
        keyFile: credentialFile,
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      });

      const drive = google.drive({
        version: 'v3',
        auth,
      });

      const targetName = `${authorizationNumber}.pdf`;

      const escapedName = this.escapeQueryLiteral(targetName);

      const candidates: drive_v3.Schema$File[] = [];

      let pageToken: string | undefined;

      do {
        const params: drive_v3.Params$Resource$Files$List = {
          q: `name = '${escapedName}' ` + `and trashed = false`,
          fields:
            'nextPageToken,files(id,name,mimeType,webViewLink,size,md5Checksum,modifiedTime,parents)',
          pageSize: 100,
          spaces: 'drive',
        };

        if (pageToken) {
          params.pageToken = pageToken;
        }

        const response = await drive.files.list(params);

        candidates.push(...(response.data.files ?? []));

        pageToken = response.data.nextPageToken ?? undefined;
      } while (pageToken);

      const parentCache = new Map<string, readonly string[]>();

      const accepted: BillingAuditDriveEvidence[] = [];

      for (const file of candidates) {
        if (!file.id || file.name !== targetName || file.mimeType !== 'application/pdf') {
          continue;
        }

        const belongs = await this.belongsToRoot(drive, file.parents ?? [], rootId, parentCache);

        if (!belongs) {
          continue;
        }

        const parsedSize = file.size == null ? null : Number(file.size);

        accepted.push({
          driveFileId: file.id,
          fileName: file.name,
          mimeType: file.mimeType ?? null,
          webViewLink: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
          sizeBytes:
            parsedSize !== null && Number.isSafeInteger(parsedSize) && parsedSize >= 0
              ? parsedSize
              : null,
          md5Checksum: file.md5Checksum ?? null,
          driveModifiedAt: file.modifiedTime ?? null,
        });
      }

      return accepted;
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }

      throw new BadGatewayException({
        code: 'AUTHORIZATION_BILLING_AUDIT_DRIVE_ERROR',
        message: 'No fue posible consultar los soportes en Google Drive.',
      });
    }
  }

  async downloadEvidence(
    fileId: string,
  ): Promise<Readable> {
    const credentialFile =
      this.config.GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE;

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


  private async belongsToRoot(
    drive: drive_v3.Drive,
    initialParents: readonly string[],
    rootId: string,
    cache: Map<string, readonly string[]>,
  ): Promise<boolean> {
    const queue = [...initialParents];

    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift();

      if (!current) {
        continue;
      }

      if (current === rootId) {
        return true;
      }

      if (visited.has(current)) {
        continue;
      }

      visited.add(current);

      if (visited.size > 50) {
        return false;
      }

      let parents = cache.get(current);

      if (!parents) {
        const response = await drive.files.get({
          fileId: current,
          fields: 'id,parents',
          supportsAllDrives: true,
        });

        parents = response.data.parents ?? [];

        cache.set(current, parents);
      }

      for (const parent of parents) {
        if (!visited.has(parent)) {
          queue.push(parent);
        }
      }
    }

    return false;
  }

  private escapeQueryLiteral(value: string): string {
    return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
  }
}
