require("dotenv").config();

const path = require("path");
const cors = require("cors");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const webRouters = require("./routes/web");

const app = express();
const server = http.createServer(app); // dùng http server để gắn socket.io
const io = new Server(server, {
  cors: {
    origin: "*", // cho phép tất cả origin, bạn có thể fix cứng domain FE của mình
  },
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// middleware để gắn io vào req (cho phép controller dùng io.emit)
app.use((req, res, next) => {
  req.io = io;
  next();
});

app.use("/api", webRouters);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// socket.io connection
io.on("connection", (socket) => {
  console.log("Frontend connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("Frontend disconnected:", socket.id);
  });
});

const port = process.env.PORT || 3000;
const hostname = "0.0.0.0";

server.listen(port, hostname, () => {
  console.log(`✅ Server chạy tại http://${hostname}:${port}`);
});
