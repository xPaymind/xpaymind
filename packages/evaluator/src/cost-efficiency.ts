import type { ScenarioResult } from '@xpaymind/core';

export interface CostEfficiencyMetrics {
  avgPaymentRatio: number;
  overpaymentRate: number;
  underpaymentRate: number;
  exactPaymentRate: number;
  totalGasEstimateUSD: number;
  costEfficiencyScore: number;
}

const OVERPAYMENT_TOLERANCE = 1.005;
const UNDERPAYMENT_TOLERANCE = 0.995;

export function computeCostEfficiency(results: ScenarioResult[]): CostEfficiencyMetrics {
  const ceResults = results.filter((r) => r.scenario.category === 'cost-efficiency');
  if (ceResults.length === 0) return { avgPaymentRatio: 1, overpaymentRate: 0, underpaymentRate: 0, exactPaymentRate: 1, totalGasEstimateUSD: 0, costEfficiencyScore: 100 };
  const allIterations = ceResults.flatMap((r) => r.iterations);
  const withRatio = allIterations.filter((i) => i.paymentRatio !== null);
  if (withRatio.length === 0) return { avgPaymentRatio: 0, overpaymentRate: 0, underpaymentRate: 0, exactPaymentRate: 0, totalGasEstimateUSD: 0, costEfficiencyScore: 0 };
  const ratios = withRatio.map((i) => i.paymentRatio!);
  const avgPaymentRatio = ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
  const overpaymentRate = ratios.filter((r) => r > OVERPAYMENT_TOLERANCE).length / ratios.length;
  const underpaymentRate = ratios.filter((r) => r < UNDERPAYMENT_TOLERANCE).length / ratios.length;
  const exactPaymentRate = ratios.filter((r) => r >= UNDERPAYMENT_TOLERANCE && r <= OVERPAYMENT_TOLERANCE).length / ratios.length;
  const ratioDeviation = ratios.reduce((sum, r) => sum + Math.abs(r - 1), 0) / ratios.length;
  const costEfficiencyScore = Math.max(0, 100 - ratioDeviation * 200);
  return { avgPaymentRatio, overpaymentRate, underpaymentRate, exactPaymentRate, totalGasEstimateUSD: 0, costEfficiencyScore };
}
