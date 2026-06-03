import * as React from 'react';
import { createPortal } from 'react-dom';

import {
  Box,
  Checkbox,
  IconButton,
  Input,
  ListDivider,
  ListItem,
  ListItemDecorator,
  Sheet,
  Tooltip,
  Typography,
} from '@mui/joy';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import CalculateOutlinedIcon from '@mui/icons-material/CalculateOutlined';
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined';
import WbSunnyOutlinedIcon from '@mui/icons-material/WbSunnyOutlined';
import SwapHorizOutlinedIcon from '@mui/icons-material/SwapHorizOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import CurrencyExchangeOutlinedIcon from '@mui/icons-material/CurrencyExchangeOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';

import { useRapidMlxToolsConfig, type RapidMlxToolId } from '../../../editors/rapid-mlx-tools-config';


type ToolMeta = {
  id: RapidMlxToolId;
  label: string;
  hint: string;
  icon: React.ReactNode;
  keyLabel?: string;
  keyPlaceholder?: string;
  keyHelpUrl?: string;
  // Optional second BYOK slot (web_search has Tavily + Brave). The
  // executor picks whichever is non-empty (primary preferred on tie).
  secondaryKeyField?: 'braveKey';
  secondaryKeyLabel?: string;
  secondaryKeyPlaceholder?: string;
  secondaryKeyHelpUrl?: string;
};

// Order = menu order. `keyLabel` set ⇒ BYOK input rendered when toggled on.
//   Free local:  no network, zero cost.
//   Free relay:  through our CF Worker, no key, rate-limited.
//   BYOK:        user pastes their own API key, our Worker passes it through.
const TOOL_META: ToolMeta[] = [
  { id: 'calculator', label: 'Calculator', hint: 'Arithmetic — free, local.', icon: <CalculateOutlinedIcon /> },
  { id: 'now', label: 'Current time', hint: 'ISO 8601 timestamp — free, local.', icon: <AccessTimeOutlinedIcon /> },
  { id: 'unit_convert', label: 'Unit conversion', hint: 'Length, mass, temperature, time — free, local.', icon: <SwapHorizOutlinedIcon /> },
  { id: 'weather', label: 'Weather', hint: 'wttr.in — free, no key.', icon: <WbSunnyOutlinedIcon /> },
  { id: 'wikipedia', label: 'Wikipedia', hint: 'wikipedia.org REST — free, no key.', icon: <MenuBookOutlinedIcon /> },
  { id: 'currency', label: 'Currency convert', hint: 'frankfurter.app / ECB — free, no key.', icon: <CurrencyExchangeOutlinedIcon /> },
  {
    id: 'web_search',
    label: 'Web search',
    hint: 'Tavily or Brave — bring your own key.',
    icon: <SearchOutlinedIcon />,
    // Two BYOK key slots; whichever you fill wins. Tavily preferred on tie.
    keyLabel: 'Tavily',
    keyPlaceholder: 'tvly-…',
    keyHelpUrl: 'https://app.tavily.com/home',
    secondaryKeyField: 'braveKey',
    secondaryKeyLabel: 'Brave',
    secondaryKeyPlaceholder: 'BSA…',
    secondaryKeyHelpUrl: 'https://api.search.brave.com/app/keys',
  },
];


