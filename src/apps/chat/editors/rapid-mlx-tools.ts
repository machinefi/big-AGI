/**
 * rapid-mlx (static-export fork) — built-in client-side tools.
 *
 * On the upstream Big-AGI build the chat editor talks to a Next.js
 * server that hosts the ReAct agent, code-interpreter, web-search,
 * etc. We deleted `app/api` in the static-export fork, so none of
 * those exist at runtime. Instead we ship a small set of pure-browser
 * tools that work offline and get advertised in every chat
 * completion request — that way the user gets a ChatGPT-style
 * autonomous tool-calling experience (model decides → we execute in
 * the browser → result feeds back into the next inference round) on
 * a fully static deploy.
 *
 * Add a tool by:
 *   1. Declaring its schema in RAPID_MLX_TOOLS via aixFunctionCallTool.
 *   2. Implementing the body in executeRapidMlxTool's switch.
 *
 * Tool results are wrapped in `{ result: ... }` because the chat
 * generate request validator (aix.client.chatGenerateRequest.ts:520)
 * requires tool_response payloads to JSON-parse to an object — not a
 * string, not an array — for Gemini wire compatibility.
 */

import * as z from 'zod/v4';

import { aixFunctionCallTool } from '~/modules/aix/client/aix.client.fromSimpleFunction';
import { create_FunctionCallResponse_ContentFragment } from '~/common/stores/chat/chat.fragments';
import type { AixTools_ToolDefinition } from '~/modules/aix/server/api/aix.wiretypes';
import type { DMessageContentFragment } from '~/common/stores/chat/chat.fragments';

import { getRapidMlxToolsConfig, type RapidMlxToolId } from './rapid-mlx-tools-config';


