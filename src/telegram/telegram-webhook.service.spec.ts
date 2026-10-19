import { TelegramWebhookService } from './telegram-webhook.service';
import { TelegramApiClient } from './telegram-api.client';
import type { TelegramUpdate } from './telegram-update.types';

function buildUpdate(overrides: Partial<Record<string, unknown>> = {}): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 555, type: 'private' },
      from: { id: 555, is_bot: false },
      text: '/start',
    },
    ...overrides,
  } as TelegramUpdate;
}

describe('TelegramWebhookService — dedupe/malformed-input unit behavior', () => {
  const callMethod = jest.fn();
  const apiClient = { callMethod } as unknown as TelegramApiClient;
  const originalMiniAppUrl = process.env.MINI_APP_URL;

  beforeEach(() => {
    callMethod.mockReset();
    callMethod.mockResolvedValue({ ok: true, status: 200 } as Response);
    process.env.MINI_APP_URL = 'https://mini-app.example.com';
  });

  afterAll(() => {
    process.env.MINI_APP_URL = originalMiniAppUrl;
  });

  it('a totally malformed update (no update_id) never crashes and never sends', async () => {
    const service = new TelegramWebhookService(apiClient);

    await expect(service.handleUpdate({} as TelegramUpdate)).resolves.toBeUndefined();
    expect(callMethod).not.toHaveBeenCalled();
  });

  it('bounded dedupe: once more than 1000 newer update_ids have been seen, the oldest is forgotten and can be reprocessed', async () => {
    const service = new TelegramWebhookService(apiClient);

    // update_id 1 is the very first entry remembered — FIFO position 0.
    await service.handleUpdate(buildUpdate({ update_id: 1 }));
    expect(callMethod).toHaveBeenCalledTimes(1);

    // Replaying it immediately is still a duplicate — no second send yet.
    await service.handleUpdate(buildUpdate({ update_id: 1 }));
    expect(callMethod).toHaveBeenCalledTimes(1);

    // 1000 more distinct (non-/start, cheap) updates push the FIFO past
    // its 1000-entry bound exactly once, evicting update_id 1 — the
    // oldest surviving entry — the moment the 1000th of these lands.
    for (let id = 2; id <= 1001; id++) {
      await service.handleUpdate(buildUpdate({ update_id: id, message: { ...buildUpdate().message, text: 'noise' } }));
    }
    expect(callMethod).toHaveBeenCalledTimes(1);

    // update_id 1 was evicted — Telegram retrying it now is indistinguishable
    // from a brand new update, so it's processed (and sent) again.
    await service.handleUpdate(buildUpdate({ update_id: 1 }));
    expect(callMethod).toHaveBeenCalledTimes(2);
  });

  it('a /start reply is skipped (no throw) when MINI_APP_URL is unset', async () => {
    delete process.env.MINI_APP_URL;

    const service = new TelegramWebhookService(apiClient);
    await expect(service.handleUpdate(buildUpdate({ update_id: 9001 }))).resolves.toBeUndefined();
    expect(callMethod).not.toHaveBeenCalled();
  });
});
