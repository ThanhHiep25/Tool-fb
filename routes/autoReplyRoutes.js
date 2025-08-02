const express = require("express");
const router = express.Router();
const fs = require("fs");
const axios = require("axios");

const AUTO_REPLY_CONFIG_PATH = "auto-reply-config.json";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// Logic xử lý tự động trả lời, được gọi từ webhook
const autoReplyToComment = async (commentId, message) => {
  const rules = readAutoReplyRules();

  const matchedRule = rules.find((rule) => {
    if (!rule.active) return false;
    const lowerCaseMessage = message.toLowerCase();
    return rule.keywords.some((keyword) =>
      lowerCaseMessage.includes(keyword.toLowerCase())
    );
  });

  if (matchedRule) {
    try {
      const replyUrl = `https://graph.facebook.com/v19.0/${commentId}/comments?message=${encodeURIComponent(
        matchedRule.response
      )}&access_token=${PAGE_ACCESS_TOKEN}`;
      await axios.post(replyUrl);
      console.log(`Đã tự động trả lời bình luận ID ${commentId} thành công.`);
      return true;
    } catch (error) {
      console.error(
        `Lỗi khi tự động trả lời bình luận ID ${commentId}:`,
        error.response ? error.response.data : error.message
      );
      return false;
    }
  }
  return false;
};

// Hàm đọc và ghi file
const readAutoReplyRules = () => {
  try {
    if (!fs.existsSync(AUTO_REPLY_CONFIG_PATH)) {
      fs.writeFileSync(
        AUTO_REPLY_CONFIG_PATH,
        JSON.stringify({ rules: [] }, null, 2)
      );
    }
    const data = fs.readFileSync(AUTO_REPLY_CONFIG_PATH, "utf8");
    return JSON.parse(data).rules;
  } catch (error) {
    console.error("Lỗi khi đọc file cấu hình tự động trả lời:", error);
    return [];
  }
};

const writeAutoReplyRules = (rules) => {
  try {
    const data = JSON.stringify({ rules }, null, 2);
    fs.writeFileSync(AUTO_REPLY_CONFIG_PATH, data, "utf8");
  } catch (error) {
    console.error("Lỗi khi ghi file cấu hình tự động trả lời:", error);
  }
};

// --- ENDPOINTS CHO TỰ ĐỘNG TRẢ LỜI ---
router.get("/auto-reply-rules", (req, res) => {
  res.json({ rules: readAutoReplyRules() });
});

router.post("/update-auto-reply-rule", (req, res) => {
  const { rule, index } = req.body;
  const rules = readAutoReplyRules();

  if (index !== null && index !== undefined) {
    rules[index] = rule;
  } else {
    rules.push(rule);
  }

  writeAutoReplyRules(rules);
  res.json({ success: true });
});

router.post("/delete-auto-reply-rule", (req, res) => {
  const { index } = req.body;
  const rules = readAutoReplyRules();

  if (index !== undefined && index >= 0 && index < rules.length) {
    rules.splice(index, 1);
    writeAutoReplyRules(rules);
    res.json({ success: true });
  } else {
    res.status(400).json({ success: false, message: "Index không hợp lệ" });
  }
});

module.exports = router;