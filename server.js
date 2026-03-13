// backend/server.js — AttendFlow API (PostgreSQL version)
require("dotenv").config();

// Force IPv4 BEFORE any network calls
const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const http = require("http");
const url  = require("url");
const cors = require("cors");

const PORT         = process.env.PORT || 3001;
const DATABASE_URL = process.env.DATABASE_URL;

console.log("🚀 AttendFlow starting... Node:", process.version);
console.log("   DATABASE_URL:", DATABASE_URL ? "✅ Set" : "❌ NOT SET");

if (!DATABASE_URL) { console.error("❌ DATABASE_URL not set!"); process.exit(1); }

// Direct pool — IPv4 handled by dns.setDefaultResultOrder
const createPool = () => {
  const { Pool } = require("pg");
  return new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    allowExitOnIdle: false,
  });
};

// ── Helpers ───────────────────────────────────────────────────────────────
let pool = null;

const getPool = () => {
  if (!pool) pool = createPool();
  return pool;
};

// ── Init DB tables ────────────────────────────────────────────────────────
const initDB = async (retries = 5) => {
  for (let i = 0; i < retries; i++) {
    try {
      const p = getPool();
      const client = await p.connect();
      client.release();
      break;
    } catch(e) {
      console.log(`⏳ DB connection attempt ${i+1}/${retries}...`);
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 3000));
      pool = null; // reset pool and retry
    }
  }
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS store (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    const res = await client.query(`SELECT key FROM store WHERE key='users'`);
    if (res.rows.length === 0) {
      console.log("🌱 Seeding default data...");
      const defaultData = {
        users: [
          {id:"u1",name:"Bittu Pandey",email:"admin@attendflow.com",password:"admin123",role:"super_admin",team:"Administration",teamId:null,teamName:null,manager:null,avatar:"BP"},
          {id:"u2",name:"Priya Mehta",email:"priya@attendflow.com",password:"priya123",role:"manager",team:"Engineering",teamId:"t1",teamName:"Engineering",manager:"u1",avatar:"PM"},
          {id:"u3",name:"Ravi Nair",email:"ravi@attendflow.com",password:"ravi123",role:"hr_admin",team:"HR",teamId:"t2",teamName:"HR",manager:"u1",avatar:"RN"},
          {id:"u4",name:"Arjun Sharma",email:"arjun@attendflow.com",password:"arjun123",role:"employee",team:"Engineering",teamId:"t1",teamName:"Engineering",manager:"u2",avatar:"AS"},
          {id:"u5",name:"Meera Patel",email:"meera@attendflow.com",password:"meera123",role:"employee",team:"Engineering",teamId:"t1",teamName:"Engineering",manager:"u2",avatar:"MP"},
          {id:"u6",name:"Karan Singh",email:"karan@attendflow.com",password:"karan123",role:"employee",team:"HR",teamId:"t2",teamName:"HR",manager:"u3",avatar:"KS"},
        ],
        teams:[
          {id:"t1",name:"Engineering",description:"Product & software development",color:"#3B82F6",managerId:"u2",managerName:"Priya Mehta",memberCount:3},
          {id:"t2",name:"HR",description:"Human resources & operations",color:"#10B981",managerId:"u3",managerName:"Ravi Nair",memberCount:2},
        ],
        teamMembers:[],attendance:[],leaves:[],plans:[],
        shifts:[
          {id:"s1",name:"Morning Shift",startTime:"09:00",endTime:"18:00",color:"#3B82F6",graceMinutes:15},
          {id:"s2",name:"Night Shift",startTime:"21:00",endTime:"06:00",color:"#8B5CF6",graceMinutes:15},
        ],
        holidays:[
          {id:"h1",name:"Holi",date:"2026-03-14",type:"National Holiday"},
          {id:"h2",name:"Ram Navami",date:"2026-04-02",type:"National Holiday"},
          {id:"h3",name:"Good Friday",date:"2026-04-03",type:"National Holiday"},
          {id:"h4",name:"Company Picnic",date:"2026-03-21",type:"Company Holiday"},
        ],
        notifications:[],sessions:[],
      };
      for (const [key, value] of Object.entries(defaultData)) {
        await client.query(`INSERT INTO store(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING`, [key, JSON.stringify(value)]);
      }
      console.log("✅ Default data seeded");
    }
    console.log("✅ PostgreSQL connected & ready");
  } finally {
    client.release();
  }
};

// ── DB helpers ────────────────────────────────────────────────────────────
const getCollection = async (name) => {
  const p = getPool();
  const res = await p.query(`SELECT value FROM store WHERE key=$1`, [name]);
  return res.rows.length ? res.rows[0].value : [];
};

const saveCollection = async (name, data) => {
  const p = getPool();
  await p.query(`INSERT INTO store(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=NOW()`, [name, JSON.stringify(data)]);
};

const newId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ── HTTP Helpers ──────────────────────────────────────────────────────────
const corsMiddleware = cors({ origin:"*", methods:["GET","POST","PUT","PATCH","DELETE","OPTIONS"], allowedHeaders:["Content-Type","x-token","Authorization"] });

const readBody = (req) => new Promise((resolve) => {
  let body = "";
  req.on("data", c => body += c);
  req.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
});

const send = (res, status, data) => {
  res.writeHead(status, { "Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type,x-token" });
  res.end(JSON.stringify(data));
};

const stripPassword = (user) => { if (!user) return null; const { password, ...safe } = user; return safe; };

// ── Server ────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  corsMiddleware(req, res, () => handleRequest(req, res));
});

