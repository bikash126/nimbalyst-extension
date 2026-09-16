import { useEffect, useRef, useState } from 'react';

interface BranchComboboxProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function BranchCombobox({ value, options, onChange, disabled }: BranchComboboxProps) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setQuery(value);
  }, [value, open]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery(value);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [value]);

  const filtered = options.filter((b) => b.toLowerCase().includes(query.toLowerCase()));

  function selectBranch(branch: string) {
    onChange(branch);
    setQuery(branch);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlightIndex]) {
        selectBranch(filtered[highlightIndex]);
      } else if (query.trim()) {
        selectBranch(query.trim());
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery(value);
    }
  }

  return (
    <div className="twl-combobox" ref={containerRef}>
      <input
        className="twl-input"
        type="text"
        value={query}
        disabled={disabled}
        placeholder="Search branch…"
        onFocus={() => { setOpen(true); setHighlightIndex(0); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlightIndex(0); }}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && (
        <ul className="twl-combobox-list">
          {filtered.map((branch, index) => (
            <li
              key={branch}
              className={`twl-combobox-option${index === highlightIndex ? ' highlighted' : ''}${branch === value ? ' selected' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); selectBranch(branch); }}
              onMouseEnter={() => setHighlightIndex(index)}
            >
              {branch}
            </li>
          ))}
        </ul>
      )}
      {open && filtered.length === 0 && query.trim() && (
        <ul className="twl-combobox-list">
          <li className="twl-combobox-option" onMouseDown={(e) => { e.preventDefault(); selectBranch(query.trim()); }}>
            Use "{query.trim()}"
          </li>
        </ul>
      )}
    </div>
  );
}
