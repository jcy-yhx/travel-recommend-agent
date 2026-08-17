import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('../views/home.vue')
  },
  {
    path: '/chat',
    name: 'chat',
    component: () => import('../views/chat.vue')
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('../views/profile.vue')
  },
  {
    path: '/detail',
    name: 'detail',
    component: () => import('../views/detail.vue')
  }
  ,{ path: '/login', name: 'login', component: () => import('../views/login.vue') }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})
router.beforeEach(to => {
  if (to.path !== '/login' && !localStorage.getItem('travel_token')) return '/login'
})

export default router
