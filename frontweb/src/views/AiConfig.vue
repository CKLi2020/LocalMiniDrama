<template>
  <div class="ai-config">
    <header class="header">
      <div class="header-inner">
        <h1 class="logo" @click="goList">
          <span class="logo-main">黑猫短剧剧场</span>
          <span class="logo-sub">BlackCatStudio</span>
        </h1>
        <span class="page-title">AI 配置</span>
        <el-button class="btn-back" @click="goList">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
      </div>
    </header>

    <main class="main">
      <AIConfigContent />
    </main>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import AIConfigContent from '@/components/AIConfigContent.vue'

const router = useRouter()

function goList() {
  router.push({ name: 'list' })
}
</script>

<style scoped>
.ai-config {
  min-height: 100vh;
  background: #09090c;
  background-image:
    radial-gradient(ellipse 80% 50% at 20% -20%, rgba(245, 158, 11, 0.16) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 110%, rgba(45, 212, 191, 0.08) 0%, transparent 60%);
}
html.light .ai-config {
  background: #fbf7ef;
  background-image:
    radial-gradient(ellipse 80% 50% at 20% -20%, rgba(245, 158, 11, 0.1) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 110%, rgba(20, 184, 166, 0.06) 0%, transparent 60%);
}
.header {
  background: rgba(12, 12, 16, 0.84);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(245, 158, 11, 0.18);
  box-shadow: 0 2px 20px rgba(0, 0, 0, 0.4);
  position: sticky;
  top: 0;
  z-index: 100;
}
html.light .header {
  background: rgba(255, 255, 255, 0.85);
  border-bottom-color: rgba(217, 119, 6, 0.18);
  box-shadow: 0 2px 16px rgba(217, 119, 6, 0.08);
}
.header-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.logo {
  margin: 0;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1;
  transition: filter 0.3s;
}
.logo:hover {
  filter: drop-shadow(0 0 10px rgba(245, 158, 11, 0.38));
}
.logo-main {
  font-size: 1.1rem;
  font-weight: 700;
  background: linear-gradient(135deg, #fde68a 0%, #f59e0b 52%, #fff7ed 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.logo-sub {
  font-size: 0.68rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: #6d6d7a;
  -webkit-text-fill-color: #6d6d7a;
}
html.light .logo-main {
  background: linear-gradient(135deg, #92400e, #d97706);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
html.light .logo-sub {
  color: #9ca3af;
  -webkit-text-fill-color: #9ca3af;
}
.page-title {
  flex: 1;
  font-size: 16px;
  color: #a1a1aa;
}
html.light .page-title { color: #6b7280; }
.main {
  max-width: 1200px;
  margin: 24px auto;
  background: rgba(24, 24, 27, 0.75);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: 16px;
  padding: 20px 24px;
  border: 1px solid rgba(63, 63, 70, 0.7);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
}
html.light .main {
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(217, 119, 6, 0.14);
  box-shadow: 0 4px 20px rgba(217, 119, 6, 0.08);
}
</style>
