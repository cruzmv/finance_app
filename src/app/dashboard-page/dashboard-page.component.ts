import { CommonModule, CurrencyPipe } from '@angular/common';
import { Component, HostListener, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonIcon, IonRefresher, IonRefresherContent } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  bagHandleOutline,
  calculatorOutline,
  cardOutline,
  chevronBackOutline,
  bulbOutline,
  chevronDownOutline,
  chevronForwardOutline,
  logOutOutline,
  notificationsOutline,
  walletOutline,
} from 'ionicons/icons';
import { finalize, forkJoin } from 'rxjs';
import { AuthService } from '../auth.service';
import {
  BalanceRow,
  BalanceSnapshot,
  FinanceDataService,
  MovimentAccountSettings,
} from '../finance-data.service';

interface DashboardSummary {
  monthStartBalance: number;
  monthEndBalance: number;
  currentBalance: number;
  savings: number;
  income: number;
  consumedExpenses: number;
  consumedDebitExpenses: number;
  consumedCreditExpenses: number;
  provisionedExpenses: number;
  provisionedDebitExpenses: number;
  provisionedCreditExpenses: number;
}

interface UpcomingMovement {
  id: number;
  description: string;
  dateLabel: string;
  value: number;
}

interface CreditSummary {
  payable: number;
  open: number;
  balance: number;
}

