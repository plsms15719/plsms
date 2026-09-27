import React, { useState, useEffect, useRef } from 'react';
import { Calendar, ChevronLeft, ChevronRight, X, Check, Clock } from 'lucide-react';
import {
  NEP_DAYS,
  NEP_MONTHS,
  toNepaliDevanagariDigits,
  getDaysInNepaliMonth,
  getNepaliMonthStartDay,
  isValidNepaliBSDate,
  getNepaliDate,
} from '../../utils/dateUtils';

export interface NepaliDatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  minDate?: string;
  maxDate?: string;
  className?: string;
  inputClassName?: string;
  required?: boolean;
  autoFocus?: boolean;
  align?: 'left' | 'right' | 'auto';
}

const NEP_MONTH_NAMES_EN = [
  'Baisakh (वैशाख)',
  'Jestha (जेठ)',
  'Asar (असार)',
  'Shrawan (साउन)',
  'Bhadra (भदौ)',
  'Aswin (असोज)',
  'Kartik (कात्तिक)',
  'Mangsir (मंसिर)',
  'Poush (पुस)',
  'Magh (माघ)',
  'Falgun (फागुन)',
  'Chaitra (चैत)',
];

const NEP_DAYS_SHORT = ['आइत', 'सोम', 'मङ्गल', 'बुध', 'बिही', 'शुक्र', 'शनि'];

