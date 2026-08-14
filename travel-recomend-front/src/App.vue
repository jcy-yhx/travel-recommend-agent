<script setup lang="ts">
import { ref } from 'vue'

const active = ref(0)

const onChange = (index: number) => {
  active.value = index
}
</script>

<template>
  <div class="app-container">
    <router-view />
    <van-tabbar route active="{{ active }}" bind:change="onChange">
      <van-tabbar-item to="/" icon="home-o">首页</van-tabbar-item>
      <van-tabbar-item to="/chat" icon="chat-o">对话</van-tabbar-item>
      <van-tabbar-item to="/profile" icon="user-o">我的</van-tabbar-item>
    </van-tabbar>
  </div>
</template>
