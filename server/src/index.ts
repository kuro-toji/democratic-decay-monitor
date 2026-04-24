import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

// Import routes
import { countriesRoutes } from "./routes/countries";
import { alertsRoutes } from "./routes/alerts";
import { aipRoutes } from "./routes/aip";
import { healthRoutes } from "./routes/health";

// Initialize database (auto-creates tables)
import { initializeDatabase } from "./services/initDb";

// ============================================================================
// App Configuration
// ============================================================================

type Env = {
  Bindings: {
    PORT: number;
    DATABASE_URL: string;
    MINIMAX_API_KEY?: string;
  };
  Variables: {};
};

const app = new Hono<Env>();

// ============================================================================
// Middleware
// ============================================================================

// CORS for frontend access (configure origins for production)
app.use(
  "*",
  cors({
    origin: process.env.CORS_ORIGINS?.split(",") ?? ["http://localhost:5173", "http://localhost:3000"],
    credentials: true,
  })
);

// Request logging with timing
app.use("*", logger());

// ============================================================================
// Routes
// ============================================================================

// Health check endpoint for deployment monitoring
app.route("/api/health", healthRoutes);

// Countries CRUD + trajectory analysis
app.route("/api/countries", countriesRoutes);

// Alerts management
app.route("/api/alerts", alertsRoutes);

// AIP (AI-powered analysis) endpoints
app.route("/api/aip", aipRoutes);

// ============================================================================
// Error Handling
// ============================================================================

// Global error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json(
    {
      success: false,
      error: {
        message: err.message || "Internal Server Error",
        code: "INTERNAL_ERROR",
      },
    },
    500
  );
});

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: {
        message: "Resource not found",
        code: "NOT_FOUND",
      },
    },
    404
  );
});

// ============================================================================
// Server Bootstrap
// ============================================================================

async function bootstrap() {
  // Initialize database and run migrations
  console.log("🚀 Initializing database...");
  await initializeDatabase();
  console.log("✅ Database ready");

  // Start server
  const port = Number(process.env.PORT ?? 3000);
  console.log(`🌐 Starting API server on port ${port}...`);

  // Use Bun's native HTTP server
  const server = Bun.serve({
    fetch: app.fetch,
    port,
    hostname: "0.0.0.0",
  });

  console.log(`✅ API server running at http://localhost:${server.port}`);
  console.log(`📚 API documentation: http://localhost:${server.port}/api/health`);
}

// Run bootstrap (only in main context, not during tests)
bootstrap().catch(console.error);

export default app;