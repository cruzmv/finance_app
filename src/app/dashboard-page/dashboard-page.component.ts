import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, OnInit, inject } from '@angular/core';
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
import { AuthService, UserProfile } from '../auth.service';
import { AppCurrencyPipe } from '../app-currency.pipe';
import { CurrencySettingsService } from '../currency-settings.service';
import {
  BalanceRow,
  BalanceSnapshot,
  ContractOnboardingSetup,
  FinanceDataService,
  LedgerAccountSettings,
  MovimentAccountSettings,
  StatusSettings,
} from '../finance-data.service';
import { NotificationDeliveryService } from '../notification-delivery.service';
import { AppNotification, evaluateNotifications } from '../notification-settings';
import { getCreditBillSettings } from '../credit-bill-settings';

interface DashboardSummary {
  monthStartBalance: number;
  monthEndBalance: number;
  currentBalance: number;
  savings: number;
  yearToDateSavings: number;
  income: number;
  receivedIncome: number;
  receivableIncome: number;
  receivedIncomeCount: number;
  receivableIncomeCount: number;
  consumedExpenses: number;
  consumedDebitExpenses: number;
  consumedCreditExpenses: number;
  consumedExpensesCount: number;
  consumedDebitExpensesCount: number;
  consumedCreditExpensesCount: number;
  provisionedExpenses: number;
  provisionedDebitExpenses: number;
  provisionedCreditExpenses: number;
  provisionedExpensesCount: number;
  provisionedDebitExpensesCount: number;
  provisionedCreditExpensesCount: number;
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

interface CreditSummary {
  payable: number;
  open: number;
  balance: number;
  payableCount: number;
  openCount: number;
  payableLabel: string;
  openLabel: string;
  payableDateLabel: string;
  openDateLabel: string;
}

interface BalanceEntry {
  name: string;
  value: number;
  accountType: 0 | 1 | null;
  icon: string;
}

interface SavingsTrendPoint {
  label: string;
  year: number;
  month: number;
  value: number;
  x: number;
  y: number;
}

interface SavingsTrendYearSegment {
  year: number;
  start: number;
  span: number;
}

interface DashboardMonthOption {
  key: string;
  label: string;
  date: Date;
}

interface ProfileAvatarOption {
  id: string;
  label: string;
  backgroundPosition: string;
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
  private readonly notificationDelivery = inject(NotificationDeliveryService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private now = new Date();
  private readonly monthSwipeThreshold = 48;
  private monthSwipeStartX = 0;
  private monthSwipeStartY = 0;
  private isMonthTransitionRunning = false;
  private savingsTrendPointerId: number | null = null;
  private savingsTrendLastTapAt = 0;
  private savingsTrendLastTapX = 0;
  private savingsTrendLastTapY = 0;
  private savingsTrendShuttleAnchorX = 0;
  private savingsTrendShuttleClientX = 0;
  private savingsTrendShuttleSpeed = 0;
  private savingsTrendShuttleAccumulator = 0;
  private savingsTrendShuttleLastFrame = 0;
  private savingsTrendShuttleFrame?: number;
  private savingsTrendShuttleChart: SVGSVGElement | null = null;
  private savingsTrendPointClickTimer?: ReturnType<typeof setTimeout>;
  private savingsTrendSuppressClickUntil = 0;
  private savingsTrendShuttleAnimations: Animation[] = [];
  private readonly financeFocusStorageKey = 'financeFocusTarget';
  private readonly settingsInitialViewStorageKey = 'settingsInitialView';
  protected readonly negativeSavingsCardBackground =
    'linear-gradient(118deg, rgba(124, 20, 28, 0.98) 0%, rgba(199, 45, 55, 0.98) 56%, rgba(132, 24, 32, 0.98) 100%)';
  protected readonly negativeSavingsCardShadow = '0 12px 22px rgba(178, 35, 45, 0.24)';
  private ledgerAccounts = new Map<number, LedgerAccountSettings>();
  private ledgerAccountOptions: LedgerAccountSettings[] = [];
  private movimentAccountOptions: MovimentAccountSettings[] = [];
  private statusOptions: StatusSettings[] = [];
  private accountById = new Map<string, MovimentAccountSettings>();
  private accountByDescription = new Map<string, MovimentAccountSettings>();
  private dashboardRows: BalanceRow[] = [];
  private readonly notificationReadStorageKey = 'dashboardProvisionNotificationReads';
  private readonly notificationSentStorageKey = 'dashboardProvisionNotificationSent';
  private notificationTimers: ReturnType<typeof setTimeout>[] = [];
  private onboardingSetup: ContractOnboardingSetup | null = null;
  private profile: UserProfile | null = null;
  protected readonly profileAvatarOptions: ProfileAvatarOption[] = [
    { id: 'pao-duro', label: 'O Milionário Pão-Duro', backgroundPosition: '0% 0%' },
    { id: 'bilionario-nervosinho', label: 'O Bilionário Nervosinho', backgroundPosition: '33.333% 0%' },
    { id: 'rainha-cupons', label: 'A Rainha dos Cupons', backgroundPosition: '66.667% 0%' },
    { id: 'rei-pix', label: 'O Rei do Pix', backgroundPosition: '100% 0%' },
    { id: 'investidora-zen', label: 'A Investidora Zen', backgroundPosition: '0% 33.333%' },
    { id: 'gastador-compulsivo', label: 'O Gastador Compulsivo', backgroundPosition: '33.333% 33.333%' },
    { id: 'cacadora-promocoes', label: 'A Caçadora de Promoções', backgroundPosition: '66.667% 33.333%' },
    { id: 'contador-maluco', label: 'O Contador Maluco', backgroundPosition: '100% 33.333%' },
    { id: 'chefe-orcamento', label: 'A Chefe do Orçamento', backgroundPosition: '0% 66.667%' },
    { id: 'pirata-cashback', label: 'O Pirata do Cashback', backgroundPosition: '33.333% 66.667%' },
    { id: 'mago-juros-compostos', label: 'O Mago dos Juros Compostos', backgroundPosition: '66.667% 66.667%' },
    { id: 'capivara-economica', label: 'A Capivara Econômica', backgroundPosition: '100% 66.667%' },
    { id: 'gato-magnata', label: 'O Gato Magnata', backgroundPosition: '0% 100%' },
  ];

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
    yearToDateSavings: 0,
    income: 0,
    receivedIncome: 0,
    receivableIncome: 0,
    receivedIncomeCount: 0,
    receivableIncomeCount: 0,
    consumedExpenses: 0,
    consumedDebitExpenses: 0,
    consumedCreditExpenses: 0,
    consumedExpensesCount: 0,
    consumedDebitExpensesCount: 0,
    consumedCreditExpensesCount: 0,
    provisionedExpenses: 0,
    provisionedDebitExpenses: 0,
    provisionedCreditExpenses: 0,
    provisionedExpensesCount: 0,
    provisionedDebitExpensesCount: 0,
    provisionedCreditExpensesCount: 0,
  };
  protected creditSummary: CreditSummary = {
    payable: 0,
    open: 0,
    balance: 0,
    payableCount: 0,
    openCount: 0,
    payableLabel: 'A pagar',
    openLabel: 'Em aberto',
    payableDateLabel: '',
    openDateLabel: '',
  };
  protected creditAccounts: MovimentAccountSettings[] = [];
  protected previousMonthSavings = 0;
  protected movementCount = 0;
  protected upcomingMovements: UpcomingMovement[] = [];
  protected savingsTrend: SavingsTrendPoint[] = [];
  protected savingsTrendScrubPoint: SavingsTrendPoint | null = null;
  protected availableMonthOptions: DashboardMonthOption[] = [];
  protected expandedUpcomingMovementIds = new Set<number>();
  protected dashboardNotifications: AppNotification[] = [];
  protected viewportWidth = typeof window === 'undefined' ? 390 : window.innerWidth;

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
    this.stopSavingsTrendShuttle();
    if (this.savingsTrendPointClickTimer) {
      clearTimeout(this.savingsTrendPointClickTimer);
    }
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
    return this.profile?.name || this.profile?.username || this.auth.user?.name || this.auth.user?.username || 'Usuário';
  }

