/**
 * Structured logging with Pino
 *
 * Provides a configured logger instance with:
 * - JSON formatting for production
 * - Pretty printing for development
 * - Secret redaction
 * - Child logger support for correlation IDs
 */

import pino from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

// Configure pino logger
const loggerConfig = {
  level: logLevel,
  base: {
    service: 'huly-vibe-sync',
    pid: process.pid,
  },
  // Redact sensitive information
  redact: {
    paths: [
      'letta.password',
      'LETTA_PASSWORD',
      'config.letta.password',
      '*.password',
      '*.token',
      '*.apiKey',
      '*.api_key',
    ],
    remove: true,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
};

// Add pretty printing in development
if (isDevelopment) {
  loggerConfig.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss.l',
      ignore: 'pid,hostname,service',
      messageFormat: '{service} [{syncId}] {msg}',
    },
  };
}

// Create base logger
export const logger = pino(loggerConfig);

/**
 * Create a child logger with correlation ID
 * @param {string} syncId - Sync run correlation ID
 * @returns {pino.Logger} Child logger with syncId context
 */
export function createSyncLogger(syncId) {
  return logger.child({ syncId });
}

/**
 * Create a child logger with custom context
 * @param {Object} context - Additional context to include in all logs
 * @returns {pino.Logger} Child logger with context
 */
export function createContextLogger(context) {
  return logger.child(context);
}

/**
 * Log levels enum for convenience
 */
export const LogLevel = {
  TRACE: 'trace',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  FATAL: 'fatal',
};

// Export default logger instance
export default logger;
