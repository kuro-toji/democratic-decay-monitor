import type { Analogue } from "./trajectoryEngine";

export interface AIPResult {
  trajectory_narrative: string;
  primary_risk_factor: string;
  analogue_reasoning: string;
  recommended_interventions: AIPIntervention[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
  analyst_action: string;
}

export interface AIPIntervention {
  type: string;
  actor: string;
  rationale: string;
  historical_success_rate: number;
}

const SYSTEM_PROMPT = `You are an analytical engine inside a democratic health monitoring system used by policy analysts. You receive structured indicator data for a country and must produce a classified assessment. Be precise, analytical, and avoid political editorializing. Think like a forensic analyst, not a commentator.`;

function buildUserMessage(params: {
  country: string;
  currentIndicators: Record<string, number>;
  trajectoryClass: string;
  criticalFlags: string[];
  topAnalogues: Analogue[];
}): string {
  return `Analyze the following democratic health data and respond with ONLY a valid JSON object (no markdown, no commentary).

Country: ${params.country}
Trajectory Classification: ${params.trajectoryClass}
Critical Indicators: ${params.criticalFlags.join(", ") || "none"}

Current Indicator Values:
${Object.entries(params.currentIndicators)
  .map(([k, v]) => `  - ${k}: ${(v * 100).toFixed(1)}/100`)
  .join("\n")}

Top Historical Analogues:
${params.topAnalogues
  .map(
    (a, i) =>
      `${i + 1}. ${a.case.country} (${a.case.start_year}–${a.case.end_year}): ${a.case.indicators_degraded.join(", ")} → outcome: ${a.case.outcome} (score: ${a.case.outcome_score})`
  )
  .join("\n")}

Return ONLY a JSON object with this exact structure:
{
  "trajectory_narrative": "2-3 sentence summary of what the indicator data shows",
  "primary_risk_factor": "the single leading indicator driving risk",
  "analogue_reasoning": "why the closest historical match is relevant to this case",
  "recommended_interventions": [{"type": "intervention name", "actor": "who implements", "rationale": "why this works historically", "historical_success_rate": 0.0}],
  "confidence": "HIGH|MEDIUM|LOW",
  "analyst_action": "one sentence on what the analyst should do this week"
}`;
}

async function callMinimax(prompt: string, system: string): Promise<string> {
  const apiKey = import.meta.env.VITE_MINIMAX_API_KEY || import.meta.env.MINIMAX_API_KEY;
  const endpoint = import.meta.env.VITE_MINIMAX_API_ENDPOINT || "https://api.minimax.chat/v1/text/chatcompletion_pro";

  if (!apiKey) {
    throw new Error("MINIMAX_API_KEY not configured. Set VITE_MINIMAX_API_KEY in environment.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "MiniMax-Text-01",
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Minimax API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function parseAIPResponse(raw: string): AIPResult {
  let cleaned = raw.trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  cleaned = cleaned.replace(/```json\s*/g, "").replace(/```\s*/g, "");

  const parsed = JSON.parse(cleaned);
  return {
    trajectory_narrative: parsed.trajectory_narrative ?? "",
    primary_risk_factor: parsed.primary_risk_factor ?? "",
    analogue_reasoning: parsed.analogue_reasoning ?? "",
    recommended_interventions: (parsed.recommended_interventions ?? []).map(
      (i: Record<string, unknown>) => ({
        type: i.type ?? "",
        actor: i.actor ?? "",
        rationale: i.rationale ?? "",
        historical_success_rate: Number(i.historical_success_rate ?? 0),
      })
    ),
    confidence: (parsed.confidence ?? "MEDIUM") as AIPResult["confidence"],
    analyst_action: parsed.analyst_action ?? "",
  };
}

export async function runAIPAnalysis(params: {
  country: string;
  currentIndicators: Record<string, number>;
  trajectoryClass: string;
  criticalFlags: string[];
  topAnalogues: Analogue[];
}): Promise<AIPResult> {
  const userMsg = buildUserMessage(params);
  const raw = await callMinimax(userMsg, SYSTEM_PROMPT);
  return parseAIPResponse(raw);
}

export async function runAIPAnalysisStream(
  params: {
    country: string;
    currentIndicators: Record<string, number>;
    trajectoryClass: string;
    criticalFlags: string[];
    topAnalogues: Analogue[];
  },
  onChunk: (text: string) => void
): Promise<AIPResult> {
  const apiKey = import.meta.env.VITE_MINIMAX_API_KEY || import.meta.env.MINIMAX_API_KEY;
  const endpoint =
    import.meta.env.VITE_MINIMAX_API_ENDPOINT ||
    "https://api.minimax.chat/v1/text/chatcompletion_pro";

  if (!apiKey) {
    throw new Error("MINIMAX_API_KEY not configured. Set VITE_MINIMAX_API_KEY in environment.");
  }

  const userMsg = buildUserMessage(params);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "MiniMax-Text-01",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Minimax API error: ${response.status}`);
  }

  if (!response.body) {
    throw new Error("No response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]" || data === "null") continue;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) onChunk(delta);
      } catch {
        // skip malformed lines
      }
    }
  }

  const full = buffer.replace(/^data: /, "").trim();
  if (full && full !== "[DONE]" && full !== "null") {
    try {
      const parsed = JSON.parse(full);
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) onChunk(delta);
    } catch {
      // ignore final parse errors
    }
  }

  return { trajectory_narrative: "", primary_risk_factor: "", analogue_reasoning: "", recommended_interventions: [], confidence: "MEDIUM", analyst_action: "" };
}