export const NepaliDatePicker: React.FC<NepaliDatePickerProps> = ({
  value,
  onChange,
  label,
  placeholder = 'YYYY-MM-DD',
  id,
  disabled = false,
  minDate,
  maxDate,
  className = '',
  inputClassName = '',
  required = false,
  align = 'auto',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse current value or fallback to today
  const todayBS = getNepaliDate(new Date());
  const [todayYear, todayMonth, todayDay] = todayBS.split('-').map((v) => parseInt(v, 10));

  const parsedInitial = value && isValidNepaliBSDate(value)
    ? value.split('-').map((v) => parseInt(v, 10))
    : [todayYear, todayMonth, todayDay];

  const [viewYear, setViewYear] = useState<number>(parsedInitial[0] || todayYear || 2083);
  const [viewMonth, setViewMonth] = useState<number>((parsedInitial[1] || todayMonth || 5) - 1); // 0-indexed

  // Keep view in sync when value changes externally
  useEffect(() => {
    if (value && isValidNepaliBSDate(value)) {
      const [y, m] = value.split('-').map((v) => parseInt(v, 10));
      if (y && m) {
        setViewYear(y);
        setViewMonth(m - 1);
      }
    }
  }, [value]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const daysInMonth = getDaysInNepaliMonth(viewYear, viewMonth);
  const startDayOfWeek = getNepaliMonthStartDay(viewYear, viewMonth); // 0 (Sun) - 6 (Sat)

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((prev) => prev - 1);
      setViewMonth(11);
    } else {
      setViewMonth((prev) => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((prev) => prev + 1);
      setViewMonth(0);
    } else {
      setViewMonth((prev) => prev + 1);
    }
  };

  const handleSelectDay = (day: number) => {
    const mm = String(viewMonth + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const selectedDateStr = `${viewYear}-${mm}-${dd}`;
    onChange(selectedDateStr);
    setIsOpen(false);
  };

  const handleSelectToday = () => {
    onChange(todayBS);
    const [y, m] = todayBS.split('-').map((v) => parseInt(v, 10));
    setViewYear(y);
    setViewMonth(m - 1);
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange('');
    setIsOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    onChange(raw);
  };

  // Selected date components
  let selectedYear: number | null = null;
  let selectedMonth: number | null = null;
  let selectedDay: number | null = null;

  if (value && isValidNepaliBSDate(value)) {
    const [y, m, d] = value.split('-').map((v) => parseInt(v, 10));
    selectedYear = y;
    selectedMonth = m - 1;
    selectedDay = d;
  }

  // Generate Year Options from 2000 BS to 2095 BS
  const yearOptions: number[] = [];
  for (let y = 2095; y >= 2000; y--) {
    yearOptions.push(y);
  }

  // Calendar cells
  const blanks = Array.from({ length: startDayOfWeek });
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  return (
    <div ref={containerRef} className={`relative inline-block w-full ${className}`}>
      {label && (
        <label
          htmlFor={id}
          className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider font-mono mb-1 select-none"
        >
          {label}
        </label>
      )}

      {/* Input container */}
      <div className="relative flex items-center">
        <input
          id={id}
          type="text"
          value={value}
          onChange={handleInputChange}
          onClick={() => !disabled && setIsOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          className={`w-full pl-8 pr-7 py-1.5 bg-white dark:bg-[#040a14] border border-slate-300 dark:border-slate-700/80 rounded-lg text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all ${
            disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
          } ${inputClassName}`}
        />

        {/* Left Calendar Icon */}
        <button
          type="button"
          onClick={() => !disabled && setIsOpen((prev) => !prev)}
          disabled={disabled}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-cyan-500 dark:hover:text-cyan-400 transition-colors cursor-pointer"
          title="Open Nepali Calendar Picker"
        >
          <Calendar className="w-3.5 h-3.5" />
        </button>

        {/* Right Clear Icon */}
        {value && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 rounded transition-colors cursor-pointer"
            title="Clear date"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Dropdown Calendar Popup */}
      {isOpen && (
        <div
          id={`${id || 'nepali-datepicker'}-dropdown`}
          className={`absolute z-50 mt-1.5 w-72 sm:w-80 p-3 rounded-xl bg-white dark:bg-[#071120] border border-slate-200 dark:border-cyan-500/40 shadow-2xl shadow-slate-400/20 dark:shadow-cyan-950/50 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150 ${
            align === 'right' ? 'right-0' : align === 'left' ? 'left-0' : 'left-0 sm:left-auto right-0 sm:right-auto sm:left-0'
          }`}
          style={{ minWidth: '280px' }}
        >
          {/* Header Bar */}
          <div className="flex items-center justify-between gap-1 mb-2 pb-2 border-b border-slate-200 dark:border-slate-700/80">
            {/* Prev Month Button */}
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
              title="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {/* Selectors for Month and Year */}
            <div className="flex items-center gap-1.5">
              {/* Month Select */}
              <select
                value={viewMonth}
                onChange={(e) => setViewMonth(parseInt(e.target.value, 10))}
                className="py-1 px-2 bg-slate-100 dark:bg-[#040a14] border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold text-cyan-800 dark:text-cyan-300 focus:outline-hidden focus:border-cyan-500 cursor-pointer"
              >
                {NEP_MONTH_NAMES_EN.map((name, idx) => (
                  <option key={idx} value={idx} className="bg-white dark:bg-[#081223] text-slate-800 dark:text-white">
                    {name}
                  </option>
                ))}
              </select>

              {/* Year Select */}
              <select
                value={viewYear}
                onChange={(e) => setViewYear(parseInt(e.target.value, 10))}
                className="py-1 px-2 bg-slate-100 dark:bg-[#040a14] border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold font-mono text-cyan-800 dark:text-cyan-300 focus:outline-hidden focus:border-cyan-500 cursor-pointer"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y} className="bg-white dark:bg-[#081223] text-slate-800 dark:text-white">
                    {y} ({toNepaliDevanagariDigits(y)})
                  </option>
                ))}
              </select>
            </div>

            {/* Next Month Button */}
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
              title="Next Month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Current Date (Today) Indicator Banner */}
          <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-500/40 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
                आजको मिति (Today):
              </span>
            </div>
            <button
              type="button"
              onClick={handleSelectToday}
              className="font-mono text-xs font-black text-emerald-700 dark:text-emerald-300 hover:underline cursor-pointer flex items-center gap-1"
              title="Click to select Today"
            >
              <span>{todayBS}</span>
              <span className="text-[10px] opacity-80">({toNepaliDevanagariDigits(todayBS)})</span>
            </button>
          </div>

          {/* Days of Week Header */}
          <div className="grid grid-cols-7 gap-1 text-center mb-1 select-none">
            {NEP_DAYS_SHORT.map((dayName, idx) => (
              <div
                key={idx}
                className={`text-[10px] font-black uppercase py-0.5 rounded ${
                  idx === 6 ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {dayName}
              </div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {/* Blank leading days */}
            {blanks.map((_, i) => (
              <div key={`blank-${i}`} className="h-9" />
            ))}

            {/* Actual Days */}
            {days.map((day) => {
              const isSelected =
                selectedYear === viewYear &&
                selectedMonth === viewMonth &&
                selectedDay === day;

              const isToday =
                todayYear === viewYear &&
                todayMonth === viewMonth + 1 &&
                todayDay === day;

              const dayOfWeek = (startDayOfWeek + day - 1) % 7;
              const isSaturday = dayOfWeek === 6;

              return (
                <button
                  key={`day-${day}`}
                  type="button"
                  onClick={() => handleSelectDay(day)}
                  className={`h-9 w-full rounded-lg text-xs font-mono font-medium flex flex-col items-center justify-center transition-all cursor-pointer relative ${
                    isSelected
                      ? isToday
                        ? 'bg-cyan-600 dark:bg-[#008ba8] text-white font-black shadow-md ring-2 ring-emerald-400 border-2 border-emerald-400 scale-105'
                        : 'bg-cyan-600 dark:bg-[#008ba8] text-white font-black shadow-md ring-1 ring-cyan-300 scale-105'
                      : isToday
                      ? 'bg-emerald-500/15 dark:bg-emerald-500/25 border-2 border-emerald-500 dark:border-emerald-400 text-emerald-900 dark:text-emerald-100 font-black ring-2 ring-emerald-500/30 shadow-sm hover:bg-emerald-500/30'
                      : isSaturday
                      ? 'text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-700 dark:hover:text-rose-200'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-white'
                  }`}
                  title={
                    isToday
                      ? `TODAY (आज): ${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                      : `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                  }
                >
                  {/* Today Badge / Pulse Dot */}
                  {isToday && (
                    <span
                      className="absolute -top-1 -right-1 flex h-2.5 w-2.5 z-10 pointer-events-none"
                      title="Today (आज)"
                    >
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 border border-white dark:border-[#071120]"></span>
                    </span>
                  )}

                  <span className={`leading-none text-[11px] font-bold ${isToday && !isSelected ? 'text-emerald-700 dark:text-emerald-300' : ''}`}>
                    {day}
                  </span>
                  <span
                    className={`text-[8.5px] leading-none ${
                      isToday
                        ? isSelected
                          ? 'text-emerald-200 font-black'
                          : 'text-emerald-700 dark:text-emerald-300 font-black'
                        : 'opacity-75'
                    }`}
                  >
                    {isToday ? 'आज' : toNepaliDevanagariDigits(day)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Footer Quick Actions */}
          <div className="mt-3 pt-2 border-t border-slate-200 dark:border-slate-700/80 flex items-center justify-between gap-1.5 text-xs">
            <button
              type="button"
              onClick={handleSelectToday}
              className="px-2.5 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 border border-emerald-300 dark:border-emerald-500/50 text-emerald-800 dark:text-emerald-300 text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer ring-1 ring-emerald-500/20"
            >
              <Clock className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
              <span>आज ({todayBS})</span>
            </button>

            <div className="flex items-center gap-1.5">
              {value && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-semibold transition-colors cursor-pointer border border-slate-300 dark:border-transparent"
                >
                  हटाउनुहोस्
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-semibold transition-colors cursor-pointer border border-slate-300 dark:border-transparent"
              >
                बन्द
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
