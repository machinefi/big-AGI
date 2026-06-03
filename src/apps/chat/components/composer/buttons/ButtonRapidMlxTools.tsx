import * as React from 'react';

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
    hint: 'Tavily — bring your own key.',
    icon: <SearchOutlinedIcon />,
    keyLabel: 'Tavily',
    keyPlaceholder: 'tvly-…',
    keyHelpUrl: 'https://app.tavily.com/home',
  },
];


function ButtonRapidMlxTools(_props: {}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  const toolsState = useRapidMlxToolsConfig((s) => s.tools);
  const setEnabled = useRapidMlxToolsConfig((s) => s.setEnabled);
  const setApiKey = useRapidMlxToolsConfig((s) => s.setApiKey);

  const enabledCount = React.useMemo(
    () => TOOL_META.reduce((n, t) => n + (toolsState[t.id]?.enabled ? 1 : 0), 0),
    [toolsState],
  );

  // Close on outside click / Esc. Bare-bones: Joy UI's <Dropdown> would
  // do this but its context is blocked by any wrapper component (e.g.
  // Tooltip), so we own the open state instead.
  React.useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <Box ref={rootRef} sx={{ position: 'relative', display: 'inline-block' }}>
      <Tooltip title={open ? 'Click again to close' : `Tools (${enabledCount} enabled)`} placement='top'>
        <IconButton
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

      {open && (
        <Sheet
          role='menu'
          data-rapid-mlx-tools='1'
          variant='outlined'
          sx={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 0,
            zIndex: 1000,
            minWidth: 320,
            maxWidth: 380,
            maxHeight: '70vh',
            overflowY: 'auto',
            p: 0.5,
            borderRadius: 'sm',
            boxShadow: 'md',
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
            const missingKey = needsKey && t.enabled && !(t.apiKey ?? '').trim();
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
                  <Box sx={{ pl: 5, pr: 1, pt: 0.5 }}>
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
                    {missingKey && (
                      <Typography level='body-xs' textColor='warning.plainColor' sx={{ mt: 0.25 }}>
                        Paste a key{meta.keyHelpUrl ? (
                          <> — get one at <a href={meta.keyHelpUrl} target='_blank' rel='noreferrer' onClick={(e) => e.stopPropagation()}>{new URL(meta.keyHelpUrl).host}</a></>
                        ) : null}.
                      </Typography>
                    )}
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
        </Sheet>
      )}
    </Box>
  );
}

export const ButtonRapidMlxToolsMemo = React.memo(ButtonRapidMlxTools);
