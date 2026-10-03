import { apiFetch } from './client';
import type { RoomSummary } from './rooms';

/**
 * `POST /dev/rooms/:code/fill-bots` (../../../src/dev-tools/dev-tools.controller.ts,
 * `FillBotsDto`/`DevToolsService.fillBots`, backend commit f7d95e2, B-D1) —
 * `JwtGuard`-protected, so this goes through `apiFetch` (attaches the bearer
 * token), same as every room command. Only reachable when the backend has
 * `DEV_TOOLS_ENABLED=true` outside production — a 404 means the route isn't
 * registered there at all (`resolveDevToolsImports`), not "room not found".
 * Response is `RoomsService.getRoomByCode`'s `RoomSummary` verbatim (the
 * service's own final line), including the member-only `players` roster.
 */
export function fillBots(code: string, count: number, ready: boolean): Promise<RoomSummary> {
  return apiFetch<RoomSummary>(`/dev/rooms/${encodeURIComponent(code)}/fill-bots`, {
    method: 'POST',
    body: JSON.stringify({ count, ready }),
  });
}
