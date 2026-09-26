import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import {
  GamePhaseName,
  GameStatus,
  LifeStatus,
  Prisma,
  RoomVisibility,
  RulesetMode,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CommandRequestService } from '../common/command-requests/command-request.service';
import { GameLifecycleService } from '../game-engine/game-lifecycle.service';
import { RoomErrorCode, RoomException } from './rooms.errors';
import {
  computePhaseDurationsSec,
  isLastWordEnabled,
  lookupRoleDistribution,
  MAX_PLAYERS_CEILING,
  MIN_PLAYERS_TO_START,
  RULES_VERSION,
} from './start-game.config';

/** Excludes 0/O, 1/I/L — a human types this code into a join box. */
const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const ROOM_CODE_LENGTH = 6;
const CODE_GENERATION_MAX_ATTEMPTS = 5;

const ENDPOINT_CREATE_ROOM = 'POST /rooms';
const ENDPOINT_JOIN_ROOM = 'POST /rooms/:code/join';
const ENDPOINT_LEAVE_ROOM = 'POST /rooms/:id/leave';
const ENDPOINT_SET_READY = 'POST /rooms/:id/ready';
const ENDPOINT_TRANSFER_HOST = 'POST /rooms/:id/host-transfer';
const ENDPOINT_START_GAME = 'POST /rooms/:id/start';

/** A GamePlayer counts toward capacity/roster only while not LEFT (OD-037). */
const ACTIVE_PLAYER_FILTER = { not: LifeStatus.LEFT };

export interface CreateRoomInput {
  userId: string;
  clientRequestId: string;
  maxPlayers: number;
  rulesetMode: RulesetMode;
  /** OD-039: optional, defaults to PRIVATE — the DTO already applies this
   * default for the real endpoint; this mirrors it for direct callers. */
  visibility?: RoomVisibility;
}

