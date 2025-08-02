const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const path = require("path");
const schedule = require("node-schedule");
const fs = require("fs");
const multer = require("multer");
const FormData = require("form-data");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const port = 3000;

const PAGE_ID = process.env.PAGE_ID;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN; // Cần thêm biến này vào file .env

if (!PAGE_ID || !PAGE_ACCESS_TOKEN || !VERIFY_TOKEN) {
  console.error(
    "Lỗi: PAGE_ID, PAGE_ACCESS_TOKEN và VERIFY_TOKEN chưa được thiết lập trong file .env!"
  );
  process.exit(1);
}

const SCHEDULED_POSTS_FILE = "scheduled-posts.json";
const AUTO_REPLY_CONFIG_PATH = "auto-reply-config.json";

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

app.use(express.static(path.join(__dirname, "")));
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

let scheduledPosts = [];

// --- LOGIC LÊN LỊCH & ĐĂNG BÀI ---
function loadScheduledPosts() {
  try {
    if (fs.existsSync(SCHEDULED_POSTS_FILE)) {
      const data = fs.readFileSync(SCHEDULED_POSTS_FILE, "utf8");
      scheduledPosts = JSON.parse(data);

      scheduledPosts.forEach((post) => {
        const scheduledDate = new Date(post.scheduleTime);
        if (scheduledDate > new Date() && post.status === "scheduled") {
          scheduleJob(post.id, scheduledDate, post.message, post.imagePath);
        }
      });
      console.log("Đã tải và lên lịch lại các bài viết thành công.");
    }
  } catch (error) {
    console.error("Lỗi khi tải các bài viết đã lên lịch:", error);
  }
}

function saveScheduledPosts() {
  fs.writeFileSync(
    SCHEDULED_POSTS_FILE,
    JSON.stringify(scheduledPosts, null, 2),
    "utf8"
  );
}

function scheduleJob(id, date, message, imagePath = null) {
  schedule.scheduleJob(id.toString(), date, async function () {
    console.log(
      `Đang đăng bài viết đã lên lịch (ID: ${id}) vào lúc ${date.toLocaleString()}`
    );

    try {
      let fbResponse;
      if (imagePath && fs.existsSync(imagePath)) {
        const form = new FormData();
        form.append("message", message);
        form.append("source", fs.createReadStream(imagePath));
        form.append("access_token", PAGE_ACCESS_TOKEN);

        fbResponse = await axios.post(
          `https://graph.facebook.com/v19.0/${PAGE_ID}/photos`,
          form,
          { headers: form.getHeaders() }
        );
      } else {
        fbResponse = await axios.post(
          `https://graph.facebook.com/v19.0/${PAGE_ID}/feed`,
          { message: message, access_token: PAGE_ACCESS_TOKEN }
        );
      }
      const fbPostId = fbResponse.data.id;
      console.log(`Đăng thành công! Facebook Post ID: ${fbPostId}`);

      const postIndex = scheduledPosts.findIndex((p) => p.id === id);
      if (postIndex !== -1) {
        scheduledPosts[postIndex].status = "posted";
        scheduledPosts[postIndex].fb_post_id = fbPostId;
        saveScheduledPosts();
      }
    } catch (error) {
      console.error(
        "Lỗi khi đăng bài đã được lên lịch:",
        error.response ? error.response.data.error : error.message
      );
    }
  });
}

// --- LOGIC TỰ ĐỘNG TRẢ LỜI BÌNH LUẬN ---
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

async function autoReplyToComment(commentId, message) {
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
}

// --- HÀM TÁI SỬ DỤNG ---
async function fetchPosts(fields) {
  let allPosts = [];
  let nextUrl = `https://graph.facebook.com/v19.0/${PAGE_ID}/posts?fields=${fields}&access_token=${PAGE_ACCESS_TOKEN}&limit=100`;

  try {
    while (nextUrl) {
      const response = await axios.get(nextUrl);
      allPosts = allPosts.concat(response.data.data);
      nextUrl =
        response.data.paging && response.data.paging.next
          ? response.data.paging.next
          : null;
    }
    return allPosts;
  } catch (error) {
    throw new Error(
      `Lỗi khi lấy dữ liệu bài viết từ Facebook: ${
        error.response ? error.response.data.error.message : error.message
      }`
    );
  }
}

// --- ENDPOINTS ---
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

