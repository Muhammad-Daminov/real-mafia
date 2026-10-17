import { randomUUID } from 'crypto';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { GamePhaseName, GameStatus, LifeStatus, Prisma, RoleCode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SchedulerService } from '../../common/scheduling/scheduler.service';
import { NightActionService } from '../../game-engine/night-actions/night-action.service';
import { VoteService } from '../../game-engine/voting/vote.service';
import { primaryAbility } from '../../game-engine/night-actions/role-abilities';
import { DEV_BOT_ACT_TASK_KIND, devBotActDedupeKey, type DevBotActPayload } from './dev-bot-action.scheduled-task';
import { pickNightTargets, pickVoteTarget, type RosterEntry } from './bot-target-selection';
import { randomBotActDelayMs } from './bot-act-delay';

/**
 * OD-060: how long between watcher scans for a newly-active NIGHT/VOTING
 * phase — well under the shortest realistic phase duration, so a bot is
 * never left idle for most of a round waiting to be noticed.
 */
const WATCHER_POLL_INTERVAL_MS = 1_500;

/**
 * B-D2: dev-only bots that act on their own during NIGHT/VOTING, so one
 * human can play (and finish) a full game solo. Everything here lives in
 * `dev-tools/` and is only ever constructed when `DevToolsModule` is —
 * `DEV_TOOLS_ENABLED=true` and `NODE_ENV !== 'production'` (`dev-tools.config.ts`).
 *
 * OD-060 (architecture): `PhaseTransitionService` (`game-engine/`) is never
 * touched or imported-from-the-other-direction to notify this service "a
 * phase just started" — that would mean `game-engine` depending on
 * `dev-tools`, the wrong direction for a module that must not exist at all
 * in production. Instead this service polls (`scanAndSchedule`, every
 * `WATCHER_POLL_INTERVAL_MS`) for active NIGHT/VOTING `GamePhase` rows on
 * `RUNNING` games and schedules one `DEV_BOT_ACT` task per alive bot in
 * each, the same `SchedulerService` (`common/scheduling/`) every other
 * scheduled-task consumer in this codebase already uses — not a second,
 * bespoke timer-and-DB-write mechanism.
 *
 * Night actions and votes are submitted through the real
 * `NightActionService.submitAction`/`VoteService.castVote` — the exact
 * same validation, idempotency (`CommandRequestService`), and
 * `PLAYER_JOINED`-style realtime broadcast path a human player's request
 * goes through. No shortcut writes to `game_actions`/`game_votes`.
 */
