import React, { useState, useRef, useEffect } from 'react';
import { useT } from '../i18n/index.ts';
import { SearchIcon, CloseIcon } from './Icons.tsx';

export interface SearchResultItem {
  id: string;
  label: string;
  type: string;
  filePath: string;
}

interface SearchBarProps {
  query: string;
  matchCount: number | null;
  searchResults: SearchResultItem[];
  onChange: (q: string) => void;
  onClose: () => void;
  onSelectResult: (id: string) => void;
}

export function SearchBar({ query, matchCount, searchResults, onChange, onClose, onSelectResult }: SearchBarProps) {
  const t = useT();
  const [showResults, setShowResults] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (id: string) => {
    onSelectResult(id);
    setShowResults(false);
  };

  return (
    <div className="search-bar" ref={containerRef}>
      <SearchIcon size={14} className="search-bar-icon" />
      <input
        id="graph-search"
        name="graph-search"
        type="text"
        placeholder={t('search.placeholder')}
        value={query}
        onChange={(e) => { onChange(e.target.value); setShowResults(true); }}
        onFocus={() => setShowResults(true)}
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
      {showResults && query && searchResults.length > 0 && (
        <ul className="search-results" role="listbox">
          {searchResults.slice(0, 10).map((item) => (
            <li key={item.id} role="option" aria-selected="false"
              className="search-result-item"
              onClick={() => handleSelect(item.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSelect(item.id); }}
              tabIndex={0}
            >
              <span className="search-result-type">{item.type}</span>
              <span className="search-result-label">{item.label}</span>
              <span className="search-result-path">{item.filePath}</span>
            </li>
          ))}
          {searchResults.length > 10 && (
            <li className="search-result-more">
              {t('search.moreResults', { n: searchResults.length - 10 })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
