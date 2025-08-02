const express = require("express");
const router = express.Router();
const fs = require("fs");
const multer = require("multer");
const axios = require("axios");
const schedule = require("node-schedule");

const {
  loadScheduledPosts,
  saveScheduledPosts,
  scheduleJob,
  scheduledPosts,
} = require("../utils/postScheduler");

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (!fs.existsSync("uploads")) {
      fs.mkdirSync("uploads");
    }
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({ storage: storage });

// Endpoint để lên lịch đăng bài
router.post("/schedule-post", upload.single("image"), (req, res) => {
  const { message, scheduleTime } = req.body;
  const scheduledDate = new Date(scheduleTime);
  const imagePath = req.file ? req.file.path : null;

  if (!message && !imagePath) {
    return res
      .status(400)
      .json({ error: "Nội dung hoặc hình ảnh không được để trống." });
  }
  if (scheduledDate < new Date()) {
    if (imagePath && fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
    return res
      .status(400)
      .json({ error: "Thời gian lên lịch phải ở trong tương lai." });
  }
  const postId = Date.now();
  scheduledPosts.push({
    id: postId,
    message: message,
    scheduleTime: scheduledDate,
    imagePath: imagePath,
    status: "scheduled",
  });
  saveScheduledPosts();
  scheduleJob(postId, scheduledDate, message, imagePath);
  res
    .status(200)
    .json({ success: true, scheduled_time: scheduledDate, id: postId });
});

// Endpoint để lấy danh sách các bài viết đã lên lịch
router.get("/get-scheduled-posts", (req, res) => {
  const { query, sortBy } = req.query;
  let filteredPosts = [...scheduledPosts];

  if (query) {
    const lowerCaseQuery = query.toLowerCase();
    filteredPosts = filteredPosts.filter(
      (p) => p.message && p.message.toLowerCase().includes(lowerCaseQuery)
    );
  }

  switch (sortBy) {
    case "time_asc":
      filteredPosts.sort(
        (a, b) => new Date(a.scheduleTime) - new Date(b.scheduleTime)
      );
      break;
    case "time_desc":
    default:
      filteredPosts.sort(
        (a, b) => new Date(b.scheduleTime) - new Date(a.scheduleTime)
      );
      break;
  }
  res.status(200).json(filteredPosts);
});

// Endpoint để chỉnh sửa bài viết đã lên lịch
router.put("/edit-scheduled-post/:postId", upload.single("image"), (req, res) => {
  const postId = parseInt(req.params.postId);
  const { message, scheduleTime } = req.body;
  const newImagePath = req.file ? req.file.path : null;

  const postIndex = scheduledPosts.findIndex((p) => p.id === postId);
  if (postIndex === -1) {
    return res
      .status(404)
      .json({ error: "Không tìm thấy bài viết để chỉnh sửa." });
  }

  const scheduledDate = new Date(scheduleTime);
  if (scheduledDate < new Date()) {
    if (newImagePath && fs.existsSync(newImagePath))
      fs.unlinkSync(newImagePath);
    return res
      .status(400)
      .json({ error: "Thời gian lên lịch phải ở trong tương lai." });
  }

  const oldJob = schedule.scheduledJobs[postId.toString()];
  if (oldJob) {
    oldJob.cancel();
  }
  const oldPost = scheduledPosts[postIndex];
  if (newImagePath && oldPost.imagePath && fs.existsSync(oldPost.imagePath)) {
    fs.unlinkSync(oldPost.imagePath);
  }

  oldPost.message = message;
  oldPost.scheduleTime = scheduledDate;
  if (newImagePath) {
    oldPost.imagePath = newImagePath;
  }
  oldPost.status = "scheduled";

  saveScheduledPosts();
  scheduleJob(postId, scheduledDate, message, oldPost.imagePath);
  res
    .status(200)
    .json({ success: true, message: `Đã cập nhật bài viết có ID: ${postId}` });
});

// Endpoint để xóa một bài viết (bao gồm cả trên Facebook)
router.delete("/delete-scheduled-post/:postId", async (req, res) => {
  const postId = parseInt(req.params.postId);

  const postIndex = scheduledPosts.findIndex((p) => p.id === postId);
  if (postIndex === -1) {
    return res.status(404).json({ error: "Không tìm thấy bài viết để xóa." });
  }
  const post = scheduledPosts[postIndex];

  try {
    if (post.status === "posted" && post.fb_post_id) {
      console.log(`Đang xóa bài viết ${post.fb_post_id} trên Facebook...`);
      await axios.delete(
        `https://graph.facebook.com/v19.0/${post.fb_post_id}`,
        {
          params: { access_token: PAGE_ACCESS_TOKEN },
        }
      );
    } else if (post.status === "scheduled") {
      const job = schedule.scheduledJobs[postId.toString()];
      if (job) {
        job.cancel();
      }
    }

    if (post.imagePath && fs.existsSync(post.imagePath)) {
      fs.unlinkSync(post.imagePath);
    }

    scheduledPosts.splice(postIndex, 1);
    saveScheduledPosts();
    res
      .status(200)
      .json({ success: true, message: `Đã xóa bài viết có ID: ${postId}` });
  } catch (error) {
    const errorMessage = error.response?.data?.error?.message || error.message;
    console.error("Lỗi khi xóa bài viết:", errorMessage);
    scheduledPosts.splice(postIndex, 1);
    saveScheduledPosts();
    res.status(500).json({ error: `Lỗi khi xóa bài viết: ${errorMessage}` });
  }
});

module.exports = router;