// controllers/exams.js
const fs = require("fs");
const path = require("path");
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Alignment,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  VerticalAlign,
} = require("docx");
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

// ===== Helper: Phân tích một paragraph (<w:p>) trong XML (Không đổi) =====
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
  });

  plainText = plainText.replace(/([0-9.,])\s*([oO0])\s*([cCfF])/g, "$1°$3");
  plainText = plainText.replace(/([0-9.,])\s*(°)(?!\s*[CFK])/g, "$1°C");
  plainText = plainText.replace(/([0-9.])\s*K\s*\./g, "$1 K.");
  plainText = plainText.replace(/([0-9.])\s*K\s*/g, "$1 K");
  plainText = plainText.replace(/([0-9])C\b/g, "$1°C");

  return {
    text: plainText.trim(),
    runs: runFormats,
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
        }

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

// Lưu ý: Bạn cần chắc chắn rằng các thuộc tính như BorderStyle, WidthType, Alignment, Table, TableRow, TableCell, Paragraph, TextRun đã được import từ thư viện docx.

function createHeader(examIndex, numPages) {
  const maDe = String(examIndex).padStart(2, "0");
  const numPageText = numPages || "xx";

  // Định nghĩa viền MẶC ĐỊNH là ẩn
  const defaultBorders = {
    top: { style: BorderStyle.NONE, size: 0 },
    bottom: { style: BorderStyle.NONE, size: 0 },
    left: { style: BorderStyle.NONE, size: 0 },
    right: { style: BorderStyle.NONE, size: 0 },
    insideHorizontal: { style: BorderStyle.NONE, size: 0 },
    insideVertical: { style: BorderStyle.NONE, size: 0 },
  };

  // SỬA ĐỔI: Thêm tham số 'italics' (mặc định là false) vào centerPara
  const centerPara = (
    text,
    bold = false,
    italics = false,
    size = 22,
    spacingAfter = 0
  ) =>
    new Paragraph({
      children: [new TextRun({ text, bold, italics, size })], // Áp dụng 'italics'
      alignment: "center",
      spacing: { after: spacingAfter },
    });

  const fullCenterCell = (children, width, properties = {}) =>
    new TableCell({
      children: Array.isArray(children) ? children : [children],
      // Sử dụng defaultBorders (viền ẩn) cho hầu hết các ô
      borders: defaultBorders,
      width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
      ...properties,
    });

  const studentNameText =
    "Họ và tên:..........................................................";
  const studentClassText =
    "Lớp:...................................................................";

  // Bắt đầu cấu trúc một bảng duy nhất
  const rows = [
    new TableRow({
      children: [
        fullCenterCell(
          centerPara("SỞ GD & ĐT TP HỒ CHÍ MINH", false, false, 22),
          35
        ),
        fullCenterCell(centerPara("ĐỀ KIỂM TRA CUỐI KỲ", true, false, 22), 65),
      ],
    }),

    // ... (Các Row khác không thay đổi)

    new TableRow({
      children: [
        fullCenterCell(
          centerPara("TRƯỜNG THPT TRƯỜNG CHINH", true, false, 22),
          35
        ),
        fullCenterCell(centerPara("MÔN: VẬT LÍ", true, false, 22), 65),
      ],
    }),

    new TableRow({
      children: [
        fullCenterCell(centerPara("", true, false, 22), 35),
        fullCenterCell(centerPara("", true, false, 22), 65),
      ],
    }),

    new TableRow({
      children: [
        fullCenterCell(
          centerPara(`(Đề thi có ${numPageText} trang)`, false, false, 22),
          35
        ),
        fullCenterCell(
          centerPara("Thời gian làm bài: 45 PHÚT", false, false, 22),
          65
        ),
      ],
    }),

    new TableRow({
      children: [
        fullCenterCell(centerPara(``, false, false, 22), 35),
        // SỬA ĐỔI: Thêm tham số 'true' cho italics (tham số thứ 3)
        fullCenterCell(
          centerPara("(không kể thời gian chép đề)", false, true, 22),
          65
        ),
      ],
    }),

    new TableRow({
      children: [
        fullCenterCell(centerPara(studentNameText, false, false, 22), 35),
        fullCenterCell(centerPara(``, false, false, 22), 65),
      ],
    }),

    // Dòng cuối cùng của thông tin học sinh/mã đề
    new TableRow({
      children: [
        fullCenterCell(centerPara(studentClassText, false, false, 22), 35),
        fullCenterCell(centerPara(`Mã đề: ${maDe}`, false, false, 22), 65),
      ],
    }),

    // Dòng có viền dưới
    new TableRow({
      children: [
        fullCenterCell(centerPara("", false, false, 22), 35, {
          // Thêm viền dưới riêng cho ô này
          borders: {
            ...defaultBorders,
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" }, // Viền đơn, dày 6, màu đen
          },
        }),
        fullCenterCell(centerPara("", false, false, 22), 35, {
          // Thêm viền dưới riêng cho ô này
          borders: {
            ...defaultBorders,
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" }, // Viền đơn, dày 6, màu đen
          },
        }),
      ],
    }),

    new TableRow({
      children: [
        fullCenterCell(centerPara("", false, false, 22), 35),
        fullCenterCell(centerPara("", false, false, 22), 35),
      ],
    }),
  ];

  const headerTable = new Table({
    rows: rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    alignment: Alignment.CENTER,
    borders: defaultBorders,
  });

  return [headerTable];
}

// ===== Sinh file Word (Không đổi) =====
async function createExamFile(questions, filePath, examIndex) {
  const children = [];

  // Tạm tính số trang (ước lượng)
  const numPagesEstimate = Math.ceil(questions.length / 5) + 1;

  // 1. Chèn Tiêu đề
  const header = createHeader(examIndex, numPagesEstimate);
  children.push(...header);

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

  const doc = new Document({
    sections: [{ children }],
    styles: {
      default: {
        document: {
          run: {
            font: "Times New Roman",
            size: 24, // Tương đương 12pt
          },
        },
      },
    },
  });
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
        await createExamFile(shuffledQuestions, examFilePath, i);
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
