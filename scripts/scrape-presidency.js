// Scrapes speech/press-conference transcripts from the UCSB American
// Presidency Project (presidency.ucsb.edu) — the same reusable pattern
// used to build the bundled Nixon demo persona, generalized so it works
// for any president. This is the "add another public figure" recipe:
// find their document URLs on that site, list them below, run this once.
//
// Usage: node scripts/scrape-presidency.js <persona-id>
// Example: node scripts/scrape-presidency.js trump
//
// Edit SOURCES_BY_PERSONA below to add a new figure — presidency.ucsb.edu
// covers every U.S. president, searchable at presidency.ucsb.edu/advanced-search.

const fs = require('fs');
const path = require('path');

const personaId = process.argv[2];
if (!personaId) {
  console.error('Usage: node scripts/scrape-presidency.js <persona-id>');
  process.exit(1);
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
};

const SOURCES_BY_PERSONA = {
  nixon: [
    { url: 'https://www.presidency.ucsb.edu/documents/address-the-nation-announcing-decision-resign-the-presidency', date: '1974-08-08', title: 'Resignation Speech' },
    { url: 'https://www.presidency.ucsb.edu/documents/address-the-nation-about-the-watergate-investigations', date: '1973-04-30', title: 'Watergate April 1973' },
    { url: 'https://www.presidency.ucsb.edu/documents/the-presidents-news-conference-164', date: '1973-11-17', title: 'I Am Not A Crook Press Conference' },
    { url: 'https://www.presidency.ucsb.edu/documents/address-the-nation-the-war-in-vietnam', date: '1969-11-03', title: 'Silent Majority Speech' },
    { url: 'https://www.presidency.ucsb.edu/documents/inaugural-address-2', date: '1969-01-20', title: 'First Inaugural Address' },
  ],
  reagan: [
    { url: 'https://www.presidency.ucsb.edu/documents/remarks-east-west-relations-the-brandenburg-gate-west-berlin', date: '1987-06-12', title: 'Tear Down This Wall Speech' },
    { url: 'https://www.presidency.ucsb.edu/documents/remarks-the-annual-convention-the-national-association-evangelicals-orlando-florida', date: '1983-03-08', title: 'Evil Empire Speech' },
    { url: 'https://www.presidency.ucsb.edu/documents/farewell-address-the-nation', date: '1989-01-11', title: 'Farewell Address' },
    { url: 'https://www.presidency.ucsb.edu/documents/inaugural-address-10', date: '1981-01-20', title: 'First Inaugural Address' },
  ],
  kennedy: [
    { url: 'https://www.presidency.ucsb.edu/documents/remarks-the-rudolph-wilde-platz-berlin', date: '1963-06-26', title: 'Ich Bin Ein Berliner Speech' },
    { url: 'https://www.presidency.ucsb.edu/documents/address-rice-university-houston-the-nations-space-effort', date: '1962-09-12', title: 'We Choose To Go To The Moon' },
    { url: 'https://www.presidency.ucsb.edu/documents/special-message-the-congress-urgent-national-needs', date: '1961-05-25', title: 'Special Message to Congress on Urgent National Needs' },
  ],
  fdr: [
    { url: 'https://www.presidency.ucsb.edu/documents/inaugural-address-8', date: '1933-03-04', title: 'First Inaugural Address' },
    { url: 'https://www.presidency.ucsb.edu/documents/fireside-chat-6', date: '1942-02-23', title: 'Fireside Chat on the Progress of the War' },
  ],
};

const SOURCES = SOURCES_BY_PERSONA[personaId];
if (!SOURCES) {
  console.error(`No SOURCES entry for "${personaId}". Add one to SOURCES_BY_PERSONA in this file — find document URLs at presidency.ucsb.edu/advanced-search.`);
  process.exit(1);
}

const OUT_DIR = path.join(__dirname, '..', 'personas', personaId, 'transcripts');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

async function fetchTranscript(entry) {
  const res = await fetch(entry.url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  let match = html.match(/class="field-docs-content"[^>]*>([\s\S]+?)<\/div>\s*<\/div>/);
  if (!match) match = html.match(/class="field-docs-content"[^>]*>([\s\S]+?)<\/div>/);
  if (!match) match = html.match(/<div class="doc-content[^"]*">([\s\S]+?)<\/div>/);
  if (!match) match = html.match(/<article[^>]*>([\s\S]+?)<\/article>/);
  if (!match) throw new Error('Could not find content div');

  let raw = match[1];
  raw = raw.replace(/<br\s*\/?>/gi, '\n');
  raw = raw.replace(/<\/p>/gi, '\n\n');
  raw = raw.replace(/<\/h\d>/gi, '\n');
  raw = raw.replace(/<[^>]+>/g, '');
  raw = raw.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;/g, "'").replace(/&#8211;/g, '–').replace(/&[a-z#0-9]+;/gi, ' ');
  raw = raw.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  return raw;
}

async function run() {
  let saved = 0;
  for (const entry of SOURCES) {
    const filename = `${entry.date}-${entry.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.txt`;
    const outPath = path.join(OUT_DIR, filename);

    if (fs.existsSync(outPath)) {
      console.log(`Already exists: ${filename}`);
      saved++;
      continue;
    }

    try {
      const text = await fetchTranscript(entry);
      if (text.length < 300) {
        console.log(`Too short (${text.length} chars), skipping: ${entry.title}`);
        console.log('  Preview:', text.slice(0, 200));
        continue;
      }
      const content = `${entry.title}
Date: ${entry.date}
Source: UCSB American Presidency Project

OVERVIEW
--------
Public address/statement on ${entry.date}: ${entry.title}.

ATMOSPHERE
----------
Official public address.

TRANSCRIPT
----------
${text}
`;
      fs.writeFileSync(outPath, content);
      console.log(`Saved: ${filename} (${text.length} chars)`);
      saved++;
    } catch (err) {
      console.error(`Failed: ${entry.title} — ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 600));
  }

  console.log(`\n${saved}/${SOURCES.length} transcripts saved to personas/${personaId}/transcripts/`);
}

run().catch(err => {
  console.error('Scrape failed:', err.message);
  process.exit(1);
});
