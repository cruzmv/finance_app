import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonIcon, IonRefresher, IonRefresherContent } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  airplaneOutline,
  alertCircleOutline,
  bagHandleOutline,
  businessOutline,
  calendarOutline,
  carOutline,
  cardOutline,
  cartOutline,
  cashOutline,
  chevronBackOutline,
  bulbOutline,
  chevronDownOutline,
  chevronForwardOutline,
  checkmarkCircleOutline,
  gameControllerOutline,
  homeOutline,
  logOutOutline,
  medkitOutline,
  notificationsOutline,
  receiptOutline,
  restaurantOutline,
  schoolOutline,
  timeOutline,
  trendingDownOutline,
  trendingUpOutline,
  walletOutline,
} from 'ionicons/icons';
import { finalize, forkJoin } from 'rxjs';
import { AuthService } from '../auth.service';
import { AppCurrencyPipe } from '../app-currency.pipe';
import { CurrencySettingsService } from '../currency-settings.service';
import {
  BalanceRow,
  BalanceSnapshot,
  FinanceDataService,
  LedgerAccountSettings,
  MovimentAccountSettings,
  StatusSettings,
} from '../finance-data.service';

interface DashboardSummary {
  monthStartBalance: number;
  monthEndBalance: number;
  currentBalance: number;
  savings: number;
  income: number;
  receivedIncome: number;
  receivableIncome: number;
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
  category: string;
  datetime: string;
  dateLabel: string;
  icon: string;
  value: number;
  balances: BalanceSnapshot;
  accountType: 0 | 1 | null;
}

interface DashboardNotification {
  id: string;
  movement: BalanceRow;
  title: string;
  message: string;
  dueLabel: string;
  isRead: boolean;
}

interface CreditSummary {
  payable: number;
  open: number;
  balance: number;
  payableCount: number;
  openCount: number;
  payableLabel: string;
}

interface BalanceEntry {
  name: string;
  value: number;
  accountType: 0 | 1 | null;
  icon: string;
}

interface SavingsTrendPoint {
  label: string;
  value: number;
  x: number;
  y: number;
}

interface DashboardMonthOption {
  key: string;
  label: string;
  date: Date;
}

