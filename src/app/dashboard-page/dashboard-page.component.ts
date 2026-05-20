import { CommonModule, CurrencyPipe } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { finalize } from 'rxjs';
import { BalanceRow, BalanceSnapshot, FinanceDataService } from '../finance-data.service';

interface SavingsSummary {
  lastYearLabel: string;
  focusYearLabel: string;
  lastYearTotal: number;
  focusYearTotal: number;
  balance: number;
}

interface LedgerMonth {
  monthKey: string;
  label: string;
}

interface LedgerAccountRow {
  name: string;
  balances: number[];
}

@Component({
  selector: 'app-dashboard-page',
  templateUrl: './dashboard-page.component.html',
  styleUrls: ['./dashboard-page.component.scss'],
  imports: [CommonModule, IonContent, CurrencyPipe],
})
export class DashboardPageComponent implements OnInit {
  private readonly financeData = inject(FinanceDataService);
  private readonly monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  protected isLoading = false;
  protected errorMessage = '';
  protected focusedYear = new Date().getUTCFullYear();
  protected savingsSummary: SavingsSummary = {
    lastYearLabel: '',
    focusYearLabel: '',
    lastYearTotal: 0,
    focusYearTotal: 0,
    balance: 0,
  };
  protected ledgerMonths: LedgerMonth[] = [];
  protected ledgerRows: LedgerAccountRow[] = [];
  protected selectedLedgerName = '';
  private rows: BalanceRow[] = [];

  ngOnInit(): void {
    this.loadDashboard();
  }

  protected trackByLedgerName(_: number, row: LedgerAccountRow): string {
    return row.name;
  }

  protected moveYear(offset: number): void {
    this.focusedYear += offset;
    this.buildDashboard(this.rows);
  }

  protected toggleLedgerSelection(name: string): void {
    this.selectedLedgerName = this.selectedLedgerName === name ? '' : name;
  }

  private loadDashboard(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.financeData
      .getBalances()
      .pipe(finalize(() => (this.isLoading = false)))
      .subscribe({
        next: (data) => {
          this.rows = data;
          this.focusedYear = this.getInitialFocusYear(data);
          this.buildDashboard(data);
        },
        error: () => {
          this.errorMessage = 'Unable to load dashboard data.';
        },
      });
  }

  private buildDashboard(rows: BalanceRow[]): void {
    const validRows = rows
      .filter((row) => !Number.isNaN(new Date(row.datetime).getTime()))
      .filter((row) => this.isConsumado(row))
      .sort((left, right) => new Date(left.datetime).getTime() - new Date(right.datetime).getTime());

    this.savingsSummary = this.buildSavingsSummary(validRows);
    this.ledgerMonths = this.buildLedgerMonths(this.focusedYear);
    this.ledgerRows = this.buildLedgerRows(validRows);
  }

  private buildSavingsSummary(rows: BalanceRow[]): SavingsSummary {
    const lastYearTotal = this.getYearEndSavings(rows, this.focusedYear - 1);
    const focusYearTotal = this.getYearEndSavings(rows, this.focusedYear);

    return {
      lastYearLabel: String(this.focusedYear - 1),
      focusYearLabel: String(this.focusedYear),
      lastYearTotal,
      focusYearTotal,
      balance: focusYearTotal - lastYearTotal,
    };
  }

  private buildLedgerMonths(year: number): LedgerMonth[] {
    return this.monthLabels.map((label, index) => ({
      monthKey: `${year}-${String(index + 1).padStart(2, '0')}`,
      label,
    }));
  }

  private buildLedgerRows(rows: BalanceRow[]): LedgerAccountRow[] {
    const ledgerNames = Array.from(new Set(
      rows.map((row) => row.ledger_account?.trim() || 'Uncategorized'),
    )).sort((left, right) => left.localeCompare(right));

    return ledgerNames.map((name) => ({
      name,
      balances: this.monthLabels.map((_, monthIndex) => {
        return rows.reduce((total, row) => {
          const date = new Date(row.datetime);
          const isTargetMonth =
            date.getUTCFullYear() === this.focusedYear &&
            date.getUTCMonth() === monthIndex &&
            (row.ledger_account?.trim() || 'Uncategorized') === name;

          return isTargetMonth ? total + Number(row.value || 0) : total;
        }, 0);
      }),
    }));
  }

  private getInitialFocusYear(rows: BalanceRow[]): number {
    const currentYear = new Date().getUTCFullYear();

    return rows.some((row) => new Date(row.datetime).getUTCFullYear() === currentYear)
      ? currentYear
      : new Date(rows[rows.length - 1]?.datetime ?? Date.now()).getUTCFullYear();
  }

  private getYearEndSavings(rows: BalanceRow[], year: number): number {
    const currentYearEnd = this.getYearEnd(year);

    return this.getPositiveBalanceTotal(
      this.getLatestRowAtOrBefore(rows, currentYearEnd)?.balances,
    );
  }

  private getLatestRowAtOrBefore(rows: BalanceRow[], targetDate: Date): BalanceRow | undefined {
    const targetTime = targetDate.getTime();

    return [...rows]
      .reverse()
      .find((row) => new Date(row.datetime).getTime() <= targetTime);
  }

  private getYearEnd(year: number): Date {
    return new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
  }

  private isConsumado(row: BalanceRow): boolean {
    return row.status?.trim().toLowerCase() === 'consumado';
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
