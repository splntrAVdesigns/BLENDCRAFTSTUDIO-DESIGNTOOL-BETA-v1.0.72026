import { useTooltipContext } from '../../contexts/TooltipContext';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip';

interface ConditionalTooltipProps {
  content: string;
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  delayDuration?: number;
}

/**
 * Tooltip component that respects the global tooltip toggle setting
 */
export function ConditionalTooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  delayDuration = 300,
}: ConditionalTooltipProps) {
  const { tooltipsEnabled } = useTooltipContext();

  // If tooltips are disabled, just render the children
  if (!tooltipsEnabled) {
    return <>{children}</>;
  }

  // Otherwise, render with tooltip
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip>
        <TooltipTrigger asChild>
          {children}
        </TooltipTrigger>
        <TooltipContent side={side} align={align}>
          <p className="text-sm">{content}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
