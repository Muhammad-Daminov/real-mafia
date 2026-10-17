import { Injectable } from '@nestjs/common';
import { GamePhaseName, GameStatus, LifeStatus, RoleCode, WinnerTeam } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Team, teamForRole } from '../game-engine/roles';
import { GameStateErrorCode, GameStateException } from './game-state.errors';

export interface GameStateTeammate {
  playerId: string;
  roleCode: RoleCode;
}

/**
 * B-R4 (frontend OD-F5-001): a full role reveal — every seated player's
 * `roleCode`/`team`, not just the caller's own — is only ever safe to
 * return once the game has actually ended; §12.7's role-privacy rule is
 * about *mid-game* information, and there is nothing left to protect once
 * `GAME_OVER` is reached. `displayName` mirrors `RoomsService.
 * getRoomByCode`'s exact derivation (`User.firstName`/`lastName`, no
 * separate stored display name exists).
 */
export interface GameResultPlayer {
  playerId: string;
  displayName: string;
  roleCode: RoleCode;
  team: Team;
  lifeStatus: LifeStatus;
}

export interface GameResultPayload {
  winnerTeam: WinnerTeam;
  /** ISO string — `Game.finishedAt`, set in the same write as the
   * `GameResult` row (`GameLifecycleService.transitionPhase`). */
  finishedAt: string;
  players: GameResultPlayer[];
}

/**
 * §31 (Reconnect Snapshot)/OD-059: the minimal "my role + game state" read a
 * client needs after a reload, since realtime has no event replay in this
 * codebase (confirmed — `ROLE_REVEALED`/`PHASE_CHANGED`/etc. are plain
 * fire-and-forget Socket.IO emits, OD-047/049; there is no persisted,
 * sequence-numbered `game_events` table any endpoint reads from). This is
 * deliberately narrower than §31's full extended snapshot (no wallet
 * balance, no cosmetics, no ability-usage counters, no chat
 * `lastChatSequence`) — those belong to the economy/chat slices that own
 * them; see OD-059 for the exact scope line drawn here.
 */
export interface GameStateResponse {
  gameId: string;
  status: GameStatus;
  currentPhase: GamePhaseName;
  round: number;
  /** The active (`endedAt: null`) `GamePhase`'s `endsAt` — null for a
   * non-timed phase or if the game hasn't started yet. */
  phaseEndsAt: string | null;
  myPlayerId: string;
  myLifeStatus: LifeStatus;
  /** Null before ROLE_REVEAL — a `GameRoleAssignment` row doesn't exist
   * yet for a game still in LOBBY. */
  myRoleCode: RoleCode | null;
  myTeam: Team | null;
  /**
   * OD-025/OD-059: non-empty only for a MAFIA-team caller (MAFIA or DON),
   * mirroring `RoomsService.emitRoleReveal`'s `ROLE_REVEALED` payload — a
   * mafia player who reloads must not lose teammate visibility they already
   * had over the socket. Always `[]` for every non-mafia player.
   */
  teammates: GameStateTeammate[];
  /** B-R4/OD-F5-001: present ONLY when `status === 'FINISHED'` — the full
   * role reveal + winner. `undefined` (not sent at all) while the game is
   * still `RUNNING` or hasn't started, never a half-filled placeholder. */
  result?: GameResultPayload;
}

@Injectable()
export class GamesService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyState(input: { gameId: string; userId: string }): Promise<GameStateResponse> {
    const player = await this.prisma.gamePlayer.findUnique({
      where: { gameId_userId: { gameId: input.gameId, userId: input.userId } },
      select: {
        id: true,
        lifeStatus: true,
        roleAssignment: { select: { roleCode: true } },
      },
    });

    if (!player) {
      // Covers both "no such game" and "game exists, caller isn't a
      // player" with one indistinguishable 404 — the game row's existence
      // is guaranteed once `player` is non-null (GamePlayer.gameId FK), so
      // this is also the only membership check this method needs.
      throw new GameStateException(GameStateErrorCode.PLAYER_NOT_IN_GAME, 'Siz bu o‘yinda emassiz');
    }

    const game = await this.prisma.game.findUniqueOrThrow({
      where: { id: input.gameId },
      select: { status: true, currentPhase: true, round: true, finishedAt: true },
    });

    const activePhase = await this.prisma.gamePhase.findFirst({
      where: { gameId: input.gameId, endedAt: null },
      select: { endsAt: true },
    });

    const myRoleCode = player.roleAssignment?.roleCode ?? null;
    const myTeam = myRoleCode ? teamForRole(myRoleCode) : null;

    const teammates: GameStateTeammate[] =
      myTeam === 'MAFIA'
        ? (
            await this.prisma.gameRoleAssignment.findMany({
              where: {
                gameId: input.gameId,
                playerId: { not: player.id },
                roleCode: { in: [RoleCode.MAFIA, RoleCode.DON] },
              },
              select: { playerId: true, roleCode: true },
            })
          )
        : [];

    const result =
      game.status === GameStatus.FINISHED ? await this.loadGameResult(input.gameId, game.finishedAt) : undefined;

    return {
      gameId: input.gameId,
      status: game.status,
      currentPhase: game.currentPhase,
      round: game.round,
      phaseEndsAt: activePhase?.endsAt?.toISOString() ?? null,
      myPlayerId: player.id,
      myLifeStatus: player.lifeStatus,
      myRoleCode,
      myTeam,
      teammates,
      ...(result ? { result } : {}),
    };
  }

  /**
   * B-R4: only ever called once `game.status === 'FINISHED'` — at that
   * point `GameLifecycleService.transitionPhase` has already written both
   * `Game.finishedAt` and the `GameResult` row in the same transaction
   * (§16.3 invariant: `GAME_OVER` never commits without a `winnerTeam`),
   * so `findUniqueOrThrow`/a non-null `finishedAt` are both safe
   * invariants here, not defensive guesses. Every seated player's role is
   * revealed — there is nothing left to protect once the game has ended.
   */
  private async loadGameResult(gameId: string, finishedAt: Date | null): Promise<GameResultPayload> {
    if (!finishedAt) {
      throw new Error(
        `GamesService.loadGameResult: game ${gameId} is FINISHED with no finishedAt (§10.3/transitionPhase invariant violated)`,
      );
    }

    const gameResult = await this.prisma.gameResult.findUniqueOrThrow({
      where: { gameId },
      select: { winnerTeam: true },
    });

    const players = await this.prisma.gamePlayer.findMany({
      where: { gameId, roleAssignment: { isNot: null } },
      select: {
        id: true,
        lifeStatus: true,
        user: { select: { firstName: true, lastName: true } },
        roleAssignment: { select: { roleCode: true } },
      },
    });

    return {
      winnerTeam: gameResult.winnerTeam,
      finishedAt: finishedAt.toISOString(),
      players: players.map((p) => ({
        playerId: p.id,
        displayName: p.user.lastName ? `${p.user.firstName} ${p.user.lastName}` : p.user.firstName,
        roleCode: p.roleAssignment!.roleCode,
        team: teamForRole(p.roleAssignment!.roleCode),
        lifeStatus: p.lifeStatus,
      })),
    };
  }
}
