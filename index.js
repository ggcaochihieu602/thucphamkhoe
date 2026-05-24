const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const db = require("./db");
const jwt = require("jsonwebtoken");
const JWT_SECRET = "Hieu03032003@";
const { analyzeProductForGoal, analyzeCartForGoal, inferGoalFromProfile, inferFoodRole, isExtremeBalanceItem } = require("./aiLogic");
const path = require("path"); 
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const app = express();
const PORT = 3000;
const PRODUCT_AI_FIELDS = [
  "id",
  "name",
  "description",
  "price",
  "price_unit",
  "image_url",
  "category",
  "calories",
  "protein",
  "fat",
  "carbs",
  "sodium",
  "sugar",
  "saturated_fat",
  "fiber",
  "cholesterol",
  "food_role",
  "allergen_tags",
  "health_tags",
  "diet_flags",
  "expert_feedback"
].join(", ");
const PRODUCT_AI_FIELDS_P = PRODUCT_AI_FIELDS.split(", ").map((field) => `p.${field}`).join(", ");

 // middleware
 app.use(cors());
 app.use((req, res, next) => {
   res.charset = "utf-8";
   next();
 });
 app.use(express.json({ type: ["application/json", "text/plain"] })); 
 app.use("/img", express.static(path.join(__dirname, "img")));
 app.use(express.urlencoded({ extended: true }));

async function initDbSchema() {
  // bảng lưu đánh giá chuyên gia cho sản phẩm (tạo nếu chưa có)
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS expert_reviews (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT NOT NULL,
        expert_id INT NOT NULL,
        review_text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (err) {
    console.error("Init DB schema error:", err);
  }

  // thêm cột expert_feedback cho products nếu chưa có
  try {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS cnt
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'products'
         AND COLUMN_NAME = 'expert_feedback'`
    );
    const exists = rows && rows[0] && Number(rows[0].cnt) > 0;
    if (!exists) {
      await db.query("ALTER TABLE products ADD COLUMN expert_feedback TEXT NULL");
    }
  } catch (err) {
    console.error("Ensure products.expert_feedback error:", err);
  }

  // thêm cột khóa tài khoản nếu chưa có (để admin khóa/mở khóa)
  try {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS cnt
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'users'
         AND COLUMN_NAME = 'is_locked'`
    );
    const exists = rows && rows[0] && Number(rows[0].cnt) > 0;
    if (!exists) {
      await db.query("ALTER TABLE users ADD COLUMN is_locked TINYINT(1) NOT NULL DEFAULT 0");
    }
  } catch (err) {
    // nếu DB không cho đọc INFORMATION_SCHEMA hoặc alter thất bại, log nhưng không crash server
    console.error("Ensure users.is_locked error:", err);
  }

  // thêm các cột thông tin hồ sơ nếu chưa có: phone, address, avatar_url
  try {
    const ensureColumn = async (columnName, ddl) => {
      const [r] = await db.query(
        `SELECT COUNT(*) AS cnt
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'users'
           AND COLUMN_NAME = ?`,
        [columnName]
      );
      const exists = r && r[0] && Number(r[0].cnt) > 0;
      if (!exists) {
        await db.query(ddl);
      }
    };

    await ensureColumn("phone", "ALTER TABLE users ADD COLUMN phone VARCHAR(32) NULL");
    await ensureColumn("address", "ALTER TABLE users ADD COLUMN address VARCHAR(255) NULL");
    await ensureColumn("avatar_url", "ALTER TABLE users ADD COLUMN avatar_url VARCHAR(255) NULL");
    await ensureColumn("health_conditions", "ALTER TABLE users ADD COLUMN health_conditions TEXT NULL");
    await ensureColumn("diet_preferences", "ALTER TABLE users ADD COLUMN diet_preferences TEXT NULL");
  } catch (err) {
    console.error("Ensure profile columns error:", err);
  }

  // thêm các cột quản lý bài viết cho chuyên gia nếu chưa có
  try {
    const ensureArticleColumn = async (columnName, ddl) => {
      const [r] = await db.query(
        `SELECT COUNT(*) AS cnt
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'articles'
           AND COLUMN_NAME = ?`,
        [columnName]
      );
      const exists = r && r[0] && Number(r[0].cnt) > 0;
      if (!exists) {
        await db.query(ddl);
      }
    };

    await ensureArticleColumn(
      "status",
      "ALTER TABLE articles ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'draft'"
    );
    await ensureArticleColumn(
      "category",
      "ALTER TABLE articles ADD COLUMN category VARCHAR(120) NULL"
    );
    await ensureArticleColumn(
      "tags",
      "ALTER TABLE articles ADD COLUMN tags TEXT NULL"
    );

    const [articleRowsNeedingTopic] = await db.query(
      "SELECT id, title, content, category FROM articles WHERE category IS NULL OR TRIM(category) = ''"
    );
    for (const article of articleRowsNeedingTopic || []) {
      const inferredTopic = inferArticleTopic(article.title, article.content);
      await db.query("UPDATE articles SET category = ? WHERE id = ?", [inferredTopic, article.id]);
    }
  } catch (err) {
    console.error("Ensure article management columns error:", err);
  }

  // bảng báo cáo đơn hàng (khi user report vấn đề)
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS order_reports (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        user_id INT NOT NULL,
        issue_type VARCHAR(120) NOT NULL,
        description TEXT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_order_reports_order_id (order_id),
        INDEX idx_order_reports_user_id (user_id),
        INDEX idx_order_reports_status (status)
      )
    `);
  } catch (err) {
    console.error("Init order_reports error:", err);
  }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS expert_conversations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        expert_id INT NULL,
        topic VARCHAR(120) NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        attached_product_id INT NULL,
        attached_product_snapshot LONGTEXT NULL,
        cart_snapshot LONGTEXT NULL,
        profile_snapshot LONGTEXT NULL,
        latest_message_text TEXT NULL,
        latest_message_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_expert_conversations_user_id (user_id),
        INDEX idx_expert_conversations_expert_id (expert_id),
        INDEX idx_expert_conversations_status (status),
        INDEX idx_expert_conversations_latest_message_at (latest_message_at)
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS expert_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        conversation_id INT NOT NULL,
        sender_type VARCHAR(16) NOT NULL,
        sender_id INT NOT NULL,
        message TEXT NOT NULL,
        quick_flags TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_expert_messages_conversation_id (conversation_id),
        INDEX idx_expert_messages_sender (sender_type, sender_id)
      )
    `);
  } catch (err) {
    console.error("Init expert consultations schema error:", err);
  }
}

const ARTICLE_STATUSES = ["draft", "in_review", "published", "archived"];
const ARTICLE_TOPIC_OPTIONS = [
  "Dinh dưỡng lành mạnh",
  "Giảm cân",
  "Tăng cân",
  "Bệnh lý dinh dưỡng",
  "Mẹ và bé",
  "Mẹo chọn thực phẩm",
  "Thực đơn gợi ý"
];

function normalizeArticleStatus(value) {
  const status = String(value || "draft").trim().toLowerCase();
  return ARTICLE_STATUSES.includes(status) ? status : "draft";
}

function normalizeArticleCategory(value) {
  const category = String(value || "").trim();
  if (!category) return "Dinh dưỡng lành mạnh";
  const matched = ARTICLE_TOPIC_OPTIONS.find((item) => item.toLowerCase() === category.toLowerCase());
  return (matched || category).slice(0, 120);
}

function inferArticleTopic(title, content) {
  const source = `${String(title || "")} ${String(content || "")}`.toLowerCase();
  if (/(giảm cân|giam can|siết cân|siết mỡ|giam mo)/.test(source)) return "Giảm cân";
  if (/(tăng cân|tang can|tăng cơ|tang co|phục hồi|phuc hoi)/.test(source)) return "Tăng cân";
  if (/(tiểu đường|tieu duong|cao huyết áp|cao huyet ap|tim mạch|tim mach|gan|thận|than)/.test(source)) return "Bệnh lý dinh dưỡng";
  if (/(mẹ và bé|me va be|thai kỳ|thai ky|ăn dặm|an dam|trẻ em|tre em)/.test(source)) return "Mẹ và bé";
  if (/(thực đơn|thuc don|gợi ý bữa ăn|goi y bua an|món ăn trong ngày|mon an trong ngay)/.test(source)) return "Thực đơn gợi ý";
  if (/(mẹo|cách chọn|cach chon|ngoài chợ|an toàn|bao quản|bao quan|thực phẩm sạch|thuc pham sach)/.test(source)) return "Mẹo chọn thực phẩm";
  return "Dinh dưỡng lành mạnh";
}

function normalizeArticleTags(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 20)
      .join(", ");
  }

  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20)
    .join(", ");
}

// upload ảnh sản phẩm (jpg/png) vào img/products
const PRODUCTS_UPLOAD_DIR = path.join(__dirname, "img", "products");
try {
  fs.mkdirSync(PRODUCTS_UPLOAD_DIR, { recursive: true });
} catch (_) {}

const uploadProductImage = multer({
  storage: multer.diskStorage({
    destination: function (_req, _file, cb) {
      cb(null, PRODUCTS_UPLOAD_DIR);
    },
    filename: function (_req, file, cb) {
      const ext = path.extname(file.originalname || "").toLowerCase();
      const safeExt = ext === ".jpg" || ext === ".jpeg" || ext === ".png" ? ext : ".jpg";
      const name = Date.now() + "-" + crypto.randomBytes(6).toString("hex") + safeExt;
      cb(null, name);
    }
  }),
  fileFilter: function (_req, file, cb) {
    const ok =
      file.mimetype === "image/jpeg" ||
      file.mimetype === "image/png" ||
      file.mimetype === "image/jpg";
    cb(ok ? null : new Error("Chỉ hỗ trợ ảnh JPG/PNG"), ok);
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

function parsePeriodRange(mode, period) {
  const m = String(mode || "").toLowerCase();
  const p = String(period || "").trim();

  if (m === "day") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p)) return null;
    const start = new Date(p + "T00:00:00");
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end, mode: "day", label: p };
  }

  if (m === "month") {
    if (!/^\d{4}-\d{2}$/.test(p)) return null;
    const start = new Date(p + "-01T00:00:00");
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    return { start, end, mode: "month", label: p };
  }

  return null;
}

function parseStringArrayField(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
  }

  if (typeof value !== "string") {
    return [];
  }

  const raw = value.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.map((item) => String(item || "").trim()).filter(Boolean))];
    }
  } catch (_) {}

  return [...new Set(raw.split(",").map((item) => item.trim()).filter(Boolean))];
}

function stringifyStringArray(value) {
  return JSON.stringify(parseStringArrayField(value));
}

function parseJsonText(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function summarizeConversationMessage(message) {
  const text = String(message || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text.length > 180 ? text.slice(0, 177).trim() + "..." : text;
}

const CONSULTATION_MESSAGE_MIN = 10;
const CONSULTATION_MESSAGE_MAX = 1000;

function validateConsultationText(value, label) {
  const text = String(value || "").trim();
  if (!text) {
    return { ok: false, text, message: `${label} không hợp lệ. Vui lòng nhập nội dung trước khi gửi.` };
  }
  if (text.length < CONSULTATION_MESSAGE_MIN) {
    return {
      ok: false,
      text,
      message: `${label} không hợp lệ vì quá ngắn. Vui lòng nhập ít nhất ${CONSULTATION_MESSAGE_MIN} ký tự.`
    };
  }
  if (text.length > CONSULTATION_MESSAGE_MAX) {
    return {
      ok: false,
      text,
      message: `${label} không hợp lệ vì quá dài. Vui lòng nhập tối đa ${CONSULTATION_MESSAGE_MAX} ký tự.`
    };
  }
  return { ok: true, text, message: "" };
}

function pctChange(current, previous) {
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p)) return null;
  if (p === 0) return c === 0 ? 0 : null;
  return ((c - p) / p) * 100;
}

app.get("/admin/analytics/report", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const mode = String(req.query.mode || "day").toLowerCase();
    const period = String(req.query.period || "").trim();
    const compare = String(req.query.compare || "").trim();

    const now = new Date();
    const defaultDay = now.toISOString().slice(0, 10);
    const defaultMonth = now.toISOString().slice(0, 7);

    const currentRange = parsePeriodRange(mode, period || (mode === "month" ? defaultMonth : defaultDay));
    if (!currentRange) {
      return res.status(400).json({ ok: false, message: "Tham số mode/period không hợp lệ" });
    }

    const compareRange = compare ? parsePeriodRange(mode, compare) : null;
    if (compare && !compareRange) {
      return res.status(400).json({ ok: false, message: "Tham số compare không hợp lệ" });
    }

    const invalidStatuses = ["cancelled", "canceled", "cancelled_by_admin"];

    const getMetrics = async (start, end) => {
      const [orderAgg] = await db.query(
        `SELECT
            COUNT(*) AS total_orders,
            COALESCE(SUM(o.total_price), 0) AS total_revenue,
            COUNT(DISTINCT o.user_id) AS total_customers
         FROM orders o
         WHERE o.created_at >= ? AND o.created_at < ?
           AND (o.status IS NULL OR LOWER(o.status) NOT IN (?))`,
        [start, end, invalidStatuses]
      );

      const [salesAgg] = await db.query(
        `SELECT
            COALESCE(SUM(oi.quantity), 0) AS total_sales
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         WHERE o.created_at >= ? AND o.created_at < ?
           AND (o.status IS NULL OR LOWER(o.status) NOT IN (?))`,
        [start, end, invalidStatuses]
      );

      const metrics = {
        total_sales: Number((salesAgg && salesAgg[0] && salesAgg[0].total_sales) || 0),
        total_orders: Number((orderAgg && orderAgg[0] && orderAgg[0].total_orders) || 0),
        total_revenue: Number((orderAgg && orderAgg[0] && orderAgg[0].total_revenue) || 0),
        total_customers: Number((orderAgg && orderAgg[0] && orderAgg[0].total_customers) || 0)
      };
      return metrics;
    };

    const getTopProducts = async (start, end, limit) => {
      const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(50, Number(limit))) : 8;
      const [rows] = await db.query(
        `SELECT
            p.id AS product_id,
            p.name,
            p.image_url,
            COALESCE(SUM(oi.quantity), 0) AS quantity,
            COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS amount
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         JOIN products p ON p.id = oi.product_id
         WHERE o.created_at >= ? AND o.created_at < ?
           AND (o.status IS NULL OR LOWER(o.status) NOT IN (?))
         GROUP BY p.id, p.name, p.image_url
         ORDER BY quantity DESC, amount DESC
         LIMIT ${safeLimit}`,
        [start, end, invalidStatuses]
      );
      return rows || [];
    };

    const currentMetrics = await getMetrics(currentRange.start, currentRange.end);
    const compareMetrics = compareRange ? await getMetrics(compareRange.start, compareRange.end) : null;
    const topProducts = await getTopProducts(currentRange.start, currentRange.end, req.query.top);

    const deltas = compareMetrics
      ? {
          total_sales: pctChange(currentMetrics.total_sales, compareMetrics.total_sales),
          total_orders: pctChange(currentMetrics.total_orders, compareMetrics.total_orders),
          total_revenue: pctChange(currentMetrics.total_revenue, compareMetrics.total_revenue),
          total_customers: pctChange(currentMetrics.total_customers, compareMetrics.total_customers)
        }
      : null;

    res.type("application/json; charset=utf-8").json({
      ok: true,
      mode: currentRange.mode,
      current: { period: currentRange.label, ...currentMetrics },
      compare: compareRange ? { period: compareRange.label, ...compareMetrics } : null,
      deltas,
      top_products: topProducts
    });
  } catch (error) {
    console.error("Admin analytics report error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lấy báo cáo" });
  }
});

