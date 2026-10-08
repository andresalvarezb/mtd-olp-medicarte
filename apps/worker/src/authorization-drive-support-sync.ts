import {
  existsSync,
} from 'node:fs';

import type {
  WorkerConfig,
} from '@authorization/config';

import type {
  createDatabase,
} from '@authorization/database';

import {
  google,
  type drive_v3,
} from 'googleapis';

import type {
  Logger,
} from 'pino';


type Database =
  ReturnType<
    typeof createDatabase
  >;


type Candidate =
  Readonly<{
    id:
      string;

    authorization_number:
      string;
  }>;


type DriveEvidence =
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


const DRIVE_SUPPORT_SYNC_LOCK =
  2_610_368_404;


export class AuthorizationDriveSupportSync {
  private readonly parentCache =
    new Map<
      string,
      readonly string[]
    >();


  constructor(
    private readonly config:
      WorkerConfig,

    private readonly database:
      Database,

    private readonly logger:
      Logger,
  ) {}


  async run(): Promise<void> {
    if (
      !this.config
        .GOOGLE_DRIVE_AUDIT_SYNC_ENABLED
    ) {
      return;
    }


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
      this.logger.error(
        {
          credentialFile:
            credentialFile
            ??
            null,

          rootCount:
            rootIds.length,
        },
        'authorization drive support sync is not configured',
      );

      return;
    }


    const lockClient =
      await this.database.pool.connect();


