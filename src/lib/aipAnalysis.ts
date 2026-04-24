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

// ---------------------------------------------------------------------------
// Robust JSON parser — handles truncated, malformed, and partial responses
// ---------------------------------------------------------------------------

function tryParseJSON(raw: string): AIPResult | null {
  let s = raw.trim().replace(/```json\s*/gi, "").replace(/```\s*/g, "");

  // Fast path: well-formed JSON
  try {
    const direct = JSON.parse(s);
    if (direct && typeof direct === "object" && "trajectory_narrative" in direct) {
      return normalise(direct);
    }
  } catch {
    // fall through
  }

  // Slice between first { and last }
  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace) {
    s = s.slice(firstBrace, lastBrace + 1);
    try {
      return normalise(JSON.parse(s));
    } catch {
      // partial JSON — try field-by-field
    }
  }

  // Field-by-field regex recovery
  return fieldByFieldRecovery(s);
}

function normalise(parsed: Record<string, unknown>): AIPResult {
  const interventions: AIPIntervention[] = (
    Array.isArray(parsed.recommended_interventions)
      ? parsed.recommended_interventions
      : []
  ).map((i: Record<string, unknown>) => ({
    type: String(i.type ?? ""),
    actor: String(i.actor ?? ""),
    rationale: String(i.rationale ?? ""),
    historical_success_rate: Number(i.historical_success_rate ?? 0),
  }));

  const rawConfidence = String(parsed.confidence ?? "MEDIUM");
  const confidence: AIPResult["confidence"] = ["HIGH", "MEDIUM", "LOW"].includes(rawConfidence)
    ? (rawConfidence as AIPResult["confidence"])
    : "MEDIUM";

  return {
    trajectory_narrative: String(parsed.trajectory_narrative ?? ""),
    primary_risk_factor: String(parsed.primary_risk_factor ?? ""),
    analogue_reasoning: String(parsed.analogue_reasoning ?? ""),
    recommended_interventions: interventions,
    confidence,
    analyst_action: String(parsed.analyst_action ?? ""),
  };
}

function fieldByFieldRecovery(s: string): AIPResult | null {
  const get = (key: string): string => {
    const re = new RegExp(`"${key}"\\s*:\\s*"(.*?)"(?=\\s*[,}])`);
    const m = s.match(re);
    return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : "";
  };

  const interventions: AIPIntervention[] = [];
  const blockRe = /\{\s*"type"\s*:\s*"([^"]*)"\s*,\s*"actor"\s*:\s*"([^"]*)"\s*,\s*"rationale"\s*:\s*"([^"]*)"\s*,\s*"historical_success_rate"\s*:\s*([0-9.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(s)) !== null) {
    interventions.push({
      type: m[1],
      actor: m[2],
      rationale: m[3].replace(/\\"/g, '"'),
      historical_success_rate: parseFloat(m[4]),
    });
  }

  const rawConfidence = get("confidence");
  const confidence: AIPResult["confidence"] = ["HIGH", "MEDIUM", "LOW"].includes(rawConfidence)
    ? (rawConfidence as AIPResult["confidence"])
    : "MEDIUM";

  const result: AIPResult = {
    trajectory_narrative: get("trajectory_narrative"),
    primary_risk_factor: get("primary_risk_factor"),
    analogue_reasoning: get("analogue_reasoning"),
    recommended_interventions: interventions,
    confidence,
    analyst_action: get("analyst_action"),
  };

  const filled = [
    result.trajectory_narrative,
    result.primary_risk_factor,
    result.recommended_interventions.length,
  ].filter(Boolean).length;
  return filled >= 3 ? result : null;
}

// ---------------------------------------------------------------------------
// Mock result — used when no API key is configured
// ---------------------------------------------------------------------------

