const express = require("express");
const axios = require("axios");
const router = express.Router();

const { fetchPosts } = require("../utils/helpers");

const PAGE_ID = process.env.PAGE_ID;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// Endpoint chính để phân tích bài viết
router.get("/analyze-posts", async (req, res) => {
  const { sortBy, startDate, endDate, limit = 20, offset = 0 } = req.query;
  const parsedLimit = parseInt(limit, 10);
  const parsedOffset = parseInt(offset, 10);

  try {
    const fields =
      "id,message,created_time,full_picture,reactions.summary(true),comments.summary(true),shares";
    const allPosts = await fetchPosts(fields, PAGE_ID, PAGE_ACCESS_TOKEN);

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
router.get("/analyze-by-period", async (req, res) => {
  const { period } = req.query;

  if (!period) {
    return res.status(400).json({ error: "Tham số `period` là bắt buộc." });
  }

  try {
    const fields =
      "created_time,reactions.summary(true),comments.summary(true),shares,insights.metric(post_impressions,post_video_views)";
    const allPosts = await fetchPosts(fields, PAGE_ID, PAGE_ACCESS_TOKEN);

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

module.exports = router;