import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  IonContent,
  IonIcon,
  IonRefresher,
  IonRefresherContent,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  checkmarkCircleOutline,
  createOutline,
  funnelOutline,
  receiptOutline,
  searchOutline,
  todayOutline,
  timeOutline,
  trashOutline,
} from 'ionicons/icons';
import { finalize, forkJoin } from 'rxjs';
import {
  BalanceRow,
  BalanceSnapshot,
  FinanceDataService,
  MovimentAccountSettings,
} from '../finance-data.service';

interface BalanceEntry {
  name: string;
  value: number;
  accountType: 0 | 1 | null;
}

interface MonthSummary {
  index: number;
  label: string;
  income: number;
  outcome: number;
  balance: number;
  previousSavings: number;
  currentSavings: number;
  totalSaved: number;
  accountBalances: BalanceEntry[];
  topExpenseLedgers: ExpenseLedgerSummary[];
  expenseChartBackground: string;
  movements: BalanceRow[];
}

interface MovementDayGroup {
  dateKey: string;
  date: Date;
  movements: BalanceRow[];
  income: number;
  outcome: number;
  balance: number;
  accountBalances: BalanceEntry[];
}

interface MovementMonthGroup {
  monthKey: string;
  date: Date;
  summary: MonthSummary;
  dayGroups: MovementDayGroup[];
}

interface ExpenseLedgerSummary {
  name: string;
  total: number;
  percent: number;
  color: string;
}

interface MovimentOption {
  id: number;
  name: string;
}

interface FinanceFocusTarget {
  movementId?: number;
  datetime?: string;
  preferPast?: boolean;
  dayKey?: string;
  monthKey?: string;
  expandDetails?: boolean;
}

interface ScrollFocusOptions {
  expandDetails?: boolean;
}

@Component({
  selector: 'app-finance-page',
  templateUrl: './finance-page.component.html',
  styleUrls: ['./finance-page.component.scss'],
  imports: [
    CommonModule,
    IonContent,
    IonIcon,
    IonRefresher,
    IonRefresherContent,
    MatCardModule,
    MatProgressSpinnerModule,
    CurrencyPipe,
    DatePipe,
  ],
})
export class FinancePageComponent implements OnInit {
  private readonly financeData = inject(FinanceDataService);
  private readonly router = inject(Router);
  private readonly financeFocusStorageKey = 'financeFocusTarget';
  private readonly expenseChartColors = ['#d94841', '#f07c4a', '#e0b43b'];
  private readonly statusToneClasses = ['status-tone-red', 'status-tone-amber', 'status-tone-orange'];
  private readonly ledgerToneClasses = ['ledger-tone-rose', 'ledger-tone-gold', 'ledger-tone-sky', 'ledger-tone-violet', 'ledger-tone-teal'];
  private readonly monthLabels = [
    'Janeiro',
    'Fevereiro',
    'Março',
    'Abril',
    'Maio',
    'Junho',
    'Julho',
    'Agosto',
    'Setembro',
    'Outubro',
    'Novembro',
    'Dezembro',
  ];
  @ViewChild(IonContent) private content?: IonContent;
  @ViewChild('resultsAnchor') private resultsAnchor?: ElementRef<HTMLElement>;
  @ViewChild('jumpbarMonthList') private jumpbarMonthList?: ElementRef<HTMLElement>;

  protected transactions: BalanceRow[] = [];
  protected filteredTransactions: BalanceRow[] = [];
  protected availableYears: number[] = [];
  protected yearBalances: Record<number, number> = {};
  protected monthSummaries: MonthSummary[] = [];
  protected timelineMonths: MovementMonthGroup[] = [];
  protected filteredTransactionGroups: MovementDayGroup[] = [];
  protected selectedYear: number | null = null;
  protected selectedMonthIndex: number | null = null;
  protected isLoading = false;
  protected errorMessage = '';
  protected activeMonthKey = '';
  protected activeDayKey = '';
  protected todayDayKey = this.getDateKey(new Date().toISOString());
  protected expandedDayKeys = new Set<string>();
  protected expandedMonthKeys = new Set<string>();
  protected expandedMovementIds = new Set<number>();
  private hasLoadedBalances = false;
  private loadedToken = '';
  private pendingFocusTarget: FinanceFocusTarget | null = null;
  private scrollTicking = false;
  private accountById = new Map<string, MovimentAccountSettings>();
  private accountByDescription = new Map<string, MovimentAccountSettings>();

  constructor() {
    addIcons({
      checkmarkCircleOutline,
      createOutline,
      funnelOutline,
      receiptOutline,
      searchOutline,
      todayOutline,
      timeOutline,
      trashOutline,
    });
  }

