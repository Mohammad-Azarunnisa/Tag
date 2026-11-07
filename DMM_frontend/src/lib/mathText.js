// The assistant sometimes answers with LaTeX (\text{…}, \frac{a}{b}, \left( … \right)).
// This UI has no maths renderer, so it came out as raw backslash commands. This turns
// the common ones into plain, readable text — "(11,967 − 9,067) ÷ 9,067 × 100 = 32.0%" —
// and reports which lines were whole formulas so they can be shown as a formula box.

const SYMBOLS = {
  times: '×', cdot: '·', div: '÷', approx: '≈', neq: '≠', leq: '≤', geq: '≥', le: '≤', ge: '≥',
  pm: '±', rightarrow: '→', to: '→', Rightarrow: '⇒', longrightarrow: '→', ldots: '…', dots: '…',
  infty: '∞', quad: ' ', qquad: '  ', '%': '%', '$': '$', '&': '&', '#': '#', '_': '_',
};

// \frac{a}{b} with nesting — innermost first, until none are left.
const fracs = (s) => {
  let prev;
  do {
    prev = s;
    s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_, a, b) => {
      const wrap = (x) => (/^[\w.,%]+$/.test(x.trim()) ? x.trim() : `(${x.trim()})`);
      return `${wrap(a)} ÷ ${wrap(b)}`;
    });
  } while (s !== prev);
  return s;
};

export function mathToPlain(input) {
  let s = String(input || '');
  // JSON-escaped backslashes that arrive doubled (\\text) read as the single command.
  s = s.replace(/\\\\(?=[A-Za-z(){}[\]%,;:! ])/g, '\\');
  s = s.replace(/\\(?:text|textbf|textit|mathrm|mathbf|mathit|operatorname|boldsymbol)\s*\{([^{}]*)\}/g, '$1');
  s = fracs(s);
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)');
  s = s.replace(/\\(?:left|right|big|Big|bigg|Bigg)\s*(?=[()[\]|.{}\\])/g, '');
  s = s.replace(/\\([A-Za-z]+|[%$&#_])/g, (m, name) => (name in SYMBOLS ? SYMBOLS[name] : ''));
  s = s.replace(/\\[,;:! ]/g, ' ').replace(/\\([{}])/g, '$1');
  s = s.replace(/[{}]/g, '');
  s = s.replace(/\^\{?\\?circ\}?/g, '°');
  return s.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/[ \t]{2,}/g, ' ').trim();
}

const looksLikeMath = (s) => /\\[A-Za-z]+|\\[()[\]]/.test(s);

/**
 * Prepare a reply for the markdown renderer. Returns the text with LaTeX turned into
 * plain text. A line that was a whole display formula (\[ … \], $$ … $$) is prefixed
 * with the marker so the renderer can show it as a formula box.
 */
export const FORMULA_MARK = '⁣';
export function cleanMath(text) {
  let s = String(text || '');
  if (!looksLikeMath(s) && !/\$\$/.test(s)) return s;
  // Display maths (may span lines).
  s = s.replace(/\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$/g, (_, a, b) => `\n${FORMULA_MARK}${mathToPlain((a ?? b).replace(/\n/g, ' '))}\n`);
  // Inline maths.
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, a) => mathToPlain(a));
  s = s.replace(/(?<![\\$\w])\$([^$\n]+?)\$(?!\w)/g, (m, a) => (looksLikeMath(a) || /[=^_]/.test(a) ? mathToPlain(a) : m));
  // Bare commands left outside any delimiter.
  if (looksLikeMath(s)) s = s.split('\n').map((l) => (looksLikeMath(l) ? mathToPlain(l) : l)).join('\n');
  return s;
}
