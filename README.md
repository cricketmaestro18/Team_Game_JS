# Cricket Mini Games

## Run locally

```sh
npm start
```

The server uses the platform-provided `PORT` environment variable when available and listens on `0.0.0.0`.

## Deploy on Render

The Render web service can run on its free plan, but its filesystem is temporary. This app stores accounts and match history, so configure a persistent database before deploying.

### Create the database

1. Create a free project at [Supabase](https://supabase.com/).
2. In the Supabase SQL Editor, run [`server/supabase-schema.sql`](server/supabase-schema.sql).
3. Copy the project URL and the `service_role` API key from the Supabase project settings. Keep the service key secret; it belongs only in Render environment variables.

Supabase's free database has a 500 MB limit and may pause after a week of low activity. Render's free web service sleeps after 15 minutes of inactivity, so the first request after a quiet period can take about a minute to respond. Render's own free Postgres database expires after 30 days, so this setup uses Supabase for the database instead.

### Preserve Railway data before it expires

If the Railway service has a volume mounted at `/data`, download both JSON files while the service is still accessible:

```sh
mkdir -p data
railway service files download /data/team-game.json ./data/team-game.json
railway service files download /data/themes.json ./data/themes.json
```

Set these variables in your local shell using the values from Supabase, then import the backup:

```sh
export SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
node scripts/import-railway-backup.mjs
```

The import replaces the `team-game` and `themes` documents in the new database. Keep a private copy of the downloaded JSON files as a backup; do not commit them.

### Deploy the web service

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint**, select the repository, and apply the `render.yaml` blueprint.
3. Enter `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` when Render prompts for them.
4. Wait for the deployment to finish, then open its `onrender.com` URL and sign in with an existing account.

The app continues using local JSON files for development when both Supabase variables are unset. It uses Supabase when both are configured.

## Maintain the Team Draft player list

Edit [`server/draft-players.json`](server/draft-players.json). Team Draft loads its complete player pool from that file each time a draft starts; players absent from the file cannot appear in a new game.
