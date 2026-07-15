import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import {
  IonContent,
  IonIcon,
  IonRefresher,
  IonRefresherContent,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  airplaneOutline,
  alertCircleOutline,
  bulbOutline,
  businessOutline,
  carOutline,
  cardOutline,
  cartOutline,
  cashOutline,
  chevronDownOutline,
  chevronForwardOutline,
  addOutline,
  cloudUploadOutline,
  checkmarkCircleOutline,
  closeOutline,
  createOutline,
  downloadOutline,
  gameControllerOutline,
  heartOutline,
  homeOutline,
  informationCircleOutline,
  logOutOutline,
  medkitOutline,
  notificationsOutline,
  personOutline,
  pricetagOutline,
  repeatOutline,
  restaurantOutline,
  receiptOutline,
  saveOutline,
  schoolOutline,
  shieldCheckmarkOutline,
  starOutline,
  timeOutline,
  trendingDownOutline,
  trendingUpOutline,
  trashOutline,
  walletOutline,
} from 'ionicons/icons';
import { Observable, finalize, forkJoin } from 'rxjs';
import {
  BalanceRow,
  ContractOnboardingSetup,
  FinanceDataService,
  FinanceSettingsData,
  LedgerAccountSettings,
  MovimentAccountSettings,
  StatusSettings,
} from '../finance-data.service';
import { AuthService, UserProfile } from '../auth.service';
import { AppCurrencyPipe } from '../app-currency.pipe';
import { AppCurrencyCode, appCurrencyOptions, CurrencySettingsService } from '../currency-settings.service';
import {
  CreditBillSettings,
  getCreditBillSettings,
  setCreditBillSettings,
} from '../credit-bill-settings';
import {
  AppNotification,
  NotificationRule,
  NotificationRuleType,
  evaluateNotifications,
  getNotificationRules,
  getRuleSummary,
  getRuleTypeLabel,
  setNotificationRules,
} from '../notification-settings';
import { FinancialAiAnalysis } from '../financial-ai.types';

type SettingsTab = 'accounts' | 'ledger' | 'status' | 'notifications' | 'creditCards';
type SettingsView = 'menu' | 'profile' | 'aiAnalysis' | 'backupExport' | 'premium' | 'privacy' | 'about' | SettingsTab;
type BackupExportFormat = 'json' | 'csv';
type BackupExportSection = 'account' | 'auxiliary' | 'movements';
type IconPickerTarget = 'account' | 'ledger' | 'status';

interface IconOption {
  name: string;
  label: string;
}

interface ProfileAvatarOption {
  id: string;
  label: string;
  value: string;
  backgroundPosition: string;
}

interface ExpectedCreditBill {
  account_id: number;
  account_description: string;
  cycle_key: string;
  due_datetime: string;
  value: number;
  movement_count: number;
}

interface BackupExportTable {
  table: string;
  rows: Array<Record<string, unknown>>;
}

interface BackupExportPayload {
  metadata: {
    exportedAt: string;
    formatVersion: number;
    contractId: number | null;
    userId: number | null;
  };
  tables: BackupExportTable[];
}

interface BackupZipFile {
  filename: string;
  content: string;
}

