import { useState, useEffect } from 'react';

const STORAGE_KEYS = {
  LEFT_PANEL: 'gradientStudio_leftPanelCollapsed',
  RIGHT_PANEL: 'gradientStudio_rightPanelCollapsed',
};

export function usePanelState() {
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.LEFT_PANEL);
      return saved ? JSON.parse(saved) : false;
    } catch {
      return false;
    }
  });

  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.RIGHT_PANEL);
      return saved ? JSON.parse(saved) : false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.LEFT_PANEL, JSON.stringify(leftPanelCollapsed));
    } catch (error) {
      console.error('Failed to save left panel state:', error);
    }
  }, [leftPanelCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.RIGHT_PANEL, JSON.stringify(rightPanelCollapsed));
    } catch (error) {
      console.error('Failed to save right panel state:', error);
    }
  }, [rightPanelCollapsed]);

  return {
    leftPanelCollapsed,
    setLeftPanelCollapsed,
    rightPanelCollapsed,
    setRightPanelCollapsed,
  };
}