import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const apiKey = process.env.GOOGLE_API_KEY;
  
  // Add this to see what's happening in the terminal

  if (!apiKey) return NextResponse.json({ error: "No API key" }, { status: 500 });

  const { language, scenario } = await req.json();

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Based on the language input "${language}" and the scenario "${scenario}", create a detailed system instruction for an assistant to roleplay in the scenario. 
            The AI must fully embody a character in this scenario and communicate in the specified language. 
            Also determine the closest BCP-47 language code for the language input (e.g., "en-US", "es-ES", "fr-FR").
            Return JSON with two keys: "systemInstruction" (string) and "languageCode" (string).`
          }]
        }],
        generationConfig: { responseMimeType: "application/json" }
      }),
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    console.error("Gemini API error:", res.status, errBody);
    return NextResponse.json({ error: errBody }, { status: res.status });
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = JSON.parse(text);
  return NextResponse.json(parsed);
}