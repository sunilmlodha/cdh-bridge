'use strict';

const Joi = require('joi');

const propertiesSchema = Joi.object().pattern(
  Joi.string().max(100),
  Joi.alternatives().try(
    Joi.string().max(1000),
    Joi.number(),
    Joi.boolean(),
    Joi.array().items(Joi.alternatives().try(Joi.string(), Joi.number(), Joi.boolean())).max(50)
  )
).max(50);

const singleEventSchema = Joi.object({
  customerId: Joi.string().trim().min(1).max(255).required(),
  eventType: Joi.string().trim().min(1).max(100).required(),
  channel: Joi.string()
    .trim()
    .valid('web', 'mobile', 'server', 'email', 'sms', 'call_center', 'chat', 'app', 'api', 'other')
    .default('web'),
  properties: propertiesSchema.default({}),
  timestamp: Joi.alternatives()
    .try(
      Joi.date().iso(),
      Joi.number().integer().positive()
    )
    .optional(),
  sessionId: Joi.string().trim().max(255).optional(),
  deviceId: Joi.string().trim().max(255).optional(),
  ipAddress: Joi.string().ip({ version: ['ipv4', 'ipv6'], cidr: 'optional' }).optional(),
  userAgent: Joi.string().trim().max(512).optional(),
}).options({ stripUnknown: true });

const batchEventSchema = Joi.object({
  events: Joi.array()
    .items(singleEventSchema)
    .min(1)
    .max(100)
    .required(),
}).options({ stripUnknown: true });

/**
 * Validate a single event payload.
 * @param {object} payload
 * @returns {{ value: object, error: Joi.ValidationError|undefined }}
 */
function validateSingleEvent(payload) {
  return singleEventSchema.validate(payload, { abortEarly: false });
}

/**
 * Validate a batch event payload.
 * @param {object} payload
 * @returns {{ value: object, error: Joi.ValidationError|undefined }}
 */
function validateBatchEvents(payload) {
  return batchEventSchema.validate(payload, { abortEarly: false });
}

module.exports = { validateSingleEvent, validateBatchEvents };
