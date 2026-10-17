# Citadel — Deploy Runbook (Render backend + Vercel frontend)

Users hit the Vercel frontend, which calls the Render backend cross-origin.
Two env vars make this work; everything else is already wired.

## 1. Backend → Render (Web Service)

- **Root directory:** `backend/`
- **Build:** `pip install -r requirements.txt`
- **Start:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
- **Env vars (Render dashboard):**

| Key | Value | Notes |
|---|---|---|
| `APP_ENV` | `production` | |
| `DEBUG` | `false` | |
| `DATABASE_URL` | `postgresql+asyncpg://...` | Render internal Postgres URL (or Supabase pooler) |
| `REDIS_URL` | `rediss://...` | Upstash or Render Redis |
| `ML_SERVICE_URL` | `http://<ml-service>.onrender.com` | Deploy the `ml/` service separately, or co-locate |
| `CORS_ORIGINS` | `https://<frontend>.vercel.app` | **Required** — default is localhost only; browser blocks cross-origin without it. Comma-separated for multiple. |
| `JWT_SECRET` | `<64-char hex>` | Must NOT be the placeholder sentinel or the app refuses to boot |
| `IMEI_HMAC_SECRET` | `<64-char hex>` | Same — no sentinel |
| `GROQ_API_KEY` | shared team key | For the investigative agent (graceful fallback if absent) |
| `CAMARA_MOCK_ENABLED` | `true` | Keep mocked for the demo |

> The app **refuses to boot** if `JWT_SECRET` / `IMEI_HMAC_SECRET` are still
> placeholder sentinels. Generate with `openssl rand -hex 32`.

## 2. Frontend → Vercel

- **Root directory:** `frontend/`
- **Build:** `npm install && npm run build`
- **Output:** `dist/` (Vite static)
- **Env vars (Vercel project settings → Environment Variables, exposed at build):**

| Key | Value |
|---|---|
| `VITE_API_URL` | `https://<backend>.onrender.com` (no trailing slash) |

The frontend resolves every API call through `apiUrl()` in
`src/lib/auth.ts`. When `VITE_API_URL` is set, calls go cross-origin to the
Render backend; when empty (local dev), they go through the Vite proxy.

## 3. ML service (Render, separate Web Service)

- **Root directory:** `ml/`
- **Start:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
- First boot auto-trains COPOD from the bundled PaySim CSV (~1-2 min);
  behavioral auth `/score` works immediately. See README first-boot note.

## Pre-deploy checklist

- [ ] `CORS_ORIGINS` on Render = the exact Vercel URL (scheme + host, no path)
- [ ] `VITE_API_URL` on Vercel = the Render backend URL
- [ ] `JWT_SECRET` + `IMEI_HMAC_SECRET` set to real random values (no sentinels)
- [ ] Postgres + Redis provisioned; `DATABASE_URL` / `REDIS_URL` set
- [ ] `/health` returns 200 on the Render backend
- [ ] On the deployed frontend: Login Demo → click **Run Simulation** →
      Legit=APPROVE, SIM Swap=HARD_BLOCK, Coercion=HARD_BLOCK (works on
      repeat clicks — demo/reset runs first)