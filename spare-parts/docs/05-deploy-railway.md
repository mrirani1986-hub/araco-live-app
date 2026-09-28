# 05 — Deploy on Railway

Railway builds the app from `spare-parts/Dockerfile` straight from GitHub (settings in `spare-parts/railway.json`).
The first start creates the tables, imports the original workbook (254 parts, 34 drawings) and creates the first
administrator. Later starts skip the import.

## 1. Create the project and the database

1. Sign in at <https://railway.com> with your GitHub account.
2. **New Project → Deploy from GitHub repo** → choose `mrirani1986-hub/araco-live-app`
   (grant Railway access to the repository if asked).
3. In the new project press **+ Create → Database → PostgreSQL**.

## 2. Configure the app service

Open the service created from the repository (`araco-live-app`) → **Settings**:

| Setting | Value |
|---|---|
| Source → **Root Directory** | `/spare-parts` |
| Source → Branch | `main` (after the PR is merged) |
| Config-as-code → Railway config file (only if it was not picked up automatically) | `/spare-parts/railway.json` |
| Networking → **Generate Domain** | gives you the public `https://….up.railway.app` address |

Then **Variables** → add:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference to the database created above) |
| `JWT_SECRET` | a random string of at least 32 characters |
| `ADMIN_USERNAME` | `admin` (or another name) |
| `ADMIN_PASSWORD` | the password you will sign in with (8+ characters, letters and numbers) |
| `RAILWAY_RUN_UID` | `0` (lets the app write to the volume below) |

## 3. Keep pictures, imports and backups: add a volume

Right-click the app service → **Attach Volume** → mount path **`/app/storage`**.
Without a volume, uploaded photos, imported files and backups are lost at every redeploy
(the database itself is safe in the PostgreSQL service).

## 4. Deploy and sign in

Press **Deploy** (or push to `main`). The first build takes a few minutes; the first start imports the workbook.
When the deployment shows **Active**, open the generated domain and sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

Next: **Users** (create real users), **Settings → Company** (address, VAT number, logo), **Suppliers**,
**Settings → Import → Stock** (opening stock), **Inventory → Suggested minimum stock**.

## Notes

- The old Vercel project still points to the `frontend/` folder; it is not this app.
- Railway's PostgreSQL service has its own backups; the app's **Settings → Backup** additionally saves the database and
  all pictures to the volume. Download backups regularly and keep a copy elsewhere.
- Costs: the app needs roughly 512 MB–1 GB RAM (Chromium runs only while generating PDFs). Check Railway's plan limits.
- If a deploy fails, open the deployment's **Build Logs** / **Deploy Logs** and send them to the developer.
