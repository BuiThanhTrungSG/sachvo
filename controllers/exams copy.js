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

// ===== Helper: Phân tích một paragraph (<w:p>) trong XML (Không đổi) =====
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
    runs: runs,
  };
}

// ===== Helper: Parse questions từ XML của docx (Không đổi) =====
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
      const answerRegex = /([A-Z][.:\)]\s*.*?)(\s*(?=[B-Z][.:\)]|$))/g;
      const rawAnswerParts = text.match(answerRegex);

      if (!rawAnswerParts || rawAnswerParts.length === 0) continue;

      let fullTextFromRuns = "";
      const formatMap = new Map();
      let charIndex = 0;

      for (const r of runs) {
        const rPr = _.get(r, "w:rPr", {});
        const isBold = _.get(rPr, "w:b") !== undefined;
        const isCorrectFormat = isBold;

        const runText =
          typeof r["w:t"] === "string" ? r["w:t"] : _.get(r, "w:t._", "");

        for (let i = 0; i < runText.length; i++) {
          formatMap.set(charIndex, isCorrectFormat);
          charIndex++;
        }
        fullTextFromRuns += runText;
      }

      for (const part of rawAnswerParts) {
        const cleanPart = part.trim();

        const answerText = cleanPart.replace(/^[A-Z][.:\)]\s*/, "").trim();

        if (answerText) {
          currentQ.answers.push(answerText);
        } else {
          continue;
        }

        const answerMarkerMatch = cleanPart.match(/^[A-Z][.:\)]/);
        if (!answerMarkerMatch) continue;
        const answerMarker = answerMarkerMatch[0];

        const partStartIndex = fullTextFromRuns.indexOf(part.trim());

        if (partStartIndex === -1) continue;

        let checkIndex = -1;
        const startSearchIndex = partStartIndex + answerMarker.length;

        for (let i = startSearchIndex; i < fullTextFromRuns.length; i++) {
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
      currentQ.question += " " + text;
    }
  }

  if (currentQ) {
    questions.push(currentQ);
  }

  console.log(questions);
  return questions;
}

// ===== Helper: Sửa lỗi chính tả (Viết hoa sau dấu chấm) =====
function fixCapitalization(text) {
  if (!text) return "";

  // 1. Viết hoa ký tự đầu tiên của toàn bộ chuỗi (nếu có ký tự)
  text = text.charAt(0).toUpperCase() + text.slice(1);

  // 2. Viết hoa ký tự đầu tiên sau dấu chấm, chấm hỏi, chấm than (theo sau là khoảng trắng)
  // Regex: ([\.\?\!]\s+)([a-z])
  return text.replace(/([\.\?\!]\s*)([a-z])/g, (match, separator, letter) => {
    return separator + letter.toUpperCase();
  });
}

// ===== Sinh file Word (Đã thêm Sửa lỗi chính tả) =====
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

// ===== Controller (Đã thêm Tùy chọn đảo ngẫu nhiên) =====
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

      const numFiles = Math.max(1, parseInt(req.body.numFiles || "1", 10)); // Đọc tùy chọn từ frontend (giả sử gửi lên là chuỗi "true" hoặc "false")
      // const shouldShuffleQuestions = req.body.shuffleQuestions === "true";
      // const shouldShuffleAnswers = req.body.shuffleAnswers === "true";

      const shouldShuffleQuestions = true;
      const shouldShuffleAnswers = true;

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
        // Áp dụng đảo câu hỏi
        let shuffledQuestions = shouldShuffleQuestions
          ? _.shuffle(questions)
          : [...questions]; // Áp dụng đảo đáp án

        shuffledQuestions = shuffledQuestions.map((q) => {
          // Chỉ đảo đáp án nếu người dùng chọn
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
          return q; // Trả về câu hỏi không đảo nếu không chọn
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
