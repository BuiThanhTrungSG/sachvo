const connection = require("../config/database");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");

const adminLogin = async (req, res) => {
  try {
    const { username, password } = req.body;

    const [result] = await connection.execute(
      `SELECT id, username, password_hash FROM admin_users WHERE username = ?`,
      [username]
    );

    const user = result[0];

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // so sánh mật khẩu nhập vào với hash trong DB
    const hash = user.password_hash.replace(/^\$2y\$/, "$2a$");

    const match = await bcrypt.compare(password, hash);
    if (!match) {
      return res.status(401).json({ error: "Mật khẩu không khớp" });
    }

    // tạo JWT token (giống PHP: hạn 6 tiếng)
    const token = jwt.sign(
      {
        sub: user.id,
        username: user.username,
        role: "admin",
      },
      process.env.JWT_SECRET || "your_jwt_secret", // giống $cfg['jwt_secret']
      { expiresIn: "6h" }
    );

    return res.json({ token });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const categories = async (req, res) => {
  try {
    const [rows] = await connection.query(
      "SELECT id, name FROM categories ORDER BY id ASC"
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const adminProducts = async (req, res) => {
  try {
    // lấy page & limit từ query, mặc định 1 và 10
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;

    // tổng số sản phẩm
    const [countResult] = await connection.query(
      "SELECT COUNT(*) AS total FROM products"
    );
    const total = countResult[0].total;

    // lấy danh sách sản phẩm kèm category
    const [rows] = await connection.query(
      `
      SELECT p.*, c.name AS category
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ORDER BY p.id DESC
      LIMIT ? OFFSET ?
    `,
      [limit, offset]
    );

    // gắn thêm ảnh cho từng sản phẩm
    for (let row of rows) {
      const [images] = await connection.query(
        `
        SELECT id, image_path, is_primary
        FROM product_images
        WHERE product_id = ?
        ORDER BY is_primary DESC, id ASC
      `,
        [row.id]
      );
      row.images = images;
      row.primary_thumbnail = images.length > 0 ? images[0].image_path : null;
    }

    // trả JSON kết quả
    res.json({
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      data: rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const adminDelete = async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    if (!id) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    // 1. Lấy danh sách ảnh để xóa file vật lý
    const [images] = await connection.query(
      "SELECT image_path FROM product_images WHERE product_id=?",
      [id]
    );

    images.forEach((img) => {
      if (img.image_path) {
        const filePath = path.join(__dirname, "..", img.image_path);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    });

    // 2. Lấy file sản phẩm (files_json)
    const [fileRows] = await connection.query(
      "SELECT files_json FROM products WHERE id=?",
      [id]
    );

    if (fileRows.length > 0 && fileRows[0].files_json) {
      const filePath = path.join(__dirname, "..", fileRows[0].files_json);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // 3. Xóa DB
    await connection.query("DELETE FROM product_images WHERE product_id=?", [
      id,
    ]);
    await connection.query("DELETE FROM products WHERE id=?", [id]);

    res.json({ success: true });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

const adminCreateProduct = async (req, res) => {
  try {
    // dữ liệu text trong FormData (req.body)
    const { name, price, short_description, long_description, category_id } =
      req.body;

    // file chính (nếu có)
    const file = req.files?.file ? req.files.file[0] : null;

    // JSON cho file chính (nếu cần lưu thêm metadata)

    const files_json = file ? "uploads/files/" + file.filename : null;

    // insert product
    const [result] = await connection.query(
      `INSERT INTO products
        (name, price, short_description, long_description, category_id, files_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        name,
        price || 0,
        short_description || "",
        long_description || "",
        category_id || null,
        files_json,
      ]
    );

    const productId = result.insertId;

    // insert ảnh sản phẩm (nhiều ảnh)
    if (req.files && req.files.images) {
      const images = req.files.images;
      for (let i = 0; i < images.length; i++) {
        const img = images[i];

        // lấy is_primary từ body (nếu có)
        const isPrimary = Array.isArray(req.body.is_primary)
          ? req.body.is_primary[i] || 0
          : req.body.is_primary || 0;

        await connection.query(
          `INSERT INTO product_images (product_id, image_path, is_primary)
           VALUES (?, ?, ?)`,
          [productId, "uploads/images/" + img.filename, isPrimary]
        );
      }
    }

    res.json({ success: true, product_id: productId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

module.exports = {
  adminLogin,
  categories,
  adminProducts,
  adminCreateProduct,
  adminDelete,
};
