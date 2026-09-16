import { useRef } from 'react';

interface MarkdownTextareaProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}

interface WrapAction {
  before: string;
  after?: string;
  placeholder: string;
}

interface LinePrefixAction {
  prefix: string;
}

const WRAP_ACTIONS: Record<string, WrapAction> = {
  bold: { before: '**', after: '**', placeholder: 'bold text' },
  italic: { before: '_', after: '_', placeholder: 'italic text' },
  code: { before: '`', after: '`', placeholder: 'code' },
  codeBlock: { before: '```\n', after: '\n```', placeholder: 'code block' },
  link: { before: '[', after: '](https://)', placeholder: 'link text' },
};

const LINE_PREFIX_ACTIONS: Record<string, LinePrefixAction> = {
  bullet: { prefix: '- ' },
  numbered: { prefix: '1. ' },
  heading: { prefix: '## ' },
  quote: { prefix: '> ' },
};

export function MarkdownTextarea({ value, onChange, rows = 4, placeholder }: MarkdownTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function applyWrap(action: WrapAction) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end) || action.placeholder;
    const after = action.after ?? action.before;
    const next = value.slice(0, start) + action.before + selected + after + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursorStart = start + action.before.length;
      el.setSelectionRange(cursorStart, cursorStart + selected.length);
    });
  }

  function applyLinePrefix(action: LinePrefixAction) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = value.indexOf('\n', end);
    const affectedEnd = lineEnd === -1 ? value.length : lineEnd;
    const block = value.slice(lineStart, affectedEnd);
    const prefixedBlock = block
      .split('\n')
      .map((line) => (line.startsWith(action.prefix) ? line : `${action.prefix}${line}`))
      .join('\n');
    const next = value.slice(0, lineStart) + prefixedBlock + value.slice(affectedEnd);
    onChange(next);
    requestAnimationFrame(() => el.focus());
  }

  return (
    <div>
      <div className="twl-md-toolbar">
        <button type="button" className="twl-md-btn" title="Bold" onClick={() => applyWrap(WRAP_ACTIONS.bold)}><strong>B</strong></button>
        <button type="button" className="twl-md-btn" title="Italic" onClick={() => applyWrap(WRAP_ACTIONS.italic)}><em>i</em></button>
        <button type="button" className="twl-md-btn" title="Inline code" onClick={() => applyWrap(WRAP_ACTIONS.code)}>{'</>'}</button>
        <button type="button" className="twl-md-btn" title="Code block" onClick={() => applyWrap(WRAP_ACTIONS.codeBlock)}>{'{ }'}</button>
        <button type="button" className="twl-md-btn" title="Link" onClick={() => applyWrap(WRAP_ACTIONS.link)}>🔗</button>
        <span className="twl-md-sep" />
        <button type="button" className="twl-md-btn" title="Heading" onClick={() => applyLinePrefix(LINE_PREFIX_ACTIONS.heading)}>H</button>
        <button type="button" className="twl-md-btn" title="Bullet list" onClick={() => applyLinePrefix(LINE_PREFIX_ACTIONS.bullet)}>•</button>
        <button type="button" className="twl-md-btn" title="Numbered list" onClick={() => applyLinePrefix(LINE_PREFIX_ACTIONS.numbered)}>1.</button>
        <button type="button" className="twl-md-btn" title="Quote" onClick={() => applyLinePrefix(LINE_PREFIX_ACTIONS.quote)}>&rdquo;</button>
      </div>
      <textarea
        ref={textareaRef}
        className="twl-textarea twl-md-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
      />
    </div>
  );
}
