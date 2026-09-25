import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  LAUNCH_TOKEN_TTL_SECONDS,
  LaunchTokenErrorCode,
  LaunchTokenException,
} from './launch-token.errors';

/** Bytes of entropy per token. 32 bytes = 256 bits, base64url-encoded. */
const TOKEN_ENTROPY_BYTES = 32;

export interface IssueLaunchTokenInput {
  /**
   * Room the token launches into, if known. Null/omitted for the public room
   * browser path — §22.2: "a token minted for the public room browser has no
   * room until the user picks one".
   */
  roomId?: string | null;
}

export interface IssuedLaunchToken {
  /** The opaque token. Returned once, never retrievable again. */
  token: string;
  expiresAt: Date;
}

export interface ConsumeLaunchTokenInput {
  token: string;
  /** The authenticated user the token is being bound to. */
  userId: string;
  /**
   * When the caller is asserting a specific room, the token must match it.
   * Omit to accept whatever room the token carries (including none).
   */
  expectedRoomId?: string;
}

export interface ConsumedLaunchToken {
  /** Where the session launched from, or null for the room-browser path. */
  roomId: string | null;
}

/**
 * Issues and consumes Mini App launch tokens (Master TZ §22.2, v5.0 §29.2).
 *
 * The trust problem this solves: the Mini App must not be able to assert "I
 * belong to Room X" on its own. The bot mints a token server-side after it has
 * resolved the room itself, and the client can only present it back.
 *
 * Deliberately **not** exposed as an HTTP endpoint. Minting is a server-side
 * capability of the bot; a public mint endpoint would let anyone fabricate
 * launch context, which is precisely the attack the protocol exists to
 * prevent. The bot integration that calls `issue()` is a later phase (§43
 * phase 11); `consume()` is wired into `POST /auth/telegram` in the next slice.
 *
 * Possessing a token is never itself authorization to act — `consume()`
 * returns only where the session launched from. Join still runs the full
 * validation of §15.2.
 */
@Injectable()
export class LaunchTokenService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Mints a single-use launch token.
   *
   * The raw token is returned to the caller and never persisted; only its
   * SHA-256 hash is stored, so a database read cannot yield usable tokens.
   */
  async issue(input: IssueLaunchTokenInput): Promise<IssuedLaunchToken> {
    const token = randomBytes(TOKEN_ENTROPY_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + LAUNCH_TOKEN_TTL_SECONDS * 1000);

    await this.prisma.gameLaunchToken.create({
      data: {
        tokenHash: this.hash(token),
        roomId: input.roomId ?? null,
        expiresAt,
      },
    });

    return { token, expiresAt };
  }

  /**
   * Resolves a token to its room, binds it to the user, and marks it used.
   *
   * Rejection codes are OD-035's. The order of checks is deliberate:
   * ALREADY_USED is reported ahead of EXPIRED, because for a token that is
   * both consumed and past its TTL, "already used" is the more precise and
   * more actionable fact.
   */
  async consume(input: ConsumeLaunchTokenInput): Promise<ConsumedLaunchToken> {
    const tokenHash = this.hash(input.token);

    return this.prisma.$transaction(async (tx) => {
      const token = await tx.gameLaunchToken.findUnique({
        where: { tokenHash },
      });

      if (!token) {
        throw new LaunchTokenException(
          LaunchTokenErrorCode.NOT_FOUND,
          'Launch token topilmadi',
        );
      }

      if (token.usedAt) {
        throw new LaunchTokenException(
          LaunchTokenErrorCode.ALREADY_USED,
          'Launch token allaqachon ishlatilgan',
        );
      }

      if (token.expiresAt.getTime() <= Date.now()) {
        throw new LaunchTokenException(
          LaunchTokenErrorCode.EXPIRED,
          'Launch token muddati tugagan',
        );
      }

      // A roomless token never satisfies a request for a specific room: it
      // carries no claim about any room at all (§22.2).
      if (
        input.expectedRoomId !== undefined &&
        token.roomId !== input.expectedRoomId
      ) {
        throw new LaunchTokenException(
          LaunchTokenErrorCode.ROOM_MISMATCH,
          'Launch token boshqa xonaga tegishli',
        );
      }

      // The `usedAt: null` guard is the actual single-use gate. Two concurrent
      // consumers both pass the read above; only one updates a row here, and
      // the loser is reported as a replay — the same "guarded UPDATE decides
      // it" pattern the spec uses for Stars crediting (§25.4).
      const claimed = await tx.gameLaunchToken.updateMany({
        where: { id: token.id, usedAt: null },
        data: { usedAt: new Date(), consumedByUserId: input.userId },
      });

      if (claimed.count === 0) {
        throw new LaunchTokenException(
          LaunchTokenErrorCode.ALREADY_USED,
          'Launch token allaqachon ishlatilgan',
        );
      }

      return { roomId: token.roomId };
    });
  }

  /**
   * Deletes tokens that are past their TTL. Belongs to the janitor worker
   * (§35) once that phase lands; exposed here so it has something to call.
   */
  async pruneExpired(now: Date = new Date()): Promise<number> {
    const { count } = await this.prisma.gameLaunchToken.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    return count;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
