const { GoogleGenAI } = require("@google/genai");
const fs = require("fs").promises;
const path = require("path");

// =============================================================
// SỬA LỖI 2: Thêm "Header" vào import
// =============================================================
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Alignment,
  Header, // <-- THÊM DÒNG NÀY
} = require("docx");

const mammoth = require("mammoth");
const pdf = require("pdf-parse"); // Lỗi 1 sẽ được khắc phục bằng lệnh `apt-get` ở trên

require("dotenv").config();

// (Giữ nguyên phần khởi tạo AI và hàm extractTextFromFile...)
// ...
const ai = new GoogleGenAI(process.env.GEMINI_API_KEY);
const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });

const extractTextFromFile = async (filePath, mimeType) => {
  // (Giữ nguyên logic của hàm này)
  const fileExtension = path.extname(filePath).toLowerCase();

  if (fileExtension === ".txt") {
    return await fs.readFile(filePath, "utf-8");
  } else if (
    fileExtension === ".docx" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } else if (fileExtension === ".pdf" || mimeType === "application/pdf") {
    const dataBuffer = await fs.readFile(filePath);
    const data = await pdf(dataBuffer);
    return data.text;
  } else {
    return await fs.readFile(filePath, "utf-8").catch(() => {
      throw new Error(
        `Định dạng tệp ${fileExtension} không được hỗ trợ để trích xuất văn bản.`
      );
    });
  }
};
// ...

const postDeThi = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Vui lòng tải lên một tệp văn bản." });
  }

  const numFiles = req.body.level;
  const numberExFiles = parseInt(numFiles) || 2;
  const filePath = req.file.path;
  const mimeType = req.file.mimetype;
  let originalText = "";
  let correctedText = "";

  try {
    originalText = await extractTextFromFile(filePath, mimeType);

    if (!originalText || originalText.trim().length === 0) {
      await fs.unlink(filePath);
      return res
        .status(400)
        .json({ error: "Tệp tải lên không chứa văn bản hoặc không đọc được." });
    }

    // (Giữ nguyên toàn bộ logic PROMPT và gọi GEMINI...)
    // ...
    const correctionPrompt = `... (PROMPT CỦA BẠN) ...`;
    const fullPrompt = `${correctionPrompt}\n--- ĐÂY LÀ VĂN BẢN ĐƯỢC CUNG CẤP ---\n${originalText}`;
    const result = await model.generateContent(fullPrompt);
    const response = result.response;
    if (!response || !response.text) {
      throw new Error("API của AI không trả về nội dung.");
    }
    correctedText = response.text();
    // ...

    // 4. Tạo tệp Word (.docx)
    const doc = new Document({
      sections: [
        {
          headers: {
            // =============================================================
            // SỬA LỖI 2: Bọc Paragraph trong new Header()
            // =============================================================
            default: new Header({
              children: [
                new Paragraph({
                  alignment: Alignment.CENTER,
                  children: [
                    new TextRun({
                      text: "ThS Trần Thị Thu Trang - Sản phẩm dự thi Giải thưởng Tiên phong ứng dụng AI trong giáo dục Việt Nam",
                      bold: true,
                      size: 15,
                      color: "404040",
                    }),
                  ],
                  border: {
                    bottom: {
                      color: "auto",
                      space: 1,
                      value: "single",
                      size: 6,
                    },
                  },
                }),
              ],
            }),
          },
          // HẾT CẤU HÌNH HEADER
          children: [
            // (Phần children này đã đúng từ trước)
            new Paragraph({
              alignment: Alignment.CENTER,
              spacing: { after: 300, before: 500 },
              children: [
                new TextRun({
                  text: `KẾT QUẢ XỬ LÝ ĐỀ THI BẰNG TRÍ TUỆ NHÂN TẠO`,
                  bold: true,
                  size: 32,
                  color: "000080",
                }),
              ],
            }),
            new Paragraph({
              alignment: Alignment.JUSTIFIED,
              spacing: {
                line: 360,
                after: 200,
              },
              children: [new TextRun(correctedText)],
            }),
          ],
        },
      ],
    });

    const outputFilename = `DeThi_${Date.now()}.docx`;
    const outputPath = path.join("uploads/temp/docxs/", outputFilename);

    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const buffer = await Packer.toBuffer(doc);
    await fs.writeFile(outputPath, buffer);

    // 5. Trả về tệp Word cho Frontend (Giữ nguyên)
    res.download(outputPath, outputFilename, async (err) => {
      if (err) {
        console.error("Lỗi khi gửi tệp về frontend:", err);
      }
      try {
        await fs.unlink(filePath);
        await fs.unlink(outputPath);
      } catch (cleanupError) {
        console.error("Lỗi khi dọn dẹp tệp tạm thời:", cleanupError);
      }
    });
  } catch (error) {
    // Thêm log chi tiết khi có lỗi
    console.error("Lỗi nghiêm trọng trong postDeThi:", error);

    // Dọn dẹp file gốc nếu có lỗi
    try {
      if (filePath) await fs.unlink(filePath);
    } catch (cleanupError) {
      console.warn("Không thể xóa tệp gốc tạm thời sau lỗi.");
    }

    res.status(500).json({
      error: `Đã xảy ra lỗi: ${
        error.message || "Lỗi xử lý tệp hoặc Gemini API."
      }`,
    });
  }
};

module.exports = { postDeThi };
