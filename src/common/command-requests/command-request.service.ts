import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Structurally covers both `PrismaService` and the `tx` object handed to a
 * `$transaction(async (tx) => ...)` callback — both expose `.commandRequest`.
 */
type CommandRequestClient = Pick<PrismaService, 'commandRequest'>;

export interface CommandRequestKey {
  userId: string;
  endpoint: string;
  clientRequestId: string;
}

export interface StoredCommandResponse {
  status: number;
  body: Prisma.JsonValue;
}

/**
 * Minimal idempotency store (Master TZ §19, v5.0 §23's `command_requests`
 * mechanism) — covers exactly what room creation and joining need. A
 * (userId, endpoint, clientRequestId) triple identifies one command attempt;
 * only a successful attempt's response is recorded, and a retry with the same
 * triple replays it instead of re-executing.
 *
 * Callers are responsible for running `findExisting` and `record` inside the
 * same lock/transaction as the command's own writes — this service holds no
 * lock of its own, and doesn't need one: uniqueness is the database's job.
 */
@Injectable()
export class CommandRequestService {
  async findExisting(
    client: CommandRequestClient,
    key: CommandRequestKey,
  ): Promise<StoredCommandResponse | null> {
    const existing = await client.commandRequest.findUnique({
      where: {
        userId_endpoint_clientRequestId: {
          userId: key.userId,
          endpoint: key.endpoint,
          clientRequestId: key.clientRequestId,
        },
      },
      select: { responseStatus: true, responseBody: true },
    });

    if (!existing) {
      return null;
    }

    return { status: existing.responseStatus, body: existing.responseBody };
  }

  async record(
    client: CommandRequestClient,
    key: CommandRequestKey,
    response: { status: number; body: Prisma.InputJsonValue },
  ): Promise<void> {
    await client.commandRequest.create({
      data: {
        userId: key.userId,
        endpoint: key.endpoint,
        clientRequestId: key.clientRequestId,
        responseStatus: response.status,
        responseBody: response.body,
      },
    });
  }
}
