import React, { useRef, useState } from 'react';
import type { Locale } from '../../shared/i18n';

interface Props {
  file: File | null;
  enabled: boolean;
  busy: boolean;
  locale: Locale;
  onFileSelect: (file: File | null) => void;
}

export function HistoricalImportPanel({ file, enabled, busy, locale, onFileSelect }: Props) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (enabled && !busy) setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!enabled || busy) return;
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && droppedFile.name.endsWith('.xlsx')) {
      onFileSelect(droppedFile);
    }
  };

  return (
    <div
      className={`sk-dropzone ${isDragOver ? 'sk-dropzone--active' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => enabled && !busy && inputRef.current?.click()}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && enabled && !busy) {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      role="button"
      tabIndex={enabled && !busy ? 0 : -1}
      aria-disabled={!enabled || busy}
      data-testid="paperbook-dropzone"
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        disabled={!enabled || busy}
        onChange={(e) => onFileSelect(e.target.files?.[0] ?? null)}
      />

      <div className="sk-dropzone__content">
        <svg className="sk-dropzone__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>

        {file ? (
          <div className="sk-dropzone__file-info">
            <span className="sk-badge sk-badge--success">
              {locale === 'ar' ? 'تم اختيار الملف' : 'File Selected'}
            </span>
            <strong className="sk-dropzone__filename">{file.name}</strong>
            <span className="sk-dropzone__filesize">
              {(file.size / 1024).toFixed(1)} KB
            </span>
          </div>
        ) : (
          <div className="sk-dropzone__prompt">
            <strong>
              {locale === 'ar'
                ? 'اسحب ملف Stockiha_Historical_Transactions_v3_Benefit_Expenses.xlsx هنا'
                : 'Drag & Drop Stockiha_Historical_Transactions_v3_Benefit_Expenses.xlsx here'}
            </strong>
            <span>{locale === 'ar' ? 'أو انقر لاختيار الملف من الجهاز' : 'or click to browse from computer'}</span>
          </div>
        )}
      </div>
    </div>
  );
}
