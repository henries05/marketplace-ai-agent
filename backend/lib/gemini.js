import OpenAI from "openai";

let openai = null;

function getOpenAI() {
  if (!openai) {
    const apiKey = process.env.GEMINI_API_KEY;
    const baseURL = process.env.GEMINI_BASE_URL || "https://llm.wokushop.com/v1";
    if (apiKey) {
      openai = new OpenAI({ apiKey, baseURL });
    }
  }
  return openai;
}

export async function extractStateUpdate(message, oldState, actor) {
  const client = getOpenAI();
  if (!client) {
    return { error: "GEMINI_API_KEY is not configured." };
  }

  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const systemPrompt = `
    You are an AI Extraction Engine for a motorbike marketplace.
    Analyze the incoming message from the actor (${actor}) and output JSON updates to merge into the conversation state.
    
    The schema of the conversation state (JSON) is:
    {
      "location": string,
      "budget": { "target": number, "max": number },
      "preferences": { "types": string[], "brands": string[], "min_year": number, "max_odo": number },
      "seller_profile": { "asking_price": number, "vehicle_info": { "brand": string, "model": string, "year": number, "odo": number } },
      "risks_detected": Array<{ "category": string, "severity": string, "description": string }>,
      "lead_stage_suggestion": string
    }

    Detected risk categories:
    - "pricing_conflict": Price gap > 20% between buyer budget and seller asking.
    - "paperwork_risk": Waiting to withdraw original files, incomplete ownership docs, etc.
    - "direct_payment_request": Asking for bank deposits before meeting.
    - "bypass_leakage": Requesting direct phone numbers or off-platform communication.

    Lead stage suggestions: "DISCOVERY", "MATCHING", "NEGOTIATION", "APPOINTMENT", "CLOSING", "DROPPED".

    Compare the new message against the current state:
    ${JSON.stringify(oldState, null, 2)}
  `;

  try {
    const result = await client.chat.completions.create({
      model: modelName,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Input Message (${actor}): "${message}"\nRespond ONLY with a JSON object representing the updates/new attributes to merge. Do not return the entire state, only what has changed. Ensure the response is a valid JSON string. Any generated text values (e.g. risk descriptions) MUST be in Vietnamese.` }
      ]
    });
    return JSON.parse(result.choices[0].message.content);
  } catch (error) {
    console.error("Gemini Extraction Error:", error);
    return {};
  }
}

export async function generateRollingSummary(history, oldSummary) {
  const client = getOpenAI();
  if (!client) return oldSummary || "";

  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const prompt = `
    Summarize the overall status and constraints of this motorbike trade conversation.
    Previous Summary: "${oldSummary || "None"}"
    Recent Chat Log:
    ${history.map(h => `${h.actor}: ${h.text || JSON.stringify(h.payload)}`).join("\n")}

    Generate a concise plain text summary (max 3 sentences) in Vietnamese updating the deal status.
  `;

  try {
    const result = await client.chat.completions.create({
      model: modelName,
      messages: [
        { role: "user", content: prompt }
      ]
    });
    return result.choices[0].message.content.trim();
  } catch (error) {
    console.error("Gemini Summary Error:", error);
    return oldSummary || "";
  }
}
