const connection = require("../config/database");
const fs = require("fs");
const path = require("path");

// Hàm trợ giúp để xóa file vật lý một cách an toàn
const deleteFile = (filePath) => {
  if (filePath) {
    // Tạo đường dẫn tuyệt đối đến file
    const absolutePath = path.join(__dirname, "..", filePath);
    // Kiểm tra file có tồn tại không trước khi xóa
    if (fs.existsSync(absolutePath)) {
      try {
        fs.unlinkSync(absolutePath);
        console.log(`Đã xóa file: ${absolutePath}`);
      } catch (err) {
        console.error(`Lỗi khi xóa file ${absolutePath}:`, err);
      }
    }
  }
};

// ============ CREATE CUOCTHI ============
const createCuocthi = async (req, res) => {
  const {
    tieude,
    batdau,
    ketthuc,
    ngaysinh,
    diachi,
    sodienthoai,
    email,
    cancuoc,
    noilamviec,
    xemdiem,
    xemdapan,
    daodapan,
    password,
    thoigian,
    nguoidung,
  } = req.body;
  console.log(req.body);
  // Dữ liệu mảng/object từ FormData thường là JSON string, cần parse lại
  const questions = req.body.questions ? JSON.parse(req.body.questions) : [];
  const workplaces = req.body.workplaces ? JSON.parse(req.body.workplaces) : [];

  // Lấy đường dẫn file ảnh từ req.file (do middleware multer thêm vào)
  const imagePath = req.file ? "uploads/cuocthi/" + req.file.filename : null;

  const conn = await connection.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO cuocthi 
         (tieude, image, batdau, ketthuc, ngaysinh, diachi, sodienthoai, email, cancuoc, noilamviec, xemdiem, xemdapan, daodapan, password, thoigian, nguoidung)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tieude,
        imagePath, // Lưu đường dẫn tương đối vào DB
        batdau,
        ketthuc || null,
        ngaysinh || 0,
        diachi || 0,
        sodienthoai || 0,
        email || 0,
        cancuoc || 0,
        noilamviec || 0,
        xemdiem || 1,
        xemdapan || 1,
        daodapan || 1,
        password || null,
        thoigian || null,
        nguoidung || null,
      ]
    );

    const cuocthiId = result.insertId;

    for (let wp of workplaces) {
      if (wp && wp.trim() !== "") {
        await conn.query(
          "INSERT INTO noilamviec (id_cuocthi, tennoilamviec) VALUES (?, ?)",
          [cuocthiId, wp]
        );
      }
    }

    for (let q of questions) {
      if (!q.text || q.text.trim() === "") continue;
      const [qResult] = await conn.query(
        "INSERT INTO cauhoi (id_cuocthi, cauhoi, nhieudapan) VALUES (?, ?, ?)",
        [cuocthiId, q.text, q.multiCorrect ? 1 : 0]
      );
      const cauhoiId = qResult.insertId;
      for (let ans of q.answers) {
        if (!ans.text || ans.text.trim() === "") continue;
        await conn.query(
          "INSERT INTO dapan (id_cauhoi, dapan, dungsai) VALUES (?, ?, ?)",
          [cauhoiId, ans.text, ans.correct ? 1 : 0]
        );
      }
    }

    await conn.commit();
    res.json({ success: true, cuocthiId });
  } catch (err) {
    await conn.rollback();
    // Nếu có lỗi, xóa file đã upload để tránh rác
    if (imagePath) {
      deleteFile(imagePath);
    }
    console.error("createCuocthi error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    conn.release();
  }
};