@Component({
  selector: 'app-settings-page',
  templateUrl: './settings-page.component.html',
  styleUrls: ['./settings-page.component.scss'],
  imports: [CommonModule, IonContent, IonIcon, IonRefresher, IonRefresherContent, ReactiveFormsModule, AppCurrencyPipe],
})
export class SettingsPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly financeData = inject(FinanceDataService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly currencySettings = inject(CurrencySettingsService);
  private readonly appReviewUrl = 'https://play.google.com/store/apps/details?id=com.camplife.wakeradio';
  private loadedToken = '';

  protected activeView: SettingsView = 'menu';
  protected activeTab: SettingsTab = 'accounts';
  protected accounts: MovimentAccountSettings[] = [];
  protected ledgerAccounts: LedgerAccountSettings[] = [];
  protected statuses: StatusSettings[] = [];
  protected profile: UserProfile | null = null;
  protected onboardingSetup: ContractOnboardingSetup | null = null;
  protected isLoading = false;
  protected isSaving = false;
  protected isSavingPassword = false;
  protected isExportingBackup = false;
  protected isImportingBackup = false;
  protected selectedBackupExportFormat: BackupExportFormat = 'json';
  protected selectedBackupExportSections: Record<BackupExportSection, boolean> = {
    account: true,
    auxiliary: true,
    movements: true,
  };
  protected errorMessage = '';
  protected successMessage = '';
  protected isNotificationMenuOpen = false;
  protected settingsNotifications: AppNotification[] = [];
  protected aiAnalysis: FinancialAiAnalysis | null = null;
  protected aiAnalysisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  protected isAiAnalysisLoading = false;
  protected aiAnalysisErrorMessage = '';
  protected notificationRules: NotificationRule[] = [];
  protected showNotificationForm = false;
  protected showAccountForm = false;
  protected showLedgerForm = false;
  protected showStatusForm = false;
  protected accountEditId: number | null = null;
  protected ledgerEditId: number | null = null;
  protected statusEditId: number | null = null;
  protected activeIconPicker: IconPickerTarget | null = null;
  private readonly selectedMovimentStorageKey = 'selectedMoviment';
  private readonly notificationReadStorageKey = 'dashboardProvisionNotificationReads';
  private hasSettingsDetailHistory = false;
  private balanceRows: BalanceRow[] = [];
  protected readonly iconOptions: IconOption[] = [
    { name: 'wallet-outline', label: 'Carteira' },
    { name: 'card-outline', label: 'Cartão' },
    { name: 'cash-outline', label: 'Dinheiro' },
    { name: 'business-outline', label: 'Banco' },
    { name: 'home-outline', label: 'Casa' },
    { name: 'restaurant-outline', label: 'Alimentação' },
    { name: 'cart-outline', label: 'Compras' },
    { name: 'car-outline', label: 'Transporte' },
    { name: 'airplane-outline', label: 'Viagem' },
    { name: 'medkit-outline', label: 'Saúde' },
    { name: 'school-outline', label: 'Educação' },
    { name: 'game-controller-outline', label: 'Lazer' },
    { name: 'receipt-outline', label: 'Recibo' },
    { name: 'trending-up-outline', label: 'Entrada' },
    { name: 'trending-down-outline', label: 'Saída' },
    { name: 'checkmark-circle-outline', label: 'Confirmado' },
    { name: 'time-outline', label: 'Pendente' },
    { name: 'alert-circle-outline', label: 'Atenção' },
  ];
  protected readonly profileAvatarOptions: ProfileAvatarOption[] = [
    { id: 'pao-duro', label: 'O Milionário Pão-Duro', value: 'MP', backgroundPosition: '0% 0%' },
    { id: 'bilionario-nervosinho', label: 'O Bilionário Nervosinho', value: 'BN', backgroundPosition: '33.333% 0%' },
    { id: 'rainha-cupons', label: 'A Rainha dos Cupons', value: 'RC', backgroundPosition: '66.667% 0%' },
    { id: 'rei-pix', label: 'O Rei do Pix', value: 'RP', backgroundPosition: '100% 0%' },
    { id: 'investidora-zen', label: 'A Investidora Zen', value: 'IZ', backgroundPosition: '0% 33.333%' },
    { id: 'gastador-compulsivo', label: 'O Gastador Compulsivo', value: 'GC', backgroundPosition: '33.333% 33.333%' },
    { id: 'cacadora-promocoes', label: 'A Caçadora de Promoções', value: 'CP', backgroundPosition: '66.667% 33.333%' },
    { id: 'contador-maluco', label: 'O Contador Maluco', value: 'CM', backgroundPosition: '100% 33.333%' },
    { id: 'chefe-orcamento', label: 'A Chefe do Orçamento', value: 'CO', backgroundPosition: '0% 66.667%' },
    { id: 'pirata-cashback', label: 'O Pirata do Cashback', value: 'PC', backgroundPosition: '33.333% 66.667%' },
    { id: 'mago-juros-compostos', label: 'O Mago dos Juros Compostos', value: 'MJ', backgroundPosition: '66.667% 66.667%' },
    { id: 'capivara-economica', label: 'A Capivara Econômica', value: 'CE', backgroundPosition: '100% 66.667%' },
    { id: 'gato-magnata', label: 'O Gato Magnata', value: 'GM', backgroundPosition: '0% 100%' },
  ];
  protected readonly currencyOptions = appCurrencyOptions;
  protected readonly notificationTypeOptions: Array<{ value: NotificationRuleType; label: string }> = [
    { value: 'movement-due', label: 'A pagar / A receber' },
    { value: 'credit-confirmation', label: 'Confirmação no crédito' },
    { value: 'category-limit', label: 'Limite por categoria' },
    { value: 'account-limit', label: 'Limite por conta' },
    { value: 'entry-reminder', label: 'Lembrete de lançamentos' },
  ];
  protected readonly notificationLeadOptions = [
    { value: 30, label: '30 min' },
    { value: 60, label: '1h' },
    { value: 360, label: '6h' },
    { value: 720, label: '12h' },
    { value: 1440, label: '24h' },
    { value: 2880, label: '48h' },
  ];
  protected readonly reminderIntervalOptions = [
    { value: 6, label: '6h' },
    { value: 12, label: '12h' },
    { value: 24, label: '24h' },
  ];

  protected readonly accountForm = this.fb.nonNullable.group({
    description: ['', Validators.required],
    icon: ['wallet-outline', Validators.required],
    startDate: [''],
    startValue: this.fb.control<number | null>(null),
    closingDay: this.fb.control<number | null>(null, [Validators.min(1), Validators.max(31)]),
    payDay: this.fb.control<number | null>(null, [Validators.min(1), Validators.max(31)]),
    debitAccount: this.fb.control<number | null>(null),
    accountType: this.fb.nonNullable.control<0 | 1>(0, Validators.required),
  });

  protected readonly ledgerForm = this.fb.nonNullable.group({
    description: ['', Validators.required],
    icon: ['receipt-outline', Validators.required],
  });

  protected readonly statusForm = this.fb.nonNullable.group({
    description: ['', Validators.required],
    icon: ['time-outline', Validators.required],
  });

  protected readonly profileForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    username: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    profileAvatar: ['sorriso', Validators.required],
    currencyCode: ['EUR', Validators.required],
  });

  protected readonly passwordForm = this.fb.nonNullable.group({
    currentPassword: [''],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', [Validators.required, Validators.minLength(8)]],
  });

  protected readonly notificationForm = this.fb.nonNullable.group({
    type: this.fb.nonNullable.control<NotificationRuleType>('movement-due', Validators.required),
    direction: this.fb.nonNullable.control<'payable' | 'receivable' | 'both'>('both', Validators.required),
    leadMinutes: this.fb.nonNullable.control(360, Validators.required),
    delayMinutes: this.fb.nonNullable.control(1440, Validators.required),
    ledgerAccountId: this.fb.control<number | null>(null),
    movimentAccountId: this.fb.control<number | null>(null),
    limitValue: this.fb.control<number | null>(null),
    thresholdPercent: this.fb.nonNullable.control(80, [Validators.required, Validators.min(1), Validators.max(100)]),
    intervalHours: this.fb.nonNullable.control(12, Validators.required),
  });

  protected readonly creditBillForm = this.fb.nonNullable.group({
    enabled: [true],
    includeProvisioned: [false],
  });

  constructor() {
    addIcons({
      addOutline,
      airplaneOutline,
      alertCircleOutline,
      bulbOutline,
      businessOutline,
      carOutline,
      cardOutline,
      cartOutline,
      cashOutline,
      chevronDownOutline,
      chevronForwardOutline,
      cloudUploadOutline,
      checkmarkCircleOutline,
      closeOutline,
      createOutline,
      downloadOutline,
      gameControllerOutline,
      heartOutline,
      homeOutline,
      informationCircleOutline,
      logOutOutline,
      medkitOutline,
      notificationsOutline,
      personOutline,
      pricetagOutline,
      repeatOutline,
      restaurantOutline,
      receiptOutline,
      saveOutline,
      schoolOutline,
      shieldCheckmarkOutline,
      starOutline,
      timeOutline,
      trendingDownOutline,
      trendingUpOutline,
      trashOutline,
      walletOutline,
    });
  }

  ngOnInit() {
    this.loadSettings();
  }

  ionViewWillEnter(): void {
    if (this.loadedToken !== this.auth.token) {
      this.loadSettings();
    }
  }

  protected setActiveTab(tab: SettingsTab): void {
    this.pushSettingsDetailHistory();
    this.activeView = tab;
    this.activeTab = tab;
    this.activeIconPicker = null;
    this.errorMessage = '';
    this.successMessage = '';
  }

  protected openSettingsView(view: SettingsTab): void {
    this.setActiveTab(view);
  }

  protected openAiAnalysisView(): void {
    this.pushSettingsDetailHistory();
    this.activeView = 'aiAnalysis';
    this.activeIconPicker = null;
    this.errorMessage = '';
    this.successMessage = '';
  }

  protected openBackupExportView(): void {
    this.pushSettingsDetailHistory();
    this.activeView = 'backupExport';
    this.activeIconPicker = null;
    this.errorMessage = '';
    this.successMessage = '';
  }

  protected openInfoView(view: 'premium' | 'privacy' | 'about'): void {
    this.pushSettingsDetailHistory();
    this.activeView = view;
    this.activeIconPicker = null;
    this.errorMessage = '';
    this.successMessage = '';
  }

  protected openProfileView(): void {
    this.pushSettingsDetailHistory();
    this.activeView = 'profile';
    this.activeIconPicker = null;
    this.errorMessage = '';
    this.successMessage = '';
    this.loadProfile();
  }

  protected backToMenu(): void {
    if (this.hasSettingsDetailHistory) {
      window.history.back();
      return;
    }

    this.closeSettingsDetailView();
  }

  @HostListener('window:popstate')
  protected handleBrowserBack(): void {
    if (this.activeView !== 'menu') {
      this.closeSettingsDetailView();
    }
  }

  private closeSettingsDetailView(): void {
    this.activeView = 'menu';
    this.activeIconPicker = null;
    this.errorMessage = '';
    this.successMessage = '';
    this.hasSettingsDetailHistory = false;
  }

  private pushSettingsDetailHistory(): void {
    if (this.activeView !== 'menu' || this.hasSettingsDetailHistory) {
      return;
    }

    window.history.pushState({ settingsDetail: true }, '');
    this.hasSettingsDetailHistory = true;
  }

  protected get username(): string {
    return this.auth.user?.name || this.auth.user?.username || 'Usuário';
  }

  protected get creditBillSettings(): CreditBillSettings {
    return getCreditBillSettings(this.onboardingSetup);
  }

  protected get creditAccounts(): MovimentAccountSettings[] {
    return this.accounts.filter((account) => account.account_type === 1);
  }

  protected setCreditBillEnabled(enabled: boolean): void {
    this.creditBillForm.controls.enabled.setValue(enabled);

    if (!enabled) {
      this.creditBillForm.controls.includeProvisioned.setValue(false);
    }
  }

  protected setCreditBillIncludeProvisioned(includeProvisioned: boolean): void {
    if (!this.creditBillForm.controls.enabled.value) {
      return;
    }

    this.creditBillForm.controls.includeProvisioned.setValue(includeProvisioned);
  }

  protected saveAndGenerateCreditBills(): void {
    const settings = this.getCreditBillFormSettings();
    const onboardingSetup = setCreditBillSettings(this.onboardingSetup, settings);

    this.isSaving = true;
    this.successMessage = '';
    this.financeData.saveContractOnboardingSetup(onboardingSetup)
      .subscribe({
        next: (savedSetup) => {
          this.onboardingSetup = savedSetup;
          this.patchCreditBillForm(savedSetup);
          this.generateCreditBillsNow(settings);
        },
        error: () => {
          this.isSaving = false;
          this.errorMessage = 'Não foi possível salvar a configuração dos cartões.';
        },
      });
  }

  protected saveCreditBillSettings(): void {
    const settings = this.getCreditBillFormSettings();
    const onboardingSetup = setCreditBillSettings(this.onboardingSetup, settings);

    this.isSaving = true;
    this.successMessage = '';
    this.financeData.saveContractOnboardingSetup(onboardingSetup)
      .pipe(finalize(() => (this.isSaving = false)))
      .subscribe({
        next: (savedSetup) => {
          this.onboardingSetup = savedSetup;
          this.patchCreditBillForm(savedSetup);
          this.successMessage = 'Configuração dos cartões salva.';
        },
        error: () => {
          this.errorMessage = 'Não foi possível salvar a configuração dos cartões.';
        },
      });
  }

  protected generateCreditBillsNow(settings = getCreditBillSettings(this.onboardingSetup)): void {
    const provisionedAutomaticBills = this.getProvisionedAutomaticCreditBillRows();

    if (!settings.enabled) {
      if (provisionedAutomaticBills.length === 0) {
        this.isSaving = false;
        this.successMessage = 'Configuração salva. A geração automática de faturas está desligada.';
        this.reloadSettingsAfterCreditBillReconcile();
        return;
      }

      forkJoin(provisionedAutomaticBills.map((row) => this.financeData.deleteMoviment(row.id)))
        .pipe(finalize(() => (this.isSaving = false)))
        .subscribe({
          next: () => {
            this.successMessage = 'Geração automática desligada. Faturas provisionadas removidas.';
            this.reloadSettingsAfterCreditBillReconcile();
          },
          error: () => {
            this.errorMessage = 'Não foi possível excluir as faturas provisionadas atuais.';
          },
        });
      return;
    }

    const expectedBills = this.buildExpectedCreditBills(settings);

    this.isSaving = true;
    this.successMessage = '';

    const cleanupRequest = provisionedAutomaticBills.length > 0
      ? forkJoin(provisionedAutomaticBills.map((row) => this.financeData.deleteMoviment(row.id)))
      : null;

    const runGeneration = () => {
      if (expectedBills.length === 0) {
        this.isSaving = false;
        this.successMessage = provisionedAutomaticBills.length > 0
          ? 'Faturas provisionadas removidas. Nenhuma nova fatura para gerar.'
          : 'Nenhuma fatura pendente para gerar ou atualizar.';
        this.reloadSettingsAfterCreditBillReconcile();
        return;
      }

      this.createExpectedCreditBills(expectedBills);
    };

    if (cleanupRequest) {
      cleanupRequest.subscribe({
        next: () => runGeneration(),
        error: () => {
          this.isSaving = false;
          this.errorMessage = 'Não foi possível excluir as faturas provisionadas atuais.';
        },
      });
      return;
    }

    runGeneration();
  }

  private getCreditBillFormSettings(): CreditBillSettings {
    const formValue = this.creditBillForm.getRawValue();

    return {
      enabled: formValue.enabled,
      includeProvisioned: formValue.enabled && formValue.includeProvisioned,
    };
  }

  private createExpectedCreditBills(expectedBills: ExpectedCreditBill[]): void {
    forkJoin(this.creditAccounts.map((account) => {
      const accountBills = expectedBills.filter((bill) => bill.account_id === account.id);
      return accountBills.length > 0
        ? this.financeData.syncCreditBills(true, account.id, accountBills)
        : this.financeData.syncCreditBills(false, account.id);
    }))
      .pipe(finalize(() => (this.isSaving = false)))
      .subscribe({
        next: () => this.enforceGeneratedCreditBills(expectedBills),
        error: () => {
          this.errorMessage = 'Não foi possível gerar as faturas agora.';
        },
      });
  }

  protected get profileEmail(): string {
    return this.profile?.email || this.auth.user?.email || 'Email da conta';
  }

  protected get userInitials(): string {
    return this.username
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'U';
  }

  protected get hasUnreadNotifications(): boolean {
    return this.settingsNotifications.some((notification) => !notification.isRead);
  }

  protected get selectedProfileAvatar(): ProfileAvatarOption {
    return this.profileAvatarOptions.find((option) => option.id === this.profileForm.controls.profileAvatar.value)
      ?? this.profileAvatarOptions[0];
  }

  protected get aiAnalysisMonthLabel(): string {
    return new Intl.DateTimeFormat('pt-PT', { month: 'long' })
      .format(this.aiAnalysisMonth)
      .replace(/^./, (letter) => letter.toUpperCase());
  }

  protected get aiAnalysisYear(): number {
    return this.aiAnalysisMonth.getFullYear();
  }

  protected changeAiAnalysisMonth(direction: -1 | 1): void {
    this.aiAnalysisMonth = new Date(
      this.aiAnalysisMonth.getFullYear(),
      this.aiAnalysisMonth.getMonth() + direction,
      1,
    );
    this.aiAnalysis = null;
    this.aiAnalysisErrorMessage = '';
  }

  protected requestAiAnalysis(): void {
    if (this.isAiAnalysisLoading) {
      return;
    }

    this.isAiAnalysisLoading = true;
    this.aiAnalysisErrorMessage = '';

    this.financeData.getFinancialAiAnalysis(this.getMonthKey(this.aiAnalysisMonth))
      .pipe(finalize(() => (this.isAiAnalysisLoading = false)))
      .subscribe({
        next: (analysis) => {
          this.aiAnalysis = analysis;
        },
        error: (error) => {
          this.aiAnalysisErrorMessage = error?.error?.message ?? 'Não foi possível gerar a análise IA.';
        },
      });
  }

  protected toggleNotificationMenu(event: Event): void {
    event.stopPropagation();
    this.isNotificationMenuOpen = !this.isNotificationMenuOpen;

  }

  protected openNotificationMovement(notification: AppNotification, event?: Event): void {
    event?.stopPropagation();
    if (!notification.movement) {
      return;
    }
    this.markNotificationAsRead(notification.id);
    this.openEditMoviment(notification.movement);
  }

  protected confirmNotificationMovement(notification: AppNotification, event: Event): void {
    event.stopPropagation();
    if (!notification.movement) {
      this.markNotificationAsRead(notification.id);
      return;
    }

    const settledStatus = this.getSettledStatusOption();

    if (!settledStatus) {
      this.errorMessage = 'Não foi possível encontrar o status Consumado.';
      return;
    }

    this.markNotificationAsRead(notification.id);
    this.financeData.updateMovimentStatus(notification.movement, settledStatus.id).subscribe({
      next: () => this.loadSettings(),
      error: () => {
        this.errorMessage = 'Não foi possível marcar o movimento como Consumado.';
      },
    });
  }

  protected getSettledActionLabel(row: BalanceRow): string {
    return Number(row.value) >= 0 ? 'Recebido' : 'Pago';
  }

  protected startNewAccount(): void {
    this.resetAccountForm();
    this.showAccountForm = true;
  }

  protected startNewLedgerAccount(): void {
    this.resetLedgerForm();
    this.showLedgerForm = true;
  }

  protected startNewStatus(): void {
    this.resetStatusForm();
    this.showStatusForm = true;
  }

  protected saveAccount(): void {
    this.accountForm.markAllAsTouched();
    this.errorMessage = '';

    if (this.accountForm.invalid) {
      this.errorMessage = 'Preencha os campos obrigatórios da conta.';
      return;
    }

    const formValue = this.accountForm.getRawValue();
    const description = formValue.description.trim();

    if (!description) {
      this.errorMessage = 'Preencha os campos obrigatórios da conta.';
      return;
    }

    if (this.hasDuplicateAccountDescription(description)) {
      this.accountForm.controls.description.setErrors({ duplicate: true });
      this.errorMessage = 'Já existe uma conta com esta descrição.';
      return;
    }

    if (formValue.accountType === 1 && (!formValue.payDay || !formValue.debitAccount)) {
      this.errorMessage = 'Preencha o dia de pagamento e a conta de débito do cartão.';
      return;
    }

    const payload = {
      description,
      icon: this.normalizeIcon(formValue.icon, 'wallet-outline'),
      start_date: formValue.startDate || null,
      start_value: formValue.startValue,
      closing_day: formValue.closingDay,
      pay_day: formValue.accountType === 1 ? formValue.payDay : null,
      debit_account: formValue.accountType === 1 ? formValue.debitAccount : null,
      account_type: formValue.accountType,
    };

    this.saveSettingsRequest(
      'Conta salva.',
      this.financeData.saveMovimentAccount(
        this.accountEditId ? 'edit' : 'add',
        payload,
        this.accountEditId ?? undefined,
      ),
      () => {
        this.resetAccountForm();
        this.showAccountForm = false;
      },
    );
  }

  protected editAccount(account: MovimentAccountSettings): void {
    this.showAccountForm = true;
    this.accountEditId = account.id;
    this.accountForm.patchValue({
      description: account.description ?? '',
      icon: this.normalizeIcon(account.icon, 'wallet-outline'),
      startDate: this.toDateInputValue(account.start_date),
      startValue: account.start_value === null ? null : Number(account.start_value),
      closingDay: account.closing_day,
      payDay: account.pay_day,
      debitAccount: account.debit_account,
      accountType: account.account_type,
    });
  }

  protected deleteAccount(account: MovimentAccountSettings): void {
    if (this.hasAccountMovements(account)) {
      this.errorMessage = 'Esta conta já tem movimentos e não pode ser excluída.';
      return;
    }

    if (!window.confirm(`Excluir a conta "${account.description}"?`)) {
      return;
    }

    this.saveSettingsRequest(
      'Conta excluída.',
      this.financeData.deleteMovimentAccount(account.id),
      () => {
        if (this.accountEditId === account.id) {
          this.resetAccountForm();
        }
      },
    );
  }

  protected resetAccountForm(): void {
    this.accountEditId = null;
    this.activeIconPicker = this.activeIconPicker === 'account' ? null : this.activeIconPicker;
    this.accountForm.reset({
      description: '',
      icon: 'wallet-outline',
      startDate: '',
      startValue: null,
      closingDay: null,
      payDay: null,
      debitAccount: null,
      accountType: 0,
    });
  }

  protected saveLedgerAccount(): void {
    this.ledgerForm.markAllAsTouched();
    this.errorMessage = '';

    if (this.ledgerForm.invalid) {
      this.errorMessage = 'Preencha os campos obrigatórios da categoria.';
      return;
    }

    const payload = {
      description: this.ledgerForm.controls.description.value.trim(),
      icon: this.normalizeIcon(this.ledgerForm.controls.icon.value, 'receipt-outline'),
    };

    this.saveSettingsRequest(
      'Categoria salva.',
      this.financeData.saveLedgerAccount(
        this.ledgerEditId ? 'edit' : 'add',
        payload,
        this.ledgerEditId ?? undefined,
      ),
      () => {
        this.resetLedgerForm();
        this.showLedgerForm = false;
      },
    );
  }

  protected editLedgerAccount(account: LedgerAccountSettings): void {
    this.showLedgerForm = true;
    this.ledgerEditId = account.id;
    this.ledgerForm.patchValue({
      description: account.description ?? '',
      icon: this.normalizeIcon(account.icon, 'receipt-outline'),
    });
  }

  protected deleteLedgerAccount(account: LedgerAccountSettings): void {
    if (this.hasLedgerAccountMovements(account)) {
      this.errorMessage = 'Esta categoria já tem movimentos e não pode ser excluída.';
      return;
    }

    if (!window.confirm(`Excluir a categoria "${account.description}"?`)) {
      return;
    }

    this.saveSettingsRequest(
      'Categoria excluída.',
      this.financeData.deleteLedgerAccount(account.id),
      () => {
        if (this.ledgerEditId === account.id) {
          this.resetLedgerForm();
        }
      },
    );
  }

  protected resetLedgerForm(): void {
    this.ledgerEditId = null;
    this.activeIconPicker = this.activeIconPicker === 'ledger' ? null : this.activeIconPicker;
    this.ledgerForm.reset({ description: '', icon: 'receipt-outline' });
  }

  protected saveStatus(): void {
    this.statusForm.markAllAsTouched();
    this.errorMessage = '';

    if (this.statusForm.invalid) {
      this.errorMessage = 'Preencha os campos obrigatórios do status.';
      return;
    }

    const payload = {
      description: this.statusForm.controls.description.value.trim(),
      icon: this.normalizeIcon(this.statusForm.controls.icon.value, 'time-outline'),
    };

    this.saveSettingsRequest(
      'Status salvo.',
      this.financeData.saveStatus(
        this.statusEditId ? 'edit' : 'add',
        payload,
        this.statusEditId ?? undefined,
      ),
      () => {
        this.resetStatusForm();
        this.showStatusForm = false;
      },
    );
  }

  protected editStatus(status: StatusSettings): void {
    this.showStatusForm = true;
    this.statusEditId = status.id;
    this.statusForm.patchValue({
      description: status.description ?? '',
      icon: this.normalizeIcon(status.icon, 'time-outline'),
    });
  }

  protected deleteStatus(status: StatusSettings): void {
    if (!window.confirm(`Excluir o status "${status.description}"?`)) {
      return;
    }

    this.saveSettingsRequest(
      'Status excluído.',
      this.financeData.deleteStatus(status.id),
      () => {
        if (this.statusEditId === status.id) {
          this.resetStatusForm();
        }
      },
    );
  }

  protected resetStatusForm(): void {
    this.statusEditId = null;
    this.activeIconPicker = this.activeIconPicker === 'status' ? null : this.activeIconPicker;
    this.statusForm.reset({ description: '', icon: 'time-outline' });
  }

  protected getAccountTypeLabel(accountType: number | null): string {
    return accountType === 1 ? 'Crédito' : 'Débito';
  }

  protected get debitAccountOptions(): MovimentAccountSettings[] {
    return this.accounts.filter((account) => {
      return account.account_type === 0 && account.id !== this.accountEditId;
    });
  }

  protected getDebitAccountLabel(accountId: number | null | undefined): string {
    if (!accountId) {
      return '';
    }

    return this.accounts.find((account) => account.id === accountId)?.description ?? `Conta ${accountId}`;
  }

  protected hasAccountMovements(account: MovimentAccountSettings): boolean {
    return this.balanceRows.some((row) => Number(row.moviment_account_id) === account.id);
  }

  protected hasLedgerAccountMovements(account: LedgerAccountSettings): boolean {
    return this.balanceRows.some((row) => Number(row.ledger_account_id) === account.id);
  }

  protected getSettingsIcon(icon: string | null | undefined, fallbackIcon: string): string {
    return this.normalizeIcon(icon, fallbackIcon);
  }

  protected getIconLabel(icon: string | null | undefined, fallbackIcon: string): string {
    const normalizedIcon = this.normalizeIcon(icon, fallbackIcon);
    return this.iconOptions.find((option) => option.name === normalizedIcon)?.label ?? 'Ícone';
  }

  protected toggleIconPicker(target: IconPickerTarget): void {
    this.activeIconPicker = this.activeIconPicker === target ? null : target;
  }

  protected selectIcon(target: IconPickerTarget, icon: string): void {
    const normalizedIcon = this.normalizeIcon(icon, 'wallet-outline');

    if (target === 'account') {
      this.accountForm.controls.icon.setValue(normalizedIcon);
    } else if (target === 'ledger') {
      this.ledgerForm.controls.icon.setValue(normalizedIcon);
    } else {
      this.statusForm.controls.icon.setValue(normalizedIcon);
    }

    this.activeIconPicker = null;
  }

  protected refreshSettings(event: CustomEvent): void {
    this.loadSettings(event);
  }

  protected selectBackupExportFormat(format: BackupExportFormat): void {
    this.selectedBackupExportFormat = format;
  }

  protected toggleBackupSectionSelection(section: BackupExportSection): void {
    this.selectedBackupExportSections = {
      ...this.selectedBackupExportSections,
      [section]: !this.selectedBackupExportSections[section],
    };
  }

  protected exportBackupData(format = this.selectedBackupExportFormat): void {
    if (this.isExportingBackup) {
      return;
    }

    if (!this.hasSelectedBackupExportSections()) {
      this.errorMessage = 'Selecione pelo menos um grupo de dados para exportar.';
      this.successMessage = '';
      return;
    }

    this.isExportingBackup = true;
    this.errorMessage = '';
    this.successMessage = '';

    forkJoin({
      profile: this.auth.getProfile(),
      onboarding: this.financeData.getContractOnboardingSetup(),
      settings: this.financeData.getFinanceSettings(),
      balances: this.financeData.getBalances(true),
    })
      .subscribe({
        next: async ({ profile, onboarding, settings, balances }) => {
          this.profile = profile.data.user;
          this.onboardingSetup = onboarding;
          this.accounts = settings.accounts;
          this.ledgerAccounts = settings.ledgerAccounts;
          this.statuses = settings.statuses;
          this.balanceRows = balances;

          const payload = this.buildBackupExportPayload(profile.data.user, onboarding, settings, balances);
          const fileDate = this.getBackupFileDate();
          const contractId = payload.metadata.contractId ?? 'sem-contrato';
          const baseFilename = `salarium-backup-${contractId}-${fileDate}`;
          let exportTarget: 'shared' | 'downloaded';

          try {
            if (format === 'json') {
              exportTarget = await this.saveBackupFile(
                `${baseFilename}.json`,
                'application/json;charset=utf-8',
                JSON.stringify(payload, null, 2),
              );
            } else {
              exportTarget = await this.saveBackupBlob(
                `${baseFilename}-csv.zip`,
                this.createZipBlob(this.backupPayloadToCsvFiles(payload)),
              );
            }

            this.successMessage = this.getBackupExportSuccessMessage(format, exportTarget);
          } catch {
            this.errorMessage = 'Não foi possível gerar o backup agora.';
          } finally {
            this.isExportingBackup = false;
          }
        },
        error: () => {
          this.isExportingBackup = false;
          this.errorMessage = 'Não foi possível gerar o backup agora.';
        },
      });
  }

  protected importBackupData(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];

    if (!file || this.isImportingBackup) {
      return;
    }

    this.isImportingBackup = true;
    this.errorMessage = '';
    this.successMessage = '';

    const fileName = file.name.toLowerCase();
    const readFile = fileName.endsWith('.zip')
      ? Promise.resolve('Arquivo ZIP selecionado para restauração.')
      : file.text().then((content) => this.getBackupImportSummary(content, file.name));

    readFile
      .then((content) => {
        this.successMessage = `Arquivo "${file.name}" lido: ${content}. A restauração será aplicada na próxima etapa.`;
      })
      .catch(() => {
        this.errorMessage = 'Não foi possível ler o arquivo de backup.';
      })
      .finally(() => {
        this.isImportingBackup = false;
        if (input) {
          input.value = '';
        }
      });
  }

  protected saveProfile(): void {
    this.profileForm.markAllAsTouched();
    this.errorMessage = '';
    this.successMessage = '';

    if (this.profileForm.invalid) {
      this.errorMessage = 'Preencha nome, usuário e email.';
      return;
    }

    const formValue = this.profileForm.getRawValue();
    const onboardingSetup = {
      ...(this.onboardingSetup ?? {}),
      answers: {
        ...this.getOnboardingAnswers(this.onboardingSetup),
        currencyCode: formValue.currencyCode,
      },
      profileAvatar: formValue.profileAvatar,
    };

    this.isSaving = true;
    forkJoin({
      profile: this.auth.updateProfile({
        name: formValue.name.trim(),
        username: formValue.username.trim(),
        email: formValue.email.trim(),
      }),
      onboarding: this.financeData.saveContractOnboardingSetup(onboardingSetup),
    })
      .pipe(finalize(() => (this.isSaving = false)))
      .subscribe({
        next: ({ profile, onboarding }) => {
          this.profile = profile.data.user;
          this.onboardingSetup = onboarding;
          this.currencySettings.setCurrency(formValue.currencyCode);
          this.successMessage = 'Conta salva.';
        },
        error: (error) => {
          this.errorMessage = error.error?.message ?? 'Não foi possível salvar a conta.';
        },
      });
  }

  protected changePassword(): void {
    this.passwordForm.markAllAsTouched();
    this.errorMessage = '';
    this.successMessage = '';

    const { currentPassword, newPassword, confirmPassword } = this.passwordForm.getRawValue();

    if (this.passwordForm.invalid || newPassword.length < 8) {
      this.errorMessage = 'A nova senha precisa ter pelo menos 8 caracteres.';
      return;
    }

    if (newPassword !== confirmPassword) {
      this.errorMessage = 'A confirmação da senha não confere.';
      return;
    }

    this.isSavingPassword = true;
    this.auth.changePassword({ currentPassword, newPassword })
      .pipe(finalize(() => (this.isSavingPassword = false)))
      .subscribe({
        next: () => {
          this.passwordForm.reset({ currentPassword: '', newPassword: '', confirmPassword: '' });
          this.successMessage = 'Senha atualizada.';
          this.loadProfile();
        },
        error: (error) => {
          this.errorMessage = error.error?.message ?? 'Não foi possível alterar a senha.';
        },
      });
  }

  protected logout(): void {
    this.auth.logout();
  }

  protected openAppReview(): void {
    window.open(this.appReviewUrl, '_blank', 'noopener,noreferrer');
  }

  protected openRecurringMovements(): void {
    void this.router.navigate(['/example/planning']);
  }

  protected startNewNotificationRule(): void {
    this.resetNotificationForm();
    this.showNotificationForm = true;
  }

  protected closeNotificationForm(): void {
    this.resetNotificationForm();
    this.showNotificationForm = false;
  }

  protected saveNotificationRule(): void {
    this.notificationForm.markAllAsTouched();
    this.errorMessage = '';
    this.successMessage = '';

    if (this.notificationForm.invalid) {
      this.errorMessage = 'Preencha os campos da notificação.';
      return;
    }

    const formValue = this.notificationForm.getRawValue();
    const rule: NotificationRule = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: formValue.type,
      enabled: true,
    };

    if (formValue.type === 'movement-due') {
      rule.direction = formValue.direction;
      rule.leadMinutes = formValue.leadMinutes;
    } else if (formValue.type === 'credit-confirmation') {
      rule.delayMinutes = formValue.delayMinutes;
    } else if (formValue.type === 'category-limit') {
      if (!formValue.ledgerAccountId || !formValue.limitValue) {
        this.errorMessage = 'Escolha a categoria e o limite.';
        return;
      }
      rule.ledgerAccountId = formValue.ledgerAccountId;
      rule.limitValue = formValue.limitValue;
      rule.thresholdPercent = formValue.thresholdPercent;
    } else if (formValue.type === 'account-limit') {
      if (!formValue.movimentAccountId || !formValue.limitValue) {
        this.errorMessage = 'Escolha a conta e o limite.';
        return;
      }
      rule.movimentAccountId = formValue.movimentAccountId;
      rule.limitValue = formValue.limitValue;
      rule.thresholdPercent = formValue.thresholdPercent;
    } else {
      rule.intervalHours = formValue.intervalHours;
    }

    this.saveNotificationRules([...this.notificationRules, rule], 'Notificação adicionada.', () => {
      this.closeNotificationForm();
    });
  }

  protected toggleNotificationRule(rule: NotificationRule): void {
    const rules = this.notificationRules.map((item) => {
      return item.id === rule.id ? { ...item, enabled: !item.enabled } : item;
    });

    this.saveNotificationRules(rules, 'Notificação atualizada.', () => undefined);
  }

  protected deleteNotificationRule(rule: NotificationRule): void {
    if (!window.confirm(`Excluir a notificação "${this.getNotificationRuleTypeLabel(rule)}"?`)) {
      return;
    }

    this.saveNotificationRules(
      this.notificationRules.filter((item) => item.id !== rule.id),
      'Notificação excluída.',
      () => undefined,
    );
  }

  protected getNotificationRuleTypeLabel(rule: NotificationRule): string {
    return getRuleTypeLabel(rule.type);
  }

  protected getNotificationRuleSummary(rule: NotificationRule): string {
    return getRuleSummary(rule, this.accounts, this.ledgerAccounts);
  }

  protected resetNotificationForm(): void {
    this.notificationForm.reset({
      type: 'movement-due',
      direction: 'both',
      leadMinutes: 360,
      delayMinutes: 1440,
      ledgerAccountId: null,
      movimentAccountId: null,
      limitValue: null,
      thresholdPercent: 80,
      intervalHours: 12,
    });
  }

  protected closeAccountForm(): void {
    this.resetAccountForm();
    this.showAccountForm = false;
  }

  protected closeLedgerForm(): void {
    this.resetLedgerForm();
    this.showLedgerForm = false;
  }

  protected closeStatusForm(): void {
    this.resetStatusForm();
    this.showStatusForm = false;
  }

  @HostListener('document:click')
  protected closeFloatingMenus(): void {
    this.isNotificationMenuOpen = false;
  }

  private loadSettings(refreshEvent?: CustomEvent): void {
    this.loadedToken = this.auth.token;
    this.isLoading = true;
    this.errorMessage = '';

    forkJoin({
      profile: this.auth.getProfile(),
      onboarding: this.financeData.getContractOnboardingSetup(),
      settings: this.financeData.getFinanceSettings(),
      balances: this.financeData.getBalances(true),
    })
      .pipe(finalize(() => {
        this.isLoading = false;
        this.completeRefresh(refreshEvent);
      }))
      .subscribe({
        next: ({ profile, onboarding, settings, balances }) => {
          this.profile = profile.data.user;
          this.onboardingSetup = onboarding;
          this.patchProfileForms(profile.data.user, onboarding);
          this.accounts = settings.accounts;
          this.ledgerAccounts = settings.ledgerAccounts;
          this.statuses = settings.statuses;
          this.balanceRows = balances;
          this.notificationRules = getNotificationRules(onboarding);
          this.settingsNotifications = this.buildSettingsNotifications(balances, onboarding);
        },
        error: () => {
          this.errorMessage = 'Não foi possível carregar as configurações.';
        },
      });
  }

  private buildBackupExportPayload(
    profile: UserProfile,
    onboarding: ContractOnboardingSetup | null,
    settings: FinanceSettingsData,
    balances: BalanceRow[],
  ): BackupExportPayload {
    const contractId = profile.contractId ?? this.auth.user?.contractId ?? null;
    const userId = profile.id ?? this.auth.user?.userId ?? null;

    const tables: BackupExportTable[] = [];

    if (this.selectedBackupExportSections.account) {
      tables.push(
        {
          table: 'finance.contracts',
          rows: [{
            id: contractId,
            onboarding_setup: onboarding,
          }],
        },
        {
          table: 'finance.users',
          rows: [{
            id: userId,
            contract: contractId,
            contractId,
            username: profile.username,
            email: profile.email,
            name: profile.name,
            hasPassword: profile.hasPassword,
          }],
        },
      );
    }

    if (this.selectedBackupExportSections.auxiliary) {
      tables.push(
        {
          table: 'finance.moviment_accounts',
          rows: settings.accounts.map((account) => ({ ...account })),
        },
        {
          table: 'finance.ledger_accounts',
          rows: settings.ledgerAccounts.map((account) => ({ ...account })),
        },
        {
          table: 'finance.status',
          rows: settings.statuses.map((status) => ({ ...status })),
        },
      );
    }

    if (this.selectedBackupExportSections.movements) {
      tables.push({
        table: 'finance.moviments',
        rows: balances.map((row) => ({ ...row })),
      });
    }

    return {
      metadata: {
        exportedAt: new Date().toISOString(),
        formatVersion: 1,
        contractId,
        userId,
      },
      tables,
    };
  }

  private hasSelectedBackupExportSections(): boolean {
    return Object.values(this.selectedBackupExportSections).some(Boolean);
  }

  private backupPayloadToCsvFiles(payload: BackupExportPayload): BackupZipFile[] {
    return payload.tables.map((table) => {
      return {
        filename: `${table.table.replace(/\W+/g, '_')}.csv`,
        content: this.tableToCsv(table),
      };
    });
  }

  private tableToCsv(table: BackupExportTable): string {
    const columns = this.getCsvColumns(table);
    const csvRows = [
      columns,
      ...table.rows.map((row) => columns.map((column) => {
        const value = row[column];

        return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
      })),
    ];

    return csvRows
      .map((row) => row.map((value) => this.escapeCsvValue(value)).join(','))
      .join('\n');
  }

  private getCsvColumns(table: BackupExportTable): string[] {
    if (table.table === 'finance.moviments') {
      return [
      'id',
      'datetime',
      'description',
      'ledger_account_id',
      'ledger_account',
      'moviment_account_id',
      'moviment_account',
      'status_id',
      'status',
      'value',
      'balances',
      'credit_status',
      'credit_bill',
      'account_type',
      'planning',
      ];
    }

    const columns = new Set<string>();

    table.rows.forEach((row) => {
      Object.keys(row).forEach((key) => columns.add(key));
    });

    return [
      ...(['id', 'contract', 'contractId'].filter((column) => columns.delete(column))),
      ...Array.from(columns),
    ];
  }

  private createZipBlob(files: BackupZipFile[]): Blob {
    const encoder = new TextEncoder();
    const localFileParts: Uint8Array[] = [];
    const centralDirectoryParts: Uint8Array[] = [];
    let offset = 0;

    files.forEach((file) => {
      const nameBytes = encoder.encode(file.filename);
      const dataBytes = encoder.encode(file.content);
      const crc = this.getCrc32(dataBytes);
      const localHeader = this.createZipLocalHeader(nameBytes, dataBytes, crc);
      const centralDirectoryHeader = this.createZipCentralDirectoryHeader(nameBytes, dataBytes, crc, offset);

      localFileParts.push(localHeader, dataBytes);
      centralDirectoryParts.push(centralDirectoryHeader);
      offset += localHeader.length + dataBytes.length;
    });

    const centralDirectoryOffset = offset;
    const centralDirectorySize = centralDirectoryParts.reduce((total, part) => total + part.length, 0);
    const endRecord = this.createZipEndRecord(files.length, centralDirectorySize, centralDirectoryOffset);

    return new Blob([...localFileParts, ...centralDirectoryParts, endRecord], {
      type: 'application/zip',
    });
  }

  private createZipLocalHeader(nameBytes: Uint8Array, dataBytes: Uint8Array, crc: number): Uint8Array {
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);

    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, dataBytes.length, true);
    view.setUint32(22, dataBytes.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    header.set(nameBytes, 30);

    return header;
  }

  private createZipCentralDirectoryHeader(
    nameBytes: Uint8Array,
    dataBytes: Uint8Array,
    crc: number,
    offset: number,
  ): Uint8Array {
    const header = new Uint8Array(46 + nameBytes.length);
    const view = new DataView(header.buffer);

    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, dataBytes.length, true);
    view.setUint32(24, dataBytes.length, true);
    view.setUint16(28, nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, offset, true);
    header.set(nameBytes, 46);

    return header;
  }

  private createZipEndRecord(fileCount: number, centralDirectorySize: number, centralDirectoryOffset: number): Uint8Array {
    const record = new Uint8Array(22);
    const view = new DataView(record.buffer);

    view.setUint32(0, 0x06054b50, true);
    view.setUint16(4, 0, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, fileCount, true);
    view.setUint16(10, fileCount, true);
    view.setUint32(12, centralDirectorySize, true);
    view.setUint32(16, centralDirectoryOffset, true);
    view.setUint16(20, 0, true);

    return record;
  }

  private getCrc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;

    bytes.forEach((byte) => {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
    });

    return (crc ^ 0xffffffff) >>> 0;
  }

  private getBackupImportSummary(content: string, filename: string): string {
    const trimmedContent = content.trim();

    if (!trimmedContent) {
      throw new Error('empty backup file');
    }

    if (filename.toLowerCase().endsWith('.json') || trimmedContent.startsWith('{')) {
      const payload = JSON.parse(trimmedContent) as Partial<BackupExportPayload>;
      const tableCount = payload.tables?.length ?? 0;
      const rowCount = payload.tables?.reduce((total, table) => total + (table.rows?.length ?? 0), 0) ?? 0;

      return `${tableCount} tabelas e ${rowCount} registros encontrados`;
    }

    const lineCount = trimmedContent.split(/\r?\n/).filter(Boolean).length;
    const dataRows = Math.max(lineCount - 1, 0);

    return `${dataRows} registros CSV encontrados`;
  }

  private escapeCsvValue(value: unknown): string {
    const text = value === null || value === undefined ? '' : String(value);
    const escapedText = text.replace(/"/g, '""');

    return `"${escapedText}"`;
  }

  private async saveBackupFile(
    filename: string,
    mimeType: string,
    content: string,
  ): Promise<'shared' | 'downloaded'> {
    const blob = new Blob([content], { type: mimeType });
    return this.saveBackupBlob(filename, blob);
  }

  private async saveBackupBlob(filename: string, blob: Blob): Promise<'shared' | 'downloaded'> {
    if (Capacitor.isNativePlatform()) {
      await this.shareNativeBackupFile(filename, blob);
      return 'shared';
    }

    this.downloadBackupBlob(filename, blob);
    return 'downloaded';
  }

  private async shareNativeBackupFile(filename: string, blob: Blob): Promise<void> {
    const data = await this.blobToBase64(blob);
    const result = await Filesystem.writeFile({
      path: `backups/${filename}`,
      data,
      directory: Directory.Cache,
      recursive: true,
    });

    await Share.share({
      title: 'Backup Salarium',
      text: 'Backup exportado com IDs preservados.',
      files: [result.uri],
      dialogTitle: 'Salvar ou compartilhar backup',
    });
  }

  private downloadBackupBlob(filename: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onloadend = () => {
        const result = reader.result;

        if (typeof result !== 'string') {
          reject(new Error('invalid backup file content'));
          return;
        }

        resolve(result.split(',')[1] ?? '');
      };
      reader.onerror = () => reject(reader.error ?? new Error('backup file read failed'));
      reader.readAsDataURL(blob);
    });
  }

  private getBackupExportSuccessMessage(
    format: BackupExportFormat,
    target: 'shared' | 'downloaded',
  ): string {
    if (target === 'shared') {
      return format === 'json'
        ? 'Backup JSON pronto para salvar ou compartilhar.'
        : 'Backup CSV em ZIP pronto para salvar ou compartilhar.';
    }

    return format === 'json'
      ? 'Backup JSON exportado com IDs.'
      : 'Backup CSV exportado em ZIP com arquivos separados por tabela.';
  }

  private getBackupFileDate(): string {
    const now = new Date();
    const date = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('');
    const time = [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');

    return `${date}-${time}`;
  }

  private getMonthKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  private loadProfile(): void {
    this.isLoading = true;
    this.errorMessage = '';

    forkJoin({
      profile: this.auth.getProfile(),
      onboarding: this.financeData.getContractOnboardingSetup(),
    })
      .pipe(finalize(() => (this.isLoading = false)))
      .subscribe({
        next: ({ profile, onboarding }) => {
          this.profile = profile.data.user;
          this.onboardingSetup = onboarding;
          this.patchProfileForms(profile.data.user, onboarding);
        },
        error: () => {
          this.errorMessage = 'Não foi possível carregar os dados da conta.';
        },
      });
  }

  private patchProfileForms(profile: UserProfile, onboarding: ContractOnboardingSetup | null): void {
    const avatar = this.getProfileAvatarId(onboarding);

    this.profileForm.patchValue({
      name: profile.name || profile.username || '',
      username: profile.username || '',
      email: profile.email || '',
      profileAvatar: avatar,
      currencyCode: this.getOnboardingCurrencyCode(onboarding),
    });
    this.patchCreditBillForm(onboarding);
  }

  private patchCreditBillForm(onboarding: ContractOnboardingSetup | null): void {
    const settings = getCreditBillSettings(onboarding);

    this.creditBillForm.patchValue({
      enabled: settings.enabled,
      includeProvisioned: settings.includeProvisioned,
    });
  }

  private buildExpectedCreditBills(settings: CreditBillSettings): ExpectedCreditBill[] {
    return this.creditAccounts.reduce<ExpectedCreditBill[]>((bills, account) => {
      if (!account.debit_account || !account.pay_day) {
        return bills;
      }

      const referenceDate = new Date();
      const cycles = new Map<string, { closingDate: Date; dueDate: Date; rows: BalanceRow[] }>();

      this.balanceRows
        .filter((row) => {
          return row.account_type === 1 &&
            Number(row.moviment_account_id) === account.id &&
            Number(row.value) !== 0 &&
            !row.credit_bill;
        })
        .forEach((row) => {
          const rowDate = new Date(row.datetime);

          if (Number.isNaN(rowDate.getTime())) {
            return;
          }

          const cycle = this.getCreditBillCycle(account, rowDate);

          if (!this.shouldIncludeCreditBillRowStatus(row.status, settings.includeProvisioned, account, cycle.closingDate, referenceDate)) {
            return;
          }

          const cycleKey = this.getDateMonthKey(cycle.closingDate);
          const currentCycle = cycles.get(cycleKey) ?? {
            closingDate: cycle.closingDate,
            dueDate: cycle.dueDate,
            rows: [],
          };

          currentCycle.rows.push(row);
          cycles.set(cycleKey, currentCycle);
        });

      bills.push(...Array.from(cycles.entries()).map(([cycleKey, cycle]) => {
        const cycleTotal = cycle.rows.reduce((total, row) => total + (Number(row.value) || 0), 0);
        const value = cycleTotal < 0 ? Math.abs(cycleTotal) : 0;

        return {
          account_id: account.id,
          account_description: account.description,
          cycle_key: cycleKey,
          due_datetime: cycle.dueDate.toISOString(),
          value,
          movement_count: cycle.rows.length,
        };
      }).filter((bill) => bill.value > 0));

      return bills;
    }, []);
  }

  private getProvisionedAutomaticCreditBillRows(): BalanceRow[] {
    return this.balanceRows.filter((row) => {
      return this.isProvisionedAutomaticCreditBillRow(row);
    });
  }

  private isProvisionedAutomaticCreditBillRow(row: BalanceRow): boolean {
    if (this.isSettledStatusName(row.status)) {
      return false;
    }

    return !!row.credit_bill || this.normalizeCreditBillDescription(row.description).startsWith('fatura ');
  }

  private enforceGeneratedCreditBills(expectedBills: ExpectedCreditBill[]): void {
    forkJoin({
      balances: this.financeData.getBalances(true),
      settings: this.financeData.getFinanceSettings(),
    }).subscribe({
      next: ({ balances, settings }) => {
        const expectedBillKeys = new Set(expectedBills.map((bill) => this.getExpectedBillKey(bill)));
        const staleBills = balances.filter((row) => {
          if (!this.isProvisionedAutomaticCreditBillRow(row)) {
            return false;
          }

          return !expectedBillKeys.has(this.getExistingBillKey(row));
        });
        const edits = expectedBills
          .map((bill) => {
            const account = settings.accounts.find((item) => item.id === bill.account_id && item.account_type === 1);
            const dueDate = new Date(bill.due_datetime);

            if (!account?.debit_account || Number.isNaN(dueDate.getTime())) {
              return null;
            }

            const billRow = this.findCreditBillRow(balances, account, dueDate);
            const expectedValue = -Math.abs(Number(bill.value) || 0);

            if (!billRow || this.isSettledStatusName(billRow.status) || Math.abs((Number(billRow.value) || 0) - expectedValue) < 0.01) {
              return null;
            }

            return { row: billRow, value: expectedValue };
          })
          .filter((item): item is { row: BalanceRow; value: number } => !!item);

        const deleteStaleBills$ = staleBills.length > 0
          ? forkJoin(staleBills.map((row) => this.financeData.deleteMoviment(row.id)))
          : null;

        const runEdits = () => {
          if (edits.length === 0) {
            this.successMessage = staleBills.length > 0
              ? 'Faturas antigas removidas e faturas de cartão verificadas.'
              : 'Faturas de cartão verificadas.';
            this.reloadSettingsAfterCreditBillReconcile();
            return;
          }

          forkJoin(edits.map(({ row, value }) => this.financeData.saveMoviment('edit', {
            datetime: row.datetime,
            description: row.description,
            ledger_account: row.ledger_account_id,
            moviment_account: row.moviment_account_id,
            status: row.status_id,
            value,
          }, row))).subscribe({
            next: () => {
              this.successMessage = 'Faturas de cartão geradas e atualizadas.';
              this.reloadSettingsAfterCreditBillReconcile();
            },
            error: () => {
              this.errorMessage = 'As faturas foram geradas, mas não foi possível ajustar todos os valores.';
              this.reloadSettingsAfterCreditBillReconcile();
            },
          });
        };

        if (deleteStaleBills$) {
          deleteStaleBills$.subscribe({
            next: () => runEdits(),
            error: () => {
              this.errorMessage = 'Não foi possível excluir faturas antigas.';
              this.reloadSettingsAfterCreditBillReconcile();
            },
          });
          return;
        }

        runEdits();
      },
      error: () => {
        this.errorMessage = 'Não foi possível validar as faturas geradas.';
      },
    });
  }

  private reloadSettingsAfterCreditBillReconcile(): void {
    this.financeData.getBalances(true).subscribe({
      next: (rows) => {
        this.balanceRows = rows;
        this.loadSettings();
      },
      error: () => this.loadSettings(),
    });
  }

  private getExpectedBillKey(bill: ExpectedCreditBill): string {
    const dueDate = new Date(bill.due_datetime);

    return Number.isNaN(dueDate.getTime()) ? '' : this.getBillDueDateKey(dueDate);
  }

  private getExistingBillKey(row: BalanceRow): string {
    const dueDate = new Date(row.datetime);

    return Number.isNaN(dueDate.getTime()) ? '' : this.getBillDueDateKey(dueDate);
  }

  private getBillDueDateKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private getProfileAvatarId(onboarding: ContractOnboardingSetup | null): string {
    const value = onboarding && typeof onboarding === 'object' && 'profileAvatar' in onboarding
      ? String((onboarding as ContractOnboardingSetup & { profileAvatar?: unknown }).profileAvatar ?? '')
      : '';

    return this.profileAvatarOptions.some((option) => option.id === value) ? value : this.profileAvatarOptions[0].id;
  }

  private getOnboardingCurrencyCode(onboarding: ContractOnboardingSetup | null): AppCurrencyCode {
    const value = String(this.getOnboardingAnswers(onboarding)['currencyCode'] ?? '');
    return this.currencyOptions.some((option) => option.code === value) ? value : this.currencySettings.currencyCode;
  }

  private getOnboardingAnswers(onboarding: ContractOnboardingSetup | null): Record<string, unknown> {
    const answers = onboarding?.answers;
    return answers && typeof answers === 'object' && !Array.isArray(answers)
      ? answers as Record<string, unknown>
      : {};
  }

  private getCreditBillCycle(account: MovimentAccountSettings, movementDate: Date): { closingDate: Date; dueDate: Date } {
    const closingDate = this.getCurrentOrNextCreditClosingDate(account, movementDate);
    const dueMonthDate = new Date(closingDate.getFullYear(), closingDate.getMonth() + 1, 1);
    const dueDay = Math.min(
      Math.max(account.pay_day ?? 1, 1),
      new Date(dueMonthDate.getFullYear(), dueMonthDate.getMonth() + 1, 0).getDate(),
    );

    return {
      closingDate,
      dueDate: new Date(dueMonthDate.getFullYear(), dueMonthDate.getMonth(), dueDay, 12, 0, 0, 0),
    };
  }

  private getCurrentOrNextCreditClosingDate(account: MovimentAccountSettings, referenceDate: Date): Date {
    const currentClosingDate = new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth(),
      this.getSafeClosingDay(account, referenceDate),
      0,
      0,
      0,
      0,
    );

    if (referenceDate.getTime() < currentClosingDate.getTime()) {
      return currentClosingDate;
    }

    const nextMonthReference = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 1);

    return new Date(
      nextMonthReference.getFullYear(),
      nextMonthReference.getMonth(),
      this.getSafeClosingDay(account, nextMonthReference),
      0,
      0,
      0,
      0,
    );
  }

  private findCreditBillRow(
    rows: BalanceRow[],
    account: MovimentAccountSettings,
    dueDate: Date,
  ): BalanceRow | undefined {
    const expectedDescription = this.normalizeCreditBillDescription(
      `Fatura ${account.description} mes ${new Intl.DateTimeFormat('pt-PT', { month: 'long' }).format(dueDate)} ${dueDate.getFullYear()}`,
    );

    return rows.find((row) => {
      if (Number(row.moviment_account_id) !== account.debit_account) {
        return false;
      }

      const rowDate = new Date(row.datetime);
      const hasSameDueDate = rowDate.getFullYear() === dueDate.getFullYear()
        && rowDate.getMonth() === dueDate.getMonth()
        && rowDate.getDate() === dueDate.getDate();

      return hasSameDueDate && (
        !!row.credit_bill ||
        this.normalizeCreditBillDescription(row.description) === expectedDescription
      );
    });
  }

  private getSafeClosingDay(account: MovimentAccountSettings, referenceDate: Date): number {
    const lastDayOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate();
    const closingDay = account.closing_day ?? lastDayOfMonth;

    return Math.min(Math.max(closingDay, 1), lastDayOfMonth);
  }

  private getDateMonthKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  private shouldIncludeCreditBillRowStatus(
    status: string | null | undefined,
    includeProvisioned: boolean,
    account: MovimentAccountSettings,
    cycleClosingDate: Date,
    referenceDate: Date,
  ): boolean {
    if (this.isSettledStatusName(status)) {
      return true;
    }

    if (!includeProvisioned || !this.isPendingStatusName(status)) {
      return false;
    }

    return cycleClosingDate.getTime() > this.getCurrentOrNextCreditClosingDate(account, referenceDate).getTime();
  }

  private isSettledStatusName(status: string | null | undefined): boolean {
    return !this.isPendingStatusName(status);
  }

  private isPendingStatusName(status: string | null | undefined): boolean {
    const normalizedStatus = this.normalizeStatusName(status);

    return normalizedStatus.includes('provision') ||
      normalizedStatus.includes('pagar') ||
      normalizedStatus.includes('receber') ||
      normalizedStatus.includes('pending');
  }

  private normalizeCreditBillDescription(description: string): string {
    return description
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('pt-BR');
  }

  private completeRefresh(event?: CustomEvent): void {
    const refresher = event?.target as unknown as { complete?: () => Promise<void> | void };
    void refresher?.complete?.();
  }

  private saveSettingsRequest(message: string, request: Observable<unknown>, afterSave: () => void): void {
    this.isSaving = true;
    this.successMessage = '';

    request
      .pipe(finalize(() => (this.isSaving = false)))
      .subscribe({
        next: () => {
          this.successMessage = message;
          afterSave();
          this.loadSettings();
        },
        error: () => {
          this.errorMessage = 'Não foi possível salvar as configurações.';
        },
      });
  }

  private saveNotificationRules(rules: NotificationRule[], message: string, afterSave: () => void): void {
    const onboardingSetup = setNotificationRules(this.onboardingSetup, rules);

    this.isSaving = true;
    this.financeData.saveContractOnboardingSetup(onboardingSetup)
      .pipe(finalize(() => (this.isSaving = false)))
      .subscribe({
        next: (savedSetup) => {
          this.onboardingSetup = savedSetup;
          this.notificationRules = getNotificationRules(savedSetup);
          this.settingsNotifications = this.buildSettingsNotifications(this.balanceRows, savedSetup);
          this.successMessage = message;
          afterSave();
        },
        error: () => {
          this.errorMessage = 'Não foi possível salvar as notificações.';
        },
      });
  }

  private buildSettingsNotifications(rows: BalanceRow[], onboardingSetup: ContractOnboardingSetup | null): AppNotification[] {
    const readIds = this.getStoredIdSet(this.notificationReadStorageKey);

    return evaluateNotifications({
      rows,
      accounts: this.accounts,
      ledgerAccounts: this.ledgerAccounts,
      onboardingSetup,
      readIds,
      now: new Date(),
    });
  }

  private publishSystemNotification(notificationData: AppNotification): void {
    if (!this.canUseSystemNotifications()) {
      return;
    }

    const notification = new Notification(notificationData.title, {
      body: notificationData.message,
      tag: notificationData.id,
    });

    notification.onclick = () => {
      window.focus();
      if (notificationData.movement) {
        this.openEditMoviment(notificationData.movement);
      }
    };
  }

  private canUseSystemNotifications(): boolean {
    return 'Notification' in window && Notification.permission === 'granted';
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

  private getSettledStatusOption(): StatusSettings | undefined {
    return this.statuses.find((status) => this.normalizeStatusName(status.description) === 'consumado')
      ?? this.statuses.find((status) => !this.isPendingStatus(status));
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

  private normalizeDescription(description: string | null | undefined): string {
    return (description ?? '').trim().toLocaleLowerCase();
  }

  private toOption(id: number, name: string, icon?: string | null) {
    return { id, name, icon };
  }

  private normalizeIcon(icon: string | null | undefined, fallbackIcon: string): string {
    const normalizedIcon = (icon ?? '').trim();
    return this.iconOptions.some((option) => option.name === normalizedIcon) ? normalizedIcon : fallbackIcon;
  }

  private buildMovimentNavigationState(row: BalanceRow) {
    return {
      mode: 'edit',
      moviment: row,
      ledgerAccounts: this.ledgerAccounts.map((account) => this.toOption(account.id, account.description, account.icon)),
      movimentAccounts: this.accounts.map((account) => this.toOption(account.id, account.description, account.icon)),
      statuses: this.statuses.map((status) => this.toOption(status.id, status.description, status.icon)),
    };
  }

  private openEditMoviment(row: BalanceRow): void {
    const navigationState = this.buildMovimentNavigationState(row);

    sessionStorage.setItem(this.selectedMovimentStorageKey, JSON.stringify(navigationState));
    void this.router.navigate(['/example/new'], {
      queryParams: { mode: 'edit' },
      state: navigationState,
    });
  }

  private markNotificationAsRead(id: string): void {
    const readIds = this.getStoredIdSet(this.notificationReadStorageKey);

    readIds.add(id);
    this.storeIdSet(this.notificationReadStorageKey, readIds);
    this.settingsNotifications = this.settingsNotifications.filter((notification) => notification.id !== id);
  }

  private hasDuplicateAccountDescription(description: string): boolean {
    const normalizedDescription = this.normalizeDescription(description);

    return this.accounts.some((account) => {
      return account.id !== this.accountEditId &&
        this.normalizeDescription(account.description) === normalizedDescription;
    });
  }

  private toDateInputValue(value: string | null): string {
    if (!value) {
      return '';
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }
}