@Component({
  selector: 'app-dashboard-page',
  templateUrl: './dashboard-page.component.html',
  styleUrls: ['./dashboard-page.component.scss'],
  imports: [CommonModule, IonContent, IonIcon, IonRefresher, IonRefresherContent, AppCurrencyPipe],
})
export class DashboardPageComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly financeData = inject(FinanceDataService);
  private readonly currencySettings = inject(CurrencySettingsService);
  private readonly router = inject(Router);
  private now = new Date();
  private readonly monthSwipeThreshold = 48;
  private monthSwipeStartX = 0;
  private monthSwipeStartY = 0;
  private readonly financeFocusStorageKey = 'financeFocusTarget';
  private ledgerAccounts = new Map<number, LedgerAccountSettings>();
  private ledgerAccountOptions: LedgerAccountSettings[] = [];
  private movimentAccountOptions: MovimentAccountSettings[] = [];
  private statusOptions: StatusSettings[] = [];
  private accountById = new Map<string, MovimentAccountSettings>();
  private accountByDescription = new Map<string, MovimentAccountSettings>();
  private dashboardRows: BalanceRow[] = [];
  private readonly notificationReadStorageKey = 'dashboardProvisionNotificationReads';
  private readonly notificationSentStorageKey = 'dashboardProvisionNotificationSent';
  private readonly notificationLeadTimeMs = 6 * 60 * 60 * 1000;
  private notificationTimers: ReturnType<typeof setTimeout>[] = [];

  private loadedToken = '';
  private loadedBalancesRevision = -1;

  protected isLoading = false;
  protected errorMessage = '';
  protected isAccountMenuOpen = false;
  protected isMonthPickerOpen = false;
  protected isNotificationMenuOpen = false;
  protected selectedMonthDate = new Date(this.now.getFullYear(), this.now.getMonth(), 1);
  protected summary: DashboardSummary = {
    monthStartBalance: 0,
    monthEndBalance: 0,
    currentBalance: 0,
    savings: 0,
    income: 0,
    receivedIncome: 0,
    receivableIncome: 0,
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
    payableCount: 0,
    openCount: 0,
    payableLabel: 'A pagar',
  };
  protected creditAccounts: MovimentAccountSettings[] = [];
  protected previousMonthSavings = 0;
  protected movementCount = 0;
  protected upcomingMovements: UpcomingMovement[] = [];
  protected savingsTrend: SavingsTrendPoint[] = [];
  protected availableMonthOptions: DashboardMonthOption[] = [];
  protected expandedUpcomingMovementIds = new Set<number>();
  protected dashboardNotifications: DashboardNotification[] = [];

  constructor() {
    addIcons({
      airplaneOutline,
      alertCircleOutline,
      bagHandleOutline,
      bulbOutline,
      businessOutline,
      calendarOutline,
      carOutline,
      cardOutline,
      cartOutline,
      cashOutline,
      chevronBackOutline,
      checkmarkCircleOutline,
      chevronDownOutline,
      chevronForwardOutline,
      gameControllerOutline,
      homeOutline,
      logOutOutline,
      medkitOutline,
      notificationsOutline,
      receiptOutline,
      restaurantOutline,
      schoolOutline,
      timeOutline,
      trendingDownOutline,
      trendingUpOutline,
      walletOutline,
    });
  }

  ngOnInit(): void {
    this.loadDashboard();
  }

  ngOnDestroy(): void {
    this.clearNotificationTimers();
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

  protected get shouldShowCreditSummary(): boolean {
    return this.creditAccounts.length > 0;
  }

  protected get hasUnreadNotifications(): boolean {
    return this.dashboardNotifications.some((notification) => !notification.isRead);
  }

  protected get selectedMonthKey(): string {
    return this.getMonthKey(this.selectedMonthDate);
  }

  protected get selectedMonthRenderKeys(): string[] {
    return [this.selectedMonthKey];
  }

  protected changeSelectedMonth(direction: -1 | 1): void {
    this.selectedMonthDate = new Date(
      this.selectedMonthDate.getFullYear(),
      this.selectedMonthDate.getMonth() + direction,
      1,
    );
    this.isMonthPickerOpen = false;
    this.buildDashboard(this.dashboardRows);
  }

  protected startMonthSwipe(event: TouchEvent): void {
    const touch = event.changedTouches.item(0);
    if (!touch) {
      return;
    }

    this.monthSwipeStartX = touch.clientX;
    this.monthSwipeStartY = touch.clientY;
  }

  protected finishMonthSwipe(event: TouchEvent): void {
    const touch = event.changedTouches.item(0);
    if (!touch) {
      return;
    }

    const deltaX = touch.clientX - this.monthSwipeStartX;
    const deltaY = touch.clientY - this.monthSwipeStartY;
    const isHorizontalSwipe =
      Math.abs(deltaX) >= this.monthSwipeThreshold && Math.abs(deltaY) <= Math.abs(deltaX) * 0.75;

    if (!isHorizontalSwipe) {
      return;
    }

    this.changeSelectedMonth(deltaX < 0 ? 1 : -1);
  }

  protected toggleAccountMenu(event: Event): void {
    event.stopPropagation();
    this.isAccountMenuOpen = !this.isAccountMenuOpen;
    this.isMonthPickerOpen = false;
    this.isNotificationMenuOpen = false;
  }

  protected logout(): void {
    this.isAccountMenuOpen = false;
    this.auth.logout();
  }

  protected toggleMonthPicker(event: Event): void {
    event.stopPropagation();
    this.isMonthPickerOpen = !this.isMonthPickerOpen;
    this.isAccountMenuOpen = false;
    this.isNotificationMenuOpen = false;
  }

  protected toggleNotificationMenu(event: Event): void {
    event.stopPropagation();
    this.isNotificationMenuOpen = !this.isNotificationMenuOpen;
    this.isAccountMenuOpen = false;
    this.isMonthPickerOpen = false;

    if (this.isNotificationMenuOpen) {
      this.markNotificationsAsRead();
    }
  }

  protected selectMonth(option: DashboardMonthOption, event: Event): void {
    event.stopPropagation();
    this.selectedMonthDate = new Date(option.date);
    this.isMonthPickerOpen = false;
    this.buildDashboard(this.dashboardRows);
  }

  protected isSelectedMonthOption(option: DashboardMonthOption): boolean {
    return option.key === this.getMonthKey(this.selectedMonthDate);
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

  protected get savingsStartPercent(): number {
    if (!this.summary.monthStartBalance) {
      return 0;
    }

    return (this.summary.savings / this.summary.monthStartBalance) * 100;
  }

  protected get savingsTrendPolyline(): string {
    return this.savingsTrend.map((point) => `${point.x},${point.y}`).join(' ');
  }

  protected get totalMonthExpenses(): number {
    return this.summary.consumedExpenses + this.summary.provisionedExpenses;
  }

  protected getPercent(part: number, total: number): number {
    return total ? (part / total) * 100 : 0;
  }

  protected getMovementCountLabel(count: number): string {
    return count === 1 ? '1 movimento' : `${count} movimentos`;
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
      return `Você economizou ${comparison} a menos em relação ao mês passado.`;
    }

    return `Você economizou ${comparison} em relação ao mês passado.`;
  }

  protected get forecastTitle(): string {
    return this.forecastTone === 'positive' && this.movementCount >= 10 ? 'Excelente!' : '';
  }

  protected get forecastTone(): 'positive' | 'warning' | 'danger' {
    if (this.movementCount >= 10 && this.summary.savings < 100) {
      return 'danger';
    }

    return this.summary.savings >= this.previousMonthSavings ? 'positive' : 'warning';
  }

  protected isUpcomingMovementExpanded(movementId: number): boolean {
    return this.expandedUpcomingMovementIds.has(movementId);
  }

  protected toggleUpcomingMovement(movementId: number): void {
    if (this.expandedUpcomingMovementIds.has(movementId)) {
      this.expandedUpcomingMovementIds.delete(movementId);
      return;
    }

    this.expandedUpcomingMovementIds.add(movementId);
  }

  protected openMovementInFinance(movement: UpcomingMovement, event: Event): void {
    event.stopPropagation();
    const dayKey = this.getDateKey(movement.datetime);

    sessionStorage.setItem(this.financeFocusStorageKey, JSON.stringify({
      movementId: movement.id,
      datetime: movement.datetime,
      dayKey,
      monthKey: dayKey.slice(0, 7),
      expandDetails: true,
      expandDayBalances: false,
    }));
    void this.router.navigate(['/example/finance']);
  }

  private openEditMoviment(row: BalanceRow): void {
    const navigationState = this.buildMovimentNavigationState(row);

    sessionStorage.setItem('selectedMoviment', JSON.stringify(navigationState));
    void this.router.navigate(['/example/new'], {
      queryParams: { mode: 'edit' },
      state: navigationState,
    });
  }

  private buildMovimentNavigationState(row: BalanceRow) {
    return {
      mode: 'edit',
      moviment: row,
      ledgerAccounts: this.ledgerAccountOptions.map((account) => this.toOption(account.id, account.description, account.icon)),
      movimentAccounts: this.movimentAccountOptions.map((account) => this.toOption(account.id, account.description, account.icon)),
      statuses: this.statusOptions.map((status) => this.toOption(status.id, status.description, status.icon)),
    };
  }

  private toOption(id: number, name: string, icon?: string | null) {
    return { id, name, icon };
  }

  protected openNotificationMovement(notification: DashboardNotification, event?: Event): void {
    event?.stopPropagation();
    this.markNotificationAsRead(notification.id);
    this.openEditMoviment(notification.movement);
  }

  protected confirmNotificationMovement(notification: DashboardNotification, event: Event): void {
    event.stopPropagation();
    const settledStatus = this.getSettledStatusOption();

    if (!settledStatus) {
      this.errorMessage = 'Não foi possível encontrar o status Consumado.';
      return;
    }

    const shouldSettle = window.confirm(
      `Marcar "${notification.movement.description}" como Consumado?`,
    );

    if (!shouldSettle) {
      return;
    }

    this.markNotificationAsRead(notification.id);
    this.financeData.updateMovimentStatus(notification.movement, settledStatus.id).subscribe({
      next: () => {
        this.loadDashboard(true);
      },
      error: () => {
        this.errorMessage = 'Não foi possível marcar o movimento como Consumado.';
      },
    });
  }

  protected getBalanceEntries(balances: BalanceSnapshot | null | undefined): BalanceEntry[] {
    if (!balances) {
      return [];
    }

    return Object.entries(balances)
      .map(([key, value]) => {
        const account = this.getBalanceAccount(key);

        return {
          name: account?.description ?? key,
          value: Number(value) || 0,
          accountType: account?.account_type ?? null,
          icon: this.normalizeIcon(account?.icon, 'wallet-outline'),
        };
      })
      .sort((left, right) => {
        const leftIsCredit = left.accountType === 1;
        const rightIsCredit = right.accountType === 1;

        if (leftIsCredit !== rightIsCredit) {
          return leftIsCredit ? 1 : -1;
        }

        return left.name.localeCompare(right.name);
      });
  }

  protected getPositiveBalanceTotal(balances: BalanceEntry[]): number {
    return balances.reduce((total, balance) => balance.value > 0 ? total + balance.value : total, 0);
  }

  protected getBalanceToneClass(balance: BalanceEntry): string {
    return balance.accountType === 1 ? 'balance-amount-credit' : 'balance-amount-debit';
  }

  @HostListener('document:click')
  protected closeFloatingMenus(): void {
    this.isAccountMenuOpen = false;
    this.isMonthPickerOpen = false;
    this.isNotificationMenuOpen = false;
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
          this.ledgerAccountOptions = settings.ledgerAccounts;
          this.movimentAccountOptions = settings.accounts;
          this.statusOptions = settings.statuses;
          this.ledgerAccounts = new Map(settings.ledgerAccounts.map((account) => [account.id, account]));
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
    this.availableMonthOptions = this.buildAvailableMonthOptions(validRows);
    const selectedYear = this.selectedMonthDate.getFullYear();
    const selectedMonth = this.selectedMonthDate.getMonth();
    const selectedMonthRows = validRows.filter((row) => this.isSelectedMonth(row));
    const consumedThisMonth = selectedMonthRows.filter((row) => this.isStatus(row, 'consumado'));
    const provisionedThisMonth = selectedMonthRows.filter((row) => this.isStatus(row, 'provisionado'));
    const positiveThisMonth = selectedMonthRows.filter((row) => Number(row.value) > 0);
    const selectedMonthStart = new Date(selectedYear, selectedMonth, 1, 0, 0, 0, 0);
    const selectedMonthEnd = this.getEndOfMonth(this.selectedMonthDate);
    const precedingMonthEnd = new Date(selectedYear, selectedMonth - 1, 0, 23, 59, 59, 999);
    const currentBalance = this.getPositiveBalanceTotalFromSnapshot(
      this.getCurrentBalanceReferenceRow(validRows, selectedMonthRows, selectedMonthEnd)?.balances,
    );
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
      income: this.sumValues(positiveThisMonth),
      receivedIncome: this.sumValues(positiveThisMonth.filter((row) => this.isStatus(row, 'consumado'))),
      receivableIncome: this.sumValues(positiveThisMonth.filter((row) => this.isStatus(row, 'provisionado'))),
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
    this.savingsTrend = this.buildSavingsTrend(validRows);
    this.expandedUpcomingMovementIds = new Set(
      Array.from(this.expandedUpcomingMovementIds).filter((id) => validRows.some((row) => row.id === id)),
    );

    this.upcomingMovements = validRows
      .filter((row) => this.isStatus(row, 'provisionado'))
      .filter((row) => this.getTime(row) >= this.getStartOfToday().getTime())
      .map((row) => ({
        id: row.id,
        description: row.description,
        category: row.ledger_account,
        datetime: row.datetime,
        dateLabel: this.getFriendlyDate(row.datetime),
        icon: this.getLedgerAccountIcon(row),
        value: Number(row.value) || 0,
        balances: row.balances,
        accountType: row.account_type,
      }));
    this.dashboardNotifications = this.buildDashboardNotifications(validRows);
    this.scheduleProvisionNotifications(validRows);
  }

  private completeRefresh(event?: CustomEvent): void {
    const refresher = event?.target as unknown as { complete?: () => Promise<void> | void };
    void refresher?.complete?.();
  }

  private buildDashboardNotifications(rows: BalanceRow[]): DashboardNotification[] {
    const readIds = this.getStoredIdSet(this.notificationReadStorageKey);

    return rows
      .filter((row) => this.isProvisionedNotificationCandidate(row, this.now))
      .sort((left, right) => this.getTime(left) - this.getTime(right))
      .map((row) => {
        const id = this.getProvisionNotificationId(row);

        return {
          id,
          movement: row,
          title: 'Conta perto de ser executada',
          message: `"${row.description}" está prevista para acontecer em breve.`,
          dueLabel: this.getFriendlyDateTime(row.datetime),
          isRead: readIds.has(id),
        };
      });
  }

  private scheduleProvisionNotifications(rows: BalanceRow[]): void {
    this.clearNotificationTimers();

    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
          this.scheduleProvisionNotifications(rows);
        }
      });
    }

    const sentIds = this.getStoredIdSet(this.notificationSentStorageKey);

    rows
      .filter((row) => this.isStatus(row, 'provisionado'))
      .forEach((row) => {
        const notificationTime = this.getTime(row) - this.notificationLeadTimeMs;
        const delay = notificationTime - this.now.getTime();

        if (delay > 2_147_483_647) {
          return;
        }

        if (delay <= 0) {
          if (this.isProvisionedNotificationCandidate(row, this.now)) {
            this.publishProvisionNotification(row, sentIds);
          }
          return;
        }

        this.notificationTimers.push(setTimeout(() => {
          this.publishProvisionNotification(row, this.getStoredIdSet(this.notificationSentStorageKey));
        }, delay));
      });
  }

  private publishProvisionNotification(row: BalanceRow, sentIds: Set<string>): void {
    this.now = new Date();
    this.dashboardNotifications = this.buildDashboardNotifications(this.dashboardRows);
    this.showProvisionSystemNotification(row, sentIds);
  }

  private showProvisionSystemNotification(row: BalanceRow, sentIds: Set<string>): void {
    const id = this.getProvisionNotificationId(row);

    if (!this.canUseSystemNotifications() || sentIds.has(id)) {
      return;
    }

    const notification = new Notification('Conta perto de ser executada', {
      body: `${row.description}. Deseja marcar como Consumado?`,
      tag: id,
    });

    notification.onclick = () => {
      window.focus();
      this.openEditMoviment(row);
    };

    sentIds.add(id);
    this.storeIdSet(this.notificationSentStorageKey, sentIds);
  }

  private clearNotificationTimers(): void {
    this.notificationTimers.forEach((timer) => clearTimeout(timer));
    this.notificationTimers = [];
  }

  private canUseSystemNotifications(): boolean {
    if (!('Notification' in window)) {
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    return false;
  }

  private isProvisionedNotificationCandidate(row: BalanceRow, referenceDate: Date): boolean {
    const movementTime = this.getTime(row);
    const nowTime = referenceDate.getTime();

    return this.isStatus(row, 'provisionado') &&
      movementTime >= nowTime &&
      movementTime - nowTime <= this.notificationLeadTimeMs;
  }

  private markNotificationsAsRead(): void {
    if (this.dashboardNotifications.length === 0) {
      return;
    }

    const readIds = this.getStoredIdSet(this.notificationReadStorageKey);

    this.dashboardNotifications.forEach((notification) => readIds.add(notification.id));
    this.storeIdSet(this.notificationReadStorageKey, readIds);
    this.dashboardNotifications = this.dashboardNotifications.map((notification) => ({
      ...notification,
      isRead: true,
    }));
  }

  private markNotificationAsRead(id: string): void {
    const readIds = this.getStoredIdSet(this.notificationReadStorageKey);

    readIds.add(id);
    this.storeIdSet(this.notificationReadStorageKey, readIds);
    this.dashboardNotifications = this.dashboardNotifications.map((notification) => {
      return notification.id === id ? { ...notification, isRead: true } : notification;
    });
  }

  private getStoredIdSet(key: string): Set<string> {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]);
    } catch {
      return new Set<string>();
    }
  }

  private storeIdSet(key: string, values: Set<string>): void {
    localStorage.setItem(key, JSON.stringify(Array.from(values)));
  }

  private getProvisionNotificationId(row: BalanceRow): string {
    return `${row.id}:${row.datetime}`;
  }

  private getFriendlyDateTime(datetime: string): string {
    const date = new Date(datetime);

    return `${this.getFriendlyDate(datetime)}, ${new Intl.DateTimeFormat('pt-PT', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)}`;
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

  private buildSavingsTrend(rows: BalanceRow[]): SavingsTrendPoint[] {
    const monthReferences = Array.from({ length: 6 }, (_, index) => {
      return new Date(
        this.selectedMonthDate.getFullYear(),
        this.selectedMonthDate.getMonth() - (5 - index),
        1,
      );
    });
    const values = monthReferences.map((monthDate) => {
      const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1, 0, 0, 0, 0);
      const monthEnd = this.getEndOfMonth(monthDate);
      const startBalance = this.getDebitSnapshotTotal(this.getLatestRowAtOrBefore(rows, monthStart)?.balances);
      const endBalance = this.getDebitSnapshotTotal(this.getLatestRowAtOrBefore(rows, monthEnd)?.balances);

      return endBalance - startBalance;
    });
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const range = maxValue - minValue || 1;

    return monthReferences.map((monthDate, index) => ({
      label: new Intl.DateTimeFormat('pt-PT', { month: 'short' }).format(monthDate).replace('.', ''),
      value: values[index],
      x: 15.83 + index * 31.67,
      y: 60 - ((values[index] - minValue) / range) * 44,
    }));
  }

  private buildAvailableMonthOptions(rows: BalanceRow[]): DashboardMonthOption[] {
    const optionsByKey = new Map<string, DashboardMonthOption>();

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

      optionsByKey.set(this.getMonthKey(fallbackDate), {
        key: this.getMonthKey(fallbackDate),
        label: `${this.getMonthLabel(fallbackDate)} ${fallbackDate.getFullYear()}`,
        date: fallbackDate,
      });
    }

    return Array.from(optionsByKey.values())
      .sort((left, right) => right.date.getTime() - left.date.getTime());
  }

  private getLatestRowAtOrBefore(rows: BalanceRow[], targetDate: Date): BalanceRow | undefined {
    const targetTime = targetDate.getTime();
    return [...rows].reverse().find((row) => this.getTime(row) <= targetTime);
  }

  private getCurrentBalanceReferenceRow(
    rows: BalanceRow[],
    selectedMonthRows: BalanceRow[],
    selectedMonthEnd: Date,
  ): BalanceRow | undefined {
    if (this.isCurrentSelectedMonth()) {
      const nowTime = this.now.getTime();

      return [...rows].reverse().find((row) => {
        return this.getTime(row) <= nowTime && this.isStatus(row, 'consumado');
      });
    }

    return this.getLatestRowAtOrBefore(selectedMonthRows, selectedMonthEnd);
  }

  private getDebitSnapshotTotal(balances: BalanceSnapshot | null | undefined): number {
    return Object.entries(balances ?? {}).reduce((total, [key, value]) => {
      const account = this.getBalanceAccount(key);

      return account?.account_type === 0 ? total + (Number(value) || 0) : total;
    }, 0);
  }

  private getPositiveBalanceTotalFromSnapshot(balances: BalanceSnapshot | null | undefined): number {
    return this.getBalanceEntries(balances).reduce((total, balance) => {
      return balance.value > 0 ? total + balance.value : total;
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

  private getLedgerAccountIcon(row: BalanceRow): string {
    return this.normalizeIcon(this.ledgerAccounts.get(Number(row.ledger_account_id))?.icon, 'receipt-outline');
  }

  private normalizeIcon(icon: string | null | undefined, fallbackIcon: string): string {
    return (icon ?? '').trim() || fallbackIcon;
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
    const isCurrentMonth = this.isCurrentSelectedMonth();
    const isPastMonth = this.isPastSelectedMonth();
    const initialSummary: CreditSummary = {
      payable: 0,
      open: 0,
      balance: 0,
      payableCount: 0,
      openCount: 0,
      payableLabel: isPastMonth ? 'Pago' : 'A pagar',
    };

    const summary = this.creditAccounts.reduce<CreditSummary>((creditSummary, account) => {
      const accountRows = rows.filter((row) => this.isCreditAccountMovement(row, account));
      const lastClosingDate = this.getCreditClosingDate(account);
      const previousClosingDate = this.getPreviousClosingDate(lastClosingDate, account);
      const nextClosingDate = this.getNextClosingDate(lastClosingDate, account);
      const payableRows = this.getCreditExpenseRows(accountRows, previousClosingDate, lastClosingDate);
      const openRows = this.getCreditConsumedRows(accountRows, lastClosingDate, nextClosingDate);
      const payable = Math.abs(this.sumValues(payableRows));
      const open = Math.abs(this.sumValues(openRows));
      const limit = this.toNumber(account.start_value);
      const isBillPaid = this.hasPaidCreditBill(rows, account, payable);
      const payableAffectsBalance = isPastMonth || (isCurrentMonth && isBillPaid) ? 0 : payable;

      return {
        ...creditSummary,
        payable: creditSummary.payable + payable,
        open: creditSummary.open + open,
        balance: creditSummary.balance + limit - payableAffectsBalance - open,
        payableCount: creditSummary.payableCount + payableRows.length,
        openCount: creditSummary.openCount + openRows.length,
        payableLabel: creditSummary.payableLabel,
      };
    }, initialSummary);

    if (isCurrentMonth && summary.payable > 0 && this.areSelectedMonthCreditBillsPaid(rows)) {
      summary.payableLabel = 'Pago';
    }

    return summary;
  }

  private isCreditAccountMovement(row: BalanceRow, account: MovimentAccountSettings): boolean {
    return row.account_type === 1 && Number(row.moviment_account_id) === account.id;
  }

  private getCreditExpenseRows(rows: BalanceRow[], afterDate: Date, untilDate: Date): BalanceRow[] {
    const afterTime = afterDate.getTime();
    const untilTime = untilDate.getTime();

    return rows.filter((row) => {
      const time = this.getTime(row);

      return Number(row.value) < 0 &&
        this.isStatus(row, 'consumado') &&
        time > afterTime &&
        time <= untilTime;
    });
  }

  private getCreditConsumedRows(rows: BalanceRow[], afterDate: Date, untilDate: Date): BalanceRow[] {
    const afterTime = afterDate.getTime();
    const untilTime = untilDate.getTime();

    return rows.filter((row) => {
      const time = this.getTime(row);

      return Number(row.value) !== 0 &&
        this.isStatus(row, 'consumado') &&
        time > afterTime &&
        time <= untilTime;
    });
  }

  private getCreditReferenceDate(): Date {
    const selectedMonthEnd = this.getEndOfMonth(this.selectedMonthDate);
    const isCurrentMonth = this.selectedMonthDate.getFullYear() === this.now.getFullYear()
      && this.selectedMonthDate.getMonth() === this.now.getMonth();

    return isCurrentMonth && this.now.getTime() < selectedMonthEnd.getTime()
      ? this.now
      : selectedMonthEnd;
  }

  private getCreditClosingDate(account: MovimentAccountSettings): Date {
    const referenceDate = this.isCurrentSelectedMonth()
      ? this.getCreditReferenceDate()
      : this.getEndOfMonth(this.selectedMonthDate);
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

  private getNextClosingDate(lastClosingDate: Date, account: MovimentAccountSettings): Date {
    const nextMonthReference = new Date(lastClosingDate.getFullYear(), lastClosingDate.getMonth() + 1, 1);

    return new Date(
      nextMonthReference.getFullYear(),
      nextMonthReference.getMonth(),
      this.getSafeClosingDay(account, nextMonthReference),
      23,
      59,
      59,
      999,
    );
  }

  private hasPaidCreditBill(
    rows: BalanceRow[],
    account: MovimentAccountSettings,
    payable: number,
  ): boolean {
    if (!payable) {
      return false;
    }

    const billRows = rows.filter((row) => {
      const rowDate = new Date(row.datetime);

      if (!this.isStatus(row, 'consumado') || !this.isSelectedMonth(row)) {
        return false;
      }

      if (account.debit_account && Number(row.moviment_account_id) !== account.debit_account) {
        return false;
      }

      if (!account.debit_account && row.account_type === 1) {
        return false;
      }

      if (account.pay_day) {
        return this.isSameDay(rowDate, this.getSelectedMonthPayDate(account));
      }

      return true;
    });

    return billRows.some((row) => Math.abs(Math.abs(Number(row.value) || 0) - payable) < 0.01);
  }

  private areSelectedMonthCreditBillsPaid(rows: BalanceRow[]): boolean {
    return this.creditAccounts.every((account) => {
      const accountRows = rows.filter((row) => this.isCreditAccountMovement(row, account));
      const closingDate = this.getCreditClosingDate(account);
      const previousClosingDate = this.getPreviousClosingDate(closingDate, account);
      const payable = Math.abs(this.sumValues(
        this.getCreditExpenseRows(accountRows, previousClosingDate, closingDate),
      ));

      return payable === 0 || this.hasPaidCreditBill(rows, account, payable);
    });
  }

  private getSelectedMonthPayDate(account: MovimentAccountSettings): Date {
    const lastDayOfMonth = new Date(
      this.selectedMonthDate.getFullYear(),
      this.selectedMonthDate.getMonth() + 1,
      0,
    ).getDate();
    const payDay = Math.min(Math.max(account.pay_day ?? lastDayOfMonth, 1), lastDayOfMonth);

    return new Date(this.selectedMonthDate.getFullYear(), this.selectedMonthDate.getMonth(), payDay);
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

  private isCurrentSelectedMonth(): boolean {
    return this.selectedMonthDate.getFullYear() === this.now.getFullYear()
      && this.selectedMonthDate.getMonth() === this.now.getMonth();
  }

  private isPastSelectedMonth(): boolean {
    return this.selectedMonthDate.getFullYear() < this.now.getFullYear()
      || (
        this.selectedMonthDate.getFullYear() === this.now.getFullYear()
        && this.selectedMonthDate.getMonth() < this.now.getMonth()
      );
  }

  private isSameMonth(left: Date, right: Date): boolean {
    return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();
  }

  private isSameDay(left: Date, right: Date): boolean {
    return this.isSameMonth(left, right) && left.getDate() === right.getDate();
  }

  private isStatus(row: BalanceRow, status: string): boolean {
    return row.status?.trim().toLowerCase() === status;
  }

  private getSettledStatusOption(): StatusSettings | undefined {
    return this.statusOptions.find((status) => this.normalizeStatusName(status.description) === 'consumado')
      ?? this.statusOptions.find((status) => !this.isPendingStatus(status));
  }

  private isPendingStatus(status: StatusSettings | undefined): boolean {
    const normalizedStatus = this.normalizeStatusName(status?.description);

    return normalizedStatus.includes('provision') ||
      normalizedStatus.includes('pagar') ||
      normalizedStatus.includes('receber') ||
      normalizedStatus.includes('pending');
  }

  private normalizeStatusName(status: string | null | undefined): string {
    return (status ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleLowerCase('pt-BR');
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

  private getDateKey(value: string): string {
    return value.slice(0, 10);
  }

  private getMonthKey(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');

    return `${date.getFullYear()}-${month}`;
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
    return this.currencySettings.format(value);
  }
}