// ============ GET LIST ============
const getCuocthiList = async (req, res) => {
  try {
    const [rows] = await connection.query(
      "SELECT id, tieude, image, ngaytao, batdau, ketthuc FROM cuocthi ORDER BY id DESC"
    );
    res.json(rows);
  } catch (err) {
    console.error("getCuocthiList error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// ============ GET DETAIL ============
const getCuocthiById = async (req, res) => {
  const { id } = req.params;
  console.log(id);
  try {
    const [ctRows] = await connection.query(
      "SELECT * FROM cuocthi WHERE id=?",
      [id]
    );
    if (ctRows.length === 0)
      return res.status(404).json({ error: "Cuộc thi không tồn tại" });

    const cuocthi = ctRows[0];

    // workplaces
    const [wps] = await connection.query(
      "SELECT id, tennoilamviec FROM noilamviec WHERE id_cuocthi=?",
      [id]
    );
    cuocthi.workplaces = wps;

    // questions + answers
    const [qs] = await connection.query(
      "SELECT * FROM cauhoi WHERE id_cuocthi=?",
      [id]
    );
    for (let q of qs) {
      const [as] = await connection.query(
        "SELECT * FROM dapan WHERE id_cauhoi=?",
        [q.id]
      );
      q.answers = as;
    }
    cuocthi.questions = qs;

    res.json(cuocthi);
  } catch (err) {
    console.error("getCuocthiById error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// ============ UPDATE ============
const updateCuocthi = async (req, res) => {
  const { id } = req.params;
  const {
    tieude,
    batdau,
    ketthuc,
    ngaysinh,
    diachi,
    sodienthoai,
    email,
    cancuoc,
    noilamviec,
    xemdiem,
    xemdapan,
    daodapan,
    password,
    thoigian,
    nguoidung,
  } = req.body;

  const questions = req.body.questions ? JSON.parse(req.body.questions) : [];
  const workplaces = req.body.workplaces ? JSON.parse(req.body.workplaces) : [];

  const conn = await connection.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Lấy thông tin ảnh cũ
    const [oldCuocthi] = await conn.query(
      "SELECT image FROM cuocthi WHERE id = ?",
      [id]
    );
    let imagePath = oldCuocthi.length > 0 ? oldCuocthi[0].image : null;

    // 2. Nếu có file mới được upload
    if (req.file) {
      // Xóa file ảnh cũ nếu có
      if (imagePath) {
        deleteFile(imagePath);
      }
      // Cập nhật đường dẫn ảnh mới
      imagePath = "uploads/cuocthi/" + req.file.filename;
    }

    // 3. Cập nhật thông tin cuộc thi
    await conn.query(
      `UPDATE cuocthi SET tieude=?, image=?, batdau=?, ketthuc=?, ngaysinh=?, diachi=?, sodienthoai=?, email=?, cancuoc=?, noilamviec=?, xemdiem=?, xemdapan=?, daodapan=?, password=?, thoigian=?, nguoidung=? WHERE id=?`,
      [
        tieude,
        imagePath,
        batdau,
        ketthuc || null,
        ngaysinh || 0,
        diachi || 0,
        sodienthoai || 0,
        email || 0,
        cancuoc || 0,
        noilamviec || 0,
        xemdiem || 1,
        xemdapan || 1,
        daodapan || 1,
        password || null,
        thoigian || null,
        nguoidung || null,
        id,
      ]
    );

    // 4. Xóa và thêm lại workplaces, questions (logic tương tự create)
    await conn.query("DELETE FROM noilamviec WHERE id_cuocthi=?", [id]);
    for (let wp of workplaces) {
      /* ... */
    }

    const [oldQs] = await conn.query(
      "SELECT id FROM cauhoi WHERE id_cuocthi=?",
      [id]
    );
    for (let q of oldQs) {
      await conn.query("DELETE FROM dapan WHERE id_cauhoi=?", [q.id]);
    }
    await conn.query("DELETE FROM cauhoi WHERE id_cuocthi=?", [id]);

    for (let q of questions) {
      /* ... */
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    // Nếu có lỗi và đã upload file mới, xóa file đó đi
    if (req.file) {
      deleteFile("uploads/cuocthi/" + req.file.filename);
    }
    console.error("updateCuocthi error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    conn.release();
  }
};

// ============ DELETE ============
const deleteCuocthi = async (req, res) => {
  const { id } = req.params;
  const conn = await connection.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Lấy đường dẫn ảnh của cuộc thi để xóa file
    const [rows] = await conn.query("SELECT image FROM cuocthi WHERE id = ?", [
      id,
    ]);
    if (rows.length > 0 && rows[0].image) {
      deleteFile(rows[0].image);
    }

    // 2. Xóa các dữ liệu liên quan trong DB
    const [qs] = await conn.query("SELECT id FROM cauhoi WHERE id_cuocthi=?", [
      id,
    ]);
    for (let q of qs) {
      await conn.query("DELETE FROM dapan WHERE id_cauhoi=?", [q.id]);
    }
    await conn.query("DELETE FROM cauhoi WHERE id_cuocthi=?", [id]);
    await conn.query("DELETE FROM noilamviec WHERE id_cuocthi=?", [id]);

    // 3. Xóa bản ghi cuộc thi
    await conn.query("DELETE FROM cuocthi WHERE id=?", [id]);

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error("deleteCuocthi error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    conn.release();
  }
};

// Các hàm getCuocthiList, getCuocthiById không thay đổi
// ...
module.exports = {
  createCuocthi,
  updateCuocthi,
  getCuocthiList,
  getCuocthiById,
  deleteCuocthi,
};
