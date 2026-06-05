'use strict';

const cron = require('node-cron');
const { createLogger, format, transports } = require('winston');
const { checkSlaCompliance, retryFailedPropagations } = require('./propagation-engine');
const { getComplianceReport } = require('./audit-log');
const { log: auditLog } = require('./audit-log');

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()]
});

/**
 * Start all scheduled cron jobs.
 */
function startCronJobs() {
  // ── Every 15 minutes: SLA compliance check ───────────────────────────────
  cron.schedule('*/15 * * * *', async () => {
    logger.info('Cron: SLA compliance check starting');
    try {
      const result = await checkSlaCompliance();
      logger.info('Cron: SLA compliance check done', result);

      if (result.breaches.length > 0) {
        logger.error('COMPLIANCE ALERT: SLA breaches detected', { breaches: result.breaches });
        // In production: emit to PagerDuty / SNS / Slack webhook
        await auditLog('CRON_SLA_BREACH_ALERT', 'system', { breaches: result.breaches });
      }

      if (result.warnings.length > 0) {
        logger.warn('COMPLIANCE WARNING: Requests approaching SLA deadline', { warnings: result.warnings });
        await auditLog('CRON_SLA_WARNING_ALERT', 'system', { warnings: result.warnings });
      }
    } catch (err) {
      logger.error('Cron: SLA compliance check failed', { error: err.message });
    }
  });

  // ── Every hour: retry failed propagations ────────────────────────────────
  cron.schedule('0 * * * *', async () => {
    logger.info('Cron: Retrying failed propagations');
    try {
      const result = await retryFailedPropagations();
      logger.info('Cron: Retry run complete', result);
      await auditLog('CRON_RETRY_RUN', 'system', result);
    } catch (err) {
      logger.error('Cron: Retry run failed', { error: err.message });
    }
  });

  // ── Every 24 hours: generate compliance summary report ───────────────────
  cron.schedule('0 0 * * *', async () => {
    logger.info('Cron: Generating daily compliance report');
    try {
      const report = await getComplianceReport();
      logger.info('Cron: Daily compliance report', { report });
      await auditLog('CRON_DAILY_COMPLIANCE_REPORT', 'system', report);

      // In production: store to S3 / send to compliance team via email
    } catch (err) {
      logger.error('Cron: Compliance report failed', { error: err.message });
    }
  });

  logger.info('All cron jobs scheduled', {
    jobs: [
      'SLA compliance check — every 15 minutes',
      'Retry failed propagations — every hour',
      'Daily compliance report — midnight UTC'
    ]
  });
}

module.exports = { startCronJobs };