// CSP-safe arithmetic evaluator.
// Supports +  -  *  /  %  ^ (exponent)  unary +/-  parentheses
// numbers (decimal, scientific) and a small Math.* allowlist:
//   pi, e, sqrt(x), cbrt(x), abs(x), log(x), log2(x), log10(x),
//   exp(x), sin(x), cos(x), tan(x), asin(x), acos(x), atan(x),
//   floor(x), ceil(x), round(x), pow(x, y), max(...), min(...)
// new Function() / eval() are blocked by CSP on rapid-pro.pages.dev.
function evalArithmetic(input: string): number {
  const src = input.trim();
  if (!src) throw new Error('expression is required');

  type Tok = { t: 'num'; v: number } | { t: 'op'; v: string } | { t: 'lp' } | { t: 'rp' } | { t: 'comma' } | { t: 'id'; v: string };
  const toks: Tok[] = [];

  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '(') { toks.push({ t: 'lp' }); i++; continue; }
    if (c === ')') { toks.push({ t: 'rp' }); i++; continue; }
    if (c === ',') { toks.push({ t: 'comma' }); i++; continue; }
    if (c === '+' || c === '-' || c === '*' || c === '/' || c === '%' || c === '^') {
      toks.push({ t: 'op', v: c }); i++; continue;
    }
    if ((c >= '0' && c <= '9') || c === '.') {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      if (j < src.length && (src[j] === 'e' || src[j] === 'E')) {
        j++;
        if (j < src.length && (src[j] === '+' || src[j] === '-')) j++;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      const num = Number(src.slice(i, j));
      if (!Number.isFinite(num)) throw new Error('invalid number');
      toks.push({ t: 'num', v: num }); i = j; continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_.]/.test(src[j])) j++;
      let id = src.slice(i, j);
      if (id.toLowerCase().startsWith('math.')) id = id.slice(5);
      toks.push({ t: 'id', v: id.toLowerCase() }); i = j; continue;
    }
    throw new Error('unexpected character "' + c + '" at position ' + i);
  }

  let p = 0;
  function peek(): Tok | undefined { return toks[p]; }
  function next(): Tok { return toks[p++]; }

  // recursive-descent with precedence:
  // expr -> term (('+' | '-') term)*
  // term -> power (('*' | '/' | '%') power)*
  // power -> unary ('^' power)?
  // unary -> ('+' | '-') unary | primary
  // primary -> num | id ('(' args? ')')? | '(' expr ')'

  function parseExpr(): number {
    let v = parseTerm();
    while (true) {
      const t = peek();
      if (!t || t.t !== 'op' || (t.v !== '+' && t.v !== '-')) break;
      next();
      const r = parseTerm();
      v = t.v === '+' ? v + r : v - r;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parsePower();
    while (true) {
      const t = peek();
      if (!t || t.t !== 'op' || (t.v !== '*' && t.v !== '/' && t.v !== '%')) break;
      next();
      const r = parsePower();
      if (t.v === '*') v = v * r;
      else if (t.v === '/') v = v / r;
      else v = v % r;
    }
    return v;
  }
  function parsePower(): number {
    const base = parseUnary();
    const t = peek();
    if (t && t.t === 'op' && t.v === '^') {
      next();
      const exp = parsePower();
      return Math.pow(base, exp);
    }
    return base;
  }
  function parseUnary(): number {
    const t = peek();
    if (t && t.t === 'op' && (t.v === '+' || t.v === '-')) {
      next();
      const v = parseUnary();
      return t.v === '-' ? -v : v;
    }
    return parsePrimary();
  }
  function parsePrimary(): number {
    const t = next();
    if (!t) throw new Error('unexpected end of expression');
    if (t.t === 'num') return t.v;
    if (t.t === 'lp') {
      const v = parseExpr();
      const r = next();
      if (!r || r.t !== 'rp') throw new Error('missing ")"');
      return v;
    }
    if (t.t === 'id') {
      const constants: Record<string, number> = { pi: Math.PI, e: Math.E };
      const lookahead = peek();
      if (!lookahead || lookahead.t !== 'lp') {
        if (t.v in constants) return constants[t.v];
        throw new Error('unknown identifier "' + t.v + '"');
      }
      // function call
      next(); // consume '('
      const args: number[] = [];
      if (peek() && peek()!.t !== 'rp') {
        args.push(parseExpr());
        while (peek() && peek()!.t === 'comma') { next(); args.push(parseExpr()); }
      }
      const close = next();
      if (!close || close.t !== 'rp') throw new Error('missing ")" after function call');
      const fns: Record<string, (...a: number[]) => number> = {
        sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
        log: Math.log, log2: Math.log2, log10: Math.log10, exp: Math.exp,
        sin: Math.sin, cos: Math.cos, tan: Math.tan,
        asin: Math.asin, acos: Math.acos, atan: Math.atan,
        floor: Math.floor, ceil: Math.ceil, round: Math.round,
        pow: Math.pow, max: Math.max, min: Math.min,
      };
      const fn = fns[t.v];
      if (!fn) throw new Error('unknown function "' + t.v + '"');
      return fn(...args);
    }
    throw new Error('unexpected token');
  }

  const result = parseExpr();
  if (p < toks.length) throw new Error('trailing tokens after expression');
  return result;
}


