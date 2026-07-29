import { createContext, useState, useContext, useEffect } from 'react';

interface TooltipContextValue {
  tooltipsEnabled: boolean;
  toggleTooltips: () => void;
  setTooltipsEnabled: (enabled: boolean) => void;
}

const TooltipContext = createContext<TooltipContextValue | undefined>(undefined);

const TOOLTIPS_STORAGE_KEY = 'blendcraft-tooltips-enabled';

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  const [tooltipsEnabled, setTooltipsEnabled] = useState(true);

  // Load tooltip preference from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(TOOLTIPS_STORAGE_KEY);
    if (saved !== null) {
      setTooltipsEnabled(saved === 'true');
    }
  }, []);

  // Save tooltip preference to localStorage
  useEffect(() => {
    localStorage.setItem(TOOLTIPS_STORAGE_KEY, String(tooltipsEnabled));
  }, [tooltipsEnabled]);

  const toggleTooltips = () => {
    setTooltipsEnabled(!tooltipsEnabled);
  };

  return (
    <TooltipContext.Provider value={{ tooltipsEnabled, toggleTooltips, setTooltipsEnabled }}>
      {children}
    </TooltipContext.Provider>
  );
}

export function useTooltipContext() {
  const context = useContext(TooltipContext);
  if (context === undefined) {
    throw new Error('useTooltipContext must be used within a TooltipProvider');
  }
  return context;
}