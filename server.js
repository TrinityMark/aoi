import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// CORS — allows GitHub Pages and localhost to call this server
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── /api/ideas ────────────────────────────────────────────────────────────────
app.post('/api/ideas', async (req, res) => {
  const { prompt, industry, aoiCategory } = req.body;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not set.' });
  }

  try {
    const aoiLabel = aoiCategory === 'price' ? 'Price' : aoiCategory === 'convenience' ? 'Convenience' : 'Quality';
    const industryText = industry?.trim() || 'your industry';
    const gapContext = prompt?.trim() ? `The business owner has identified this area of focus: "${prompt}"\n\n` : '';

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `You are a pragmatic business advisor for trade-based small business owners in Australia working in the ${industryText} industry.`
        },
        {
          role: 'user',
          content: `${gapContext}Industry: ${industryText}\nKey advantage: ${aoiLabel}\n\nList between 4 and 6 high-value market opportunities that are either poorly addressed or not commonly offered by competitors. Only include genuinely strong opportunities.\n\nRules:\n- No introduction or conclusion\n- No numbering or bullets\n- Each item on a single line: **Opportunity Title** — one concise sentence\n- Output only the items`
        }
      ],
      temperature: 0.7,
      max_tokens: 600
    });

    const text = response.choices?.[0]?.message?.content ?? '';
    const ideas = text
      .split(/\r?\n/)
      .map(line => line.replace(/^\s*[\-\d\.\)\•]+\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 6);

    return res.json({ ideas });
  } catch (error) {
    return res.status(500).json({ error: error.message ?? 'OpenAI request failed' });
  }
});

// ── Market research helpers (from scrape-pain-points.js) ──────────────────────
const SUBREDDITS = ['AusRenovation', 'australia', 'AusPropertyChat', 'AusFinance', 'brisbane', 'sydney', 'melbourne', 'perth'];
const AU_CITIES  = ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide'];

async function fetchRedditPosts(subreddit, query) {
  const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&sort=relevance&limit=10&restrict_sr=1&t=year`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'PainPointResearch/1.0' } });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.data?.children ?? [];
  } catch { return []; }
}

async function fetchRedditComments(postId, subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json?limit=20&depth=2`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'PainPointResearch/1.0' } });
    if (!res.ok) return [];
    return (res.json?.()[1]?.data?.children ?? [])
      .map(c => c?.data?.body)
      .filter(b => b && b !== '[deleted]' && b.length > 40);
  } catch { return []; }
}

async function gatherRedditContent(industry) {
  const all = [];
  for (const sub of SUBREDDITS) {
    const posts = await fetchRedditPosts(sub, `${industry} australia`);
    for (const post of posts) {
      const d = post?.data;
      if (!d) continue;
      const parts = [d.title];
      if (d.selftext && d.selftext !== '[deleted]' && d.selftext.length > 20) parts.push(d.selftext.slice(0, 500));
      all.push(`[Reddit] ${parts.join(' — ')}`);
      if (d.id && posts.indexOf(post) === 0) {
        const comments = await fetchRedditComments(d.id, sub);
        comments.slice(0, 5).forEach(c => all.push(`[Reddit] ${c.slice(0, 400)}`));
      }
      await new Promise(r => setTimeout(r, 300));
    }
  }
  return all;
}

async function gatherGoogleContent(industry) {
  const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;
  if (!GOOGLE_KEY) return [];
  const all = [];
  for (const city of AU_CITIES) {
    try {
      const searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': 'places.id' },
        body: JSON.stringify({ textQuery: `${industry} in ${city} Australia`, pageSize: 5 }),
      });
      if (!searchRes.ok) continue;
      const searchData = await searchRes.json();
      for (const place of (searchData.places ?? [])) {
        const placeRes = await fetch(`https://places.googleapis.com/v1/places/${place.id}`, {
          headers: { 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': 'reviews' },
        });
        if (!placeRes.ok) continue;
        const placeData = await placeRes.json();
        for (const r of (placeData.reviews ?? [])) {
          if (r.text?.text && r.text.text.length > 30) {
            all.push(`[Google ${city}] ${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)} — ${r.text.text.slice(0, 400)}`);
          }
        }
        await new Promise(r => setTimeout(r, 200));
      }
    } catch { continue; }
  }
  return all;
}

async function analyzePainPoints(content, industry) {
  const hasData = content.length > 0;
  const prompt = hasData
    ? `Below is real customer feedback about ${industry} businesses in Australia.\n\n## WHAT THE MARKET WANTS MOST\nIn 3–5 sentences, summarise what customers fundamentally seek — the underlying need driving their choice. What does a great experience look like? What builds loyalty?\n\n## COMMON PAIN POINTS\nIdentify the 6–8 most repeated pain points. Format each as:\n**Pain Point Name** — What customers experience. WHY IT MATTERS: differentiation opportunity.\n\nOnly list genuine patterns from the data.\n\n---\n${content.slice(0, 80).join('\n\n')}`
    : `Based on your knowledge of the ${industry} industry in Australia:\n\n## WHAT THE MARKET WANTS MOST\nIn 3–5 sentences, summarise what customers fundamentally seek.\n\n## COMMON PAIN POINTS\nIdentify the 6–8 most common pain points. Format each as:\n**Pain Point Name** — What customers experience. WHY IT MATTERS: differentiation opportunity.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: 'You are a business analyst specialising in Australian trade businesses.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.5,
    max_tokens: 900
  });

  return response.choices[0].message.content;
}

// ── /api/market-research ──────────────────────────────────────────────────────
app.post('/api/market-research', async (req, res) => {
  const { industry } = req.body;
  if (!industry) return res.status(400).json({ error: 'Industry is required' });

  try {
    const [redditContent, googleContent] = await Promise.all([
      gatherRedditContent(industry),
      gatherGoogleContent(industry),
    ]);
    const analysis = await analyzePainPoints([...googleContent, ...redditContent], industry);
    return res.json({ analysis });
  } catch (error) {
    console.error('Market research error', error);
    return res.status(500).json({ error: error.message ?? 'Market research failed' });
  }
});

// ── Root ──────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));