// upload avatar user (jpg/png) vào img/avatars
const AVATAR_UPLOAD_DIR = path.join(__dirname, "img", "avatars");
try {
  fs.mkdirSync(AVATAR_UPLOAD_DIR, { recursive: true });
} catch (_) {}

const uploadAvatar = multer({
  storage: multer.diskStorage({
    destination: function (_req, _file, cb) {
      cb(null, AVATAR_UPLOAD_DIR);
    },
    filename: function (_req, file, cb) {
      const ext = path.extname(file.originalname || "").toLowerCase();
      const safeExt = ext === ".jpg" || ext === ".jpeg" || ext === ".png" ? ext : ".jpg";
      const name = Date.now() + "-" + crypto.randomBytes(6).toString("hex") + safeExt;
      cb(null, name);
    }
  }),
  fileFilter: function (_req, file, cb) {
    const ok =
      file.mimetype === "image/jpeg" ||
      file.mimetype === "image/png" ||
      file.mimetype === "image/jpg";
    cb(ok ? null : new Error("Chỉ hỗ trợ ảnh JPG/PNG"), ok);
  },
  limits: { fileSize: 3 * 1024 * 1024 } // 3MB
});

// upload ảnh bài viết (jpg/png) vào img/articles
const ARTICLES_UPLOAD_DIR = path.join(__dirname, "img", "articles");
try {
  fs.mkdirSync(ARTICLES_UPLOAD_DIR, { recursive: true });
} catch (_) {}

const uploadArticleImage = multer({
  storage: multer.diskStorage({
    destination: function (_req, _file, cb) {
      cb(null, ARTICLES_UPLOAD_DIR);
    },
    filename: function (_req, file, cb) {
      const ext = path.extname(file.originalname || "").toLowerCase();
      const safeExt = ext === ".jpg" || ext === ".jpeg" || ext === ".png" ? ext : ".jpg";
      const name = Date.now() + "-" + crypto.randomBytes(6).toString("hex") + safeExt;
      cb(null, name);
    }
  }),
  fileFilter: function (_req, file, cb) {
    const ok =
      file.mimetype === "image/jpeg" ||
      file.mimetype === "image/png" ||
      file.mimetype === "image/jpg";
    cb(ok ? null : new Error("Chỉ hỗ trợ ảnh JPG/PNG"), ok);
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

app.get("/", (req, res) => {
  res.send("Hello from API");
});

app.get("/test-db", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT 1 AS result");
    res.json({ ok: true, db: rows[0].result });
  } catch (error) {
    console.error("DB error:", error);
    res.status(500).json({ ok: false, error: "Cannot connect to database" });
  }
});

app.post("/track", async (req, res) => {
  try {
    let payload = req.body;
    if (typeof payload === "string") {
      payload = payload.trim() ? JSON.parse(payload) : {};
    }

    const eventName = String(payload?.event_name || "").trim().slice(0, 64) || "unknown";

    const eventTimeRaw = payload?.event_time;
    const eventTime = eventTimeRaw ? new Date(eventTimeRaw) : new Date();
    const eventTimeOk = !isNaN(eventTime.getTime());

    const userIdRaw = payload?.user_id;
    const userIdNum = userIdRaw === null || userIdRaw === undefined || userIdRaw === "" ? null : Number(userIdRaw);
    const userId = Number.isFinite(userIdNum) ? userIdNum : null;

    const anonymousId = payload?.anonymous_id ? String(payload.anonymous_id).slice(0, 64) : null;
    const sessionId = payload?.session_id ? String(payload.session_id).slice(0, 64) : null;
    const pageUrl = payload?.page_url ? String(payload.page_url).slice(0, 512) : null;
    const referrer = payload?.referrer ? String(payload.referrer).slice(0, 512) : null;

    let ip = null;
    const xff = req.headers["x-forwarded-for"];
    if (xff && typeof xff === "string") {
      ip = xff.split(",")[0].trim().slice(0, 45);
    } else if (req.ip) {
      ip = String(req.ip).slice(0, 45);
    }

    const userAgent = req.get("user-agent") ? String(req.get("user-agent")).slice(0, 512) : null;

    let properties = payload?.properties;
    if (properties && typeof properties !== "object") {
      properties = { value: properties };
    }
    let propertiesJson = null;
    try {
      if (properties && typeof properties === "object") {
        const s = JSON.stringify(properties);
        propertiesJson = s.length > 65000 ? JSON.stringify({ truncated: true }) : s;
      }
    } catch (_) {
      propertiesJson = JSON.stringify({ invalid_properties: true });
    }

    await db.query(
      `INSERT INTO user_behavior_events
        (event_time, user_id, anonymous_id, session_id, event_name, page_url, referrer, ip, user_agent, properties)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        eventTimeOk ? eventTime : new Date(),
        userId,
        anonymousId,
        sessionId,
        eventName,
        pageUrl,
        referrer,
        ip,
        userAgent,
        propertiesJson
      ]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error("Track event error:", error);
    res.status(400).json({ ok: false, message: "Invalid tracking payload" });
  }
});

app.post("/auth/register", async (req, res) => {
  try {
    console.log("Request body:", req.body);

    const { name, email, password } = req.body || {};

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ ok: false, message: "Thiếu name, email hoặc password" });
    }

    const [existing] = await db.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (existing.length > 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Email đã tồn tại" });
    }

    const [roleRows] = await db.query(
      "SELECT id FROM roles WHERE name = ? LIMIT 1",
      ["customer"]
    );

    if (roleRows.length === 0) {
      return res
        .status(500)
        .json({ ok: false, message: "Không tìm thấy role customer" });
    }

    const roleId = roleRows[0].id;
    const passwordHash = await bcrypt.hash(password, 10);

    await db.query(
      "INSERT INTO users (name, email, password_hash, role_id) VALUES (?, ?, ?, ?)",
      [name, email, passwordHash, roleId]
    );

    res.json({ ok: true, message: "Đăng ký thành công" });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi đăng ký" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res
        .status(400)
        .json({ ok: false, message: "Thiếu email hoặc password" });
    }

    const [rows] = await db.query(
      "SELECT users.id, users.name, users.email, users.phone, users.address, users.avatar_url, users.password_hash, roles.name AS role_name, IFNULL(users.is_locked, 0) AS is_locked FROM users JOIN roles ON users.role_id = roles.id WHERE users.email = ? LIMIT 1",
      [email]
    );

    if (rows.length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Email hoặc mật khẩu không đúng" });
    }

    const user = rows[0];

    if (Number(user.is_locked) === 1) {
      return res.status(403).json({ ok: false, message: "Tài khoản đã bị khóa" });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res
        .status(400)
        .json({ ok: false, message: "Email hoặc mật khẩu không đúng" });
    }

    const token = jwt.sign(
      {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role_name
      },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      ok: true,
      message: "Đăng nhập thành công",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role_name,
        phone: user.phone || "",
        address: user.address || "",
        avatar: user.avatar_url || ""
      }
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi đăng nhập" });
  }
});

// Admin: danh sách role
app.get("/admin/roles", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id, name FROM roles ORDER BY id ASC");
    res.json({ ok: true, roles: rows });
  } catch (error) {
    console.error("Admin get roles error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lấy roles" });
  }
});

// Admin: danh sách người dùng
app.get("/admin/users", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.name, u.email, IFNULL(u.is_locked, 0) AS is_locked,
              r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       ORDER BY u.id DESC`
    );
    res.json({ ok: true, users: rows });
  } catch (error) {
    console.error("Admin get users error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lấy danh sách người dùng" });
  }
});

// Admin: cập nhật user (sửa tên/email/role)
app.put("/admin/users/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const userId = req.params.id;
    const { name, role } = req.body || {};

    // Email là định danh đăng nhập => không cho đổi ở admin
    if (!name || !role) {
      return res.status(400).json({ ok: false, message: "Thiếu name hoặc role" });
    }

    const [uRows] = await db.query("SELECT id FROM users WHERE id = ? LIMIT 1", [userId]);
    if (uRows.length === 0) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy người dùng" });
    }

    const [roleRows] = await db.query("SELECT id FROM roles WHERE name = ? LIMIT 1", [role]);
    if (roleRows.length === 0) {
      return res.status(400).json({ ok: false, message: "Role không hợp lệ" });
    }

    await db.query(
      "UPDATE users SET name = ?, role_id = ? WHERE id = ?",
      [name, roleRows[0].id, userId]
    );

    res.json({ ok: true, message: "Cập nhật người dùng thành công" });
  } catch (error) {
    console.error("Admin update user error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi cập nhật người dùng" });
  }
});

// Admin: khóa/mở khóa user
app.put("/admin/users/:id/lock", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const targetId = req.params.id;
    const { locked } = req.body || {};

    if (String(targetId) === String(req.user.id)) {
      return res.status(400).json({ ok: false, message: "Không thể khóa chính tài khoản admin đang đăng nhập" });
    }

    const [rows] = await db.query("SELECT id, IFNULL(is_locked,0) AS is_locked FROM users WHERE id = ? LIMIT 1", [
      targetId
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy người dùng" });
    }

    const current = Number(rows[0].is_locked) === 1;
    const next = typeof locked === "boolean" ? locked : !current;
    await db.query("UPDATE users SET is_locked = ? WHERE id = ?", [next ? 1 : 0, targetId]);

    res.json({ ok: true, message: next ? "Đã khóa tài khoản" : "Đã mở khóa tài khoản", is_locked: next ? 1 : 0 });
  } catch (error) {
    console.error("Admin lock user error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi khóa người dùng" });
  }
});

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res
      .status(401)
      .json({ ok: false, message: "Thiếu header Authorization" });
  }

  const parts = authHeader.split(" ");

  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return res
      .status(401)
      .json({ ok: false, message: "Header Authorization không hợp lệ" });
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ ok: false, message: "Token không hợp lệ" });
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res
      .status(403)
      .json({ ok: false, message: "Chỉ admin mới được dùng chức năng này" });
  }
  next();
}

function expertMiddleware(req, res, next) {
  if (!req.user || req.user.role !== "expert") {
    return res
      .status(403)
      .json({ ok: false, message: "Chỉ chuyên gia mới được dùng chức năng này" });
  }
  next();
}

function getOptionalAuthUser(req) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return null;

    const parts = String(authHeader).split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") return null;

    return jwt.verify(parts[1], JWT_SECRET);
  } catch (_) {
    return null;
  }
}

async function buildAiUserProfile(userId, productId) {
  if (!userId) return {};

  const [rows] = await db.query(
    `SELECT id, age, gender, height, weight, activity_level, health_conditions, diet_preferences
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [userId]
  );

  if (!rows.length) return {};

  const profile = rows[0] || {};
  profile.health_conditions = parseStringArrayField(profile.health_conditions);
  profile.diet_preferences = parseStringArrayField(profile.diet_preferences);

  if (productId) {
    const [feedbackRows] = await db.query(
      `SELECT rating, comment, created_at
       FROM user_product_feedback
       WHERE user_id = ? AND product_id = ?
       LIMIT 1`,
      [userId, productId]
    );

    if (feedbackRows.length) {
      profile.feedback_map = {
        [String(productId)]: feedbackRows[0]
      };
    }
  }

  return profile;
}

async function buildConsultationUserSnapshot(userId) {
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.email, u.phone, u.address, u.avatar_url,
            u.age, u.gender, u.height, u.weight, u.activity_level,
            u.health_conditions, u.diet_preferences,
            r.name AS role_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id = ?
     LIMIT 1`,
    [userId]
  );

  if (!rows.length) return null;
  const user = rows[0];
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone || "",
    address: user.address || "",
    avatar_url: user.avatar_url || "",
    role_name: user.role_name || "customer",
    age: user.age,
    gender: user.gender,
    height: user.height,
    weight: user.weight,
    activity_level: user.activity_level || "",
    health_conditions: parseStringArrayField(user.health_conditions),
    diet_preferences: parseStringArrayField(user.diet_preferences)
  };
}

async function buildConsultationProductSnapshot(productId) {
  if (!productId) return null;
  const [rows] = await db.query(
    `SELECT ${PRODUCT_AI_FIELDS} FROM products WHERE id = ? LIMIT 1`,
    [productId]
  );
  if (!rows.length) return null;
  const product = rows[0];
  return {
    ...product,
    allergen_tags: parseStringArrayField(product.allergen_tags),
    health_tags: parseStringArrayField(product.health_tags),
    diet_flags: parseStringArrayField(product.diet_flags)
  };
}

