import { useEffect } from 'react';
import { instruments } from '@/utils/ManualTrading/constants';

interface UseKeyboardShortcutsProps {
  isPaused: boolean;
  selectedPreset: number | null;
  handleTogglePause: () => void;
  handlePresetClick: (preset: number) => void;
  handleQuickMarketOrder: (side: 'buy' | 'sell', preset: number) => void;
  setSelectedInstrument: (instrument: string) => void;
}

/**
 * Custom hook for keyboard shortcuts
 * Handles global keyboard event listeners for Quick Actions
 */
export function useKeyboardShortcuts({
  isPaused,
  selectedPreset,
  handleTogglePause,
  handlePresetClick,
  handleQuickMarketOrder,
  setSelectedInstrument,
}: UseKeyboardShortcutsProps) {
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignore if focus is in input elements
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Space - toggle pause
      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePause();
      }

      // Q/W/E/R - Presets (25%/50%/75%/100%)
      const presetKeys: Record<string, number> = {
        KeyQ: 25,
        KeyW: 50,
        KeyE: 75,
        KeyR: 100,
      };
      if (presetKeys[e.code]) {
        e.preventDefault();
        handlePresetClick(presetKeys[e.code]);
      }

      // B/S - Quick buy/sell (requires preset selection)
      if ((e.code === 'KeyB' || e.code === 'KeyS') && selectedPreset) {
        e.preventDefault();
        handleQuickMarketOrder(
          e.code === 'KeyB' ? 'buy' : 'sell',
          selectedPreset,
        );
      }

      // 1-4 - Switch instruments
      const instrumentKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
      const instrumentIndex = instrumentKeys.indexOf(e.code);
      if (instrumentIndex !== -1 && instruments[instrumentIndex]) {
        e.preventDefault();
        setSelectedInstrument(instruments[instrumentIndex]);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [
    isPaused,
    selectedPreset,
    handleTogglePause,
    handlePresetClick,
    handleQuickMarketOrder,
    setSelectedInstrument,
  ]);
}
