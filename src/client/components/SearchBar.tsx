import React from 'react';
import { useT } from '../i18n/index.ts';
import { SearchIcon, CloseIcon } from './Icons.tsx';

interface SearchBarProps {
  query: string;
  matchCount: number | null;
  onChange: (q: string) => void;
  onClose: () => void;
}

export function SearchBar({ query, matchCount, onChange, onClose }: SearchBarProps) {
  const t = useT();
  return (
    <div className="search-bar">
      <SearchIcon size={14} className="search-bar-icon" />
      <input
        type="text"
        placeholder={t('search.placeholder')}
        value={query}
        onChange={(e) => onChange(e.target.value)}
        autoFocus
        aria-label={t('search.placeholder')}
      />
      <button onClick={onClose} aria-label={t('search.close')}><CloseIcon size={14} /></button>
      {query && matchCount !== null && (
        <span className="search-hint" role="status" aria-live="polite">
          {matchCount > 0
            ? t(matchCount === 1 ? 'search.match' : 'search.matches', { n: matchCount })
            : t('search.noMatch')}
        </span>
      )}
      {!query && <span className="search-hint">{t('search.debounced')}</span>}
    </div>
  );
}