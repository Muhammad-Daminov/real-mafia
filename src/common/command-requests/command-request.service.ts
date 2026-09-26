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

  /**
   * A `record` call inside a `$transaction` callback that hits the unique
   * constraint on (userId, endpoint, clientRequestId) aborts the whole
   * Postgres transaction — every other write the callback made (the Room,
   * Game, GamePlayer rows) rolls back with it, and the transaction *and its
   * connection* are done; no further queries can run against it. So a
   * collision can't be resolved from inside the callback (a `SELECT` there
   * would just fail again with "current transaction is aborted"). Instead,
   * the caller wraps the whole `$transaction(...)` call: on rejection, this
   * re-reads the winner's stored response outside that dead transaction,
   * using a fresh query. Both the racing caller (loser) and this recovery
   * path observe the winner's byte-identical response — never a raw Prisma
   * error at the controller.
   *
   * Returns null if the error wasn't actually this collision (or the
   * replayed row can't be found for some other reason) — the caller should
   * then rethrow the original error unchanged.
   */
  async recoverReplay(
    client: CommandRequestClient,
    key: CommandRequestKey,
    error: unknown,
  ): Promise<StoredCommandResponse | null> {
    if (!this.isUniqueViolation(error)) {
      return null;
    }

    return this.findExisting(client, key);
  }

  isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'P2002'
    );
  }
}
