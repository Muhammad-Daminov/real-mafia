import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

declare module 'express' {
  interface Request {
    requestId?: string;
  }
}

const logger = new Logger('HTTP');

/**
 * B-H1: one line per request (method, path, status, duration, a request
 * id), applied globally in `main.ts`. Deliberately logs none of: headers
 * (so `Authorization` never appears), the body (so `initData`/tokens in a
 * POST never appear), or the query string (`req.path` excludes it) —
 * "request logging with a request id," not request *content* logging.
 *
 * `req.path` over `req.originalUrl`/`req.url` is the deliberate choice —
 * the latter two include the query string, the former doesn't.
 *
 * The id is always server-generated (`randomUUID()`), never trusted from
 * an incoming `X-Request-Id` — this app has no reverse proxy yet that sets
 * one reliably (`TRUST_PROXY_HOPS`, `main.ts`), and a client-supplied id
 * would just be an unvalidated string correlated into logs for no real
 * benefit over one this process mints itself. Echoed back on the response
 * so a client/error report can reference it.
 */
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startedAtMs = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - startedAtMs;
    logger.log(`${req.method} ${req.path} ${res.statusCode} ${durationMs}ms [${requestId}]`);
  });

  next();
}