@Injectable()
export class BotPlayersService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BotPlayersService.name);
  private watcherTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerService,
    private readonly nightActions: NightActionService,
    private readonly votes: VoteService,
  ) {}

  onApplicationBootstrap(): void {
    this.scheduler.registerHandler(DEV_BOT_ACT_TASK_KIND, (payload) => this.handleBotAct(payload));
    this.startWatcher();
  }

  onModuleDestroy(): void {
    this.stopWatcher();
  }

  startWatcher(intervalMs: number = WATCHER_POLL_INTERVAL_MS): void {
    if (this.watcherTimer) return;

    this.watcherTimer = setInterval(() => {
      void this.scanAndSchedule().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`scanAndSchedule failed: ${message}`);
      });
    }, intervalMs);
    this.watcherTimer.unref?.();
  }

  stopWatcher(): void {
    if (this.watcherTimer) {
      clearInterval(this.watcherTimer);
      this.watcherTimer = null;
    }
  }

  /**
   * Finds every active NIGHT/VOTING phase on a RUNNING game and schedules
   * one `DEV_BOT_ACT` task per alive bot in it, unless one already exists
   * for that exact (phase, bot) pair — see `scheduleBotAct`'s own comment
   * for why that check isn't `SchedulerService.enqueue`'s built-in dedupe
   * alone. Safe to call repeatedly/concurrently (the dedupe check plus
   * `enqueue`'s own unique-index backstop together make a double-schedule
   * impossible even under a race between two poll ticks).
   */
  async scanAndSchedule(): Promise<void> {
    const activePhases = await this.prisma.gamePhase.findMany({
      where: {
        endedAt: null,
        phase: { in: [GamePhaseName.NIGHT, GamePhaseName.VOTING] },
        game: { status: GameStatus.RUNNING },
      },
      select: { id: true, gameId: true, phase: true, endsAt: true },
    });

    for (const activePhase of activePhases) {
      const bots = await this.prisma.gamePlayer.findMany({
        where: { gameId: activePhase.gameId, lifeStatus: LifeStatus.ALIVE, user: { isBot: true } },
        select: { id: true, userId: true },
      });

      for (const bot of bots) {
        await this.scheduleBotAct(activePhase, bot);
      }
    }
  }

  private async scheduleBotAct(
    activePhase: { id: string; gameId: string; phase: GamePhaseName; endsAt: Date | null },
    bot: { id: string; userId: string },
  ): Promise<void> {
    const dedupeKey = devBotActDedupeKey(activePhase.id, bot.id);

    // OD-060: checked against ANY existing row for this key, not just an
    // active one — `SchedulerService.enqueue`'s own dedupe only guards
    // PENDING/LEASED rows (built for "don't double-submit a concurrent
    // retry of the same request"). Relying on that alone here would let
    // this watcher's next poll tick re-schedule the same bot for the same
    // phase over and over, forever, once its first task reaches DONE.
    const already = await this.prisma.scheduledTask.findFirst({ where: { dedupeKey }, select: { id: true } });
    if (already) return;

    const delayMs = randomBotActDelayMs(activePhase.endsAt);
    if (delayMs === null) return; // not enough runway left in this phase — skip, don't force a stale-on-arrival task

    const payload: DevBotActPayload = {
      gameId: activePhase.gameId,
      phaseId: activePhase.id,
      phase: activePhase.phase,
      playerId: bot.id,
      userId: bot.userId,
    };

    await this.prisma.$transaction((tx) =>
      this.scheduler.enqueue(tx, {
        kind: DEV_BOT_ACT_TASK_KIND,
        payload: payload as unknown as Prisma.InputJsonValue,
        runAt: new Date(Date.now() + delayMs),
        dedupeKey,
      }),
    );
  }

  /**
   * `SchedulerService`'s registered handler for `DEV_BOT_ACT`. Every
   * precondition is re-checked fresh against the DB (never trusted from
   * the payload alone) — a task can sit PENDING for up to a few seconds,
   * during which the game could finish, the bot could die, or the phase
   * could already have moved on. Any of those make this a clean no-op,
   * never a throw — `SchedulerService.pollOnce` calls `complete()` for a
   * handler that returns normally, so a stale task never retries.
   */
  async handleBotAct(rawPayload: Prisma.JsonValue): Promise<void> {
    const payload = rawPayload as unknown as DevBotActPayload;

    const game = await this.prisma.game.findUnique({ where: { id: payload.gameId }, select: { status: true } });
    if (!game || game.status !== GameStatus.RUNNING) return;

    const player = await this.prisma.gamePlayer.findUnique({
      where: { id: payload.playerId },
      select: { lifeStatus: true, roleAssignment: { select: { roleCode: true } } },
    });
    if (!player || player.lifeStatus !== LifeStatus.ALIVE) return;

    const activePhase = await this.prisma.gamePhase.findFirst({ where: { gameId: payload.gameId, endedAt: null } });
    if (!activePhase || activePhase.id !== payload.phaseId || activePhase.phase !== payload.phase) return;

    try {
      if (payload.phase === GamePhaseName.NIGHT) {
        await this.actNight(payload, player.roleAssignment?.roleCode ?? null);
      } else if (payload.phase === GamePhaseName.VOTING) {
        await this.actVote(payload);
      }
    } catch (error) {
      // A rejected real-rules action (a race with a death, an ability
      // already used, etc.) is an expected outcome for dev-only
      // convenience bots, not a bug — log and no-op rather than letting
      // the scheduler's retry/backoff spin on an action that will never
      // succeed differently on retry.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(`bot action no-op (${payload.phase}, player ${payload.playerId}): ${message}`);
    }
  }

  private async loadRoster(gameId: string): Promise<RosterEntry[]> {
    const players = await this.prisma.gamePlayer.findMany({
      where: { gameId },
      select: { id: true, lifeStatus: true, roleAssignment: { select: { roleCode: true } } },
    });

    const roster: RosterEntry[] = [];
    for (const p of players) {
      if (!p.roleAssignment) continue; // not dealt yet (shouldn't happen for a RUNNING game, defensive)
      roster.push({ playerId: p.id, alive: p.lifeStatus === LifeStatus.ALIVE, roleCode: p.roleAssignment.roleCode });
    }
    return roster;
  }

  /** Bots only ever use their role's *primary* night ability (OD-060) —
   * e.g. Don's optional secondary `CHECK` is never auto-submitted, same as
   * the frontend's own NightScreen (F4.1) only ever builds a picker for
   * `primaryAbility`. */
  private async actNight(payload: DevBotActPayload, roleCode: RoleCode | null): Promise<void> {
    if (!roleCode) return;
    const ability = primaryAbility(roleCode);
    if (!ability) return; // CIVILIAN, or any role with no night action at all

    const roster = await this.loadRoster(payload.gameId);
    const selection = pickNightTargets(ability, payload.playerId, roster);
    if (!selection) return; // no eligible target this round

    await this.nightActions.submitAction({
      userId: payload.userId,
      gameId: payload.gameId,
      clientRequestId: randomUUID(),
      actionType: ability.actionType,
      targetPlayerId: selection.targetPlayerId,
      targetPlayerId2: selection.targetPlayerId2 ?? null,
    });
  }

  /** OD-060: `VoteService` has no abstain action (no endpoint/target value
   * means "no vote") — a bot therefore always casts a vote, for a random
   * alive target including itself (OD-045 allows self-vote). */
  private async actVote(payload: DevBotActPayload): Promise<void> {
    const roster = await this.loadRoster(payload.gameId);
    const alive = roster.filter((p) => p.alive);
    const targetPlayerId = pickVoteTarget(alive);
    if (!targetPlayerId) return;

    await this.votes.castVote({
      userId: payload.userId,
      gameId: payload.gameId,
      clientRequestId: randomUUID(),
      targetPlayerId,
    });
  }
}
