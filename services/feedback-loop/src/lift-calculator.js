'use strict';

const decisionStore = require('./decision-store');
const logger = require('./logger');

const BASELINE_ACCEPTANCE_RATE = parseFloat(process.env.BASELINE_ACCEPTANCE_RATE || '0.12');
const ACCEPTED_OUTCOMES = new Set(['ACCEPTED', 'CONVERTED', 'CLICKED']);

class LiftCalculator {
  constructor(baselineRate = BASELINE_ACCEPTANCE_RATE) {
    this.baselineAcceptanceRate = baselineRate;
  }

  /**
   * Calculate the acceptance rate from decisions in the last windowDays.
   */
  async currentAcceptanceRate(windowDays = 30) {
    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    const decisions = await decisionStore.getGlobalDecisionsInWindow(windowMs);

    if (decisions.length === 0) return 0;

    const accepted = decisions.filter((d) => ACCEPTED_OUTCOMES.has(d.outcome)).length;
    return accepted / decisions.length;
  }

  /**
   * (current - baseline) / baseline * 100
   */
  async liftPercentage(windowDays = 30) {
    const current = await this.currentAcceptanceRate(windowDays);
    if (this.baselineAcceptanceRate === 0) return 0;
    return ((current - this.baselineAcceptanceRate) / this.baselineAcceptanceRate) * 100;
  }

  /**
   * Lift breakdown by channel.
   */
  async byChannel(windowDays = 30) {
    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    const decisions = await decisionStore.getGlobalDecisionsInWindow(windowMs);

    const channelMap = {};
    for (const d of decisions) {
      const ch = d.channel || 'UNKNOWN';
      if (!channelMap[ch]) channelMap[ch] = { total: 0, accepted: 0 };
      channelMap[ch].total++;
      if (ACCEPTED_OUTCOMES.has(d.outcome)) channelMap[ch].accepted++;
    }

    const result = {};
    for (const [channel, counts] of Object.entries(channelMap)) {
      const rate = counts.total > 0 ? counts.accepted / counts.total : 0;
      result[channel] = {
        total: counts.total,
        accepted: counts.accepted,
        acceptanceRate: rate,
        lift: this.baselineAcceptanceRate > 0
          ? ((rate - this.baselineAcceptanceRate) / this.baselineAcceptanceRate) * 100
          : 0,
      };
    }
    return result;
  }

  /**
   * Lift breakdown by action (offer type).
   */
  async byAction(windowDays = 30) {
    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    const decisions = await decisionStore.getGlobalDecisionsInWindow(windowMs);

    const actionMap = {};
    for (const d of decisions) {
      const action = d.action || 'UNKNOWN';
      if (!actionMap[action]) actionMap[action] = { total: 0, accepted: 0 };
      actionMap[action].total++;
      if (ACCEPTED_OUTCOMES.has(d.outcome)) actionMap[action].accepted++;
    }

    const result = {};
    for (const [action, counts] of Object.entries(actionMap)) {
      const rate = counts.total > 0 ? counts.accepted / counts.total : 0;
      result[action] = {
        total: counts.total,
        accepted: counts.accepted,
        acceptanceRate: rate,
        lift: this.baselineAcceptanceRate > 0
          ? ((rate - this.baselineAcceptanceRate) / this.baselineAcceptanceRate) * 100
          : 0,
      };
    }
    return result;
  }

  /**
   * Day-by-day lift for the last `days` days.
   */
  async timeSeriesLift(days = 30) {
    const windowMs = days * 24 * 60 * 60 * 1000;
    const decisions = await decisionStore.getGlobalDecisionsInWindow(windowMs);

    // Group by day (YYYY-MM-DD)
    const dayMap = {};
    for (const d of decisions) {
      const day = new Date(d.timestamp).toISOString().slice(0, 10);
      if (!dayMap[day]) dayMap[day] = { total: 0, accepted: 0 };
      dayMap[day].total++;
      if (ACCEPTED_OUTCOMES.has(d.outcome)) dayMap[day].accepted++;
    }

    return Object.entries(dayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => {
        const rate = counts.total > 0 ? counts.accepted / counts.total : 0;
        return {
          date,
          total: counts.total,
          accepted: counts.accepted,
          acceptanceRate: rate,
          lift: this.baselineAcceptanceRate > 0
            ? ((rate - this.baselineAcceptanceRate) / this.baselineAcceptanceRate) * 100
            : 0,
        };
      });
  }
}

module.exports = new LiftCalculator();
