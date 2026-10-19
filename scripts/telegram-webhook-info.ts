import 'dotenv/config';

/**
 * B-T2: `pnpm run telegram:webhook-info` — one-shot `getWebhookInfo` call
 * for diagnosing what Telegram currently has on file (url, pending update
 * count, last error). Reads `BOT_TOKEN` from the environment only, and
 * never prints it or includes it in the printed output — `getWebhookInfo`'s
 * own response body never carries the token either way, but the request
 * URL (which does) is never logged.
 */
async function main(): Promise<void> {
  const botToken = requireEnv('BOT_TOKEN');

  const response = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
  const body = await response.json().catch(() => null);

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
  console.error('telegram-webhook-info failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
