import { useState } from "react";
import { useActiveAlerts, api } from "../lib/api";
import type { Alert } from "../lib/api";

// ============================================================================
// Types
// ============================================================================

interface AlertPanelProps {
  maxVisible?: number;
}

interface AlertGroup {
  CRITICAL: Alert[];
  WARNING: Alert[];
  INFO: Alert[];
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

  const timeAgo = getTimeAgo(new Date(alert.createdAt));

  return (
    <div className={`alert-card ${alert.priority.toLowerCase()} ${alert.resolved ? "resolved" : ""}`}>
      <div className="alert-header" onClick={() => setExpanded(!expanded)}>
        <div className="alert-type-icon">{typeIcons[alert.alertType] ?? "📋"}</div>
        <div className="alert-info">
          <div className="alert-country">{alert.country?.name ?? "Unknown Country"}</div>
          <div className="alert-title">{alert.title}</div>
        </div>
        <div className="alert-meta">
          <span className="alert-time">{timeAgo}</span>
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

function AlertSummaryBar({ summary, onClick }: { summary: { total: number; critical: number; warning: number; info: number }; onClick: () => void }) {
  return (
    <div className="alert-summary-bar" onClick={onClick}>
      <div className="summary-total">
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
// Alert Panel Component
// ============================================================================

export default function AlertPanel({ maxVisible = 10 }: AlertPanelProps) {
  const { alerts, summary, loading, error, refresh } = useActiveAlerts();
  const [filter, setFilter] = useState<Alert["priority"] | "ALL">("ALL");
  const [expanded, setExpanded] = useState(false);

  const filteredAlerts = alerts.filter((alert) => 
    filter === "ALL" || alert.priority === filter
  ).slice(0, expanded ? undefined : maxVisible);

  const groupedAlerts = filteredAlerts.reduce<AlertGroup>((acc, alert) => {
    acc[alert.priority].push(alert);
    return acc;
  }, { CRITICAL: [], WARNING: [], INFO: [] });

  const handleResolve = async (alertId: number) => {
    try {
      await api.resolveAlert(alertId);
      refresh();
    } catch (err) {
      console.error("Failed to resolve alert:", err);
    }
  };

  if (loading) {
    return (
      <div className="alert-panel loading">
        <div className="loading-spinner" />
        <span>Loading alerts...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert-panel error">
        <span>⚠️ Failed to load alerts</span>
        <button onClick={refresh}>Retry</button>
      </div>
    );
  }

  if (summary.total === 0) {
    return (
      <div className="alert-panel empty">
        <div className="empty-icon">✓</div>
        <span className="empty-text">No active alerts</span>
        <span className="empty-subtext">All countries are stable</span>
      </div>
    );
  }

  return (
    <div className="alert-panel">
      {/* Header with summary */}
      <div className="panel-header">
        <span>ACTIVE ALERTS</span>
        <div className="header-actions">
          <button className="refresh-btn" onClick={refresh} title="Refresh alerts">
            ↻
          </button>
          <select 
            className="filter-select"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Alert["priority"] | "ALL")}
          >
            <option value="ALL">All</option>
            <option value="CRITICAL">Critical</option>
            <option value="WARNING">Warning</option>
            <option value="INFO">Info</option>
          </select>
        </div>
      </div>

      {/* Summary bar */}
      <AlertSummaryBar 
        summary={summary} 
        onClick={() => setExpanded(!expanded)} 
      />

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

// ============================================================================
// Helper Functions
// ============================================================================

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  
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