import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dealRoles, RoleDistribution } from './roles';

export interface DealRolesInput {
  gameId: string;
  activePlayerIds: string[];
  roleDistribution: RoleDistribution;
}

/**
 * §10.3: "only the Game Engine may write ...role assignments." Callers
 * (RoomsService) hold the `SELECT games ... FOR UPDATE` lock and the open
 * transaction for the whole StartGame command; this service only performs
 * the role-assignment write within that transaction — it takes no lock and
 * makes no authorization decision of its own (host-only, LOBBY-only, etc. are
 * the caller's job, per §10.3's own division: the engine owns *what* gets
 * written, the calling command owns *whether* it's allowed to happen).
 */
@Injectable()
export class RoleAssignmentService {
  async dealRoles(
    tx: Prisma.TransactionClient,
    input: DealRolesInput,
  ): Promise<void> {
    const assignments = dealRoles(input.activePlayerIds, input.roleDistribution);

    await tx.gameRoleAssignment.createMany({
      data: assignments.map((a) => ({
        gameId: input.gameId,
        playerId: a.playerId,
        roleCode: a.roleCode,
      })),
    });
  }
}
