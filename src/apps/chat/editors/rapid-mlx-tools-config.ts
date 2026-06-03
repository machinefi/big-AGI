/**
 * rapid-mlx tools — per-user enable/disable + BYOK key storage.
 *
 * Persists to localStorage so the user's toggles survive reloads.
 * The chat-persona loop reads this store to filter RAPID_MLX_TOOLS
 * before advertising them to the model; the executor also gates on
 * the enabled set so a model can't sneak-call a disabled tool.
 *
 * BYOK note: keys live in localStorage on the user's device. They
 * are forwarded to our CF Worker as an `X-Tool-Key` header which the
 * Worker passes through to the upstream API (Tavily / Brave / etc.)
 * without persisting. Tools that don't need a key (calculator, now,
 * weather via wttr.in) leave `apiKey` empty.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';


export type RapidMlxToolId =
  | 'calculator'
  | 'now'
  | 'unit_convert'
  | 'weather'
  | 'wikipedia'
  | 'currency'
  | 'web_search';

interface ToolState {
  enabled: boolean;
  apiKey?: string;
}

interface RapidMlxToolsConfigState {
  tools: Record<RapidMlxToolId, ToolState>;
}

interface RapidMlxToolsConfigActions {
  setEnabled: (id: RapidMlxToolId, enabled: boolean) => void;
  setApiKey: (id: RapidMlxToolId, apiKey: string) => void;
}


// Defaults: zero-dependency tools start enabled (they have no cost
// and no risk surface). API-backed tools start disabled — even the
// keyless ones (weather via wttr.in) so the user makes a conscious
// choice rather than us auto-advertising every chat.
const DEFAULTS: Record<RapidMlxToolId, ToolState> = {
  calculator: { enabled: true },
  now: { enabled: true },
  unit_convert: { enabled: true },
  weather: { enabled: false },
  wikipedia: { enabled: false },
  currency: { enabled: false },
  web_search: { enabled: false, apiKey: '' },
};


export const useRapidMlxToolsConfig = create<RapidMlxToolsConfigState & RapidMlxToolsConfigActions>()(
  persist(
    (set) => ({
      tools: DEFAULTS,

      setEnabled: (id, enabled) => set((s) => ({
        tools: { ...s.tools, [id]: { ...s.tools[id], enabled } },
      })),

      setApiKey: (id, apiKey) => set((s) => ({
        tools: { ...s.tools, [id]: { ...s.tools[id], apiKey } },
      })),
    }),
    {
      name: 'rapid-mlx-tools-config',
      version: 1,
      // Merge new tools into existing state so adding a tool in a
      // future release doesn't strand returning users with an empty
      // entry.
      merge: (persisted, current) => {
        const p = (persisted as Partial<RapidMlxToolsConfigState>) || {};
        return {
          ...current,
          ...p,
          tools: { ...DEFAULTS, ...(p.tools || {}) },
        };
      },
    },
  ),
);


/** Read enabled-set + keys without subscribing (callable from non-React code). */
export function getRapidMlxToolsConfig(): RapidMlxToolsConfigState['tools'] {
  return useRapidMlxToolsConfig.getState().tools;
}
