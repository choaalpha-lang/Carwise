// CarWise AI price check (PoC) — bundled to www/ai.js by `npm run build:ai`.
// Calls the Claude API directly from the browser with a key the trial facilitator enters on a
// team device (stored only in that device's localStorage). Only anonymous car attributes are sent.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';

// The answer comes back through a strict tool rather than output_config.format, because
// structured outputs are incompatible with the citations that web search results carry.
const REPORT_TOOL = {
  name: 'report_price_estimate',
  description: 'Report the final used-car market price estimate for Thailand, with the listings or reports it is based on. Call this exactly once, after searching.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      low_thb: { type: 'integer', description: 'Lower bound of the likely private-sale market price in Thai baht.' },
      high_thb: { type: 'integer', description: 'Upper bound of the likely private-sale market price in Thai baht.' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      comparable_count: { type: 'integer', description: 'Number of comparable listings or price references actually found.' },
      summary_th: { type: 'string', description: 'Two or three sentences in Thai explaining the estimate and its main uncertainty.' },
      sources: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            url: { type: 'string' },
            price_thb: { type: ['integer', 'null'] },
            note: { type: 'string' }
          },
          required: ['title', 'url', 'price_thb', 'note'],
          additionalProperties: false
        }
      }
    },
    required: ['low_thb', 'high_thb', 'confidence', 'comparable_count', 'summary_th', 'sources'],
    additionalProperties: false
  }
};

const SYSTEM = `You estimate used-car market prices in Thailand for a consumer decision tool.
Search the web for current Thai listings and price guides for the exact brand, model and year (and similar mileage/condition).
Base the range only on what you find; never invent listings, prices or URLs. If evidence is thin, widen the range and set confidence to "low".
Give a private-sale price range in THB for the whole car (not monthly payments, not new-car prices).
Do not recommend loans, lenders or dealers, and do not give financial advice.
When done, call report_price_estimate exactly once.`;

const CONDITION_EN = { excellent: 'excellent, no accidents', good: 'good, normal wear', fair: 'fair, some repaint/repairs', repair: 'needs repair or had a major accident' };

// options.blockedDomains: hide sites from web search (E03 uses it to keep the reference-price source out of reach).
// options.fetch: custom fetch (tests). Returns the reported estimate plus token / search usage for cost tracking.
export async function estimate(car, apiKey, { signal, blockedDomains, fetch } = {}) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, timeout: 180000, maxRetries: 1, ...(fetch ? { fetch } : {}) });
  const search = { type: 'web_search_20260209', name: 'web_search', max_uses: 6, user_location: { type: 'approximate', country: 'TH', timezone: 'Asia/Bangkok' } };
  if (blockedDomains && blockedDomains.length) search.blocked_domains = blockedDomains;
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, web_search_requests: 0, requests: 0 };
  const messages = [{
    role: 'user',
    content: `Car: ${car.brand} ${car.model}, registered ${car.year}, ${car.mileage} km, condition: ${CONDITION_EN[car.condition] || car.condition}. Country: Thailand. Estimate the current used market price range.`
  }];
  // Server-side web search may pause after many iterations; resume a couple of times.
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: SYSTEM,
      tools: [search, REPORT_TOOL],
      messages
    }, { signal });
    const u = res.usage || {};
    usage.requests++; usage.input_tokens += u.input_tokens || 0; usage.output_tokens += u.output_tokens || 0;
    usage.cache_read_input_tokens += u.cache_read_input_tokens || 0;
    usage.web_search_requests += (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
    if (res.stop_reason === 'refusal') throw new Error('AI ปฏิเสธคำขอนี้');
    const call = res.content.find(b => b.type === 'tool_use' && b.name === REPORT_TOOL.name);
    if (call) return { ...call.input, model: res.model, usage };
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
    if (res.stop_reason === 'max_tokens') throw new Error('คำตอบยาวเกินกำหนด');
    break;
  }
  throw new Error('AI ไม่ได้ส่งผลประเมินกลับมา');
}

// Re-exported so the app can show friendly messages without string matching.
export const errors = { AuthenticationError: Anthropic.AuthenticationError, RateLimitError: Anthropic.RateLimitError, APIError: Anthropic.APIError, APIConnectionError: Anthropic.APIConnectionError };
