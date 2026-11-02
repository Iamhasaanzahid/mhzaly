# MHZALY AR — backend

Express backend for the MHZALY WebAR clone (arviewer.ai style).

## Run

```bash
cd server
npm install
npm start        # http://localhost:8788
```

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | health check |
| POST | `/api/auth/signup` | signup → `{ token, email }` |
| POST | `/api/auth/login` | login → `{ token, email }` |
| POST | `/api/auth/logout` | logout |
| GET | `/api/ar` | list AR experiences |
| POST | `/api/ar` | create AR experience `{ type, source }` |
| GET | `/api/ar/:id` | get one AR experience |
| POST | `/api/ar/:id/scan` | increment scan counter |
| GET | `/api/ar/:id/qr` | QR token for an AR id |
| POST | `/api/generate` | AI generation job slot `{ type, prompt, image }` |
| GET | `/` | static frontend (site/) |

## Next backend steps

- Swap in-memory Maps for a real store (Postgres/Redis).
- Wire `/api/generate` to an AI 3D provider (GLB generation).
- Serve generated GLBs under `/api/ar/:id/model`.
- Add billing (Free/Pro/Business) via Paddle/Stripe.
- Deploy `server/` + `site/` to a Node host (Render / Railway / Fly).

## Frontend

The static frontend lives in `../site` (served by Express at `/`).
