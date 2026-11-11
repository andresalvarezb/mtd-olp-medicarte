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
    const runStartedAt = performance.now();

    if (
      !this.config
        .GOOGLE_DRIVE_AUDIT_SYNC_ENABLED
    ) {
      return;
    }


    if (
      this.config
        .GOOGLE_DRIVE_AUDIT_SYNC_CHANGE_FEED_ENABLED
    ) {
      await this.runChangeFeed();
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


    const poolConnectStartedAt =
      performance.now();

    const lockClient =
      await this.database.pool.connect();

    const poolConnectionAcquireMs =
      Math.round(
        performance.now()
        -
        poolConnectStartedAt,
      );

    let lockAcquiredAt:
      number | null =
        null;

    let candidateSelectionMs =
      0;

    let batchStats:
      {
        selected: number;
        processed: number;
        failures: number;
        evidenceFound: number;
      }
      | null =
        null;

    let batchStatus:
      'completed' | 'failed' =
        'completed';


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


      lockAcquiredAt =
        performance.now();


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


        const candidateSelectionStartedAt =
          performance.now();

        const candidates =
          await this.findCandidates();

        candidateSelectionMs =
          Math.round(
            performance.now()
            -
            candidateSelectionStartedAt,
          );


        if (
          candidates.length ===
            0
        ) {
          return;
        }


        const stats =
          {
            selected:
              candidates.length,

            processed:
              0,

            failures:
              0,

            evidenceFound:
              0,
          };

        batchStats =
          stats;


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


                  stats.processed +=
                    1;

                  stats.evidenceFound +=
                    evidence.length;
                } catch (
                  error
                ) {
                  stats.failures +=
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


        try {
          await Promise.all(
            workers,
          );
        } catch (error) {
          batchStatus =
            'failed';

          throw error;
        }
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


        if (
          batchStats
          &&
          lockAcquiredAt !== null
        ) {
          this.logger.info(
            {
              ...batchStats,

              status:
                batchStatus,

              scope:
                this.config
                  .GOOGLE_DRIVE_AUDIT_SYNC_SCOPE,

              poolConnectionAcquireMs,

              candidateSelectionMs,

              durationMs:
                Math.round(
                  performance.now()
                  -
                  runStartedAt,
                ),

              lockHeldMs:
                Math.round(
                  performance.now()
                  -
                  lockAcquiredAt,
                ),
            },
            batchStatus === 'completed'
              ? 'authorization drive support sync batch completed'
              : 'authorization drive support sync batch failed',
          );
        }
      }
    } finally {
      lockClient.release();
    }
  }


  private async runChangeFeed(): Promise<void> {
    const rootIds = this.rootIds();
    const credentialFile = this.config.GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE;
    if (rootIds.length === 0 || !credentialFile || !existsSync(credentialFile)) {
      this.logger.error(
        { credentialFile: credentialFile ?? null, rootCount: rootIds.length },
        'authorization drive change feed is not configured',
      );
      return;
    }

    const due = await this.database.pool.query<{ should_run: boolean; has_cursor: boolean }>(
      `select
         exists (select 1 from authorization_drive_change_cursors) as has_cursor,
         not exists (select 1 from authorization_drive_change_cursors)
         or exists (select 1 from authorization_drive_change_cursors where next_poll_at <= now()) as should_run`,
    );
    if (!due.rows[0]?.should_run) return;

    const lockClient = await this.database.pool.connect();
    let lockAcquired = false;
    try {
      const lock = await lockClient.query<{ acquired: boolean }>(
        'select pg_try_advisory_lock($1::bigint) as acquired',
        [DRIVE_SUPPORT_SYNC_LOCK],
      );
      if (!lock.rows[0]?.acquired) return;
      lockAcquired = true;

      if (!due.rows[0]?.has_cursor) {
        await this.database.pool.query(
          `insert into authorization_drive_change_cursors (feed_key, drive_id, page_token)
           values ('bootstrap', null, 'pending')
           on conflict (feed_key) do nothing`,
        );
      }

      const auth = new google.auth.GoogleAuth({
        keyFile: credentialFile,
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      });
      const drive = google.drive({ version: 'v3', auth });
      const feeds = await this.getDriveFeeds(drive, rootIds);
      const totals = { pages: 0, changes: 0, matched: 0, ignored: 0, removed: 0 };

      for (const feed of feeds) {
        const cursor = await this.database.pool.query<{
          page_token: string;
          initial_backfill_complete: boolean;
          next_poll_at: Date;
        }>(
          'select page_token, initial_backfill_complete, next_poll_at from authorization_drive_change_cursors where feed_key = $1',
          [feed.feedKey],
        );
        if (cursor.rows[0] && cursor.rows[0].next_poll_at.getTime() > Date.now()) continue;
        let pageToken = cursor.rows[0]?.page_token;
        if (!pageToken) {
          const initial = await drive.changes.getStartPageToken({
            supportsAllDrives: true,
            ...(feed.driveId ? { driveId: feed.driveId } : {}),
          });
          const token = initial.data.startPageToken;
          if (!token) throw new Error('Google Drive returned no start page token');
          await this.database.pool.query(
            `insert into authorization_drive_change_cursors (feed_key, drive_id, page_token)
           values ($1, $2, $3)
           on conflict (feed_key) do nothing`,
            [feed.feedKey, feed.driveId, token],
          );
          pageToken = token;
          this.logger.info(
            { feedKey: feed.feedKey },
            'authorization drive change feed initialized',
          );
        }

        if (!cursor.rows[0]?.initial_backfill_complete) {
          if (feed.feedKey !== feeds[0]?.feedKey) {
            await this.database.pool.query(
              `update authorization_drive_change_cursors
             set initial_backfill_complete = true,
                 next_poll_at = now() + ($2::bigint * interval '1 millisecond'),
                 consecutive_failures = 0,
                 updated_at = now()
             where feed_key = $1`,
              [feed.feedKey, this.config.GOOGLE_DRIVE_AUDIT_SYNC_RECHECK_MS],
            );
            continue;
          }
          const candidates = await this.findCandidates();
          let processed = 0;
          let failures = 0;
          for (const candidate of candidates) {
            try {
              const evidence = await this.findEvidence(
                candidate.authorization_number,
                rootIds,
                drive,
              );
              await this.persistSuccess(candidate.id, evidence);
              processed += 1;
            } catch (error) {
              failures += 1;
              await this.persistFailure(candidate.id, error);
            }
          }
          const pendingRetry =
            candidates.length === 0
              ? await this.database.pool.query<{ pending: boolean }>(
                  `select exists (
                 select 1 from authorization_drive_support_sync
                 where last_error is not null and next_check_at > now()
               ) as pending`,
                )
              : null;
          const backfillComplete = candidates.length === 0 && !pendingRetry?.rows[0]?.pending;
          await this.database.pool.query(
            `update authorization_drive_change_cursors
             set initial_backfill_complete = $2,
                 next_poll_at = now() + ($3::bigint * interval '1 millisecond'),
                 consecutive_failures = 0,
                 updated_at = now()
             where feed_key = $1`,
            [
              feed.feedKey,
              backfillComplete,
              failures > 0 || pendingRetry?.rows[0]?.pending
                ? this.config.GOOGLE_DRIVE_AUDIT_SYNC_ERROR_RETRY_MS
                : this.config.GOOGLE_DRIVE_AUDIT_SYNC_RECHECK_MS,
            ],
          );
          this.logger.info(
            {
              feedKey: feed.feedKey,
              selected: candidates.length,
              processed,
              failures,
              completed: backfillComplete,
              batchSize: this.config.GOOGLE_DRIVE_AUDIT_SYNC_BATCH_SIZE,
            },
            'authorization drive initial backfill batch completed',
          );
          continue;
        }

        if (!pageToken) throw new Error('Google Drive change cursor is missing');
        while (true) {
          const requestedPageToken: string = pageToken;
          const response = await drive.changes.list({
            pageToken: requestedPageToken,
            pageSize: this.config.GOOGLE_DRIVE_AUDIT_SYNC_BATCH_SIZE,
            includeItemsFromAllDrives: true,
            supportsAllDrives: true,
            fields:
              'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,webViewLink,size,md5Checksum,modifiedTime,parents,driveId,trashed))',
            ...(feed.driveId ? { driveId: feed.driveId } : {}),
          });
          const changes = response.data.changes ?? [];
          const pageStats = await this.processChangePage(changes, rootIds, drive);
          totals.pages += 1;
          totals.changes += changes.length;
          totals.matched += pageStats.matched;
          totals.ignored += pageStats.ignored;
          totals.removed += pageStats.removed;

          const nextToken: string | undefined =
            response.data.nextPageToken ?? response.data.newStartPageToken ?? undefined;
          if (!nextToken) throw new Error('Google Drive returned no continuation token');
          await this.database.pool.query(
            `update authorization_drive_change_cursors
          set page_token = $2,
              updated_at = now()
           where feed_key = $1`,
            [feed.feedKey, nextToken],
          );
          pageToken = nextToken;
          if (!response.data.nextPageToken) break;
        }
      await this.database.pool.query(
        `update authorization_drive_change_cursors
         set next_poll_at = now() + ($2::bigint * interval '1 millisecond'),
             consecutive_failures = 0,
             updated_at = now()
         where feed_key = $1`,
        [feed.feedKey, this.config.GOOGLE_DRIVE_AUDIT_SYNC_RECHECK_MS],
      );
      }

      this.logger.info(
        {
          ...totals,
          feedCount: feeds.length,
          batchSize: this.config.GOOGLE_DRIVE_AUDIT_SYNC_BATCH_SIZE,
        },
        'authorization drive change feed sync completed',
      );
      await this.database.pool.query(
        "delete from authorization_drive_change_cursors where feed_key = 'bootstrap'",
      );
    } catch (error) {
      await this.database.pool.query(
        `update authorization_drive_change_cursors
         set next_poll_at = now() + (
               least(
                 $1::numeric * power(2::numeric, least(consecutive_failures, 8)),
                 greatest($1::numeric, $2::numeric)
               )::double precision * interval '1 millisecond'
             ),
             consecutive_failures = consecutive_failures + 1,
             updated_at = now()
         where next_poll_at <= now()`,
        [
          this.config.GOOGLE_DRIVE_AUDIT_SYNC_ERROR_RETRY_MS,
          this.config.GOOGLE_DRIVE_AUDIT_SYNC_ERROR_RETRY_MAX_MS,
        ],
      );
      throw error;
    } finally {
      if (lockAcquired) {
        await lockClient.query('select pg_advisory_unlock($1::bigint)', [DRIVE_SUPPORT_SYNC_LOCK]);
      }
      lockClient.release();
    }
  }

  private async getDriveFeeds(
    drive: drive_v3.Drive,
    rootIds: readonly string[],
  ): Promise<Array<{ feedKey: string; driveId: string | null }>> {
    const feeds = new Map<string, { feedKey: string; driveId: string | null }>();
    for (const rootId of rootIds) {
      const response = await drive.files.get({
        fileId: rootId,
        fields: 'id,driveId',
        supportsAllDrives: true,
      });
      const driveId = response.data.driveId ?? null;
      const feedKey = driveId ? `shared:${driveId}` : 'user';
      feeds.set(feedKey, { feedKey, driveId });
    }
    return [...feeds.values()];
  }

  private async processChangePage(
    changes: readonly drive_v3.Schema$Change[],
    rootIds: readonly string[],
    drive: drive_v3.Drive,
  ): Promise<{ matched: number; ignored: number; removed: number }> {
    const matches = new Map<string, { ids: Set<string>; authorizationNumber: string }>();
    const allowedRoots = new Set(rootIds);
    let ignored = 0;
    let removed = 0;

    for (const change of changes) {
      const fileId = change.fileId ?? change.file?.id;
      if (!fileId) {
        ignored += 1;
        continue;
      }
      const file = change.file;
      if (change.removed || file?.trashed) {
        await this.markDriveFileMissing(fileId);
        removed += 1;
        continue;
      }
      if (!file || file.mimeType !== 'application/pdf') {
        ignored += 1;
        continue;
      }

      if (!(await this.belongsToRoots(drive, file.parents ?? [], allowedRoots))) {
        await this.markDriveFileMissing(fileId);
        ignored += 1;
        continue;
      }

      const linked = await this.database.pool.query<{ id: string; authorization_number: string }>(
        `select ai.id, ai.numero_autorizacion as authorization_number
         from authorization_drive_supports support
         join authorization_items ai on ai.id = support.authorization_item_id
         where support.drive_file_id = $1`,
        [fileId],
      );
      let candidates = linked.rows;
      if (candidates.length === 0) {
        const authorizationNumber = file.name?.replace(/\.pdf$/i, '');
        if (!authorizationNumber || authorizationNumber === file.name) {
          ignored += 1;
          continue;
        }
        const result = await this.database.pool.query<{ id: string; authorization_number: string }>(
          `select id, numero_autorizacion as authorization_number
           from authorization_items
           where numero_autorizacion = $1`,
          [authorizationNumber],
        );
        candidates = result.rows;
      }
      if (candidates.length === 0) {
        ignored += 1;
        continue;
      }
      for (const candidate of candidates) {
        const entry = matches.get(candidate.authorization_number) ?? {
          ids: new Set<string>(),
          authorizationNumber: candidate.authorization_number,
        };
        entry.ids.add(candidate.id);
        matches.set(candidate.authorization_number, entry);
      }
    }

    for (const match of matches.values()) {
      const evidence = await this.findEvidence(match.authorizationNumber, rootIds, drive);
      for (const authorizationItemId of match.ids) {
        await this.persistSuccess(authorizationItemId, evidence);
      }
    }
    return { matched: matches.size, ignored, removed };
  }

  private async markDriveFileMissing(fileId: string): Promise<void> {
    await this.database.pool.query(
      `update authorization_drive_supports
       set is_present = false, missing_since = coalesce(missing_since, now()), updated_at = now()
       where drive_file_id = $1`,
      [fileId],
    );
  }

  private async findCandidates():
    Promise<Candidate[]> {
    const useRecentLoadScope =
      this.config
        .GOOGLE_DRIVE_AUDIT_SYNC_SCOPE ===
        'RECENT_10_DAYS';

    const recentLoadJoin =
      useRecentLoadScope
        ? `
          join import_batches recent_load
            on recent_load.id = ai.last_load_id
        `
        : '';

    const recentLoadFilter =
      useRecentLoadScope
        ? `
              or (
                $1::text = 'RECENT_10_DAYS'

                and recent_load.created_at >=
                  now() - interval '10 days'
              )
          `
        : '';

    const result =
      await this.database.pool.query<Candidate>(
        `
          select
            ai.id,

            ai.numero_autorizacion
              as authorization_number

          from
            authorization_items ai

          ${recentLoadJoin}

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

              ${recentLoadFilter}
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
          now() + ($2::bigint * interval '1 millisecond'),
          1,
          $4,
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
            now() + (
              least(
                $2::numeric * power(2::numeric, least(
                  authorization_drive_support_sync.consecutive_failures,
                  8
                )),
                greatest($2::numeric, $3::numeric)
              )::double precision * interval '1 millisecond'
            ),

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
        this.config.GOOGLE_DRIVE_AUDIT_SYNC_ERROR_RETRY_MS,
        this.config.GOOGLE_DRIVE_AUDIT_SYNC_ERROR_RETRY_MAX_MS,
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
