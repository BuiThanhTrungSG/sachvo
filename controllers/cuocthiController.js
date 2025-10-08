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
// Hàm tiện ích để xóa file một cách an toàn
// const deleteFile = (filePath) => {
//   if (!filePath) return;
//   const fullPath = path.resolve(filePath);
//   fs.unlink(fullPath, (err) => {
//     if (err) console.error(`Failed to delete file: ${fullPath}`, err);
//   });
// };

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
    donvi,
    socauhoi,
  } = req.body;
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
         (tieude, image, batdau, ketthuc, ngaysinh, diachi, sodienthoai, email, cancuoc, noilamviec, xemdiem, xemdapan, daodapan, password, thoigian, nguoidung, donvi, socauhoi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        donvi || null,
        socauhoi || 0,
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
  const { userId } = req.query; // lấy từ query string
  try {
    const [rows] = await connection.query(
      "SELECT id, tieude, image, ngaytao, batdau, ketthuc, donvi FROM cuocthi WHERE nguoidung=? ORDER BY id DESC",
      [userId]
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
  const { userId } = req.query; // lấy từ query string

  try {
    const [ctRows] = await connection.query(
      "SELECT * FROM cuocthi WHERE id=? AND nguoidung=?",
      [id, userId]
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

// ============ GET VAO THI ============
const getVaoThi = async (req, res) => {
  const { id } = req.params;

  try {
    const [ctRows] = await connection.query(
      "SELECT id, tieude, image, batdau, ketthuc, ngaysinh, diachi, sodienthoai, email, cancuoc, noilamviec, xemdiem, xemdapan, password, thoigian, donvi, socauhoi FROM cuocthi WHERE id=?",
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
  const { id: cuocthiId } = req.params; // Lấy ID cuộc thi từ URL
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
    donvi,
    socauhoi,
  } = req.body;

  // Parse dữ liệu mảng từ FormData
  const questions = req.body.questions ? JSON.parse(req.body.questions) : [];
  const workplaces = req.body.workplaces ? JSON.parse(req.body.workplaces) : [];

  // Lấy đường dẫn file ảnh mới (nếu có)
  const newImagePath = req.file ? "uploads/cuocthi/" + req.file.filename : null;

  const conn = await connection.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Lấy đường dẫn ảnh cũ để xóa sau này nếu có ảnh mới
    const [[existingCuocthi]] = await conn.query(
      "SELECT image FROM cuocthi WHERE id = ?",
      [cuocthiId]
    );
    if (!existingCuocthi) {
      throw new Error("Contest not found");
    }
    const oldImagePath = existingCuocthi.image;

    // Xác định đường dẫn ảnh cuối cùng để lưu vào DB
    const finalImagePath = newImagePath || oldImagePath;

    // 2. Cập nhật bảng `cuocthi`
    await conn.query(
      `UPDATE cuocthi SET 
        tieude = ?, image = ?, batdau = ?, ketthuc = ?, ngaysinh = ?, diachi = ?, sodienthoai = ?, 
        email = ?, cancuoc = ?, noilamviec = ?, xemdiem = ?, xemdapan = ?, daodapan = ?, 
        password = ?, thoigian = ?, nguoidung = ?, donvi = ?, socauhoi = ?
      WHERE id = ?`,
      [
        tieude,
        finalImagePath,
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
        donvi || null,
        socauhoi || 0,
        cuocthiId,
      ]
    );

    // 3. Xóa các dữ liệu liên quan cũ (câu hỏi, đáp án, nơi làm việc)
    // Cần xóa đáp án trước khi xóa câu hỏi để không vi phạm foreign key
    await conn.query(
      `DELETE d FROM dapan d JOIN cauhoi c ON d.id_cauhoi = c.id WHERE c.id_cuocthi = ?`,
      [cuocthiId]
    );
    await conn.query("DELETE FROM cauhoi WHERE id_cuocthi = ?", [cuocthiId]);
    await conn.query("DELETE FROM noilamviec WHERE id_cuocthi = ?", [
      cuocthiId,
    ]);

    // 4. Thêm lại dữ liệu nơi làm việc (giống hệt hàm create)
    for (let wp of workplaces) {
      if (wp && wp.trim() !== "") {
        await conn.query(
          "INSERT INTO noilamviec (id_cuocthi, tennoilamviec) VALUES (?, ?)",
          [cuocthiId, wp]
        );
      }
    }

    // 5. Thêm lại dữ liệu câu hỏi và đáp án (giống hệt hàm create)
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

    // Nếu mọi thứ thành công, commit transaction
    await conn.commit();

    // Xóa ảnh cũ nếu đã tải lên ảnh mới thành công
    if (newImagePath && oldImagePath) {
      deleteFile(oldImagePath);
    }

    res.json({ success: true, cuocthiId: parseInt(cuocthiId) });
  } catch (err) {
    // Nếu có lỗi, rollback tất cả thay đổi
    await conn.rollback();

    // Xóa file mới đã upload nếu có lỗi xảy ra
    if (newImagePath) {
      deleteFile(newImagePath);
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

module.exports = {
  createCuocthi,
  updateCuocthi,
  getCuocthiList,
  getCuocthiById,
  deleteCuocthi,
  getVaoThi,
};
