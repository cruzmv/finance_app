import { CommonModule, CurrencyPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { finalize } from 'rxjs';
import { environment } from '../../environments/environment';

type BalanceSnapshot = Record<string, number>;

interface BalanceRow {
  id: number;
  datetime: string;
  description: string;
  ledger_account: string;
  moviment_account: string;
  status: string;
  value: string;
  balances: BalanceSnapshot;
}

interface BalanceResponse {
  data: BalanceRow[];
}

interface SavingsPoint {
  monthKey: string;
  label: string;
  savings: number;
  heightPercent: number;
  isCurrentMonth: boolean;
}

interface LedgerSummary {
  name: string;
  total: number;
  percent: number;
}

@Component({
  selector: 'app-dashboard-page',
  templateUrl: './dashboard-page.component.html',
  styleUrls: ['./dashboard-page.component.scss'],
  imports: [CommonModule, IonContent, CurrencyPipe],
})
export class DashboardPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl;

  protected isLoading = false;
  protected errorMessage = '';
  protected currentSavings = 0;
  protected savingsDelta = 0;
  protected monthlySavings: SavingsPoint[] = [];
  protected topLedgerAccounts: LedgerSummary[] = [];
  protected monthlyIncome = 0;
  protected monthlyOutcome = 0;
  protected monthlySavingsChange = 0;

  ngOnInit(): void {
    this.loadDashboard();
  }

  protected get savingsDeltaTone(): string {
    return this.savingsDelta < 0 ? 'negative' : 'positive';
  }

  private loadDashboard(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.http
      .get<BalanceResponse>(`${this.apiBaseUrl}/get_balance`)
      .pipe(finalize(() => (this.isLoading = false)))
      .subscribe({
        next: ({ data }) => this.buildDashboard(data),
        error: () => {
          this.errorMessage = 'Unable to load dashboard data.';
        },
      });
  }

  private buildDashboard(rows: BalanceRow[]): void {
    const validRows = rows
      .filter((row) => !Number.isNaN(new Date(row.datetime).getTime()))
      .sort((left, right) => new Date(left.datetime).getTime() - new Date(right.datetime).getTime());
    const now = new Date();
    const currentRows = validRows.filter((row) => new Date(row.datetime).getTime() <= now.getTime());
    const latestRow = currentRows[currentRows.length - 1];
    const previousRow = currentRows[currentRows.length - 2];

    this.currentSavings = this.getPositiveBalanceTotal(latestRow?.balances);
    this.savingsDelta = this.currentSavings - this.getPositiveBalanceTotal(previousRow?.balances);
    this.monthlySavings = this.buildMonthlySavings(validRows, now);
    this.topLedgerAccounts = this.buildTopLedgerAccounts(validRows);
    this.buildCurrentMonthTotals(validRows, now);
  }

  private buildMonthlySavings(rows: BalanceRow[], currentDate: Date): SavingsPoint[] {
    const points = Array.from({ length: 7 }, (_, index) => {
      const monthDate = new Date(Date.UTC(
        currentDate.getUTCFullYear(),
        currentDate.getUTCMonth() + index - 3,
        1,
      ));
      const monthKey = this.getMonthKey(monthDate);
      const monthEnd = this.getMonthEnd(monthDate);
      const row = this.getLatestRowAtOrBefore(rows, monthEnd);

      return {
        monthKey,
        label: monthDate.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
        savings: this.getPositiveBalanceTotal(row?.balances),
        heightPercent: 0,
        isCurrentMonth: index === 3,
      };
    });

    const maxSavings = Math.max(...points.map((point) => point.savings), 1);

    return points.map((point) => ({
      ...point,
      heightPercent: Math.max((point.savings / maxSavings) * 100, 6),
    }));
  }

  private buildTopLedgerAccounts(rows: BalanceRow[]): LedgerSummary[] {
    const ledgerTotals = new Map<string, number>();

    rows.forEach((row) => {
      const value = Number(row.value);

      if (value >= 0) {
        return;
      }

      const name = row.ledger_account?.trim() || 'Uncategorized';
      ledgerTotals.set(name, (ledgerTotals.get(name) ?? 0) + Math.abs(value));
    });

    const topLedgers = Array.from(ledgerTotals.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((left, right) => right.total - left.total)
      .slice(0, 3);
    const maxTotal = Math.max(...topLedgers.map((ledger) => ledger.total), 1);

    return topLedgers.map((ledger) => ({
      ...ledger,
      percent: (ledger.total / maxTotal) * 100,
    }));
  }

  private buildCurrentMonthTotals(rows: BalanceRow[], currentDate: Date): void {
    if (rows.length === 0) {
      this.monthlyIncome = 0;
      this.monthlyOutcome = 0;
      this.monthlySavingsChange = 0;
      return;
    }

    const latestYear = currentDate.getUTCFullYear();
    const latestMonth = currentDate.getUTCMonth();
    const monthRows = rows.filter((row) => {
      const date = new Date(row.datetime);
      return date.getUTCFullYear() === latestYear && date.getUTCMonth() === latestMonth;
    });

    this.monthlyIncome = monthRows.reduce((total, row) => {
      const value = Number(row.value);
      return value > 0 ? total + value : total;
    }, 0);
    this.monthlyOutcome = monthRows.reduce((total, row) => {
      const value = Number(row.value);
      return value < 0 ? total + Math.abs(value) : total;
    }, 0);

    const currentMonthEnd = this.getMonthEnd(currentDate);
    const previousMonthEnd = this.getMonthEnd(new Date(Date.UTC(latestYear, latestMonth - 1, 1)));
    const currentMonthEndRow = this.getLatestRowAtOrBefore(rows, currentMonthEnd);
    const previousMonthEndRow = this.getLatestRowAtOrBefore(rows, previousMonthEnd);
    this.monthlySavingsChange =
      this.getPositiveBalanceTotal(currentMonthEndRow?.balances) -
      this.getPositiveBalanceTotal(previousMonthEndRow?.balances);
  }

  private getLatestRowAtOrBefore(rows: BalanceRow[], targetDate: Date): BalanceRow | undefined {
    const targetTime = targetDate.getTime();

    return [...rows]
      .reverse()
      .find((row) => new Date(row.datetime).getTime() <= targetTime);
  }

  private getMonthEnd(date: Date): Date {
    return new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    ));
  }

  private getMonthKey(date: Date): string {
    return [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
    ].join('-');
  }

  private getPositiveBalanceTotal(balances: BalanceSnapshot | null | undefined): number {
    if (!balances) {
      return 0;
    }

    return Object.values(balances).reduce((total, value) => {
      const numericValue = Number(value) || 0;
      return numericValue > 0 ? total + numericValue : total;
    }, 0);
  }
}
