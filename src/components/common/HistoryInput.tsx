import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Clock, X } from 'lucide-react';
import { safeStorage } from '../../utils/storage';

export interface HistoryInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  historyKey: string;
  defaultSuggestions?: string[];
  maxSuggestions?: number;
  wrapperClassName?: string;
  dropdownClassName?: string;
  onSelectHistoryItem?: (item: string) => void;
  autoSaveOnEnter?: boolean;
  autoSaveOnBlur?: boolean;
}

export interface HistoryInputHandle {
  focus: () => void;
  saveToHistory: (val?: string) => void;
  clearHistory: () => void;
}

/**
 * Utility to manually persist any entered text into the history store for a given historyKey
 */
export function saveInputHistory(key: string, value: string, maxItems: number = 25) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length < 2) return;
  try {
    const storageKey = `plsms_history_${key}`;
    const stored = safeStorage.getItem(storageKey);
    let prev: string[] = [];
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) prev = parsed;
      } catch (e) {}
    }
    const filtered = prev.filter((item) => item.toLowerCase() !== trimmed.toLowerCase());
    const updated = [trimmed, ...filtered].slice(0, maxItems);
    safeStorage.setItem(storageKey, JSON.stringify(updated));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(`plsms:history-updated:${key}`, { detail: { history: updated } }));
    }
  } catch (e) {}
}

/**
 * A reusable input component that displays previously searched/typed history
 * matching the user's input approximately while typing, with a dismissable dropdown.
 */
