const { createClient } = require("@libsql/client")

const db = createClient({
  url:   process.env.TURSO_URL   || "libsql://vocab-db-omi5.aws-ap-south-1.turso.io",
  authToken: process.env.TURSO_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzM1MDk1MTksImlkIjoiMDE5Y2VkM2ItNjEwMS03YzBkLThjMDUtOTViMTE2NjEzYTc0IiwicmlkIjoiYTQxYTg2ZGQtNGRjMi00MDkxLThhZjgtYWJhM2M4ZGEwNjQ5In0.Zx6lfVroaloG4jy4YO2rSSeQCV0mbD9TSHrgPvNJRHp_OyPwEW-2ixEXecd299gYfIrrPRGT8EHbUvTuThxECg"
})

async function initDB() {
  try {
    await db.execute("CREATE TABLE IF NOT EXISTS chapters (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL)")
    await db.execute("CREATE TABLE IF NOT EXISTS words (id INTEGER PRIMARY KEY AUTOINCREMENT, chapter TEXT NOT NULL, japanese TEXT NOT NULL, english TEXT NOT NULL)")
    await db.execute("CREATE TABLE IF NOT EXISTS word_stats (id INTEGER PRIMARY KEY AUTOINCREMENT, word_id INTEGER NOT NULL UNIQUE, seen INTEGER DEFAULT 0, correct INTEGER DEFAULT 0, wrong INTEGER DEFAULT 0)")
    console.log("✅ Turso database ready")
  } catch(e) {
    console.error("❌ DB init error:", e.message)
  }
}

module.exports = { db, initDB }
