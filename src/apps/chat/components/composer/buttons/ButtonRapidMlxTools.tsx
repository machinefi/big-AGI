import * as React from 'react';

import {
  Box,
  Checkbox,
  IconButton,
  Input,
  ListDivider,
  ListItem,
  ListItemDecorator,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/joy';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import CalculateOutlinedIcon from '@mui/icons-material/CalculateOutlined';
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined';
import WbSunnyOutlinedIcon from '@mui/icons-material/WbSunnyOutlined';

import { useRapidMlxToolsConfig, type RapidMlxToolId } from '../../../editors/rapid-mlx-tools-config';


type ToolMeta = {
  id: RapidMlxToolId;
  label: string;
  hint: string;
  icon: React.ReactNode;
  keyLabel?: string;
  keyPlaceholder?: string;
};

// Order = menu order. `keyLabel` set ⇒ BYOK input rendered when toggled on.
const TOOL_META: ToolMeta[] = [
  { id: 'calculator', label: 'Calculator', hint: 'Arithmetic — free, local.', icon: <CalculateOutlinedIcon /> },
  { id: 'now', label: 'Current time', hint: 'ISO 8601 timestamp — free, local.', icon: <AccessTimeOutlinedIcon /> },
  { id: 'weather', label: 'Weather', hint: 'wttr.in — free, no key needed.', icon: <WbSunnyOutlinedIcon /> },
];


function ButtonRapidMlxTools(_props: {}) {
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const open = !!anchorEl;

  const toolsState = useRapidMlxToolsConfig((s) => s.tools);
  const setEnabled = useRapidMlxToolsConfig((s) => s.setEnabled);
  const setApiKey = useRapidMlxToolsConfig((s) => s.setApiKey);

  const enabledCount = React.useMemo(
    () => TOOL_META.reduce((n, t) => n + (toolsState[t.id]?.enabled ? 1 : 0), 0),
    [toolsState],
  );

  const handleOpen = (e: React.MouseEvent<HTMLElement>) => setAnchorEl(e.currentTarget);
  const handleClose = () => setAnchorEl(null);

  return (
    <>
      <Tooltip title={`Tools (${enabledCount} enabled)`}>
        <IconButton
          variant={enabledCount > 0 ? 'soft' : 'plain'}
          color={enabledCount > 0 ? 'primary' : 'neutral'}
          onClick={handleOpen}
          aria-label='Configure tools'
          sx={{ ml: 0.5 }}
        >
          <BuildOutlinedIcon />
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        placement='top-start'
        sx={{ minWidth: 280, p: 0.5 }}
      >
        <ListItem sx={{ pb: 0.5 }}>
          <Typography level='body-xs' textColor='text.tertiary'>
            Pick which tools the model can call.
          </Typography>
        </ListItem>
        <ListDivider />

        {TOOL_META.map((meta) => {
          const t = toolsState[meta.id] || { enabled: false };
          const needsKey = !!meta.keyLabel;
          return (
            <Box key={meta.id} sx={{ px: 1, py: 0.5 }}>
              <MenuItem
                onClick={(e) => {
                  e.preventDefault();
                  setEnabled(meta.id, !t.enabled);
                }}
                sx={{ alignItems: 'flex-start', borderRadius: 'sm' }}
              >
                <ListItemDecorator>{meta.icon}</ListItemDecorator>
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
              </MenuItem>

              {needsKey && t.enabled && (
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
                  sx={{ ml: 5, mt: 0.5, mr: 1 }}
                />
              )}
            </Box>
          );
        })}

        <ListDivider />
        <ListItem sx={{ py: 0.5 }}>
          <Typography level='body-xs' textColor='text.tertiary'>
            Toggles persist per browser. Keys never leave your device unless a tool needs them.
          </Typography>
        </ListItem>
      </Menu>
    </>
  );
}

export const ButtonRapidMlxToolsMemo = React.memo(ButtonRapidMlxTools);
