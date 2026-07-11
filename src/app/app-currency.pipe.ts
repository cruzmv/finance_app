import { Pipe, PipeTransform, inject } from '@angular/core';
import { CurrencySettingsService } from './currency-settings.service';

@Pipe({
  name: 'appCurrency',
  standalone: true,
  pure: false,
})
export class AppCurrencyPipe implements PipeTransform {
  private readonly currencySettings = inject(CurrencySettingsService);

  transform(value: number | string | null | undefined): string {
    return this.currencySettings.format(value);
  }
}
