import { Injectable } from '@angular/core';

export type AppCurrencyCode = string;

export interface AppCurrencyOption {
  code: AppCurrencyCode;
  label: string;
  symbol: string;
  locale: string;
}

const fallbackCurrencyOptions: AppCurrencyOption[] = [
  { code: 'EUR', label: 'Euro', symbol: '€', locale: 'pt-PT' },
  { code: 'BRL', label: 'Real brasileiro', symbol: 'R$', locale: 'pt-BR' },
  { code: 'USD', label: 'Dólar americano', symbol: '$', locale: 'en-US' },
  { code: 'GBP', label: 'Libra esterlina', symbol: '£', locale: 'en-GB' },
];

const preferredCurrencyCodes = ['EUR', 'BRL', 'USD', 'GBP'];

function getRuntimeCurrencyCodes(): string[] {
  const supportedValuesOf = (Intl as unknown as {
    supportedValuesOf?: (key: string) => string[];
  }).supportedValuesOf;

  try {
    return supportedValuesOf?.('currency') ?? fallbackCurrencyOptions.map((option) => option.code);
  } catch {
    return fallbackCurrencyOptions.map((option) => option.code);
  }
}

function getCurrencyLabel(code: string, locale: string): string {
  const displayNames = (Intl as unknown as {
    DisplayNames?: new (locales: string[], options: { type: 'currency' }) => { of: (code: string) => string | undefined };
  }).DisplayNames;

  try {
    return displayNames ? new displayNames([locale], { type: 'currency' }).of(code) ?? code : code;
  } catch {
    return fallbackCurrencyOptions.find((option) => option.code === code)?.label ?? code;
  }
}

function getCurrencySymbol(code: string, locale: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'symbol',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).formatToParts(0);

    return parts.find((part) => part.type === 'currency')?.value ?? code;
  } catch {
    return fallbackCurrencyOptions.find((option) => option.code === code)?.symbol ?? code;
  }
}

function buildCurrencyOptions(): AppCurrencyOption[] {
  const locale = navigator.language || 'pt-PT';
  const options = getRuntimeCurrencyCodes().map((code) => ({
    code,
    label: getCurrencyLabel(code, locale),
    symbol: getCurrencySymbol(code, locale),
    locale,
  }));
  const byCode = new Map(options.map((option) => [option.code, option]));
  fallbackCurrencyOptions.forEach((option) => byCode.set(option.code, { ...option, ...byCode.get(option.code) }));

  return [...byCode.values()].sort((left, right) => {
    const leftPreferredIndex = preferredCurrencyCodes.indexOf(left.code);
    const rightPreferredIndex = preferredCurrencyCodes.indexOf(right.code);

    if (leftPreferredIndex !== -1 || rightPreferredIndex !== -1) {
      return (leftPreferredIndex === -1 ? 99 : leftPreferredIndex) - (rightPreferredIndex === -1 ? 99 : rightPreferredIndex);
    }

    return left.label.localeCompare(right.label, locale);
  });
}

export const appCurrencyOptions: AppCurrencyOption[] = buildCurrencyOptions();

@Injectable({ providedIn: 'root' })
export class CurrencySettingsService {
  private readonly storageKey = 'financeCurrencyCode';

  get currencyCode(): AppCurrencyCode {
    const stored = localStorage.getItem(this.storageKey) as AppCurrencyCode | null;
    if (stored && appCurrencyOptions.some((option) => option.code === stored)) {
      return stored;
    }

    return 'EUR';
  }

  get option(): AppCurrencyOption {
    return appCurrencyOptions.find((option) => option.code === this.currencyCode) ?? appCurrencyOptions[0];
  }

  setCurrency(code: AppCurrencyCode): void {
    if (appCurrencyOptions.some((option) => option.code === code)) {
      localStorage.setItem(this.storageKey, code);
    }
  }

  format(value: number | string | null | undefined): string {
    const option = this.option;
    return new Intl.NumberFormat(option.locale, {
      style: 'currency',
      currency: option.code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value) || 0);
  }

  parse(value: string): number | null {
    const normalized = value
      .replace(/[^\d,.-]/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.');
    const parsed = Number(normalized);

    return Number.isFinite(parsed) ? parsed : null;
  }
}