async function buildConsultationCartSnapshot(cartItems) {
  if (!Array.isArray(cartItems) || !cartItems.length) return null;

  const normalizedItems = cartItems
    .map((item) => ({
      productId: Number(item.productId || item.product_id || item.id),
      quantity: Number(item.quantity || 1)
    }))
    .filter((item) => Number.isFinite(item.productId) && item.productId > 0);

  if (!normalizedItems.length) return null;

  const ids = [...new Set(normalizedItems.map((item) => item.productId))];
  const [productRows] = await db.query(
    `SELECT id, name, image_url, category, price, price_unit
     FROM products
     WHERE id IN (?)`,
    [ids]
  );

  const productMap = new Map((productRows || []).map((product) => [Number(product.id), product]));

  return normalizedItems.map((item) => {
    const product = productMap.get(item.productId) || {};
    return {
      productId: item.productId,
      id: item.productId,
      name: product.name || "Sản phẩm",
      image_url: product.image_url || "",
      category: product.category || "Khác",
      price: Number(product.price || 0),
      price_unit: product.price_unit || "VND/kg",
      quantity: Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1
    };
  });
}

async function enrichConversationSnapshots(conversation) {
  if (!conversation || typeof conversation !== "object") return conversation;

  const productIds = new Set();
  const attachedProductId = Number(
    conversation.attached_product_id ||
    (conversation.attached_product_snapshot && (conversation.attached_product_snapshot.productId || conversation.attached_product_snapshot.product_id || conversation.attached_product_snapshot.id))
  );

  if (Number.isFinite(attachedProductId) && attachedProductId > 0) {
    productIds.add(attachedProductId);
  }

  const cartItems = Array.isArray(conversation.cart_snapshot) ? conversation.cart_snapshot : [];
  for (const item of cartItems) {
    const productId = Number(item && (item.productId || item.product_id || item.id));
    if (Number.isFinite(productId) && productId > 0) {
      productIds.add(productId);
    }
  }

  if (!productIds.size) return conversation;

  const [productRows] = await db.query(
    `SELECT id, name, image_url, category, price, price_unit
     FROM products
     WHERE id IN (?)`,
    [[...productIds]]
  );

  const productMap = new Map((productRows || []).map((product) => [Number(product.id), product]));

  if (conversation.attached_product_snapshot && typeof conversation.attached_product_snapshot === "object") {
    const productId = Number(
      conversation.attached_product_snapshot.productId ||
      conversation.attached_product_snapshot.product_id ||
      conversation.attached_product_snapshot.id ||
      conversation.attached_product_id
    );
    const product = productMap.get(productId);
    if (product) {
      conversation.attached_product_snapshot = {
        ...conversation.attached_product_snapshot,
        id: conversation.attached_product_snapshot.id || product.id,
        productId: conversation.attached_product_snapshot.productId || product.id,
        name: conversation.attached_product_snapshot.name || product.name || "Sản phẩm",
        image_url: conversation.attached_product_snapshot.image_url || product.image_url || "",
        category: conversation.attached_product_snapshot.category || product.category || "Khác",
        price: conversation.attached_product_snapshot.price ?? product.price ?? 0,
        price_unit: conversation.attached_product_snapshot.price_unit || product.price_unit || "VND/kg"
      };
    }
  }

  if (cartItems.length) {
    conversation.cart_snapshot = cartItems.map((item) => {
      const productId = Number(item && (item.productId || item.product_id || item.id));
      const product = productMap.get(productId);
      if (!product) return item;
      return {
        ...item,
        id: item.id || product.id,
        productId: item.productId || item.product_id || product.id,
        name: item.name || product.name || "Sản phẩm",
        image_url: item.image_url || product.image_url || "",
        category: item.category || product.category || "Khác",
        price: item.price ?? product.price ?? 0,
        price_unit: item.price_unit || product.price_unit || "VND/kg"
      };
    });
  }

  return conversation;
}

function normalizeConsultationTopic(value) {
  const topic = String(value || "").trim();
  return topic || null;
}

function mapConversationRow(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    expert_id: row.expert_id,
    topic: row.topic || "",
    status: row.status || "pending",
    latest_message_text: row.latest_message_text || "",
    latest_message_at: row.latest_message_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    attached_product_id: row.attached_product_id || null,
    attached_product_snapshot: parseJsonText(row.attached_product_snapshot, null),
    cart_snapshot: parseJsonText(row.cart_snapshot, null),
    profile_snapshot: parseJsonText(row.profile_snapshot, null)
  };
}

function mapConsultationMessage(row) {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    sender_type: row.sender_type,
    sender_id: row.sender_id,
    sender_name: row.sender_name || "",
    message: row.message || "",
    quick_flags: parseStringArrayField(row.quick_flags),
    created_at: row.created_at
  };
}

function buildRecommendationReason(goal, analysis, cartAnalysis, product, isNewCategory) {
  const findings = Array.isArray(cartAnalysis && cartAnalysis.findings) ? cartAnalysis.findings : [];
  const warningCodes = new Set(findings.filter((item) => item.type === "warning").map((item) => item.code));
  const ratioComparison = cartAnalysis && cartAnalysis.ratioComparison;

  // Gợi ý dựa trên tỉ lệ dinh dưỡng
  if (ratioComparison) {
    // Thiếu protein - đề xuất sản phẩm giàu protein
    if (ratioComparison.proteinStatus === "low" && Number(product.protein || 0) >= 12) {
      const proteinReasons = [
        "Sản phẩm này giàu protein, giúp bù đắp sự thiếu hụt trong giỏ hàng.",
        "Đây là lựa chọn giàu đạm để cân bằng lại tỉ lệ dinh dưỡng.",
        "Món này giúp bổ sung lượng protein còn thiếu trong giỏ hàng."
      ];
      return proteinReasons[Math.floor(Math.random() * proteinReasons.length)];
    }

    // Protein cao - đề xuất sản phẩm ít protein
    if (ratioComparison.proteinStatus === "high" && Number(product.protein || 0) <= 8) {
      const proteinLowReasons = [
        "Sản phẩm này ít protein, giúp cân bằng lại giỏ hàng đang thừa đạm.",
        "Lựa chọn ít đạm này phù hợp để cân bằng lại tỉ lệ dinh dưỡng."
      ];
      return proteinLowReasons[Math.floor(Math.random() * proteinLowReasons.length)];
    }

    // Thiếu carbs - đề xuất sản phẩm giàu carbs
    if (ratioComparison.carbsStatus === "low" && Number(product.carbs || 0) >= 20) {
      const carbReasons = [
        "Sản phẩm này giàu tinh bột, giúp bù đắp sự thiếu hụt năng lượng.",
        "Lựa chọn nhiều carb này phù hợp để cân bằng lại giỏ hàng."
      ];
      return carbReasons[Math.floor(Math.random() * carbReasons.length)];
    }

    // Carbs cao - đề xuất sản phẩm ít carbs
    if (ratioComparison.carbsStatus === "high" && Number(product.carbs || 0) <= 15) {
      const carbLowReasons = [
        "Sản phẩm này ít tinh bột, giúp cân bằng lại giỏ hàng đang thừa carb.",
        "Lựa chọn ít carb này phù hợp để điều chỉnh tỉ lệ dinh dưỡng."
      ];
      return carbLowReasons[Math.floor(Math.random() * carbLowReasons.length)];
    }

    // Thiếu fat - đề xuất sản phẩm giàu fat
    if (ratioComparison.fatStatus === "low" && Number(product.fat || 0) >= 8) {
      const fatReasons = [
        "Sản phẩm này giàu chất béo tốt, giúp bù đắp sự thiếu hụt trong giỏ hàng.",
        "Lựa chọn nhiều chất béo này phù hợp để cân bằng lại tỉ lệ dinh dưỡng."
      ];
      return fatReasons[Math.floor(Math.random() * fatReasons.length)];
    }

    // Fat cao - đề xuất sản phẩm ít fat
    if (ratioComparison.fatStatus === "high" && Number(product.fat || 0) <= 3) {
      const fatLowReasons = [
        "Sản phẩm này ít chất béo, giúp cân bằng lại giỏ hàng đang thừa chất béo.",
        "Lựa chọn ít dầu mỡ này phù hợp để điều chỉnh tỉ lệ dinh dưỡng."
      ];
      return fatLowReasons[Math.floor(Math.random() * fatLowReasons.length)];
    }
  }

  // Gợi ý dựa trên findings cũ
  if (warningCodes.has("cart_low_protein") && Number(product.protein || 0) >= 12) {
    const proteinReasons = [
      "Sản phẩm này bổ sung protein khá tốt cho giỏ hàng hiện tại.",
      "Món này giàu đạm, giúp cân bằng lại giỏ hàng của bạn."
    ];
    return proteinReasons[Math.floor(Math.random() * proteinReasons.length)];
  }

  if (warningCodes.has("cart_high_carbs") && Number(product.carbs || 0) <= 20 && Number(product.protein || 0) >= 8) {
    const carbReasons = [
      "Món này giúp cân bằng lại giỏ hàng khi bạn đang có xu hướng nhiều carb.",
      "Lựa chọn ít tinh bột này phù hợp với mục tiêu của bạn."
    ];
    return carbReasons[Math.floor(Math.random() * carbReasons.length)];
  }

  if (warningCodes.has("cart_high_calories") && Number(product.calories || 0) > 0 && Number(product.calories || 0) <= 180) {
    const calorieReasons = [
      "Món này có năng lượng gọn hơn, dễ chèn vào giỏ mà không làm tăng quá nhiều calories.",
      "Lựa chọn ít calo này phù hợp để giữ cân bằng năng lượng."
    ];
    return calorieReasons[Math.floor(Math.random() * calorieReasons.length)];
  }

  if (warningCodes.has("cart_low_variety") && isNewCategory) {
    const varietyReasons = [
      "Món này thêm sự đa dạng nhóm thực phẩm cho giỏ hàng của bạn.",
      "Sản phẩm này giúp đa dạng hóa giỏ hàng của bạn."
    ];
    return varietyReasons[Math.floor(Math.random() * varietyReasons.length)];
  }

  // Gợi ý dựa trên mục tiêu
  if (goal === "weight_gain" && Number(product.protein || 0) >= 15) {
    const muscleReasons = [
      "Món này hợp mục tiêu tăng cân nhờ lượng đạm khá ổn.",
      "Sản phẩm này giúp tăng năng lượng nhưng vẫn giữ nền protein khá tốt."
    ];
    return muscleReasons[Math.floor(Math.random() * muscleReasons.length)];
  }

  if (goal === "weight_loss" && Number(product.calories || 0) <= 150 && Number(product.protein || 0) >= 8) {
    const weightLossReasons = [
      "Món này ít calo và nhiều chất xơ, phù hợp với chế độ giảm cân.",
      "Lựa chọn này giúp bạn no lâu hơn với ít calo hơn."
    ];
    return weightLossReasons[Math.floor(Math.random() * weightLossReasons.length)];
  }

  if (goal === "balanced" && Number(product.protein || 0) >= 10 && Number(product.fat || 0) <= 12) {
    const balancedReasons = [
      "Món này có dinh dưỡng cân đối, phù hợp với chế độ ăn lành mạnh.",
      "Sản phẩm này cung cấp đủ các nhóm chất cần thiết."
    ];
    return balancedReasons[Math.floor(Math.random() * balancedReasons.length)];
  }

  return analysis.summary || "Món này có điểm phù hợp khá tốt với mục tiêu hiện tại.";
}

function scoreRecommendationBoost(cartAnalysis, product, isNewCategory, goal = "balanced") {
  const findings = Array.isArray(cartAnalysis && cartAnalysis.findings) ? cartAnalysis.findings : [];
  const warningCodes = new Set(findings.filter((item) => item.type === "warning").map((item) => item.code));
  const ratioComparison = cartAnalysis && cartAnalysis.ratioComparison;
  let boost = 0;

  // Boost dựa trên tỉ lệ dinh dưỡng
  if (ratioComparison) {
    // Thiếu protein + sản phẩm giàu protein
    if (ratioComparison.proteinStatus === "low" && Number(product.protein || 0) >= 12) boost += 15;
    // Protein cao + sản phẩm ít protein
    if (ratioComparison.proteinStatus === "high" && Number(product.protein || 0) <= 8) boost += 10;
    
    // Thiếu carbs + sản phẩm giàu carbs
    if (ratioComparison.carbsStatus === "low" && Number(product.carbs || 0) >= 20) boost += 12;
    // Carbs cao + sản phẩm ít carbs
    if (ratioComparison.carbsStatus === "high" && Number(product.carbs || 0) <= 15) boost += 10;
    
    // Thiếu fat + sản phẩm giàu fat
    if (ratioComparison.fatStatus === "low" && Number(product.fat || 0) >= 8) boost += 10;
    // Fat cao + sản phẩm ít fat
    if (ratioComparison.fatStatus === "high" && Number(product.fat || 0) <= 3) boost += 8;
  }

  // Boost dựa trên findings cũ
  if (warningCodes.has("cart_low_protein") && Number(product.protein || 0) >= 12) boost += 12;
  if (warningCodes.has("cart_high_carbs") && Number(product.carbs || 0) <= 20) boost += 8;
  if (warningCodes.has("cart_high_calories") && Number(product.calories || 0) > 0 && Number(product.calories || 0) <= 180) boost += 8;
  if (warningCodes.has("cart_low_variety") && isNewCategory) boost += 6;
  if (warningCodes.has("cart_low_calories") && Number(product.calories || 0) >= 160) boost += 6;

  return boost;
}

function recommendationFitsNeed(product, need) {
  const role = inferFoodRole(product);
  if (isExtremeBalanceItem(product)) return false;

  if (need === "protein") return role === "protein_anchor" && Number(product.protein || 0) >= 10;
  if (need === "carbs") return role === "carb_base" && Number(product.carbs || 0) >= 15;
  if (need === "fat") return role === "fat_support" && Number(product.fat || 0) >= 8;
  if (need === "vegetables") return role === "vegetable_support";
  return false;
}

