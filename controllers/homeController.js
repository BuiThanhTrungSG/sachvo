const connection = require("../config/database");

const products = async (req, res) => {
  try {
    // lấy query từ request (GET), fallback sang body nếu không có
    let page = parseInt(req.query.page || req.body.page || 1);
    let limit = parseInt(req.query.limit || req.body.limit || 10);
    let q = req.query.q || req.body.q || "";

    page = page < 1 ? 1 : page;
    limit = limit < 1 ? 10 : limit;
    const offset = (page - 1) * limit;

    let total = 0;
    let rows = [];

    // --- Đếm tổng số ---
    if (q !== "") {
      const [countResult] = await connection.execute(
        "SELECT COUNT(*) as cnt FROM products WHERE name LIKE ?",
        [`%${q}%`]
      );
      total = countResult[0].cnt;
    } else {
      const [countResult] = await connection.execute(
        "SELECT COUNT(*) as cnt FROM products"
      );
      total = countResult[0].cnt;
    }

    // --- Lấy danh sách ---
    let sql = `
      SELECT p.id, p.name, pi.image_path AS primary_thumbnail
      FROM products p
      LEFT JOIN product_images pi 
        ON pi.product_id = p.id AND pi.is_primary = 1
    `;
    let params = [];

    if (q !== "") {
      sql += " WHERE p.name LIKE ?";
      params.push(`%${q}%`);
    }

    sql += " ORDER BY p.id DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const [listResult] = await connection.execute(sql, params);
    rows = listResult;

    // trả về kết quả
    return res.status(200).json({
      success: true,
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      data: rows,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const fetchProductById = async (req, res) => {
  try {
    const id = parseInt(req.params.id); // lấy từ /api/products/:id
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    // --- Lấy thông tin product + category ---
    const [productResult] = await connection.execute(
      `
      SELECT p.*, c.name AS category
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = ?
      `,
      [id]
    );

    if (productResult.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }

    const product = productResult[0];

    // --- Lấy danh sách images ---
    const [imagesResult] = await connection.execute(
      `
      SELECT image_path, is_primary
      FROM product_images
      WHERE product_id = ?
      ORDER BY is_primary DESC, id ASC
      `,
      [id]
    );
    product.images = imagesResult;

    // --- Parse files_json nếu có ---
    if (product.files_json) {
      try {
        product.files = JSON.parse(product.files_json);
      } catch (e) {
        product.files = [];
      }
    }

    return res.status(200).json(product);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};

module.exports = {
  products,
  fetchProductById,
};
