# vercel-discord-alerts

A single Vercel Function that turns Vercel's webhooks into Discord messages.
Vercel can POST to any URL when a deployment fails, a spend budget is hit or an
alert fires, but it sends its own JSON, and Discord's webhook endpoint only
accepts messages (`content` or `embeds`). This relay sits between the two:
it checks Vercel's signature, builds one Discord embed per event and posts it.

No database, no framework, no runtime dependencies. One file under `api/`,
three small modules under `src/`.

## What it reports

| event                                                             | message                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------- |
| `deployment.error`                                                | red: project, environment, branch, commit, author, link |
| `deployment.canceled`, `deployment.rollback`                      | amber, same details                                     |
| `deployment.succeeded`, `deployment.promoted`, `deployment.ready` | green, same details                                     |
| Spend Management (`thresholdPercent` payload)                     | amber at 75%, red at 100%, with budget and spend        |
| `alerts.triggered`                                                | red, with the alert's name and payload                  |
| anything else                                                     | grey, with the event type and a JSON snippet            |

Subscribe the webhook to the events you want; the relay formats whatever
arrives and never drops an unknown type.

## Deploy

1. Create a Vercel project from this repository (framework "Other"; the
   function is `api/vercel.ts`, served at `/api/vercel`). `vercel.json` pins
   the London region and a 10-second limit.
2. In Discord: Server settings → Integrations → Webhooks → New webhook, choose
   the channel, copy the URL.
3. Project environment variables, Production scope:

   | variable                 | value                                                                    |
   | ------------------------ | ------------------------------------------------------------------------ |
   | `DISCORD_WEBHOOK_URL`    | the Discord webhook URL                                                  |
   | `VERCEL_WEBHOOK_SECRETS` | the secret(s) Vercel shows when each webhook is created, comma-separated |

   Deploy once so the function picks them up. `GET /api/vercel` answers
   `{"ok":true}` when the deployment is live (it does not check the variables).

4. Create the team webhook that points at it. The secret is returned only
   when the webhook is created, and `vercel webhooks create` does not print
   it, so use the REST API through the CLI (or the dashboard, Team settings
   → Webhooks, which shows the secret once):

   ```sh
   printf '%s' '{"url":"https://<your-deployment>/api/vercel","events":["deployment.error","deployment.canceled","deployment.rollback","alerts.triggered","firewall.attack"]}' \
     | vercel api /v1/webhooks -X POST --input -
   ```

   The response includes `secret`. Add it to `VERCEL_WEBHOOK_SECRETS` and
   redeploy. Those five event names are the ones the API accepted for an
   account webhook on 2026-10-23; the longer list in the API reference
   includes names the server rejects with "invalid webhook event names".

5. Spend Management (Team settings → Billing → Spend Management): enter the
   same URL as the webhook. It has its own secret, shown when saved; append it
   to `VERCEL_WEBHOOK_SECRETS` (comma-separated) and redeploy.

Without both variables the function answers 503 and relays nothing, so a
public deployment of this code cannot be used to spam a channel.

## How deliveries are handled

- `x-vercel-signature` must be the hex HMAC-SHA1 of the raw body under one of
  the configured secrets (constant-time comparison). Anything else is 401.
- A delivery that Discord accepts answers 200.
- If Discord is unavailable (429 or 5xx) the relay answers 502, and Vercel
  retries the delivery with backoff for up to 24 hours.
- If Discord refuses the message (other 4xx) the relay logs it and answers
  200, because retrying the same message cannot succeed.

## Develop

```sh
pnpm install
pnpm check          # prettier, eslint, tsc, vitest
pnpm dev            # vercel dev, serves /api/vercel locally
```

To send a signed test delivery to a running instance:

```sh
BODY='{"id":"evt_test","type":"deployment.error","createdAt":1700000000000,"payload":{"name":"example","target":"production","deployment":{"meta":{"githubCommitRef":"main","githubCommitMessage":"test"}}}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha1 -hmac "$SECRET" | awk '{print $NF}')
curl -s -X POST -H "x-vercel-signature: $SIG" -H 'content-type: application/json' --data "$BODY" https://<your-deployment>/api/vercel
```

## Licence

MIT.
