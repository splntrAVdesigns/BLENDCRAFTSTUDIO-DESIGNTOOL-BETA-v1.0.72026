import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface DragContextType {
  isDragging: boolean;
  startDrag: () => void;
  endDrag: () => void;
}

const DragContext = createContext<DragContextType | undefined>(undefined);

export function DragProvider({ children }: { children: ReactNode }) {
  const [isDragging, setIsDragging] = useState(false);
  
  const startDrag = useCallback(() => {
    setIsDragging(true);
  }, []);
  
  const endDrag = useCallback(() => {
    setIsDragging(false);
  }, []);
  
  return (
    <DragContext.Provider value={{ isDragging, startDrag, endDrag }}>
      {children}
    </DragContext.Provider>
  );
}

export function useDrag() {
  const context = useContext(DragContext);
  if (!context) {
    throw new Error('useDrag must be used within DragProvider');
  }
  return context;
}