@Component({
  selector: 'app-dashboard-page',
  templateUrl: './dashboard-page.component.html',
  styleUrls: ['./dashboard-page.component.scss'],
  imports: [CommonModule, IonContent, IonIcon, IonRefresher, IonRefresherContent, CurrencyPipe],
})
export class DashboardPageComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly financeData = inject(FinanceDataService);
  private readonly router = inject(Router);
  private now = new Date();
  private readonly financeFocusStorageKey = 'financeFocusTarget';
  private accountById = new Map<string, MovimentAccountSettings>();
  private accountByDescription = new Map<string, MovimentAccountSettings>();
  private creditAccounts: MovimentAccountSettings[] = [];
  private dashboardRows: BalanceRow[] = [];

  private loadedToken = '';
  private loadedBalancesRevision = -1;

  protected isLoading = false;
  protected errorMessage = '';
  protected isAccountMenuOpen = false;
  protected selectedMonthDate = new Date(this.now.getFullYear(), this.now.getMonth(), 1);
  protected summary: DashboardSummary = {
    monthStartBalance: 0,
    monthEndBalance: 0,
    currentBalance: 0,
    savings: 0,
    income: 0,
    consumedExpenses: 0,
    consumedDebitExpenses: 0,
    consumedCreditExpenses: 0,
    provisionedExpenses: 0,
    provisionedDebitExpenses: 0,
    provisionedCreditExpenses: 0,
  };
  protected creditSummary: CreditSummary = {
    payable: 0,
    open: 0,
    balance: 0,
  };
  protected previousMonthSavings = 0;
  protected movementCount = 0;
  protected upcomingMovements: UpcomingMovement[] = [];

  constructor() {
    addIcons({
      bagHandleOutline,
      bulbOutline,
      calculatorOutline,
      cardOutline,
      chevronBackOutline,
      chevronDownOutline,
      chevronForwardOutline,
      logOutOutline,
      notificationsOutline,
      walletOutline,
    });
  }

  ngOnInit(): void {
    this.loadDashboard();
  }

  ionViewWillEnter(): void {
    if (
      this.loadedToken !== this.auth.token ||
      this.loadedBalancesRevision !== this.financeData.balancesRevision
    ) {
      this.loadDashboard(true);
    }
  }

  protected get username(): string {
    return this.auth.user?.username || 'Utilizador';
  }

  protected refreshDashboard(event: CustomEvent): void {
    this.loadDashboard(true, event);
  }

  protected get selectedMonthLabel(): string {
    return this.getMonthLabel(this.selectedMonthDate);
  }

  protected get selectedYear(): number {
    return this.selectedMonthDate.getFullYear();
  }

  protected changeSelectedMonth(direction: -1 | 1): void {
    this.selectedMonthDate = new Date(
      this.selectedMonthDate.getFullYear(),
      this.selectedMonthDate.getMonth() + direction,
      1,
    );
    this.buildDashboard(this.dashboardRows);
  }

  protected toggleAccountMenu(event: Event): void {
    event.stopPropagation();
    this.isAccountMenuOpen = !this.isAccountMenuOpen;
  }

  protected logout(): void {
    this.isAccountMenuOpen = false;
    this.auth.logout();
  }

  protected openTodayMovements(): void {
    const datetime = new Date().toISOString();
    const dayKey = datetime.slice(0, 10);

    sessionStorage.setItem(this.financeFocusStorageKey, JSON.stringify({
      datetime,
      preferPast: true,
      dayKey,
      monthKey: dayKey.slice(0, 7),
      expandDetails: false,
    }));
    void this.router.navigate(['/example/finance']);
  }

  protected get savingsComparison(): number {
    return Math.abs(this.summary.savings - this.previousMonthSavings);
  }

  protected get savingsLabel(): string {
    return this.summary.savings < 0 ? 'Em dívida' : 'Economia de';
  }

  protected get forecastMessage(): string {
    if (this.movementCount < 10) {
      return 'Cadastre entradas e saídas financeiras.';
    }

    if (this.forecastTone === 'danger') {
      return 'Você está gastando demais!';
    }

    const comparison = this.formatEuro(this.savingsComparison);

    if (this.forecastTone === 'warning') {
      return `Você está ${comparison} menor que o mês passado.`;
    }

    return `Você está ${comparison} melhor que o mês passado.`;
  }

  protected get forecastTone(): 'positive' | 'warning' | 'danger' {
    if (this.movementCount >= 10 && this.summary.savings < 100) {
      return 'danger';
    }

    return this.summary.savings >= this.previousMonthSavings ? 'positive' : 'warning';
  }

  @HostListener('document:click')
  protected closeAccountMenu(): void {
    this.isAccountMenuOpen = false;
  }

  private loadDashboard(forceRefresh = false, refreshEvent?: CustomEvent): void {
    this.now = new Date();
    this.loadedToken = this.auth.token;
    this.loadedBalancesRevision = this.financeData.balancesRevision;
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
          this.setAccountLookup(settings.accounts);
          this.buildDashboard(balances);
        },
        error: () => {
          this.errorMessage = 'Não foi possível carregar o resumo.';
        },
      });
  }

  private buildDashboard(rows: BalanceRow[]): void {
    this.dashboardRows = rows;
    const validRows = rows
      .filter((row) => !Number.isNaN(new Date(row.datetime).getTime()))
      .sort((left, right) => this.getTime(left) - this.getTime(right));
    const selectedYear = this.selectedMonthDate.getFullYear();
    const selectedMonth = this.selectedMonthDate.getMonth();
    const selectedMonthRows = validRows.filter((row) => this.isSelectedMonth(row));
    const consumedThisMonth = selectedMonthRows.filter((row) => this.isStatus(row, 'consumado'));
    const provisionedThisMonth = selectedMonthRows.filter((row) => this.isStatus(row, 'provisionado'));
    const selectedMonthStart = new Date(selectedYear, selectedMonth, 1, 0, 0, 0, 0);
    const selectedMonthEnd = this.getEndOfMonth(this.selectedMonthDate);
    const precedingMonthEnd = new Date(selectedYear, selectedMonth - 1, 0, 23, 59, 59, 999);
    const currentBalance = this.getDebitSnapshotTotal(this.getLatestRowAtOrBefore(validRows, selectedMonthEnd)?.balances);
    const consumedDebitExpenses = Math.abs(this.sumValues(
      consumedThisMonth.filter((row) => Number(row.value) < 0 && row.account_type !== 1),
    ));
    const consumedCreditExpenses = Math.abs(this.sumValues(
      consumedThisMonth.filter((row) => Number(row.value) < 0 && row.account_type === 1),
    ));
    const provisionedDebitExpenses = Math.abs(this.sumValues(
      provisionedThisMonth.filter((row) => Number(row.value) < 0 && row.account_type !== 1),
    ));
    const provisionedCreditExpenses = Math.abs(this.sumValues(
      provisionedThisMonth.filter((row) => Number(row.value) < 0 && row.account_type === 1),
    ));
    const monthStartBalance = this.getDebitSnapshotTotal(
      this.getLatestRowAtOrBefore(validRows, selectedMonthStart)?.balances,
    );
    const monthEndBalance = this.getDebitSnapshotTotal(
      this.getLatestRowAtOrBefore(validRows, selectedMonthEnd)?.balances,
    );
    const precedingMonthBalance = this.getDebitSnapshotTotal(
      this.getLatestRowAtOrBefore(validRows, precedingMonthEnd)?.balances,
    );

    this.summary = {
      monthStartBalance,
      monthEndBalance,
      currentBalance,
      savings: monthEndBalance - monthStartBalance,
      income: this.sumValues(selectedMonthRows.filter((row) => Number(row.value) > 0)),
      consumedExpenses: consumedDebitExpenses + consumedCreditExpenses,
      consumedDebitExpenses,
      consumedCreditExpenses,
      provisionedExpenses: provisionedDebitExpenses + provisionedCreditExpenses,
      provisionedDebitExpenses,
      provisionedCreditExpenses,
    };
    this.creditSummary = this.buildCreditSummary(validRows);
    this.previousMonthSavings = monthStartBalance - precedingMonthBalance;
    this.movementCount = selectedMonthRows.length;

    this.upcomingMovements = validRows
      .filter((row) => this.isStatus(row, 'provisionado'))
      .filter((row) => this.getTime(row) >= this.getStartOfToday().getTime())
      .map((row) => ({
        id: row.id,
        description: row.description,
        dateLabel: this.getFriendlyDate(row.datetime),
        value: Number(row.value) || 0,
      }));
  }

  private completeRefresh(event?: CustomEvent): void {
    const refresher = event?.target as unknown as { complete?: () => Promise<void> | void };
    void refresher?.complete?.();
  }

  private getFriendlyDate(datetime: string): string {
    const movementDate = new Date(datetime);
    const startOfToday = this.getStartOfToday();
    const dayDifference = Math.round(
      (this.getStartOfDay(movementDate).getTime() - startOfToday.getTime()) / 86_400_000,
    );

    if (dayDifference === 0) {
      return 'Hoje';
    }

    if (dayDifference === 1) {
      return 'Amanhã';
    }

    return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short' })
      .format(movementDate)
      .replace('.', '');
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
    this.creditAccounts = accounts.filter((account) => account.account_type === 1);
  }

  private getBalanceAccount(key: string): MovimentAccountSettings | undefined {
    return this.accountById.get(key) ?? this.accountByDescription.get(this.normalizeDescription(key));
  }

  private normalizeDescription(description: string | null | undefined): string {
    return (description ?? '').trim().toLocaleLowerCase();
  }

  private sumValues(rows: BalanceRow[]): number {
    return rows.reduce((total, row) => total + (Number(row.value) || 0), 0);
  }

  private toNumber(value: string | number | null | undefined): number {
    if (typeof value === 'number') {
      return value;
    }

    return Number((value ?? '').replace(',', '.')) || 0;
  }

  private buildCreditSummary(rows: BalanceRow[]): CreditSummary {
    return this.creditAccounts.reduce<CreditSummary>((summary, account) => {
      const accountRows = rows.filter((row) => this.isCreditAccountMovement(row, account));
      const lastClosingDate = this.getLastClosingDate(account);
      const previousClosingDate = this.getPreviousClosingDate(lastClosingDate, account);
      const payable = this.getCreditExpenseTotal(accountRows, previousClosingDate, lastClosingDate);
      const open = this.getCreditExpenseTotal(accountRows, lastClosingDate, this.getCreditReferenceDate());
      const limit = this.toNumber(account.start_value);

      return {
        payable: summary.payable + payable,
        open: summary.open + open,
        balance: summary.balance + limit - payable - open,
      };
    }, { payable: 0, open: 0, balance: 0 });
  }

  private isCreditAccountMovement(row: BalanceRow, account: MovimentAccountSettings): boolean {
    return row.account_type === 1 && Number(row.moviment_account_id) === account.id;
  }

  private getCreditExpenseTotal(rows: BalanceRow[], afterDate: Date, untilDate: Date): number {
    const afterTime = afterDate.getTime();
    const untilTime = untilDate.getTime();

    return Math.abs(this.sumValues(
      rows.filter((row) => {
        const time = this.getTime(row);

        return Number(row.value) < 0 && time > afterTime && time <= untilTime;
      }),
    ));
  }

  private getCreditReferenceDate(): Date {
    const selectedMonthEnd = this.getEndOfMonth(this.selectedMonthDate);
    const isCurrentMonth = this.selectedMonthDate.getFullYear() === this.now.getFullYear()
      && this.selectedMonthDate.getMonth() === this.now.getMonth();

    return isCurrentMonth && this.now.getTime() < selectedMonthEnd.getTime()
      ? this.now
      : selectedMonthEnd;
  }

  private getLastClosingDate(account: MovimentAccountSettings): Date {
    const referenceDate = this.getCreditReferenceDate();
    const closingDay = this.getSafeClosingDay(account, referenceDate);
    const closingDate = new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth(),
      closingDay,
      23,
      59,
      59,
      999,
    );

    if (closingDate.getTime() <= referenceDate.getTime()) {
      return closingDate;
    }

    const previousMonthReference = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1);

    return new Date(
      previousMonthReference.getFullYear(),
      previousMonthReference.getMonth(),
      this.getSafeClosingDay(account, previousMonthReference),
      23,
      59,
      59,
      999,
    );
  }

  private getPreviousClosingDate(lastClosingDate: Date, account: MovimentAccountSettings): Date {
    const previousMonthReference = new Date(lastClosingDate.getFullYear(), lastClosingDate.getMonth() - 1, 1);

    return new Date(
      previousMonthReference.getFullYear(),
      previousMonthReference.getMonth(),
      this.getSafeClosingDay(account, previousMonthReference),
      23,
      59,
      59,
      999,
    );
  }

  private getSafeClosingDay(account: MovimentAccountSettings, referenceDate: Date): number {
    const lastDayOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate();
    const closingDay = account.closing_day ?? lastDayOfMonth;

    return Math.min(Math.max(closingDay, 1), lastDayOfMonth);
  }

  private isSelectedMonth(row: BalanceRow): boolean {
    const date = new Date(row.datetime);
    return date.getFullYear() === this.selectedMonthDate.getFullYear()
      && date.getMonth() === this.selectedMonthDate.getMonth();
  }

  private isStatus(row: BalanceRow, status: string): boolean {
    return row.status?.trim().toLowerCase() === status;
  }

  private getTime(row: BalanceRow): number {
    return new Date(row.datetime).getTime();
  }

  private getStartOfToday(): Date {
    return this.getStartOfDay(this.now);
  }

  private getStartOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private getEndOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  private getMonthLabel(date: Date): string {
    return new Intl.DateTimeFormat('pt-PT', { month: 'long' })
      .format(date)
      .replace(/^./, (letter) => letter.toUpperCase());
  }

  private formatEuro(value: number): string {
    const formattedValue = new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);

    return `€ ${formattedValue}`;
  }
}
