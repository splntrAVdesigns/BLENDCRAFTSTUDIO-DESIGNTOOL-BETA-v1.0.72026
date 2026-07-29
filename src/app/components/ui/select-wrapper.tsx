/**
 * SelectWrapper - Smart select component that uses native <select> in iframe environments
 * and Radix UI Select in standalone mode for optimal performance and stability.
 */
import React from 'react';
import { isIframeEnvironment } from '../../utils/environment';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';

export interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  description?: string;
}

export interface SelectWrapperProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
}

/**
 * Native select fallback for iframe environments
 */
function NativeSelect({
  value,
  onValueChange,
  options,
  className,
  triggerClassName,
  disabled,
  placeholder,
}: SelectWrapperProps) {
  return (
    <select
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      disabled={disabled}
      className={`w-full py-2 rounded-md border bg-[#262626] text-zinc-100 hover:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#5200FF] focus:border-transparent ${triggerClassName || 'border-zinc-700'} ${className || ''}`}
      style={{ paddingRight: '44px', paddingLeft: '12px', textAlign: 'left' }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Radix UI select for standalone environments
 */
function RadixSelect({
  value,
  onValueChange,
  options,
  triggerClassName,
  contentClassName,
  disabled,
}: SelectWrapperProps) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        className={triggerClassName || 'border-zinc-700 text-zinc-100 hover:border-zinc-600'}
        style={{ backgroundColor: '#262626' }}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className={contentClassName || 'bg-zinc-900 border-zinc-700'}>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="text-zinc-100 hover:bg-zinc-800 focus:bg-zinc-800 focus:text-zinc-100"
          >
            {option.description ? (
              <div className="flex flex-col">
                <span className="font-medium">{option.label}</span>
                <span className="text-xs text-zinc-500">{option.description}</span>
              </div>
            ) : (
              <>
                {option.icon && <span className="mr-2">{option.icon}</span>}
                {option.label}
              </>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Main SelectWrapper component - automatically switches between native and Radix UI
 */
export function SelectWrapper(props: SelectWrapperProps) {
  const useNative = isIframeEnvironment();
  
  if (useNative) {
    return <NativeSelect {...props} />;
  }
  
  return <RadixSelect {...props} />;
}