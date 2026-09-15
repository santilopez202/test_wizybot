import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface CurrencyConversionResult {
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  convertedAmount: number;
  rate: number;
}

interface RatesCache {
  rates: Record<string, number>;
  fetchedAt: number;
}

const OPEN_EXCHANGE_RATES_URL = 'https://openexchangerates.org/api/latest.json';
const CACHE_TTL_MS = 60 * 60 * 1000; // Exchange rates on the free plan update hourly.

/**
 * Converts amounts between currencies using live exchange rates from the
 * Open Exchange Rates API. The free plan always returns rates based on USD,
 * so any pair is converted through USD as a common base.
 */
@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);
  private readonly appId: string;
  private ratesCache: RatesCache | null = null;

  constructor(private readonly configService: ConfigService) {
    this.appId = this.configService.get<string>('OPEN_EXCHANGE_RATES_APP_ID') ?? '';
  }

  async convertCurrency(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
  ): Promise<CurrencyConversionResult> {
    if (!Number.isFinite(amount)) {
      throw new BadRequestException('Amount must be a valid number.');
    }

    const from = fromCurrency.trim().toUpperCase();
    const to = toCurrency.trim().toUpperCase();
    const rates = await this.getLatestRates();

    if (!rates[from] || !rates[to]) {
      throw new BadRequestException(`Unsupported currency code: ${!rates[from] ? from : to}`);
    }

    const amountInUsd = amount / rates[from];
    const convertedAmount = amountInUsd * rates[to];

    return {
      amount,
      fromCurrency: from,
      toCurrency: to,
      convertedAmount: Math.round(convertedAmount * 100) / 100,
      rate: Math.round((rates[to] / rates[from]) * 1e6) / 1e6,
    };
  }

  private async getLatestRates(): Promise<Record<string, number>> {
    if (this.ratesCache && Date.now() - this.ratesCache.fetchedAt < CACHE_TTL_MS) {
      return this.ratesCache.rates;
    }

    if (!this.appId) {
      throw new Error('OPEN_EXCHANGE_RATES_APP_ID is not configured.');
    }

    const response = await axios.get(OPEN_EXCHANGE_RATES_URL, {
      params: { app_id: this.appId },
    });

    const rates = response.data.rates as Record<string, number>;
    // The base currency (USD) has an implicit rate of 1 but isn't always listed explicitly.
    rates.USD = rates.USD ?? 1;

    this.ratesCache = { rates, fetchedAt: Date.now() };
    this.logger.log('Fetched latest exchange rates from Open Exchange Rates.');
    return rates;
  }
}
