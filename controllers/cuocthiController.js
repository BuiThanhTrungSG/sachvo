const connection = require("../config/database");

// ============ CREATE CUOCTHI ============
const createCuocthi = async (req, res) => {
  const {
    tieude,
    image,
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
    questions = [],
    workplaces = [],
  } = req.body;

  const conn = await connection.getConnection();
  try {
    await conn.beginTransaction();

    // Insert cuocthi
    const [result] = await conn.query(
      `INSERT INTO cuocthi 
        (tieude, image, batdau, ketthuc, ngaysinh, diachi, sodienthoai, email, cancuoc, noilamviec, xemdiem, xemdapan, daodapan, password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tieude,
        image || null,
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
      ]
    );

    const cuocthiId = result.insertId;

    // Insert workplaces
    for (let wp of workplaces) {
      if (wp && wp.trim() !== "") {
        await conn.query(
          "INSERT INTO noilamviec (id_cuocthi, tennoilamviec) VALUES (?, ?)",
          [cuocthiId, wp]
        );
      }
    }

    // Insert questions & answers
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
    image,
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
    questions = [],
    workplaces = [],
  } = req.body;

  const conn = await connection.getConnection();
  try {
    await conn.beginTransaction();

    // Update main
    await conn.query(
      `UPDATE cuocthi SET tieude=?, image=?, batdau=?, ketthuc=?, ngaysinh=?, diachi=?, sodienthoai=?, email=?, cancuoc=?, noilamviec=?, xemdiem=?, xemdapan=?, daodapan=?, password=? WHERE id=?`,
      [
        tieude,
        image || null,
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
        id,
      ]
    );

    // Xóa workplaces cũ
    await conn.query("DELETE FROM noilamviec WHERE id_cuocthi=?", [id]);
    // Thêm workplaces mới
    for (let wp of workplaces) {
      if (wp && wp.trim() !== "") {
        await conn.query(
          "INSERT INTO noilamviec (id_cuocthi, tennoilamviec) VALUES (?, ?)",
          [id, wp]
        );
      }
    }

    // Xóa questions + answers cũ
    const [oldQs] = await conn.query(
      "SELECT id FROM cauhoi WHERE id_cuocthi=?",
      [id]
    );
    for (let q of oldQs) {
      await conn.query("DELETE FROM dapan WHERE id_cauhoi=?", [q.id]);
    }
    await conn.query("DELETE FROM cauhoi WHERE id_cuocthi=?", [id]);

    // Thêm lại questions + answers mới
    for (let q of questions) {
      if (!q.text || q.text.trim() === "") continue;

      const [qResult] = await conn.query(
        "INSERT INTO cauhoi (id_cuocthi, cauhoi, nhieudapan) VALUES (?, ?, ?)",
        [id, q.text, q.multiCorrect ? 1 : 0]
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
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
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

    // Xóa answers trước
    const [qs] = await conn.query("SELECT id FROM cauhoi WHERE id_cuocthi=?", [
      id,
    ]);
    for (let q of qs) {
      await conn.query("DELETE FROM dapan WHERE id_cauhoi=?", [q.id]);
    }

    // Xóa questions
    await conn.query("DELETE FROM cauhoi WHERE id_cuocthi=?", [id]);

    // Xóa workplaces
    await conn.query("DELETE FROM noilamviec WHERE id_cuocthi=?", [id]);

    // Xóa cuocthi
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
  getCuocthiList,
  getCuocthiById,
  updateCuocthi,
  deleteCuocthi,
};
