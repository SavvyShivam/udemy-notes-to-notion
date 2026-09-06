const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'openai/gpt-oss-120b';

export function buildPrompt(transcriptText) {
  return [
    {
      role: 'system',
      content:
        'You summarize video lecture transcripts. Respond in exactly this format:\n' +
        'BRIEF: <2-3 sentence summary>\n' +
        'BULLETS:\n- <point>\n- <point>\n(one bullet per line, each starting with "- ")'
    },
    {
      role: 'user',
      content: `Transcript:\n${transcriptText}`
    }
  ];
}

export function parseGroqResponse(rawText) {
  const briefMatch = rawText.match(/BRIEF:\s*([\s\S]*?)(?:\nBULLETS:|$)/i);
  const bulletsMatch = rawText.match(/BULLETS:\s*([\s\S]*)/i);

  const brief = briefMatch ? briefMatch[1].trim() : rawText.trim();
  const bullets = bulletsMatch
    ? bulletsMatch[1]
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('- '))
        .map((line) => line.slice(2).trim())
    : [];

  return { brief, bullets };
}

export async function summarizeTranscript(transcriptText, apiKey, fetchImpl = fetch) {
  const response = await fetchImpl(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: buildPrompt(transcriptText),
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const rawText = data.choices?.[0]?.message?.content;
  if (!rawText) {
    throw new Error('Groq API returned an unexpected response shape');
  }
  return parseGroqResponse(rawText);
}
