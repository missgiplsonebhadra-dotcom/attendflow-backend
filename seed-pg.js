// seed-pg.js — Migrate data to PostgreSQL (Supabase/Render/Neon)
// Run: node seed-pg.js "postgresql://postgres:PASSWORD@db.xxx.supabase.co:5432/postgres"

const { Pool } = require("pg");

const connStr = process.argv[2];
if (!connStr || !connStr.startsWith("postgres")) {
  console.error("\n❌ Please provide connection string!\n");
  console.error('node seed-pg.js "postgresql://postgres:PASSWORD@db.xxx.supabase.co:5432/postgres"\n');
  process.exit(1);
}

console.log("✅ Connection string received");

const pool = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });

const DATA = {
  users: [
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

const run = async () => {
  const client = await pool.connect();
  console.log("✅ Connected to PostgreSQL!\n");

  // Create table
  await client.query(`
    CREATE TABLE IF NOT EXISTS store (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log("✅ Table ready");

  // Insert all collections
  for (const [key, value] of Object.entries(DATA)) {
    await client.query(
      `INSERT INTO store(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=NOW()`,
      [key, JSON.stringify(value)]
    );
    console.log(`✅ ${key}: ${value.length} records`);
  }

  client.release();
  await pool.end();
  console.log("\n🎉 Migration complete! Data is now in Supabase.\n");
};

run().catch(err => {
  console.error("\n❌ Failed:", err.message);
  process.exit(1);
});
