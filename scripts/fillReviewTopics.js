/**
 * Review MD 표의 topic (raw) 열을 published_topics에서 채움 (훅 제외)
 *
 * Usage:
 *   node scripts/fillReviewTopics.js
 *   node scripts/fillReviewTopics.js docs/reviews/2026.05.28.md
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const rowRe =
  /^\| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/;

function resolveReviewPath(argv) {
  const arg = argv[2];
  if (arg) {
    return path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg);
  }
  return path.join(__dirname, '../docs/reviews/2026.05.21.md');
}

function escMd(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function parseTableRows(md) {
  const rows = [];
  for (const line of md.split('\n')) {
    const m = line.match(rowRe);
    if (!m) continue;
    const video_id = m[1].trim();
    if (video_id === 'video_id') continue;
    rows.push({ video_id });
  }
  return rows;
}

function updateMetaMatchLine(line, matched, total) {
  if (!line.includes('topic (raw)') || !line.includes('매칭')) return line;
  return line.replace(/\*\*[\d/]+\*\* 매칭/g, `**${matched}/${total}** 매칭`);
}

async function main() {
  const reviewPath = resolveReviewPath(process.argv);
  if (!fs.existsSync(reviewPath)) {
    console.error(`Review file not found: ${reviewPath}`);
    process.exit(1);
  }

  const md = fs.readFileSync(reviewPath, 'utf8');
  const rows = parseTableRows(md);
  if (rows.length === 0) {
    console.error('No table rows found in review file');
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ids = rows.map((r) => r.video_id);
  const topicByVideo = new Map();

  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const { data, error } = await supabase
      .from('published_topics')
      .select('video_id, raw_topic, uploaded_at')
      .in('video_id', batch)
      .order('uploaded_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error.message);
      process.exit(1);
    }

    for (const row of data || []) {
      const vid = row.video_id;
      if (!vid || topicByVideo.has(vid)) continue;
      topicByVideo.set(vid, row.raw_topic || '—');
    }
  }

  let matched = 0;
  let total = 0;
  const outLines = md.split('\n').map((line) => {
    const m = line.match(rowRe);
    if (!m) return line;

    const video_id = m[1].trim();
    if (video_id === 'video_id') return line;

    total += 1;
    const fromDb = topicByVideo.get(video_id);
    const topicCol = fromDb != null && fromDb !== '' ? fromDb : m[3].trim();
    if (fromDb != null && fromDb !== '' && fromDb !== '—') matched += 1;

    return `| ${escMd(m[1].trim())} | ${escMd(m[2].trim())} | ${escMd(topicCol)} | ${m[4].trim()} | ${m[5].trim()} | ${m[6].trim()} | ${m[7].trim()} | ${m[8].trim()} |`;
  });

  const finalLines = outLines.map((line) => updateMetaMatchLine(line, matched, total));
  fs.writeFileSync(reviewPath, finalLines.join('\n'), 'utf8');
  console.log(`Wrote ${reviewPath}: ${matched}/${total} topics from DB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