  protected get profileEmail(): string {
    return this.profile?.email || this.auth.user?.email || 'Email da conta';
  }

  protected get selectedProfileAvatar(): ProfileAvatarOption {
    const avatarId = this.getProfileAvatarId(this.onboardingSetup);

    return this.profileAvatarOptions.find((option) => option.id === avatarId) ?? this.profileAvatarOptions[0];
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

  protected get monthStartDateLabel(): string {
    return `01 ${this.selectedMonthLabel}`;
  }

  protected get monthEndDateLabel(): string {
    const lastDay = new Date(this.selectedYear, this.selectedMonthDate.getMonth() + 1, 0).getDate();

    return `${String(lastDay).padStart(2, '0')} ${this.selectedMonthLabel}`;
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
    const targetMonth = new Date(
      this.selectedMonthDate.getFullYear(),
      this.selectedMonthDate.getMonth() + direction,
      1,
    );

    this.navigateToMonth(targetMonth, direction);
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

  }

  protected selectMonth(option: DashboardMonthOption, event: Event): void {
    event.stopPropagation();
    const direction = option.date.getTime() >= this.selectedMonthDate.getTime() ? 1 : -1;

    this.navigateToMonth(option.date, direction);
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

  protected openProfileSettings(): void {
    sessionStorage.setItem(this.settingsInitialViewStorageKey, 'profile');
    void this.router.navigate(['/example/settings']);
  }

  protected get savingsComparison(): number {
    return Math.abs(this.summary.savings - this.previousMonthSavings);
  }

  protected get savingsLabel(): string {
    return this.summary.savings < 0 ? 'Em dívida' : 'Economia de';
  }

  protected get monthlySavingsMetricLabel(): string {
    if (this.summary.savings < 0) {
      return 'Gastos';
    }

    return this.isPastSelectedMonth() ? 'Economizado' : 'Economia prevista';
  }

  protected get primaryBalanceLabel(): string {
    return this.isCurrentSelectedMonth() ? 'Saldo atual' : this.monthStartDateLabel;
  }

  protected get primaryBalanceValue(): number {
    return this.isCurrentSelectedMonth() ? this.summary.currentBalance : this.summary.monthStartBalance;
  }

  protected get shouldShowCurrentMonthStartBalance(): boolean {
    return this.isCurrentSelectedMonth();
  }

  protected get yearToDateSavingsLabel(): string {
    const label = this.summary.yearToDateSavings < 0 ? 'Gastos' : 'Economizado';

    return `${label} do início do ano até ${this.selectedMonthLabel}`;
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

  protected get savingsTrendViewBoxWidth(): number {
    return this.getSavingsTrendChartWidth();
  }

  protected formatSavingsTrendValue(value: number): string {
    const option = this.currencySettings.option;
    const absoluteValue = Math.abs(value);
    const divisor = absoluteValue >= 1_000_000 ? 1_000_000 : absoluteValue >= 1_000 ? 1_000 : 1;
    const suffix = divisor === 1_000_000 ? 'mi' : divisor === 1_000 ? 'mil' : '';
    const compactValue = new Intl.NumberFormat(option.locale, {
      maximumFractionDigits: divisor === 1 ? 0 : 1,
    }).format(absoluteValue / divisor);

    return `${value < 0 ? '-' : ''}${option.symbol}${compactValue}${suffix}`;
  }

  protected selectSavingsTrendPoint(point: SavingsTrendPoint, event: Event): void {
    event.stopPropagation();

    if (Date.now() < this.savingsTrendSuppressClickUntil) {
      return;
    }

    const targetMonth = new Date(point.year, point.month, 1);
    const targetTime = targetMonth.getTime();
    const selectedTime = this.selectedMonthDate.getTime();

    if (targetTime === selectedTime) {
      return;
    }

    const navigate = () => this.navigateToMonth(targetMonth, targetTime > selectedTime ? 1 : -1);

    if (event instanceof MouseEvent && event.type === 'click' && event.detail > 0) {
      if (this.savingsTrendPointClickTimer) {
        clearTimeout(this.savingsTrendPointClickTimer);
      }
      this.savingsTrendPointClickTimer = setTimeout(() => {
        this.savingsTrendPointClickTimer = undefined;
        navigate();
      }, 410);
      return;
    }

    navigate();
  }

  protected startSavingsTrendScrub(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    const now = performance.now();
    const isSecondTap = now - this.savingsTrendLastTapAt <= 380 &&
      Math.hypot(event.clientX - this.savingsTrendLastTapX, event.clientY - this.savingsTrendLastTapY) <= 42;

    this.savingsTrendLastTapAt = now;
    this.savingsTrendLastTapX = event.clientX;
    this.savingsTrendLastTapY = event.clientY;

    if (!isSecondTap) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (this.savingsTrendPointClickTimer) {
      clearTimeout(this.savingsTrendPointClickTimer);
      this.savingsTrendPointClickTimer = undefined;
    }
    this.savingsTrendSuppressClickUntil = Date.now() + 900;
    this.savingsTrendPointerId = event.pointerId;
    this.savingsTrendShuttleAnchorX = event.clientX;
    this.savingsTrendShuttleClientX = event.clientX;
    this.savingsTrendShuttleSpeed = 0;
    this.savingsTrendShuttleAccumulator = 0;
    this.savingsTrendShuttleChart = event.currentTarget as SVGSVGElement;
    this.savingsTrendShuttleChart.setPointerCapture(event.pointerId);
    this.updateSavingsTrendScrubPoint(event);
    this.startSavingsTrendShuttle();
  }

  protected moveSavingsTrendScrub(event: PointerEvent): void {
    if (this.savingsTrendPointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.savingsTrendShuttleClientX = event.clientX;
    this.updateSavingsTrendScrubPoint(event);
    this.updateSavingsTrendShuttleSpeed(event);
  }

  protected finishSavingsTrendScrub(event: PointerEvent): void {
    if (this.savingsTrendPointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const chart = event.currentTarget as SVGSVGElement;

    if (chart.hasPointerCapture(event.pointerId)) {
      chart.releasePointerCapture(event.pointerId);
    }

    this.stopSavingsTrendShuttle();
  }

  protected cancelSavingsTrendScrub(event: PointerEvent): void {
    if (this.savingsTrendPointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();
    this.stopSavingsTrendShuttle();
  }

  protected isSavingsTrendPointHighlighted(point: SavingsTrendPoint, isLast: boolean): boolean {
    if (!this.savingsTrendScrubPoint) {
      return isLast;
    }

    return point.year === this.savingsTrendScrubPoint.year && point.month === this.savingsTrendScrubPoint.month;
  }

  protected get savingsTrendYearSegments(): SavingsTrendYearSegment[] {
    return this.savingsTrend.reduce<SavingsTrendYearSegment[]>((segments, point, index) => {
      const previous = segments[segments.length - 1];

      if (previous && previous.year === point.year) {
        previous.span += 1;
        return segments;
      }

      segments.push({ year: point.year, start: index + 1, span: 1 });
      return segments;
    }, []);
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

  protected openNotificationMovement(notification: AppNotification, event?: Event): void {
    event?.stopPropagation();
    if (!notification.movement) {
      return;
    }
    this.openEditMoviment(notification.movement);
  }

  protected confirmNotificationMovement(notification: AppNotification, event: Event): void {
    event.stopPropagation();
    if (!notification.movement) {
      this.markNotificationAsRead(notification.id);
      return;
    }

    const settledStatus = this.getSettledStatusOption();
    const settledResultLabel = this.getNotificationResultLabel(notification.movement);

    if (!settledStatus) {
      this.errorMessage = `Não foi possível encontrar o status para marcar como ${settledResultLabel}.`;
      return;
    }

    const shouldSettle = window.confirm(
      `Marcar "${notification.movement.description}" como ${settledResultLabel}?`,
    );

    if (!shouldSettle) {
      return;
    }

    this.financeData.updateMovimentStatus(notification.movement, settledStatus.id).subscribe({
      next: () => {
        this.markNotificationAsRead(notification.id);
        void this.notificationDelivery.cancelNativeNotification(notification.id);
        this.loadDashboard(true);
      },
      error: () => {
        this.errorMessage = `Não foi possível marcar o movimento como ${settledResultLabel}.`;
      },
    });
  }

  protected getNotificationActionLabel(row: BalanceRow): string {
    return Number(row.value) >= 0 ? 'Receber' : 'Pagar';
  }

  private getNotificationResultLabel(row: BalanceRow): string {
    return Number(row.value) >= 0 ? 'recebido' : 'pago';
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

  @HostListener('window:resize')
  protected handleWindowResize(): void {
    const nextViewportWidth = window.innerWidth;
    const previousTrendLength = this.getSavingsTrendMonthCount(this.viewportWidth);
    const nextTrendLength = this.getSavingsTrendMonthCount(nextViewportWidth);

    this.viewportWidth = nextViewportWidth;

    if (previousTrendLength !== nextTrendLength) {
      this.savingsTrend = this.buildSavingsTrend(
        this.dashboardRows
          .filter((row) => !Number.isNaN(new Date(row.datetime).getTime()))
          .sort((left, right) => this.compareRowsByDate(left, right)),
      );
    }
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
      onboarding: this.financeData.getContractOnboardingSetup(),
      profile: this.auth.getProfile(),
    })
      .pipe(finalize(() => {
        this.isLoading = false;
        this.completeRefresh(refreshEvent);
      }))
      .subscribe({
        next: ({ balances, settings, onboarding, profile }) => {
          this.onboardingSetup = onboarding;
          this.profile = profile.data.user;
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

  private buildDashboard(rows: BalanceRow[], refreshNotifications = true): void {
    this.dashboardRows = rows;
    const validRows = rows
      .filter((row) => !Number.isNaN(new Date(row.datetime).getTime()))
      .sort((left, right) => this.compareRowsByDate(left, right));
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
    const receivedIncomeRows = positiveThisMonth.filter((row) => this.isStatus(row, 'consumado'));
    const receivableIncomeRows = positiveThisMonth.filter((row) => this.isStatus(row, 'provisionado'));
    const consumedDebitExpenseRows = consumedThisMonth.filter((row) => Number(row.value) < 0 && row.account_type !== 1);
    const consumedCreditExpenseRows = consumedThisMonth.filter((row) => Number(row.value) < 0 && row.account_type === 1);
    const provisionedDebitExpenseRows = provisionedThisMonth.filter((row) => Number(row.value) < 0 && row.account_type !== 1);
    const provisionedCreditExpenseRows = provisionedThisMonth.filter((row) => Number(row.value) < 0 && row.account_type === 1);
    const monthStartBalance = this.getDebitSnapshotTotal(
      this.getLatestRowAtOrBefore(validRows, selectedMonthStart)?.balances,
    );
    const monthEndBalance = this.getDebitSnapshotTotal(
      this.getLatestRowAtOrBefore(validRows, selectedMonthEnd)?.balances,
    );
    const precedingMonthBalance = this.getDebitSnapshotTotal(
      this.getLatestRowAtOrBefore(validRows, precedingMonthEnd)?.balances,
    );
    const yearToDateSavings = this.getYearToDateSavings(validRows);

    this.summary = {
      monthStartBalance,
      monthEndBalance,
      currentBalance,
      savings: monthEndBalance - monthStartBalance,
      yearToDateSavings,
      income: this.sumValues(positiveThisMonth),
      receivedIncome: this.sumValues(receivedIncomeRows),
      receivableIncome: this.sumValues(receivableIncomeRows),
      receivedIncomeCount: receivedIncomeRows.length,
      receivableIncomeCount: receivableIncomeRows.length,
      consumedExpenses: consumedDebitExpenses + consumedCreditExpenses,
      consumedDebitExpenses,
      consumedCreditExpenses,
      consumedExpensesCount: consumedDebitExpenseRows.length + consumedCreditExpenseRows.length,
      consumedDebitExpensesCount: consumedDebitExpenseRows.length,
      consumedCreditExpensesCount: consumedCreditExpenseRows.length,
      provisionedExpenses: provisionedDebitExpenses + provisionedCreditExpenses,
      provisionedDebitExpenses,
      provisionedCreditExpenses,
      provisionedExpensesCount: provisionedDebitExpenseRows.length + provisionedCreditExpenseRows.length,
      provisionedDebitExpensesCount: provisionedDebitExpenseRows.length,
      provisionedCreditExpensesCount: provisionedCreditExpenseRows.length,
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
    if (refreshNotifications) {
      this.dashboardNotifications = this.buildDashboardNotifications(validRows);
      this.scheduleConfiguredNotifications(validRows);
    }
  }

  private navigateToMonth(targetMonth: Date, direction: -1 | 1): void {
    const normalizedTarget = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);

    if (normalizedTarget.getTime() === this.selectedMonthDate.getTime()) {
      this.isMonthPickerOpen = false;
      return;
    }

    if (this.isMonthTransitionRunning) {
      return;
    }

    this.isMonthPickerOpen = false;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.applySelectedMonth(normalizedTarget);
      return;
    }

    this.isMonthTransitionRunning = true;
    const outgoingAnimations = this.getMonthTransitionElements().map((element, index) => {
      return element.animate([
        { opacity: 1, transform: 'translateX(0) scale(1)' },
        { opacity: 0, filter: 'blur(2px)', transform: `translateX(${-direction * 52}px) scale(.985)` },
      ], {
        duration: 175,
        delay: index * 12,
        easing: 'cubic-bezier(.4, 0, 1, 1)',
        fill: 'both',
      });
    });

    void Promise.all(outgoingAnimations.map((animation) => animation.finished.catch(() => undefined)))
      .then(() => {
        this.applySelectedMonth(normalizedTarget);
        outgoingAnimations.forEach((animation) => animation.cancel());

        requestAnimationFrame(() => {
          const incomingAnimations = this.getMonthTransitionElements().map((element, index) => {
            return element.animate([
              { opacity: 0, filter: 'blur(2px)', transform: `translateX(${direction * 52}px) scale(.985)` },
              { opacity: 1, filter: 'blur(0)', transform: 'translateX(0) scale(1)' },
            ], {
              duration: 360,
              delay: index * 24,
              easing: 'cubic-bezier(.18, .8, .24, 1)',
              fill: 'both',
            });
          });
          this.host.nativeElement.querySelector<HTMLElement>('.summary-chart')?.animate([
            { transform: `translateX(${direction * 18}px)` },
            { transform: 'translateX(0)' },
          ], {
            duration: 500,
            easing: 'cubic-bezier(.18, .8, .24, 1)',
          });

          void Promise.all(incomingAnimations.map((animation) => animation.finished.catch(() => undefined)))
            .then(() => {
              incomingAnimations.forEach((animation) => animation.cancel());
              this.isMonthTransitionRunning = false;
            });
        });
      });
  }

  private applySelectedMonth(targetMonth: Date, refreshNotifications = true): void {
    this.selectedMonthDate = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);
    this.buildDashboard(this.dashboardRows, refreshNotifications);
  }

  private getMonthTransitionElements(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>(
      '.month-picker-label, .summary-metric, .month-start-balance, .current-balance-block, .credit-highlight-grid > div, .summary-bottom',
    ));
  }

  private updateSavingsTrendScrubPoint(event: PointerEvent): void {
    this.updateSavingsTrendScrubPointAtX(event.currentTarget as SVGSVGElement, event.clientX);
  }

  private updateSavingsTrendScrubPointAtX(chart: SVGSVGElement, clientX: number): void {
    const chartBounds = chart.getBoundingClientRect();

    if (!chartBounds.width || this.savingsTrend.length === 0) {
      return;
    }

    const chartX = ((clientX - chartBounds.left) / chartBounds.width) * this.savingsTrendViewBoxWidth;

    this.savingsTrendScrubPoint = this.savingsTrend.reduce((closest, point) => {
      return Math.abs(point.x - chartX) < Math.abs(closest.x - chartX) ? point : closest;
    });
  }

  private updateSavingsTrendShuttleSpeed(event: PointerEvent): void {
    const chartWidth = (event.currentTarget as SVGSVGElement).getBoundingClientRect().width;
    const offset = event.clientX - this.savingsTrendShuttleAnchorX;
    const deadZone = 12;
    const maximumDistance = Math.max(72, Math.min(chartWidth * 0.48, 150));
    const distance = Math.abs(offset);

    if (distance <= deadZone) {
      this.savingsTrendShuttleSpeed = 0;
      return;
    }

    const intensity = Math.min(1, (distance - deadZone) / (maximumDistance - deadZone));
    const monthsPerSecond = 0.9 + Math.pow(intensity, 1.45) * 9.1;

    this.savingsTrendShuttleSpeed = -Math.sign(offset) * monthsPerSecond;
  }

  private startSavingsTrendShuttle(): void {
    this.savingsTrendShuttleLastFrame = performance.now();

    const update = (time: number) => {
      if (this.savingsTrendPointerId === null) {
        return;
      }

      const elapsed = Math.min(time - this.savingsTrendShuttleLastFrame, 80);
      this.savingsTrendShuttleLastFrame = time;
      this.savingsTrendShuttleAccumulator += (elapsed / 1000) * this.savingsTrendShuttleSpeed;
      let processedSteps = 0;

      while (Math.abs(this.savingsTrendShuttleAccumulator) >= 1 && processedSteps < 3) {
        const direction = this.savingsTrendShuttleAccumulator > 0 ? 1 : -1;

        this.savingsTrendShuttleAccumulator -= direction;
        this.stepMonthDuringSavingsTrendShuttle(direction);
        processedSteps += 1;
      }

      this.savingsTrendShuttleFrame = requestAnimationFrame(update);
    };

    this.savingsTrendShuttleFrame = requestAnimationFrame(update);
  }

  private stopSavingsTrendShuttle(): void {
    if (this.savingsTrendShuttleFrame !== undefined) {
      cancelAnimationFrame(this.savingsTrendShuttleFrame);
      this.savingsTrendShuttleFrame = undefined;
    }

    this.savingsTrendPointerId = null;
    this.savingsTrendShuttleSpeed = 0;
    this.savingsTrendShuttleAccumulator = 0;
    this.savingsTrendShuttleChart = null;
    this.savingsTrendScrubPoint = null;
  }

  private stepMonthDuringSavingsTrendShuttle(direction: -1 | 1): void {
    const targetMonth = new Date(
      this.selectedMonthDate.getFullYear(),
      this.selectedMonthDate.getMonth() + direction,
      1,
    );

    this.applySelectedMonth(targetMonth, false);

    if (this.savingsTrendShuttleChart) {
      this.updateSavingsTrendScrubPointAtX(this.savingsTrendShuttleChart, this.savingsTrendShuttleClientX);
    }

    requestAnimationFrame(() => {
      this.savingsTrendShuttleAnimations.forEach((animation) => animation.cancel());
      const offset = direction * 14;
      const valueAnimations = this.getMonthTransitionElements().map((element) => {
        return element.animate([
          { transform: `translateX(${offset}px)` },
          { transform: 'translateX(0)' },
        ], {
          duration: 150,
          easing: 'cubic-bezier(.18, .8, .24, 1)',
        });
      });
      const chartAnimation = this.host.nativeElement.querySelector<HTMLElement>('.summary-chart')?.animate([
        { transform: `translateX(${direction * 7}px)` },
        { transform: 'translateX(0)' },
      ], {
        duration: 150,
        easing: 'cubic-bezier(.18, .8, .24, 1)',
      });

      this.savingsTrendShuttleAnimations = chartAnimation
        ? [...valueAnimations, chartAnimation]
        : valueAnimations;
    });
  }

  private completeRefresh(event?: CustomEvent): void {
    const refresher = event?.target as unknown as { complete?: () => Promise<void> | void };
    void refresher?.complete?.();
  }

  private buildDashboardNotifications(rows: BalanceRow[]): AppNotification[] {
    const readIds = this.getStoredIdSet(this.notificationReadStorageKey);

    return evaluateNotifications({
      rows,
      accounts: this.movimentAccountOptions,
      ledgerAccounts: this.ledgerAccountOptions,
      onboardingSetup: this.onboardingSetup,
      readIds,
      now: this.now,
    });
  }

  private scheduleConfiguredNotifications(rows: BalanceRow[]): void {
    this.clearNotificationTimers();

    const sentIds = this.getStoredIdSet(this.notificationSentStorageKey);
    const notifications = evaluateNotifications({
      rows,
      accounts: this.movimentAccountOptions,
      ledgerAccounts: this.ledgerAccountOptions,
      onboardingSetup: this.onboardingSetup,
      readIds: this.getStoredIdSet(this.notificationReadStorageKey),
      now: this.now,
      includeFutureTriggers: true,
    });

    if (this.notificationDelivery.usesNativeNotifications) {
      void this.notificationDelivery.scheduleNativeNotifications(notifications, sentIds)
        .then((scheduledIds) => {
          scheduledIds.forEach((id) => sentIds.add(id));
          this.storeIdSet(this.notificationSentStorageKey, sentIds);
        });
      return;
    }

    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
          this.scheduleConfiguredNotifications(rows);
        }
      });
    }

    notifications
      .forEach((notification) => {
        const notificationTime = notification.triggerTime ?? this.now.getTime();
        const delay = notificationTime - this.now.getTime();

        if (delay > 2_147_483_647) {
          return;
        }

        if (delay <= 0) {
          this.publishConfiguredNotification(notification, sentIds);
          return;
        }

        this.notificationTimers.push(setTimeout(() => {
          this.publishConfiguredNotification(notification, this.getStoredIdSet(this.notificationSentStorageKey));
        }, delay));
      });
  }

  private publishConfiguredNotification(notification: AppNotification, sentIds: Set<string>): void {
    this.now = new Date();
    this.dashboardNotifications = this.buildDashboardNotifications(this.dashboardRows);
    this.showSystemNotification(notification, sentIds);
  }

  private showSystemNotification(notificationData: AppNotification, sentIds: Set<string>): void {
    const id = notificationData.id;

    if (sentIds.has(id)) {
      return;
    }

    void this.notificationDelivery.showNow(notificationData)
      .then((didShow) => {
        if (!didShow) {
          return;
        }

        sentIds.add(id);
        this.storeIdSet(this.notificationSentStorageKey, sentIds);
      });
  }

  private clearNotificationTimers(): void {
    this.notificationTimers.forEach((timer) => clearTimeout(timer));
    this.notificationTimers = [];
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
    this.dashboardNotifications = this.dashboardNotifications.filter((notification) => notification.id !== id);
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
    const monthCount = this.getSavingsTrendMonthCount();
    const chartWidth = this.getSavingsTrendChartWidth();
    const sidePadding = monthCount > 6 ? 8 : 15.83;
    const xStep = monthCount === 1 ? 0 : (chartWidth - sidePadding * 2) / (monthCount - 1);
    const monthReferences = Array.from({ length: monthCount }, (_, index) => {
      return new Date(
        this.selectedMonthDate.getFullYear(),
        this.selectedMonthDate.getMonth() - ((monthCount - 1) - index),
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
      label: this.formatShortMonth(monthDate),
      year: monthDate.getFullYear(),
      month: monthDate.getMonth(),
      value: values[index],
      x: sidePadding + index * xStep,
      y: 60 - ((values[index] - minValue) / range) * 44,
    }));
  }

  private getSavingsTrendMonthCount(viewportWidth = this.viewportWidth): number {
    return viewportWidth >= 681 ? 12 : 6;
  }

  private getSavingsTrendChartWidth(viewportWidth = this.viewportWidth): number {
    return viewportWidth >= 681 ? 560 : 190;
  }

  private getYearToDateSavings(rows: BalanceRow[]): number {
    const selectedYear = this.selectedMonthDate.getFullYear();

    return Array.from({ length: this.selectedMonthDate.getMonth() + 1 }, (_, month) => {
      const monthDate = new Date(selectedYear, month, 1);
      const monthStart = new Date(selectedYear, month, 1, 0, 0, 0, 0);
      const monthEnd = this.getEndOfMonth(monthDate);
      const startBalance = this.getDebitSnapshotTotal(this.getLatestRowAtOrBefore(rows, monthStart)?.balances);
      const endBalance = this.getDebitSnapshotTotal(this.getLatestRowAtOrBefore(rows, monthEnd)?.balances);

      return endBalance - startBalance;
    }).reduce((total, savings) => total + savings, 0);
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

  private normalizeCreditBillDescription(description: string): string {
    return description
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('pt-BR');
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
      openLabel: isPastMonth ? 'Fechado' : 'Aberto',
      payableDateLabel: '',
      openDateLabel: '',
    };

    const summary = this.creditAccounts.reduce<CreditSummary>((creditSummary, account) => {
      const accountRows = rows.filter((row) => this.isCreditAccountMovement(row, account));
      const payableClosingDate = this.getPayableClosingDateForSelectedMonth(account);
      const previousPayableClosingDate = this.getPreviousClosingDate(payableClosingDate, account);
      const selectedClosingDate = this.getClosingDateForMonth(account, this.selectedMonthDate);
      const openStartDate = this.getCreditOpenStartDate(account, selectedClosingDate);
      const openEndDate = this.getCreditOpenEndDate(account, selectedClosingDate);
      const payableRows = this.getCreditConsumedRows(accountRows, previousPayableClosingDate, payableClosingDate);
      const openRows = this.getCreditConsumedRows(accountRows, openStartDate, openEndDate);
      const payable = Math.abs(this.sumValues(payableRows));
      const open = Math.abs(this.sumValues(openRows));
      const limit = this.toNumber(account.start_value);
      const isBillPaid = this.hasPaidCreditBill(rows, account, payable, payableClosingDate);
      const payableAffectsBalance = isPastMonth || (isCurrentMonth && isBillPaid) ? 0 : payable;

      return {
        ...creditSummary,
        payable: creditSummary.payable + payable,
        open: creditSummary.open + open,
        balance: creditSummary.balance + limit - payableAffectsBalance - open,
        payableCount: creditSummary.payableCount + payableRows.length,
        openCount: creditSummary.openCount + openRows.length,
        payableLabel: creditSummary.payableLabel,
        openLabel: creditSummary.openLabel,
        payableDateLabel: creditSummary.payableDateLabel || this.formatCompactDate(
          this.getCreditBillPayDate(account, payableClosingDate),
        ),
        openDateLabel: creditSummary.openDateLabel || this.formatCompactDate(selectedClosingDate),
      };
    }, initialSummary);

    if (isCurrentMonth && summary.payable > 0 && this.areSelectedMonthCreditBillsPaid(rows)) {
      summary.payableLabel = 'Pago';
    }

    return summary;
  }

  private isCreditAccountMovement(row: BalanceRow, account: MovimentAccountSettings): boolean {
    return row.account_type === 1 &&
      Number(row.moviment_account_id) === account.id &&
      !this.isCreditBillMovement(row);
  }

  private isCreditBillMovement(row: BalanceRow): boolean {
    return !!row.credit_bill || this.normalizeCreditBillDescription(row.description).startsWith('fatura ');
  }

  private getCreditConsumedRows(rows: BalanceRow[], afterDate: Date, untilDate: Date): BalanceRow[] {
    const afterTime = afterDate.getTime();
    const untilTime = untilDate.getTime();
    const creditBillSettings = getCreditBillSettings(this.onboardingSetup);
    const includeProvisioned = this.isFutureSelectedMonth() ||
      (creditBillSettings.enabled && creditBillSettings.includeProvisioned);

    return rows.filter((row) => {
      const time = this.getTime(row);

      return Number(row.value) !== 0 &&
        this.isCreditSummaryStatus(row, includeProvisioned) &&
        time >= afterTime &&
        time < untilTime;
    });
  }

  private getPayableClosingDateForSelectedMonth(account: MovimentAccountSettings): Date {
    const selectedClosingDate = this.getClosingDateForMonth(account, this.selectedMonthDate);

    if (
      this.isPastSelectedMonth() ||
      this.isFutureSelectedMonth() ||
      (this.isCurrentSelectedMonth() && this.now.getTime() < selectedClosingDate.getTime())
    ) {
      return this.getPreviousClosingDate(selectedClosingDate, account);
    }

    return selectedClosingDate;
  }

  private getCreditOpenStartDate(account: MovimentAccountSettings, selectedClosingDate: Date): Date {
    if (this.isCurrentSelectedMonth() && this.now.getTime() >= selectedClosingDate.getTime()) {
      return selectedClosingDate;
    }

    return this.getPreviousClosingDate(selectedClosingDate, account);
  }

  private getCreditOpenEndDate(account: MovimentAccountSettings, selectedClosingDate: Date): Date {
    if (this.isCurrentSelectedMonth() && this.now.getTime() >= selectedClosingDate.getTime()) {
      return this.getNextClosingDate(selectedClosingDate, account);
    }

    return selectedClosingDate;
  }

  private getPreviousClosingDate(lastClosingDate: Date, account: MovimentAccountSettings): Date {
    const previousMonthReference = new Date(lastClosingDate.getFullYear(), lastClosingDate.getMonth() - 1, 1);

    return new Date(
      previousMonthReference.getFullYear(),
      previousMonthReference.getMonth(),
      this.getSafeClosingDay(account, previousMonthReference),
      0,
      0,
      0,
      0,
    );
  }

  private getNextClosingDate(lastClosingDate: Date, account: MovimentAccountSettings): Date {
    const nextMonthReference = new Date(lastClosingDate.getFullYear(), lastClosingDate.getMonth() + 1, 1);

    return this.getClosingDateForMonth(account, nextMonthReference);
  }

  private getClosingDateForMonth(account: MovimentAccountSettings, monthReference: Date): Date {
    return new Date(
      monthReference.getFullYear(),
      monthReference.getMonth(),
      this.getSafeClosingDay(account, monthReference),
      0,
      0,
      0,
      0,
    );
  }

  private hasPaidCreditBill(
    rows: BalanceRow[],
    account: MovimentAccountSettings,
    payable: number,
    closingDate: Date,
  ): boolean {
    if (!payable) {
      return false;
    }

    const expectedPayDate = this.getCreditBillPayDate(account, closingDate);
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
        return this.isSameDay(rowDate, expectedPayDate);
      }

      return true;
    });

    return billRows.some((row) => Math.abs(Math.abs(Number(row.value) || 0) - payable) < 0.01);
  }

