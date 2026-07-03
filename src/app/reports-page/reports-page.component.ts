import { CommonModule, CurrencyPipe } from '@angular/common';
import { Component, HostListener, OnInit, inject } from '@angular/core';
import { IonContent, IonIcon, IonRefresher, IonRefresherContent } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  barChartOutline,
  calculatorOutline,
  cardOutline,
  chevronBackOutline,
  chevronDownOutline,
  chevronForwardOutline,
  trendingDownOutline,
  trendingUpOutline,
  warningOutline,
  walletOutline,
} from 'ionicons/icons';
import { finalize, forkJoin } from 'rxjs';
import {
  BalanceRow,
  BalanceSnapshot,
  FinanceDataService,
  LedgerAccountSettings,
  MovimentAccountSettings,
} from '../finance-data.service';

interface CategoryReportRow {
  ledgerAccountId: number;
  name: string;
  total: number;
  incomeTotal: number;
  expenseTotal: number;
  movementCount: number;
  isIncomeCategory: boolean;
}

interface ReportMonthOption {
  key: string;
  label: string;
  date: Date;
}

@Component({
  selector: 'app-reports-page',
  templateUrl: './reports-page.component.html',
  styleUrls: ['./reports-page.component.scss'],
  imports: [CommonModule, CurrencyPipe, IonContent, IonIcon, IonRefresher, IonRefresherContent],
})
export class ReportsPageComponent implements OnInit {
  private readonly financeData = inject(FinanceDataService);
  private readonly now = new Date();
  private rows: BalanceRow[] = [];
  private ledgerAccounts = new Map<number, LedgerAccountSettings>();
  private accountById = new Map<string, MovimentAccountSettings>();
  private accountByDescription = new Map<string, MovimentAccountSettings>();
  private monthSavings = 0;

  protected selectedMonthDate = new Date(this.now.getFullYear(), this.now.getMonth(), 1);
  protected categoryRows: CategoryReportRow[] = [];
  protected availableMonthOptions: ReportMonthOption[] = [];
  protected isLoading = false;
  protected errorMessage = '';
  protected isMonthPickerOpen = false;

  constructor() {
    addIcons({
      barChartOutline,
      calculatorOutline,
      cardOutline,
      chevronBackOutline,
      chevronDownOutline,
      chevronForwardOutline,
      trendingDownOutline,
      trendingUpOutline,
      warningOutline,
      walletOutline,
    });
  }

  ngOnInit(): void {
    this.loadReport();
  }

  ionViewWillEnter(): void {
    this.loadReport();
  }

  protected get selectedMonthLabel(): string {
    return new Intl.DateTimeFormat('pt-PT', { month: 'long' })
      .format(this.selectedMonthDate)
      .replace(/^./, (letter) => letter.toUpperCase());
  }

  protected get selectedYear(): number {
    return this.selectedMonthDate.getFullYear();
  }

  protected get incomeTotal(): number {
    return this.categoryRows.reduce((total, row) => total + row.incomeTotal, 0);
  }

  protected get expenseTotal(): number {
    return this.categoryRows.reduce((total, row) => total + row.expenseTotal, 0);
  }

  protected get receivedIncomeTotal(): number {
    return this.getSelectedMonthRows()
      .filter((row) => Number(row.value) > 0 && this.isStatus(row, 'consumado'))
      .reduce((total, row) => total + (Number(row.value) || 0), 0);
  }

  protected get receivableIncomeTotal(): number {
    return this.getSelectedMonthRows()
      .filter((row) => Number(row.value) > 0 && this.isStatus(row, 'provisionado'))
      .reduce((total, row) => total + (Number(row.value) || 0), 0);
  }

  protected get consumedExpenseTotal(): number {
    return this.getSelectedMonthRows()
      .filter((row) => Number(row.value) < 0 && this.isStatus(row, 'consumado'))
      .reduce((total, row) => total + Math.abs(Number(row.value) || 0), 0);
  }

  protected get provisionedExpenseTotal(): number {
    return this.getSelectedMonthRows()
      .filter((row) => Number(row.value) < 0 && this.isStatus(row, 'provisionado'))
      .reduce((total, row) => total + Math.abs(Number(row.value) || 0), 0);
  }

  protected get consumedDebitExpenseTotal(): number {
    return this.getSelectedMonthRows()
      .filter((row) => Number(row.value) < 0 && row.account_type !== 1 && this.isStatus(row, 'consumado'))
      .reduce((total, row) => total + Math.abs(Number(row.value) || 0), 0);
  }

  protected get consumedCreditExpenseTotal(): number {
    return this.getSelectedMonthRows()
      .filter((row) => Number(row.value) < 0 && row.account_type === 1 && this.isStatus(row, 'consumado'))
      .reduce((total, row) => total + Math.abs(Number(row.value) || 0), 0);
  }

