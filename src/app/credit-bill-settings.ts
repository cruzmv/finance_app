import { ContractOnboardingSetup } from './finance-data.service';

export interface CreditBillSettings {
  enabled: boolean;
  includeProvisioned: boolean;
}

export const defaultCreditBillSettings: CreditBillSettings = {
  enabled: true,
  includeProvisioned: false,
};

export function getCreditBillSettings(onboardingSetup: ContractOnboardingSetup | null): CreditBillSettings {
  const settings = onboardingSetup?.['creditBillSettings'];

  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { ...defaultCreditBillSettings };
  }

  const value = settings as Partial<CreditBillSettings>;

  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : defaultCreditBillSettings.enabled,
    includeProvisioned: typeof value.includeProvisioned === 'boolean'
      ? value.includeProvisioned
      : defaultCreditBillSettings.includeProvisioned,
  };
}

export function setCreditBillSettings(
  onboardingSetup: ContractOnboardingSetup | null,
  settings: CreditBillSettings,
): ContractOnboardingSetup {
  return {
    ...(onboardingSetup ?? {}),
    creditBillSettings: {
      enabled: settings.enabled,
      includeProvisioned: settings.enabled && settings.includeProvisioned,
    },
  };
}
