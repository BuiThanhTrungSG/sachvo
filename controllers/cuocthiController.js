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

const deleteFile2 = (relativePath) => {
  if (!relativePath) {
    return; // Thoát sớm nếu không có đường dẫn
  }

  // 1. Tạo đường dẫn tuyệt đối từ thư mục gốc của dự án.
  // Đây là cách làm đáng tin cậy nhất.
  const absolutePath = path.resolve(process.cwd(), relativePath);

  // 2. Sử dụng fs.unlink (bất đồng bộ) để xóa file.
  // Không cần kiểm tra fs.existsSync trước vì fs.unlink sẽ báo lỗi nếu file không tồn tại.
  fs.unlink(absolutePath, (err) => {
    if (err) {
      // Nếu lỗi là do file không tồn tại, có thể bỏ qua một cách an toàn.
      if (err.code === "ENOENT") {
        console.warn(`File không tồn tại để xóa: ${absolutePath}`);
      } else {
        // Ghi lại các lỗi khác (ví dụ: lỗi quyền truy cập).
        console.error(`Lỗi khi xóa file ${absolutePath}:`, err);
      }
    } else {
      console.log(`Đã xóa file cũ thành công: ${absolutePath}`);
    }
  });
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
      deleteFile2(oldImagePath);
    }

    res.json({ success: true, cuocthiId: parseInt(cuocthiId) });
  } catch (err) {
    // Nếu có lỗi, rollback tất cả thay đổi
    await conn.rollback();

    // Xóa file mới đã upload nếu có lỗi xảy ra
    if (newImagePath) {
      deleteFile2(newImagePath);
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

const postNopBaiThi = async (req, res) => {
  const {
    id_cuocthi,
    ngaysinh,
    diachi,
    sodienthoai,
    email,
    cancuoc,
    noilamviec,
    hoten,
    traloi, // Mảng các câu trả lời
    thoigianlam, // Thời gian làm bài (giây)
    diem, // ĐIỂM SỐ ĐÃ TÍNH SẴN TỪ FRONTEND (số nguyên)
  } = req.body;

  // Dữ liệu 'traloi' cần được chuyển thành JSON string để lưu vào cột 'traloi'
  const traloiJson = JSON.stringify(traloi);
  const conn = await connection.getConnection();

  try {
    await conn.beginTransaction();

    // LƯU BÀI THI VÀO DB
    // NOTE: Cột 'diem' trong bảng baithi là INT, cần đảm bảo giá trị gửi về là số.
    const scoreToSave = parseInt(diem, 10) || 0;

    const [result] = await conn.query(
      `INSERT INTO baithi (id_cuocthi, ngaysinh, diachi, sodienthoai, email, cancuoc, noilamviec, hoten, traloi, gionopbai, thoigianlam, diem)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
      [
        id_cuocthi,
        ngaysinh || null,
        diachi || null,
        sodienthoai || null,
        email || null,
        cancuoc || null,
        noilamviec || null,
        hoten || null,
        traloiJson,
        thoigianlam,
        scoreToSave, // Lưu điểm đã được frontend tính
      ]
    );

    await conn.commit();
    res.json({
      success: true,
      baithiId: result.insertId,
      diem: scoreToSave,
      tongcauhoi: traloi.length,
    });
  } catch (err) {
    await conn.rollback();
    console.error("putNopBaiThi error:", err);
    res.status(500).json({ error: "Lỗi nội bộ khi nộp bài thi." });
  } finally {
    conn.release();
  }
};

const getBangXepHangById = async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Kiểm tra xem cuộc thi có tồn tại bài thi nào không
    const [ctRows] = await connection.query(
      "SELECT id FROM baithi WHERE id_cuocthi=? LIMIT 1",
      [id]
    );
    if (ctRows.length === 0) {
      // Trả về mảng rỗng nếu không có ai thi
      return res.json({
        xepHangCaNhan: [],
        xepHangDonVi: [],
        tongSoCaNhan: 0,
        tongSoDonVi: 0,
      });
    }

    // --- ĐỊNH NGHĨA CÁC QUERY MỚI ĐỂ LẤY TỔNG SỐ ---

    // Query 1: Tổng số cá nhân tham gia
    const tongSoCaNhanQuery = `
            SELECT COUNT(id) AS total FROM baithi WHERE id_cuocthi = ?;
        `;

    // Query 2: Tổng số đơn vị có người tham gia (dùng DISTINCT)
    const tongSoDonViQuery = `
            SELECT COUNT(DISTINCT noilamviec) AS total FROM baithi WHERE id_cuocthi = ? AND noilamviec IS NOT NULL;
        `;

    // 2. Query để lấy bảng xếp hạng cá nhân (Giữ nguyên)
    const xepHangCaNhanQuery = `
            SELECT
                bt.hoten,
                bt.diem,
                nlv.tennoilamviec
            FROM
                baithi AS bt
            LEFT JOIN
                noilamviec AS nlv ON bt.noilamviec = nlv.id
            WHERE
                bt.id_cuocthi = ?
            ORDER BY
                bt.diem DESC,
                bt.thoigianlam ASC,
                bt.gionopbai ASC
            LIMIT 3;
        `;

    // 3. Query để lấy bảng xếp hạng đơn vị (Giữ nguyên)
    const xepHangDonViQuery = `
            SELECT
                nlv.tennoilamviec,
                COUNT(bt.id) AS soNguoiThamGia
            FROM
                baithi AS bt
            JOIN
                noilamviec AS nlv ON bt.noilamviec = nlv.id
            WHERE
                bt.id_cuocthi = ?
            GROUP BY
                nlv.id, nlv.tennoilamviec
            ORDER BY
                soNguoiThamGia DESC,
                MIN(bt.gionopbai) ASC
            LIMIT 3;
        `;

    // 4. Thực thi TẤT CẢ 4 query song song
    const [
      [xepHangCaNhan],
      [xepHangDonVi],
      [[{ total: tongSoCaNhan }]],
      [[{ total: tongSoDonVi }]],
    ] = await Promise.all([
      connection.query(xepHangCaNhanQuery, [id]),
      connection.query(xepHangDonViQuery, [id]),
      connection.query(tongSoCaNhanQuery, [id]),
      connection.query(tongSoDonViQuery, [id]),
    ]);

    // 5. Trả về kết quả cho frontend dưới dạng object
    res.json({ xepHangCaNhan, xepHangDonVi, tongSoCaNhan, tongSoDonVi });
  } catch (err) {
    console.error("getBangXepHangById error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const getKetQuaThiById = async (req, res) => {
  const { userId, page = 1 } = req.query; // lấy userId và số trang từ query
  const { id } = req.params;
  const limit = 10; // số bản ghi mỗi trang
  const offset = (page - 1) * limit;

  try {
    // Lấy dữ liệu phân trang
    const [rows] = await connection.query(
      "SELECT * FROM baithi WHERE nguoidung = ? AND id_cuocthi = ? LIMIT ? OFFSET ?",
      [userId, id, limit, offset]
    );

    // Lấy tổng số bản ghi để tính tổng số trang
    const [countResult] = await connection.query(
      "SELECT COUNT(*) AS total FROM baithi WHERE nguoidung = ? AND id_cuocthi = ?",
      [userId, id]
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      data: rows,
      pagination: {
        total,
        page: Number(page),
        totalPages,
        pageSize: limit,
      },
    });
  } catch (err) {
    console.error("getKetQuaThiById error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

module.exports = {
  createCuocthi,
  updateCuocthi,
  getCuocthiList,
  getCuocthiById,
  deleteCuocthi,
  getVaoThi,
  postNopBaiThi,
  getBangXepHangById,
  getKetQuaThiById,
};
