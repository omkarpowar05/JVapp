const express = require("express")
const cors    = require("cors")
const path    = require("path")
const { db, initDB } = require("./db")

const app = express()

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, "../public")))

const ADMIN_USER = "omkar"
const ADMIN_PASS = "966546"

/* ── ROOT ── */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"))
})

/* ── AUTH ── */
app.post("/login", (req, res) => {
  const { username, password } = req.body
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ role: "admin" })
  }
  return res.status(401).json({ error: "Invalid credentials" })
})

/* ── DEBUG ── */
app.get("/debug/chapters", async (req, res) => {
  try {
    const result = await db.execute("SELECT * FROM chapters")
    res.json({ rows: result.rows, count: result.rows.length })
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack })
  }
})

/* ── CHAPTERS ── */
app.get("/chapters", async (req, res) => {
  try {
    const result = await db.execute("SELECT * FROM chapters")
    // Natural numeric sort: Chapter 1, Chapter 2, ... Chapter 10, Chapter 11
    const sorted = result.rows.sort((a, b) => {
      const numA = parseInt(a.name.replace(/[^0-9]/g, "")) || 0
      const numB = parseInt(b.name.replace(/[^0-9]/g, "")) || 0
      if (numA !== numB) return numA - numB
      return a.name.localeCompare(b.name)
    })
    res.json(sorted)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post("/addChapter", async (req, res) => {
  const { name } = req.body
  if (!name || !name.trim()) return res.status(400).json({ error: "Name required" })
  try {
    const existing = await db.execute({ sql: "SELECT id FROM chapters WHERE name = ?", args: [name.trim()] })
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Chapter already exists" })
    }
    await db.execute({ sql: "INSERT INTO chapters (name) VALUES (?)", args: [name.trim()] })
    res.json({ status: "ok" })
  } catch (e) {
    console.error("addChapter error:", e.message)
    res.status(500).json({ error: e.message })
  }
})

app.delete("/chapter/:name", async (req, res) => {
  try {
    await db.execute({ sql: "DELETE FROM words WHERE chapter = ?",  args: [req.params.name] })
    await db.execute({ sql: "DELETE FROM chapters WHERE name = ?",  args: [req.params.name] })
    res.json({ status: "deleted" })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

/* ── WORDS ── */
app.get("/words/:chapter", async (req, res) => {
  try {
    const result = await db.execute({
      sql:  "SELECT * FROM words WHERE chapter = ? ORDER BY id",
      args: [req.params.chapter]
    })
    res.json(result.rows)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post("/addWord", async (req, res) => {
  const { chapter, japanese, english } = req.body
  if (!chapter || !japanese || !english)
    return res.status(400).json({ error: "All fields required" })
  try {
    const r = await db.execute({
      sql:  "INSERT INTO words (chapter, japanese, english) VALUES (?, ?, ?)",
      args: [chapter, japanese.trim(), english.trim()]
    })
    await db.execute({
      sql:  "INSERT OR IGNORE INTO word_stats (word_id) VALUES (?)",
      args: [Number(r.lastInsertRowid)]
    })
    res.json({ status: "saved" })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete("/word/:id", async (req, res) => {
  try {
    await db.execute({ sql: "DELETE FROM words WHERE id = ?", args: [req.params.id] })
    res.json({ status: "deleted" })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post("/bulk", async (req, res) => {
  const { words } = req.body
  if (!Array.isArray(words) || !words.length)
    return res.status(400).json({ error: "No words provided" })
  try {
    for (const w of words) {
      const r = await db.execute({
        sql:  "INSERT INTO words (chapter, japanese, english) VALUES (?, ?, ?)",
        args: [w.chapter, w.jp, w.en]
      })
      await db.execute({
        sql:  "INSERT OR IGNORE INTO word_stats (word_id) VALUES (?)",
        args: [Number(r.lastInsertRowid)]
      })
    }
    res.json({ status: "imported", count: words.length })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

/* ── STATS ── */
app.post("/recordAnswer", async (req, res) => {
  const { wordId, correct } = req.body
  if (!wordId) return res.status(400).json({ error: "wordId required" })
  try {
    await db.execute({
      sql:  "INSERT OR IGNORE INTO word_stats (word_id) VALUES (?)",
      args: [wordId]
    })
    if (correct) {
      await db.execute({
        sql:  "UPDATE word_stats SET seen = seen+1, correct = correct+1 WHERE word_id = ?",
        args: [wordId]
      })
    } else {
      await db.execute({
        sql:  "UPDATE word_stats SET seen = seen+1, wrong = wrong+1 WHERE word_id = ?",
        args: [wordId]
      })
    }
    res.json({ status: "ok" })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get("/stats/:chapter", async (req, res) => {
  try {
    const result = await db.execute({
      sql: `
        SELECT
          w.id,
          w.japanese,
          w.english,
          COALESCE(s.seen,    0) AS seen,
          COALESCE(s.correct, 0) AS correct,
          COALESCE(s.wrong,   0) AS wrong
        FROM words w
        LEFT JOIN word_stats s ON s.word_id = w.id
        WHERE w.chapter = ?
        ORDER BY
          CASE WHEN COALESCE(s.seen,0) = 0 THEN 1 ELSE 0 END,
          (CAST(COALESCE(s.correct,0) AS REAL) / COALESCE(s.seen,1)) ASC
      `,
      args: [req.params.chapter]
    })
    res.json(result.rows)
  } catch (e) { res.status(500).json({ error: e.message }) }
})


/* ── AI SENSEI — GENERATE SENTENCE ── */
app.post("/ai/generate", async (req, res) => {
  const { words } = req.body
  if (!words || !words.length) return res.status(400).json({ error: "No words provided" })

  const GROQ_KEY = process.env.GROQ_API_KEY || "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"

  // Pick 3-5 random words to use in sentence
  const picked = words.sort(() => Math.random() - 0.5).slice(0, Math.min(4, words.length))
  const wordList = picked.map(w => `${w.jp} (${w.en})`).join(", ")

  const prompt = `You are a Japanese language teacher for absolute beginners (JLPT N5) learning from Minna no Nihongo.
Generate one very simple Japanese sentence using some of these vocabulary words: ${wordList}

STRICT RULES — follow every rule exactly:
1. Write the sentence TWICE:
   - "sentence": Write using KANJI where natural (normal written Japanese)
   - "reading": Write the EXACT same sentence but replace every kanji with hiragana in brackets like this: 食べます(たべます) わたしは 学校(がっこう)に 行きます(いきます)
2. The reading field must show kanji followed immediately by its hiragana reading in parentheses for EVERY kanji character
3. Keep grammar simple — N5 level only (は、が、を、に、で、です、ます forms)
4. "hint": one short English grammar tip about the sentence structure

Reply ONLY in this exact JSON format with no extra text:
{"sentence": "sentence with kanji", "reading": "kanji(reading) mixed format", "hint": "grammar tip"}`

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + GROQ_KEY
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 200
      })
    })

    const data = await response.json()
    if (!response.ok) {
      console.error("Groq error:", data)
      return res.status(500).json({ error: "AI error: " + (data.error?.message || "unknown") })
    }

    const text = data.choices[0].message.content.trim()
    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return res.status(500).json({ error: "Could not parse AI response" })
    const parsed = JSON.parse(jsonMatch[0])
    res.json(parsed)

  } catch (e) {
    console.error("AI generate error:", e.message)
    res.status(500).json({ error: e.message })
  }
})

/* ── AI SENSEI — CHECK TRANSLATION ── */
app.post("/ai/check", async (req, res) => {
  const { sentence, userTranslation } = req.body
  if (!sentence || !userTranslation) return res.status(400).json({ error: "Missing fields" })

  const GROQ_KEY = process.env.GROQ_API_KEY || "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"

  const prompt = `You are a Japanese language teacher checking a student's translation.
Japanese sentence: "${sentence}"
Student's translation: "${userTranslation}"

Evaluate the translation and reply ONLY in this exact JSON format with no extra text:
{
  "score": <number 0-10>,
  "correct": <true or false>,
  "correct_translation": "the best English translation",
  "feedback": "short encouraging feedback in 1-2 sentences",
  "tip": "one short grammar or vocabulary tip about this sentence"
}`

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + GROQ_KEY
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 300
      })
    })

    const data = await response.json()
    if (!response.ok) {
      console.error("Groq error:", data)
      return res.status(500).json({ error: "AI error: " + (data.error?.message || "unknown") })
    }

    const text = data.choices[0].message.content.trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return res.status(500).json({ error: "Could not parse AI response" })
    const parsed = JSON.parse(jsonMatch[0])
    res.json(parsed)

  } catch (e) {
    console.error("AI check error:", e.message)
    res.status(500).json({ error: e.message })
  }
})

/* ── START ── */
const PORT = process.env.PORT || 3000
app.listen(PORT, async () => {
  await initDB()
  console.log(`✅ Server running → http://localhost:${PORT}`)
})
