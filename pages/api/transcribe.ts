import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const form = formidable({ multiples: false });
  const [fields, files] = await form.parse(req);
  const audioFile = files.file?.[0];

  if (!audioFile) {
    return res.status(400).json({ error: 'No audio file uploaded' });
  }

  const audioBuffer = fs.readFileSync(audioFile.filepath);
  const blob = new Blob([audioBuffer], { type: audioFile.mimetype || 'audio/webm' });

  const formData = new FormData();
  formData.append('file', blob, 'recording.webm');
  formData.append('model', 'whisper-large-v3');
  formData.append('language', 'en');
  formData.append('response_format', 'json');

  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY not set' });
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Whisper error: ${errorText}`);
    }

    const data = await response.json();
    res.status(200).json({ transcript: data.text });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  } finally {
    fs.unlinkSync(audioFile.filepath); // clean up temp file
  }
}
