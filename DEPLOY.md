# Deploying the public demo

Signal has two ways to run:

| | Your own copy | Public demo |
|---|---|---|
| Where | Your computer (`Start-Signal.cmd`, http://127.0.0.1:1421) | A hosting service, at a public URL |
| Data | Your real database in `data/signal.sqlite3` | Made-up sample companies, people and emails, held in memory |
| Weekly news search | On | Off |
| Résumé PDF saving, updater | On | Off |
| Visitors' changes | — | Wiped every 6 hours, and on every restart |

The demo is what you link from a résumé. Your real data never leaves your computer: `data/` and `resumes/` are excluded from Git and from the Docker image, and the server refuses to listen on a public address unless demo mode is on.

## Deploy on Render (free)

1. Sign in at https://render.com with your GitHub account.
2. Choose **New → Blueprint** and pick the `Signal` repository. Render reads `render.yaml` and sets up a free web service called `signal-demo`.
3. Choose **Apply**. The first build takes a few minutes.
4. Open the URL Render gives you, for example `https://signal-demo.onrender.com`. You should see the "You're viewing a demo" banner.

Every push to `main` redeploys automatically.

On the free plan the service sleeps after about 15 minutes without visitors, so the first page load after that can take up to a minute. A paid plan (about $7 a month) keeps it awake.

## Other hosts

Any host that builds a `Dockerfile` works, for example Railway or Fly.io. The image already sets `SIGNAL_DEMO=1`, listens on `0.0.0.0`, and uses the `PORT` the host provides (default 8080). No database or disk is needed.

## Try the demo on your computer

With Docker Desktop running:

```bash
docker build -t signal-demo .
```

```bash
docker run -p 8080:8080 signal-demo
```

Then open http://localhost:8080.

Without Docker, after `npm run build`:

```bash
SIGNAL_DEMO=1 PORT=8080 node server/index.mjs
```

## Settings

| Variable | Meaning |
|---|---|
| `SIGNAL_DEMO=1` | Run the demo: sample data in memory, no news fetching, no updater, no résumé saving |
| `SIGNAL_HOST` | Address to listen on. Default `127.0.0.1`. Anything other than localhost is only accepted in demo mode |
| `PORT` / `SIGNAL_PORT` | Port to listen on. In demo mode, `PORT` is used when `SIGNAL_PORT` is not set |

The sample data lives in `server/demo-data.mjs`.
