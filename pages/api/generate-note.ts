import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { transcript, specialty } = req.body;

  if (!transcript || !specialty) {
    return res.status(400).json({ error: 'Missing transcript or specialty' });
  }

  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY not set' });
  }

  const systemPrompt = `You are an AI medical scribe for Pakistani clinics. Generate a clinical note in SOAP format (Subjective, Objective, Assessment, Plan) based on the doctor-patient conversation. 
Specialty: ${specialty}. 
Use clear headings: CHIEF COMPLAINT, HISTORY OF PRESENT ILLNESS, PAST MEDICAL HISTORY, EXAMINATION (vitals), DIAGNOSIS, PRESCRIPTION, FOLLOW-UP. 
If information missing, write [NOT MENTIONED]. Output in English only. Keep concise but complete. Include relevant specialty fields (e.g., for Cardiology: ECG, ejection fraction; Gynecology: LMP, Obstetric history).`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3-70b-8192',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Conversation transcript:\n${transcript}\n\nGenerate the clinical note.` },
        ],
        temperature: 0.2,
        max_tokens: 1200,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Llama error: ${errorText}`);
    }

    const data = await response.json();
    const note = data.choices[0].message.content;
    res.status(200).json({ note });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
}
