const schedule = require("node-schedule");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

const SCHEDULED_POSTS_FILE = "scheduled-posts.json";
const PAGE_ID = process.env.PAGE_ID;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

let scheduledPosts = [];

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

module.exports = {
  loadScheduledPosts,
  saveScheduledPosts,
  scheduleJob,
  scheduledPosts,
};