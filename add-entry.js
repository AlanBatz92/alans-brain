#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const rl   = require('readline').createInterface({ input: process.stdin, output: process.stdout });

const DATA_DIR = path.join(__dirname, 'data');

// ── Prompt helpers ───────────────────────────────────────────────

function ask(question, defaultVal) {
  return new Promise(resolve => {
    const hint   = defaultVal !== undefined ? ` [${defaultVal}]` : '';
    rl.question(`${question}${hint}: `, answer => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

async function askRequired(question) {
  let answer = '';
  while (!answer) {
    answer = await ask(question);
    if (!answer) console.log('  (required — please enter a value)');
  }
  return answer;
}

async function menu(label, options) {
  let idx = -1;
  while (idx < 0) {
    console.log(`\n${label}`);
    options.forEach((o, i) => console.log(`  ${i + 1}. ${o}`));
    const raw = await ask('Choice');
    idx = parseInt(raw, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= options.length) {
      console.log('  Invalid choice — try again.');
      idx = -1;
    }
  }
  return idx;
}

// ── JSON helpers ─────────────────────────────────────────────────

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return []; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ── Entry builders ───────────────────────────────────────────────

async function addArt() {
  console.log('\n── Art Entry ──');
  const src    = await askRequired('Image path  (e.g. img/art/full/painting.jpg)');
  const thumb  = await ask('Thumbnail path (e.g. img/art/thumbs/painting.jpg)');
  const title  = await askRequired('Title');
  const artist = await askRequired('Artist');
  const year   = await ask('Year  (e.g. 1892)');

  const entry = { src, title, artist };
  if (thumb) entry.thumb = thumb;
  if (year)  entry.year  = year;
  return entry;
}

async function addPhoto() {
  console.log('\n── Photo Entry ──');
  const src      = await askRequired('Image path  (e.g. img/photos/photo.jpg)');
  const thumb    = await ask('Thumbnail path  (leave blank to use src)');
  const caption  = await ask('Caption');
  const category = await ask('Category  (e.g. Nature, Travel)');

  const entry = { src };
  if (thumb)    entry.thumb    = thumb;
  if (caption)  entry.caption  = caption;
  if (category) entry.category = category;
  return entry;
}

async function addUfo() {
  console.log('\n── UFO Case Entry ──');
  const EVIDENCE_TYPES = ['witnesses', 'radar', 'photo', 'government', 'physical'];

  const name       = await askRequired('Case name');
  const date       = await ask('Date  (YYYY-MM-DD)');
  const location   = await ask('Location');
  const summary    = await ask('Short summary');
  const details    = await ask('Full details  (optional, press Enter to skip)');
  const conviction = await ask('Conviction rating  (1–10)');
  const image      = await ask('Image path  (optional)');

  // Evidence multi-select
  console.log('\nEvidence types — enter numbers separated by commas (e.g. 1,3), or leave blank:');
  EVIDENCE_TYPES.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
  const evidenceRaw = await ask('Evidence');
  const evidence = evidenceRaw
    ? evidenceRaw.split(',').map(s => {
        const idx = parseInt(s.trim(), 10) - 1;
        return (idx >= 0 && idx < EVIDENCE_TYPES.length) ? EVIDENCE_TYPES[idx] : null;
      }).filter(Boolean)
    : [];

  // Sources
  const sources = [];
  console.log('\nAdd sources — press Enter on a blank label when done:');
  while (true) {
    const label = await ask('Source label  (e.g. Wikipedia)');
    if (!label) break;
    const url = await askRequired('Source URL');
    sources.push({ label, url });
  }

  const entry = { name };
  if (date)             entry.date       = date;
  if (location)         entry.location   = location;
  if (evidence.length)  entry.evidence   = evidence;
  if (conviction)       entry.conviction = parseInt(conviction, 10);
  if (summary)          entry.summary    = summary;
  if (details)          entry.details    = details;
  if (image)            entry.image      = image;
  if (sources.length)   entry.sources    = sources;
  return entry;
}

async function addYoutube() {
  console.log('\n── YouTube Channel Entry ──');
  const name        = await askRequired('Channel name');
  const url         = await askRequired('Channel URL');
  const description = await ask('Description');
  const category    = await ask('Category  (e.g. Tech, Gaming, Music)');
  const image       = await ask('Channel avatar URL  (optional)');

  let exemplar = null;
  const addEx = await ask('Add an exemplar video?  (y/n)', 'n');
  if (addEx.toLowerCase() === 'y') {
    const videoId   = await askRequired('YouTube video ID  (e.g. dQw4w9WgXcQ)');
    const title     = await ask('Video title');
    const thumbnail = await ask('Custom thumbnail URL  (leave blank to auto-generate)');
    const note      = await ask('Note about this video  (optional)');
    exemplar = { videoId };
    if (title)     exemplar.title     = title;
    if (thumbnail) exemplar.thumbnail = thumbnail;
    if (note)      exemplar.note      = note;
  }

  const entry = { name, url };
  if (description) entry.description = description;
  if (category)    entry.category    = category;
  if (image)       entry.image       = image;
  if (exemplar)    entry.exemplar    = exemplar;
  return entry;
}

async function addTool() {
  console.log('\n── Tool Entry ──');
  const name        = await askRequired('Tool name');
  const url         = await askRequired('URL');
  const description = await askRequired('Description');
  const category    = await ask('Category  (e.g. Design, Security, Dev)');
  const icon        = await ask('Icon emoji  (e.g. 🛠️)');

  const entry = { name, url, description };
  if (category) entry.category = category;
  if (icon)     entry.icon     = icon;
  return entry;
}

async function addSoundboard() {
  console.log('\n── Soundboard Entry ──');
  const id        = await askRequired('ID  (e.g. half-life, quake2)');
  const name      = await askRequired('Display name');
  const icon      = await ask('Icon emoji  (e.g. 🔫)');
  const clipCount = await ask('Clip count', '0');

  const entry = { id, name, clipCount: parseInt(clipCount, 10) || 0 };
  if (icon) entry.icon = icon;
  return entry;
}

// ── Content-type registry ────────────────────────────────────────

const TYPES = [
  { label: '🖼️   Art               (data/art.json)',               file: path.join(DATA_DIR, 'art.json'),                  builder: addArt },
  { label: '📸  Photo              (data/photos.json)',             file: path.join(DATA_DIR, 'photos.json'),               builder: addPhoto },
  { label: '🛸  UFO Case           (data/ufo-cases.json)',          file: path.join(DATA_DIR, 'ufo-cases.json'),            builder: addUfo },
  { label: '📺  YouTube Channel    (data/youtube.json)',            file: path.join(DATA_DIR, 'youtube.json'),              builder: addYoutube },
  { label: '🛠️   Tool               (data/tools.json)',              file: path.join(DATA_DIR, 'tools.json'),                builder: addTool },
  { label: '🔊  Soundboard         (data/soundboards/index.json)',  file: path.join(DATA_DIR, 'soundboards/index.json'),    builder: addSoundboard },
];

// ── Main loop ────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════╗');
  console.log("║   Alan's Brain  —  Add Entry     ║");
  console.log('╚══════════════════════════════════╝');

  while (true) {
    const idx = await menu('What type of content?', [...TYPES.map(t => t.label), 'Exit']);
    if (idx === TYPES.length) break;

    const { file, builder } = TYPES[idx];

    try {
      const entry = await builder();
      const data  = readJson(file);
      data.push(entry);
      writeJson(file, data);
      const rel = path.relative(__dirname, file);
      console.log(`\n✓ Saved to ${rel}  (${data.length} ${data.length === 1 ? 'entry' : 'entries'} total)`);
      console.log(JSON.stringify(entry, null, 2));
    } catch (err) {
      console.error('\n✗ Error:', err.message);
    }

    const again = await ask('\nAdd another entry?  (y/n)', 'y');
    if (again.toLowerCase() !== 'y') break;
  }

  console.log('\nDone!');
  rl.close();
}

main().catch(err => { console.error(err); rl.close(); process.exit(1); });