  ngOnInit() {
    this.pendingFocusTarget = this.consumeStoredFocusTarget();
    this.loadBalances(this.pendingFocusTarget ?? this.buildInitialFocusTarget());
  }

  ionViewWillEnter() {
    const storedFocusTarget = this.consumeStoredFocusTarget();

    if (this.loadedToken !== this.authToken) {
      this.loadBalances(storedFocusTarget ?? this.buildInitialFocusTarget(), true);
      return;
    }

    if (!storedFocusTarget || !this.hasLoadedBalances) {
      return;
    }

    this.loadBalances(storedFocusTarget, true);
  }

  protected trackById(_: number, row: BalanceRow): number {
    return row.id;
  }

  protected trackByDay(_: number, group: MovementDayGroup): string {
    return group.dateKey;
  }

  protected trackByBalanceName(_: number, balance: BalanceEntry): string {
    return balance.name;
  }

  protected get shouldShowCurrentDayFab(): boolean {
    return this.timelineMonths.reduce((total, month) => total + month.dayGroups.length, 0) >= 3;
  }

  protected formatMonthShort(date: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      month: 'short',
      timeZone: 'UTC',
    }).format(date).replace('.', '');
  }

  protected formatDayLabel(date: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      month: 'short',
      day: '2-digit',
      timeZone: 'UTC',
    }).format(date).replace('.', '');
  }

  protected isFutureTimelineBreak(monthGroup: MovementMonthGroup, dayIndex: number): boolean {
    const dayGroup = monthGroup.dayGroups[dayIndex];
    const previousDayGroup = monthGroup.dayGroups[dayIndex - 1];

    return (
      !!dayGroup &&
      dayGroup.dateKey > this.todayDayKey &&
      (!previousDayGroup || previousDayGroup.dateKey <= this.todayDayKey)
    );
  }

  protected onTimelineScroll(): void {
    if (this.scrollTicking) {
      return;
    }

    this.scrollTicking = true;
    requestAnimationFrame(() => {
      this.updateActiveTimelineMarkers();
      this.scrollTicking = false;
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
    return balances.reduce((total, balance) => {
      return balance.value > 0 ? total + balance.value : total;
    }, 0);
  }

  protected isDayExpanded(dayKey: string): boolean {
    return this.expandedDayKeys.has(dayKey);
  }

  protected toggleDayBalances(dayKey: string): void {
    if (this.expandedDayKeys.has(dayKey)) {
      this.expandedDayKeys.delete(dayKey);
      return;
    }

    this.expandedDayKeys.add(dayKey);
  }

  protected isMonthMovementsExpanded(monthKey: string): boolean {
    return this.expandedMonthKeys.has(monthKey);
  }

  protected toggleMonthMovements(monthKey: string): void {
    if (this.expandedMonthKeys.has(monthKey)) {
      this.expandedMonthKeys.delete(monthKey);
      return;
    }

    this.expandedMonthKeys.add(monthKey);
  }

  protected isMovementExpanded(movementId: number): boolean {
    return this.expandedMovementIds.has(movementId);
  }

  protected toggleMovementBalances(movementId: number): void {
    if (this.expandedMovementIds.has(movementId)) {
      this.expandedMovementIds.delete(movementId);
      return;
    }

    this.expandedMovementIds.add(movementId);
  }

  protected getValueToneClass(value: string | number): string {
    return Number(value) < 0 ? 'transaction-value-negative' : 'transaction-value-positive';
  }

  protected getBalanceToneClass(balance: BalanceEntry): string {
    return balance.accountType === 1 ? 'balance-amount-credit' : 'balance-amount-debit';
  }

  protected getStatusToneClass(status: string | null | undefined): string {
    return this.pickToneClass(status, this.statusToneClasses);
  }

  protected getLedgerToneClass(ledgerAccount: string | null | undefined): string {
    return this.pickToneClass(ledgerAccount, this.ledgerToneClasses);
  }

  protected getAccountToneClass(row: BalanceRow): string {
    return row.account_type === 1 ? 'account-tone-credit' : 'account-tone-debit';
  }

  protected isCreditMovement(row: BalanceRow): boolean {
    return row.account_type === 1;
  }

  protected isCreditConfirmed(row: BalanceRow): boolean {
    return !!row.credit_status;
  }

  protected isProvisionedMovement(row: BalanceRow): boolean {
    return row.status?.trim().toLocaleLowerCase('pt-BR') === 'provisionado';
  }

  protected toggleCreditStatus(row: BalanceRow): void {
    const shouldConfirm = !this.isCreditConfirmed(row);

    if (!shouldConfirm) {
      const shouldChange = window.confirm(`Marcar "${row.description}" como pendente novamente?`);

      if (!shouldChange) {
        return;
      }
    }

    this.financeData.toggleMovimentCreditStatus(row.id, shouldConfirm).subscribe({
      next: (response) => {
        const creditStatus = response.data?.moviment?.credit_status ?? null;
        this.transactions = this.transactions.map((movement) => {
          return movement.id === row.id ? { ...movement, credit_status: creditStatus } : movement;
        });
        this.rebuildFinanceState(this.buildFocusTargetFromRow(row));
      },
      error: () => {
        this.errorMessage = 'Não foi possível atualizar o status do crédito.';
      },
    });
  }

  protected openEditMoviment(row: BalanceRow): void {
    sessionStorage.setItem(
      'selectedMoviment',
      JSON.stringify(this.buildMovimentNavigationState('edit', row)),
    );

    void this.router.navigate(['/example/new'], {
      queryParams: { mode: 'edit' },
      state: this.buildMovimentNavigationState('edit', row),
    });
  }

  protected deleteMoviment(row: BalanceRow): void {
    const shouldDelete = window.confirm(`Excluir o movimento "${row.description}"?`);

    if (!shouldDelete) {
      return;
    }

    const focusTarget = this.buildFocusTargetFromRow(row);

    this.financeData.deleteMoviment(row.id).subscribe({
      next: () => {
        this.loadBalances(focusTarget, true);
      },
      error: () => {
        this.errorMessage = 'Não foi possível excluir o movimento.';
      },
    });
  }

  private pickToneClass(value: string | null | undefined, toneClasses: string[]): string {
    const normalizedValue = value?.trim().toLowerCase() ?? '';

    if (!normalizedValue) {
      return toneClasses[0];
    }

    let hash = 0;

    for (const character of normalizedValue) {
      hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
    }

    return toneClasses[Math.abs(hash) % toneClasses.length];
  }

  private buildMovimentNavigationState(mode: 'add' | 'edit', row?: BalanceRow) {
    return {
      mode,
      moviment: row ?? null,
      ledgerAccounts: this.getLedgerAccountOptions(),
      movimentAccounts: this.getMovimentAccountOptions(),
      statuses: this.getStatusOptions(),
    };
  }

  private getLedgerAccountOptions(): MovimentOption[] {
    return this.getOptionsFromRows('ledger_account_id', 'ledger_account');
  }

  private getMovimentAccountOptions(): MovimentOption[] {
    return this.getOptionsFromRows('moviment_account_id', 'moviment_account');
  }

  private getStatusOptions(): MovimentOption[] {
    return this.getOptionsFromRows('status_id', 'status');
  }

  private getOptionsFromRows(
    idKey: 'ledger_account_id' | 'moviment_account_id' | 'status_id',
    nameKey: 'ledger_account' | 'moviment_account' | 'status',
  ): MovimentOption[] {
    const optionMap = new Map<number, MovimentOption>();

    this.transactions.forEach((row) => {
      const id = Number(row[idKey]) || 0;
      const name = row[nameKey]?.trim() ?? '';

      if (id > 0 && name) {
        optionMap.set(id, { id, name });
      }
    });

    return Array.from(optionMap.values()).sort((left, right) => left.name.localeCompare(right.name));
  }

  protected get selectedMonthLabel(): string {
    if (this.selectedMonthIndex === null) {
      return 'Mês selecionado';
    }

    return this.monthSummaries[this.selectedMonthIndex]?.label ?? 'Mês selecionado';
  }

  protected onYearChange(year: number): void {
    this.selectedYear = year;
    this.buildMonthSummaries();
    this.buildTimelineMonths();
    this.selectedMonthIndex = null;
    this.filteredTransactions = [];
    this.filteredTransactionGroups = [];
  }

  protected getYearBalance(year: number): number {
    return this.yearBalances[year] ?? 0;
  }

  protected selectMonth(monthIndex: number): void {
    this.selectedMonthIndex = monthIndex;
    this.filteredTransactions = this.monthSummaries.find(
      (month) => month.index === monthIndex,
    )?.movements ?? [];
    this.filteredTransactionGroups = this.buildMovementDayGroups(this.filteredTransactions);

    setTimeout(() => {
      requestAnimationFrame(() => {
        void this.scrollToTable();
      });
    }, 50);
  }

  protected scrollToToday(): void {
    const todayTarget = this.getTimelineFocusTarget({
      datetime: new Date().toISOString(),
      preferPast: true,
      dayKey: this.todayDayKey,
      monthKey: this.todayDayKey.slice(0, 7),
    });
    void this.scrollToFocusTarget(todayTarget, { expandDetails: false });
  }

  protected refreshBalances(event: CustomEvent): void {
    this.loadBalances(this.buildInitialFocusTarget(), true, event);
  }

  private loadBalances(
    focusTarget?: FinanceFocusTarget | null,
    forceRefresh = false,
    refreshEvent?: CustomEvent,
  ): void {
    this.loadedToken = this.authToken;
    this.isLoading = true;
    this.errorMessage = '';
    this.pendingFocusTarget = focusTarget ?? null;

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
          this.rebuildFinanceState(this.pendingFocusTarget ?? this.buildInitialFocusTarget(), balances);
        },
        error: () => {
          this.errorMessage =
            'Não foi possível carregar os dados financeiros do servidor.';
        },
    });
  }

  private get authToken(): string {
    return localStorage.getItem('financeAuthSession') ?? '';
  }

  private completeRefresh(event?: CustomEvent): void {
    const refresher = event?.target as unknown as { complete?: () => Promise<void> | void };
    void refresher?.complete?.();
  }

  protected async scrollToMonth(monthKey: string): Promise<void> {
    this.expandedMonthKeys.add(monthKey);
    await this.waitForRender();

    const monthGroup = this.timelineMonths.find((month) => month.monthKey === monthKey);
    const targetDay = this.getPreferredDayKeyForMonth(monthGroup);
    const targetId = targetDay ? this.getDayElementId(targetDay) : this.getMonthElementId(monthKey);
    const target = document.getElementById(targetId);

    if (!target) {
      return;
    }

    void this.scrollElementIntoView(target);
    this.activeMonthKey = monthKey;
    this.activeDayKey = targetDay ?? this.activeDayKey;
    this.ensureActiveJumpbarItemVisible();
  }

  private restoreTimelineFocus(focusTarget: FinanceFocusTarget): void {
    setTimeout(() => {
      requestAnimationFrame(() => {
        const resolvedTarget = this.getTimelineFocusTarget(focusTarget);
        void this.scrollToFocusTarget(resolvedTarget, this.getScrollFocusOptions(focusTarget));
      });
    }, 80);
  }

  private getTimelineFocusTarget(focusTarget: FinanceFocusTarget): FinanceFocusTarget {
    if (focusTarget.movementId && this.transactions.some((row) => row.id === focusTarget.movementId)) {
      return focusTarget;
    }

    if (focusTarget.datetime) {
      const nearestMovement = focusTarget.preferPast
        ? this.getLastMovementAtOrBefore(focusTarget.datetime)
        : this.getNearestMovement(focusTarget.datetime);

      if (nearestMovement) {
        const dayKey = this.getDateKey(nearestMovement.datetime);

        return {
          movementId: nearestMovement.id,
          dayKey,
          monthKey: dayKey.slice(0, 7),
          expandDetails: focusTarget.expandDetails,
        };
      }
    }

    if (focusTarget.dayKey && this.hasDayGroup(focusTarget.dayKey)) {
      return focusTarget;
    }

    if (focusTarget.monthKey && this.timelineMonths.some((month) => month.monthKey === focusTarget.monthKey)) {
      return focusTarget;
    }

    const todayMonthKey = this.todayDayKey.slice(0, 7);
    const latestMonthKey = this.timelineMonths[this.timelineMonths.length - 1]?.monthKey;

    if (this.timelineMonths.some((month) => month.monthKey === todayMonthKey)) {
      return { monthKey: todayMonthKey };
    }

    return latestMonthKey ? { monthKey: latestMonthKey } : {};
  }

  private async scrollToFocusTarget(
    focusTarget: FinanceFocusTarget,
    options: ScrollFocusOptions = {},
  ): Promise<void> {
    this.expandFocusTarget(focusTarget, options);
    await this.waitForRender();

    const elementId =
      focusTarget.movementId ? this.getMovementElementId(focusTarget.movementId) :
      focusTarget.dayKey ? this.getDayElementId(focusTarget.dayKey) :
      focusTarget.monthKey ? this.getMonthElementId(focusTarget.monthKey) :
      '';

    if (!elementId) {
      return;
    }

    const element = document.getElementById(elementId);

    if (!element) {
      return;
    }

    await this.scrollElementIntoView(element, !!focusTarget.movementId);
    this.updateActiveTimelineMarkersFromElement(element, focusTarget);

    if (focusTarget.movementId) {
      element.classList.add('focused-transaction');
      setTimeout(() => element.classList.remove('focused-transaction'), 1800);
    }
  }

  private updateActiveTimelineMarkers(): void {
    const monthElements = Array.from(document.querySelectorAll<HTMLElement>('.timeline-month'));
    const dayElements = Array.from(document.querySelectorAll<HTMLElement>('.timeline-day'));
    const markerTop = this.getStickyDayMarkerTop();
    const activeMonth = this.getActiveSectionElement(monthElements, markerTop);
    const activeDay = this.getClosestTimelineElement(dayElements, markerTop);

    if (activeMonth?.dataset['monthKey']) {
      this.activeMonthKey = activeMonth.dataset['monthKey'];
      this.ensureActiveJumpbarItemVisible();
    }

    if (activeDay?.dataset['dayKey']) {
      this.activeDayKey = activeDay.dataset['dayKey'];
    }
  }

  private updateActiveTimelineMarkersFromElement(element: HTMLElement, focusTarget: FinanceFocusTarget): void {
    const monthElement = element.closest<HTMLElement>('.timeline-month');
    const dayElement = element.closest<HTMLElement>('.timeline-day');

    this.activeMonthKey = focusTarget.monthKey ?? monthElement?.dataset['monthKey'] ?? this.activeMonthKey;
    this.activeDayKey = focusTarget.dayKey ?? dayElement?.dataset['dayKey'] ?? this.activeDayKey;
    this.ensureActiveJumpbarItemVisible();
  }

  private ensureActiveJumpbarItemVisible(): void {
    requestAnimationFrame(() => {
      const monthList = this.jumpbarMonthList?.nativeElement;
      const activeButton = monthList?.querySelector<HTMLElement>(
        `[data-month-key="${this.activeMonthKey}"]`,
      );

      if (!monthList || !activeButton) {
        return;
      }

      const centeredLeft = activeButton.offsetLeft - (monthList.clientWidth - activeButton.offsetWidth) / 2;
      monthList.scrollTo({
        left: Math.max(0, centeredLeft),
        behavior: 'smooth',
      });
    });
  }

  private rebuildFinanceState(focusTarget: FinanceFocusTarget, data = this.transactions): void {
    this.transactions = data;
    this.availableYears = this.extractAvailableYears(data);
    this.yearBalances = this.buildYearBalances(data);
    this.selectedYear = this.availableYears.length > 0 ? this.availableYears[0] : null;
    this.buildMonthSummaries();
    this.buildTimelineMonths();
    this.selectedMonthIndex = null;
    this.filteredTransactions = [];
    this.filteredTransactionGroups = [];
    this.hasLoadedBalances = true;
    this.initializeExpandedMonths(focusTarget, this.getScrollFocusOptions(focusTarget));
    this.restoreTimelineFocus(focusTarget);
  }

  private initializeExpandedMonths(focusTarget: FinanceFocusTarget, options: ScrollFocusOptions): void {
    const resolvedTarget = this.getTimelineFocusTarget(focusTarget);
    const monthKey = resolvedTarget.monthKey ?? resolvedTarget.dayKey?.slice(0, 7);
    const expandDetails = options.expandDetails ?? true;

    this.expandedMonthKeys = monthKey ? new Set([monthKey]) : new Set<string>();
    this.expandedDayKeys = expandDetails && resolvedTarget.dayKey ? new Set([resolvedTarget.dayKey]) : new Set<string>();
    this.expandedMovementIds = expandDetails && resolvedTarget.movementId ? new Set([resolvedTarget.movementId]) : new Set<number>();
  }

  private expandFocusTarget(focusTarget: FinanceFocusTarget, options: ScrollFocusOptions = {}): void {
    const monthKey = focusTarget.monthKey ?? focusTarget.dayKey?.slice(0, 7);
    const expandDetails = options.expandDetails ?? true;

    if (monthKey) {
      this.expandedMonthKeys.add(monthKey);
    }

    if (!expandDetails) {
      if (focusTarget.dayKey) {
        this.expandedDayKeys.delete(focusTarget.dayKey);
      }

      if (focusTarget.movementId) {
        this.expandedMovementIds.delete(focusTarget.movementId);
      }

      return;
    }

    if (expandDetails && focusTarget.dayKey) {
      this.expandedDayKeys.add(focusTarget.dayKey);
    }

    if (expandDetails && focusTarget.movementId) {
      this.expandedMovementIds.add(focusTarget.movementId);
    }
  }

  private waitForRender(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  private getScrollFocusOptions(focusTarget: FinanceFocusTarget): ScrollFocusOptions {
    return { expandDetails: focusTarget.expandDetails ?? true };
  }

  private async scrollElementIntoView(element: HTMLElement, center = false): Promise<void> {
    const scrollElement = await this.content?.getScrollElement();

    if (!scrollElement || !this.content) {
      element.scrollIntoView({ behavior: 'smooth', block: center ? 'center' : 'start' });
      return;
    }

    const stickyOffset = this.getStickyDayMarkerTop();
    const scrollRect = scrollElement.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const offset = center
      ? (scrollRect.height - elementRect.height) / 2
      : stickyOffset;
    const top = scrollElement.scrollTop + elementRect.top - scrollRect.top - offset;

    await this.content.scrollToPoint(0, Math.max(0, top), 360);
  }

  private getStickyDayMarkerTop(): number {
    const stickyHeader = document.querySelector<HTMLElement>('.timeline-date-header');
    const computedTop = stickyHeader ? Number.parseFloat(getComputedStyle(stickyHeader).top) : Number.NaN;

    return Number.isFinite(computedTop) ? computedTop + 28 : 196;
  }

  private getClosestTimelineElement(elements: HTMLElement[], markerTop: number): HTMLElement | null {
    return elements.reduce<HTMLElement | null>((closest, element) => {
      const elementTop = element.getBoundingClientRect().top;

      if (!closest) {
        return element;
      }

      const closestTop = closest.getBoundingClientRect().top;
      const elementDistance = Math.abs(elementTop - markerTop);
      const closestDistance = Math.abs(closestTop - markerTop);

      return elementDistance < closestDistance ? element : closest;
    }, null);
  }

  private getActiveSectionElement(elements: HTMLElement[], markerTop: number): HTMLElement | null {
    const containingElement = elements.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top <= markerTop && rect.bottom >= markerTop;
    });

    return containingElement ?? this.getClosestTimelineElement(elements, markerTop);
  }

  private getPreferredDayKeyForMonth(monthGroup: MovementMonthGroup | undefined): string | null {
    if (!monthGroup || monthGroup.dayGroups.length === 0) {
      return null;
    }

    if (monthGroup.monthKey === this.todayDayKey.slice(0, 7)) {
      const daysAtOrBeforeToday = monthGroup.dayGroups.filter((day) => day.dateKey <= this.todayDayKey);
      const todayOrNearestPast = daysAtOrBeforeToday[daysAtOrBeforeToday.length - 1];

      return todayOrNearestPast?.dateKey ?? monthGroup.dayGroups[0].dateKey;
    }

    return monthGroup.dayGroups[0].dateKey;
  }

  private consumeStoredFocusTarget(): FinanceFocusTarget | null {
    const storedTarget = sessionStorage.getItem(this.financeFocusStorageKey);

    if (!storedTarget) {
      return null;
    }

    sessionStorage.removeItem(this.financeFocusStorageKey);

    try {
      return JSON.parse(storedTarget) as FinanceFocusTarget;
    } catch {
      return null;
    }
  }

  private buildInitialFocusTarget(): FinanceFocusTarget {
    return {
      datetime: new Date().toISOString(),
      preferPast: true,
      dayKey: this.todayDayKey,
      monthKey: this.todayDayKey.slice(0, 7),
      expandDetails: false,
    };
  }

  private buildFocusTargetFromRow(row: BalanceRow): FinanceFocusTarget {
    const dayKey = this.getDateKey(row.datetime);

    return {
      datetime: row.datetime,
      dayKey,
      monthKey: dayKey.slice(0, 7),
      expandDetails: false,
    };
  }

  private getNearestMovement(datetime: string): BalanceRow | null {
    const targetTime = new Date(datetime).getTime();

    if (Number.isNaN(targetTime) || this.transactions.length === 0) {
      return null;
    }

    return this.transactions.reduce<BalanceRow | null>((nearestRow, row) => {
      if (!nearestRow) {
        return row;
      }

      const rowDistance = Math.abs(new Date(row.datetime).getTime() - targetTime);
      const nearestDistance = Math.abs(new Date(nearestRow.datetime).getTime() - targetTime);

      return rowDistance < nearestDistance ? row : nearestRow;
    }, null);
  }

  private getLastMovementAtOrBefore(datetime: string): BalanceRow | null {
    const targetTime = new Date(datetime).getTime();

    if (Number.isNaN(targetTime) || this.transactions.length === 0) {
      return null;
    }

    const movement = this.transactions.reduce<BalanceRow | null>((latestRow, row) => {
      const rowTime = new Date(row.datetime).getTime();

      if (Number.isNaN(rowTime) || rowTime > targetTime) {
        return latestRow;
      }

      if (!latestRow || rowTime >= new Date(latestRow.datetime).getTime()) {
        return row;
      }

      return latestRow;
    }, null);

    return movement ?? this.getNearestMovement(datetime);
  }

  private hasDayGroup(dayKey: string): boolean {
    return this.timelineMonths.some((month) =>
      month.dayGroups.some((day) => day.dateKey === dayKey),
    );
  }

  private getDateKey(value: string): string {
    const date = new Date(value);

    return [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0'),
    ].join('-');
  }

  protected getMonthElementId(monthKey: string): string {
    return `finance-month-${monthKey}`;
  }

  protected getDayElementId(dayKey: string): string {
    return `finance-day-${dayKey}`;
  }

  protected getMovementElementId(movementId: number): string {
    return `finance-movement-${movementId}`;
  }

  private buildMovementDayGroups(movements: BalanceRow[]): MovementDayGroup[] {
    const groups = new Map<string, MovementDayGroup>();

    [...movements]
      .sort((left, right) => new Date(left.datetime).getTime() - new Date(right.datetime).getTime())
      .forEach((row) => {
        const date = new Date(row.datetime);
        const dateKey = [
          date.getUTCFullYear(),
          String(date.getUTCMonth() + 1).padStart(2, '0'),
          String(date.getUTCDate()).padStart(2, '0'),
        ].join('-');

        const group = groups.get(dateKey) ?? {
          dateKey,
          date: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())),
          movements: [],
          income: 0,
          outcome: 0,
          balance: 0,
          accountBalances: [],
        };

        const value = Number(row.value);
        group.movements.push(row);
        group.income += value > 0 ? value : 0;
        group.outcome += value < 0 ? Math.abs(value) : 0;
        group.balance += value;
        group.accountBalances = this.getBalanceEntries(row.balances);
        groups.set(dateKey, group);
      });

    return Array.from(groups.values()).sort((left, right) => left.dateKey.localeCompare(right.dateKey));
  }

  private extractAvailableYears(data: BalanceRow[]): number[] {
    const yearSet = new Set<number>();

    data.forEach((row) => {
      yearSet.add(new Date(row.datetime).getUTCFullYear());
    });

    return Array.from(yearSet).sort((left, right) => left - right);
  }

  private buildYearBalances(data: BalanceRow[]): Record<number, number> {
    return data.reduce<Record<number, number>>((balances, row) => {
      const year = new Date(row.datetime).getUTCFullYear();
      const value = Number(row.value);
      balances[year] = (balances[year] ?? 0) + value;
      return balances;
    }, {});
  }

  private buildMonthSummaries(): void {
    if (this.selectedYear === null) {
      this.monthSummaries = [];
      return;
    }

    this.monthSummaries = this.monthLabels.map((label, index) => {
      const movements = this.transactions.filter((row) => {
        const date = new Date(row.datetime);
        return (
          date.getUTCFullYear() === this.selectedYear &&
          date.getUTCMonth() === index
        );
      });

      const income = movements.reduce((sum, row) => {
        const value = Number(row.value);
        return value > 0 ? sum + value : sum;
      }, 0);

      const outcome = movements.reduce((sum, row) => {
        const value = Number(row.value);
        return value < 0 ? sum + Math.abs(value) : sum;
      }, 0);
      const accountBalances = this.getLatestBalanceEntries(movements);
      const savings = this.getMonthSavingsTotals(this.selectedYear ?? new Date().getUTCFullYear(), index);

      const topExpenseLedgers = this.buildTopExpenseLedgers(movements);
      const expenseChartBackground = this.buildExpenseChartBackground(topExpenseLedgers);

      return {
        index,
        label,
        income,
        outcome,
        balance: income - outcome,
        previousSavings: savings.previousSavings,
        currentSavings: savings.currentSavings,
        totalSaved: savings.totalSaved,
        accountBalances,
        topExpenseLedgers,
        expenseChartBackground,
        movements,
      };
    });
  }

  private buildTimelineMonths(): void {
    const monthMap = new Map<string, BalanceRow[]>();

    this.transactions.forEach((row) => {
      const date = new Date(row.datetime);

      if (Number.isNaN(date.getTime())) {
        return;
      }

      const monthKey = [
        date.getUTCFullYear(),
        String(date.getUTCMonth() + 1).padStart(2, '0'),
      ].join('-');
      const monthMovements = monthMap.get(monthKey) ?? [];
      monthMovements.push(row);
      monthMap.set(monthKey, monthMovements);
    });

    this.timelineMonths = Array.from(monthMap.entries())
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([monthKey, movements]) => {
        const [year, month] = monthKey.split('-').map(Number);
        const income = movements.reduce((sum, row) => {
          const value = Number(row.value);
          return value > 0 ? sum + value : sum;
        }, 0);
        const outcome = movements.reduce((sum, row) => {
          const value = Number(row.value);
          return value < 0 ? sum + Math.abs(value) : sum;
        }, 0);
        const topExpenseLedgers = this.buildTopExpenseLedgers(movements);
        const accountBalances = this.getLatestBalanceEntries(movements);
        const savings = this.getMonthSavingsTotals(year, month - 1);

        return {
          monthKey,
          date: new Date(Date.UTC(year, month - 1, 1)),
          summary: {
            index: month - 1,
            label: `${this.monthLabels[month - 1]} ${year}`,
            income,
            outcome,
            balance: income - outcome,
            previousSavings: savings.previousSavings,
            currentSavings: savings.currentSavings,
            totalSaved: savings.totalSaved,
            accountBalances,
            topExpenseLedgers,
            expenseChartBackground: this.buildExpenseChartBackground(topExpenseLedgers),
            movements,
          },
          dayGroups: this.buildMovementDayGroups(movements),
        };
      });
  }

  private getLatestBalanceEntries(movements: BalanceRow[]): BalanceEntry[] {
    const latestMovement = this.getLatestRowFromRows(movements);

    return this.getBalanceEntries(latestMovement?.balances);
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

  private getMonthSavingsTotals(year: number, monthIndex: number): {
    previousSavings: number;
    currentSavings: number;
    totalSaved: number;
  } {
    const previousMonthEnd = this.getMonthEnd(new Date(Date.UTC(year, monthIndex - 1, 1)));
    const currentMonthEnd = this.getMonthEnd(new Date(Date.UTC(year, monthIndex, 1)));
    const previousSavings = this.getPositiveBalanceTotalFromSnapshot(
      this.getLatestRowAtOrBefore(previousMonthEnd)?.balances,
    );
    const currentSavings = this.getPositiveBalanceTotalFromSnapshot(
      this.getLatestRowAtOrBefore(currentMonthEnd)?.balances,
    );

    return {
      previousSavings,
      currentSavings,
      totalSaved: currentSavings - previousSavings,
    };
  }

  private getLatestRowAtOrBefore(targetDate: Date): BalanceRow | undefined {
    const targetTime = targetDate.getTime();

    return this.transactions.reduce<BalanceRow | undefined>((latestRow, row) => {
      const rowTime = new Date(row.datetime).getTime();

      if (Number.isNaN(rowTime) || rowTime > targetTime) {
        return latestRow;
      }

      if (!latestRow || rowTime >= new Date(latestRow.datetime).getTime()) {
        return row;
      }

      return latestRow;
    }, undefined);
  }

  private getLatestRowFromRows(rows: BalanceRow[]): BalanceRow | undefined {
    return rows.reduce<BalanceRow | undefined>((latestRow, row) => {
      const rowTime = new Date(row.datetime).getTime();

      if (Number.isNaN(rowTime)) {
        return latestRow;
      }

      if (!latestRow || rowTime >= new Date(latestRow.datetime).getTime()) {
        return row;
      }

      return latestRow;
    }, undefined);
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

  private getPositiveBalanceTotalFromSnapshot(balances: BalanceSnapshot | null | undefined): number {
    return this.getBalanceEntries(balances).reduce((total, balance) => {
      return balance.value > 0 ? total + balance.value : total;
    }, 0);
  }

  private buildTopExpenseLedgers(movements: BalanceRow[]): ExpenseLedgerSummary[] {
    const expenseTotals = new Map<string, number>();

    movements.forEach((row) => {
      const value = Number(row.value);

      if (value >= 0) {
        return;
      }

      const currentTotal = expenseTotals.get(row.ledger_account) ?? 0;
      expenseTotals.set(row.ledger_account, currentTotal + Math.abs(value));
    });

    const topExpenseLedgers = Array.from(expenseTotals.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((left, right) => right.total - left.total)
      .slice(0, 3);

    if (topExpenseLedgers.length === 0) {
      return [
        {
          name: 'Sem despesas',
          total: 0,
          percent: 100,
          color: this.expenseChartColors[0],
        },
      ];
    }

    const totalExpenses = topExpenseLedgers.reduce((sum, ledger) => sum + ledger.total, 0);

    return topExpenseLedgers.map((ledger, index) => ({
      ...ledger,
      percent: totalExpenses > 0 ? (ledger.total / totalExpenses) * 100 : 0,
      color: this.expenseChartColors[index % this.expenseChartColors.length],
    }));
  }

  private buildExpenseChartBackground(ledgers: ExpenseLedgerSummary[]): string {
    if (ledgers.length === 0) {
      return `conic-gradient(${this.expenseChartColors[0]} 0deg 360deg)`;
    }

    let currentAngle = 0;
    const segments = ledgers.map((ledger) => {
      const start = currentAngle;
      const sweep = (ledger.percent / 100) * 360;
      currentAngle += sweep;
      return `${ledger.color} ${start}deg ${currentAngle}deg`;
    });

    if (currentAngle < 360) {
      segments.push(`rgba(19, 49, 39, 0.08) ${currentAngle}deg 360deg`);
    }

    return `conic-gradient(${segments.join(', ')})`;
  }

  private async scrollToTable(): Promise<void> {
    if (!this.content || !this.resultsAnchor) {
      return;
    }

    const targetY = Math.max(this.resultsAnchor.nativeElement.offsetTop - 16, 0);

    await this.content.scrollToPoint(0, targetY, 500);
  }
}