// Endpoint nhận sự kiện từ Webhook
app.post("/webhook", (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    body.entry.forEach(function (entry) {
      const pageId = entry.id;
      entry.changes.forEach(function (change) {
        if (change.field === "feed") {
          const value = change.value;
          if (value.item === "comment" && value.verb === "add") {
            const commentId = value.comment_id;
            const commentMessage = value.message;
            if (commentId && commentMessage) {
              console.log(
                `Đã nhận bình luận mới (ID: ${commentId}): ${commentMessage}`
              );
              // Gọi hàm tự động trả lời ngay lập tức
              autoReplyToComment(commentId, commentMessage);
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

// Endpoint chính để phân tích bài viết
app.get("/analyze-posts", async (req, res) => {
  const { sortBy, startDate, endDate, limit = 20, offset = 0 } = req.query;
  const parsedLimit = parseInt(limit, 10);
  const parsedOffset = parseInt(offset, 10);

  try {
    const fields =
      "id,message,created_time,full_picture,reactions.summary(true),comments.summary(true),shares";
    const allPosts = await fetchPosts(fields);

    let filteredPosts = allPosts;
    if (startDate && endDate) {
      filteredPosts = allPosts.filter((post) => {
        const postDate = new Date(post.created_time);
        return postDate >= new Date(startDate) && postDate <= new Date(endDate);
      });
    }

    switch (sortBy) {
      case "likes_desc":
        filteredPosts.sort(
          (a, b) =>
            (b.reactions?.summary.total_count || 0) -
            (a.reactions?.summary.total_count || 0)
        );
        break;
      case "comments_desc":
        filteredPosts.sort(
          (a, b) =>
            (b.comments?.summary.total_count || 0) -
            (a.comments?.summary.total_count || 0)
        );
        break;
      case "shares_desc":
        filteredPosts.sort(
          (a, b) => (b.shares?.count || 0) - (a.shares?.count || 0)
        );
        break;
      case "created_time_desc":
      default:
        filteredPosts.sort(
          (a, b) => new Date(b.created_time) - new Date(a.created_time)
        );
        break;
    }

    let suggestions =
      "Không tìm thấy bài viết nào có tương tác tốt trong khoảng thời gian này. Hãy thử điều chỉnh bộ lọc ngày hoặc sắp xếp khác.";
    if (filteredPosts.length > 0) {
      const topPostByEngagement = filteredPosts.reduce(
        (bestPost, currentPost) => {
          const currentEngagement =
            (currentPost.reactions?.summary.total_count || 0) +
            (currentPost.comments?.summary.total_count || 0) +
            (currentPost.shares?.count || 0);
          const bestEngagement =
            (bestPost.reactions?.summary.total_count || 0) +
            (bestPost.comments?.summary.total_count || 0) +
            (bestPost.shares?.count || 0);
          return currentEngagement > bestEngagement ? currentPost : bestPost;
        },
        filteredPosts[0]
      );

      const totalEngagement =
        (topPostByEngagement.reactions?.summary.total_count || 0) +
        (topPostByEngagement.comments?.summary.total_count || 0) +
        (topPostByEngagement.shares?.count || 0);

      if (totalEngagement > 0) {
        const topPostHour = new Date(
          topPostByEngagement.created_time
        ).getHours();
        const daysOfWeek = [
          "Chủ nhật",
          "Thứ Hai",
          "Thứ Ba",
          "Thứ Tư",
          "Thứ Năm",
          "Thứ Sáu",
          "Thứ Bảy",
        ];
        const topPostDay =
          daysOfWeek[new Date(topPostByEngagement.created_time).getDay()];
        suggestions = `Bài viết có tương tác tốt nhất được đăng vào khoảng **${topPostHour} giờ** ngày **${topPostDay}**. Bạn nên thử đăng bài vào thời điểm tương tự để tăng hiệu quả.`;
      }
    }

    let topCommenters = [];
    const commenterCounts = {};
    const postsToAnalyze = filteredPosts.slice(0, 10);
    for (const post of postsToAnalyze) {
      if (post.comments?.summary.total_count > 0) {
        let commentsUrl = `https://graph.facebook.com/v19.0/${post.id}/comments?summary(true)&access_token=${PAGE_ACCESS_TOKEN}&limit=100`;
        let commentsData = [];
        let hasMoreComments = true;
        while (hasMoreComments) {
          const commentsResponse = await axios.get(commentsUrl);
          commentsData = commentsData.concat(commentsResponse.data.data);
          if (commentsResponse.data.paging?.next) {
            commentsUrl = commentsResponse.data.paging.next;
          } else {
            hasMoreComments = false;
          }
        }
        for (const comment of commentsData) {
          const commenterId = comment.from?.id;
          const commenterName = comment.from?.name;
          if (commenterId && commenterName) {
            if (!commenterCounts[commenterId]) {
              commenterCounts[commenterId] = { name: commenterName, count: 0 };
            }
            commenterCounts[commenterId].count++;
          }
        }
      }
    }
    if (Object.keys(commenterCounts).length > 0) {
      topCommenters = Object.values(commenterCounts)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
    }

    const totalLikes = filteredPosts.reduce(
      (sum, post) => sum + (post.reactions?.summary.total_count || 0),
      0
    );
    const totalComments = filteredPosts.reduce(
      (sum, post) => sum + (post.comments?.summary.total_count || 0),
      0
    );
    const totalShares = filteredPosts.reduce(
      (sum, post) => sum + (post.shares?.count || 0),
      0
    );

    const paginatedPosts = filteredPosts.slice(
      parsedOffset,
      parsedOffset + parsedLimit
    );

    const responseData = {
      posts: paginatedPosts.map((post) => ({
        id: post.id,
        message_full: post.message,
        message_truncated: post.message
          ? post.message.substring(0, 100) + "..."
          : "Bài viết không có nội dung",
        created_time: new Date(post.created_time).toLocaleString(),
        likes: post.reactions?.summary.total_count || 0,
        comments: post.comments?.summary.total_count || 0,
        shares: post.shares?.count || 0,
        full_picture: post.full_picture,
      })),
      suggestions: suggestions,
      topCommenters: topCommenters,
      totalPosts: filteredPosts.length,
      totalLikes: totalLikes,
      totalComments: totalComments,
      totalShares: totalShares,
      hasMore: parsedOffset + paginatedPosts.length < filteredPosts.length,
    };

    res.status(200).json(responseData);
  } catch (error) {
    console.error("Lỗi khi lấy dữ liệu bài viết:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint để phân tích theo giai đoạn (ngày, tuần, tháng)
app.get("/analyze-by-period", async (req, res) => {
  const { period } = req.query;

  if (!period) {
    return res.status(400).json({ error: "Tham số `period` là bắt buộc." });
  }

  try {
    const fields =
      "created_time,reactions.summary(true),comments.summary(true),shares,insights.metric(post_impressions,post_video_views)";
    const allPosts = await fetchPosts(fields);

    const stats = {};
    allPosts.forEach((post) => {
      const createdTime = new Date(post.created_time);
      let key;

      switch (period) {
        case "day":
          key = createdTime.toISOString().split("T")[0];
          break;
        case "week":
          const d = new Date(
            Date.UTC(
              createdTime.getFullYear(),
              createdTime.getMonth(),
              createdTime.getDate()
            )
          );
          d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
          const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
          const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
          key = `${createdTime.getFullYear()}-W${String(weekNo).padStart(
            2,
            "0"
          )}`;
          break;
        case "month":
          key = `${createdTime.getFullYear()}-${String(
            createdTime.getMonth() + 1
          ).padStart(2, "0")}`;
          break;
        case "year":
          key = `${createdTime.getFullYear()}`;
          break;
        default:
          return;
      }

      if (!stats[key]) {
        stats[key] = {
          likes: 0,
          comments: 0,
          shares: 0,
          posts: 0,
          impressions: 0,
          video_views: 0,
        };
      }
      stats[key].likes += post.reactions?.summary?.total_count || 0;
      stats[key].comments += post.comments?.summary?.total_count || 0;
      stats[key].shares += post.shares?.count || 0;
      stats[key].posts += 1;

      if (post.insights) {
        const impressionsData = post.insights.data.find(
          (d) => d.name === "post_impressions"
        );
        if (impressionsData) {
          stats[key].impressions += impressionsData.values[0].value || 0;
        }
        const videoViewsData = post.insights.data.find(
          (d) => d.name === "post_video_views"
        );
        if (videoViewsData) {
          stats[key].video_views += videoViewsData.values[0].value || 0;
        }
      }
    });

    const sortedKeys = Object.keys(stats).sort();
    const sortedStats = {};
    for (const key of sortedKeys) {
      sortedStats[key] = stats[key];
    }
    res.status(200).json(sortedStats);
  } catch (error) {
    console.error("Lỗi khi lấy dữ liệu thống kê:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint để lên lịch đăng bài
app.post("/schedule-post", upload.single("image"), (req, res) => {
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
app.get("/get-scheduled-posts", (req, res) => {
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
app.put("/edit-scheduled-post/:postId", upload.single("image"), (req, res) => {
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
app.delete("/delete-scheduled-post/:postId", async (req, res) => {
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

// Endpoint để lấy chi tiết bình luận của một bài viết (bao gồm cả replies và phân trang)
app.get("/post-comments/:postId", async (req, res) => {
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
app.post("/reply-comment", async (req, res) => {
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

// --- ENDPOINTS CHO TỰ ĐỘNG TRẢ LỜI ---
app.get("/auto-reply-rules", (req, res) => {
  res.json({ rules: readAutoReplyRules() });
});

app.post("/update-auto-reply-rule", (req, res) => {
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

app.post("/delete-auto-reply-rule", (req, res) => {
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

app.listen(port, () => {
  console.log(`Server đang chạy tại http://localhost:${port}`);
  loadScheduledPosts();
});
