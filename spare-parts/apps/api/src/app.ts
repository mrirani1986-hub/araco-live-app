import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import path from 'node:path';
import fs from 'node:fs';
import { env, PROJECT_ROOT } from './env.js';
import { authenticate, requireAuth, requireCsrfHeader } from './lib/auth.js';
import { errorHandler, notFound } from './lib/errors.js';
import authRoutes from './routes/auth.js';
import partsRoutes from './routes/parts.js';
import filesRoutes from './routes/files.js';
import cartRoutes from './routes/cart.js';
import prRoutes from './routes/prs.js';
import poRoutes from './routes/pos.js';
import grnRoutes from './routes/grns.js';
import inventoryRoutes from './routes/inventory.js';
import supplierRoutes from './routes/suppliers.js';
import dashboardRoutes from './routes/dashboard.js';
import reportRoutes from './routes/reports.js';
import userRoutes from './routes/users.js';
import settingsRoutes from './routes/settings.js';
import auditRoutes from './routes/audit.js';
import importRoutes from './routes/imports.js';
import backupRoutes from './routes/backup.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'], styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"], connectSrc: ["'self'"], frameSrc: ["'self'"], objectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  if (env.corsOrigin.length) app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use(authenticate);

  const api = express.Router();
  api.get('/health', (_req, res) => { res.json({ ok: true, time: new Date().toISOString() }); });
  api.use(requireCsrfHeader);
  api.use('/auth', authRoutes);
  api.use(requireAuth);
  api.use('/files', filesRoutes);
  api.use('/', partsRoutes);
  api.use('/cart', cartRoutes);
  api.use('/prs', prRoutes);
  api.use('/pos', poRoutes);
  api.use('/grns', grnRoutes);
  api.use('/inventory', inventoryRoutes);
  api.use('/suppliers', supplierRoutes);
  api.use('/dashboard', dashboardRoutes);
  api.use('/reports', reportRoutes);
  api.use('/users', userRoutes);
  api.use('/settings', settingsRoutes);
  api.use('/audit', auditRoutes);
  api.use('/imports', importRoutes);
  api.use('/backups', backupRoutes);
  api.use((_req, _res, next) => next(notFound('Endpoint')));
  app.use('/api', api);

  // Serve the built web app (single deployable) when present.
  const webDist = path.join(PROJECT_ROOT, 'apps', 'web', 'dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
