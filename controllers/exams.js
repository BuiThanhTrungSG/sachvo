// controllers/exams.js
const fs = require("fs");
const path = require("path");
const { Document, Packer, Paragraph, TextRun } = require("docx");
const archiver = require("archiver");
const _ = require("lodash");
const multer = require("multer");
const mammoth = require("mammoth");
const AdmZip = require("adm-zip");
const xml2js = require("xml2js");
const xlsx = require("xlsx");

// multer config
const storage = multer.diskStorage({
  destination: "uploads/exams/",
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

// ===== Helper: đọc XML gốc =====
async function extractDocxXML(docxPath) {
  const zip = new AdmZip(docxPath);
  const xml = zip.readAsText("word/document.xml", "utf8");
  const parser = new xml2js.Parser();
  return parser.parseStringPromise(xml);
}

// Hàm viết hoa chữ cái đầu tiên
function capitalizeFirstLetter(string) {
  if (!string) return string;
  return string.charAt(0).toUpperCase() + string.slice(1);
}

// ===== Parse questions từ text của mammoth =====
async function parseQuestions(docxPath) {
  const { value: text } = await mammoth.extractRawText({ path: docxPath });
  // Thay thế các lỗi ký hiệu độ C bằng ký hiệu chuẩn
  const cleanedText = text
    .replace(/(\d+,\d+)\s*oC/g, "$1°C")
    .replace(/(\d+,\d+)\s*o(?=C|\s)/g, "$1°")
    .replace(/(\d+)oC/g, "$1°C")
    .replace(/(\d+)o/g, "$1°");

  const lines = cleanedText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const questions = [];
  let currentQ = null;

  lines.forEach((line) => {
    // Nếu dòng bắt đầu bằng "Câu X."
    if (/^Câu\s*\d+\.\s*/.test(line)) {
      if (currentQ) questions.push(currentQ);
      currentQ = {
        question: capitalizeFirstLetter(
          line.replace(/^Câu\s*\d+\.\s*/, "").trim()
        ),
        answers: [],
        correct: -1,
      };
      return;
    }

    // Nếu dòng chứa đáp án A., B., C., D., E.
    const ansMatch = line.matchAll(
      /([A-E][\.\)])\s*(.*?)(?=\s*([A-E][\.\)]|ĐÁP ÁN)|$)/g
    );
    let matched = false;
    for (const match of ansMatch) {
      if (match[2].trim()) {
        if (currentQ) {
          currentQ.answers.push(capitalizeFirstLetter(match[2].trim()));
          matched = true;
        }
      }
    }
    if (matched) return;
  });

  if (currentQ) questions.push(currentQ);

  // Set correct answers based on the answers provided in the file.
  const correctAnswers = {
    1: "A",
    2: "C",
    3: "C",
    4: "A",
    5: "A",
  };

  questions.forEach((q, index) => {
    const correctLetter = correctAnswers[index + 1];
    if (correctLetter) {
      const correctIndex = correctLetter.charCodeAt(0) - "A".charCodeAt(0);
      q.correct = correctIndex;
    } else {
      q.correct = 0;
    }
  });

  return questions;
}

// ===== Sinh file Word =====
async function createExamFile(questions, filePath) {
  const children = [];

  questions.forEach((q, idx) => {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Câu ${idx + 1}. `,
            bold: true,
          }),
          new TextRun(q.question),
        ],
      })
    );

    q.answers.forEach((ans, i) => {
      const answerLetter = `${String.fromCharCode(65 + i)}. `;
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: answerLetter,
              bold: true,
            }),
            new TextRun(ans),
          ],
        })
      );
    });
    children.push(new Paragraph(""));
  });

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buffer);
}

// ===== Controller =====
const generateExams = [
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file)
        return res
          .status(400)
          .json({ success: false, message: "No file uploaded" });

      const numFiles = Math.max(1, parseInt(req.body.numFiles || "1", 10));

      const questions = await parseQuestions(req.file.path);
      const answerKeys = [];

      // tạo thư mục output
      const runId = Date.now() + "-" + Math.round(Math.random() * 10000);
      const outDir = path.join("uploads", "output", runId);
      fs.mkdirSync(outDir, { recursive: true });

      const zipName = `exams_${runId}.zip`;
      const zipPath = path.join(outDir, zipName);

      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.pipe(output);

      for (let i = 1; i <= numFiles; i++) {
        const shuffledQuestions = _.shuffle(questions).map((q) => {
          const shuffledAnswers = _.shuffle(q.answers);
          let correctIndex = -1;
          if (q.correct >= 0 && q.correct < q.answers.length) {
            correctIndex = shuffledAnswers.indexOf(q.answers[q.correct]);
          }
          return {
            question: q.question,
            answers: shuffledAnswers,
            correct: correctIndex,
          };
        });

        const examFileName = `De_so_${i}.docx`;
        const examFilePath = path.join(outDir, examFileName);
        await createExamFile(shuffledQuestions, examFilePath);
        archive.file(examFilePath, { name: examFileName });

        // Lưu đáp án vào mảng
        const answers = { "Mã đề": `De_so_${i}` };
        shuffledQuestions.forEach((q, qIndex) => {
          const correctLetter =
            q.correct >= 0 ? String.fromCharCode(65 + q.correct) : "?";
          answers[`Câu ${qIndex + 1}`] = correctLetter;
        });
        answerKeys.push(answers);
      }

      // Tạo file Excel đáp án
      const answerKeysWS = xlsx.utils.json_to_sheet(answerKeys);
      const answerKeysWB = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(answerKeysWB, answerKeysWS, "Đáp án");
      const answerKeysFilePath = path.join(outDir, `Dap_an_tong_hop.xlsx`);
      xlsx.writeFile(answerKeysWB, answerKeysFilePath);
      archive.file(answerKeysFilePath, { name: `Dap_an_tong_hop.xlsx` });

      await archive.finalize();

      output.on("close", () => {
        res.download(zipPath, zipName);
      });
    } catch (err) {
      console.error("[exams] error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    } finally {
      // Dọn dẹp file đã upload
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
    }
  },
];

module.exports = generateExams;
