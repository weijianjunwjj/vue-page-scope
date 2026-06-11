# vue-page-scope

> Vue 3 页面级作用域运行时容器,基于 `effectScope` 实现 —— source、state、getters、actions、watch、init/enter/leave,一个页面作用域全收。

---

## Why this exists

这个包最初只是 [`vue-page-store`](https://github.com/weijianjunwjj/vue-page-store) 的 Vue 3 移植版 —— 一个 Vue 2 时代的页面级状态管理库。

但写到 v0.5 才意识到,这个库一直在做的事情并不是"管理状态",而是在管理一个完整的**页面作用域**:数据、派生值、异步 loading、定时器、事件总线、插件,全部绑定在页面的可见性生命周期上。

所以这不只是移植。**Vue 3 版本是这个意识到的事情第一次被正面命名。**

| | `vue-page-store` (Vue 2) | `vue-page-scope` (Vue 3) |
|---|---|---|
| 概念 | 页面级 Store | 页面级 Scope |
| 响应式底层 | 隐藏 Vue 实例 + `Vue.set` | `effectScope` + `reactive` |
| 生命周期绑定 | `hook:mounted` 事件 + `bindTo(vm)` | setup 内 `onMounted` 等 hook |
| 抽象继承 | — | ✅ |
| 实战验证场景 | 一个真实后台业务(ebi)迭代多版本 | 概念成熟,实现初版 |

## 版本说明

`vue-page-scope` 从 `0.1.0` 起步。

它不是 `vue-page-store` 版本号的续编,而是 `vue-page-store` 在 0.3 → 0.5 演进中逐渐显露出的「页面作用域」概念,在 Vue 3 上的一次重新实现。

旧包的 v0.5 是认知终点,新包的 v0.1 是概念起点。

---

## 它是什么

`vue-page-scope` 是面向 **复杂 Vue 3 业务页面** 的页面级运行时容器。

一个 `definePageScope` 定义一个 **Page Scope** —— 它统一管理这个页面作用域内的:

- **source** — 页面输入 / 原始返回(如路由参数、接口响应)
- **state** — 响应式业务状态
- **getters** — 派生计算
- **actions** — 业务逻辑
- **watch** — 声明式副作用
- **init** — 一次性初始化(拉字典、注册事件监听等)
- **enter / leave** — 页面可见性生命周期
- **$setInterval** — 页面级定时器托管
- **event bus** — 页面内作用域通信
- **plugin** — 外部扩展机制

页面离开时自动清理页面级定时器,页面销毁时 `effectScope.stop()` 一键回收所有响应式副作用(包括 plugin 内创建的),不污染全局。

## 它不是什么

- **不是 Pinia 替代品** — 全局状态(用户信息、权限、路由)请继续用 Pinia
- **不是全局状态管理方案** — 它的作用域是"页面",不是"应用"
- **不是大而全的框架** — 它只解决复杂页面的页面层状态编排

| | Pinia | vue-page-scope |
|---|---|---|
| 作用域 | 全局 | 页面 |
| 生命周期 | 跟随应用 | 跟随页面可见性 / 页面实例 |
| 适合 | 用户信息、权限、路由状态 | 仪表盘、漏斗详情、大型配置页 |
| 销毁 | 通常不销毁 | 页面离开 / 销毁时可回收 |

---

## 安装

```bash
npm install vue-page-scope
```

要求 `vue@^3.2.0` 作为 peer dependency(因为底层用了 `effectScope`,Vue 3.2+ 才有)。

## 快速上手

### 1. 定义 scope

```js
// scopes/order-list.js
import { definePageScope } from 'vue-page-scope'

export const useOrderScope = definePageScope('orderList', {
  source: () => ({
    response: null,
    query: {},
  }),

  state: () => ({
    keyword: '',
    page: 1,
    pageSize: 20,
    selectedIds: [],
    deleteDialogVisible: false,
  }),

  getters: {
    list() {
      return this.$source.response?.list || []
    },
    total() {
      return this.$source.response?.total || 0
    },
    hasSelection() {
      return this.selectedIds.length > 0
    },
    showEmpty() {
      return !this.$loading.search && this.list.length === 0
    }
  },

  actions: {
    async search() {
      const res = await api.getOrders({
        keyword: this.keyword,
        page: this.page,
        pageSize: this.pageSize,
      })
      this.$source.response = res
    },

    async batchDelete() {
      await api.deleteOrders(this.selectedIds)
      this.selectedIds = []
      this.deleteDialogVisible = false
      this.search()
    }
  },

  watch: {
    keyword() {
      this.page = 1
    }
  },

  // 只执行一次:拉下拉框选项、注册事件监听等
  init() {
    this.loadDictOptions()
    this.$on('child:refresh', () => this.search())
  },

  // 每次页面可见时执行
  enter() {
    // 通过注入的 $route 直接读路由参数,不需要在 setup 里两步走
    this.$source.query = this.$route.query
    this.search()
    this.$setInterval(() => this.search(), 5000)
  },

  leave() {
    // interval 会自动清理
  }
})
```

### 2. 页面组件中使用

```vue
<script setup>
import { useOrderScope } from './scopes/order-list'

// 必须在 setup 内调用 —— 该组件成为 scope 的 owner
// 如果项目装了 Vue Router,$route / $router 会被自动桥接,无需手动传入
const orderScope = useOrderScope()
</script>

<template>
  <div>
    <input v-model="orderScope.keyword" />
    <button :loading="orderScope.$loading.search" @click="orderScope.search">
      搜索
    </button>
  </div>
</template>
```

> 上面的 `enter()` 里直接用了 `this.$route.query` —— 这来自 auto bridge.如果你需要注入自定义路由 / userStore / i18n 等,详见 [Router Bridge & Injection](#router-bridge--injection) 小节.

### 3. 子组件中使用

```vue
<script setup>
import { injectPageScope } from 'vue-page-scope'

// 不需要 import scope 文件 —— 直接从父级 inject
const pageScope = injectPageScope()
pageScope.search()
</script>
```

所有页面统一用 `const xxxScope = useXxxScope()`,所有子组件统一 `injectPageScope()`。  
不需要知道父页面用的哪个 scope 定义,零耦合。

---

## Owner 模型

`vue-page-scope` 采用 **单 owner 模型**:

- **`useXxxScope()` 应该只在页面级组件调用** —— 该组件成为 scope 的 owner,负责 provide 和生命周期
- **子组件用 `injectPageScope()` 获取 scope**,不要重复调用 `useXxxScope()`
- 同一个 scope id 在同一时刻只能有一个 owner

如果子组件误调了 `useXxxScope()`,会收到 dev 环境 warning,但**不会触发重复的 enter/leave**(scope 内部有去重)。

为什么这样设计:Vue 3 的 setup 内自动绑生命周期让"多组件共享 scope"变得太容易出错 —— 子组件卸载就会触发 scope 的 `leave`,导致"小孩一关灯,全屋断电"。单 owner 模型把生命周期所有权显式收紧。

---

## API

### `definePageScope(id, options)`

定义一个页面级 scope,返回 `useScope(injected?)` 函数。

`useScope` 接受一个可选的注入对象,字段会挂到 scope 上供 init / enter / actions / getters 访问。详见 [Injection](#injection)。

**options:**

| 字段 | 类型 | 说明 |
|---|---|---|
| `state` | `() => Object` | **必填**,业务状态工厂函数 |
| `source` | `() => Object` | 页面输入 / 原始返回工厂函数 |
| `getters` | `{ [key]: function }` | 派生计算,`this` 指向 scope |
| `actions` | `{ [key]: function }` | 业务方法,`this` 指向 scope |
| `watch` | `{ [path]: handler \| options }` | 声明式 watcher,支持 dot-path |
| `init` | `function` | scope 创建后一次性调用 |
| `enter` | `function` | 页面进入可见 / 可交互状态时触发 |
| `leave` | `function` | 页面离开可见 / 可交互状态时触发 |
| `lifecycle` | `'auto' \| 'manual'` | **v0.2**，生命周期模式，默认 `'auto'`。见 [跨运行时](#跨运行时lifecycle-模式--context-通道-v02) |
| `context` | `T \| Ref<T> \| (() => T)` | **v0.2**，适配器上下文,通过 `scope.$getContext()` 惰性读取 |
| *其它字段* | *any* | 注册过的 plugin 可声明自己的字段 |

### `injectPageScope()`

子组件中获取当前页面 scope。等价于 `inject('pageScope')`,但带 dev 警告(找不到时提示用户)。

### `registerPlugin(plugin)`

注册全局插件,详见 [Plugin](#plugin) 节。

### Scope 实例属性与方法

| 属性/方法 | 说明 |
|---|---|
| `scope.xxx` | 直接访问 state 字段 |
| `scope.$state` | 原始响应式 state 对象 |
| `scope.$source` | 原始响应式 source 对象 |
| `scope.$loading` | action loading 状态对象,如 `scope.$loading.search` |
| `scope.$status` | `{ mounted, active }` 响应式状态 |
| `scope.$disposed` | scope 是否已销毁 |
| `scope.$id` | scope 唯一标识 |
| `scope.$patch(partial \| fn)` | 批量更新 state(浅合并) |
| `scope.$reset()` | 重置到 `state()` + `source()` 初始值,清除动态字段 |
| `scope.$setInterval(fn, delay)` | 注册页面级 interval,leave / destroy 自动清理 |
| `scope.$emit(event, payload)` | 发射事件(当前 scope 作用域) |
| `scope.$on(event, handler)` | 订阅事件,返回取消函数 |
| `scope.$off(event, handler?)` | 取消订阅 |
| `scope.$destroy()` | 手动销毁(auto 模式 owner unmount 自动触发;manual 模式由 adapter 调) |
| `scope.$init()` | **v0.2** 手动触发 init(manual 模式 / 跨运行时 adapter 用;auto 模式库自动调) |
| `scope.$enter()` | **v0.2** 手动触发 enter(同上) |
| `scope.$leave()` | **v0.2** 手动触发 leave(同上) |
| `scope.$getContext()` | **v0.2** 惰性解析 `options.context`;未配置或 destroyed 后返回 `undefined` |

### watch 配置

```js
watch: {
  // 函数写法 — 默认 shallow watch
  'fieldName'(newVal, oldVal) { ... },

  // 对象写法 — 可配置 deep / immediate
  'filters': {
    handler(newVal, oldVal) { ... },
    deep: true,        // 默认 false
    immediate: true    // 默认 false
  }
}
```

支持 dot-path:`'filters.type'(newVal, oldVal) { ... }`。

---

## source 与 state

`source` 用于把"页面输入 / 原始返回"和"业务状态"分开。

### 推荐分工

- **source**:路由参数、接口原始响应、页面输入上下文
- **state**:keyword、分页、选中项、弹窗状态、表单草稿等业务状态

```js
source: () => ({
  response: null,
  query: {},
}),

state: () => ({
  keyword: '',
  page: 1,
  selectedIds: [],
})
```

### 为什么要分开

- 原始返回不再和业务状态混在一起
- getters 可以同时基于 `this.$source` 和 `this.xxx` 计算
- `$reset()` 时 source / state 一起恢复,更清晰

---

## init / enter / leave

### 语义

- **init**:scope 创建后一次性调用,DOM 未就绪。已被 `effectScope` 收纳 —— 即使你在 init 里手写 `watch` 也会被自动回收(但更推荐用声明式的 `watch` option)
- **enter**:页面进入可见 / 可交互状态
- **leave**:页面离开可见 / 可交互状态

### 执行时序

```
setup() 开始
  └→ useXxxScope()
       └→ createPageScopeInstance()  ← state/source/getters/actions/watch 就绪
       └→ plugin.install()           ← plugin 安装(在 effectScope 内)
       └→ ★ init()                  ← 只执行一次
       └→ provide('pageScope', scope)
  └→ setup() 剩余代码

onMounted
  └→ ★ enter()                      ← 每次可见都执行
  └→ plugin.enter()

--- keep-alive 切走 ---
onDeactivated
  └→ clearAllIntervals()
  └→ ★ leave()
  └→ plugin.leave()

--- keep-alive 切回 ---
onActivated
  └→ ★ enter()                      ← 重新开轮询、刷数据
  └→ plugin.enter()

--- 页面销毁 ---
onBeforeUnmount
  └→ ★ leave()(如果还没 leave)
  └→ plugin.destroy()
  └→ scope.$destroy()
       └→ effectScope.stop()        ← 一键释放所有 watch / computed
```

### keep-alive 双响炮处理

`onMounted` 和 `onActivated` 在 keep-alive 首次激活时**都会触发**。`vue-page-scope` 内部用 `_entered` 状态机去重,`enter` 只会执行一次。

### 分工原则

| 钩子 | 执行次数 | DOM | 典型场景 |
|---|---|---|---|
| `init` | 一次 | ❌ | 拉下拉框选项、注册事件监听、从 localStorage 恢复配置、初始化 WebSocket |
| `enter` | 每次可见 | ✅ | 读路由参数、刷列表数据、开轮询 |
| `leave` | 每次离开 | ✅ | 通常不需要写,interval 已自动清理 |

### 适合放在 init 里的逻辑

- 拉下拉框 / 字典选项(只需要一次)
- 注册 `$on` 监听 scope 内部事件
- 从 localStorage 恢复上次的筛选条件
- 初始化 WebSocket / EventSource 连接
- 根据用户权限裁剪 columns / 按钮配置

### 适合放在 enter 里的逻辑

- 根据路由初始化 source / state
- 首屏加载 / 刷新列表数据
- 启动页面轮询

```js
init() {
  this.loadDictOptions()
  this.$on('child:refresh', () => this.search())
},

enter() {
  this.search()
  this.$setInterval(() => this.search(), 5000)
},

leave() {
  // interval 自动清理
}
```

---

## 跨运行时:lifecycle 模式 & context 通道 (v0.2)

v0.1 的生命周期完全绑在 Vue 组件钩子上(`onMounted / onActivated / ...`)。但小程序、微前端、自研路由这些运行时**不走 Vue 组件钩子**,所以 v0.2 把生命周期的「触发」与「Vue 钩子」解耦。

### lifecycle 模式

| 模式 | 行为 |
|---|---|
| `'auto'`(默认) | 库注册 Vue 钩子 + 自动 `$init`,**与 v0.1 完全一致**。web 项目什么都不用改 |
| `'manual'` | 库**不注册任何 Vue 钩子、不自动 init**。scope 创建即可用(plugin 已就绪),但 `$init / $enter / $leave / $destroy` 全部由 adapter 显式调 |

```js
const scope = definePageScope('apply', {
  lifecycle: 'manual',
  // ...
})()

// adapter 把宿主生命周期翻译成 scope 方法(以 uni-app 小程序为例):
onLoad((query) => { /* 存 query */ scope.$init() })
onShow(()      => scope.$enter())
onHide(()      => scope.$leave())
onUnload(()    => scope.$destroy())
```

### 状态机 & 幂等

manual 模式下幂等由库的状态机保证,adapter 不必自己排队:

```
created → inited → entered ⇄ left → destroyed
```

- `$init` 只执行一次(重复调用 dev warning)
- `$enter` destroyed 后无效、已 entered 时忽略
- `$leave` 仅 entered 状态触发
- `$destroy` 只执行一次;若当前 entered,**自动先补一次 `$leave`** 再 stop effectScope

### context 通道

小程序的路由参数要到 `onLoad` 才拿得到,setup 阶段是空的。`options.context` + `$getContext()` 用**惰性求值**解决这个时序:

```js
import { shallowRef } from 'vue'
const pageQuery = shallowRef({})           // setup 阶段还是空 {}

const scope = definePageScope('apply', {
  lifecycle: 'manual',
  context: () => pageQuery.value,          // 存 getter,不急切求值
  init() {
    const q = this.$getContext() || {}     // init 触发那刻才读,此时 query 已就位
    this.$source.activityId = q.activityId
  },
})()

onLoad((query) => { pageQuery.value = query; scope.$init() })
```

`$getContext()` 每次调用都重新解析(不缓存),所以 `Ref` / getter 形态始终反映最新值;未配置 `context` 或 scope 已 destroyed 时返回 `undefined`。它与 v0.1 的 `injected` 注入互不干扰——前者走 `$getContext()`,后者走 `scope.<key>` 顶层访问,可并存。

> auto(web)路径行为不变,有 Vitest 回归套件钉死;manual(小程序)路径由真机 spike 验证。完整的 uni-app adapter 实战(四个页面钩子翻译 + 真机踩坑)见 Activity Config Miniapp 项目。

---

## Router Bridge & Injection

> **常用门,框架自己开;特殊门,用户再给钥匙。**

Vue 2 时代的 `vue-page-store` 通过 `$vm` 隐式持有组件实例,scope 内部可以通过 `this.$vm.$route` 访问路由。Vue 3 的 Composition API 没有等价的"组件实例"概念可以让 scope 持有 —— `useRoute()` 必须在 setup 内调用,scope 内部拿不到。

`vue-page-scope` 提供**两层机制**:

### 1. Auto Bridge —— 默认行为,框架自己开

如果项目安装了 Vue Router,`vue-page-scope` 会**自动从当前组件实例桥接 `$route / $router`**,scope 内部可以直接通过 `this.$route / this.$router` 访问。

```js
// scope 定义
definePageScope('order', {
  enter() {
    this.$source.query = this.$route.query  // ← auto bridge,无需手动传入
    this.search()
  },
  actions: {
    goBack() {
      this.$router.back()
    }
  }
})

// setup 里
const orderScope = useOrderScope()  // ← 不需要传任何参数
```

**实现细节**:

- 框架**不 import `vue-router`** —— 通过 `getCurrentInstance().proxy.$route` 间接读取
- 这不是恢复 Vue 2 时代的 `$vm` 逃生口:`$vm` 把整个组件实例暴露给 scope,边界很脏;auto bridge 只桥接 `$route / $router` 两个常用公共能力,**不暴露完整组件实例**
- 桥接字段用 getter 实现 —— 路由切换时 scope 内部读到的始终是最新的 `$route`
- 如果项目**没装** Vue Router,这两个字段不会被桥接(不会出现 `undefined`)

### 2. Explicit Injection —— 特殊场景,用户再给钥匙

特殊上下文下(微前端、自研路由、需要其他 composables),通过 `useXxxScope(injected)` 显式注入:

```vue
<script setup>
import { useOrderScope } from './scopes/order-list'
import { useUserStore } from '@/stores/user'
import { useI18n } from 'vue-i18n'

const orderScope = useOrderScope({
  // 自定义路由(微前端 / 自研路由场景)
  $route: microAppRoute,
  $router: microAppRouter,

  // 注入任意 composables
  $user: useUserStore(),
  $i18n: useI18n(),
})
</script>
```

scope 内部直接用:

```js
definePageScope('order', {
  actions: {
    async save() {
      await api.save({
        userId: this.$user.id,
        locale: this.$i18n.locale.value,
      })
    }
  }
})
```

### 优先级 & 冲突规则

| 项 | 规则 |
|---|---|
| 注入时机 | scope 的 public API(`state / source / getters / actions / $patch / $reset / $内置字段`)全部挂载完成后,**早于 watch / plugin / init** |
| explicit injection 优先级 | **高于** auto bridge —— 用户传入的 `$route` 会覆盖自动桥接的 `$route` |
| 不可覆盖 | 内置 `$` 方法 / state / getters / actions 等已有字段,injection 时被识别后跳过 + warning |
| 单 owner 行为 | 注入只在 owner(首次调用 useXxxScope 的组件)处生效,后续调用传入 injected 会被警告忽略 |
| 字段属性 | 用 getter 实现 —— 传入 ref / reactive 时,scope 读到的始终是最新值;set 时打 warning(只读) |

> 为什么 injection 时机要晚于 getters / actions?  
> 这样如果用户误传了与 action / getter / `$patch` 同名的字段(比如注入对象里有 `search`,而 scope 也有 `search` action),injection 时能正确检测到冲突并跳过 + warning。如果反过来 injection 早于 actions,撞名时 action 反而会安静失效 —— 这种隐式 bug 是文档级别防不住的。

### 在 watch 里使用注入字段

因为注入时机早于 watch 注册,所以 watch 可以直接监听 `$route.query.xxx`:

```js
watch: {
  '$route.query.page'(newPage) {
    this.search()
  }
}
```

### 设计取舍:为什么不自动 `useRoute()`?

我考虑过让框架内部 `import { useRoute } from 'vue-router'`,**否决了**:

1. `vue-page-scope` 不应该硬依赖 `vue-router`
2. 微前端 / 自研路由 / 外部容器路由不一定兼容 vue-router 的 API
3. 用户可能想注入的不只是 route,**泛化的 inject 机制比"专门处理 route"更值钱**

通过 `instance.proxy.$route` 桥接,既兼顾了 99% 的 Vue Router 项目,又对其他路由方案保持友好(不桥接也不报错)。

---

## `$setInterval`

后台页面经常有轮询 / 倒计时需求,`$setInterval(fn, delay)` 统一托管页面级 interval。

### 特性

- 返回 `stop` 函数,可手动停止
- `leave` 时自动清理所有已注册 interval
- `$destroy()` 时兜底清理
- `enter` 时**不会自动恢复**,需要你自己重新注册

```js
enter() {
  this.$setInterval(() => {
    this.search()
  }, 5000)
}
```

---

## 异步 action 与 `$loading`

返回 Promise 的 action 自动追踪 loading 状态。

你不需要额外包装器,直接写普通 async 函数即可:

```js
actions: {
  async search() {
    const res = await api.getOrders(...)
    this.$source.response = res
  }
}
```

模板中可以直接使用:

```html
<!-- 搜索:只显示 loading -->
<el-button
  :loading="orderScope.$loading.search"
  @click="orderScope.search"
>
  搜索
</el-button>

<!-- 保存:UI 层自己决定是否禁用 -->
<el-button
  :loading="orderScope.$loading.save"
  :disabled="orderScope.$loading.save"
  @click="orderScope.save"
>
  保存
</el-button>
```

### 说明

- 框架只做 **loading 追踪**
- **不自动跳过重复调用**
- 是否防重复,由 UI 层通过 `:disabled="scope.$loading.xxx"` 自己决定

---

## State / Source Shape 规则

### state

`state()` 返回值定义了推荐的业务状态边界:

- **推荐**:在 `state()` 中声明完整字段,即使初始值为 `null` 或空数组
- **允许**:通过 `$patch` 动态新增字段(会写入 `$state`,但不会自动成为 `scope.xxx` 顶层代理)
- **注意**:`$reset()` 会清除所有不在 `state()` 中的动态字段

### source

`source()` 返回值定义了页面输入 / 原始返回的初始 shape:

- **推荐**:把常见 source 字段预先声明出来,如 `response`、`query`
- **允许**:运行时动态给 `$source` 增加字段(Proxy 自动响应,不需要 `$set` 之类的 API)
- **注意**:`$reset()` 同样会清除所有不在 `source()` 中的动态字段

---

## Plugin

Plugin 机制让外部库可以给 `definePageScope` options 增加**新字段**并消费它,同时挂钩 enter / leave / destroy 生命周期 —— 而不需要修改 page-scope 本身。

> 典型场景:`vue-page-runtime`(请求编排)、`vue-page-persist`(状态持久化)、devtools 扩展。

### 协议

Plugin 是一个对象,包含 `name` 和 `install`:

```js
{
  name: 'tasks',                          // 同时作为 options 字段匹配键
  install(scope, fieldValue, ctx) {       // fieldValue === options.tasks
    // 初始化 plugin 自己的逻辑
    return {
      enter()   { /* page enter 后调用 */ },
      leave()   { /* page leave 后调用 */ },
      destroy() { /* scope 销毁时调用 */ },
    }
  }
}
```

- **匹配规则**:`options[plugin.name] !== undefined` 才会调用 `install`。没有声明字段的 scope 完全不受影响
- **install 时机**:scope 创建末尾,state / getters / actions / $source / $setInterval / $emit 等全部就绪
- **install 运行在 `effectScope.run()` 内** —— plugin 内创建的 `watch / computed / watchEffect` 会被 `scope.$destroy()` 一键回收
- **返回值**:可选 `{ enter?, leave?, destroy? }`,不需要钩子可以不返回

### Runtime Context(第三参数)

`install` 的第三参数是 runtime context:

```ts
{
  framework: 'vue3',
  version: 3,
  reactive,
  computed,
  watch,
  effectScope,
}
```

设计原则:**只转发 Vue 3 响应式核心 API,不引入新概念,不创造伪适配层**。plugin 通过 ctx 获取该版本下的响应式能力,而不需要硬编码 `import { watch } from 'vue'`。

> 跨版本备注:`vue-page-store` (Vue 2) 的 ctx 是 `{ Vue }`。同一份 plugin 主体(name + install + fieldValue + 返回 hooks)跨版本不变,**仅 ctx 内容随框架版本不同**。

### 注册

全局注册一次即可:

```js
// main.js
import { registerPlugin } from 'vue-page-scope'
import taskPlugin from 'vue-page-runtime/plugin'

registerPlugin(taskPlugin)
```

之后正常写 scope,声明插件字段:

```js
import { definePageScope } from 'vue-page-scope'

definePageScope('order', {
  state: () => ({ /* ... */ }),

  // page-scope 不认识这个字段,但会递给注册过的 plugin
  tasks: {
    fetchUser: {
      trigger: 'enter',
      async run() { return api.getUser(this.$source.query.id) },
    },
    fetchOrders: {
      deps: ['fetchUser'],
      async run() { /* ... */ },
    },
  },
})
```

### 写一个 plugin

最小示例 —— 把 `persist` 字段声明持久化到 localStorage:

```js
const persistPlugin = {
  name: 'persist',

  install(scope, fieldValue, ctx) {
    const { key, paths } = fieldValue
    const { watch } = ctx  // 用 ctx 拿响应式 API

    // 恢复
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}')
      scope.$patch(saved)
    } catch (e) {}

    // 持久化 —— 监听指定字段
    // watch 在 effectScope 内创建,scope.$destroy() 时自动 stop
    paths.forEach(p =>
      watch(
        () => scope[p],
        (val) => {
          const cur = JSON.parse(localStorage.getItem(key) || '{}')
          cur[p] = val
          localStorage.setItem(key, JSON.stringify(cur))
        }
      )
    )

    // 不需要返回 destroy 钩子 —— effectScope.stop() 会自动 stop 所有 watch
  }
}

registerPlugin(persistPlugin)
```

使用:

```js
definePageScope('page', {
  state: () => ({ keyword: '', filters: {} }),
  persist: {
    key: 'page:cache',
    paths: ['keyword', 'filters']
  }
})
```

### 注意事项

- **全局注册,影响所有 scope**。plugin 只在对应 scope 声明了 `options[plugin.name]` 时才激活,但注册本身是全局的
- **同名 plugin 只能注册一次**,重复注册会被跳过并打印 warning
- **install 返回的钩子会被按注册顺序依次调用**(FIFO)
- **plugin 之间不通信**。如果两个 plugin 有依赖关系,应该合并成一个

---

## 实例模型:Singleton

当前版本采用 **id → singleton** 模型:

- 同一个 `id` 在整个应用中对应唯一一个 scope 实例
- 多次 `useXxxScope()` 调用返回同一实例(但只有首次调用的组件成为 owner)
- `$destroy()` 后从 registry 移除,下次 `useXxxScope()` 会创建新实例

**适用场景:**

- 单页面单作用域(最常见)
- keep-alive 下的页面缓存

**不适用场景:**

- 同一路由多开独立副本
- 需要按参数区分的多实例页面

> 多实例支持(keyed instance / scopeKey)将在未来版本演进。

---

## 适用场景

- 仪表盘页面 —— 多模块共享筛选条件、加载状态
- 漏斗 / 留存等分析详情页 —— 复杂交互 + 异步数据 + 页面可见性管理
- 大型配置页 —— 多 tab / 多步骤表单的状态统一管理
- keep-alive 业务页 —— 需要 init / enter / leave 感知的页面
- 微前端子应用 —— 页面作用域隔离,不污染宿主全局状态

## 不适用场景

- 全局用户信息、权限、路由等 → 用 Pinia
- 简单页面的小 data 管理 → 用 `ref` / `reactive` 就够了
- 需要同 id 多实例并存 → 当前版本不支持

---

## 异步安全

页面销毁后,异步请求可能仍在 pending。`vue-page-scope` 提供两层保护:

### 第一层:`effectScope.stop()` 自动释放响应式订阅

scope 销毁时调用 `effectScope.stop()`,**所有 watch / computed 都会被释放**。即使异步回写到 `$source.response = data` 或 `$state.list = list`,**没有任何 watcher 会被触发**,不会引起后续渲染或副作用。

```js
actions: {
  async fetchData() {
    const data = await api.getData()
    // 即使页面已销毁,下面的赋值不会 crash,
    // 也不会触发任何响应式更新(因为所有 watcher / computed 都已 stop).
    this.$source.response = data
  }
}
```

### 第二层:state 顶层代理 + `$patch` 显式 disposed 检查

对 state 顶层字段(`this.keyword = '...'`)直接赋值,或调用 `$patch`,会被 `$disposed` 检查拦截,**dev 环境下打印 warning 帮助调试**。

### 现状与限制

- ✅ scope 销毁后的异步写**不会崩溃**
- ✅ state 顶层赋值 / `$patch` 在 disposed 后会被警告
- ✅ async action 返回后的 `$loading` 自动归 false 也会被 disposed 检查短路
- ⚠️ 直接对 `$source.xxx` / `$state.xxx` 赋值(绕过顶层代理)**不会**触发警告,但因为响应式订阅已释放,实际也不会产生副作用

如果需要严格的"销毁后异步写完全拦截"语义(包括 dev warning),可以在 action 内部主动判断 `this.$disposed`:

```js
async fetchData() {
  const data = await api.getData()
  if (this.$disposed) return  // 主动短路
  this.$source.response = data
}
```

> Stale write guard(自动拦截 $source 异步写)在 roadmap 中,需要真实业务场景驱动后再实现.

---

## 调试

### `scopeRegistry` —— 导出的 Map

`scopeRegistry` 是导出的 Map,可以在代码里用于调试或自定义 devtools 集成:

```js
import { scopeRegistry } from 'vue-page-scope'

scopeRegistry.forEach((scope, id) => {
  console.log(id, scope.$status, scope.$disposed)
})
```

### `window.__VUE_PAGE_SCOPE__` —— dev 自动挂载

开发环境下会自动挂到 `window.__VUE_PAGE_SCOPE__`,方便控制台访问。生产环境和 SSR 环境不会挂。

```js
__VUE_PAGE_SCOPE__                        // { registry, scopes }
__VUE_PAGE_SCOPE__.scopes                 // { orderList: {…}, userProfile: {…} }
__VUE_PAGE_SCOPE__.scopes.orderList       // ← 有属性自动补全
__VUE_PAGE_SCOPE__.scopes.orderList.$source
__VUE_PAGE_SCOPE__.scopes.orderList.$loading

// 原始 Map 也保留
__VUE_PAGE_SCOPE__.registry.forEach(...)
```

- `registry`:导出的原始 Map,和 `import { scopeRegistry }` 拿到的是同一个引用
- `scopes`:getter,每次读取重建对象视图;销毁的 scope 自动消失

**说明**:

- `__VUE_PAGE_SCOPE__` 是 dev-only 调试接口,shape 和键名可能在后续版本变化,**不要在生产代码里依赖**
- 微前端场景下,多个子应用都加载 vue-page-scope 时,最后挂载的会覆盖前面的

### DevPanel?

`vue-page-store@0.5.1` 提供了页面内悬浮 DevPanel。**`vue-page-scope` 第一版暂不包含**,后续版本如有需要会单独发布到 `vue-page-scope/debug` 子路径,不影响主入口。

---

## 从 vue-page-store 迁移

`vue-page-scope` 不是 `vue-page-store` 的 Vue 3 升级版,而是同一个抽象在 Vue 3 上的重新实现。**API 形状和语义对齐 v0.5,但有以下结构性变化**:

### 命名变更

| `vue-page-store` (Vue 2) | `vue-page-scope` (Vue 3) |
|---|---|
| `definePageStore(id, opts)` | `definePageScope(id, opts)` |
| `useOrderStore()` | `useOrderScope()` |
| `inject('pageStore')` | `injectPageScope()` |
| `storeRegistry` | `scopeRegistry` |
| `window.__VUE_PAGE_STORE__` | `window.__VUE_PAGE_SCOPE__` |
| `registerPlugin` | `registerPlugin`(不变) |

### 使用方式变更

| | `vue-page-store` | `vue-page-scope` |
|---|---|---|
| 入口调用 | `useOrderStore(this)`(可在任意 hook 调用) | `useOrderScope()`(必须在 setup 内) |
| 生命周期绑定 | `bindTo(componentVm)` 自动挂 | setup 内 `onMounted/onActivated/...` 自动挂 |
| 子组件 | `inject: ['pageStore']` | `const scope = injectPageScope()` |
| owner 模型 | 任意 vm 可 bindTo,最后一个 unmount 触发 destroy | **单 owner**:仅首次 `useXxxScope()` 的组件挂生命周期 |

### 选项字段变更

**保持不变**:`state` / `source` / `getters` / `actions` / `watch` / `init` / `enter` / `leave` —— Options 风格完全一致。

**变更**:`$vm` 逃生口移除。Vue 2 时代 scope 通过 `$vm.$route / $vm.$router` 访问路由,Vue 3 版本提供两种替代方案(详见 [Router Bridge & Injection](#router-bridge--injection)):

1. **常规 Vue Router 项目**:框架自动桥接 `$route / $router`,scope 内直接 `this.$route` —— **不需要任何额外代码**
2. **特殊上下文**(微前端 / 自研路由 / 注入其他 composables):`useXxxScope({ $route: customRoute, $user: useUserStore() })` 显式注入

```js
// Vue 2 时代 (vue-page-store):
enter() {
  this.$source.query = this.$vm.$route.query
}

// Vue 3 时代 (vue-page-scope) —— 默认 auto bridge:
enter() {
  this.$source.query = this.$route.query  // 框架自动桥接,不需要手动传
}
```

### Plugin 协议变更

**保持不变**:`{ name, install }` 协议、字段匹配规则、返回 `{ enter, leave, destroy }` 钩子。

**变更**:`install(scope, fieldValue, ctx)` 的 ctx 从 `{ Vue }` 改为 `{ framework, version, reactive, computed, watch, effectScope }`。

如果你的 plugin 之前用 `ctx.Vue.set / ctx.Vue.delete`,Vue 3 直接 `target[key] = value` / `delete target[key]` 即可(Proxy 自动响应)。

---

## How it works

> 这一节是给好奇底层实现的人看的,使用上不需要了解。

### `effectScope` 作为生命容器

```js
const effectScopeRef = effectScope(true)  // detached

effectScopeRef.run(() => {
  const $state = reactive(initialState)
  const $source = reactive(initialSource)
  // ... computed for getters
  // ... watch for options.watch
})

// plugin install 也在 effectScope 内,plugin 创建的 watch / computed 同样被收纳
effectScopeRef.run(() => {
  plugins.forEach(p => p.install(scope, options[p.name], ctx))
})

// $destroy 一行清空
scope.$destroy = () => {
  effectScopeRef.stop()  // ← 释放所有 reactive 副作用
  // ...
}
```

为什么用 `effectScope(true)` 而不是默认的 `effectScope()`:

- 默认 `effectScope()` 会成为当前 active scope(通常是组件 setup scope)的子作用域
- 我们希望 scope 的生命周期由 `vue-page-scope` 自己管,**不被组件 setup scope 收编**
- detached 模式让 scope 独立于任何 effect scope 父级

### Owner 生命周期绑定

```js
function useScope() {
  // 命中缓存:active 复用;已 disposed 则摘除重建(v0.2 disposed-reuse 修复)
  let cached = scopeRegistry.get(id)
  if (cached && cached.$disposed) { scopeRegistry.delete(id); cached = null }
  if (cached) return cached  // 复用,不挂生命周期

  // 首次创建 —— 当前组件成为 owner。$init/$enter/$leave 已挂在 scope 上。
  const { scope } = createPageScopeInstance(id, options)
  scopeRegistry.set(id, scope)

  // v0.2:auto 模式才注册 Vue 钩子 + 自动 init;manual 模式全部交给 adapter。
  if (options.lifecycle !== 'manual') {
    // init 抛错时自毁,避免 registry 残留半初始化的 scope
    try { scope.$init() } catch (err) { scope.$destroy(); throw err }
    onMounted(scope.$enter)
    onActivated(scope.$enter)     // keep-alive 切回
    onDeactivated(scope.$leave)   // keep-alive 切走
    onBeforeUnmount(() => { scope.$leave(); scope.$destroy() })
  }

  provide('pageScope', scope)  // provide 在开关外,两种模式子组件都能 inject
  return scope
}
```

v0.2 起,`$init / $enter / $leave` 由 `lifecycle-controller` 统一管理并**公开为 scope 方法**(v0.1 是闭包私有的)。`'auto'` 模式下库内部自动调用它们、行为与 v0.1 一致;`'manual'` 模式留给跨运行时 adapter 显式驱动。

### State 顶层代理

```js
Object.keys(initialState).forEach(key => {
  Object.defineProperty(scope, key, {
    get: () => $state[key],
    set: (val) => {
      if (scope.$disposed) { warn(...); return }
      $state[key] = val
    }
  })
})
```

只代理 `initialState` 声明的 key 到 scope 顶层。动态字段通过 `$patch` / `$state` 访问,**不会成为 `scope.xxx` 顶层访问点** —— 这条规则与 `vue-page-store` 保持一致。

### Getter 用 `computed` 实现

```js
Object.keys(getters).forEach(key => {
  const c = computed(() => getters[key].call(scope))
  Object.defineProperty(scope, key, {
    get: () => c.value  // ← 用户写 scope.total,不写 scope.total.value
  })
})
```

Options-style 语义外壳要求用户**不写 `.value`**。getter 是 Vue 3 `computed` ref,通过 `defineProperty` 暴露成普通属性,使用上像 Vue 2 的 computed。

### `$reset` 原地改 key

```js
scope.$reset = () => {
  const freshState = options.state()
  Object.keys(freshState).forEach(key => $state[key] = freshState[key])
  Object.keys($state).forEach(key => {
    if (!(key in freshState)) delete $state[key]
  })
  // source 同理
}
```

不能 `$state = reactive(initialState)` 替换整个对象 —— 那会让所有闭包引用(getters / watch / plugin 内部的 watch)瞬间断链。必须**原地改 key**。

---

## Roadmap

- **Keyed instance** — `useXxxScope(scopeKey)` 支持同定义多实例
- **Official plugins** — 随着 `vue-page-runtime` 等生态库成熟,补充第一方 plugin 文档
- **DevPanel** — 在 Vue 3 上重做 dev-only 悬浮调试面板(以 `vue-page-scope/debug` 子路径发布)
- **Vue Devtools 集成** — 对接 Vue Devtools inspector / timeline API
- **Stale write guard** — 显式 API 化"页面销毁后异步写自动忽略"语义

---

## Related

- [`vue-page-store`](https://github.com/weijianjunwjj/vue-page-store) — 同一概念在 Vue 2 上的实现,本包的前身

## Validation

Release validation records are kept in [`validation/reports`](./validation/reports).

Current release validation:

- [`20260522-v0.1.0`](./validation/reports/20260522-v0.1.0.md)

## License

MIT © weijianjun