  private areSelectedMonthCreditBillsPaid(rows: BalanceRow[]): boolean {
    return this.creditAccounts.every((account) => {
      const accountRows = rows.filter((row) => this.isCreditAccountMovement(row, account));
      const payableClosingDate = this.getPayableClosingDateForSelectedMonth(account);
      const previousClosingDate = this.getPreviousClosingDate(payableClosingDate, account);
      const payable = Math.abs(this.sumValues(
        this.getCreditConsumedRows(accountRows, previousClosingDate, payableClosingDate),
      ));

      return payable === 0 || this.hasPaidCreditBill(rows, account, payable, payableClosingDate);
    });
  }

  private getCreditBillPayDate(account: MovimentAccountSettings, closingDate: Date): Date {
    const payMonth = new Date(closingDate.getFullYear(), closingDate.getMonth() + 1, 1);
    const lastDayOfPayMonth = new Date(payMonth.getFullYear(), payMonth.getMonth() + 1, 0).getDate();
    const payDay = Math.min(Math.max(account.pay_day ?? lastDayOfPayMonth, 1), lastDayOfPayMonth);

    return new Date(payMonth.getFullYear(), payMonth.getMonth(), payDay);
  }

  private getSafeClosingDay(account: MovimentAccountSettings, referenceDate: Date): number {
    const lastDayOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate();
    const closingDay = account.closing_day ?? lastDayOfMonth;

    return Math.min(Math.max(closingDay, 1), lastDayOfMonth);
  }