function buildRecommendationReason(goal, analysis, cartAnalysis, product, isNewCategory) {
  const needs = cartAnalysis && cartAnalysis.needs ? cartAnalysis.needs : {};

  if (needs.protein === "low" && recommendationFitsNeed(product, "protein")) {
    return "Sản phẩm này đóng vai trò nguồn đạm chính, phù hợp để bù phần protein đang thiếu trong giỏ hàng.";
  }
  if (needs.carbs === "low" && recommendationFitsNeed(product, "carbs")) {
    return "Sản phẩm này thuộc nhóm tinh bột nền, phù hợp để lấp phần carb còn thiếu trong giỏ hàng.";
  }
  if (needs.fat === "low" && recommendationFitsNeed(product, "fat")) {
    return "Sản phẩm này bổ sung chất béo tốt, phù hợp để cân bằng phần chất béo đang thiếu.";
  }
  if (needs.vegetables === "low" && recommendationFitsNeed(product, "vegetables")) {
    return "Sản phẩm này thuộc nhóm rau củ hỗ trợ chất xơ và độ no, phù hợp để hoàn thiện giỏ hàng.";
  }
  if (isNewCategory && recommendationFitsNeed(product, "vegetables")) {
    return "Món này giúp giỏ hàng đa dạng hơn nhờ bổ sung thêm nhóm rau củ hỗ trợ cân bằng bữa ăn.";
  }
  return analysis.summary || "Sản phẩm này có thể bổ sung hợp lý cho mục tiêu hiện tại.";
}

function scoreRecommendationBoost(cartAnalysis, product, isNewCategory, goal = "balanced") {
  const needs = cartAnalysis && cartAnalysis.needs ? cartAnalysis.needs : {};
  const role = inferFoodRole(product);
  let boost = 0;

  if (isExtremeBalanceItem(product)) return -100;

  if (needs.protein === "low" && recommendationFitsNeed(product, "protein")) boost += 18;
  if (needs.carbs === "low" && recommendationFitsNeed(product, "carbs")) boost += 16;
  if (needs.fat === "low" && recommendationFitsNeed(product, "fat")) boost += 14;
  if (needs.vegetables === "low" && recommendationFitsNeed(product, "vegetables")) boost += 16;

  if (isNewCategory && recommendationFitsNeed(product, "vegetables")) boost += 4;
  if (goal === "weight_loss" && role === "protein_anchor" && Number(product.fat || 0) <= 15) boost += 4;
  if (goal === "weight_gain" && role === "carb_base" && Number(product.calories || 0) >= 120) boost += 4;
  if (goal === "balanced" && role === "mixed_support") boost += 2;

  return boost;
}

function rankProductsForNeed(products, cartAnalysis, goal, userProfile, need, cartCategories = new Set(), cartIds = new Set()) {
  return (products || [])
    .filter((product) => !cartIds.has(String(product.id)))
    .filter((product) => recommendationFitsNeed(product, need))
    .filter((product) => !isExtremeBalanceItem(product))
    .map((product) => {
      const enrichedProduct = {
        ...product,
        food_role: inferFoodRole(product)
      };
      const analysis = analyzeProductForGoal(enrichedProduct, goal, userProfile);
      const isNewCategory = !cartCategories.has(String(enrichedProduct.category || "").trim().toLowerCase());
      const boost = scoreRecommendationBoost(cartAnalysis, enrichedProduct, isNewCategory, goal);
      return {
        ...enrichedProduct,
        score: Math.round(Number(analysis.score || 0) + boost),
        level: analysis.level,
        confidence: analysis.confidence,
        reason: buildRecommendationReason(goal, analysis, cartAnalysis, enrichedProduct, isNewCategory),
        need
      };
    })
    .sort((a, b) => b.score - a.score);
}

function buildConcreteSuggestions(cartAnalysis, availableProducts, goal, userProfile, cartCategories = new Set(), cartIds = new Set()) {
  const suggestions = [];
  const needs = cartAnalysis && cartAnalysis.needs ? cartAnalysis.needs : {};
  const needOrder = [
    ["protein", "protein"],
    ["carbs", "carbs"],
    ["fat", "fat"],
    ["vegetables", "vegetables"]
  ];

  for (const [needKey, needType] of needOrder) {
    if (needs[needKey] !== "low") continue;
    const ranked = rankProductsForNeed(availableProducts, cartAnalysis, goal, userProfile, needType, cartCategories, cartIds).slice(0, 3);
    if (!ranked.length) continue;

    const names = ranked.map((item) => item.name).filter(Boolean);
    const joinedNames =
      names.length === 1 ? names[0] :
      names.length === 2 ? `${names[0]} hoặc ${names[1]}` :
      `${names[0]}, ${names[1]} hoặc ${names[2]}`;

    if (needType === "protein") {
      suggestions.push(`Bạn đang thiếu protein, có thể thêm ${joinedNames}.`);
    } else if (needType === "carbs") {
      suggestions.push(`Bạn đang thiếu tinh bột nền, có thể thêm ${joinedNames}.`);
    } else if (needType === "fat") {
      suggestions.push(`Bạn đang thiếu chất béo tốt, có thể thêm ${joinedNames}.`);
    } else if (needType === "vegetables") {
      suggestions.push(`Giỏ hàng đang thiếu rau củ hỗ trợ chất xơ và độ no, có thể thêm ${joinedNames}.`);
    }
  }

  if (!suggestions.length) {
    suggestions.push("Các nhóm chất chính đang khá ổn. Bạn có thể giữ giỏ hàng hiện tại hoặc thêm một món rau củ để đa dạng hơn.");
  }

  return suggestions.slice(0, 4);
}

function buildAlignedRecommendations(cartAnalysis, availableProducts, goal, userProfile, cartCategories = new Set(), cartIds = new Set()) {
  const needs = cartAnalysis && cartAnalysis.needs ? cartAnalysis.needs : {};
  const orderedNeeds = ["protein", "carbs", "fat", "vegetables"].filter((need) => needs[need] === "low");
  const collected = [];
  const seen = new Set();

  for (const need of orderedNeeds) {
    const ranked = rankProductsForNeed(availableProducts, cartAnalysis, goal, userProfile, need, cartCategories, cartIds);
    for (const item of ranked) {
      const key = String(item.id);
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(item);
      break;
    }
  }

  if (collected.length < 4) {
    const fallback = (availableProducts || [])
      .filter((product) => !cartIds.has(String(product.id)))
      .filter((product) => !isExtremeBalanceItem(product))
      .map((product) => {
        const enrichedProduct = {
          ...product,
          food_role: inferFoodRole(product)
        };
        const analysis = analyzeProductForGoal(enrichedProduct, goal, userProfile);
        const isNewCategory = !cartCategories.has(String(enrichedProduct.category || "").trim().toLowerCase());
        const boost = scoreRecommendationBoost(cartAnalysis, enrichedProduct, isNewCategory, goal);
        return {
          ...enrichedProduct,
          score: Math.round(Number(analysis.score || 0) + boost),
          level: analysis.level,
          confidence: analysis.confidence,
          reason: buildRecommendationReason(goal, analysis, cartAnalysis, enrichedProduct, isNewCategory)
        };
      })
      .sort((a, b) => b.score - a.score);

    for (const item of fallback) {
      const key = String(item.id);
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(item);
      if (collected.length >= 4) break;
    }
  }

  return collected.slice(0, 4);
}

app.get("/me", authMiddleware, (req, res) => {
  res.json({
    ok: true,
    user: req.user
  });
});

// Lấy hồ sơ user từ DB (đầy đủ hơn /me)
app.get("/me/profile", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      `SELECT u.id, u.name, u.email, u.phone, u.address, u.avatar_url,
              u.age, u.gender, u.height, u.weight, u.activity_level,
              u.health_conditions, u.diet_preferences,
              r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?
       LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy người dùng" });
    }
    const u = rows[0];
    res.json({
      ok: true,
      profile: {
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone || "",
        address: u.address || "",
        avatar_url: u.avatar_url || "",
        age: u.age,
        gender: u.gender,
        height: u.height,
        weight: u.weight,
        activity_level: u.activity_level,
        health_conditions: parseStringArrayField(u.health_conditions),
        diet_preferences: parseStringArrayField(u.diet_preferences),
        role: u.role_name
      }
    });
  } catch (error) {
    console.error("Get my profile error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lấy hồ sơ" });
  }
});

app.get("/me/expert-conversations", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      `SELECT c.id, c.user_id, c.expert_id, c.topic, c.status,
              c.attached_product_id, c.attached_product_snapshot, c.cart_snapshot, c.profile_snapshot,
              c.latest_message_text, c.latest_message_at, c.created_at, c.updated_at,
              u.name AS expert_name
       FROM expert_conversations c
       LEFT JOIN users u ON u.id = c.expert_id
       WHERE c.user_id = ?
       ORDER BY COALESCE(c.latest_message_at, c.created_at) DESC, c.id DESC`,
      [userId]
    );

    res.json({
      ok: true,
      conversations: rows.map((row) => ({
        ...mapConversationRow(row),
        expert_name: row.expert_name || ""
      }))
    });
  } catch (error) {
    console.error("Get my expert conversations error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lấy hội thoại với chuyên gia" });
  }
});

app.post("/me/expert-conversations", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      message,
      topic,
      product_id,
      include_profile,
      include_cart,
      cart_items
    } = req.body || {};

    const validation = validateConsultationText(message, "Câu hỏi");
    if (!validation.ok) {
      return res.status(400).json({ ok: false, message: validation.message });
    }
    const text = validation.text;

    const attachedProductId = Number(product_id);
    const productSnapshot = Number.isFinite(attachedProductId)
      ? await buildConsultationProductSnapshot(attachedProductId)
      : null;
    const profileSnapshot = include_profile ? await buildConsultationUserSnapshot(userId) : null;
      const cartSnapshot = include_cart && Array.isArray(cart_items) && cart_items.length
        ? await buildConsultationCartSnapshot(cart_items)
        : null;

    const [result] = await db.query(
      `INSERT INTO expert_conversations
       (user_id, topic, status, attached_product_id, attached_product_snapshot, cart_snapshot, profile_snapshot, latest_message_text, latest_message_at)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, NOW())`,
      [
        userId,
        normalizeConsultationTopic(topic),
        productSnapshot ? attachedProductId : null,
        productSnapshot ? JSON.stringify(productSnapshot) : null,
        cartSnapshot ? JSON.stringify(cartSnapshot) : null,
        profileSnapshot ? JSON.stringify(profileSnapshot) : null,
        summarizeConversationMessage(text)
      ]
    );

    const conversationId = result.insertId;

    await db.query(
      `INSERT INTO expert_messages (conversation_id, sender_type, sender_id, message, quick_flags)
       VALUES (?, 'user', ?, ?, ?)`,
      [conversationId, userId, text, JSON.stringify([])]
    );

    const [rows] = await db.query(
      `SELECT *
       FROM expert_conversations
       WHERE id = ?
       LIMIT 1`,
      [conversationId]
    );

    res.json({
      ok: true,
      message: "Đã gửi câu hỏi tới chuyên gia",
      conversation: rows.length ? mapConversationRow(rows[0]) : null
    });
  } catch (error) {
    console.error("Create expert conversation error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi tạo cuộc trò chuyện" });
  }
});

app.get("/me/expert-conversations/:id", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const conversationId = req.params.id;

    const [rows] = await db.query(
      `SELECT c.*, u.name AS expert_name
       FROM expert_conversations c
       LEFT JOIN users u ON u.id = c.expert_id
       WHERE c.id = ? AND c.user_id = ?
       LIMIT 1`,
      [conversationId, userId]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy cuộc trò chuyện" });
    }

    const [messages] = await db.query(
      `SELECT m.id, m.conversation_id, m.sender_type, m.sender_id, m.message, m.quick_flags, m.created_at,
              CASE
                WHEN m.sender_type = 'expert' THEN eu.name
                ELSE uu.name
              END AS sender_name
       FROM expert_messages m
       LEFT JOIN users eu ON eu.id = m.sender_id AND m.sender_type = 'expert'
       LEFT JOIN users uu ON uu.id = m.sender_id AND m.sender_type = 'user'
       WHERE m.conversation_id = ?
       ORDER BY m.created_at ASC, m.id ASC`,
      [conversationId]
    );

    res.json({
      ok: true,
      conversation: {
        ...mapConversationRow(rows[0]),
        expert_name: rows[0].expert_name || ""
      },
      messages: messages.map(mapConsultationMessage)
    });
  } catch (error) {
    console.error("Get my expert conversation detail error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lấy chi tiết cuộc trò chuyện" });
  }
});

app.post("/me/expert-conversations/:id/messages", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const conversationId = req.params.id;
    const validation = validateConsultationText((req.body || {}).message, "Tin nhắn");
    if (!validation.ok) {
      return res.status(400).json({ ok: false, message: validation.message });
    }
    const text = validation.text;

    const [rows] = await db.query(
      `SELECT id, user_id
       FROM expert_conversations
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
      [conversationId, userId]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy cuộc trò chuyện" });
    }

    await db.query(
      `INSERT INTO expert_messages (conversation_id, sender_type, sender_id, message, quick_flags)
       VALUES (?, 'user', ?, ?, ?)`,
      [conversationId, userId, text, JSON.stringify([])]
    );

    await db.query(
      `UPDATE expert_conversations
       SET status = 'pending',
           latest_message_text = ?,
           latest_message_at = NOW()
       WHERE id = ?`,
      [summarizeConversationMessage(text), conversationId]
    );

    res.json({ ok: true, message: "Đã gửi tin nhắn tới chuyên gia" });
  } catch (error) {
    console.error("Send user expert message error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi gửi tin nhắn" });
  }
});

app.get("/expert/consultations", authMiddleware, expertMiddleware, async (req, res) => {
  try {
    const status = String(req.query.status || "").trim();
    const where = [];
    const params = [];
    if (status) {
      where.push("c.status = ?");
      params.push(status);
    }

    const [rows] = await db.query(
      `SELECT c.id, c.user_id, c.expert_id, c.topic, c.status,
              c.attached_product_id, c.attached_product_snapshot, c.cart_snapshot, c.profile_snapshot,
              c.latest_message_text, c.latest_message_at, c.created_at, c.updated_at,
              u.name AS user_name, u.email AS user_email,
              ex.name AS expert_name
       FROM expert_conversations c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN users ex ON ex.id = c.expert_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY
         CASE c.status
           WHEN 'pending' THEN 1
           WHEN 'in_progress' THEN 2
           WHEN 'answered' THEN 3
           ELSE 4
         END,
         COALESCE(c.latest_message_at, c.created_at) DESC,
         c.id DESC`,
      params
    );

    const consultations = await Promise.all(
      rows.map(async (row) => {
        const conversation = await enrichConversationSnapshots(mapConversationRow(row));
        return {
          ...conversation,
          user_name: row.user_name || "",
          user_email: row.user_email || "",
          expert_name: row.expert_name || ""
        };
      })
    );

    res.json({
      ok: true,
      consultations
    });
  } catch (error) {
    console.error("Get expert consultations error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lấy danh sách tư vấn" });
  }
});

