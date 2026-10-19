import 'dotenv/config';

/**
 * B-T2: `pnpm run telegram:set-webhook` — one-shot `setWebhook` call,
 * meant to be run manually once per deploy (new host, rotated secret),
 * never by the app itself at boot. Reads `BOT_TOKEN`/`PUBLIC_API_URL`/
 * `TELEGRAM_WEBHOOK_SECRET` from the environment only (`.env` via
 * `dotenv/config`, same loading convention `src/prisma/prisma.service.ts`
 * already uses) — never accepts them as CLI args, which would otherwise
 * land in shell history. `BOT_TOKEN` itself is never printed, by any path
 * (success or failure) below.
 */
async function main(): Promise<void> {
  const botToken = requireEnv('BOT_TOKEN');
  const publicApiUrl = requireEnv('PUBLIC_API_URL');
  const secretToken = requireEnv('TELEGRAM_WEBHOOK_SECRET');

  const webhookUrl = `${publicApiUrl.replace(/\/+$/, '')}/telegram/webhook`;

  const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secretToken,
      allowed_updates: ['message'],
    }),
  });

  const body = await response.json().catch(() => null);

  // The response body itself never contains BOT_TOKEN or the secret —
  // Telegram's setWebhook reply is just {ok, result, description}.
  console.log(`setWebhook -> ${webhookUrl}`);
  console.log(JSON.stringify(body, null, 2));

  if (!response.ok) {
    process.exitCode = 1;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set.`);
    process.exit(1);
  }
  return value;
}

main().catch((error) => {
  console.error('telegram-set-webhook failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