  protected get provisionedDebitExpenseTotal(): number {
    return this.getSelectedMonthRows()
      .filter((row) => Number(row.value) < 0 && row.account_type !== 1 && this.isStatus(row, 'provisionado'))
      .reduce((total, row) => total + Math.abs(Number(row.value) || 0), 0);
  }

  protected get provisionedCreditExpenseTotal(): number {
    return this.getSelectedMonthRows()
      .filter((row) => Number(row.value) < 0 && row.account_type === 1 && this.isStatus(row, 'provisionado'))
      .reduce((total, row) => total + Math.abs(Number(row.value) || 0), 0);
  }

  protected getPercent(part: number, total: number): number {
    return total ? (part / total) * 100 : 0;
  }

  protected get cashExpenseTotal(): number {
    return this.getSelectedMonthRows()
      .filter((row) => Number(row.value) < 0 && row.account_type !== 1)
      .reduce((total, row) => total + Math.abs(Number(row.value) || 0), 0);
  }

  protected get creditExpenseTotal(): number {
    return this.getSelectedMonthRows()
      .filter((row) => Number(row.value) < 0 && row.account_type === 1)
      .reduce((total, row) => total + Math.abs(Number(row.value) || 0), 0);
  }

  protected get netTotal(): number {
    return this.monthSavings;
  }

  protected refreshReport(event: CustomEvent): void {
    this.loadReport(true, event);
  }

  protected changeSelectedMonth(direction: -1 | 1): void {
    this.selectedMonthDate = new Date(
      this.selectedMonthDate.getFullYear(),
      this.selectedMonthDate.getMonth() + direction,
      1,
    );
    this.isMonthPickerOpen = false;
    this.buildCategoryRows();
  }

  protected toggleMonthPicker(event: Event): void {
    event.stopPropagation();
    this.isMonthPickerOpen = !this.isMonthPickerOpen;
  }

  protected selectMonth(option: ReportMonthOption, event: Event): void {
    event.stopPropagation();
    this.selectedMonthDate = new Date(option.date);
    this.isMonthPickerOpen = false;
    this.buildCategoryRows();
  }

  protected isSelectedMonthOption(option: ReportMonthOption): boolean {
    return option.key === this.getMonthKey(this.selectedMonthDate);
  }

  @HostListener('document:click')
  protected closeMonthPicker(): void {
    this.isMonthPickerOpen = false;
  }

