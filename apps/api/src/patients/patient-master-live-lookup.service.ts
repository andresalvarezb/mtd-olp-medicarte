import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type {
  PatientMasterLiveLookupRequest,
  PatientMasterLiveLookupResponse,
} from '@authorization/contracts';
import {
  PATIENT_MASTER_LIVE_LOOKUP_CHANNEL,
  PATIENT_MASTER_LIVE_LOOKUP_TIMEOUT_MS,
  patientMasterLiveLookupWorkerResponseSchema,
} from '@authorization/contracts';
import Redis from 'ioredis';
import { REDIS } from '../tokens';

@Injectable()
export class PatientMasterLiveLookupService implements OnApplicationShutdown {
  private readonly publisher: Redis;

  constructor(@Inject(REDIS) redis: Redis) {
    this.publisher = redis.duplicate({ maxRetriesPerRequest: 1 });
  }

  async lookup(identity: PatientMasterLiveLookupRequest): Promise<PatientMasterLiveLookupResponse> {
    const requestId = randomUUID();
    const responseChannel = `authorization.patient-master.response.${requestId}`;
    const subscriber = this.publisher.duplicate({ maxRetriesPerRequest: 1 });
    const response = new Promise<PatientMasterLiveLookupResponse>((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve({ status: 'UNAVAILABLE' });
      }, PATIENT_MASTER_LIVE_LOOKUP_TIMEOUT_MS);
      const cleanup = () => {
        clearTimeout(timeout);
        void subscriber.unsubscribe(responseChannel).finally(() => void subscriber.quit());
      };
      subscriber.on('message', (channel, raw) => {
        if (channel !== responseChannel) return;
        let payload: unknown;
        try {
          payload = JSON.parse(raw) as unknown;
        } catch {
          return;
        }
        const parsed = patientMasterLiveLookupWorkerResponseSchema.safeParse(payload);
        if (!parsed.success || parsed.data.requestId !== requestId) return;
        cleanup();
        if (parsed.data.status === 'FOUND' && parsed.data.basicProfile) {
          resolve({ status: 'FOUND', basicProfile: parsed.data.basicProfile });
        } else if (parsed.data.status === 'FOUND') {
          resolve({ status: 'UNAVAILABLE' });
        } else {
          resolve({ status: parsed.data.status });
        }
      });
      void subscriber
        .subscribe(responseChannel)
        .then(async () => {
          await this.publisher.publish(
            PATIENT_MASTER_LIVE_LOOKUP_CHANNEL,
            JSON.stringify({
              requestId,
              responseChannel,
              identificationType: identity.identificationType,
              identificationValue: identity.identificationValue,
            }),
          );
        })
        .catch(() => {
          cleanup();
          resolve({ status: 'UNAVAILABLE' });
        });
    });
    return response;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.publisher.quit();
  }
}
