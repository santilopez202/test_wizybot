import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export const OPENAI_CLIENT = 'OPENAI_CLIENT';

/**
 * Global module that provides a single shared OpenAI client instance,
 * used both for chat completions (function calling) and for product
 * search embeddings.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: OPENAI_CLIENT,
      useFactory: (configService: ConfigService) =>
        new OpenAI({ apiKey: configService.get<string>('OPENAI_API_KEY') }),
      inject: [ConfigService],
    },
  ],
  exports: [OPENAI_CLIENT],
})
export class OpenAiModule {}
