import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Input validation failed',
        details: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }

  const anyErr = err as { code?: string; message?: string; status?: number };

  if (anyErr?.code === 'P2002') {
    return res.status(409).json({
      success: false,
      error: {
        code: 'DUPLICATE_RECORD',
        message: 'A record with this unique identifier already exists',
      },
    });
  }

  if (anyErr?.code === 'P2025') {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Requested record was not found',
      },
    });
  }

  if (anyErr?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'FILE_TOO_LARGE',
        message: 'Uploaded file exceeds maximum allowed size',
      },
    });
  }

  console.error('[Unhandled Error]', err);
  const sanitizedDetail =
    typeof anyErr?.code === 'string' && /^P\d{4}$/.test(anyErr.code)
      ? `Database error (${anyErr.code})`
      : 'An unexpected error occurred';

  return res.status(anyErr?.status || 500).json({
    success: false,
    error: {
      code:
        typeof anyErr?.code === 'string' && /^P\d{4}$/.test(anyErr.code)
          ? `DB_${anyErr.code}`
          : 'INTERNAL_SERVER_ERROR',
      message: sanitizedDetail,
    },
  });
}

