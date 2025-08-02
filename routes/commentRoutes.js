const express = require("express");
const axios = require("axios");
const router = express.Router();

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// Endpoint để lấy chi tiết bình luận của một bài viết (bao gồm cả replies và phân trang)
router.get("/post-comments/:postId", async (req, res) => {
  const postId = req.params.postId;
  let allComments = [];
  let nextUrl = `https://graph.facebook.com/v19.0/${postId}/comments?fields=from,message,created_time,like_count,comments{from,message,created_time,like_count}&access_token=${PAGE_ACCESS_TOKEN}&summary=true&limit=100`;

  try {
    while (nextUrl) {
      const response = await axios.get(nextUrl);
      allComments = allComments.concat(response.data.data);
      nextUrl =
        response.data.paging && response.data.paging.next
          ? response.data.paging.next
          : null;
    }

    res.status(200).json({ data: allComments });
  } catch (error) {
    console.error(
      "Lỗi khi lấy chi tiết bình luận:",
      error.response ? error.response.data.error : error.message
    );
    res
      .status(500)
      .json({ error: "Lỗi khi lấy chi tiết bình luận từ Facebook." });
  }
});

// Endpoint mới để trả lời bình luận
router.post("/reply-comment", async (req, res) => {
  const { commentId, message } = req.body;

  if (!commentId || !message) {
    return res.status(400).json({ error: "commentId và message là bắt buộc." });
  }

  const graphApiUrl = `https://graph.facebook.com/v19.0/${commentId}/comments`;

  try {
    const response = await axios.post(graphApiUrl, {
      message: message,
      access_token: PAGE_ACCESS_TOKEN,
    });

    res.status(200).json({ success: true, data: response.data });
  } catch (error) {
    console.error(
      "Lỗi khi trả lời bình luận:",
      error.response ? error.response.data : error.message
    );
    res.status(500).json({ error: "Không thể trả lời bình luận." });
  }
});

module.exports = router;