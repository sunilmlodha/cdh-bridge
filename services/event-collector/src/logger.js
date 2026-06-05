'use strict';

const winston = require('winston');

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const SERVICE_NAME = process.env.SERVICE_NAME || 'event-collector';

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

const isProduction = process.env.NODE_ENV === 'production';

const logger = winston.createLogger({
  level: LOG_LEVEL,
  defaultMeta: { service: SERVICE_NAME },
  format: combine(
    timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    errors({ stack: true }),
    json()
  ),
  transports: [
    new winston.transports.Console({
      format: isProduction
        ? combine(timestamp(), errors({ stack: true }), json())
        : combine(colorize(), simple()),
    }),
  ],
  exitOnError: false,
});

module.exports = logger;
