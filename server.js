import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post('/api/ideas', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'Please enter a prompt for the AI.' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY environment variable is not set.' });
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'user',
          content: `Generate 3 short, practical business idea suggestions based on the following input: ${prompt}. Return them as separate list items.`
        }
      ],
      temperature: 0.8,
      max_tokens: 220
    });

    const text = response.choices?.[0]?.message?.content ?? '';
    const ideas = text
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*[\-\d\.\)\•]+\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 5);

    return res.json({ ideas });
  } catch (error) {
    console.error('OpenAI error', error);
    return res.status(500).json({ error: error.message ?? 'OpenAI request failed' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'positioning-mockup.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