  private formatShortMonth(date: Date): string {
    const label = new Intl.DateTimeFormat('pt-PT', { month: 'short' }).format(date).replace('.', '');

    return label.charAt(0).toLocaleUpperCase('pt-PT') + label.slice(1);
  }

  private formatCompactDate(date: Date): string {
    return `${String(date.getDate()).padStart(2, '0')} ${this.formatShortMonth(date).toLocaleLowerCase('pt-PT')}`;
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

  private isFutureSelectedMonth(): boolean {
    return this.selectedMonthDate.getFullYear() > this.now.getFullYear()
      || (
        this.selectedMonthDate.getFullYear() === this.now.getFullYear()
        && this.selectedMonthDate.getMonth() > this.now.getMonth()
      );
  }

  private isCreditSummaryStatus(row: BalanceRow, includeProvisioned: boolean): boolean {
    return this.isStatus(row, 'consumado') || (includeProvisioned && this.isStatus(row, 'provisionado'));
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

  private compareRowsByDate(left: BalanceRow, right: BalanceRow): number {
    return this.getTime(left) - this.getTime(right);
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

  private getProfileAvatarId(onboarding: ContractOnboardingSetup | null): string {
    const value = onboarding && typeof onboarding === 'object' && 'profileAvatar' in onboarding
      ? String((onboarding as ContractOnboardingSetup & { profileAvatar?: unknown }).profileAvatar ?? '')
      : '';

    return this.profileAvatarOptions.some((option) => option.id === value) ? value : this.profileAvatarOptions[0].id;
  }

  private formatEuro(value: number): string {
    return this.currencySettings.format(value);
  }
}
