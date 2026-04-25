import { useEffect, useRef, useState, useCallback } from "react";

// ============================================================================
// Types
// ============================================================================

export interface SSEMessage {
  type: "CONNECTED" | "HEARTBEAT" | "NEW_ALERT" | "ALERT_SUMMARY" | 
        "TRAJECTORY_CHANGE" | "EVALUATION_COMPLETE" | "DASHBOARD_SUMMARY" |
        "COUNTRY_UPDATE" | "ERROR";
  data?: any;
  timestamp: string;
  clientId?: string;
  error?: string;
}

export interface AlertSummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
}

export interface TrajectoryChange {
  countryId: number;
  previousStatus: string;
  newStatus: string;
}

// ============================================================================
// SSE Hook for Alerts
// ============================================================================

export function useAlertSSE(apiBase: string = "http://localhost:3000") {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<SSEMessage | null>(null);
  const [alertSummary, setAlertSummary] = useState<AlertSummary>({ 
    total: 0, critical: 0, warning: 0, info: 0 
  });
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const url = `${apiBase}/api/realtime/alerts`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log("[SSE] Connected to alert stream");
      setConnected(true);
      setReconnectAttempt(0);
    };

    eventSource.onmessage = (event) => {
      try {
        const message: SSEMessage = JSON.parse(event.data);
        setLastMessage(message);

        // Update alert summary when received
        if (message.type === "ALERT_SUMMARY" && message.data) {
          setAlertSummary({
            total: message.data.total ?? 0,
            critical: message.data.critical ?? 0,
            warning: message.data.warning ?? 0,
            info: message.data.info ?? 0,
          });
        }
      } catch (error) {
        console.error("[SSE] Failed to parse message:", error);
      }
    };

    eventSource.onerror = (error) => {
      console.error("[SSE] Connection error:", error);
      setConnected(false);
      eventSource.close();

      // Attempt reconnection with exponential backoff
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), 30000);
      console.log(`[SSE] Reconnecting in ${delay}ms...`);
      
      reconnectTimeoutRef.current = setTimeout(() => {
        setReconnectAttempt(prev => prev + 1);
        connect();
      }, delay);
    };
  }, [apiBase, reconnectAttempt]);

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  // Manual reconnect
  const reconnect = useCallback(() => {
    setReconnectAttempt(0);
    connect();
  }, [connect]);

  return {
    connected,
    lastMessage,
    alertSummary,
    reconnectAttempt,
    reconnect,
    lastMessageType: lastMessage?.type,
    lastMessageTime: lastMessage?.timestamp,
  };
}

// ============================================================================
// SSE Hook for Trajectory Changes (per country)
// ============================================================================

export function useTrajectorySSE(countryId: number | null, apiBase: string = "http://localhost:3000") {
  const [connected, setConnected] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [trajectoryChange, setTrajectoryChange] = useState<TrajectoryChange | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!countryId) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setConnected(false);
      setCurrentStatus(null);
      return;
    }

    const url = `${apiBase}/api/realtime/trajectory/${countryId}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log(`[SSE] Connected to country ${countryId} trajectory stream`);
      setConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const message: SSEMessage = JSON.parse(event.data);
        
        if (message.type === "CONNECTED" && message.data?.currentStatus) {
          setCurrentStatus(message.data.currentStatus);
        }
        
        if (message.type === "TRAJECTORY_CHANGE") {
          setTrajectoryChange(message.data);
          setCurrentStatus(message.data.newStatus);
        }
      } catch (error) {
        console.error("[SSE] Failed to parse trajectory message:", error);
      }
    };

    eventSource.onerror = (error) => {
      console.error("[SSE] Trajectory stream error:", error);
      setConnected(false);
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [countryId, apiBase]);

  return {
    connected,
    currentStatus,
    trajectoryChange,
  };
}

// ============================================================================
// SSE Hook for Dashboard (all updates)
// ============================================================================

export function useDashboardSSE(apiBase: string = "http://localhost:3000") {
  const [connected, setConnected] = useState(false);
  const [dashboardSummary, setDashboardSummary] = useState<{
    activeAlerts: number;
    criticalAlerts: number;
    connectedClients: number;
  } | null>(null);
  const [lastEvaluation, setLastEvaluation] = useState<any>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const url = `${apiBase}/api/realtime/dashboard`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log("[SSE] Connected to dashboard stream");
      setConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const message: SSEMessage = JSON.parse(event.data);
        
        if (message.type === "DASHBOARD_SUMMARY") {
          setDashboardSummary(message.data);
        }
        
        if (message.type === "EVALUATION_COMPLETE") {
          setLastEvaluation(message.data);
          console.log("[SSE] Evaluation complete:", message.data);
        }
      } catch (error) {
        console.error("[SSE] Failed to parse dashboard message:", error);
      }
    };

    eventSource.onerror = (error) => {
      console.error("[SSE] Dashboard stream error:", error);
      setConnected(false);
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [apiBase]);

  return {
    connected,
    dashboardSummary,
    lastEvaluation,
  };
}

// ============================================================================
// Manual Trigger Functions
// ============================================================================

export async function triggerEvaluation(apiBase: string = "http://localhost:3000"): Promise<{
  success: boolean;
  data?: any;
  error?: string;
}> {
  try {
    const response = await fetch(`${apiBase}/api/realtime/trigger-evaluation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    return await response.json();
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function getRealtimeStatus(apiBase: string = "http://localhost:3000"): Promise<{
  success: boolean;
  data?: any;
}> {
  try {
    const response = await fetch(`${apiBase}/api/realtime/status`);
    return await response.json();
  } catch (error) {
    return { success: false };
  }
}