export const HistoryInput = forwardRef<HistoryInputHandle, HistoryInputProps>(
  (
    {
      historyKey,
      defaultSuggestions = [],
      maxSuggestions = 6,
      wrapperClassName,
      dropdownClassName,
      onSelectHistoryItem,
      autoSaveOnEnter = true,
      autoSaveOnBlur = false,
      value,
      onChange,
      onFocus,
      onKeyDown,
      onBlur,
      className,
      placeholder,
      ...restProps
    },
    ref
  ) => {
    const internalInputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [showDropdown, setShowDropdown] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(-1);

    const [history, setHistory] = useState<string[]>(() => {
      try {
        const storageKey = `plsms_history_${keySanitized(historyKey)}`;
        const stored = safeStorage.getItem(storageKey);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch (e) {}
      return defaultSuggestions;
    });

    function keySanitized(k: string) {
      return k.replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    const currentKey = keySanitized(historyKey);

    // Sync when storage or another component updates this historyKey
    useEffect(() => {
      const handleStorageUpdate = (e: any) => {
        if (e.detail?.history && Array.isArray(e.detail.history)) {
          setHistory(e.detail.history);
        }
      };
      window.addEventListener(`plsms:history-updated:${currentKey}`, handleStorageUpdate);
      return () => {
        window.removeEventListener(`plsms:history-updated:${currentKey}`, handleStorageUpdate);
      };
    }, [currentKey]);

    // Close dropdown on outside click
    useEffect(() => {
      const handleOutsideClick = (event: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
          setShowDropdown(false);
        }
      };
      document.addEventListener('mousedown', handleOutsideClick);
      return () => {
        document.removeEventListener('mousedown', handleOutsideClick);
      };
    }, []);

    // Expose methods to parent components
    useImperativeHandle(ref, () => ({
      focus: () => internalInputRef.current?.focus(),
      saveToHistory: (val?: string) => {
        const toSave = val !== undefined ? val : String(value || '');
        saveInputHistory(currentKey, toSave);
      },
      clearHistory: () => {
        try {
          safeStorage.removeItem(`plsms_history_${currentKey}`);
          setHistory([]);
        } catch (e) {}
      },
    }));

    const handleRemoveItem = (e: React.MouseEvent, itemToRemove: string) => {
      e.stopPropagation();
      e.preventDefault();
      setHistory((prev) => {
        const updated = prev.filter((item) => item !== itemToRemove);
        try {
          safeStorage.setItem(`plsms_history_${currentKey}`, JSON.stringify(updated));
        } catch (e) {}
        return updated;
      });
    };

    const handleSelectItem = (item: string) => {
      setShowDropdown(false);
      setSelectedIndex(-1);

      // Trigger synthetic change event for React forms
      if (internalInputRef.current) {
        internalInputRef.current.value = item;
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(internalInputRef.current, item);
        }
        const event = new Event('input', { bubbles: true });
        internalInputRef.current.dispatchEvent(event);
      }

      if (onSelectHistoryItem) {
        onSelectHistoryItem(item);
      }
    };

    // Filter history entries that approximately match what the user is typing
    const currentStr = String(value || '');
    const filteredMatches = React.useMemo(() => {
      const q = currentStr.trim().toLowerCase();
      if (!q) {
        return history.slice(0, maxSuggestions);
      }
      const cleanQ = q.replace(/[^a-zA-Z0-9]/g, '');
      return history.filter((item) => {
        const itemLower = item.toLowerCase();
        const cleanItem = itemLower.replace(/[^a-zA-Z0-9]/g, '');
        return itemLower.includes(q) || (cleanQ.length >= 2 && cleanItem.includes(cleanQ));
      }).slice(0, maxSuggestions);
    }, [currentStr, history, maxSuggestions]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (showDropdown && filteredMatches.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev < filteredMatches.length - 1 ? prev + 1 : 0));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredMatches.length - 1));
          return;
        }
        if (e.key === 'Enter' && selectedIndex >= 0 && selectedIndex < filteredMatches.length) {
          e.preventDefault();
          handleSelectItem(filteredMatches[selectedIndex]);
          return;
        }
        if (e.key === 'Escape') {
          setShowDropdown(false);
          return;
        }
      }

      if (e.key === 'Enter' && autoSaveOnEnter) {
        saveInputHistory(currentKey, currentStr);
      }

      if (onKeyDown) {
        onKeyDown(e);
      }
    };

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      setShowDropdown(true);
      setSelectedIndex(-1);
      if (onFocus) onFocus(e);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      if (autoSaveOnBlur && currentStr) {
        saveInputHistory(currentKey, currentStr);
      }
      if (onBlur) onBlur(e);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setShowDropdown(true);
      setSelectedIndex(-1);
      if (onChange) onChange(e);
    };

    return (
      <div ref={containerRef} className={wrapperClassName || 'relative flex-1'}>
        <input
          ref={internalInputRef}
          value={value}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={className}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck="false"
          {...restProps}
        />

        {/* Clear input button if non-empty and type is text */}
        {Boolean(value) && (
          <button
            type="button"
            onClick={() => {
              if (internalInputRef.current) {
                internalInputRef.current.value = '';
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                  window.HTMLInputElement.prototype,
                  'value'
                )?.set;
                if (nativeInputValueSetter) {
                  nativeInputValueSetter.call(internalInputRef.current, '');
                }
                const event = new Event('input', { bubbles: true });
                internalInputRef.current.dispatchEvent(event);
              }
              setSelectedIndex(-1);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 p-1"
            title="Clear"
          >
            <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
        )}

        {/* Dropdown displaying matching previous history entries */}
        {showDropdown && filteredMatches.length > 0 && (
          <div
            onMouseDown={(e) => e.preventDefault()}
            className={
              dropdownClassName ||
              'absolute left-0 right-0 top-full mt-1.5 z-50 bg-[#071325] dark:bg-[#071325] border border-cyan-900/40 dark:border-[#1a2d4c] rounded-xl overflow-hidden shadow-2xl backdrop-blur-md divide-y divide-[#0f2139] animate-in fade-in slide-in-from-top-1 duration-150 max-h-64 overflow-y-auto'
            }
          >
            {filteredMatches.map((item, index) => {
              const isSelected = selectedIndex === index;
              return (
                <div
                  key={`${item}-${index}`}
                  onClick={() => handleSelectItem(item)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`w-full px-4 py-2.5 sm:py-3 flex items-center justify-between transition-colors cursor-pointer group ${
                    isSelected
                      ? 'bg-[#0d2342] text-[#22D3EE]'
                      : 'hover:bg-[#0a1b32] text-slate-200 dark:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Clock
                      className={`w-4 h-4 shrink-0 transition-colors ${
                        isSelected ? 'text-[#22D3EE]' : 'text-[#22D3EE]/80 dark:text-[#22D3EE]'
                      }`}
                    />
                    <span
                      className={`font-mono text-xs sm:text-sm tracking-wider truncate ${
                        isSelected
                          ? 'text-[#22D3EE] font-bold'
                          : 'text-slate-200 dark:text-slate-200 group-hover:text-[#22D3EE]'
                      }`}
                    >
                      {item}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleRemoveItem(e, item)}
                    title="Remove from search history"
                    className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-700/50 transition-colors ml-2 shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }
);

HistoryInput.displayName = 'HistoryInput';