  private loadReport(forceRefresh = false, refreshEvent?: CustomEvent): void {
    if (this.isLoading) {
      this.completeRefresh(refreshEvent);
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    forkJoin({
      balances: this.financeData.getBalances(forceRefresh),
      settings: this.financeData.getFinanceSettings(),
    })
      .pipe(finalize(() => {
        this.isLoading = false;
        this.completeRefresh(refreshEvent);
      }))
      .subscribe({
        next: ({ balances, settings }) => {
          this.rows = balances;
          this.ledgerAccounts = new Map(settings.ledgerAccounts.map((account) => [account.id, account]));
          this.setAccountLookup(settings.accounts);
          this.buildCategoryRows();
        },
        error: () => {
          this.errorMessage = 'Não foi possível carregar os relatórios.';
        },
      });
  }

  private buildCategoryRows(): void {
    const reportMap = new Map<number, CategoryReportRow>();
    const validRows = this.getValidRows(this.rows);
    this.availableMonthOptions = this.buildAvailableMonthOptions(validRows);
    const monthRows = validRows.filter((row) => this.isSelectedMonth(row));

    monthRows.forEach((row) => {
      const ledgerAccountId = Number(row.ledger_account_id) || 0;
      const value = Number(row.value) || 0;
      const current = reportMap.get(ledgerAccountId) ?? {
        ledgerAccountId,
        name: this.getLedgerAccountName(row),
        total: 0,
        incomeTotal: 0,
        expenseTotal: 0,
        movementCount: 0,
        isIncomeCategory: false,
      };

      current.total += value;
      current.incomeTotal += value > 0 ? value : 0;
      current.expenseTotal += value < 0 ? Math.abs(value) : 0;
      current.movementCount += 1;
      reportMap.set(ledgerAccountId, current);
    });

    reportMap.forEach((row) => {
      row.isIncomeCategory = row.incomeTotal > 0 && row.total > 0;
    });

    this.monthSavings = this.getMonthSavings(validRows);
    this.categoryRows = Array.from(reportMap.values()).sort((left, right) => {
      if (left.isIncomeCategory !== right.isIncomeCategory) {
        return left.isIncomeCategory ? -1 : 1;
      }

      const leftMagnitude = Math.abs(left.total);
      const rightMagnitude = Math.abs(right.total);

      return rightMagnitude - leftMagnitude || left.name.localeCompare(right.name);
    });
  }

  private getValidRows(rows: BalanceRow[]): BalanceRow[] {
    return rows
      .filter((row) => !Number.isNaN(new Date(row.datetime).getTime()))
      .sort((left, right) => this.getTime(left) - this.getTime(right));
  }

  private buildAvailableMonthOptions(rows: BalanceRow[]): ReportMonthOption[] {
    const optionsByKey = new Map<string, ReportMonthOption>();

    rows.forEach((row) => {
      const date = new Date(row.datetime);
      const monthDate = new Date(date.getFullYear(), date.getMonth(), 1);
      const key = this.getMonthKey(monthDate);

      if (optionsByKey.has(key)) {
        return;
      }

      optionsByKey.set(key, {
        key,
        label: `${this.getMonthLabel(monthDate)} ${monthDate.getFullYear()}`,
        date: monthDate,
      });
    });

    if (optionsByKey.size === 0) {
      const fallbackDate = new Date(this.selectedMonthDate);
      const key = this.getMonthKey(fallbackDate);

      optionsByKey.set(key, {
        key,
        label: `${this.getMonthLabel(fallbackDate)} ${fallbackDate.getFullYear()}`,
        date: fallbackDate,
      });
    }

    return Array.from(optionsByKey.values())
      .sort((left, right) => right.date.getTime() - left.date.getTime());
  }

  private getSelectedMonthRows(): BalanceRow[] {
    return this.getValidRows(this.rows).filter((row) => this.isSelectedMonth(row));
  }

  private getMonthSavings(rows: BalanceRow[]): number {
    const selectedYear = this.selectedMonthDate.getFullYear();
    const selectedMonth = this.selectedMonthDate.getMonth();
    const monthStart = new Date(selectedYear, selectedMonth, 1, 0, 0, 0, 0);
    const monthEnd = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59, 999);
    const monthStartBalance = this.getDebitSnapshotTotal(
      this.getLatestRowAtOrBefore(rows, monthStart)?.balances,
    );
    const monthEndBalance = this.getDebitSnapshotTotal(
      this.getLatestRowAtOrBefore(rows, monthEnd)?.balances,
    );

    return monthEndBalance - monthStartBalance;
  }

  private getLedgerAccountName(row: BalanceRow): string {
    return this.ledgerAccounts.get(Number(row.ledger_account_id))?.description
      ?? row.ledger_account
      ?? 'Sem categoria';
  }

  private isSelectedMonth(row: BalanceRow): boolean {
    const date = new Date(row.datetime);

    return date.getFullYear() === this.selectedMonthDate.getFullYear()
      && date.getMonth() === this.selectedMonthDate.getMonth();
  }

  private isStatus(row: BalanceRow, status: string): boolean {
    return row.status?.trim().toLowerCase() === status;
  }

  private getLatestRowAtOrBefore(rows: BalanceRow[], targetDate: Date): BalanceRow | undefined {
    const targetTime = targetDate.getTime();

    return [...rows].reverse().find((row) => this.getTime(row) <= targetTime);
  }

  private getDebitSnapshotTotal(balances: BalanceSnapshot | null | undefined): number {
    return Object.entries(balances ?? {}).reduce((total, [key, value]) => {
      const account = this.getBalanceAccount(key);

      return account?.account_type === 0 ? total + (Number(value) || 0) : total;
    }, 0);
  }

  private setAccountLookup(accounts: MovimentAccountSettings[]): void {
    this.accountById = new Map(accounts.map((account) => [String(account.id), account]));
    this.accountByDescription = new Map(
      accounts.map((account) => [this.normalizeDescription(account.description), account]),
    );
  }

  private getBalanceAccount(key: string): MovimentAccountSettings | undefined {
    return this.accountById.get(key) ?? this.accountByDescription.get(this.normalizeDescription(key));
  }

  private normalizeDescription(description: string | null | undefined): string {
    return (description ?? '').trim().toLocaleLowerCase();
  }

  private getTime(row: BalanceRow): number {
    return new Date(row.datetime).getTime();
  }

  private getMonthLabel(date: Date): string {
    return new Intl.DateTimeFormat('pt-PT', { month: 'long' })
      .format(date)
      .replace(/^./, (letter) => letter.toUpperCase());
  }

  private getMonthKey(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');

    return `${date.getFullYear()}-${month}`;
  }

  private completeRefresh(event?: CustomEvent): void {
    const refresher = event?.target as unknown as { complete?: () => Promise<void> | void };
    void refresher?.complete?.();
  }
}
