# TaskPilot Web

Chat with an AI that browses websites for you: searches, clicks, fills forms in one go, and hands you control ("Your turn") for CAPTCHAs.

- Frontend: Vite + React + Tailwind
- Backend: Convex (database + the agent that drives a cloud browser)
- AI: Google Gemini (free tier, cascades across free models)
- Browser: Browserless (free tier, 2-minute sessions handled automatically)

## Keys (set in Convex → Settings → Environment Variables)

| Name | Required | Where to get it |
|---|---|---|
| `GEMINI_API_KEY` | yes | aistudio.google.com |
| `BROWSERLESS_TOKEN` | yes | browserless.io dashboard |
| `APP_PASSCODE` | recommended | any passcode you choose — locks the app to you |
| `BROWSERLESS_REGION` | no | default `production-lon` |
| `BROWSER_WS_URL` | no | your own browser endpoint instead of Browserless |

## Deploy option A — Google Cloud Shell + Firebase Hosting (no GitHub)

1. Create a free Convex account at convex.dev, create a project, then **Settings → Deploy keys → Generate production deploy key** and copy it.
2. Open **shell.cloud.google.com**, tap **⋮ → Upload**, and upload `taskpilot-web.zip`.
3. Run:
   ```
   unzip -o taskpilot-web.zip -d taskpilot-web && bash taskpilot-web/deploy.sh
   ```
4. Paste the deploy key and your keys when asked. Your app is published at `https://<firebase-project-id>.web.app`.

## Deploy option B — GitHub + Vercel

1. Push this folder to a GitHub repo.
2. In Vercel: **Add New → Project →** import the repo (set *Root Directory* if this is a subfolder).
3. Add environment variable `CONVEX_DEPLOY_KEY` (Convex production deploy key) and deploy. `vercel.json` already sets the build command.
4. Add your keys in the Convex dashboard as above.
