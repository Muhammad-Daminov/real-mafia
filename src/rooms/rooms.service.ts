import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import { Prisma, RulesetMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CommandRequestService } from '../common/command-requests/command-request.service';
import { RoomErrorCode, RoomException } from './rooms.errors';

/** Excludes 0/O, 1/I/L — a human types this code into a join box. */
const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const ROOM_CODE_LENGTH = 6;
const CODE_GENERATION_MAX_ATTEMPTS = 5;

const ENDPOINT_CREATE_ROOM = 'POST /rooms';
const ENDPOINT_JOIN_ROOM = 'POST /rooms/:code/join';

export interface CreateRoomInput {
  userId: string;
  clientRequestId: string;
  maxPlayers: number;
  rulesetMode: RulesetMode;
}

export interface CreatedRoom {
  roomId: string;
  code: string;
  gameId: string;
  maxPlayers: number;
  rulesetMode: RulesetMode;
}

export interface RoomSummary {
  roomId: string;
  code: string;
  visibility: string;
  status: string;
  rulesetMode: string;
  maxPlayers: number;
  gameId: string;
  gameStatus: string;
  playerCount: number;
}

export interface JoinRoomInput {
  userId: string;
  code: string;
  clientRequestId: string;
}

export interface JoinedRoom {
  roomId: string;
  gameId: string;
  playerId: string;
  playerCount: number;
  maxPlayers: number;
}

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commandRequests: CommandRequestService,
  ) {}

  /**
   * §15.1: creates the Room + its first Game (LOBBY), seats the creator as
   * GamePlayer and host. `HOST_ALREADY_HOSTING` is a SHOULD, implemented
   * here as a plain read (no row lock) — acceptable since it can't be
   * meaningfully true until a later slice can ever transition a Room to
   * IN_PROGRESS.
   */
  async createRoom(input: CreateRoomInput): Promise<CreatedRoom> {
    const key = {
      userId: input.userId,
      endpoint: ENDPOINT_CREATE_ROOM,
      clientRequestId: input.clientRequestId,
    };

    try {
      return await this.createRoomTransaction(input, key);
    } catch (error) {
      const replay = await this.commandRequests.recoverReplay(
        this.prisma,
        key,
        error,
      );

      if (replay) {
        return replay.body as unknown as CreatedRoom;
      }

      throw error;
    }
  }

  private async createRoomTransaction(
    input: CreateRoomInput,
    key: { userId: string; endpoint: string; clientRequestId: string },
  ): Promise<CreatedRoom> {
    return this.prisma.$transaction(async (tx) => {
      const replay = await this.commandRequests.findExisting(tx, key);

      if (replay) {
        return replay.body as unknown as CreatedRoom;
      }

      const alreadyHosting = await tx.room.findFirst({
        where: {
          status: 'IN_PROGRESS',
          activeGame: { host: { userId: input.userId } },
        },
        select: { id: true },
      });

      if (alreadyHosting) {
        throw new RoomException(
          RoomErrorCode.HOST_ALREADY_HOSTING,
          'Siz allaqachon boshqa xonani boshqaryapsiz',
        );
      }

      const room = await this.createRoomRowWithUniqueCode(tx, input);

      const game = await tx.game.create({
        data: { roomId: room.id },
      });

      const player = await tx.gamePlayer.create({
        data: { gameId: game.id, userId: input.userId },
      });

      await tx.game.update({
        where: { id: game.id },
        data: { hostPlayerId: player.id },
      });

      await tx.room.update({
        where: { id: room.id },
        data: { activeGameId: game.id },
      });

      const response: CreatedRoom = {
        roomId: room.id,
        code: room.code,
        gameId: game.id,
        maxPlayers: room.maxPlayers,
        rulesetMode: room.rulesetMode,
      };

      await this.commandRequests.record(tx, key, {
        status: 201,
        body: response as unknown as Prisma.InputJsonValue,
      });

      return response;
    });
  }

  /**
   * §15.2 step 2 narrowed to room resolution only. A CLOSED room is treated
   * identically to an unknown code — consistent with the partial unique index
   * on `rooms.code` (`WHERE status != 'CLOSED'`), and correct once the
   * janitor that releases codes after 24h (§8.5) exists, without needing to
   * special-case it here.
   */
  async getRoomByCode(code: string): Promise<RoomSummary> {
    const room = await this.resolveOpenRoom(this.prisma, code);

    const game = await this.prisma.game.findUniqueOrThrow({
      where: { id: room.activeGameId! },
    });

    const playerCount = await this.prisma.gamePlayer.count({
      where: { gameId: room.activeGameId! },
    });

    return {
      roomId: room.id,
      code: room.code,
      visibility: room.visibility,
      status: room.status,
      rulesetMode: room.rulesetMode,
      maxPlayers: room.maxPlayers,
      gameId: game.id,
      gameStatus: game.status,
      playerCount,
    };
  }

  /**
   * §15.2's validation pipeline: auth is the controller's guard; from here,
   * room resolvable -> row-locked game -> idempotent replay -> status=LOBBY
   * -> not already joined -> capacity -> insert.
   *
   * The `SELECT games FOR UPDATE` is §22.1's correctness boundary: every
   * concurrent join attempt against this game serializes on that lock before
   * touching game_players, which is what makes the capacity check race-free
   * (§19's "two players join simultaneously" scenario).
   */
  async joinRoom(input: JoinRoomInput): Promise<JoinedRoom> {
    const room = await this.resolveOpenRoom(this.prisma, input.code);
    const gameId = room.activeGameId!;
    const key = {
      userId: input.userId,
      endpoint: ENDPOINT_JOIN_ROOM,
      clientRequestId: input.clientRequestId,
    };

    try {
      return await this.joinRoomTransaction(input, room, gameId, key);
    } catch (error) {
      const replay = await this.commandRequests.recoverReplay(
        this.prisma,
        key,
        error,
      );

      if (replay) {
        return replay.body as unknown as JoinedRoom;
      }

      throw error;
    }
  }

  private async joinRoomTransaction(
    input: JoinRoomInput,
    room: { id: string; maxPlayers: number },
    gameId: string,
    key: { userId: string; endpoint: string; clientRequestId: string },
  ): Promise<JoinedRoom> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status FROM games WHERE id = ${gameId}::uuid FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new RoomException(RoomErrorCode.ROOM_NOT_FOUND, 'Xona topilmadi');
      }

      const replay = await this.commandRequests.findExisting(tx, key);

      if (replay) {
        return replay.body as unknown as JoinedRoom;
      }

      if (locked[0].status !== 'LOBBY') {
        throw new RoomException(
          RoomErrorCode.GAME_NOT_JOINABLE,
          'Bu o‘yinga endi qo‘shilib bo‘lmaydi',
        );
      }

      const existingPlayer = await tx.gamePlayer.findUnique({
        where: { gameId_userId: { gameId, userId: input.userId } },
        select: { id: true },
      });

      if (existingPlayer) {
        throw new RoomException(
          RoomErrorCode.PLAYER_ALREADY_JOINED,
          'Siz bu o‘yinga allaqachon qo‘shilgansiz',
        );
      }

      const playerCount = await tx.gamePlayer.count({ where: { gameId } });

      if (playerCount >= room.maxPlayers) {
        throw new RoomException(RoomErrorCode.GAME_FULL, 'O‘yin to‘lgan');
      }

      const player = await tx.gamePlayer.create({
        data: { gameId, userId: input.userId },
      });

      const response: JoinedRoom = {
        roomId: room.id,
        gameId,
        playerId: player.id,
        playerCount: playerCount + 1,
        maxPlayers: room.maxPlayers,
      };

      await this.commandRequests.record(tx, key, {
        status: 201,
        body: response as unknown as Prisma.InputJsonValue,
      });

      return response;
    });
  }

  /** Shared by getRoomByCode and joinRoom's pre-lock lookup. */
  private async resolveOpenRoom(
    client: Pick<PrismaService, 'room'>,
    code: string,
  ) {
    const room = await client.room.findFirst({
      where: { code, status: { not: 'CLOSED' } },
    });

    if (!room || !room.activeGameId) {
      throw new RoomException(RoomErrorCode.ROOM_NOT_FOUND, 'Xona topilmadi');
    }

    return room;
  }

  /**
   * The code space collision check is "the guarded INSERT decides it" — same
   * discipline as the launch-token/initData-replay guards elsewhere in this
   * codebase — rather than a pre-check-then-insert race.
   */
  private async createRoomRowWithUniqueCode(
    tx: Prisma.TransactionClient,
    input: CreateRoomInput,
  ) {
    for (let attempt = 0; attempt < CODE_GENERATION_MAX_ATTEMPTS; attempt += 1) {
      const code = this.randomCode();

      try {
        return await tx.room.create({
          data: {
            code,
            maxPlayers: input.maxPlayers,
            rulesetMode: input.rulesetMode,
            creatorUserId: input.userId,
          },
        });
      } catch (error) {
        const isLastAttempt = attempt === CODE_GENERATION_MAX_ATTEMPTS - 1;

        if (!this.isUniqueViolation(error) || isLastAttempt) {
          throw error;
        }
      }
    }

    throw new Error('Unreachable: loop always returns or throws');
  }

  private randomCode(): string {
    let code = '';

    for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
      code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    }

    return code;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'P2002'
    );
  }
}