app.get("/expert/consultations/:id", authMiddleware, expertMiddleware, async (req, res) => {
  try {
    const consultationId = req.params.id;
    const [rows] = await db.query(
      `SELECT c.*, u.name AS user_name, u.email AS user_email, ex.name AS expert_name
       FROM expert_conversations c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN users ex ON ex.id = c.expert_id
       WHERE c.id = ?
       LIMIT 1`,
      [consultationId]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy yêu cầu tư vấn" });
    }

    const [messages] = await db.query(
      `SELECT m.id, m.conversation_id, m.sender_type, m.sender_id, m.message, m.quick_flags, m.created_at,
              CASE
                WHEN m.sender_type = 'expert' THEN eu.name
                ELSE uu.name
              END AS sender_name
       FROM expert_messages m
       LEFT JOIN users eu ON eu.id = m.sender_id AND m.sender_type = 'expert'
       LEFT JOIN users uu ON uu.id = m.sender_id AND m.sender_type = 'user'
       WHERE m.conversation_id = ?
       ORDER BY m.created_at ASC, m.id ASC`,
      [consultationId]
    );

    const conversation = await enrichConversationSnapshots(mapConversationRow(rows[0]));
    conversation.user_name = rows[0].user_name || "";
    conversation.user_email = rows[0].user_email || "";
    conversation.expert_name = rows[0].expert_name || "";

    res.json({
      ok: true,
      consultation: conversation,
      messages: messages.map(mapConsultationMessage)
    });
  } catch (error) {
    console.error("Get expert consultation detail error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lấy chi tiết tư vấn" });
  }
});

app.post("/expert/consultations/:id/reply", authMiddleware, expertMiddleware, async (req, res) => {
  try {
    const consultationId = req.params.id;
    const expertId = req.user.id;
    const validation = validateConsultationText((req.body || {}).message, "Phản hồi");
    const text = validation.text;
    const quickFlags = parseStringArrayField((req.body || {}).quick_flags);
    const nextStatus = String((req.body || {}).status || "answered").trim() || "answered";
    const allowedStatuses = new Set(["pending", "in_progress", "answered", "closed"]);

    if (!validation.ok) {
      return res.status(400).json({ ok: false, message: validation.message });
    }
    if (!allowedStatuses.has(nextStatus)) {
      return res.status(400).json({ ok: false, message: "Trạng thái tư vấn không hợp lệ" });
    }

    const [rows] = await db.query(
      `SELECT id
       FROM expert_conversations
       WHERE id = ?
       LIMIT 1`,
      [consultationId]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy yêu cầu tư vấn" });
    }

    await db.query(
      `INSERT INTO expert_messages (conversation_id, sender_type, sender_id, message, quick_flags)
       VALUES (?, 'expert', ?, ?, ?)`,
      [consultationId, expertId, text, stringifyStringArray(quickFlags)]
    );

    await db.query(
      `UPDATE expert_conversations
       SET expert_id = ?,
           status = ?,
           latest_message_text = ?,
           latest_message_at = NOW()
       WHERE id = ?`,
      [expertId, nextStatus, summarizeConversationMessage(text), consultationId]
    );

    res.json({ ok: true, message: "Đã gửi phản hồi tới người dùng" });
  } catch (error) {
    console.error("Reply expert consultation error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi gửi phản hồi" });
  }
});

app.put("/expert/consultations/:id/status", authMiddleware, expertMiddleware, async (req, res) => {
  try {
    const consultationId = req.params.id;
    const expertId = req.user.id;
    const status = String((req.body || {}).status || "").trim();
    const allowedStatuses = new Set(["pending", "in_progress", "answered", "closed"]);

    if (!allowedStatuses.has(status)) {
      return res.status(400).json({ ok: false, message: "Trạng thái tư vấn không hợp lệ" });
    }

    const [rows] = await db.query("SELECT id FROM expert_conversations WHERE id = ? LIMIT 1", [consultationId]);
    if (!rows.length) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy yêu cầu tư vấn" });
    }

    await db.query(
      `UPDATE expert_conversations
       SET expert_id = COALESCE(expert_id, ?),
           status = ?
       WHERE id = ?`,
      [expertId, status, consultationId]
    );

    res.json({ ok: true, message: "Đã cập nhật trạng thái tư vấn" });
  } catch (error) {
    console.error("Update expert consultation status error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi cập nhật trạng thái tư vấn" });
  }
});

app.get("/me/goal-suggestion", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const profile = await buildAiUserProfile(userId, null);
    const suggestion = inferGoalFromProfile(profile);
    const height = Number(profile.height || 0);
    const weight = Number(profile.weight || 0);
    const bmi = height > 0 && weight > 0 ? (weight / Math.pow(height / 100, 2)) : null;
    const hasCompleteProfile =
      Number(profile.age || 0) > 0 &&
      !!String(profile.gender || "").trim() &&
      height > 0 &&
      weight > 0 &&
      !!String(profile.activity_level || "").trim();
    res.json({
      ok: true,
      suggestion,
      profile_mode: profile && profile.id ? "personalized" : "generic",
      bmi,
      activity_level: profile.activity_level || "",
      has_complete_profile: hasCompleteProfile
    });
  } catch (error) {
    console.error("Get goal suggestion error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi gợi ý mục tiêu" });
  }
});

// Cập nhật hồ sơ user + upload avatar + đổi mật khẩu (nếu có)
app.put("/me/profile", authMiddleware, uploadAvatar.single("avatar"), async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      name,
      phone,
      address,
      age,
      gender,
      height,
      weight,
      activity_level,
      health_conditions,
      diet_preferences,
      current_password,
      new_password
    } = req.body || {};

    const [rows] = await db.query(
      "SELECT id, email, password_hash FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy người dùng" });
    }

    const nextName = String(name || "").trim();
    const nextPhone = String(phone || "").trim();
    const nextAddress = String(address || "").trim();
    const nextAge = age ? Number(age) : null;
    const nextGender = gender || null;
    const nextHeight = height ? Number(height) : null;
    const nextWeight = weight ? Number(weight) : null;
    const nextActivityLevel = activity_level || null;
    const nextHealthConditions = stringifyStringArray(health_conditions);
    const nextDietPreferences = stringifyStringArray(diet_preferences);
    const uploadedFile = req.file ? req.file.filename : null;
    const nextAvatarUrl = uploadedFile ? ("avatars/" + uploadedFile) : null;

    if (!nextName) {
      return res.status(400).json({ ok: false, message: "Thiếu name" });
    }

    // đổi mật khẩu nếu có new_password
    let passwordHashToSet = null;
    const np = String(new_password || "").trim();
    if (np) {
      const cp = String(current_password || "");
      if (!cp) {
        return res.status(400).json({ ok: false, message: "Vui lòng nhập mật khẩu hiện tại để đổi mật khẩu" });
      }
      const ok = await bcrypt.compare(cp, rows[0].password_hash);
      if (!ok) {
        return res.status(400).json({ ok: false, message: "Mật khẩu hiện tại không đúng" });
      }
      if (np.length < 6) {
        return res.status(400).json({ ok: false, message: "Mật khẩu mới phải ít nhất 6 ký tự" });
      }
      passwordHashToSet = await bcrypt.hash(np, 10);
    }

    // build UPDATE dynamically (để không overwrite avatar khi không upload)
    const fields = [
      "name = ?",
      "phone = ?",
      "address = ?",
      "age = ?",
      "gender = ?",
      "height = ?",
      "weight = ?",
      "activity_level = ?",
      "health_conditions = ?",
      "diet_preferences = ?"
    ];
    const params = [
      nextName,
      nextPhone,
      nextAddress,
      nextAge,
      nextGender,
      nextHeight,
      nextWeight,
      nextActivityLevel,
      nextHealthConditions,
      nextDietPreferences
    ];
    if (nextAvatarUrl) {
      fields.push("avatar_url = ?");
      params.push(nextAvatarUrl);
    }
    if (passwordHashToSet) {
      fields.push("password_hash = ?");
      params.push(passwordHashToSet);
    }
    params.push(userId);

    await db.query(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, params);

    res.json({ ok: true, message: "Cập nhật hồ sơ thành công", avatar_url: nextAvatarUrl || undefined });
  } catch (error) {
    console.error("Update my profile error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi cập nhật hồ sơ" });
  }
});

