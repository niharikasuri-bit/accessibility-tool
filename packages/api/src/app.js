/**
 * Express application factory.
 *
 * Why a factory: tests can spin up isolated app instances without listening
 * on a port, and the boot script (index.js) calls listen() on the result.
 *
 * Middleware order (matters!):
 *   1. CORS (must come first to handle preflight before anything else)
 *   2. JSON body parser
 *   3. pino-http request logging
 *   4. Public routes (health) — no API key required
 *   5. API-key middleware
 *   6. Protected routes (scan, site)
 *   7. 404 fallback (any unmatched /api/* path)
 *   8. Central error handler (must be last)
 */

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { logger } from './logger.js';
import { apiKeyMiddleware } from './middleware/api-key.js';
import { requireAuth } from './middleware/requireAuth.js';
import { errorHandler } from './middleware/error-handler.js';
import { healthRouter }    from './routes/health.js';
import { emailPdfsRouter } from './routes/emailPdfs.js';
import { scanRouter }      from './routes/scan.js';
import { siteRouter }      from './routes/site.js';
import { emailRouter }     from './routes/email.js';
import { scheduleRouter }  from './routes/schedule.js';
import { authRouter }      from './routes/auth.js';
import { NotFound } from './errors.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');

  app.use(cors({
    origin:      config.corsOrigins,
    credentials: true,
  }));

  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));

  app.use(pinoHttp({
    logger,
    // Quieter access logs for health checks (they happen constantly when
    // monitoring is on; don't drown the signal).
    autoLogging: {
      ignore: (req) => req.url === '/api/health',
    },
  }));

  // Public — no auth.
  app.use('/api/health',     healthRouter);
  app.use('/api/email-pdfs', emailPdfsRouter);
  app.use('/api/auth',       authRouter);

  // Protected by API key (scan/site/email — used by both tool and admin UI).
  app.use('/api/scan',  apiKeyMiddleware, scanRouter);
  app.use('/api/site',  apiKeyMiddleware, siteRouter);
  app.use('/api/email', apiKeyMiddleware, emailRouter);

  // Schedule routes: require valid admin session cookie.
  app.use('/api/schedule', requireAuth, scheduleRouter);

  // 404 for any unmatched /api/* path
  app.use('/api', (req, _res, next) => {
    next(NotFound('ROUTE_NOT_FOUND', `No route handles ${req.method} ${req.path}.`));
  });

  app.use(errorHandler);

  return app;
}