    try {
      const lock =
        await lockClient.query<{
          acquired:
            boolean;
        }>(
          `
            select
              pg_try_advisory_lock(
                $1::bigint
              )
                as acquired
          `,
          [
            DRIVE_SUPPORT_SYNC_LOCK,
          ],
        );


      if (
        !lock.rows[0]?.acquired
      ) {
        return;
      }


      try {
        /*
         * Un único cliente Drive por batch.
         *
         * Evita recrear autenticación por cada AUTO
         * y reduce carga durante el backfill.
         */
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


        const candidates =
          await this.findCandidates();


        if (
          candidates.length ===
            0
        ) {
          return;
        }


        let processed =
          0;

        let failures =
          0;

        let evidenceFound =
          0;


        let cursor =
          0;


        const workers =
          Array.from(
            {
              length:
                Math.min(
                  this.config
                    .GOOGLE_DRIVE_AUDIT_SYNC_CONCURRENCY,

                  candidates.length,
                ),
            },

            async () => {
              while (
                true
              ) {
                const index =
                  cursor++;


                if (
                  index >=
                    candidates.length
                ) {
                  return;
                }


                const candidate =
                  candidates[
                    index
                  ];


                if (
                  !candidate
                ) {
                  continue;
                }


                try {
                  const evidence =
                    await this.findEvidence(
                      candidate.authorization_number,
                      rootIds,
                      drive,
                    );


                  await this.persistSuccess(
                    candidate.id,
                    evidence,
                  );


                  processed +=
                    1;

                  evidenceFound +=
                    evidence.length;
                } catch (
                  error
                ) {
                  failures +=
                    1;


                  await this.persistFailure(
                    candidate.id,
                    error,
                  );


                  this.logger.warn(
                    {
                      authorizationItemId:
                        candidate.id,

                      authorizationNumber:
                        candidate.authorization_number,

                      error,
                    },
                    'authorization drive support sync item failed',
                  );
                }
              }
            },
          );


        await Promise.all(
          workers,
        );


        this.logger.info(
          {
            selected:
              candidates.length,

            processed,

            failures,

            evidenceFound,

            scope:
              this.config
                .GOOGLE_DRIVE_AUDIT_SYNC_SCOPE,
          },
          'authorization drive support sync batch completed',
        );
      } finally {
        await lockClient.query(
          `
            select
              pg_advisory_unlock(
                $1::bigint
              )
          `,
          [
            DRIVE_SUPPORT_SYNC_LOCK,
          ],
        );
      }
    } finally {
      lockClient.release();
    }
  }


  private async findCandidates():
    Promise<Candidate[]> {
    const result =
      await this.database.pool.query<Candidate>(
        `
          select
            ai.id,

            ai.numero_autorizacion
              as authorization_number

          from
            authorization_items ai

          left join
            authorization_drive_support_sync sync
              on sync.authorization_item_id =
                 ai.id

          where
            length(
              btrim(
                coalesce(
                  ai.numero_autorizacion,
                  ''
                )
              )
            ) > 0

            and (
              sync.authorization_item_id
                is null

              or

              sync.next_check_at
                <= now()
            )

            and (
              $1::text =
                'ALL'

              or (
                $1::text =
                  'CLOSED_ONLY'

                and

                case
                  when
                    btrim(
                      coalesce(
                        ai.source_data
                          ->>
                          'CANTIDAD',
                        ''
                      )
                    )
                    ~
                    '^[1-9][0-9]*$'

                  then
                    (
                      ai.source_data
                        ->>
                        'CANTIDAD'
                    )::int

                  else
                    0
                end
                >
                0

                and

                greatest(
                  coalesce(
                    (
                      select
                        sum(
                          af.quantity
                        )::int

                      from
                        authorization_fulfillments af

                      where
                        af.authorization_item_id =
                          ai.id
                    ),
                    0
                  ),

                  coalesce(
                    (
                      select
                        sum(
                          pal.quantity
                        )::int

                      from
                        patient_applications pa

                      join
                        patient_application_lines pal
                          on pal.patient_application_id =
                             pa.id

                      where
                        pa.authorization_item_id =
                          ai.id

                        and pa.status =
                          'CONFIRMED'
                    ),
                    0
                  ),

                  coalesce(
                    (
                      select
                        sum(
                          iaa.consumed_quantity
                        )::int

                      from
                        inventory_authorization_allocations iaa

                      where
                        iaa.authorization_item_id =
                          ai.id
                    ),
                    0
                  )
                )
                >=
                case
                  when
                    btrim(
                      coalesce(
                        ai.source_data
                          ->>
                          'CANTIDAD',
                        ''
                      )
                    )
                    ~
                    '^[1-9][0-9]*$'

                  then
                    (
                      ai.source_data
                        ->>
                        'CANTIDAD'
                    )::int

                  else
                    0
                end
              )
            )

          order by
            sync.last_checked_at
              asc nulls first,

            ai.created_at
              asc,

            ai.id
              asc

          limit
            $2
        `,
        [
          this.config
            .GOOGLE_DRIVE_AUDIT_SYNC_SCOPE,

          this.config
            .GOOGLE_DRIVE_AUDIT_SYNC_BATCH_SIZE,
        ],
      );


    return result.rows;
  }


  private async findEvidence(
    authorizationNumber:
      string,

    rootIds:
      readonly string[],

    drive:
      drive_v3.Drive,
  ): Promise<
    DriveEvidence[]
  > {
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


    const fullTextCandidates =
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


    const candidates =
      new Map<
        string,
        drive_v3.Schema$File
      >();


    for (
      const file
      of [
        ...exactCandidates,
        ...fullTextCandidates,
      ]
    ) {
      if (
        file.id
      ) {
        candidates.set(
          file.id,
          file,
        );
      }
    }


    const allowedRoots =
      new Set(
        rootIds,
      );


    const evidence:
      DriveEvidence[] =
        [];


    for (
      const file
      of candidates.values()
    ) {
      if (
        !file.id
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
        );


      if (
        !belongs
      ) {
        continue;
      }


      const parsedSize =
        file.size ==
          null
          ? null
          : Number(
              file.size,
            );


      evidence.push({
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


    return evidence;
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
      const response =
        await drive.files.list({
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

          ...(pageToken
            ? {
                pageToken,
              }
            : {}),
        });


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


  private async belongsToRoots(
    drive:
      drive_v3.Drive,

    initialParents:
      readonly string[],

    rootIds:
      ReadonlySet<string>,
  ): Promise<boolean> {
    const queue =
      [
        ...initialParents,
      ];


    const visited =
      new Set<string>();


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
        this.parentCache.get(
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


        if (
          this.parentCache.size >
            5_000
        ) {
          this.parentCache.clear();
        }


        this.parentCache.set(
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


  private async persistSuccess(
    authorizationItemId:
      string,

    files:
      readonly DriveEvidence[],
  ): Promise<void> {
    const client =
      await this.database.pool.connect();


    const nextCheckAt =
      new Date(
        Date.now()
        +
        this.config
          .GOOGLE_DRIVE_AUDIT_SYNC_RECHECK_MS,
      );


    try {
      await client.query(
        'begin',
      );


      /*
       * Primero marcamos como ausentes todos los
       * soportes conocidos.
       *
       * Los encontrados en esta ejecución se
       * reactivan inmediatamente después.
       *
       * No se elimina histórico.
       */
      await client.query(
        `
          update
            authorization_drive_supports

          set
            is_present =
              false,

            missing_since =
              coalesce(
                missing_since,
                now()
              ),

            updated_at =
              now()

          where
            authorization_item_id =
              $1
        `,
        [
          authorizationItemId,
        ],
      );


      for (
        const file
        of files
      ) {
        await client.query(
          `
            insert into
              authorization_drive_supports (
                authorization_item_id,
                drive_file_id,
                file_name,
                mime_type,
                web_view_link,
                size_bytes,
                md5_checksum,
                drive_modified_at,
                first_seen_at,
                last_seen_at,
                missing_since,
                is_present,
                created_at,
                updated_at
              )

            values (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              now(),
              now(),
              null,
              true,
              now(),
              now()
            )

            on conflict (
              authorization_item_id,
              drive_file_id
            )

            do update set
              file_name =
                excluded.file_name,

              mime_type =
                excluded.mime_type,

              web_view_link =
                excluded.web_view_link,

              size_bytes =
                excluded.size_bytes,

              md5_checksum =
                excluded.md5_checksum,

              drive_modified_at =
                excluded.drive_modified_at,

              last_seen_at =
                now(),

              missing_since =
                null,

              is_present =
                true,

              updated_at =
                now()
          `,
          [
            authorizationItemId,
            file.driveFileId,
            file.fileName,
            file.mimeType,
            file.webViewLink,
            file.sizeBytes,
            file.md5Checksum,
            file.driveModifiedAt,
          ],
        );
      }


      await client.query(
        `
          insert into
            authorization_drive_support_sync (
              authorization_item_id,
              support_status,
              evidence_count,
              last_checked_at,
              last_success_at,
              next_check_at,
              consecutive_failures,
              last_error,
              created_at,
              updated_at
            )

          values (
            $1,
            $2,
            $3,
            now(),
            now(),
            $4,
            0,
            null,
            now(),
            now()
          )

          on conflict (
            authorization_item_id
          )

          do update set
            support_status =
              excluded.support_status,

            evidence_count =
              excluded.evidence_count,

            last_checked_at =
              now(),

            last_success_at =
              now(),

            next_check_at =
              excluded.next_check_at,

            consecutive_failures =
              0,

            last_error =
              null,

            updated_at =
              now()
        `,
        [
          authorizationItemId,

          files.length >
            0
            ? 'WITH_SUPPORT'
            : 'WITHOUT_SUPPORT',

          files.length,

          nextCheckAt,
        ],
      );


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
  }


  private async persistFailure(
    authorizationItemId:
      string,

    error:
      unknown,
  ): Promise<void> {
    const nextCheckAt =
      new Date(
        Date.now()
        +
        this.config
          .GOOGLE_DRIVE_AUDIT_SYNC_ERROR_RETRY_MS,
      );


    const message =
      error instanceof Error
        ? error.message.slice(
            0,
            2_000,
          )
        : 'Unknown Google Drive synchronization error';


    await this.database.pool.query(
      `
        insert into
          authorization_drive_support_sync (
            authorization_item_id,
            support_status,
            evidence_count,
            last_checked_at,
            last_success_at,
            next_check_at,
            consecutive_failures,
            last_error,
            created_at,
            updated_at
          )

        values (
          $1,
          'UNKNOWN',
          0,
          now(),
          null,
          $2,
          1,
          $3,
          now(),
          now()
        )

        on conflict (
          authorization_item_id
        )

        do update set
          last_checked_at =
            now(),

          next_check_at =
            excluded.next_check_at,

          consecutive_failures =
            authorization_drive_support_sync.consecutive_failures
            +
            1,

          last_error =
            excluded.last_error,

          updated_at =
            now()
      `,
      [
        authorizationItemId,
        nextCheckAt,
        message,
      ],
    );
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
