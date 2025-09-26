// controllers/exams.js
const fs = require("fs");
const path = require("path");
const { Document, Packer, Paragraph, TextRun } = require("docx");
const archiver = require("archiver");
const _ = require("lodash");
const multer = require("multer");
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

// ===== Helper: Đọc XML từ file .docx =====
async function extractDocxXML(docxPath) {
  const zip = new AdmZip(docxPath);
  const xml = zip.readAsText("word/document.xml", "utf8");
  const parser = new xml2js.Parser({
    explicitArray: false,
    mergeAttrs: true,
  });
  return parser.parseStringPromise(xml);
}

// ===== Helper: Phân tích một paragraph (<w:p>) trong XML =====
function parseParagraph(p) {
  let runs = _.get(p, "w:r", []);
  if (!Array.isArray(runs)) {
    runs = [runs];
  }

  let plainText = "";
  let hasFormatting = false;

  runs.forEach((r) => {
    const w_t = _.get(r, "w:t", "");
    const text = typeof w_t === "string" ? w_t : _.get(w_t, "_", "");
    plainText += text;

    if (!hasFormatting) {
      const rPr = _.get(r, "w:rPr", {});
      const isBold = _.get(rPr, "w:b") !== undefined;
      const isUnderlined = _.get(rPr, "w:u") !== undefined;
      const isHighlighted = _.get(rPr, "w:highlight") !== undefined;
      const isRedColor =
        _.get(rPr, "w:color.w:val", "").toLowerCase() === "ff0000";

      if (isBold || isUnderlined || isHighlighted || isRedColor) {
        hasFormatting = true;
      }
    }
  });

  return {
    text: plainText.trim(),
    hasFormatting: hasFormatting,
    runs: runs, // Trả về runs để phân tích định dạng chi tiết hơn
  };
}

// ===== Helper: Parse questions từ XML của docx (Logic đã được FIX) =====
async function parseDocxQuestions(docxPath) {
  const docx = await extractDocxXML(docxPath);
  const paragraphs = _.get(docx, "w:document.w:body.w:p", []);

  const questions = [];
  let currentQ = null;

  for (const p of paragraphs) {
    const { text, runs } = parseParagraph(p); // Lấy cả runs
    if (!text) continue;

    const isNewQuestion = /^Câu\s*\d+[.:\)]\s*/i.test(text); // Regex mới: bắt đầu bằng A, B, C... theo sau là chấm hoặc ngoặc đóng
    const isAnswerLine = /^[A-Z][.:\)]\s*/.test(text);

    if (isNewQuestion) {
      if (currentQ) {
        questions.push(currentQ);
      }
      currentQ = {
        question: text.replace(/^Câu\s*\d+[.:\)]\s*/i, "").trim(),
        answers: [],
        correct: -1,
      };
    } else if (isAnswerLine && currentQ) {
      // ---------------- LOGIC ĐÃ FIX HOÀN TOÀN ----------------
      // Regex để tìm tất cả các lựa chọn đáp án: [A-Z][.:)] và tất cả ký tự cho đến
      // khi gặp ký hiệu đáp án tiếp theo hoặc hết dòng.
      // Pattern: (([A-Z][.:\)])(\s*.*?))(?=\s*[B-Z][.:\)]|$)
      // Giải thích:
      // [A-Z][.:\)]: Bắt đầu bằng A, B... theo sau là chấm hoặc ngoặc đóng
      // (\s*.*?): Bắt bất kỳ ký tự nào, kể cả khoảng trắng, cho đến...
      // (?=\s*[B-Z][.:\)]|$): ...trước khi gặp ký hiệu đáp án tiếp theo hoặc cuối chuỗi.

      const answerRegex = /([A-Z][.:\)]\s*.*?)(\s*(?=[B-Z][.:\)]|$))/g; // Sử dụng .match() để lấy tất cả các lựa chọn
      const rawAnswerParts = text.match(answerRegex);

      if (!rawAnswerParts || rawAnswerParts.length === 0) continue; // Xử lý tách câu trả lời và tìm đáp án đúng (logic này cần được làm lại // để sử dụng kết quả match) // Bước 1: Chuẩn bị map định dạng từ runs

      let fullTextFromRuns = "";
      const formatMap = new Map();
      let charIndex = 0;

      for (const r of runs) {
        const rPr = _.get(r, "w:rPr", {});
        const isBold = _.get(rPr, "w:b") !== undefined;
        const isCorrectFormat = isBold; // Giả định đáp án đúng được BOLD

        const runText =
          typeof r["w:t"] === "string" ? r["w:t"] : _.get(r, "w:t._", "");

        for (let i = 0; i < runText.length; i++) {
          formatMap.set(charIndex, isCorrectFormat);
          charIndex++;
        }
        fullTextFromRuns += runText;
      } // Bước 2: Thêm đáp án vào mảng và kiểm tra định dạng

      for (const part of rawAnswerParts) {
        const cleanPart = part.trim(); // Loại bỏ ký hiệu đáp án (A., B., ...) để lấy nội dung
        const answerText = cleanPart.replace(/^[A-Z][.:\)]\s*/, "").trim();
        if (answerText) {
          // Chỉ thêm đáp án nếu không phải chuỗi rỗng
          currentQ.answers.push(answerText);
        } else {
          continue; // Bỏ qua nếu nội dung đáp án là rỗng
        } // Kiểm tra định dạng (tìm đáp án đúng) // 1. Tìm vị trí của ký hiệu đáp án trong fullTextFromRuns

        const answerMarkerMatch = cleanPart.match(/^[A-Z][.:\)]/);
        if (!answerMarkerMatch) continue;
        const answerMarker = answerMarkerMatch[0]; // 2. Lấy vị trí bắt đầu của toàn bộ phần đáp án trong text gốc (và fullTextFromRuns)
        const partStartIndex = fullTextFromRuns.indexOf(part.trim()); // Dùng trim() để khớp

        if (partStartIndex === -1) continue; // 3. Tìm index của ký tự đầu tiên của nội dung đáp án (sau A., B., ...)

        let checkIndex = -1;
        const startSearchIndex = partStartIndex + answerMarker.length; // Lặp qua để bỏ qua các khoảng trắng/tab/xuống dòng
        for (let i = startSearchIndex; i < fullTextFromRuns.length; i++) {
          // Kiểm tra xem ký tự này có phải là một phần của 'part' hay không
          // và có phải là ký tự không phải khoảng trắng không
          if (fullTextFromRuns[i].trim() !== "") {
            checkIndex = i;
            break;
          }
        }

        if (
          checkIndex !== -1 &&
          formatMap.get(checkIndex) &&
          currentQ.correct === -1
        ) {
          currentQ.correct = currentQ.answers.length - 1;
        }
      }
    } else if (currentQ && currentQ.answers.length === 0) {
      // Ghép nội dung cho câu hỏi nhiều dòng
      currentQ.question += " " + text;
    }
  }

  if (currentQ) {
    questions.push(currentQ);
  }

  console.log(questions);
  return questions;
}