// Full catalog. The chat-persona loop filters this by the user's
// rapid-mlx-tools-config before advertising to the model — the model
// only ever sees tools the user has explicitly enabled.
export const ALL_RAPID_MLX_TOOLS: AixTools_ToolDefinition[] = [
  aixFunctionCallTool({
    name: 'calculator',
    description:
      'Evaluate an arithmetic expression. Supports + - * / % ^ ( ) and Math functions (sqrt, cbrt, abs, log, log2, log10, exp, sin, cos, tan, asin, acos, atan, floor, ceil, round, pow, max, min) plus constants pi, e. Returns the numeric result as a string.',
    inputSchema: z.object({
      expression: z
        .string()
        .describe(
          'An arithmetic expression, e.g. "89 * 137", "sqrt(2) + pi", "pow(2, 16)", "log10(1000)".',
        ),
    }),
  }),
  aixFunctionCallTool({
    name: 'now',
    description:
      'Return the current wall-clock time as an ISO 8601 string. Use whenever the user asks about the current date or time.',
    inputSchema: z.object({}),
  }),
  aixFunctionCallTool({
    name: 'unit_convert',
    description:
      'Convert a numeric value between units of length, mass, temperature, or time. Supports common abbreviations (km, mi, m, ft, in, cm, kg, lb, oz, g, c/celsius, f/fahrenheit, k/kelvin, s/sec, min, h/hour, day). Returns the converted numeric value as a string.',
    inputSchema: z.object({
      value: z.number().describe('The numeric value to convert, e.g. 26.2.'),
      from: z.string().describe('Source unit, e.g. "mi", "kg", "F", "h".'),
      to: z.string().describe('Target unit, e.g. "km", "lb", "C", "min".'),
    }),
  }),
  aixFunctionCallTool({
    name: 'weather',
    description:
      'Look up the current weather for a city, address, or airport code. Returns temperature, conditions, humidity, wind. Uses wttr.in (free, no key).',
    inputSchema: z.object({
      location: z
        .string()
        .describe('City name, address, postal code, or airport code, e.g. "Palo Alto", "94301", "SFO", "Tokyo".'),
    }),
  }),
  aixFunctionCallTool({
    name: 'wikipedia',
    description:
      'Look up the lead paragraph + title + canonical URL of an English Wikipedia article. Use for factual lookups about people, places, events, concepts. Returns {title, summary, url}.',
    inputSchema: z.object({
      query: z.string().describe('Article title or topic to search for, e.g. "MLX (machine learning framework)", "Palo Alto, California".'),
    }),
  }),
  aixFunctionCallTool({
    name: 'currency',
    description:
      'Convert an amount between currency codes using daily ECB rates (frankfurter.app). Codes are ISO 4217 (USD, EUR, JPY, GBP, CNY, ...). Returns {amount, from, to, result, rate, date}.',
    inputSchema: z.object({
      amount: z.number().describe('Amount in the source currency, e.g. 100.'),
      from: z.string().describe('Source currency code, e.g. "USD".'),
      to: z.string().describe('Target currency code, e.g. "JPY".'),
    }),
  }),
  aixFunctionCallTool({
    name: 'web_search',
    description:
      'Search the live web via Tavily and return short snippets. Use when the user asks about recent events, current facts, or anything past the training cutoff. Returns {query, results: [{title, url, snippet}, ...]}.',
    inputSchema: z.object({
      query: z.string().describe('A natural-language search query, e.g. "MLX vs MPS performance 2026".'),
      max_results: z.number().int().min(1).max(10).optional().describe('How many results to return (default 5, max 10).'),
    }),
  }),
];


