const express = require("express");
const db = require("../db");

const router = express.Router();

// Bir markanın tüm görevlerini getirir (en yakın son tarihli önce).
router.get("/api/brands/:id/tasks", (req, res) => {
  const tasks = db
    .prepare(
      `SELECT * FROM tasks WHERE brand_id = ?
       ORDER BY completed ASC, (due_date IS NULL), due_date ASC, id ASC`
    )
    .all(req.params.id);
  res.json({ tasks });
});

router.post("/api/brands/:id/tasks", (req, res) => {
  const { title, due_date } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: "Görev başlığı boş olamaz." });
  }
  const brand = db.prepare("SELECT id FROM brands WHERE id = ?").get(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
  const result = db
    .prepare("INSERT INTO tasks (brand_id, title, due_date) VALUES (?, ?, ?)")
    .run(brand.id, String(title).trim(), due_date || null);
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(result.lastInsertRowid);
  res.json({ ok: true, task });
});

router.put("/api/tasks/:id", (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
  if (!task) return res.status(404).json({ error: "Görev bulunamadı." });
  const { title, due_date, completed } = req.body || {};
  const newTitle = title !== undefined ? String(title).trim() || task.title : task.title;
  const newDueDate = due_date !== undefined ? due_date : task.due_date;
  const newCompleted = completed !== undefined ? (completed ? 1 : 0) : task.completed;
  const completedAt = newCompleted && !task.completed ? new Date().toISOString() : newCompleted ? task.completed_at : null;
  db.prepare(
    "UPDATE tasks SET title = ?, due_date = ?, completed = ?, completed_at = ? WHERE id = ?"
  ).run(newTitle, newDueDate, newCompleted, completedAt, task.id);
  const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id);
  res.json({ ok: true, task: updated });
});

router.delete("/api/tasks/:id", (req, res) => {
  db.prepare("DELETE FROM tasks WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Panelin sağ üstünde/menüsünde bildirim rozeti göstermesi için: bugün ya da
// daha önce son tarihi gelmiş, henüz tamamlanmamış görevler + hangi markaya
// ait oldukları. "Bugün Yapılacaklar" panelinde de aynı uç nokta kullanılıyor.
router.get("/api/tasks/due", (req, res) => {
  const todayStr = new Date().toISOString().slice(0, 10);
  const rows = db
    .prepare(
      `SELECT tasks.*, brands.name as brand_name FROM tasks
       JOIN brands ON brands.id = tasks.brand_id
       WHERE tasks.completed = 0 AND tasks.due_date IS NOT NULL AND tasks.due_date <= ?
       ORDER BY tasks.due_date ASC`
    )
    .all(todayStr);
  res.json({ tasks: rows, count: rows.length });
});

module.exports = router;
