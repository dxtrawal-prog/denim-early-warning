export const TIER_WEIGHTS: Record<number, number> = { 1: 0.35, 2: 0.45, 3: 0.2 };

export const Z_AMBER = 1.5;
export const Z_RED = 2.5;

/** Rolling window / min observations for the z-score, per signal frequency. */
export const FREQUENCY_CONFIG: Record<
  'daily' | 'weekly' | 'monthly',
  { window: number; minPeriods: number }
> = {
  daily: { window: 90, minPeriods: 30 },
  weekly: { window: 52, minPeriods: 12 },
  monthly: { window: 24, minPeriods: 6 },
};

/** Backwards-compatible defaults (daily) for callers without a source row. */
export const ROLLING_WINDOW = FREQUENCY_CONFIG.daily.window;
export const ROLLING_MIN_PERIODS = FREQUENCY_CONFIG.daily.minPeriods;

/** Policy notices entered within this many days trigger the "Policy Shock" banner. */
export const POLICY_SHOCK_DAYS = 3;

export function statusForZ(z: number): 'green' | 'amber' | 'red' {
  const a = Math.abs(z);
  if (a >= Z_RED) return 'red';
  if (a >= Z_AMBER) return 'amber';
  return 'green';
}