// Unit conversion — local, no network. Categories don't cross
// (you can't convert "kg" to "ft"), and within a category we use a
// canonical SI unit as the pivot. Temperature is special-cased since
// the conversion isn't a single multiplicative factor.
const UNIT_TABLE: Record<string, { canonical: string; toCanonical: (v: number) => number; fromCanonical: (v: number) => number; category: string }> = (() => {
  const tab: Record<string, { canonical: string; toCanonical: (v: number) => number; fromCanonical: (v: number) => number; category: string }> = {};
  function linear(category: string, canonical: string, aliases: string[], factor: number) {
    for (const a of aliases) {
      tab[a.toLowerCase()] = { category, canonical, toCanonical: (v) => v * factor, fromCanonical: (v) => v / factor };
    }
  }
  // length (canonical: meter)
  linear('length', 'm', ['m', 'meter', 'meters', 'metre', 'metres'], 1);
  linear('length', 'm', ['km', 'kilometer', 'kilometers', 'kilometre', 'kilometres'], 1000);
  linear('length', 'm', ['cm', 'centimeter', 'centimeters'], 0.01);
  linear('length', 'm', ['mm', 'millimeter', 'millimeters'], 0.001);
  linear('length', 'm', ['mi', 'mile', 'miles'], 1609.344);
  linear('length', 'm', ['yd', 'yard', 'yards'], 0.9144);
  linear('length', 'm', ['ft', 'foot', 'feet'], 0.3048);
  linear('length', 'm', ['in', 'inch', 'inches'], 0.0254);
  linear('length', 'm', ['nmi', 'nm', 'nautical_mile', 'nautical_miles'], 1852);
  // mass (canonical: kilogram)
  linear('mass', 'kg', ['kg', 'kilogram', 'kilograms'], 1);
  linear('mass', 'kg', ['g', 'gram', 'grams'], 0.001);
  linear('mass', 'kg', ['mg', 'milligram', 'milligrams'], 1e-6);
  linear('mass', 'kg', ['lb', 'lbs', 'pound', 'pounds'], 0.45359237);
  linear('mass', 'kg', ['oz', 'ounce', 'ounces'], 0.028349523125);
  linear('mass', 'kg', ['t', 'tonne', 'tonnes', 'metric_ton'], 1000);
  // time (canonical: second)
  linear('time', 's', ['s', 'sec', 'secs', 'second', 'seconds'], 1);
  linear('time', 's', ['ms', 'millisecond', 'milliseconds'], 1e-3);
  linear('time', 's', ['min', 'mins', 'minute', 'minutes'], 60);
  linear('time', 's', ['h', 'hr', 'hrs', 'hour', 'hours'], 3600);
  linear('time', 's', ['d', 'day', 'days'], 86400);
  linear('time', 's', ['wk', 'week', 'weeks'], 604800);
  // temperature (canonical: kelvin)
  const tempCanonical = 'k';
  const tempCat = 'temperature';
  tab['k'] = tab['kelvin'] = { category: tempCat, canonical: tempCanonical, toCanonical: (v) => v, fromCanonical: (v) => v };
  tab['c'] = tab['celsius'] = { category: tempCat, canonical: tempCanonical, toCanonical: (v) => v + 273.15, fromCanonical: (v) => v - 273.15 };
  tab['f'] = tab['fahrenheit'] = { category: tempCat, canonical: tempCanonical, toCanonical: (v) => (v - 32) * (5 / 9) + 273.15, fromCanonical: (v) => (v - 273.15) * (9 / 5) + 32 };
  return tab;
})();

function convertUnit(value: number, from: string, to: string): number {
  const a = UNIT_TABLE[from.toLowerCase()];
  const b = UNIT_TABLE[to.toLowerCase()];
  if (!a) throw new Error('unknown source unit: ' + from);
  if (!b) throw new Error('unknown target unit: ' + to);
  if (a.category !== b.category) throw new Error("can't convert between " + a.category + ' and ' + b.category);
  return b.fromCanonical(a.toCanonical(value));
}


