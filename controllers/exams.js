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

// multer config (Không đổi)
const storage = multer.diskStorage({
  destination: "uploads/exams/",
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

// ===== Helper: Đọc XML từ file .docx (Không đổi) =====
async function extractDocxXML(docxPath) {
  const zip = new AdmZip(docxPath);
  const xml = zip.readAsText("word/document.xml", "utf8");
  const parser = new xml2js.Parser({
    explicitArray: false,
    mergeAttrs: true,
  });
  return parser.parseStringPromise(xml);
}

// ===== Helper: Phân tích một paragraph (<w:p>) trong XML (Đã FIX triệt để lỗi ký hiệu) =====
function parseParagraph(p) {
  let runs = _.get(p, "w:r", []);
  if (!Array.isArray(runs)) {
    runs = [runs];
  }

  let plainText = "";
  const runFormats = [];

  runs.forEach((r) => {
    let text = _.get(r, "w:t", "");
    if (typeof text !== "string" && _.has(r, "w:t._")) {
      text = _.get(r, "w:t._", "");
    } else if (typeof text !== "string") {
      text = "";
    }

    // Thêm ký hiệu độ (degree sign) nếu nó là w:sym
    if (_.get(r, "w:sym.w:char") === "00B0") {
      text += "°";
    }

    plainText += text;

    const rPr = _.get(r, "w:rPr", {});
    const isBold = _.get(rPr, "w:b") !== undefined;

    runFormats.push({
      text: text,
      isBold: isBold,
    });
  }); // ------------------------ LOGIC CHUẨN HÓA KÝ HIỆU (Cải tiến mạnh mẽ) ------------------------ // 1. Chuẩn hóa 'o' hoặc '0' (số không) đứng trước 'C' hoặc 'F' thành ký hiệu độ. // Ví dụ: 80oC, 0,150C -> 80°C, 0,15°C

  plainText = plainText.replace(/([0-9.,])\s*([oO0])\s*([cCfF])/g, "$1°$3"); // 2. Fix lỗi thiếu 'C' sau ký hiệu độ (°) // Ví dụ: 0,01° -> 0,01°C

  plainText = plainText.replace(/([0-9.,])\s*(°)(?!\s*[CFK])/g, "$1°C"); // 3. Chuẩn hóa khoảng trắng thừa và ký tự 'K' bị mất // Ví dụ: -273 K. -> -273 K. (Nếu K. bị mất do lỗi parsing, ta không thể khôi phục 100%, // nhưng ta có thể đảm bảo K. không bị cắt sau số)

  plainText = plainText.replace(/([0-9.])\s*K\s*\./g, "$1 K.");
  plainText = plainText.replace(/([0-9.])\s*K\s*/g, "$1 K"); // Giữ K cách xa số // 4. Chuẩn hóa các ký hiệu độ C bị dính: 0C -> °C

  plainText = plainText.replace(/([0-9])C\b/g, "$1°C");

  return {
    text: plainText.trim(),
    runs: runFormats,
  };
}

// ===== Helper: Parse questions từ XML của docx (Không đổi logic parsing chính) =====
async function parseDocxQuestions(docxPath) {
  const docx = await extractDocxXML(docxPath);
  const paragraphs = _.get(docx, "w:document.w:body.w:p", []);

  const questions = [];
  let currentQ = null;

  for (const p of paragraphs) {
    const { text, runs } = parseParagraph(p);
    if (!text) continue;

    const isNewQuestion = /^Câu\s*\d+[.:\)]\s*/i.test(text);
    const isAnswerLine = /^[A-Z][.:\)]\s*/.test(text);

    // Tái tạo lại chuỗi text và map định dạng sau khi parseParagraph đã chuẩn hóa text
    let fullTextFromRuns = runs.map((r) => r.text).join("");
    const charFormatMap = [];
    runs.forEach((r) => {
      for (let i = 0; i < r.text.length; i++) {
        charFormatMap.push(r.isBold);
      }
    });

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
      const answerRegex = /([A-I][.:\)]\s*.*?)(\s*(?=[B-I][.:\)]|$))/g;
      const rawAnswerParts = text.match(answerRegex);

      if (!rawAnswerParts || rawAnswerParts.length === 0) continue;

      for (const part of rawAnswerParts) {
        const cleanPart = part.trim();

        let answerText = cleanPart.replace(/^[A-I][.:\)]\s*/, "").trim();

        if (answerText) {
          currentQ.answers.push(answerText);
        } else {
          continue;
        } // Logic kiểm tra BOLD toàn bộ (Giữ nguyên)

        const answerMarkerMatch = cleanPart.match(/^[A-I][.:\)]/);
        if (!answerMarkerMatch) continue;
        const answerMarker = answerMarkerMatch[0];

        let contentStartIndex = -1;
        let startSearchIndex =
          fullTextFromRuns.indexOf(answerMarker) + answerMarker.length;

        for (let i = startSearchIndex; i < fullTextFromRuns.length; i++) {
          if (fullTextFromRuns[i].trim() !== "") {
            contentStartIndex = i;
            break;
          }
        }

        if (contentStartIndex === -1) continue;

        let actualStartIndex = fullTextFromRuns.indexOf(
          answerText,
          contentStartIndex - 5
        );
        if (actualStartIndex === -1) {
          actualStartIndex = contentStartIndex;
        }

        let actualEndIndex = actualStartIndex + answerText.length;

        let isFullyBold = true;
        for (let i = actualStartIndex; i < actualEndIndex; i++) {
          if (fullTextFromRuns[i].trim() !== "" && !charFormatMap[i]) {
            isFullyBold = false;
            break;
          }
        }

        if (isFullyBold && currentQ.correct === -1) {
          currentQ.correct = currentQ.answers.length - 1;
        }
      }
    } else if (currentQ && currentQ.answers.length === 0) {
      currentQ.question += " " + text;
    }
  }

  if (currentQ) {
    questions.push(currentQ);
  }

  console.log(questions);
  return questions;
}

// ===== Helper: Sửa lỗi chính tả (Không đổi) =====
function fixCapitalization(text) {
  if (!text) return "";
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return text.replace(/([\.\?\!]\s*)([a-z])/g, (match, separator, letter) => {
    return separator + letter.toUpperCase();
  });
}

// ===== Sinh file Word (Không đổi) =====
async function createExamFile(questions, filePath) {
  const children = [];

  questions.forEach((q, idx) => {
    const fixedQuestion = fixCapitalization(q.question);
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Câu ${idx + 1}. `,
            bold: true,
          }),
          new TextRun(fixedQuestion),
        ],
      })
    );

    q.answers.forEach((ans, i) => {
      const answerLetter = `${String.fromCharCode(65 + i)}. `;
      const fixedAnswer = fixCapitalization(ans);

      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: answerLetter,
              bold: true,
            }),
            new TextRun(fixedAnswer),
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
      const shouldShuffleQuestions = req.body.shuffleQuestions === "true";
      const shouldShuffleAnswers = req.body.shuffleAnswers === "true";

      let questions = await parseDocxQuestions(uploadedFilePath);

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
        let shuffledQuestions = shouldShuffleQuestions
          ? _.shuffle(questions)
          : [...questions];

        shuffledQuestions = shuffledQuestions.map((q) => {
          if (shouldShuffleAnswers) {
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
          }
          return q;
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