app.get("/products", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT ${PRODUCT_AI_FIELDS} FROM products ORDER BY created_at DESC`
    );

    res.json({ ok: true, products: rows });
  } catch (error) {
    console.error("Get products error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lấy sản phẩm" });
  }
});

// Rule-based product recommendations derived from user behavior events.
// Scoring formula:
// - 1 lần xem sản phẩm: +1
// - 1 lần thêm vào giỏ: +3
// - 1 lần mua: +5
async function getBehaviorBasedRecommendedProducts(userId, limit) {
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(50, Number(limit))) : 6;

  // NOTE: We only score events that include properties.product_id so we can rank per product.
  const [interactions] = await db.query(
    `SELECT
        ${PRODUCT_AI_FIELDS_P},
        s.score
      FROM (
        SELECT
          CAST(
            COALESCE(
              JSON_UNQUOTE(JSON_EXTRACT(properties, '$.product_id')),
              JSON_UNQUOTE(JSON_EXTRACT(properties, '$.productId'))
            )
            AS UNSIGNED
          ) AS product_id,
          SUM(
            CASE
              WHEN event_name IN ('product_view', 'product_view_long') THEN 1
              WHEN event_name = 'add_to_cart' THEN 3
              WHEN event_name IN ('purchase', 'order_placed') THEN 5
              ELSE 0
            END
          ) AS score
        FROM user_behavior_events
        WHERE user_id = ?
          AND COALESCE(
            JSON_EXTRACT(properties, '$.product_id'),
            JSON_EXTRACT(properties, '$.productId')
          ) IS NOT NULL
          AND event_time >= DATE_SUB(NOW(), INTERVAL 90 DAY)
        GROUP BY product_id
        HAVING product_id IS NOT NULL AND product_id <> 0
        ORDER BY score DESC
        LIMIT ?
      ) s
      JOIN products p ON p.id = s.product_id
      ORDER BY s.score DESC`,
    [userId, Math.max(safeLimit * 3, 18)]
  );

  if (interactions && interactions.length) {
    const interactedIds = new Set();
    const categoryWeights = new Map();
    const roleWeights = new Map();

    const addWeight = (map, key, amount) => {
      const normalizedKey = String(key || "").trim().toLowerCase();
      if (!normalizedKey) return;
      map.set(normalizedKey, (map.get(normalizedKey) || 0) + amount);
    };

    interactions.forEach((product, index) => {
      const id = String(product.id);
      const score = Number(product.score || 0);
      const rankWeight = Math.max(1, interactions.length - index);
      const weight = score + rankWeight * 0.5;
      interactedIds.add(id);
      addWeight(categoryWeights, product.category, weight);
      addWeight(roleWeights, inferFoodRole(product), weight);
    });

    const topCategory = categoryWeights.size
      ? [...categoryWeights.entries()].sort((a, b) => b[1] - a[1])[0][0]
      : "";
    const topRole = roleWeights.size
      ? [...roleWeights.entries()].sort((a, b) => b[1] - a[1])[0][0]
      : "";

    const buildBehaviorReason = (product, categoryScore, roleScore, repeated = false) => {
      const productRole = inferFoodRole(product);
      if (repeated) {
        return "Bạn đã từng xem hoặc thêm sản phẩm này, nên hệ thống nhắc lại vì có thể bạn vẫn quan tâm.";
      }
      if (categoryScore > 0 && roleScore > 0) {
        return "Sản phẩm này cùng nhóm bạn thường quan tâm và cũng khá gần với kiểu dinh dưỡng bạn hay xem.";
      }
      if (categoryScore > 0) {
        return "Sản phẩm này thuộc nhóm bạn thường xem hoặc mua gần đây, nên có thể hợp nhu cầu hiện tại.";
      }
      if (roleScore > 0) {
        if (productRole === "protein_anchor") return "Bạn có xu hướng quan tâm nhóm giàu đạm, nên hệ thống gợi ý thêm lựa chọn tương tự.";
        if (productRole === "carb_base") return "Bạn có xu hướng quan tâm nhóm tinh bột nền, nên hệ thống gợi ý thêm lựa chọn tương tự.";
        if (productRole === "fat_support") return "Bạn có xu hướng quan tâm nhóm chất béo tốt, nên hệ thống gợi ý thêm lựa chọn tương tự.";
        if (productRole === "vegetable_support") return "Bạn có xu hướng quan tâm nhóm rau củ, nên hệ thống gợi ý thêm lựa chọn tương tự.";
      }
      if (topCategory) {
        return "Sản phẩm này gần với nhóm bạn đã quan tâm gần đây, nên được đưa vào danh sách gợi ý.";
      }
      if (topRole) {
        return "Sản phẩm này khá gần với kiểu dinh dưỡng bạn từng xem, nên được đưa vào danh sách gợi ý.";
      }
      return "Sản phẩm này được chọn dựa trên những gì bạn đã xem và thêm vào giỏ gần đây.";
    };

    const [candidateProducts] = await db.query(
      `SELECT ${PRODUCT_AI_FIELDS} FROM products WHERE is_active = 1 OR is_active IS NULL LIMIT 160`
    );

    const expanded = (candidateProducts || [])
      .filter((product) => !interactedIds.has(String(product.id)))
      .map((product) => {
        const categoryKey = String(product.category || "").trim().toLowerCase();
        const roleKey = inferFoodRole(product);
        const categoryScore = categoryWeights.get(categoryKey) || 0;
        const roleScore = roleWeights.get(roleKey) || 0;
        const affinityScore = categoryScore * 2 + roleScore * 1.5 + (product.category && categoryKey === topCategory ? 3 : 0);
        return {
          ...product,
          behaviorScore: affinityScore,
          sourceType: "behavior",
          sourceLabel: "Bạn có thể sẽ thích",
          reason: buildBehaviorReason(product, categoryScore, roleScore, false)
        };
      })
      .filter((product) => product.behaviorScore > 0)
      .sort((a, b) => b.behaviorScore - a.behaviorScore);

    const repeated = interactions.map((product) => ({
      ...product,
      behaviorScore: Number(product.score || 0),
      sourceType: "behavior_repeat",
      sourceLabel: "Bạn từng quan tâm",
      reason: buildBehaviorReason(product, 0, 0, true)
    }));

    const combined = [];
    const seenIds = new Set();
    for (const product of expanded.concat(repeated)) {
      const id = String(product.id);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      combined.push(product);
      if (combined.length >= safeLimit) break;
    }

    if (combined.length) return combined;
  }

  // Fallback: if no behavior data exists yet, return newest products.
  const [fallback] = await db.query(
    `SELECT ${PRODUCT_AI_FIELDS} FROM products ORDER BY created_at DESC LIMIT ?`,
    [safeLimit]
  );
return (fallback || []).map((product) => ({
    ...product,
    sourceType: "behavior_fallback",
    sourceLabel: "Gợi ý tạm thời",
    reason: "Hệ thống đang dùng danh sách dự phòng vì chưa đủ dữ liệu cá nhân hóa cho bạn."
  }));
}

// Personalized recommendations for current logged-in user.
app.get("/me/recommendations", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = req.query && req.query.limit ? Number(req.query.limit) : 6;
    const products = await getBehaviorBasedRecommendedProducts(userId, limit);
    res.json({ ok: true, products });
  } catch (error) {
    console.error("Get recommendations error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lấy gợi ý" });
  }
});

// Explicit userId input (for debugging/admin). Only the user themself or admin can access.
app.get("/recommendations/:userId", authMiddleware, async (req, res) => {
  try {
    const targetUserId = Number(req.params.userId);
    if (!Number.isFinite(targetUserId)) {
      return res.status(400).json({ ok: false, message: "userId không hợp lệ" });
    }

    if (String(req.user.id) !== String(targetUserId) && req.user.role !== "admin") {
      return res.status(403).json({ ok: false, message: "Không có quyền" });
    }

    const limit = req.query && req.query.limit ? Number(req.query.limit) : 6;
    const products = await getBehaviorBasedRecommendedProducts(targetUserId, limit);
    res.json({ ok: true, products });
  } catch (error) {
    console.error("Get recommendations by userId error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lấy gợi ý" });
  }
});

// AI-powered personalized recommendations based on user profile
app.get("/me/ai-recommendations", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = req.query && req.query.limit ? Number(req.query.limit) : 6;
    const safeLimit = Math.max(1, Math.min(20, Number(limit) || 6));

    // Build user profile from database
    const userProfile = await buildAiUserProfile(userId);
    
    // Infer goal from profile
    const goalInference = inferGoalFromProfile(userProfile);
    const goal = goalInference.goal || "balanced";

    // Get all active products
    const [products] = await db.query(
      `SELECT ${PRODUCT_AI_FIELDS} FROM products WHERE is_active = 1 OR is_active IS NULL LIMIT 100`
    );

    if (!products || products.length === 0) {
      return res.json({ ok: true, products: [], goal, reason: goalInference.reason });
    }

    // Analyze each product with AI
    const scoredProducts = products.map(product => {
      const analysis = analyzeProductForGoal(product, goal, userProfile);
      return {
        ...product,
        aiScore: analysis.score,
        aiReason: analysis.reasons && analysis.reasons.length > 0 ? analysis.reasons[0] : "Phù hợp với mục tiêu của bạn",
        reason: analysis.reasons && analysis.reasons.length > 0 ? analysis.reasons[0] : "Phù hợp với mục tiêu của bạn",
        sourceType: "ai",
        sourceLabel: "Phù hợp mục tiêu",
        confidence: analysis.confidence,
        matchedRules: analysis.matchedRules
      };
    });

    // Sort by AI score (descending)
    scoredProducts.sort((a, b) => b.aiScore - a.aiScore);

    // Return top products
    const topProducts = scoredProducts.slice(0, safeLimit);

    res.json({
      ok: true,
      products: topProducts,
      goal,
      goalReason: goalInference.reason,
      confidence: goalInference.confidence,
      personalized: !!(userProfile.age || userProfile.weight || userProfile.height)
    });
  } catch (error) {
    console.error("Get AI recommendations error:", error);
    // Fallback to behavior-based recommendations
    try {
      const limit = req.query && req.query.limit ? Number(req.query.limit) : 6;
      const products = await getBehaviorBasedRecommendedProducts(req.user.id, limit);
      res.json({ ok: true, products, fallback: true, reason: "AI analysis failed, using behavior-based" });
    } catch (fallbackError) {
      res.status(500).json({ ok: false, message: "Lỗi server khi lấy gợi ý" });
    }
  }
});

app.get("/products/:id", async (req, res) => {
  try {
    const productId = req.params.id;

    const [rows] = await db.query(
      `SELECT ${PRODUCT_AI_FIELDS} FROM products WHERE id = ?`,
      [productId]
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ ok: false, message: "Không tìm thấy sản phẩm" });
    }

    res.json({ ok: true, product: rows[0] });
  } catch (error) {
    console.error("Get product detail error:", error);
    res
      .status(500)
      .json({ ok: false, message: "Lỗi server khi lấy chi tiết sản phẩm" });
  }
});

// Lấy danh sách đánh giá chuyên gia theo sản phẩm
app.get("/products/:id/expert-reviews", async (req, res) => {
  try {
    const productId = req.params.id;

    const [rows] = await db.query(
      `SELECT er.id, er.review_text, er.created_at,
              u.id AS expert_id, u.name AS expert_name
       FROM expert_reviews er
       JOIN users u ON u.id = er.expert_id
       WHERE er.product_id = ?
       ORDER BY er.created_at DESC`,
      [productId]
    );

    res.json({ ok: true, reviews: rows });
  } catch (error) {
    console.error("Get expert reviews error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lấy đánh giá" });
  }
});

// Chuyên gia gửi đánh giá cho sản phẩm
app.post("/expert/reviews", authMiddleware, expertMiddleware, async (req, res) => {
  try {
    const expertId = req.user.id;
    const { product_id, review_text } = req.body || {};

    if (!product_id || !review_text || !String(review_text).trim()) {
      return res.status(400).json({
        ok: false,
        message: "Thiếu product_id hoặc review_text"
      });
    }

    // đảm bảo product tồn tại
    const [pRows] = await db.query("SELECT id FROM products WHERE id = ? LIMIT 1", [
      product_id
    ]);
    if (pRows.length === 0) {
      return res.status(404).json({ ok: false, message: "Sản phẩm không tồn tại" });
    }

    const text = String(review_text).trim();

    await db.query(
      "UPDATE products SET expert_feedback = ? WHERE id = ?",
      [text, product_id]
    );

    res.json({ ok: true, message: "Cập nhật góp ý chuyên gia thành công" });
  } catch (error) {
    console.error("Create expert review error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lưu đánh giá" });
  }
});

app.put("/expert/products/:id", authMiddleware, expertMiddleware, async (req, res) => {
  try {
    const productId = req.params.id;
    const {
      name,
      description,
      price,
      price_unit,
      image_url,
      category,
      calories,
      protein,
      fat,
      carbs,
      sodium,
      sugar,
      saturated_fat,
      fiber,
      cholesterol,
      food_role,
      allergen_tags,
      health_tags,
      diet_flags,
      expert_feedback
    } = req.body || {};

    const toNumberOrNull = (v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const [rows] = await db.query("SELECT id FROM products WHERE id = ? LIMIT 1", [productId]);
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, message: "Sản phẩm không tồn tại" });
    }

    const nextName = String(name || "").trim();
    if (!nextName) {
      return res.status(400).json({ ok: false, message: "Tên sản phẩm là bắt buộc" });
    }

    const nextPriceUnit = String(price_unit || "").trim() || "VND/kg";
    const nextCategory = String(category || "").trim() || "Khác";
    const nextImageUrl = String(image_url || "").trim() || null;
    const nextFoodRole = String(food_role || "").trim() || null;

    await db.query(
      `UPDATE products
       SET name = ?, description = ?, price = ?, price_unit = ?, image_url = ?, category = ?,
           calories = ?, protein = ?, fat = ?, carbs = ?, sodium = ?, sugar = ?,
           saturated_fat = ?, fiber = ?, cholesterol = ?, food_role = ?,
           allergen_tags = ?, health_tags = ?, diet_flags = ?, expert_feedback = ?
       WHERE id = ?`,
      [
        nextName,
        String(description || "").trim(),
        toNumberOrNull(price),
        nextPriceUnit,
        nextImageUrl,
        nextCategory,
        toNumberOrNull(calories),
        toNumberOrNull(protein),
        toNumberOrNull(fat),
        toNumberOrNull(carbs),
        toNumberOrNull(sodium),
        toNumberOrNull(sugar),
        toNumberOrNull(saturated_fat),
        toNumberOrNull(fiber),
        toNumberOrNull(cholesterol),
        nextFoodRole,
        stringifyStringArray(allergen_tags),
        stringifyStringArray(health_tags),
        stringifyStringArray(diet_flags),
        String(expert_feedback || "").trim() || null,
        productId
      ]
    );

    res.json({ ok: true, message: "Đã cập nhật dữ liệu AI của sản phẩm" });
  } catch (error) {
    console.error("Expert update product error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi cập nhật sản phẩm" });
  }
});

app.get("/ai/product/:id", async (req, res) => {
  try {
    const productId = req.params.id;
    const goal = req.query.goal || "balanced";
    const authUser = getOptionalAuthUser(req);

    const [rows] = await db.query(
      `SELECT ${PRODUCT_AI_FIELDS}
       FROM products
       WHERE id = ?`,
      [productId]
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ ok: false, message: "Không tìm thấy sản phẩm" });
    }

    const product = rows[0];
    const userProfile = authUser ? await buildAiUserProfile(authUser.id, productId) : {};
    const analysis = analyzeProductForGoal(product, goal, userProfile);

    res.json({
      ok: true,
      product,
      analysis,
      personalized: !!(userProfile && userProfile.id)
    });
  } catch (error) {
    console.error("AI analyze product error:", error);
    res
      .status(500)
      .json({ ok: false, message: "Lỗi server khi phân tích sản phẩm" });
  }
});

app.post("/ai/cart", async (req, res) => {
  try {
    const { items, goal } = req.body || {};
    const authUser = getOptionalAuthUser(req);

    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Danh sách sản phẩm trống" });
    }

    const ids = items.map((it) => it.productId);
    const [products] = await db.query(
      `SELECT id, name, category, price_unit, calories, protein, fat, carbs, sodium, sugar, saturated_fat, fiber, cholesterol, food_role, allergen_tags, health_tags, diet_flags FROM products WHERE id IN (?)`,
      [ids]
    );

    const userProfile = authUser ? await buildAiUserProfile(authUser.id, null) : {};
    const enrichedItems = items.map((it) => {
      const p = products.find((pr) => pr.id === it.productId);
      return {
        productId: it.productId,
        quantity: it.quantity || 1,
        name: p ? p.name : "",
        category: p ? p.category : "",
        food_role: p ? inferFoodRole(p) : "mixed_support",
        price_unit: p ? p.price_unit : "",
        calories: p ? p.calories : 0,
        protein: p ? p.protein : 0,
        fat: p ? p.fat : 0,
        carbs: p ? p.carbs : 0,
        sodium: p ? p.sodium : 0,
        sugar: p ? p.sugar : 0,
        saturated_fat: p ? p.saturated_fat : 0,
        fiber: p ? p.fiber : 0,
        cholesterol: p ? p.cholesterol : 0,
        allergen_tags: p ? p.allergen_tags : "[]",
        health_tags: p ? p.health_tags : "[]",
        diet_flags: p ? p.diet_flags : "[]"
      };
    });

    const resolvedGoal = goal || inferGoalFromProfile(userProfile).goal;
    const analysis = analyzeCartForGoal(enrichedItems, resolvedGoal, userProfile);
    const cartIds = new Set(ids.map(String));
    const cartCategories = new Set(
      enrichedItems.map((item) => String(item.category || "").trim().toLowerCase()).filter(Boolean)
    );
    const [candidateProducts] = await db.query(
      `SELECT ${PRODUCT_AI_FIELDS}
       FROM products
       ORDER BY id DESC
       LIMIT 60`
    );
    analysis.suggestions = buildConcreteSuggestions(
      analysis,
      candidateProducts || [],
      resolvedGoal,
      userProfile,
      cartCategories,
      cartIds
    );

    res.type("application/json; charset=utf-8").json({
      ok: true,
      items: enrichedItems,
      analysis,
      personalized: !!(userProfile && userProfile.id),
      goal: resolvedGoal
    });
  } catch (error) {
    console.error("AI analyze cart error:", error);
    res
      .status(500)
      .type("application/json; charset=utf-8")
      .json({ ok: false, message: "Lỗi server khi phân tích giỏ hàng" });
  }
});

app.post("/ai/cart/recommendations", async (req, res) => {
  try {
    const { items, goal } = req.body || {};
    const authUser = getOptionalAuthUser(req);

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, message: "Danh sách sản phẩm trống" });
    }

    const ids = items.map((it) => Number(it.productId)).filter((id) => Number.isFinite(id));
    if (!ids.length) {
      return res.status(400).json({ ok: false, message: "Dữ liệu sản phẩm không hợp lệ" });
    }

    const [cartProducts] = await db.query(
      `SELECT id, name, category, image_url, price_unit, calories, protein, fat, carbs, sodium, sugar, saturated_fat, fiber, cholesterol, food_role, allergen_tags, health_tags, diet_flags, expert_feedback
       FROM products
       WHERE id IN (?)`,
      [ids]
    );

    const userProfile = authUser ? await buildAiUserProfile(authUser.id, null) : {};
    const resolvedGoal = goal || inferGoalFromProfile(userProfile).goal;
    const cartItems = items.map((it) => {
      const p = cartProducts.find((row) => row.id === it.productId);
      return {
        productId: it.productId,
        quantity: it.quantity || 1,
        name: p ? p.name : "",
        category: p ? p.category : "",
        food_role: p ? inferFoodRole(p) : "mixed_support",
        price_unit: p ? p.price_unit : "",
        calories: p ? p.calories : 0,
        protein: p ? p.protein : 0,
        fat: p ? p.fat : 0,
        carbs: p ? p.carbs : 0,
        sodium: p ? p.sodium : 0,
        sugar: p ? p.sugar : 0,
        saturated_fat: p ? p.saturated_fat : 0,
        fiber: p ? p.fiber : 0,
        cholesterol: p ? p.cholesterol : 0,
        allergen_tags: p ? p.allergen_tags : "[]",
        health_tags: p ? p.health_tags : "[]",
        diet_flags: p ? p.diet_flags : "[]"
      };
    });

    const cartAnalysis = analyzeCartForGoal(cartItems, resolvedGoal, userProfile);
    const cartIds = new Set(ids.map(String));
    const cartCategories = new Set(cartItems.map((item) => String(item.category || "").trim().toLowerCase()).filter(Boolean));

    const [candidateProducts] = await db.query(
      `SELECT ${PRODUCT_AI_FIELDS}
       FROM products
       ORDER BY id DESC
       LIMIT 60`
    );

    const recommendations = buildAlignedRecommendations(
      cartAnalysis,
      candidateProducts || [],
      resolvedGoal,
      userProfile,
      cartCategories,
      cartIds
    ).map((item) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      image_url: item.image_url,
      category: item.category,
      food_role: item.food_role,
      calories: item.calories,
      protein: item.protein,
      fat: item.fat,
      carbs: item.carbs,
      score: item.score,
      level: item.level,
      confidence: item.confidence,
      reason: item.reason
    }));

    res.type("application/json; charset=utf-8").json({
      ok: true,
      goal: resolvedGoal,
      personalized: !!(userProfile && userProfile.id),
      recommendations
    });
  } catch (error) {
    console.error("AI cart recommendations error:", error);
    res.status(500).type("application/json; charset=utf-8").json({ ok: false, message: "Lỗi server khi gợi ý sản phẩm" });
  }
});


app.post("/orders", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { items } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Danh sách sản phẩm trống" });
    }

    const productIds = items.map((it) => it.productId);
    const [products] = await db.query(
      "SELECT id, price FROM products WHERE id IN (?)",
      [productIds]
    );

    if (products.length !== items.length) {
      return res
        .status(400)
        .json({ ok: false, message: "Có sản phẩm không tồn tại" });
    }

    let totalPrice = 0;

    const productMap = {};
    for (const p of products) {
      productMap[p.id] = p.price;
    }

    for (const it of items) {
      const price = productMap[it.productId];
      const qty = it.quantity || 1;
      totalPrice += price * qty;
    }

    const [orderResult] = await db.query(
      "INSERT INTO orders (user_id, total_price, status) VALUES (?, ?, ?)",
      [userId, totalPrice, "pending"]
    );

    const orderId = orderResult.insertId;

    for (const it of items) {
      const price = productMap[it.productId];
      const qty = it.quantity || 1;

      await db.query(
        "INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)",
        [orderId, it.productId, qty, price]
      );
    }

    let ip = null;
    const xff = req.headers["x-forwarded-for"];
    if (xff && typeof xff === "string") {
      ip = xff.split(",")[0].trim().slice(0, 45);
    } else if (req.ip) {
      ip = String(req.ip).slice(0, 45);
    }
    const userAgent = req.get("user-agent") ? String(req.get("user-agent")).slice(0, 512) : null;

    for (const it of items) {
      const price = productMap[it.productId];
      const qty = it.quantity || 1;
      const propertiesJson = JSON.stringify({
        product_id: it.productId,
        quantity: qty,
        unit_price: price,
        order_id: orderId
      });

      await db.query(
        `INSERT INTO user_behavior_events
          (event_time, user_id, anonymous_id, session_id, event_name, page_url, referrer, ip, user_agent, properties)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          new Date(),
          userId,
          null,
          null,
          "purchase",
          null,
          null,
          ip,
          userAgent,
          propertiesJson
        ]
      );
    }

    res.json({
      ok: true,
      message: "Tạo đơn hàng thành công",
      order_id: orderId,
      total_price: totalPrice
    });
  } catch (error) {
    console.error("Create order error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi tạo đơn hàng" });
  }
});