export interface CreatedRoom {
  roomId: string;
  code: string;
  gameId: string;
  maxPlayers: number;
  rulesetMode: RulesetMode;
  visibility: RoomVisibility;
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

export interface LeaveRoomInput {
  userId: string;
  roomId: string;
  clientRequestId: string;
}

export interface LeftRoom {
  roomId: string;
  gameId: string;
  playerId: string;
  playerCount: number;
  newHostPlayerId: string | null;
  roomClosed: boolean;
}

export interface SetReadyInput {
  userId: string;
  roomId: string;
  clientRequestId: string;
  isReady: boolean;
}

export interface ReadySet {
  roomId: string;
  gameId: string;
  playerId: string;
  isReady: boolean;
}

export interface TransferHostInput {
  userId: string;
  roomId: string;
  clientRequestId: string;
  targetPlayerId: string;
}

export interface HostTransferred {
  roomId: string;
  gameId: string;
  previousHostPlayerId: string;
  newHostPlayerId: string;
}

export interface ListPublicRoomsInput {
  page: number;
  limit: number;
}

/** OD-038: deliberately excludes creatorUserId and any host/user identity. */
export interface PublicRoomSummary {
  roomId: string;
  code: string;
  maxPlayers: number;
  rulesetMode: RulesetMode;
  playerCount: number;
  createdAt: Date;
}

export interface PublicRoomsPage {
  rooms: PublicRoomSummary[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

export interface StartGameInput {
  userId: string;
  roomId: string;
  clientRequestId: string;
}

/**
 * OD-040 (Slice 1): status/phase transition + frozen config only — no role
 * rows. `startedAt` is an ISO string, not a `Date`: the response crosses a
 * JSON boundary either way (HTTP, and the CommandRequest replay store), so a
 * `Date` here would silently become a string on replay while staying a `Date`
 * on the first call — this keeps both paths identical.
 */
export interface GameStarted {
  roomId: string;
  gameId: string;
  status: GameStatus;
  currentPhase: GamePhaseName;
  playerCount: number;
  rulesVersion: string;
  startedAt: string;
}

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commandRequests: CommandRequestService,
    private readonly gameLifecycle: GameLifecycleService,
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
        visibility: room.visibility,
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
    const room = await this.resolveOpenRoomByCode(this.prisma, code);

    const game = await this.prisma.game.findUniqueOrThrow({
      where: { id: room.activeGameId! },
    });

    const playerCount = await this.prisma.gamePlayer.count({
      where: { gameId: room.activeGameId!, lifeStatus: ACTIVE_PLAYER_FILTER },
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
   * §8.2 / OD-038: the public room browser. Read-only — no idempotency, no
   * row lock (§19's transactional boundary is for state-changing commands;
   * there's nothing to serialize here). "Open with free slots" is
   * `Room.status = OPEN AND Game.status = LOBBY AND playerCount < maxPlayers`,
   * where playerCount excludes LEFT players per the OD-037 convention. Backed
   * by the `(visibility, status, createdAt DESC)` index added in this slice's
   * migration — the equality filter and the ORDER BY are both covered by one
   * index scan, so only the (typically small) set of currently-open public
   * rooms is ever aggregated/sorted, not the whole `rooms` table.
   */
  async listPublicRooms(input: ListPublicRoomsInput): Promise<PublicRoomsPage> {
    const offset = (input.page - 1) * input.limit;

    const [rows, totalRows] = await Promise.all([
      this.prisma.$queryRaw<
        {
          roomId: string;
          code: string;
          maxPlayers: number;
          rulesetMode: RulesetMode;
          createdAt: Date;
          playerCount: number;
        }[]
      >`
        SELECT
          r.id AS "roomId",
          r.code AS "code",
          r.max_players AS "maxPlayers",
          r.ruleset_mode AS "rulesetMode",
          r.created_at AS "createdAt",
          COUNT(gp.id) FILTER (WHERE gp.life_status != 'LEFT')::int AS "playerCount"
        FROM rooms r
        JOIN games g ON g.id = r.active_game_id
        LEFT JOIN game_players gp ON gp.game_id = g.id
        WHERE r.visibility = 'PUBLIC' AND r.status = 'OPEN' AND g.status = 'LOBBY'
        GROUP BY r.id, r.code, r.max_players, r.ruleset_mode, r.created_at
        HAVING COUNT(gp.id) FILTER (WHERE gp.life_status != 'LEFT') < r.max_players
        ORDER BY r.created_at DESC
        LIMIT ${input.limit} OFFSET ${offset}
      `,
      this.prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int AS "count" FROM (
          SELECT r.id
          FROM rooms r
          JOIN games g ON g.id = r.active_game_id
          LEFT JOIN game_players gp ON gp.game_id = g.id
          WHERE r.visibility = 'PUBLIC' AND r.status = 'OPEN' AND g.status = 'LOBBY'
          GROUP BY r.id, r.max_players
          HAVING COUNT(gp.id) FILTER (WHERE gp.life_status != 'LEFT') < r.max_players
        ) open_public_rooms
      `,
    ]);

    const totalCount = totalRows[0]?.count ?? 0;

    return {
      rooms: rows,
      page: input.page,
      limit: input.limit,
      totalCount,
      totalPages: Math.ceil(totalCount / input.limit),
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
    const room = await this.resolveOpenRoomByCode(this.prisma, input.code);
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

      const playerCount = await tx.gamePlayer.count({
        where: { gameId, lifeStatus: ACTIVE_PLAYER_FILTER },
      });

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

  /**
   * §15.3 / OD-037: leave is LOBBY-only, locks the game row (§6.3/§19), sets
   * the caller's GamePlayer to LEFT, and — if the caller was host — transfers
   * host per OD-013 (earliest joinedAt among remaining non-LEFT players), or
   * cancels the game and closes the room if no one remains (§8.5 mapping).
   */
  async leaveRoom(input: LeaveRoomInput): Promise<LeftRoom> {
    const room = await this.resolveOpenRoomById(this.prisma, input.roomId);
    const gameId = room.activeGameId!;
    const key = {
      userId: input.userId,
      endpoint: ENDPOINT_LEAVE_ROOM,
      clientRequestId: input.clientRequestId,
    };

    try {
      return await this.leaveRoomTransaction(input, room, gameId, key);
    } catch (error) {
      const replay = await this.commandRequests.recoverReplay(
        this.prisma,
        key,
        error,
      );

      if (replay) {
        return replay.body as unknown as LeftRoom;
      }

      throw error;
    }
  }

  private async leaveRoomTransaction(
    input: LeaveRoomInput,
    room: { id: string },
    gameId: string,
    key: { userId: string; endpoint: string; clientRequestId: string },
  ): Promise<LeftRoom> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status FROM games WHERE id = ${gameId}::uuid FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new RoomException(RoomErrorCode.ROOM_NOT_FOUND, 'Xona topilmadi');
      }

      const replay = await this.commandRequests.findExisting(tx, key);

      if (replay) {
        return replay.body as unknown as LeftRoom;
      }

      if (locked[0].status !== 'LOBBY') {
        throw new RoomException(
          RoomErrorCode.ROOM_NOT_IN_LOBBY,
          'Bu amal endi lobbi bosqichida emas',
        );
      }

      const game = await tx.game.findUniqueOrThrow({
        where: { id: gameId },
        select: { hostPlayerId: true },
      });

      const player = await tx.gamePlayer.findUnique({
        where: { gameId_userId: { gameId, userId: input.userId } },
      });

      if (!player || player.lifeStatus === LifeStatus.LEFT) {
        throw new RoomException(
          RoomErrorCode.PLAYER_NOT_IN_GAME,
          'Siz bu o‘yinda emassiz',
        );
      }

      await tx.gamePlayer.update({
        where: { id: player.id },
        data: { lifeStatus: LifeStatus.LEFT },
      });

      const wasHost = game.hostPlayerId === player.id;
      const remaining = await tx.gamePlayer.count({
        where: { gameId, lifeStatus: ACTIVE_PLAYER_FILTER },
      });

      let newHostPlayerId: string | null = null;
      let roomClosed = false;

      if (wasHost) {
        if (remaining === 0) {
          await tx.game.update({
            where: { id: gameId },
            data: { status: 'CANCELLED', hostPlayerId: null },
          });
          await tx.room.update({
            where: { id: room.id },
            data: { status: 'CLOSED' },
          });
          roomClosed = true;
        } else {
          const nextHost = await tx.gamePlayer.findFirstOrThrow({
            where: { gameId, lifeStatus: ACTIVE_PLAYER_FILTER },
            orderBy: { joinedAt: 'asc' },
            select: { id: true },
          });

          newHostPlayerId = nextHost.id;

          await tx.game.update({
            where: { id: gameId },
            data: { hostPlayerId: newHostPlayerId },
          });
        }
      }

      const response: LeftRoom = {
        roomId: room.id,
        gameId,
        playerId: player.id,
        playerCount: remaining,
        newHostPlayerId,
        roomClosed,
      };

      await this.commandRequests.record(tx, key, {
        status: 200,
        body: response as unknown as Prisma.InputJsonValue,
      });

      return response;
    });
  }

  /**
   * §15.3 / OD-037 (OD-014): display-only readiness signal. LOBBY-only,
   * lock-protected for the same §6.3/§19 reason as every other room command.
   */
  async setReady(input: SetReadyInput): Promise<ReadySet> {
    const room = await this.resolveOpenRoomById(this.prisma, input.roomId);
    const gameId = room.activeGameId!;
    const key = {
      userId: input.userId,
      endpoint: ENDPOINT_SET_READY,
      clientRequestId: input.clientRequestId,
    };

    try {
      return await this.setReadyTransaction(input, room, gameId, key);
    } catch (error) {
      const replay = await this.commandRequests.recoverReplay(
        this.prisma,
        key,
        error,
      );

      if (replay) {
        return replay.body as unknown as ReadySet;
      }

      throw error;
    }
  }

  private async setReadyTransaction(
    input: SetReadyInput,
    room: { id: string },
    gameId: string,
    key: { userId: string; endpoint: string; clientRequestId: string },
  ): Promise<ReadySet> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status FROM games WHERE id = ${gameId}::uuid FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new RoomException(RoomErrorCode.ROOM_NOT_FOUND, 'Xona topilmadi');
      }

      const replay = await this.commandRequests.findExisting(tx, key);

      if (replay) {
        return replay.body as unknown as ReadySet;
      }

      if (locked[0].status !== 'LOBBY') {
        throw new RoomException(
          RoomErrorCode.ROOM_NOT_IN_LOBBY,
          'Bu amal endi lobbi bosqichida emas',
        );
      }

      const player = await tx.gamePlayer.findUnique({
        where: { gameId_userId: { gameId, userId: input.userId } },
      });

      if (!player || player.lifeStatus === LifeStatus.LEFT) {
        throw new RoomException(
          RoomErrorCode.PLAYER_NOT_IN_GAME,
          'Siz bu o‘yinda emassiz',
        );
      }

      const updated = await tx.gamePlayer.update({
        where: { id: player.id },
        data: { isReady: input.isReady },
      });

      const response: ReadySet = {
        roomId: room.id,
        gameId,
        playerId: updated.id,
        isReady: updated.isReady,
      };

      await this.commandRequests.record(tx, key, {
        status: 200,
        body: response as unknown as Prisma.InputJsonValue,
      });

      return response;
    });
  }

  /**
   * §15.3 / OD-037 (OD-013): explicit host handoff, distinct from leave's
   * automatic transfer. Only the current host may call it; re-checked inside
   * the lock so a second, now-stale concurrent transfer is rejected rather
   * than raced. Target lookup is IDOR-safe (`WHERE id = :targetId AND
   * game_id = :gameId`, per §17.3's pattern), never a bare id lookup.
   */
  async transferHost(input: TransferHostInput): Promise<HostTransferred> {
    const room = await this.resolveOpenRoomById(this.prisma, input.roomId);
    const gameId = room.activeGameId!;
    const key = {
      userId: input.userId,
      endpoint: ENDPOINT_TRANSFER_HOST,
      clientRequestId: input.clientRequestId,
    };

    try {
      return await this.transferHostTransaction(input, room, gameId, key);
    } catch (error) {
      const replay = await this.commandRequests.recoverReplay(
        this.prisma,
        key,
        error,
      );

      if (replay) {
        return replay.body as unknown as HostTransferred;
      }

      throw error;
    }
  }

  private async transferHostTransaction(
    input: TransferHostInput,
    room: { id: string },
    gameId: string,
    key: { userId: string; endpoint: string; clientRequestId: string },
  ): Promise<HostTransferred> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status FROM games WHERE id = ${gameId}::uuid FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new RoomException(RoomErrorCode.ROOM_NOT_FOUND, 'Xona topilmadi');
      }

      const replay = await this.commandRequests.findExisting(tx, key);

      if (replay) {
        return replay.body as unknown as HostTransferred;
      }

      if (locked[0].status !== 'LOBBY') {
        throw new RoomException(
          RoomErrorCode.ROOM_NOT_IN_LOBBY,
          'Bu amal endi lobbi bosqichida emas',
        );
      }

      const game = await tx.game.findUniqueOrThrow({
        where: { id: gameId },
        select: { hostPlayerId: true },
      });

      const caller = await tx.gamePlayer.findUnique({
        where: { gameId_userId: { gameId, userId: input.userId } },
        select: { id: true },
      });

      if (!caller || game.hostPlayerId !== caller.id) {
        throw new RoomException(
          RoomErrorCode.NOT_HOST,
          'Faqat xona egasi buni bajara oladi',
        );
      }

      let newHostPlayerId = caller.id;

      if (input.targetPlayerId !== caller.id) {
        const target = await tx.gamePlayer.findFirst({
          where: {
            id: input.targetPlayerId,
            gameId,
            lifeStatus: ACTIVE_PLAYER_FILTER,
          },
          select: { id: true },
        });

        if (!target) {
          throw new RoomException(
            RoomErrorCode.TARGET_NOT_IN_GAME,
            'Belgilangan o‘yinchi topilmadi',
          );
        }

        newHostPlayerId = target.id;

        await tx.game.update({
          where: { id: gameId },
          data: { hostPlayerId: newHostPlayerId },
        });
      }

      const response: HostTransferred = {
        roomId: room.id,
        gameId,
        previousHostPlayerId: caller.id,
        newHostPlayerId,
      };

      await this.commandRequests.record(tx, key, {
        status: 200,
        body: response as unknown as Prisma.InputJsonValue,
      });

      return response;
    });
  }

  /**
   * §10.2/§13.2/§14 / OD-040 — Slice 1: validation + status/phase transition
   * only. No role assignment happens here (no such table exists yet; Slice 2
   * owns that). Host-only, LOBBY-only, playerCount >= MIN_PLAYERS_TO_START
   * (OD-014: readiness never gates this). Transitions Game LOBBY->RUNNING /
   * LOBBY->ROLE_REVEAL, seats every active player as ALIVE, freezes
   * rulesVersion + a config_snapshot subset into the row, and flips Room to
   * IN_PROGRESS (§8.5) — which is also what makes HOST_ALREADY_HOSTING and
   * GET /rooms/public's exclusion of started rooms reachable for real.
   */
  async startGame(input: StartGameInput): Promise<GameStarted> {
    const room = await this.resolveOpenRoomById(this.prisma, input.roomId);
    const gameId = room.activeGameId!;
    const key = {
      userId: input.userId,
      endpoint: ENDPOINT_START_GAME,
      clientRequestId: input.clientRequestId,
    };

    try {
      return await this.startGameTransaction(input, room, gameId, key);
    } catch (error) {
      const replay = await this.commandRequests.recoverReplay(
        this.prisma,
        key,
        error,
      );

      if (replay) {
        return replay.body as unknown as GameStarted;
      }

      throw error;
    }
  }

  private async startGameTransaction(
    input: StartGameInput,
    room: { id: string; rulesetMode: RulesetMode },
    gameId: string,
    key: { userId: string; endpoint: string; clientRequestId: string },
  ): Promise<GameStarted> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status FROM games WHERE id = ${gameId}::uuid FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new RoomException(RoomErrorCode.ROOM_NOT_FOUND, 'Xona topilmadi');
      }

      const replay = await this.commandRequests.findExisting(tx, key);

      if (replay) {
        return replay.body as unknown as GameStarted;
      }

      if (locked[0].status !== 'LOBBY') {
        throw new RoomException(
          RoomErrorCode.ROOM_NOT_IN_LOBBY,
          'Bu amal endi lobbi bosqichida emas',
        );
      }

      const game = await tx.game.findUniqueOrThrow({
        where: { id: gameId },
        select: { hostPlayerId: true },
      });

      const caller = await tx.gamePlayer.findUnique({
        where: { gameId_userId: { gameId, userId: input.userId } },
        select: { id: true },
      });

      if (!caller || game.hostPlayerId !== caller.id) {
        throw new RoomException(
          RoomErrorCode.NOT_HOST,
          'Faqat xona egasi o‘yinni boshlay oladi',
        );
      }

      const activePlayers = await tx.gamePlayer.findMany({
        where: { gameId, lifeStatus: ACTIVE_PLAYER_FILTER },
        select: { id: true },
      });
      const playerCount = activePlayers.length;

      if (playerCount < MIN_PLAYERS_TO_START) {
        throw new RoomException(
          RoomErrorCode.NOT_ENOUGH_PLAYERS,
          `O‘yinni boshlash uchun kamida ${MIN_PLAYERS_TO_START} o‘yinchi kerak`,
        );
      }

      const roleDistribution = lookupRoleDistribution(playerCount);

      if (!roleDistribution) {
        // §13.2: unreachable given the 4-24 bounds enforced at join/create,
        // kept as defense-in-depth rather than an assumption.
        throw new RoomException(
          RoomErrorCode.CONFIG_INVALID,
          'O‘yinchilar soni uchun konfiguratsiya topilmadi',
        );
      }

      const startedAt = new Date();
      const phaseDurationsSec = computePhaseDurationsSec(
        room.rulesetMode,
        playerCount,
      );

      const configSnapshot = {
        rulesVersion: RULES_VERSION,
        roomId: room.id,
        rulesetMode: room.rulesetMode,
        minPlayers: MIN_PLAYERS_TO_START,
        maxPlayers: MAX_PLAYERS_CEILING, // engine-wide bound (§13.1's table range), not this room's chosen cap
        roleDistribution,
        phaseDurationsSec,
        lastWordEnabled: isLastWordEnabled(room.rulesetMode),
      };

      // §10.3: games.status/current_phase and game_players.life_status (and
      // role assignments) are Game-Engine-only writes — performed here, still
      // inside this same transaction/lock, so a game can never be observed
      // RUNNING without roles dealt (no separate step, no undealt window).
      const { status, currentPhase } = await this.gameLifecycle.startGame(tx, {
        gameId,
        activePlayerIds: activePlayers.map((p) => p.id),
        roleDistribution,
        phaseDurationsSec,
      });

      // startedAt/rulesVersion/configSnapshot aren't in §10.3's restricted
      // field list — this remains RoomsService's own write, same transaction.
      await tx.game.update({
        where: { id: gameId },
        data: {
          startedAt,
          rulesVersion: RULES_VERSION,
          configSnapshot: configSnapshot as unknown as Prisma.InputJsonValue,
        },
      });

      await tx.room.update({
        where: { id: room.id },
        data: { status: 'IN_PROGRESS' },
      });

      const response: GameStarted = {
        roomId: room.id,
        gameId,
        status,
        currentPhase,
        playerCount,
        rulesVersion: RULES_VERSION,
        startedAt: startedAt.toISOString(),
      };

      await this.commandRequests.record(tx, key, {
        status: 200,
        body: response as unknown as Prisma.InputJsonValue,
      });

      return response;
    });
  }

  /** Shared by getRoomByCode and joinRoom's pre-lock lookup — keyed by code. */
  private async resolveOpenRoomByCode(
    client: Pick<PrismaService, 'room'>,
    code: string,
  ) {
    return this.resolveOpenRoom(client, { code, status: { not: 'CLOSED' } });
  }

  /** Shared by leave/ready/host-transfer's pre-lock lookup — keyed by id. */
  private async resolveOpenRoomById(
    client: Pick<PrismaService, 'room'>,
    id: string,
  ) {
    return this.resolveOpenRoom(client, { id, status: { not: 'CLOSED' } });
  }

  private async resolveOpenRoom(
    client: Pick<PrismaService, 'room'>,
    where: Prisma.RoomWhereInput,
  ) {
    const room = await client.room.findFirst({ where });

    if (!room || !room.activeGameId) {
      throw new RoomException(RoomErrorCode.ROOM_NOT_FOUND, 'Xona topilmadi');
    }

    return room;
  }

  /**
   * The code space collision check is "the guarded INSERT decides it" — same
   * discipline as the launch-token/initData-replay guards elsewhere in this
   * codebase — rather than a pre-check-then-insert race.
   *
   * Each attempt runs inside its own `SAVEPOINT`: a P2002 aborts the whole
   * enclosing Postgres transaction, not just the failed statement — without a
   * savepoint to roll back to, a second `tx.room.create()` after a collision
   * would fail with "current transaction is aborted" instead of getting a
   * clean retry (found by the retry-path test this comment sits next to;
   * the loop had never been exercised against a real collision before that).
   */
  private async createRoomRowWithUniqueCode(
    tx: Prisma.TransactionClient,
    input: CreateRoomInput,
  ) {
    for (let attempt = 0; attempt < CODE_GENERATION_MAX_ATTEMPTS; attempt += 1) {
      const code = this.randomCode();

      await tx.$executeRaw`SAVEPOINT room_code_attempt`;

      try {
        const room = await tx.room.create({
          data: {
            code,
            maxPlayers: input.maxPlayers,
            rulesetMode: input.rulesetMode,
            visibility: input.visibility ?? RoomVisibility.PRIVATE,
            creatorUserId: input.userId,
          },
        });

        await tx.$executeRaw`RELEASE SAVEPOINT room_code_attempt`;

        return room;
      } catch (error) {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT room_code_attempt`;

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
