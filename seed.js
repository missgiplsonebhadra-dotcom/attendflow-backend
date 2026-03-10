// backend/seed.js  — Run: node seed.js "YOUR_MONGODB_URI"

const path = require("path");
const fs   = require("fs");

// ── Get MongoDB URI from command line argument ────────────────────────────
const MONGO_URI = process.argv[2];

if (!MONGO_URI || !MONGO_URI.startsWith("mongodb")) {
  console.error("\n❌ Please paste your MongoDB URI in the command!\n");
  console.error("Run it like this (copy the whole line):\n");
  console.error('node seed.js "mongodb+srv://attendflow:attendflow@sonbhadra.pfpqqx9.mongodb.net/attendflow?appName=Sonbhadra"\n');
  process.exit(1);
}

console.log("✅ URI received:", MONGO_URI.replace(/:([^@]+)@/, ":****@"));

const { MongoClient } = require("mongodb");

// ── Load db.json ──────────────────────────────────────────────────────────
let DATA;
const localDB = path.join(__dirname, "db.json");
if (fs.existsSync(localDB)) {
  DATA = JSON.parse(fs.readFileSync(localDB, "utf8"));
  console.log("📂 Loaded data from db.json");
} else {
  DATA = {
    users:[
      {id:"u1",name:"Sunita Kapoor",email:"admin@attendflow.com",password:"admin123",role:"super_admin",team:"Leadership",teamId:null,teamName:null,manager:null,avatar:"SK"},
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
  console.log("📋 Using default demo data");
}

// ── Migrate ───────────────────────────────────────────────────────────────
const run = async () => {
  console.log("\n🔌 Connecting to MongoDB Atlas...");
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db("attendflow");
  console.log("✅ Connected!\n");

  for (const [col, docs] of Object.entries(DATA)) {
    if (!Array.isArray(docs) || docs.length === 0) {
      console.log(`⏭  Skipping ${col} (empty)`);
      continue;
    }
    await db.collection(col).deleteMany({});
    await db.collection(col).insertMany(docs);
    console.log(`✅ ${col}: ${docs.length} records imported`);
  }

  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("sessions").createIndex({ id: 1 });
  await db.collection("attendance").createIndex({ userId: 1, date: 1 });
  console.log("✅ Indexes created");
  console.log("\n🎉 Migration complete! Data is now in MongoDB Atlas.\n");
  await client.close();
};

run().catch(err => {
  console.error("\n❌ Migration failed:", err.message);
  if (err.message.includes("bad auth") || err.message.includes("Authentication"))
    console.error("→ Wrong password in the URI");
  else if (err.message.includes("timed out") || err.message.includes("ECONNREFUSED"))
    console.error("→ Check internet / MongoDB IP whitelist (allow 0.0.0.0/0)");
  process.exit(1);
});
