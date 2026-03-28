import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const apiKey = process.env.GOOGLE_API_KEY;
  
  if (!apiKey) return NextResponse.json({ error: "No API key" }, { status: 500 });

  const { transcript } = await req.json();

  if (!transcript || transcript.length === 0) {
     return NextResponse.json({ report: "No conversation took place.", score: "N/A" });
  }

  const transcriptText = transcript.map((t: any) => `${t.role.toUpperCase()}: ${t.text}`).join("\n");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Based on the following conversation transcript, provide a 1-2 sentence report summarizing how the participant did in the conversation (language skills, scenario adherence, etc.)
             and give an overall score based on their perfromance. Make sure the report score is strict with its requirements, as in, if words are wrong and dont make sense, deduct some points for it.
             Make sure the scores aren't always really high, if the user makes a lot of mistakes I want that to reflect well within the score.
            Write the report in a casual, encouraging, and direct tone by addressing them as "you" and "your" instead of saying "the user" in the third person.

            For things to work on and things done well, make 3 short (5 words max) bullet points that follow the category. If the overall score is really high, do not feel the need to 
            force yourself to put anything in the things to work on category and vice versa for a very low score and things done well. 

            Return JSON with exactly four keys: "report" (string), "score" (a string, like "85/100"), "workOn" (an array of strings), "doneWell" (an array of strings).
            Lastly, do not deduct points if the user doesnt respond to the last message the ai sends and do not consider how much it follows the scenario either.
            
            Conversation Transcript:
            ${transcriptText}`
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
  
  try {
    const parsed = JSON.parse(text);
    return NextResponse.json(parsed);
  } catch (e) {
    console.error("Failed to parse summary response", text);
    return NextResponse.json({ report: "Could not generate summary.", score: "Error" }, { status: 500 });
  }
}
