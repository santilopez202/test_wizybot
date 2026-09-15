import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { OPENAI_CLIENT } from '../openai/openai.module';
import { ProductsService } from '../products/products.service';
import { CurrencyService } from '../currency/currency.service';

const MAX_TOOL_CALL_ITERATIONS = 5;

const SYSTEM_PROMPT =
  'You are Wizybot, a helpful AI customer support and sales assistant for an online store. ' +
  'Use the searchProducts tool whenever the customer asks about products or is looking for something to buy. ' +
  'Use the convertCurrencies tool whenever the customer asks about a price in a different currency. ' +
  'Base your answers only on the information returned by the tools, keep responses concise, and reply in the ' +
  "same language as the customer's message.";

const TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'searchProducts',
      description:
        "Search the store's product catalog for items related to the customer's request. " +
        'Returns up to 2 relevant products with their title, price and URL.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'A short description of what the customer is looking for, e.g. "phone" or "gift for dad".',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'convertCurrencies',
      description: 'Convert an amount of money from one currency to another using up-to-date exchange rates.',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'The numeric amount to convert.' },
          fromCurrency: { type: 'string', description: 'The ISO 4217 currency code to convert from, e.g. "USD".' },
          toCurrency: { type: 'string', description: 'The ISO 4217 currency code to convert to, e.g. "EUR".' },
        },
        required: ['amount', 'fromCurrency', 'toCurrency'],
      },
    },
  },
];

/**
 * Orchestrates the OpenAI Chat Completion function-calling loop:
 * ask the model what to do, execute any requested tool(s) locally,
 * feed the results back, and repeat until the model returns a final answer.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly model: string;

  constructor(
    @Inject(OPENAI_CLIENT) private readonly openai: OpenAI,
    private readonly configService: ConfigService,
    private readonly productsService: ProductsService,
    private readonly currencyService: CurrencyService,
  ) {
    this.model = this.configService.get<string>('OPENAI_MODEL') ?? 'gpt-4o-mini';
  }

  async getResponse(userMessage: string): Promise<string> {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ];

    for (let iteration = 0; iteration < MAX_TOOL_CALL_ITERATIONS; iteration++) {
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages,
        tools: TOOLS,
      });

      const responseMessage = completion.choices[0].message;
      messages.push(responseMessage);

      if (!responseMessage.tool_calls || responseMessage.tool_calls.length === 0) {
        return responseMessage.content ?? '';
      }

      for (const toolCall of responseMessage.tool_calls) {
        const result = await this.executeTool(toolCall.function.name, toolCall.function.arguments);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }

    this.logger.warn('Reached the maximum number of tool call iterations without a final answer.');
    return "I'm sorry, I couldn't process your request right now. Please try rephrasing it.";
  }

  private async executeTool(name: string, rawArguments: string): Promise<unknown> {
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(rawArguments);
    } catch {
      return { error: 'Invalid arguments received from the model.' };
    }

    switch (name) {
      case 'searchProducts':
        return this.productsService.searchProducts(String(args.query ?? ''));

      case 'convertCurrencies':
        try {
          return await this.currencyService.convertCurrency(
            Number(args.amount),
            String(args.fromCurrency ?? ''),
            String(args.toCurrency ?? ''),
          );
        } catch (error) {
          return { error: (error as Error).message };
        }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }
}