app.get("/orders", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const [orders] = await db.query(
      "SELECT id, total_price, status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC",
      [userId]
    );

    res.json({ ok: true, orders });
  } catch (error) {
    console.error("Get my orders error:", error);
    res
      .status(500)
      .json({ ok: false, message: "Lỗi server khi lấy danh sách đơn hàng" });
  }
});

// Chi tiết 1 đơn hàng của user (phục vụ trang order.html)
app.get("/orders/:id", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const orderId = req.params.id;

    const [orderRows] = await db.query(
      "SELECT id, user_id, total_price, status, created_at FROM orders WHERE id = ? LIMIT 1",
      [orderId]
    );
    if (orderRows.length === 0) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy đơn hàng" });
    }
    const order = orderRows[0];

    // chỉ chủ đơn (hoặc admin) mới được xem
    if (String(order.user_id) !== String(userId) && req.user.role !== "admin") {
      return res.status(403).json({ ok: false, message: "Bạn không có quyền xem đơn hàng này" });
    }

    const [items] = await db.query(
      `SELECT oi.product_id, oi.quantity, oi.unit_price,
              p.name, p.image_url
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?`,
      [orderId]
    );

    const [reportRows] = await db.query(
      "SELECT COUNT(*) AS cnt FROM order_reports WHERE order_id = ? AND user_id = ?",
      [orderId, userId]
    );
    const has_report = reportRows && reportRows[0] && Number(reportRows[0].cnt) > 0;

    res.json({ ok: true, order, items, has_report });
  } catch (error) {
    console.error("Get order detail error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lấy chi tiết đơn hàng" });
  }
});

// User: báo cáo vấn đề đơn hàng
app.post("/orders/:id/report", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const orderId = req.params.id;
    const { issue_type, description } = req.body || {};

    const issue = String(issue_type || "").trim();
    const desc = String(description || "").trim();

    if (!issue) {
      return res.status(400).json({ ok: false, message: "Thiếu issue_type" });
    }
    if (issue === "Lý do khác" && !desc) {
      return res.status(400).json({ ok: false, message: "Vui lòng nhập mô tả cho 'Lý do khác'" });
    }

    const [rows] = await db.query(
      "SELECT id, user_id FROM orders WHERE id = ? LIMIT 1",
      [orderId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy đơn hàng" });
    }
    if (String(rows[0].user_id) !== String(userId)) {
      return res.status(403).json({ ok: false, message: "Bạn không có quyền báo cáo đơn hàng này" });
    }

    const [existing] = await db.query(
      "SELECT id FROM order_reports WHERE order_id = ? AND user_id = ? LIMIT 1",
      [orderId, userId]
    );
    if (existing.length > 0) {
      return res.status(409).json({ ok: false, message: "Bạn đã báo cáo đơn hàng này rồi" });
    }

    await db.query(
      "INSERT INTO order_reports (order_id, user_id, issue_type, description) VALUES (?, ?, ?, ?)",
      [orderId, userId, issue, desc || null]
    );

    res.json({ ok: true, message: "Đã gửi báo cáo. Chúng tôi sẽ liên hệ sớm nhất có thể." });
  } catch (error) {
    console.error("Create order report error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi gửi báo cáo" });
  }
});

// User: xác nhận đã nhận hàng (đưa đơn về trạng thái delivered)
app.put("/orders/:id/received", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const orderId = req.params.id;

    const [rows] = await db.query(
      "SELECT id, user_id, status FROM orders WHERE id = ? LIMIT 1",
      [orderId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy đơn hàng" });
    }
    const o = rows[0];
    if (String(o.user_id) !== String(userId)) {
      return res.status(403).json({ ok: false, message: "Bạn không có quyền cập nhật đơn hàng này" });
    }
    const s = String(o.status || "");
    if (s === "cancelled" || s === "canceled" || s === "cancelled_by_admin") {
      return res.status(400).json({ ok: false, message: "Đơn hàng đã bị hủy" });
    }
    if (s === "delivered") {
      return res.json({ ok: true, message: "Đơn hàng đã ở trạng thái đã giao" });
    }

    await db.query("UPDATE orders SET status = ? WHERE id = ?", ["delivered", orderId]);
    res.json({ ok: true, message: "Đã xác nhận nhận hàng" });
  } catch (error) {
    console.error("User received order error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi cập nhật trạng thái" });
  }
});

// Admin: cập nhật trạng thái đơn hàng (pending -> shipping -> delivered)
app.put("/admin/orders/:id/status", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const orderId = req.params.id;
    const status = String((req.body || {}).status || "").trim();
    const allowed = ["pending", "shipping", "delivered"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ ok: false, message: "Status không hợp lệ" });
    }

    const [rows] = await db.query("SELECT id, status FROM orders WHERE id = ? LIMIT 1", [orderId]);
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy đơn hàng" });
    }
    const current = String(rows[0].status || "");
    if (current === "cancelled" || current === "canceled" || current === "cancelled_by_admin") {
      return res.status(400).json({ ok: false, message: "Đơn hàng đã bị hủy" });
    }
    if (current === "delivered" && status !== "delivered") {
      return res.status(400).json({ ok: false, message: "Không thể chuyển từ 'Đã giao' về trạng thái trước" });
    }

    await db.query("UPDATE orders SET status = ? WHERE id = ?", [status, orderId]);
    res.json({ ok: true, message: "Đã cập nhật trạng thái", status });
  } catch (error) {
    console.error("Admin update order status error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi cập nhật trạng thái đơn hàng" });
  }
});

// Admin: danh sách đơn hàng
app.get("/admin/orders", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT o.id, o.total_price, o.status, o.created_at,
              u.id AS user_id, u.name AS user_name, u.email AS user_email
       FROM orders o
       JOIN users u ON u.id = o.user_id
       ORDER BY o.created_at DESC`
    );
    res.json({ ok: true, orders: rows });
  } catch (error) {
    console.error("Admin get orders error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lấy danh sách đơn hàng" });
  }
});

// Admin: theo dõi giao dịch (hiện tại lấy theo đơn hàng)
// Query params:
// - code: TX123 hoặc 123 (tìm theo mã giao dịch)
// - from: YYYY-MM-DD
// - to: YYYY-MM-DD
// - status: pending|processing|delivered|cancelled|canceled
app.get("/admin/transactions", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const code = String(req.query.code || "").trim();
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const status = String(req.query.status || "").trim();

    let sql = `
      SELECT o.id AS order_id,
             CONCAT('TX', o.id) AS tx_code,
             o.total_price AS amount,
             o.status AS status,
             o.created_at,
             u.id AS user_id,
             u.name AS user_name,
             u.email AS user_email
      FROM orders o
      JOIN users u ON u.id = o.user_id
      WHERE 1=1
    `;
    const params = [];

    if (code) {
      const q = "%" + code + "%";
      sql += " AND (CONCAT('TX', o.id) LIKE ? OR CAST(o.id AS CHAR) LIKE ?)";
      params.push(q, q);
    }

    if (from) {
      sql += " AND DATE(o.created_at) >= ?";
      params.push(from);
    }
    if (to) {
      sql += " AND DATE(o.created_at) <= ?";
      params.push(to);
    }

    if (status) {
      sql += " AND o.status = ?";
      params.push(status);
    }

    sql += " ORDER BY o.created_at DESC";

    const [rows] = await db.query(sql, params);
    res.json({ ok: true, transactions: rows });
  } catch (error) {
    console.error("Admin get transactions error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lấy danh sách giao dịch" });
  }
});

// Admin: chi tiết đơn hàng
app.get("/admin/orders/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const orderId = req.params.id;

    const [orderRows] = await db.query(
      `SELECT o.id, o.total_price, o.status, o.created_at,
              u.id AS user_id, u.name AS user_name, u.email AS user_email
       FROM orders o
       JOIN users u ON u.id = o.user_id
       WHERE o.id = ?
       LIMIT 1`,
      [orderId]
    );
    if (orderRows.length === 0) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy đơn hàng" });
    }

    const [items] = await db.query(
      `SELECT oi.product_id, oi.quantity, oi.unit_price,
              p.name, p.image_url
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?`,
      [orderId]
    );

    res.json({ ok: true, order: orderRows[0], items });
  } catch (error) {
    console.error("Admin get order detail error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lấy chi tiết đơn hàng" });
  }
});

// Admin: hủy đơn hàng (cập nhật status để user thấy ở trang hồ sơ/đơn hàng)
app.put("/admin/orders/:id/cancel", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const orderId = req.params.id;
    const [rows] = await db.query("SELECT id, status FROM orders WHERE id = ? LIMIT 1", [orderId]);
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy đơn hàng" });
    }

    const currentStatus = String(rows[0].status || "");
    if (currentStatus === "cancelled" || currentStatus === "canceled" || currentStatus === "cancelled_by_admin") {
      return res.json({ ok: true, message: "Đơn hàng đã được hủy trước đó" });
    }
    if (currentStatus === "delivered") {
      return res.status(400).json({ ok: false, message: "Không thể hủy đơn đã giao" });
    }

    await db.query("UPDATE orders SET status = ? WHERE id = ?", ["cancelled_by_admin", orderId]);
    res.json({ ok: true, message: "Đã hủy đơn hàng" });
  } catch (error) {
    console.error("Admin cancel order error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi hủy đơn hàng" });
  }
});

// Admin: danh sách báo cáo đơn hàng (support)
app.get("/admin/order-reports", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.id AS report_id,
              r.order_id,
              r.issue_type,
              r.description,
              r.status,
              r.created_at,
              u.id AS user_id,
              u.name AS user_name,
              u.email AS user_email,
              u.phone AS user_phone
       FROM order_reports r
       JOIN users u ON u.id = r.user_id
       ORDER BY r.created_at DESC`
    );
    res.json({ ok: true, reports: rows });
  } catch (error) {
    console.error("Admin get order reports error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lấy báo cáo" });
  }
});

// Admin: cập nhật trạng thái báo cáo (open/resolved)
app.put("/admin/order-reports/:id/status", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const reportId = req.params.id;
    const status = String((req.body || {}).status || "").trim();
    const allowed = ["open", "resolved"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ ok: false, message: "Status không hợp lệ" });
    }

    const [rows] = await db.query("SELECT id FROM order_reports WHERE id = ? LIMIT 1", [reportId]);
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy báo cáo" });
    }

    await db.query("UPDATE order_reports SET status = ? WHERE id = ?", [status, reportId]);
    res.json({ ok: true, message: "Đã cập nhật trạng thái báo cáo", status });
  } catch (error) {
    console.error("Admin update report status error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi cập nhật báo cáo" });
  }
});

