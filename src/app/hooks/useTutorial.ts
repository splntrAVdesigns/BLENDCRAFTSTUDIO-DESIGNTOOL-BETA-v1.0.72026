import { useState, useEffect } from 'react';

const TUTORIAL_STORAGE_KEY = 'blendcraft-tutorial-completed';

/**
 * Hook to manage tutorial state
 */
export function useTutorial() {
  const [showTutorial, setShowTutorial] = useState(false);
  const [isFirstTime, setIsFirstTime] = useState(true);

  useEffect(() => {
    // Check if user has completed tutorial before
    const completed = localStorage.getItem(TUTORIAL_STORAGE_KEY);
    setIsFirstTime(!completed);
    
    // Show tutorial if first time
    if (!completed) {
      setShowTutorial(true);
    }
  }, []);

  const completeTutorial = () => {
    localStorage.setItem(TUTORIAL_STORAGE_KEY, 'true');
    setShowTutorial(false);
    setIsFirstTime(false);
  };

  const skipTutorial = () => {
    localStorage.setItem(TUTORIAL_STORAGE_KEY, 'true');
    setShowTutorial(false);
  };

  const resetTutorial = () => {
    localStorage.removeItem(TUTORIAL_STORAGE_KEY);
    setIsFirstTime(true);
  };

  const openTutorial = () => {
    setShowTutorial(true);
  };

  return {
    showTutorial,
    isFirstTime,
    completeTutorial,
    skipTutorial,
    resetTutorial,
    openTutorial,
  };
}
