import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import OpenAI from 'openai';
import { OPENAI_CLIENT } from '../openai/openai.module';
import { Product, ProductSearchResult } from './product.model';
import { cosineSimilarity } from './cosine-similarity.util';

const DEFAULT_RESULT_LIMIT = 2;
const EMBEDDING_BATCH_SIZE = 100;

interface EmbeddingsCache {
  hash: string;
  model: string;
  embeddings: number[][];
}

/**
 * Loads the product catalog from products_list.csv and answers search
 * queries. Primary strategy: semantic search using OpenAI embeddings over
 * the pre-built `embeddingText` column (cached to disk so it is only
 * computed once per catalog version). If embeddings cannot be computed
 * (e.g. no API key configured), it falls back to a keyword-overlap search
 * so the endpoint keeps working.
 */
@Injectable()
export class ProductsService implements OnModuleInit {
  private readonly logger = new Logger(ProductsService.name);
  private readonly csvPath = path.join(process.cwd(), 'data', 'products_list.csv');
  private readonly cachePath = path.join(process.cwd(), 'data', 'products_embeddings.cache.json');
  private readonly embeddingModel: string;

  private products: Product[] = [];
  private embeddings: number[][] = [];

  constructor(
    private readonly configService: ConfigService,
    @Inject(OPENAI_CLIENT) private readonly openai: OpenAI,
  ) {
    this.embeddingModel =
      this.configService.get<string>('OPENAI_EMBEDDING_MODEL') ?? 'text-embedding-3-small';
  }

  async onModuleInit(): Promise<void> {
    this.products = this.loadProductsFromCsv();
    await this.loadOrComputeEmbeddings();
  }

  async searchProducts(query: string, limit = DEFAULT_RESULT_LIMIT): Promise<ProductSearchResult[]> {
    if (this.embeddings.length === this.products.length && this.embeddings.length > 0) {
      try {
        return await this.searchBySemanticSimilarity(query, limit);
      } catch (error) {
        this.logger.warn(
          `Semantic search failed, falling back to keyword search: ${(error as Error).message}`,
        );
      }
    }
    return this.searchByKeywords(query, limit);
  }

  private loadProductsFromCsv(): Product[] {
    const raw = fs.readFileSync(this.csvPath, 'utf-8');
    // relax_quotes is required because some product titles contain unescaped double
    // quotes (e.g. `VAVSEA 8" Professional Chef's Knife`), which is not valid RFC 4180 CSV.
    return parse(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
    }) as Product[];
  }

  private async loadOrComputeEmbeddings(): Promise<void> {
    const contentHash = createHash('sha256').update(fs.readFileSync(this.csvPath)).digest('hex');
    const cached = this.readCache();

    if (
      cached &&
      cached.hash === contentHash &&
      cached.model === this.embeddingModel &&
      cached.embeddings.length === this.products.length
    ) {
      this.embeddings = cached.embeddings;
      this.logger.log(`Loaded ${this.embeddings.length} cached product embeddings.`);
      return;
    }

    try {
      this.embeddings = await this.computeEmbeddings(this.products.map((p) => p.embeddingText));
      const cache: EmbeddingsCache = { hash: contentHash, model: this.embeddingModel, embeddings: this.embeddings };
      fs.writeFileSync(this.cachePath, JSON.stringify(cache));
      this.logger.log(`Computed and cached embeddings for ${this.products.length} products.`);
    } catch (error) {
      this.logger.warn(
        `Could not compute product embeddings, falling back to keyword search. Reason: ${(error as Error).message}`,
      );
      this.embeddings = [];
    }
  }

  private readCache(): EmbeddingsCache | null {
    if (!fs.existsSync(this.cachePath)) {
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(this.cachePath, 'utf-8')) as EmbeddingsCache;
    } catch {
      return null;
    }
  }

  private async computeEmbeddings(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
      const response = await this.openai.embeddings.create({ model: this.embeddingModel, input: batch });
      vectors.push(...response.data.map((item) => item.embedding));
    }
    return vectors;
  }

  private async searchBySemanticSimilarity(query: string, limit: number): Promise<ProductSearchResult[]> {
    const response = await this.openai.embeddings.create({ model: this.embeddingModel, input: query });
    const queryVector = response.data[0].embedding;

    const scored = this.products.map((product, index) => ({
      product,
      score: cosineSimilarity(queryVector, this.embeddings[index]),
    }));
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(({ product }) => this.toSearchResult(product));
  }

  private searchByKeywords(query: string, limit: number): ProductSearchResult[] {
    const tokens = this.tokenize(query);

    const scored = this.products.map((product) => {
      const title = product.displayTitle.toLowerCase();
      const haystack = `${title} ${product.embeddingText.toLowerCase()}`;
      const score = tokens.reduce((total, token) => {
        if (!haystack.includes(token)) return total;
        return total + (title.includes(token) ? 2 : 1);
      }, 0);
      return { product, score };
    });
    scored.sort((a, b) => b.score - a.score);

    const relevant = scored.filter((s) => s.score > 0);
    const results = relevant.length > 0 ? relevant : scored;

    return results.slice(0, limit).map(({ product }) => this.toSearchResult(product));
  }

  private tokenize(text: string): string[] {
    const stopWords = new Set([
      'a', 'an', 'the', 'is', 'are', 'for', 'of', 'my', 'i', 'am', 'to', 'in', 'on', 'with',
      'looking', 'want', 'need', 'me', 'please', 'how', 'much', 'does', 'cost', 'costs',
      'what', 'price', 'and', 'or',
    ]);
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 1 && !stopWords.has(token));
  }

  private toSearchResult(product: Product): ProductSearchResult {
    return {
      title: product.displayTitle,
      price: product.price,
      url: product.url,
      productType: product.productType,
    };
  }
}