// User product feedback endpoints
app.post("/products/:id/feedback", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const productId = req.params.id;
    const { rating, comment } = req.body || {};

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ ok: false, message: "Rating phải từ 1-5 sao" });
    }

    // Check if product exists
    const [productRows] = await db.query("SELECT id FROM products WHERE id = ? LIMIT 1", [productId]);
    if (productRows.length === 0) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy sản phẩm" });
    }

    // Insert or update feedback
    await db.query(
      `INSERT INTO user_product_feedback (user_id, product_id, rating, comment)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment), updated_at = CURRENT_TIMESTAMP`,
      [userId, productId, rating, comment || null]
    );

    res.json({ ok: true, message: "Đã lưu đánh giá của bạn" });
  } catch (error) {
    console.error("Save product feedback error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lưu đánh giá" });
  }
});

app.get("/products/:id/feedback", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const productId = req.params.id;

    const [feedbackRows] = await db.query(
      `SELECT rating, comment, created_at FROM user_product_feedback 
       WHERE user_id = ? AND product_id = ? LIMIT 1`,
      [userId, productId]
    );

    if (feedbackRows.length === 0) {
      return res.json({ ok: true, feedback: null });
    }

    res.json({ ok: true, feedback: feedbackRows[0] });
  } catch (error) {
    console.error("Get product feedback error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lấy đánh giá" });
  }
});

app.get("/products/:id/feedback/summary", async (req, res) => {
  try {
    const productId = req.params.id;

    const [summaryRows] = await db.query(
      `SELECT COUNT(*) as feedback_count, AVG(rating) as avg_rating,
              COUNT(CASE WHEN rating >= 4 THEN 1 END) as positive_count,
              COUNT(CASE WHEN rating <= 2 THEN 1 END) as negative_count
       FROM user_product_feedback WHERE product_id = ?`,
      [productId]
    );

    const summary = summaryRows[0];
    res.json({
      ok: true,
      summary: {
        feedback_count: summary.feedback_count || 0,
        avg_rating: summary.avg_rating ? parseFloat(summary.avg_rating).toFixed(1) : null,
        positive_count: summary.positive_count || 0,
        negative_count: summary.negative_count || 0
      }
    });
  } catch (error) {
    console.error("Get feedback summary error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lấy thống kê đánh giá" });
  }
});



// API admin thêm sản phẩm mới
app.post(
  "/admin/products",
  authMiddleware,
  adminMiddleware,
  uploadProductImage.single("image"),
  async (req, res) => {
  try {
    const { name, description, price, category, image_url, calories, protein, fat, carbs, sodium, sugar, saturated_fat, fiber, cholesterol } =
      req.body || {};

    const normalizedCategory = String(category || "").trim() || "Khác";

    const uploadedFile = req.file ? req.file.filename : null;
    const finalImageUrl =
      uploadedFile ? "products/" + uploadedFile : (image_url || "").trim();

    if (!name || !price || !finalImageUrl) {
      return res.status(400).json({
        ok: false,
        message: "Thiếu name, price hoặc ảnh sản phẩm"
      });
    }

    const toNumberOrNull = (v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    await db.query(
      `INSERT INTO products (name, description, price, category, image_url, calories, protein, fat, carbs, sodium, sugar, saturated_fat, fiber, cholesterol)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        description || "",
        toNumberOrNull(price),
        normalizedCategory,
        finalImageUrl,              // ví dụ "products/spinach.jpg"
        toNumberOrNull(calories),
        toNumberOrNull(protein),
        toNumberOrNull(fat),
        toNumberOrNull(carbs),
        toNumberOrNull(sodium),
        toNumberOrNull(sugar),
        toNumberOrNull(saturated_fat),
        toNumberOrNull(fiber),
        toNumberOrNull(cholesterol)
      ]
    );

    res.json({ ok: true, message: "Thêm sản phẩm thành công" });
  } catch (error) {
    console.error("Add product error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi thêm sản phẩm" });
  }
});


app.put(
  "/admin/products/:id",
  authMiddleware,
  adminMiddleware,
  uploadProductImage.single("image"),
  async (req, res) => {
  try {
    const productId = req.params.id;
    const {
      name,
      description,
      price,
      image_url,
      category,
      calories,
      protein,
      fat,
      carbs,
      sodium,
      sugar,
      saturated_fat,
      fiber,
      cholesterol
    } = req.body || {};

    const normalizedCategory = String(category || "").trim() || "Khác";

    const uploadedFile = req.file ? req.file.filename : null;
    const finalImageUrl =
      uploadedFile ? "products/" + uploadedFile : (image_url || "").trim();

    const toNumberOrNull = (v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const [rows] = await db.query(
      "SELECT id FROM products WHERE id = ?",
      [productId]
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ ok: false, message: "Không tìm thấy sản phẩm" });
    }

    if (!name || toNumberOrNull(price) === null || !finalImageUrl) {
      return res.status(400).json({
        ok: false,
        message: "Thiếu name, price hoặc ảnh sản phẩm"
      });
    }

    await db.query(
      `UPDATE products
       SET name = ?, description = ?, price = ?, image_url = ?, category = ?,
           calories = ?, protein = ?, fat = ?, carbs = ?, sodium = ?, sugar = ?, saturated_fat = ?, fiber = ?, cholesterol = ?
       WHERE id = ?`,
      [
        name,
        description || "",
        toNumberOrNull(price),
        finalImageUrl,
        normalizedCategory,
        toNumberOrNull(calories),
        toNumberOrNull(protein),
        toNumberOrNull(fat),
        toNumberOrNull(carbs),
        toNumberOrNull(sodium),
        toNumberOrNull(sugar),
        toNumberOrNull(saturated_fat),
        toNumberOrNull(fiber),
        toNumberOrNull(cholesterol),
        productId
      ]
    );

    res.json({ ok: true, message: "Cập nhật sản phẩm thành công" });
  } catch (error) {
    console.error("Update product error:", error);
    res
      .status(500)
      .json({ ok: false, message: "Lỗi server khi cập nhật sản phẩm" });
  }
});

app.delete("/admin/products/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const productId = req.params.id;

    const [rows] = await db.query(
      "SELECT id FROM products WHERE id = ?",
      [productId]
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ ok: false, message: "Không tìm thấy sản phẩm" });
    }

    await db.query("DELETE FROM products WHERE id = ?", [productId]);

    res.json({ ok: true, message: "Xóa sản phẩm thành công" });
  } catch (error) {
    console.error("Delete product error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi xóa sản phẩm" });
  }
});

app.get("/articles", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT a.id,
              a.title,
              a.content,
              a.image_url,
              a.status,
              a.category,
              a.tags,
              a.created_at,
              u.name AS expert_name
       FROM articles a
       JOIN users u ON a.expert_id = u.id
       WHERE a.status = 'published'
       ORDER BY a.created_at DESC`
    );

    res.json({ ok: true, articles: rows });
  } catch (error) {
    console.error("Get articles error:", error);
    res
      .status(500)
      .json({ ok: false, message: "Lỗi server khi lấy danh sách bài viết" });
  }
});


app.get("/articles/:id", async (req, res) => {
  try {
    const articleId = req.params.id;

    const [rows] = await db.query(
      `SELECT a.id, a.title, a.content, a.image_url, a.status, a.category, a.tags, a.created_at, a.updated_at,
              u.name AS expert_name
       FROM articles a
       JOIN users u ON a.expert_id = u.id
       WHERE a.id = ?
         AND a.status = 'published'`,
      [articleId]
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ ok: false, message: "Không tìm thấy bài viết" });
    }

    res.json({ ok: true, article: rows[0] });
  } catch (error) {
    console.error("Get article detail error:", error);
    res
      .status(500)
      .json({ ok: false, message: "Lỗi server khi lấy chi tiết bài viết" });
  }
});

app.post(
  "/expert/articles",
  authMiddleware,
  expertMiddleware,
  uploadArticleImage.single("image"),
  async (req, res) => {
    try {
      const expertId = req.user.id;
      const title = String((req.body || {}).title || "").trim();
      const content = String((req.body || {}).content || "").trim();
      const status = normalizeArticleStatus((req.body || {}).status);
      const category = normalizeArticleCategory((req.body || {}).category);
      const tags = normalizeArticleTags((req.body || {}).tags);

      if (!title || !content) {
        return res
          .status(400)
          .json({ ok: false, message: "Thiếu tiêu đề hoặc nội dung" });
      }

      if (title.length > 200) {
        return res
          .status(400)
          .json({ ok: false, message: "Tiêu đề quá dài (tối đa 200 ký tự)" });
      }

      const uploadedFile = req.file ? req.file.filename : null;
      const imageUrl = uploadedFile ? "articles/" + uploadedFile : null;

      const [result] = await db.query(
        "INSERT INTO articles (expert_id, title, content, image_url, status, category, tags) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [expertId, title, content, imageUrl, status, category, tags]
      );

      const articleId = result && result.insertId ? result.insertId : null;
      res.json({ ok: true, message: "Tạo bài viết thành công", article_id: articleId });
    } catch (error) {
      console.error("Create article error:", error);
      res
        .status(500)
        .json({ ok: false, message: "Lỗi server khi tạo bài viết" });
    }
  }
);

// Expert: danh sách bài viết của tôi
app.get("/expert/articles", authMiddleware, expertMiddleware, async (req, res) => {
  try {
    const expertId = req.user.id;
    const status = String(req.query.status || "").trim().toLowerCase();
    const category = String(req.query.category || "").trim();
    const author = String(req.query.author || "").trim();
    const q = String(req.query.q || "").trim();
    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();
    const params = [expertId];
    let sql = `SELECT a.id,
                      a.title,
                      a.content,
                      a.image_url,
                      a.status,
                      a.category,
                      a.tags,
                      a.created_at,
                      a.updated_at,
                      u.name AS expert_name
               FROM articles a
               JOIN users u ON a.expert_id = u.id
               WHERE a.expert_id = ?`;

    if (ARTICLE_STATUSES.includes(status)) {
      sql += " AND a.status = ?";
      params.push(status);
    }
    if (category) {
      sql += " AND a.category = ?";
      params.push(category);
    }
    if (author) {
      sql += " AND u.name = ?";
      params.push(author);
    }
    if (dateFrom) {
      sql += " AND DATE(a.created_at) >= ?";
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += " AND DATE(a.created_at) <= ?";
      params.push(dateTo);
    }
    if (q) {
      sql += " AND (a.title LIKE ? OR a.content LIKE ? OR a.tags LIKE ?)";
      params.push("%" + q + "%", "%" + q + "%", "%" + q + "%");
    }

    const [rows] = await db.query(
      sql + " ORDER BY a.created_at DESC",
      params
    );
    res.json({ ok: true, articles: rows });
  } catch (error) {
    console.error("Expert get articles error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lấy bài viết" });
  }
});

// Expert: chi tiết bài viết của tôi
app.get("/expert/articles/:id", authMiddleware, expertMiddleware, async (req, res) => {
  try {
    const expertId = req.user.id;
    const articleId = req.params.id;
    const [rows] = await db.query(
      `SELECT a.id, a.title, a.content, a.image_url, a.status, a.category, a.tags, a.created_at, a.updated_at,
              u.name AS expert_name
       FROM articles a
       JOIN users u ON a.expert_id = u.id
       WHERE a.id = ? AND a.expert_id = ?
       LIMIT 1`,
      [articleId, expertId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy bài viết" });
    }
    res.json({ ok: true, article: rows[0] });
  } catch (error) {
    console.error("Expert get article detail error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi lấy chi tiết bài viết" });
  }
});

app.delete("/expert/articles/:id", authMiddleware, expertMiddleware, async (req, res) => {
  try {
    const expertId = req.user.id;
    const articleId = req.params.id;

    const [rows] = await db.query(
      "SELECT id, image_url FROM articles WHERE id = ? AND expert_id = ? LIMIT 1",
      [articleId, expertId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy bài viết" });
    }

    const imageUrl = String(rows[0].image_url || "").trim();

    await db.query("DELETE FROM articles WHERE id = ? AND expert_id = ?", [articleId, expertId]);

    try {
      if (imageUrl && imageUrl.startsWith("articles/")) {
        const fileName = path.basename(imageUrl);
        const filePath = path.join(ARTICLES_UPLOAD_DIR, fileName);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    } catch (_) {}

    res.json({ ok: true, message: "Đã xóa bài viết" });
  } catch (error) {
    console.error("Delete article error:", error);
    res.status(500).json({ ok: false, message: "Lỗi server khi xóa bài viết" });
  }
});

// Expert: cập nhật bài viết (đổi cover)
app.put(
  "/expert/articles/:id",
  authMiddleware,
  expertMiddleware,
  uploadArticleImage.single("image"),
  async (req, res) => {
    try {
      const expertId = req.user.id;
      const articleId = req.params.id;
      const { title, content, image_url } = req.body || {};
      const status = normalizeArticleStatus((req.body || {}).status);
      const category = normalizeArticleCategory((req.body || {}).category);
      const tags = normalizeArticleTags((req.body || {}).tags);

      const [rows] = await db.query(
        "SELECT id, image_url FROM articles WHERE id = ? AND expert_id = ? LIMIT 1",
        [articleId, expertId]
      );
      if (rows.length === 0) {
        return res.status(404).json({ ok: false, message: "Không tìm thấy bài viết" });
      }

      const uploadedFile = req.file ? req.file.filename : null;
      const finalImage = uploadedFile
        ? "articles/" + uploadedFile
        : (image_url || rows[0].image_url || "").trim();

      if (!title || !content) {
        return res.status(400).json({ ok: false, message: "Thiếu tiêu đề hoặc nội dung" });
      }

      await db.query(
        "UPDATE articles SET title = ?, content = ?, image_url = ?, status = ?, category = ?, tags = ? WHERE id = ?",
        [title, content, finalImage, status, category, tags, articleId]
      );

      res.json({ ok: true, message: "Cập nhật bài viết thành công", image_url: finalImage });
    } catch (error) {
      console.error("Expert update article error:", error);
      res.status(500).json({ ok: false, message: "Lỗi server khi cập nhật bài viết" });
    }
  }
);


app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

initDbSchema();
