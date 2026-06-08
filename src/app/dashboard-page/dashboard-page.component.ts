import { CommonModule, CurrencyPipe } from '@angular/common';
import { Component, HostListener, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonIcon, IonRefresher, IonRefresherContent } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  bagHandleOutline,
  bulbOutline,
  chevronDownOutline,
  logOutOutline,
  notificationsOutline,
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
  provisionedExpenses: number;
}

interface UpcomingMovement {
  id: number;
  description: string;
  dateLabel: string;
  value: number;
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
  private readonly now = new Date();
  private readonly financeFocusStorageKey = 'financeFocusTarget';
  private accountById = new Map<string, MovimentAccountSettings>();
  private accountByDescription = new Map<string, MovimentAccountSettings>();

  protected readonly currentMonth = new Intl.DateTimeFormat('pt-PT', { month: 'long' })
    .format(this.now)
    .replace(/^./, (letter) => letter.toUpperCase());
  protected readonly currentDay = this.now.getDate();
  protected readonly currentYear = this.now.getFullYear();
  protected readonly currentDateTimeLabel = this.getRoundedCurrentDateTimeLabel();
  protected readonly goalCurrent = 3100;
  protected readonly goalTarget = 5000;
  protected readonly goalProgress = 62;
  private loadedToken = '';
  private loadedBalancesRevision = -1;

  protected isLoading = false;
  protected errorMessage = '';
  protected isAccountMenuOpen = false;
  protected summary: DashboardSummary = {
    monthStartBalance: 0,
    monthEndBalance: 0,
    currentBalance: 0,
    savings: 0,
    income: 0,
    consumedExpenses: 0,
    provisionedExpenses: 0,
  };
  protected previousMonthSavings = 0;
  protected movementCount = 0;
  protected upcomingMovements: UpcomingMovement[] = [];

  constructor() {
    addIcons({
      bagHandleOutline,
      bulbOutline,
      chevronDownOutline,
      logOutOutline,
      notificationsOutline,
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

    const comparison = new Intl.NumberFormat('pt-PT', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(this.savingsComparison);

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
    const validRows = rows
      .filter((row) => !Number.isNaN(new Date(row.datetime).getTime()))
      .sort((left, right) => this.getTime(left) - this.getTime(right));
    this.movementCount = validRows.length;
    const currentMonthRows = validRows.filter((row) => this.isCurrentMonth(row));
    const consumedThisMonth = currentMonthRows.filter((row) => this.isStatus(row, 'consumado'));
    const provisionedThisMonth = currentMonthRows.filter((row) => this.isStatus(row, 'provisionado'));
    const previousMonthEnd = new Date(this.currentYear, this.now.getMonth(), 0, 23, 59, 59, 999);
    const currentMonthEnd = new Date(this.currentYear, this.now.getMonth() + 1, 0, 23, 59, 59, 999);
    const precedingMonthEnd = new Date(this.currentYear, this.now.getMonth() - 1, 0, 23, 59, 59, 999);
    const currentBalance = this.getDebitSnapshotTotal(this.getLatestRowAtOrBefore(validRows, this.now)?.balances);
    const monthStartBalance = this.getDebitSnapshotTotal(
      this.getLatestRowAtOrBefore(validRows, previousMonthEnd)?.balances,
    );
    const monthEndBalance = this.getDebitSnapshotTotal(
      this.getLatestRowAtOrBefore(validRows, currentMonthEnd)?.balances,
    );
    const precedingMonthBalance = this.getDebitSnapshotTotal(
      this.getLatestRowAtOrBefore(validRows, precedingMonthEnd)?.balances,
    );

    this.summary = {
      monthStartBalance,
      monthEndBalance,
      currentBalance,
      savings: monthEndBalance - monthStartBalance,
      income: this.sumValues(currentMonthRows.filter((row) => Number(row.value) > 0)),
      consumedExpenses: Math.abs(this.sumValues(
        consumedThisMonth.filter((row) => Number(row.value) < 0 && row.account_type !== 1),
      )),
      provisionedExpenses: Math.abs(this.sumValues(
        provisionedThisMonth.filter((row) => Number(row.value) < 0),
      )),
    };
    this.previousMonthSavings = monthStartBalance - precedingMonthBalance;

    this.upcomingMovements = validRows
      .filter((row) => this.isStatus(row, 'provisionado'))
      .filter((row) => this.getTime(row) >= this.getStartOfToday().getTime())
      .slice(0, 3)
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

  private isCurrentMonth(row: BalanceRow): boolean {
    const date = new Date(row.datetime);
    return date.getFullYear() === this.currentYear && date.getMonth() === this.now.getMonth();
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

  private getRoundedCurrentDateTimeLabel(): string {
    const roundedDate = new Date(this.now);
    roundedDate.setSeconds(0, 0);
    roundedDate.setMinutes(Math.round(roundedDate.getMinutes() / 30) * 30);
    const minutes = String(roundedDate.getMinutes()).padStart(2, '0');

    return `${roundedDate.getHours()}h${minutes}`;
  }
}
