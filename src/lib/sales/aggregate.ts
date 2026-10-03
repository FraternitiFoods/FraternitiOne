/**
 * plan.md section 20A — pure aggregation helpers for the `/sales` dashboard.
 * Monthly/yearly totals, AOV and trend series are derived on read (never
 * stored) — this is the one place that derivation happens, so every card on
 * the page goes through the same math. No `server-only` import: takes plain
 * rows in, returns plain numbers out.
 */
import { toUtcDateKey } from "./parse-csv";

export type SalesDayLike = {
  date: string; // YYYY-MM-DD
  grossSales: number; // paise
  netSales: number; // paise
  orders: number;
};

export type SalesTotals = {
  grossSales: number;
  netSales: number;
  orders: number;
};

export function sumSalesDays(rows: SalesDayLike[]): SalesTotals {
  return rows.reduce<SalesTotals>(
    (acc, r) => ({
      grossSales: acc.grossSales + r.grossSales,
      netSales: acc.netSales + r.netSales,
      orders: acc.orders + r.orders,
    }),
    { grossSales: 0, netSales: 0, orders: 0 }
  );
}

export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7); // YYYY-MM
}

export function yearKeyOf(dateKey: string): string {
  return dateKey.slice(0, 4); // YYYY
}

function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toUtcDateKey(dt);
}

function previousMonthKey(dateKey: string): string {
  const [y, m] = dateKey.split("-").map(Number);
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  return `${prev.y}-${String(prev.m).padStart(2, "0")}`;
}

export type SalesPeriodCards = {
  today: SalesTotals;
  yesterday: SalesTotals;
  thisMonth: SalesTotals;
  lastMonth: SalesTotals;
  thisYear: SalesTotals;
};

export function computePeriodCards(rows: SalesDayLike[], now: Date): SalesPeriodCards {
  const todayKey = toUtcDateKey(now);
  const yesterdayKey = addDays(todayKey, -1);
  const thisMonthKey = monthKeyOf(todayKey);
  const lastMonthKey = previousMonthKey(todayKey);
  const thisYearKey = yearKeyOf(todayKey);

  return {
    today: sumSalesDays(rows.filter((r) => r.date === todayKey)),
    yesterday: sumSalesDays(rows.filter((r) => r.date === yesterdayKey)),
    thisMonth: sumSalesDays(rows.filter((r) => monthKeyOf(r.date) === thisMonthKey)),
    lastMonth: sumSalesDays(rows.filter((r) => monthKeyOf(r.date) === lastMonthKey)),
    thisYear: sumSalesDays(rows.filter((r) => yearKeyOf(r.date) === thisYearKey)),
  };
}

export type TrendPoint = { date: string; netSales: number };

/** Last 30 calendar days ending today, zero-filled for days with no SalesDay row. */
export function computeDailyTrend(rows: SalesDayLike[], now: Date, days = 30): TrendPoint[] {
  const todayKey = toUtcDateKey(now);
  const byDate = new Map(rows.map((r) => [r.date, r.netSales]));
  const points: TrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(todayKey, -i);
    points.push({ date, netSales: byDate.get(date) ?? 0 });
  }
  return points;
}

export type MonthlyBar = { month: string; netSales: number };

/** Jan-Dec of the current year, zero-filled for months with no rows. */
export function computeMonthlyBars(rows: SalesDayLike[], now: Date): MonthlyBar[] {
  const yearKey = yearKeyOf(toUtcDateKey(now));
  const byMonth = new Map<string, number>();
  for (const r of rows) {
    if (yearKeyOf(r.date) !== yearKey) continue;
    const key = monthKeyOf(r.date);
    byMonth.set(key, (byMonth.get(key) ?? 0) + r.netSales);
  }
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${yearKey}-${String(i + 1).padStart(2, "0")}`;
    return { month, netSales: byMonth.get(month) ?? 0 };
  });
}
