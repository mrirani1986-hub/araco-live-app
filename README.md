# ARACO READY MIX - Deploy Package

Production-ready starter package for a fleet, fuel, diesel tank, fuel bon, maintenance, and role-based operations web app.

## Stack
- Frontend: React + Vite
- Backend: Node.js + Express
- Database: PostgreSQL
- Auth: JWT
- ORM/DB access: pg
- Styling: Plain CSS starter (easy to replace with Tailwind)

## Default roles
- ADMIN
- MAZEN
- RABIH
- MOHAMMAD

## Project structure
- `frontend/` React app
- `backend/` API server
- `database/schema.sql` PostgreSQL schema and seed data
- `docs/api.md` endpoint reference
- `docker-compose.yml` local deployment stack

## Quick start with Docker
```bash
docker compose up --build
```

Frontend:
- http://localhost:5173

Backend:
- http://localhost:4000

## Manual start
### 1) Database
Create a PostgreSQL database named `araco_enterprise` and run:
```bash
psql -U postgres -d araco_enterprise -f database/schema.sql
```

### 2) Backend
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

### 3) Frontend
```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

## Demo login after seed
- admin / 661986
- mazen / 1234
- rabih / 1234
- mohammad / 1234

## Notes
- Seed users are stored with plain-password markers for easy first deployment. Change them immediately, then migrate to bcrypt-only passwords in production.
- Replace JWT secret and database credentials before deployment.
- This package is designed so the frontend can later be deployed to Vercel/Netlify and the backend to Render/Railway/VM.
