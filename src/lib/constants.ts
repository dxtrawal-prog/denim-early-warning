export const TIER_WEIGHTS: Record<number, number> = { 1: 0.35, 2: 0.45, 3: 0.2 };

export const Z_AMBER = 1.5;
export const Z_RED = 2.5;

/** Rolling window (days) for the z-score computation. */
export const ROLLING_WINDOW = 90;
/** Minimum observations before a z-score is produced. */
export const ROLLING_MIN_PERIODS = 30;

/** Policy notices entered within this many days trigger the "Policy Shock" banner. */
export const POLICY_SHOCK_DAYS = 3;

export function statusForZ(z: number): 'green' | 'amber' | 'red' {
  const a = Math.abs(z);
  if (a >= Z_RED) return 'red';
  if (a >= Z_AMBER) return 'amber';
  return 'green';
}