// Pull the relay base URL out of the persisted Big-AGI app-models
// store. The splash injector writes `sources[0].setup.oaiHost` to
// `<relay>/r/<tunnelId>`; we want the bare `https://relay`.
function getRelayBase(): string | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('app-models') : null;
    if (!raw) return null;
    const data = JSON.parse(raw);
    const host = data?.state?.sources?.[0]?.setup?.oaiHost;
    if (typeof host !== 'string' || !host) return null;
    const m = host.match(/^(https?:\/\/[^/]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}


/** Return only the tool definitions the user has enabled in settings. */
export function getEnabledRapidMlxTools(): AixTools_ToolDefinition[] {
  const cfg = getRapidMlxToolsConfig();
  return ALL_RAPID_MLX_TOOLS.filter((t) => {
    // aixFunctionCallTool returns { type: 'function_call', function_call: { name } }
    const id = (t as { function_call?: { name?: string } }).function_call?.name as RapidMlxToolId | undefined;
    return id ? !!cfg[id]?.enabled : false;
  });
}

/** Gate check used by the executor — a sneaky model can't call a disabled tool. */
function isToolEnabled(name: string): boolean {
  const cfg = getRapidMlxToolsConfig();
  return !!(cfg as Record<string, { enabled: boolean } | undefined>)[name]?.enabled;
}

export async function executeRapidMlxTool(
  invocationId: string,
  name: string,
  argsJson: string | undefined | null,
): Promise<DMessageContentFragment> {
  let errorMessage: string | false = false;
  let payload: Record<string, unknown>;

  try {
    if (!isToolEnabled(name)) {
      throw new Error(`tool "${name}" is disabled in settings`);
    }
    const args = argsJson ? JSON.parse(argsJson) : {};

    switch (name) {
      case 'calculator': {
        const expression = String(args?.expression ?? '');
        if (!expression.trim()) throw new Error('expression is required');
        // CSP-safe: no eval/new Function. Shunting-yard parser supports
        // + - * / % ^ ( ) and a small Math.* allowlist.
        const value = evalArithmetic(expression);
        if (!Number.isFinite(value)) throw new Error('result is not a finite number');
        payload = { result: String(value) };
        break;
      }
      case 'now': {
        payload = { result: new Date().toISOString() };
        break;
      }
      case 'unit_convert': {
        const value = Number(args?.value);
        const from = String(args?.from ?? '').trim();
        const to = String(args?.to ?? '').trim();
        if (!Number.isFinite(value)) throw new Error('value must be a finite number');
        if (!from || !to) throw new Error('from and to are required');
        const out = convertUnit(value, from, to);
        payload = { value: String(value), from, to, result: String(out) };
        break;
      }
      case 'weather': {
        const location = String(args?.location ?? '').trim();
        if (!location) throw new Error('location is required');
        const relay = getRelayBase();
        if (!relay) throw new Error('no relay configured (open a share URL first)');
        const url = relay + '/tool/weather?location=' + encodeURIComponent(location);
        const res = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error('weather lookup failed: HTTP ' + res.status);
        payload = await res.json();
        break;
      }
      case 'wikipedia': {
        const query = String(args?.query ?? '').trim();
        if (!query) throw new Error('query is required');
        const relay = getRelayBase();
        if (!relay) throw new Error('no relay configured (open a share URL first)');
        const url = relay + '/tool/wikipedia?query=' + encodeURIComponent(query);
        const res = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error('wikipedia lookup failed: HTTP ' + res.status);
        payload = await res.json();
        break;
      }
      case 'currency': {
        const amount = Number(args?.amount);
        const from = String(args?.from ?? '').trim().toUpperCase();
        const to = String(args?.to ?? '').trim().toUpperCase();
        if (!Number.isFinite(amount)) throw new Error('amount must be a finite number');
        if (!from || !to) throw new Error('from and to are required');
        const relay = getRelayBase();
        if (!relay) throw new Error('no relay configured (open a share URL first)');
        const url = relay + '/tool/currency?amount=' + encodeURIComponent(String(amount)) + '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
        const res = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error('currency lookup failed: HTTP ' + res.status);
        payload = await res.json();
        break;
      }
      case 'web_search': {
        const query = String(args?.query ?? '').trim();
        const maxResults = Number(args?.max_results);
        if (!query) throw new Error('query is required');
        // BYOK: read the user's Tavily key out of the tools-config store.
        const cfg = getRapidMlxToolsConfig();
        const key = (cfg.web_search?.apiKey ?? '').trim();
        if (!key) throw new Error('Tavily key not set in the tools menu');
        const relay = getRelayBase();
        if (!relay) throw new Error('no relay configured (open a share URL first)');
        const url = relay + '/tool/web_search';
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Tool-Key': key,
          },
          body: JSON.stringify({
            query,
            max_results: Number.isFinite(maxResults) ? maxResults : 5,
          }),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error('web search failed: HTTP ' + res.status + (errText ? ' — ' + errText.slice(0, 160) : ''));
        }
        payload = await res.json();
        break;
      }
      default: {
        errorMessage = `unknown tool "${name}"`;
        payload = { error: errorMessage };
      }
    }
  } catch (e: any) {
    errorMessage = e?.message ? String(e.message) : String(e);
    payload = { error: errorMessage };
  }

  return create_FunctionCallResponse_ContentFragment(
    invocationId,
    errorMessage,
    name,
    JSON.stringify(payload),
    'client',
  );
}
