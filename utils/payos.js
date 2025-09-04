// load PayOS class từ package
const { PayOS } = require("@payos/node");
require("dotenv").config();

// khởi tạo đối tượng
const payos = new PayOS({
  clientId: process.env.PAYOS_CLIENT_ID,
  apiKey: process.env.PAYOS_API_KEY,
  checksumKey: process.env.PAYOS_CHECKSUM_KEY,
  // bạn có thể thêm các tùy chọn khác nếu cần
});

module.exports = payos;
