const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const dotenv = require("dotenv");
const { loadScheduledPosts } = require("./utils/postScheduler");

dotenv.config();

const app = express();
const port = 3000;

const PAGE_ID = process.env.PAGE_ID;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

if (!PAGE_ID || !PAGE_ACCESS_TOKEN || !VERIFY_TOKEN) {
  console.error(
    "Lỗi: PAGE_ID, PAGE_ACCESS_TOKEN và VERIFY_TOKEN chưa được thiết lập trong file .env!"
  );
  process.exit(1);
}

app.use(express.static(path.join(__dirname, "")));
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// Kết nối các route từ các file riêng biệt
const postRoutes = require("./routes/postRoutes");
const scheduleRoutes = require("./routes/scheduleRoutes");
const autoReplyRoutes = require("./routes/autoReplyRoutes");
const commentRoutes = require("./routes/commentRoutes");

app.use("/", postRoutes);
app.use("/", scheduleRoutes);
app.use("/", autoReplyRoutes);
app.use("/", commentRoutes);

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Endpoint xác minh Webhook của Facebook
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("WEBHOOK_VERIFIED");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// Endpoint nhận sự kiện từ Webhook (có thể di chuyển sang commentRoutes sau này)
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    body.entry.forEach(function (entry) {
      entry.changes.forEach(async function (change) {
        if (change.field === "feed") {
          const value = change.value;
          if (value.item === "comment" && value.verb === "add") {
            const { autoReplyToComment } = require('./routes/autoReplyRoutes');
            const commentId = value.comment_id;
            const commentMessage = value.message;
            if (commentId && commentMessage) {
              console.log(
                `Đã nhận bình luận mới (ID: ${commentId}): ${commentMessage}`
              );
              await autoReplyToComment(commentId, commentMessage);
            }
          }
        }
      });
    });
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});

app.listen(port, () => {
  console.log(`Server đang chạy tại http://localhost:${port}`);
  loadScheduledPosts();
});