const axios = require("axios");

async function fetchPosts(fields, PAGE_ID, PAGE_ACCESS_TOKEN) {
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

module.exports = {
  fetchPosts,
};