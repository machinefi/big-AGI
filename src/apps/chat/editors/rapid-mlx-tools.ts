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


export const RAPID_MLX_TOOLS: AixTools_ToolDefinition[] = [
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
];


export function executeRapidMlxTool(
  invocationId: string,
  name: string,
  argsJson: string | undefined | null,
): DMessageContentFragment {
  let errorMessage: string | false = false;
  let payload: Record<string, string>;

  try {
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
