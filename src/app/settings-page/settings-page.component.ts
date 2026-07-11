import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
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
  businessOutline,
  carOutline,
  cardOutline,
  cartOutline,
  cashOutline,
  chevronDownOutline,
  chevronForwardOutline,
  checkmarkCircleOutline,
  closeOutline,
  createOutline,
  gameControllerOutline,
  homeOutline,
  logOutOutline,
  medkitOutline,
  repeatOutline,
  restaurantOutline,
  receiptOutline,
  saveOutline,
  schoolOutline,
  timeOutline,
  trendingDownOutline,
  trendingUpOutline,
  trashOutline,
  walletOutline,
} from 'ionicons/icons';
import { Observable, finalize } from 'rxjs';
import {
  FinanceDataService,
  LedgerAccountSettings,
  MovimentAccountSettings,
  StatusSettings,
} from '../finance-data.service';
import { AuthService } from '../auth.service';

type SettingsTab = 'accounts' | 'ledger' | 'status';
type IconPickerTarget = 'account' | 'ledger' | 'status';

interface IconOption {
  name: string;
  label: string;
}

@Component({
  selector: 'app-settings-page',
  templateUrl: './settings-page.component.html',
  styleUrls: ['./settings-page.component.scss'],
  imports: [CommonModule, IonContent, IonIcon, IonRefresher, IonRefresherContent, ReactiveFormsModule],
})
export class SettingsPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly financeData = inject(FinanceDataService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private loadedToken = '';

  protected activeTab: SettingsTab = 'accounts';
  protected accounts: MovimentAccountSettings[] = [];
  protected ledgerAccounts: LedgerAccountSettings[] = [];
  protected statuses: StatusSettings[] = [];
  protected isLoading = false;
  protected isSaving = false;
  protected errorMessage = '';
  protected successMessage = '';
  protected contractJoinCode = '';
  protected accountEditId: number | null = null;
  protected ledgerEditId: number | null = null;
  protected statusEditId: number | null = null;
  protected activeIconPicker: IconPickerTarget | null = null;
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

  constructor() {
    addIcons({
      airplaneOutline,
      alertCircleOutline,
      businessOutline,
      carOutline,
      cardOutline,
      cartOutline,
      cashOutline,
      chevronDownOutline,
      chevronForwardOutline,
      checkmarkCircleOutline,
      closeOutline,
      createOutline,
      gameControllerOutline,
      homeOutline,
      logOutOutline,
      medkitOutline,
      repeatOutline,
      restaurantOutline,
      receiptOutline,
      saveOutline,
      schoolOutline,
      timeOutline,
      trendingDownOutline,
      trendingUpOutline,
      trashOutline,
      walletOutline,
    });
  }

  ngOnInit() {
    this.loadSettings();
    this.loadContractJoinCode();
  }

  ionViewWillEnter(): void {
    if (this.loadedToken !== this.auth.token) {
      this.loadSettings();
      this.loadContractJoinCode();
    }
  }

  protected setActiveTab(tab: SettingsTab): void {
    this.activeTab = tab;
    this.activeIconPicker = null;
    this.errorMessage = '';
    this.successMessage = '';
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
      () => this.resetAccountForm(),
    );
  }

  protected editAccount(account: MovimentAccountSettings): void {
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
      () => this.resetLedgerForm(),
    );
  }

  protected editLedgerAccount(account: LedgerAccountSettings): void {
    this.ledgerEditId = account.id;
    this.ledgerForm.patchValue({
      description: account.description ?? '',
      icon: this.normalizeIcon(account.icon, 'receipt-outline'),
    });
  }

  protected deleteLedgerAccount(account: LedgerAccountSettings): void {
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
      () => this.resetStatusForm(),
    );
  }

  protected editStatus(status: StatusSettings): void {
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

  protected logout(): void {
    this.auth.logout();
  }

  protected openRecurringMovements(): void {
    void this.router.navigate(['/example/planning']);
  }

  private loadSettings(refreshEvent?: CustomEvent): void {
    this.loadedToken = this.auth.token;
    this.isLoading = true;
    this.errorMessage = '';

    this.financeData
      .getFinanceSettings()
      .pipe(finalize(() => {
        this.isLoading = false;
        this.completeRefresh(refreshEvent);
      }))
      .subscribe({
        next: (settings) => {
          this.accounts = settings.accounts;
          this.ledgerAccounts = settings.ledgerAccounts;
          this.statuses = settings.statuses;
        },
        error: () => {
          this.errorMessage = 'Não foi possível carregar as configurações.';
        },
      });
  }

  private loadContractJoinCode(): void {
    this.auth.getContractJoinCode().subscribe({
      next: ({ data }) => {
        this.contractJoinCode = data.joinCode;
      },
    });
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

  private hasDuplicateAccountDescription(description: string): boolean {
    const normalizedDescription = this.normalizeDescription(description);

    return this.accounts.some((account) => {
      return (
        account.id !== this.accountEditId &&
        this.normalizeDescription(account.description) === normalizedDescription
      );
    });
  }

  private normalizeDescription(description: string | null | undefined): string {
    return (description ?? '').trim().toLocaleLowerCase();
  }

  private normalizeIcon(icon: string | null | undefined, fallbackIcon: string): string {
    const normalizedIcon = (icon ?? '').trim();
    return this.iconOptions.some((option) => option.name === normalizedIcon) ? normalizedIcon : fallbackIcon;
  }

  private toDateInputValue(value: string | null): string {
    if (!value) {
      return '';
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }
}
