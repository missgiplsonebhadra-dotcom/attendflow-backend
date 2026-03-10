// backend/server.js — AttendFlow API Server

require("dotenv").config();
const http = require("http");
const url  = require("url");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");

const PORT      = process.env.PORT || 3001;
const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME   = process.env.DB_NAME || "attendflow";

console.log("🚀 AttendFlow starting...");
console.log("   PORT:", PORT);
console.log("   DB_NAME:", DB_NAME);
console.log("   MONGODB_URI:", MONGO_URI ? "✅ Set (" + MONGO_URI.replace(/:([^@]+)@/, ":****@").slice(0,50) + "...)" : "❌ NOT SET");

if (!MONGO_URI) {
  console.error("❌ MONGODB_URI is not set in environment variables!");
  process.exit(1);
}

// ── MongoDB ───────────────────────────────────────────────────────────────
let db;
const client = new MongoClient(MONGO_URI, {
  serverSelectionTimeoutMS: 30000,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 30000,
});

const connectDB = async () => {
  console.log("🔌 Connecting to MongoDB...");
  await client.connect();
  db = client.db(DB_NAME);
  await db.command({ ping: 1 });
  console.log("✅ MongoDB connected:", DB_NAME);
};

// ── CORS ──────────────────────────────────────────────────────────────────
const corsMiddleware = cors({
  origin: "*",
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","x-token","Authorization"],
});

// ── Helpers ───────────────────────────────────────────────────────────────
const newId = () => new ObjectId().toHexString();

const readBody = (req) => new Promise((resolve) => {
  let body = "";
  req.on("data", c => body += c);
  req.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
});

const send = (res, status, data) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-token",
  });
  res.end(JSON.stringify(data));
};

const stripPassword = (user) => {
  if (!user) return null;
  const { password, _id, ...safe } = user;
  return safe;
};

const buildFilter = (query) => {
  const skip = ["_sort","_order","_limit"];
  const filter = {};
  for (const [k,v] of Object.entries(query)) {
    if (!skip.includes(k)) filter[k] = v;
  }
  return filter;
};

// ── HTTP Server ───────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  corsMiddleware(req, res, () => handleRequest(req, res));
});

const handleRequest = async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type,x-token" }); res.end(); return; }

  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname.replace(/\/$/, "") || "/";
  const query    = parsed.query;
  const method   = req.method;

  console.log(`${new Date().toISOString().slice(11,19)} ${method} ${pathname}`);

  try {
    // Health check
    if (method === "GET" && pathname === "/") {
      return send(res, 200, { status: "ok", app: "AttendFlow API", db: DB_NAME, time: new Date().toISOString() });
    }

    // POST /api/login
    if (method === "POST" && pathname === "/api/login") {
      const { email, password } = await readBody(req);
      const user = await db.collection("users").findOne({
        email: { $regex: new RegExp(`^${(email||"").trim()}$`, "i") },
        password: password || "",
      });
      if (!user) return send(res, 401, { error: "Invalid email or password" });
      const token = newId();
      await db.collection("sessions").insertOne({ id: token, userId: user.id, createdAt: new Date() });
      return send(res, 200, { token, user: stripPassword(user) });
    }

    // POST /api/register
    if (method === "POST" && pathname === "/api/register") {
      const { name, email, password, role, team } = await readBody(req);
      const exists = await db.collection("users").findOne({ email: { $regex: new RegExp(`^${(email||"")}$`, "i") } });
      if (exists) return send(res, 409, { error: "Email already registered" });
      const avatar  = (name||"??").split(" ").map(n => n[0]).join("").toUpperCase().slice(0,2);
      const newUser = { id: newId(), name, email, password, role, team, teamId: null, teamName: null, manager: null, avatar };
      await db.collection("users").insertOne(newUser);
      const token = newId();
      await db.collection("sessions").insertOne({ id: token, userId: newUser.id, createdAt: new Date() });
      return send(res, 201, { token, user: stripPassword(newUser) });
    }

    // POST /api/logout
    if (method === "POST" && pathname === "/api/logout") {
      const token = req.headers["x-token"];
      if (token) await db.collection("sessions").deleteOne({ id: token });
      return send(res, 200, { ok: true });
    }

    // GET /api/me
    if (method === "GET" && pathname === "/api/me") {
      const token = req.headers["x-token"];
      const sess  = await db.collection("sessions").findOne({ id: token });
      if (!sess) return send(res, 401, { error: "Not authenticated" });
      const user  = await db.collection("users").findOne({ id: sess.userId });
      if (!user)  return send(res, 404, { error: "User not found" });
      return send(res, 200, stripPassword(user));
    }

    // Generic CRUD
    const parts      = pathname.split("/").filter(Boolean);
    const collection = parts[0];
    const id         = parts[1];

    const ALLOWED = ["users","teams","teamMembers","attendance","leaves","plans","shifts","holidays","notifications","sessions"];
    if (!ALLOWED.includes(collection)) return send(res, 404, { error: "Not found" });

    const col = db.collection(collection);

    if (method === "GET" && !id) {
      const filter = buildFilter(query);
      let cursor = col.find(filter);
      if (query._sort) cursor = cursor.sort({ [query._sort]: query._order === "desc" ? -1 : 1 });
      let results = await cursor.toArray();
      results = results.map(({ _id, ...r }) => r);
      if (collection === "users") results = results.map(({ password, ...u }) => u);
      return send(res, 200, results);
    }

    if (method === "GET" && id) {
      const item = await col.findOne({ id });
      if (!item) return send(res, 404, { error: "Not found" });
      const { _id, ...safe } = item;
      if (collection === "users") { const { password, ...u } = safe; return send(res, 200, u); }
      return send(res, 200, safe);
    }

    if (method === "POST" && !id) {
      const body    = await readBody(req);
      const newItem = { id: newId(), ...body };
      await col.insertOne(newItem);
      const { _id, ...safe } = newItem;
      return send(res, 201, safe);
    }

    if (method === "PATCH" && id) {
      const body   = await readBody(req);
      const result = await col.findOneAndUpdate({ id }, { $set: body }, { returnDocument: "after" });
      if (!result) return send(res, 404, { error: "Not found" });
      const { _id, ...safe } = result;
      return send(res, 200, safe);
    }

    if (method === "DELETE" && id) {
      const result = await col.deleteOne({ id });
      if (result.deletedCount === 0) return send(res, 404, { error: "Not found" });
      return send(res, 200, { deleted: true });
    }

    send(res, 405, { error: "Method not allowed" });

  } catch (err) {
    console.error("❌ Request error:", err.message);
    send(res, 500, { error: "Server error: " + err.message });
  }
};

// ── Start — server starts immediately, MongoDB connects separately ─────────
// This prevents Render from killing the process before MongoDB connects
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✅ HTTP server listening on port ${PORT}`);
  console.log("========================================");
  console.log("  AttendFlow API is LIVE ✓");
  console.log("========================================\n");
});

// Connect MongoDB after server starts
connectDB().catch(err => {
  console.error("❌ MongoDB connection failed:", err.message);
  console.error("   Full error:", err);
  // Don't exit — log the error but keep server running so Render doesn't restart loop
});
