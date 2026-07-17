// Generic retrieval over a directory of Bee-format transcripts:
//   Title
//   Date: <parseable date>
//   OVERVIEW / ATMOSPHERE / KEY TAKEAWAYS / ACTION ITEMS / TRANSCRIPT
//   ----------
//   ...section body...
//
// Two retrieval modes, tried in order:
//   1. Temporal — "what happened in february", "on june 3rd" — matched files' summaries
//   2. Keyword  — scores every file by keyword hit count, returns top N transcripts

const fs = require('fs');
const path = require('path');

const STOP_WORDS = new Set([
  'i', 'me', 'my', 'we', 'you', 'he', 'she', 'it', 'they', 'what', 'which', 'who',
  'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'can', 'the', 'and', 'but', 'or', 'so', 'for', 'of', 'in', 'on',
  'at', 'to', 'up', 'by', 'as', 'if', 'any', 'about', 'your', 'his', 'her', 'our',
  'just', 'like', 'know', 'think', 'yeah', 'okay', 'got', 'get', 'go',
]);

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function extractSection(text, header) {
  const pattern = new RegExp(
    `${header}\\s*[-=]+\\s*([\\s\\S]+?)(?=\\n[A-Z][A-Z ]+\\s*[-=]+|$)`, 'i'
  );
  const m = text.match(pattern);
  return m ? m[1].trim() : '';
}

function extractTranscript(text) {
  const m = text.match(/TRANSCRIPT\s*[-=]+\s*([\s\S]+?)$/i);
  return m ? m[1].trim() : '';
}

function extractTitle(text) {
  return text.split('\n')[0].trim();
}

function extractDate(text) {
  const m = text.match(/^Date:\s*(.+)/m);
  return m ? m[1].trim() : '';
}

// Loads and caches every .txt file in `dir` once. Callers that need a fresh
// read (e.g. after a sync) should construct a new TranscriptIndex.
class TranscriptIndex {
  constructor(dir) {
    this.dir = dir;
    this._files = null;
  }

  files() {
    if (this._files) return this._files;
    if (!fs.existsSync(this.dir)) return (this._files = []);
    const names = fs.readdirSync(this.dir).filter(f => f.endsWith('.txt')).sort();
    this._files = names.map(name => {
      const raw = fs.readFileSync(path.join(this.dir, name), 'utf8');
      const date = extractDate(raw);
      const parsed = date ? new Date(date) : null;
      return {
        name,
        raw,
        lower: raw.toLowerCase(),
        title: extractTitle(raw),
        date,
        parsedDate: parsed && !isNaN(parsed) ? parsed : null,
      };
    });
    return this._files;
  }

  count() {
    return this.files().length;
  }

  detectTemporal(query) {
    const q = query.toLowerCase();
    for (let i = 0; i < MONTHS.length; i++) {
      if (!q.includes(MONTHS[i])) continue;
      const dayMatch = q.match(new RegExp(MONTHS[i] + '\\s+(\\d{1,2})'));
      if (dayMatch) return { type: 'date', month: i, day: parseInt(dayMatch[1], 10) };
      return { type: 'month', month: i };
    }
    return null;
  }

  searchByTemporal(temporal) {
    const dated = this.files().filter(f => f.parsedDate);

    if (temporal.type === 'date') {
      const matches = dated.filter(f =>
        f.parsedDate.getMonth() === temporal.month && f.parsedDate.getDate() === temporal.day
      );
      return matches.map(f => this._fullExcerpt(f)).join('\n\n');
    }

    if (temporal.type === 'month') {
      const matches = dated.filter(f => f.parsedDate.getMonth() === temporal.month);
      if (matches.length === 0) return '';
      const monthName = MONTHS[temporal.month];
      const summaries = matches.map(f => {
        const overview = extractSection(f.raw, 'OVERVIEW');
        const takeaways = extractSection(f.raw, 'KEY TAKEAWAYS');
        const parts = [`[${f.date}] ${f.title}`];
        if (overview) parts.push(`  ${overview.slice(0, 120)}`);
        if (takeaways) parts.push(`  Key: ${takeaways.slice(0, 80)}`);
        return parts.join('\n');
      }).join('\n\n');
      return `All ${monthName} entries (${matches.length} total):\n\n${summaries}`;
    }

    return '';
  }

  searchByKeyword(query, topN = 3, minWordLength = 2) {
    const words = query.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > minWordLength && !STOP_WORDS.has(w));

    if (words.length === 0) return '';

    const scored = this.files().map(file => {
      let score = 0;
      for (const word of words) {
        let idx = 0;
        while ((idx = file.lower.indexOf(word, idx)) !== -1) { score++; idx += word.length; }
      }
      return { file, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, topN);

    if (scored.length === 0) return '';
    return scored.map(({ file }) => this._fullExcerpt(file)).join('\n\n');
  }

  // Combined entry point: temporal first, falls back to keyword.
  search(query, topN = 3) {
    const temporal = this.detectTemporal(query);
    if (temporal) {
      const result = this.searchByTemporal(temporal);
      if (result) return result;
    }
    return this.searchByKeyword(query, topN);
  }

  _fullExcerpt(file) {
    const transcript = extractTranscript(file.raw);
    return `=== ${file.date}: ${file.title} ===\n${transcript || file.raw}`;
  }
}

module.exports = { TranscriptIndex, extractSection, extractTranscript, extractTitle, extractDate };
