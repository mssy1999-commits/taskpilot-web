#!/usr/bin/env bash
# TaskPilot one-command deploy (run it in Google Cloud Shell or any Linux terminal).
#   1. Deploys the backend to YOUR Convex project
#   2. Saves your API keys in Convex
#   3. Builds the app and publishes it on YOUR Firebase Hosting
set -euo pipefail
cd "$(dirname "$0")"

ask() { # ask VAR "Question" [secret]
  local var="$1" q="$2" secret="${3:-}"
  if [ -z "${!var:-}" ]; then
    if [ -n "$secret" ]; then read -r -s -p "$q: " "$var"; echo; else read -r -p "$q: " "$var"; fi
  fi
}

echo "== TaskPilot deploy =="
ask CONVEX_DEPLOY_KEY "Paste your Convex PRODUCTION deploy key (Convex dashboard > Settings > Deploy keys)" secret
export CONVEX_DEPLOY_KEY

echo "-- Installing packages (1-2 minutes)…"
npm install --no-audit --no-fund --loglevel=error

echo "-- Deploying backend to Convex and building the app…"
npx convex deploy -y --cmd 'npm run build' --cmd-url-env-var-name VITE_CONVEX_URL --typecheck disable

echo "-- Saving your keys in Convex (press Enter to skip any you already set)…"
for VAR in GEMINI_API_KEY BROWSERLESS_TOKEN APP_PASSCODE; do
  read -r -s -p "  $VAR: " VAL; echo
  if [ -n "$VAL" ]; then npx convex env set "$VAR" "$VAL" >/dev/null && echo "  saved $VAR"; fi
done

echo "-- Publishing on Firebase Hosting…"
npx --yes firebase-tools login --no-localhost || true
if [ -z "${FIREBASE_PROJECT:-}" ]; then
  npx --yes firebase-tools projects:list || true
  read -r -p "Type your Firebase Project ID from the list above: " FIREBASE_PROJECT
fi
npx --yes firebase-tools deploy --only hosting --project "$FIREBASE_PROJECT"

echo
echo "== Done! Open: https://$FIREBASE_PROJECT.web.app =="
