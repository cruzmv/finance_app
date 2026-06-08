import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  IonContent,
  IonIcon,
  IonRefresher,
  IonRefresherContent,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, createOutline, logOutOutline, saveOutline, trashOutline } from 'ionicons/icons';
import { Observable, finalize } from 'rxjs';
import {
  FinanceDataService,
  LedgerAccountSettings,
  MovimentAccountSettings,
  StatusSettings,
} from '../finance-data.service';
import { AuthService } from '../auth.service';

type SettingsTab = 'accounts' | 'ledger' | 'status';

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

  protected readonly accountForm = this.fb.nonNullable.group({
    description: ['', Validators.required],
    startDate: [''],
    startValue: this.fb.control<number | null>(null),
    closingDay: this.fb.control<number | null>(null, [Validators.min(1), Validators.max(31)]),
    accountType: this.fb.nonNullable.control<0 | 1>(0, Validators.required),
  });

  protected readonly ledgerForm = this.fb.nonNullable.group({
    description: ['', Validators.required],
  });

  protected readonly statusForm = this.fb.nonNullable.group({
    description: ['', Validators.required],
  });

  constructor() {
    addIcons({ closeOutline, createOutline, logOutOutline, saveOutline, trashOutline });
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
    this.errorMessage = '';
    this.successMessage = '';
  }

  protected saveAccount(): void {
    this.accountForm.markAllAsTouched();
    this.errorMessage = '';

    if (this.accountForm.invalid) {
      this.errorMessage = 'Please fill the required account fields.';
      return;
    }

    const formValue = this.accountForm.getRawValue();
    const description = formValue.description.trim();

    if (!description) {
      this.errorMessage = 'Please fill the required account fields.';
      return;
    }

    if (this.hasDuplicateAccountDescription(description)) {
      this.accountForm.controls.description.setErrors({ duplicate: true });
      this.errorMessage = 'Account descriptions must be unique.';
      return;
    }

    const payload = {
      description,
      start_date: formValue.startDate || null,
      start_value: formValue.startValue,
      closing_day: formValue.closingDay,
      account_type: formValue.accountType,
    };

    this.saveSettingsRequest(
      'Account saved.',
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
      startDate: this.toDateInputValue(account.start_date),
      startValue: account.start_value === null ? null : Number(account.start_value),
      closingDay: account.closing_day,
      accountType: account.account_type,
    });
  }

  protected deleteAccount(account: MovimentAccountSettings): void {
    if (!window.confirm(`Delete account "${account.description}"?`)) {
      return;
    }

    this.saveSettingsRequest(
      'Account deleted.',
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
      startDate: '',
      startValue: null,
      closingDay: null,
      accountType: 0,
    });
  }

  protected saveLedgerAccount(): void {
    this.ledgerForm.markAllAsTouched();
    this.errorMessage = '';

    if (this.ledgerForm.invalid) {
      this.errorMessage = 'Please fill the ledger account description.';
      return;
    }

    const payload = {
      description: this.ledgerForm.controls.description.value.trim(),
    };

    this.saveSettingsRequest(
      'Ledger account saved.',
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
    this.ledgerForm.patchValue({ description: account.description ?? '' });
  }

  protected deleteLedgerAccount(account: LedgerAccountSettings): void {
    if (!window.confirm(`Delete ledger account "${account.description}"?`)) {
      return;
    }

    this.saveSettingsRequest(
      'Ledger account deleted.',
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
    this.ledgerForm.reset({ description: '' });
  }

  protected saveStatus(): void {
    this.statusForm.markAllAsTouched();
    this.errorMessage = '';

    if (this.statusForm.invalid) {
      this.errorMessage = 'Please fill the status description.';
      return;
    }

    const payload = {
      description: this.statusForm.controls.description.value.trim(),
    };

    this.saveSettingsRequest(
      'Status saved.',
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
    this.statusForm.patchValue({ description: status.description ?? '' });
  }

  protected deleteStatus(status: StatusSettings): void {
    if (!window.confirm(`Delete status "${status.description}"?`)) {
      return;
    }

    this.saveSettingsRequest(
      'Status deleted.',
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
    this.statusForm.reset({ description: '' });
  }

  protected getAccountTypeLabel(accountType: number | null): string {
    return accountType === 1 ? 'Credit' : 'Debit';
  }

  protected refreshSettings(event: CustomEvent): void {
    this.loadSettings(event);
  }

  protected logout(): void {
    this.auth.logout();
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
          this.errorMessage = 'Unable to load settings.';
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
          this.errorMessage = 'Unable to save settings.';
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

  private toDateInputValue(value: string | null): string {
    if (!value) {
      return '';
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }
}