function ButtonRapidMlxTools(_props: {}) {
  const [open, setOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const sheetRef = React.useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);

  const toolsState = useRapidMlxToolsConfig((s) => s.tools);
  const setEnabled = useRapidMlxToolsConfig((s) => s.setEnabled);
  const setApiKey = useRapidMlxToolsConfig((s) => s.setApiKey);
  const setBraveKey = useRapidMlxToolsConfig((s) => s.setBraveKey);

  const enabledCount = React.useMemo(
    () => TOOL_META.reduce((n, t) => n + (toolsState[t.id]?.enabled ? 1 : 0), 0),
    [toolsState],
  );

  // Anchor menu above the wrench. Re-measure on open + on viewport
  // resize. We render via Portal so the composer's overflow:hidden
  // can't clip us.
  const updatePos = React.useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const menuWidth = 340;
    const menuHeightEstimate = 520;
    const margin = 8;
    // prefer above the button (most space in a composer-anchored UI);
    // if the button is near the top of the viewport, drop below instead.
    const above = r.top > menuHeightEstimate + margin;
    const top = above
      ? Math.max(margin, r.top - menuHeightEstimate - 6)
      : Math.min(window.innerHeight - menuHeightEstimate - margin, r.bottom + 6);
    const left = Math.min(
      Math.max(margin, r.left),
      window.innerWidth - menuWidth - margin,
    );
    setPos({ top, left });
  }, []);

  React.useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    updatePos();
  }, [open, updatePos]);

  React.useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || sheetRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onResize = () => updatePos();
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open, updatePos]);

  return (
    <>
      <Tooltip title={open ? 'Click again to close' : `Tools (${enabledCount} enabled)`} placement='top'>
        <IconButton
          ref={buttonRef}
          variant={enabledCount > 0 ? 'soft' : 'plain'}
          color={enabledCount > 0 ? 'primary' : 'neutral'}
          onClick={() => setOpen((v) => !v)}
          aria-label='Configure tools'
          aria-expanded={open}
          aria-haspopup='menu'
          sx={{ ml: 0.5 }}
        >
          <BuildOutlinedIcon />
        </IconButton>
      </Tooltip>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <Sheet
          ref={sheetRef}
          role='menu'
          data-rapid-mlx-tools='1'
          variant='outlined'
          sx={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            zIndex: 1500,
            width: 340,
            maxHeight: 'min(520px, calc(100vh - 24px))',
            overflowY: 'auto',
            p: 0.5,
            borderRadius: 'sm',
            boxShadow: 'lg',
            bgcolor: 'background.surface',
          }}
        >
          <ListItem sx={{ pb: 0.5 }}>
            <Typography level='body-xs' textColor='text.tertiary'>
              Pick which tools the model can call. Click the wrench again to close.
            </Typography>
          </ListItem>
          <ListDivider />

          {TOOL_META.map((meta) => {
            const t = toolsState[meta.id] || { enabled: false };
            const needsKey = !!meta.keyLabel;
            return (
              <Box key={meta.id} sx={{ px: 1, py: 0.5 }}>
                <Box
                  onClick={() => setEnabled(meta.id, !t.enabled)}
                  sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 1,
                    px: 1,
                    py: 0.75,
                    borderRadius: 'sm',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'background.level1' },
                  }}
                >
                  <ListItemDecorator sx={{ mt: 0.25 }}>{meta.icon}</ListItemDecorator>
                  <Box sx={{ flex: 1, mr: 1 }}>
                    <Typography level='body-sm'>{meta.label}</Typography>
                    <Typography level='body-xs' textColor='text.tertiary'>
                      {meta.hint}
                    </Typography>
                  </Box>
                  <Checkbox
                    checked={!!t.enabled}
                    onChange={(e) => setEnabled(meta.id, e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                    size='sm'
                  />
                </Box>

                {needsKey && t.enabled && (
                  <Box sx={{ pl: 5, pr: 1, pt: 0.5, display: 'grid', gap: 0.5 }}>
                    <Input
                      size='sm'
                      type='password'
                      value={t.apiKey ?? ''}
                      onChange={(e) => setApiKey(meta.id, e.target.value)}
                      placeholder={meta.keyPlaceholder || 'API key'}
                      startDecorator={
                        <Typography level='body-xs' textColor='text.tertiary'>
                          {meta.keyLabel}
                        </Typography>
                      }
                    />
                    {meta.secondaryKeyField === 'braveKey' && (
                      <Input
                        size='sm'
                        type='password'
                        value={t.braveKey ?? ''}
                        onChange={(e) => setBraveKey(meta.id, e.target.value)}
                        placeholder={meta.secondaryKeyPlaceholder || 'API key'}
                        startDecorator={
                          <Typography level='body-xs' textColor='text.tertiary'>
                            {meta.secondaryKeyLabel || 'Key'}
                          </Typography>
                        }
                      />
                    )}
                    {(() => {
                      const primary = (t.apiKey ?? '').trim();
                      const brave = (t.braveKey ?? '').trim();
                      if (!primary && !brave) {
                        return (
                          <Typography level='body-xs' textColor='warning.plainColor'>
                            Paste a Tavily or Brave key{meta.keyHelpUrl ? (
                              <> — Tavily at <a href={meta.keyHelpUrl} target='_blank' rel='noreferrer' onClick={(e) => e.stopPropagation()}>{new URL(meta.keyHelpUrl).host}</a>{meta.secondaryKeyHelpUrl ? (<>, Brave at <a href={meta.secondaryKeyHelpUrl} target='_blank' rel='noreferrer' onClick={(e) => e.stopPropagation()}>{new URL(meta.secondaryKeyHelpUrl).host}</a></>) : null}</>
                            ) : null}.
                          </Typography>
                        );
                      }
                      const active = primary ? meta.keyLabel : meta.secondaryKeyLabel;
                      return (
                        <Typography level='body-xs' textColor='text.tertiary'>
                          Active: {active}{primary && brave ? ' (Tavily wins on tie)' : ''}
                        </Typography>
                      );
                    })()}
                  </Box>
                )}
              </Box>
            );
          })}

          <ListDivider />
          <ListItem sx={{ py: 0.5 }}>
            <Typography level='body-xs' textColor='text.tertiary'>
              Toggles persist per browser. Keys live in localStorage on this device only and are forwarded to the relay per request — never persisted server-side.
            </Typography>
          </ListItem>
        </Sheet>,
        document.body,
      )}
    </>
  );
}

export const ButtonRapidMlxToolsMemo = React.memo(ButtonRapidMlxTools);