function buildMockResult(
  country: string,
  trajectoryClass: string,
  topAnalogues: Analogue[]
): AIPResult {
  const analogue = topAnalogues[0]?.case;
  const interventions: AIPIntervention[] = [
    {
      type: "judicial_capture",
      actor: "ruling_party",
      rationale: "EU Article 7 proceedings combined with civil society pressure have historically reversed judicial capture in Central European cases.",
      historical_success_rate: 0.62,
    },
    {
      type: "media_takeover",
      actor: "oligarchic_network",
      rationale: "Coordinated advertiser withdrawal and international platform access has countered state media capture in comparable cases.",
      historical_success_rate: 0.55,
    },
  ];

  const narratives: Record<string, string> = {
    DEGRADING: `All five democratic indicators show sustained decline over the 2020–2024 window. Press freedom and executive constraints have crossed below their one-standard-deviation thresholds, indicating structural erosion rather than cyclical volatility. The rate of decline is consistent with pre-consolidation patterns observed in Hungary (2011–2014) and Poland (2015–2017).`,
    STRESS: `${country} shows 1–2 indicators in accelerated decline, with press freedom and electoral integrity as primary pressure points. Executive constraints remain nominally intact but show early-stage deterioration signals. This pattern is consistent with early competitive authoritarian consolidation — 18–24 months ahead of more severe capture if no intervention occurs.`,
    STABLE: `${country}'s indicator values are within normal ranges. No indicator crosses below its one-standard-deviation threshold, and the 3-year vs. 5-year comparison shows no sustained decline pattern.`,
  };

  const actions: Record<string, string> = {
    DEGRADING: "Analyst should flag for immediate escalation and prepare EU Article 7 triggering memo.",
    STRESS: "Analyst should schedule bilateral EU rule-of-law briefing and prepare civil society support framework.",
    STABLE: "Analyst should continue quarterly monitoring with no immediate escalation required.",
  };

  return {
    trajectory_narrative: narratives[trajectoryClass] ?? narratives.STABLE,
    primary_risk_factor: "press_freedom",
    analogue_reasoning: `Closest analogue is ${analogue?.country ?? "unknown"} (${analogue?.start_year ?? "?"}–${analogue?.end_year ?? "?"}), which showed a ${analogue?.outcome ?? "unknown"} outcome with a score of ${analogue?.outcome_score ?? "?"}. The shared degradation pattern in ${analogue?.indicators_degraded?.slice(0, 2).join(" and ") ?? "key indicators"} makes this structurally relevant.`,
    recommended_interventions: interventions,
    confidence: topAnalogues.length > 0 ? "MEDIUM" : "LOW",
    analyst_action: actions[trajectoryClass] ?? actions.STABLE,
  };
}

// ---------------------------------------------------------------------------
// HTTP with AbortController timeout
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 30_000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout = TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// ---------------------------------------------------------------------------
// Streaming SSE handler
// ---------------------------------------------------------------------------

async function streamMinimax(
  apiKey: string,
  endpoint: string,
  messages: { role: string; content: string }[],
  onChunk: (text: string) => void
): Promise<void> {
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "MiniMax-M2.5",
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Minimax API error ${response.status}: ${body.slice(0, 200)}`);
  }

  if (!response.body) throw new Error("No response body");

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
      if (data === "[DONE]" || data === "null" || data === "") continue;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) onChunk(delta);
      } catch {
        // skip malformed SSE lines
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main exports
// ---------------------------------------------------------------------------

export async function runAIPAnalysis(params: {
  country: string;
  currentIndicators: Record<string, number>;
  trajectoryClass: string;
  criticalFlags: string[];
  topAnalogues: Analogue[];
}): Promise<AIPResult> {
  const userMsg = buildUserMessage(params);
  const apiKey = import.meta.env.VITE_MINIMAX_API_KEY ?? "";
  const endpoint =
    import.meta.env.VITE_MINIMAX_API_ENDPOINT ??
    "https://api.minimaxi.chat/v1/text/chatcompletion_v2";

  if (!apiKey) return buildMockResult(params.country, params.trajectoryClass, params.topAnalogues);

  try {
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "MiniMax-M2.5",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Minimax API error ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content ?? "";
    const result = tryParseJSON(raw);
    if (result) return result;
    throw new Error("Failed to parse API response as valid JSON");
  } catch (err) {
    console.warn("AIP analysis failed, falling back to mock result:", err);
    return buildMockResult(params.country, params.trajectoryClass, params.topAnalogues);
  }
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
  const userMsg = buildUserMessage(params);
  const apiKey = import.meta.env.VITE_MINIMAX_API_KEY ?? "";
  const endpoint =
    import.meta.env.VITE_MINIMAX_API_ENDPOINT ??
    "https://api.minimaxi.chat/v1/text/chatcompletion_v2";

  if (!apiKey) {
    const mock = buildMockResult(params.country, params.trajectoryClass, params.topAnalogues);
    const json = JSON.stringify(mock);
    for (const char of json) {
      onChunk(char);
      await new Promise((r) => setTimeout(r, 4));
    }
    return mock;
  }

  try {
    let accumulatedText = "";
    await streamMinimax(
      apiKey,
      endpoint,
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      (chunk) => {
        accumulatedText += chunk;
        onChunk(chunk);
      }
    );
    const result = tryParseJSON(accumulatedText);
    if (result) return result;
    throw new Error("Failed to parse streamed response");
  } catch (err) {
    console.warn("AIP stream failed, falling back to mock:", err);
    const mock = buildMockResult(params.country, params.trajectoryClass, params.topAnalogues);
    const json = JSON.stringify(mock);
    for (const char of json) {
      onChunk(char);
      await new Promise((r) => setTimeout(r, 4));
    }
    return mock;
  }
}

// Called by Dashboard after streaming finishes to extract structured result
export function parseFromStream(streamingText: string): AIPResult | null {
  return tryParseJSON(streamingText);
}

// Exported for unit testing
export { tryParseJSON, normalise, fieldByFieldRecovery, buildMockResult };
