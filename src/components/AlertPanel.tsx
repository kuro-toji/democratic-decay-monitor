import { useState, useCallback, useEffect } from "react";
import { useAlertSSE, triggerEvaluation } from "../lib/useRealtime";
import type { AlertSummary } from "../lib/useRealtime";

// ============================================================================
// Types
// ============================================================================

interface Alert {
  id: number;
  countryId: number;
  countryName?: string;
  alertType: string;
  priority: "CRITICAL" | "WARNING" | "INFO";
  title: string;
  message: string;
  affectedIndicators?: string[];
  createdAt: string;
  resolved: boolean;
}

interface AlertPanelProps {
  maxVisible?: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getTimeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  
  const intervals = [
    { label: "y", seconds: 31536000 },
    { label: "mo", seconds: 2592000 },
    { label: "d", seconds: 86400 },
    { label: "h", seconds: 3600 },
    { label: "m", seconds: 60 },
  ];

  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds);
    if (count >= 1) {
      return `${count}${interval.label} ago`;
    }
  }
  return "just now";
}

function formatIndicatorName(name: string): string {
  return name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ============================================================================
// Alert Card Component
// ============================================================================

function AlertCard({ alert, onResolve }: { alert: Alert; onResolve: () => void }) {
  const [expanded, setExpanded] = useState(false);

  const typeIcons: Record<string, string> = {
    TRAJECTORY_CHANGE: "📈",
    INDICATOR_CRITICAL: "⚠️",
    RAPID_DECLINE: "📉",
    ANALOGUE_MATCH: "🔍",
  };

  return (
    <div className={`alert-card ${alert.priority.toLowerCase()} ${alert.resolved ? "resolved" : ""}`}>
      <div className="alert-header" onClick={() => setExpanded(!expanded)}>
        <div className="alert-type-icon">{typeIcons[alert.alertType] ?? "📋"}</div>
        <div className="alert-info">
          <div className="alert-country">{alert.countryName ?? "Unknown Country"}</div>
          <div className="alert-title">{alert.title}</div>
        </div>
        <div className="alert-meta">
          <span className="alert-time">{getTimeAgo(alert.createdAt)}</span>
          <button 
            className="resolve-btn" 
            onClick={(e) => { e.stopPropagation(); onResolve(); }}
            title="Mark as resolved"
          >
            ✓
          </button>
        </div>
      </div>
      
      {expanded && (
        <div className="alert-body">
          <p className="alert-message">{alert.message}</p>
          {alert.affectedIndicators && alert.affectedIndicators.length > 0 && (
            <div className="alert-indicators">
              <span className="indicators-label">Affected indicators:</span>
              <div className="indicator-tags">
                {alert.affectedIndicators.map((ind) => (
                  <span key={ind} className="indicator-tag">{formatIndicatorName(ind)}</span>
                ))}
              </div>
            </div>
          )}
          <div className="alert-footer">
            <span className={`priority-tag ${alert.priority.toLowerCase()}`}>{alert.priority}</span>
            <span className="type-tag">{alert.alertType.replace("_", " ")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Alert Summary Bar
// ============================================================================

function AlertSummaryBar({ 
  summary, 
  onClick,
  isLive 
}: { 
  summary: AlertSummary; 
  onClick: () => void;
  isLive: boolean;
}) {
  return (
    <div className="alert-summary-bar" onClick={onClick}>
      <div className="summary-total">
        <span className="live-indicator">
          {isLive ? "🔴 LIVE" : "⚫ OFFLINE"}
        </span>
        <span className="total-count">{summary.total}</span>
        <span className="total-label">Active Alerts</span>
      </div>
      <div className="summary-breakdown">
        {summary.critical > 0 && (
          <div className="summary-item critical">
            <span className="item-count">{summary.critical}</span>
            <span className="item-label">Critical</span>
          </div>
        )}
        {summary.warning > 0 && (
          <div className="summary-item warning">
            <span className="item-count">{summary.warning}</span>
            <span className="item-label">Warning</span>
          </div>
        )}
        {summary.info > 0 && (
          <div className="summary-item info">
            <span className="item-count">{summary.info}</span>
            <span className="item-label">Info</span>
          </div>
        )}
      </div>
      <div className="summary-arrow">›</div>
    </div>
  );
}

// ============================================================================
// Alert Panel Component (Real-time enabled)
// ============================================================================

export default function AlertPanel({ maxVisible = 10 }: AlertPanelProps) {
  const [filter, setFilter] = useState<"CRITICAL" | "WARNING" | "INFO" | "ALL">("ALL");
  const [expanded, setExpanded] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Real-time SSE connection
  const { connected, alertSummary, lastMessage, reconnect } = useAlertSSE();

  // Convert SSE messages to local alerts (mock for demo)
  useEffect(() => {
    if (lastMessage?.type === "ALERT_SUMMARY" && lastMessage.data?.recent) {
      const mockAlerts: Alert[] = lastMessage.data.recent.map((a: any, i: number) => ({
        id: i + 1,
        countryId: a.countryId ?? 1,
        countryName: a.country?.name ?? "Unknown",
        alertType: a.alertType ?? "TRAJECTORY_CHANGE",
        priority: a.priority ?? "WARNING",
        title: a.title ?? `Alert for ${a.country?.name ?? "Country"}`,
        message: a.message ?? "System alert triggered",
        affectedIndicators: a.affectedIndicators ?? [],
        createdAt: a.createdAt ?? new Date().toISOString(),
        resolved: a.resolved ?? false,
      }));
      setAlerts(mockAlerts);
    }
  }, [lastMessage]);

  // Manual refresh
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const result = await triggerEvaluation();
      console.log("[AlertPanel] Evaluation triggered:", result);
    } catch (error) {
      console.error("[AlertPanel] Refresh failed:", error);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const filteredAlerts = alerts.filter((alert) => 
    filter === "ALL" || alert.priority === filter
  ).slice(0, expanded ? undefined : maxVisible);

  // Group by priority
  const groupedAlerts = {
    CRITICAL: filteredAlerts.filter(a => a.priority === "CRITICAL"),
    WARNING: filteredAlerts.filter(a => a.priority === "WARNING"),
    INFO: filteredAlerts.filter(a => a.priority === "INFO"),
  };

  const handleResolve = async (alertId: number) => {
    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, resolved: true } : a));
  };

  if (!connected && alerts.length === 0) {
    return (
      <div className="alert-panel error">
        <div className="connection-status disconnected">
          <span className="status-icon">⚠️</span>
          <span className="status-text">Disconnected from real-time feed</span>
        </div>
        <button className="reconnect-btn" onClick={reconnect}>
          Reconnect
        </button>
        <p className="connection-hint">
          The backend server must be running to receive live alerts.
        </p>
      </div>
    );
  }

  if (alertSummary.total === 0 && alerts.length === 0) {
    return (
      <div className="alert-panel empty">
        <div className="empty-icon">✓</div>
        <span className="empty-text">No active alerts</span>
        <span className="empty-subtext">All countries are stable</span>
        {connected && (
          <div className="live-badge">🔴 Live monitoring active</div>
        )}
      </div>
    );
  }

  return (
    <div className="alert-panel">
      {/* Header with controls */}
      <div className="panel-header">
        <span>ACTIVE ALERTS</span>
        <div className="header-actions">
          <button 
            className={`refresh-btn ${isRefreshing ? "spinning" : ""}`} 
            onClick={handleRefresh}
            title="Refresh alerts"
            disabled={isRefreshing}
          >
            ↻
          </button>
          <select 
            className="filter-select"
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
          >
            <option value="ALL">All</option>
            <option value="CRITICAL">Critical</option>
            <option value="WARNING">Warning</option>
            <option value="INFO">Info</option>
          </select>
        </div>
      </div>

      {/* Summary bar with live indicator */}
      <AlertSummaryBar 
        summary={alertSummary.total > 0 ? alertSummary : { total: alerts.length, critical: groupedAlerts.CRITICAL.length, warning: groupedAlerts.WARNING.length, info: groupedAlerts.INFO.length }}
        onClick={() => setExpanded(!expanded)}
        isLive={connected}
      />

      {/* Connection indicator */}
      {connected && (
        <div className="sse-indicator">
          <span className="pulse-dot"></span>
          <span className="sse-text">Real-time updates active</span>
        </div>
      )}

      {/* Alert list */}
      <div className="alert-list">
        {groupedAlerts.CRITICAL.length > 0 && (
          <div className="alert-section">
            {filter === "ALL" && (
              <div className="section-header critical">
                <span>⚠️ Critical ({groupedAlerts.CRITICAL.length})</span>
              </div>
            )}
            {groupedAlerts.CRITICAL.map((alert) => (
              <AlertCard 
                key={alert.id} 
                alert={alert} 
                onResolve={() => handleResolve(alert.id)} 
              />
            ))}
          </div>
        )}

        {groupedAlerts.WARNING.length > 0 && (
          <div className="alert-section">
            {filter === "ALL" && (
              <div className="section-header warning">
                <span>⚡ Warning ({groupedAlerts.WARNING.length})</span>
              </div>
            )}
            {groupedAlerts.WARNING.map((alert) => (
              <AlertCard 
                key={alert.id} 
                alert={alert} 
                onResolve={() => handleResolve(alert.id)} 
              />
            ))}
          </div>
        )}

        {groupedAlerts.INFO.length > 0 && (
          <div className="alert-section">
            {filter === "ALL" && (
              <div className="section-header info">
                <span>ℹ️ Info ({groupedAlerts.INFO.length})</span>
              </div>
            )}
            {groupedAlerts.INFO.map((alert) => (
              <AlertCard 
                key={alert.id} 
                alert={alert} 
                onResolve={() => handleResolve(alert.id)} 
              />
            ))}
          </div>
        )}
      </div>

      {/* Show more/less */}
      {alerts.length > maxVisible && !expanded && (
        <button className="show-more-btn" onClick={() => setExpanded(true)}>
          Show all {alerts.length} alerts
        </button>
      )}
    </div>
  );
}