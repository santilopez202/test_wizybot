# Wizybot Chatbot API — Fullstack Technical Assessment

A NestJS + TypeScript API that lets a customer talk to an AI shopping assistant. The assistant is
built with the **OpenAI Chat Completion API** and **function calling**, and has access to two tools:

- **`searchProducts(query)`** — returns 2 relevant products from `data/products_list.csv`, ranked
  by semantic similarity (OpenAI embeddings over the catalog's `embeddingText` column), with an
  automatic fallback to keyword matching if embeddings can't be computed.
- **`convertCurrencies(amount, fromCurrency, toCurrency)`** — converts an amount between currencies
  using live rates from the [Open Exchange Rates API](https://openexchangerates.org/).

## Project structure

```
src/
  main.ts                    # bootstrap, global ValidationPipe, Swagger
  app.module.ts
  chat/                       # HTTP layer: controller, service (function-calling loop), DTOs
  products/                   # loads products_list.csv and implements searchProducts()
  currency/                   # implements convertCurrencies() via Open Exchange Rates
  openai/                     # shared OpenAI client provider
data/
  products_list.csv           # product catalog provided for the assessment
```

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or newer and npm
- An **OpenAI API key** with access to the Chat Completions and Embeddings APIs
  (https://platform.openai.com/api-keys)
- An **Open Exchange Rates App ID** (free tier works) (https://openexchangerates.org/signup/free)

## Setup

Run these commands from a terminal located in the root folder of the repository:

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
cp .env.example .env
# then edit .env and set OPENAI_API_KEY and OPEN_EXCHANGE_RATES_APP_ID
```

`.env` variables:

| Variable                     | Description                                                            | Default              |
| ----------------------------- | ------------------------------------------------------------------------ | --------------------- |
| `PORT`                        | Port the API listens on                                                 | `3000`                |
| `OPENAI_API_KEY`               | OpenAI API key (required)                                               | —                     |
| `OPENAI_MODEL`                 | Chat Completion model used for the agent loop                           | `gpt-4o-mini`         |
| `OPENAI_EMBEDDING_MODEL`       | Embedding model used to rank products for `searchProducts`              | `text-embedding-3-small` |
| `OPEN_EXCHANGE_RATES_APP_ID`   | App ID for the Open Exchange Rates API (required for currency queries)  | —                     |

## Running the app

```bash
# development (auto-reload)
npm run start:dev

# production build
npm run build
npm run start:prod
```

On first startup, the app computes and caches embeddings for every product in
`data/products_list.csv` (this calls the OpenAI Embeddings API once; the result is cached to
`data/products_embeddings.cache.json` and reused on subsequent restarts unless the CSV changes).

Once running:

- API base URL: `http://localhost:3000`
- Swagger / OpenAPI docs: `http://localhost:3000/api/docs`

## API usage

### `POST /chat`

Send a customer message and get the chatbot's final response.

**Request body:**

```json
{
  "message": "I am looking for a phone"
}
```

**Response body (`201`):**

```json
{
  "response": "I found two phones that might interest you: the iPhone 12 ($900) and the iPhone 13 ($1099)."
}
```

**cURL example:**

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d "{\"message\": \"I am looking for a phone\"}"
```

### Example test queries

These match the scenarios described in the assessment; try them one at a time against `POST /chat`:

```bash
curl -X POST http://localhost:3000/chat -H "Content-Type: application/json" -d "{\"message\": \"I am looking for a phone\"}"
curl -X POST http://localhost:3000/chat -H "Content-Type: application/json" -d "{\"message\": \"I am looking for a present for my dad\"}"
curl -X POST http://localhost:3000/chat -H "Content-Type: application/json" -d "{\"message\": \"How much does a watch costs?\"}"
curl -X POST http://localhost:3000/chat -H "Content-Type: application/json" -d "{\"message\": \"What is the price of the watch in Euros\"}"
curl -X POST http://localhost:3000/chat -H "Content-Type: application/json" -d "{\"message\": \"How many Canadian Dollars are 350 Euros\"}"
```

Since each request creates a fresh conversation, multi-step questions like "what is the price of
the watch in Euros" work best when phrased as a single, self-contained message (e.g. *"What is the
price of the Apple Watch in Euros?"*), as the API is stateless between requests (see Notes below).

## How it works

1. The controller receives the user's message (`ChatRequestDto`) and passes it to `ChatService`.
2. `ChatService` calls the OpenAI Chat Completion API with the message and the two tool
   definitions (`searchProducts`, `convertCurrencies`).
3. If the model responds with one or more tool calls, `ChatService` executes them locally
   (`ProductsService` / `CurrencyService`) and appends the results back into the conversation as
   `tool` messages.
4. The Chat Completion API is called again so the model can turn the tool results into a natural
   language answer. This repeats (up to a safety limit) until the model returns a plain text
   response, which is sent back to the client as `ChatResponseDto`.

## Notes / design decisions

- **Product search**: `data/products_list.csv` includes a pre-built `embeddingText` column
  specifically meant for semantic search, so `ProductsService` embeds it once at startup (cached to
  disk) and ranks products by cosine similarity to the query's embedding. If no `OPENAI_API_KEY` is
  configured or the embeddings call fails, it automatically falls back to a keyword-overlap search
  so the endpoint still returns results.
- **Currency conversion**: the Open Exchange Rates free plan always returns rates based on USD, so
  `CurrencyService` converts any pair through USD as a common base and caches the fetched rates for
  1 hour to avoid unnecessary API calls.
- **Statelessness**: the `/chat` endpoint does not persist conversation history between requests —
  each call starts a new conversation with the system prompt and the given message. This matches
  the assessment's required input/output contract (a single string in, a single string out).
- **Validation**: `ChatRequestDto` is validated with `class-validator` via a global
  `ValidationPipe` (whitelisting unknown properties and enforcing a max message length).

## Testing performed

This code was written in an environment without Node.js installed, so it could **not** be executed
or verified there. Before submitting, run it locally with `npm install` and `npm run start:dev`,
then exercise the cURL commands above (with a real `OPENAI_API_KEY` and
`OPEN_EXCHANGE_RATES_APP_ID` in `.env`) to confirm that `searchProducts` returns relevant catalog
items and `convertCurrencies` returns correctly converted amounts, as required by the assessment's
"check that your API is working... before submission" instruction.
