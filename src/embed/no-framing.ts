import type { NextFunction, Request, Response } from 'express';

/**
 * Nothing the API answers is meant to be shown inside another site's frame: embed pages are the UI's (its nginx lets
 * those, and only those, be framed), and they call the API, they aren't the API.
 */
export function noFraming(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  res.setHeader('X-Frame-Options', 'DENY');
  next();
}
