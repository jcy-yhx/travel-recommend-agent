<script setup lang="ts">
// route 模式下，van-tabbar 会根据当前路由自动高亮对应 tab
</script>

<template>
  <div class="app-container">
    <router-view />
    <van-tabbar route>
      <van-tabbar-item to="/" icon="home-o">首页</van-tabbar-item>
      <van-tabbar-item to="/chat" icon="chat-o">对话</van-tabbar-item>
      <van-tabbar-item to="/profile" icon="user-o">我的</van-tabbar-item>
    </van-tabbar>
  </div>
</template>