// ===== Sinh file Word (Không đổi) =====
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
          indent: { left: 720 },
        })
      );
    });
    children.push(new Paragraph(""));
  });

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buffer);
}

// ===== Controller (Không đổi) =====
const generateExams = [
  upload.single("file"),
  async (req, res) => {
    let outDir = null;
    let uploadedFilePath = req.file ? req.file.path : null;

    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "No file uploaded" });
      }

      const numFiles = Math.max(1, parseInt(req.body.numFiles || "1", 10));

      const questions = await parseDocxQuestions(uploadedFilePath);

      if (questions.length === 0) {
        return res.status(400).json({
          success: false,
          message:
            "Không tìm thấy câu hỏi nào trong file. Vui lòng kiểm tra định dạng.",
        });
      }

      const answerKeys = [];

      const runId = Date.now() + "-" + Math.round(Math.random() * 10000);
      outDir = path.join("uploads", "output", runId);
      fs.mkdirSync(outDir, { recursive: true });

      const zipName = `DeThi_${runId}.zip`;
      const zipPath = path.join(outDir, zipName);
      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.pipe(output);

      const filesToCleanup = [];

      for (let i = 1; i <= numFiles; i++) {
        const shuffledQuestions = _.shuffle(questions).map((q) => {
          const originalCorrectAnswer = q.answers[q.correct];
          const shuffledAnswers = _.shuffle(q.answers);
          const newCorrectIndex = shuffledAnswers.indexOf(
            originalCorrectAnswer
          );

          return {
            question: q.question,
            answers: shuffledAnswers,
            correct: newCorrectIndex,
          };
        });

        const examFileName = `De_so_${i}.docx`;
        const examFilePath = path.join(outDir, examFileName);
        await createExamFile(shuffledQuestions, examFilePath);
        archive.file(examFilePath, { name: examFileName });
        filesToCleanup.push(examFilePath);

        const answers = { "Mã đề": `De_so_${i}` };
        shuffledQuestions.forEach((q, qIndex) => {
          const correctLetter =
            q.correct >= 0 ? String.fromCharCode(65 + q.correct) : "N/A";
          answers[`Câu ${qIndex + 1}`] = correctLetter;
        });
        answerKeys.push(answers);
      }

      const answerKeysWS = xlsx.utils.json_to_sheet(answerKeys);
      const answerKeysWB = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(answerKeysWB, answerKeysWS, "Đáp án");
      const answerKeysFilePath = path.join(outDir, `Dap_an_tong_hop.xlsx`);
      xlsx.writeFile(answerKeysWB, answerKeysFilePath);
      archive.file(answerKeysFilePath, { name: `Dap_an_tong_hop.xlsx` });
      filesToCleanup.push(answerKeysFilePath);

      await archive.finalize();

      output.on("close", () => {
        res.download(zipPath, zipName, (err) => {
          if (err) {
            console.error("Lỗi khi tải file zip:", err);
          }
          fs.unlinkSync(uploadedFilePath);
          filesToCleanup.forEach((filePath) => fs.unlinkSync(filePath));
          fs.rmSync(outDir, { recursive: true, force: true });
        });
      });
    } catch (err) {
      console.error("[exams] error:", err);
      res.status(500).json({ success: false, message: "Server error" });
      if (uploadedFilePath) {
        fs.unlink(uploadedFilePath, () => {});
      }
      if (outDir) {
        fs.rm(outDir, { recursive: true, force: true }, () => {});
      }
    }
  },
];

module.exports = generateExams;
