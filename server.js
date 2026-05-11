import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post('/api/ideas', async (req, res) => {
  const { prompt, industry, aoiCategory } = req.body;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY environment variable is not set.' });
  }

  try {
    const aoiLabel = aoiCategory === 'price' ? 'Price' : aoiCategory === 'convenience' ? 'Convenience' : 'Quality';
    const industryText = industry && industry.trim() ? industry : 'your industry';

    const systemPrompt = `You are a pragmatic, outcome-focused business advisor who helps trade-based, small business owners in Australia. You are working with a business owner in the ${industryText} industry who is looking to make their business offerings stand out.`;

    const gapContext = prompt && prompt.trim()
      ? `The business owner has identified this area of focus: "${prompt}"\n\n`
      : '';

    const userPrompt = `${gapContext}Industry: ${industryText}
Key advantage: ${aoiLabel}

List between 4 and 6 high-value market opportunities in this industry that are either poorly addressed or not commonly offered by competitors. Only include an opportunity if it is genuinely strong — do not pad the list. Each should be commercially viable and practical for a small business.

Rules:
- No introduction, conclusion, or filler sentences
- No numbering or bullet symbols
- Each item must be on a single line in this exact format: **Opportunity Title** — one concise sentence explaining the opportunity
- Output only the items, nothing else`;

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userPrompt
        }
      ],
      temperature: 0.7,
      max_tokens: 400
    });

    const text = response.choices?.[0]?.message?.content ?? '';
    const ideas = text
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*[\-\d\.\)\•]+\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 6);

    return res.json({ ideas });
  } catch (error) {
    console.error('OpenAI error', error);
    return res.status(500).json({ error: error.message ?? 'OpenAI request failed' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