const handleRequest = async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type,x-token","Access-Control-Allow-Methods":"GET,POST,PUT,PATCH,DELETE,OPTIONS"});
    res.end(); return;
  }

  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname.replace(/\/$/, "") || "/";
  const query    = parsed.query;
  const method   = req.method;

  console.log(`${new Date().toISOString().slice(11,19)} ${method} ${pathname}`);

  try {
    if (method === "GET" && pathname === "/") {
      return send(res, 200, { status:"ok", app:"AttendFlow API", db:"PostgreSQL", time:new Date().toISOString() });
    }

    if (method === "POST" && pathname === "/api/login") {
      const { email, password } = await readBody(req);
      const users = await getCollection("users");
      const user  = users.find(u => u.email.toLowerCase() === (email||"").toLowerCase().trim() && u.password === (password||""));
      if (!user) return send(res, 401, { error:"Invalid email or password" });
      const token = newId();
      const sessions = await getCollection("sessions");
      sessions.push({ id:token, userId:user.id, createdAt:new Date().toISOString() });
      await saveCollection("sessions", sessions);
      return send(res, 200, { token, user:stripPassword(user) });
    }

    if (method === "POST" && pathname === "/api/register") {
      const { name, email, password, role, team } = await readBody(req);
      const users = await getCollection("users");
      if (users.find(u => u.email.toLowerCase() === (email||"").toLowerCase()))
        return send(res, 409, { error:"Email already registered" });
      const avatar  = (name||"??").split(" ").map(n=>n[0]).join("").toUpperCase().slice(0,2);
      const newUser = { id:newId(), name, email, password, role, team, teamId:null, teamName:null, manager:null, avatar };
      users.push(newUser);
      await saveCollection("users", users);
      const token = newId();
      const sessions = await getCollection("sessions");
      sessions.push({ id:token, userId:newUser.id, createdAt:new Date().toISOString() });
      await saveCollection("sessions", sessions);
      return send(res, 201, { token, user:stripPassword(newUser) });
    }

    if (method === "POST" && pathname === "/api/logout") {
      const token = req.headers["x-token"];
      const sessions = await getCollection("sessions");
      await saveCollection("sessions", sessions.filter(s => s.id !== token));
      return send(res, 200, { ok:true });
    }

    if (method === "GET" && pathname === "/api/me") {
      const token    = req.headers["x-token"];
      const sessions = await getCollection("sessions");
      const sess     = sessions.find(s => s.id === token);
      if (!sess) return send(res, 401, { error:"Not authenticated" });
      const users    = await getCollection("users");
      const user     = users.find(u => u.id === sess.userId);
      if (!user) return send(res, 404, { error:"User not found" });
      return send(res, 200, stripPassword(user));
    }

    const parts      = pathname.split("/").filter(Boolean);
    const collection = parts[0];
    const id         = parts[1];
    const ALLOWED    = ["users","teams","teamMembers","attendance","leaves","plans","shifts","holidays","notifications","sessions"];
    if (!ALLOWED.includes(collection)) return send(res, 404, { error:"Not found" });

    if (method === "GET" && !id) {
      let items = await getCollection(collection);
      for (const [k,v] of Object.entries(query)) {
        if (["_sort","_order"].includes(k)) continue;
        items = items.filter(i => String(i[k]) === String(v));
      }
      if (query._sort) items.sort((a,b) => query._order==="desc" ? (b[query._sort]>a[query._sort]?1:-1) : (a[query._sort]>b[query._sort]?1:-1));
      if (collection==="users") items = items.map(({password,...u})=>u);
      return send(res, 200, items);
    }

    if (method === "GET" && id) {
      const items = await getCollection(collection);
      const item  = items.find(i => i.id === id);
      if (!item) return send(res, 404, { error:"Not found" });
      if (collection==="users") { const {password,...u}=item; return send(res,200,u); }
      return send(res, 200, item);
    }

    if (method === "POST" && !id) {
      const body    = await readBody(req);
      const items   = await getCollection(collection);
      const newItem = { id:newId(), ...body };
      items.push(newItem);
      await saveCollection(collection, items);
      return send(res, 201, newItem);
    }

    if (method === "PATCH" && id) {
      const body  = await readBody(req);
      const items = await getCollection(collection);
      const idx   = items.findIndex(i => i.id === id);
      if (idx===-1) return send(res, 404, { error:"Not found" });
      items[idx] = { ...items[idx], ...body };
      await saveCollection(collection, items);
      return send(res, 200, items[idx]);
    }

    if (method === "DELETE" && id) {
      const items    = await getCollection(collection);
      const filtered = items.filter(i => i.id !== id);
      if (filtered.length === items.length) return send(res, 404, { error:"Not found" });
      await saveCollection(collection, filtered);
      return send(res, 200, { deleted:true });
    }

    send(res, 405, { error:"Method not allowed" });

  } catch(err) {
    console.error("❌ Error:", err.message);
    pool = null; // Reset pool on error - will reconnect next request
    send(res, 500, { error:"Server error: " + err.message });
  }
};

// ── Start ─────────────────────────────────────────────────────────────────
const start = async () => {
  // Start HTTP server FIRST so Render doesn't kill us
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ HTTP server on port ${PORT}`);
  });
  
  // Then connect to DB
  try {
    await initDB();
    console.log("========================================");
    console.log("  AttendFlow API is LIVE ✓ (PostgreSQL)");
    console.log("========================================");
  } catch(err) {
    console.error("❌ DB init failed:", err.message);
    // Don't exit — server is still running, will retry on requests
  }
};

start();
